"""
agents/podcast_writer.py — Turns study notes into a two-host conversation.

This is the script half of "Podcast from your notes". It writes a dialogue
between two hosts discussing the material, which is then voiced by
agents/podcast_audio.py.

The hard constraint is the same one the rest of this platform runs on: the
conversation may only contain what the notes actually say. A podcast that
invents a plausible-sounding statistic is worse than useless for someone
revising from it, because it sounds authoritative and is unverifiable.

Output is a list of turns:
    [{"speaker": "A", "text": "..."}, {"speaker": "B", "text": "..."}, ...]
"""

import json
import os
import re
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8192"))

# Keep the source within one request, and the result within a sane listen.
MAX_NOTES_CHARS = int(os.getenv("PODCAST_MAX_NOTES_CHARS", "12000"))
MIN_TURNS = 8
MAX_TURNS = int(os.getenv("PODCAST_MAX_TURNS", "22"))

_llm = ChatGroq(model_name=GROQ_MODEL, max_tokens=GROQ_MAX_TOKENS)


SYSTEM_PROMPT = f"""You write a two-host audio discussion about a set of study notes.

HOST A is the guide: introduces the topic, asks the questions a learner would ask,
and keeps the conversation moving.
HOST B is the explainer: answers clearly, gives the detail, offers the examples.

HARD RULE — everything said must come from the notes provided. Do not add facts,
figures, names, studies or examples that are not in them. If the notes are thin on
something, have the hosts say less about it rather than filling the gap. A
confident invention is the one thing that makes this useless for revision.

STYLE
- Real spoken conversation: contractions, short sentences, natural reactions.
- No filler intros like "Welcome back to the show" and no sign-off/outro.
- Open on the single most interesting thing in the notes, not a table of contents.
- Hosts may react to each other ("right", "so that's why...") but never waffle.
- No stage directions, no sound effects, no speaker names inside the text.
- Every turn is 1-3 sentences. Never a monologue.

LENGTH: between {MIN_TURNS} and {MAX_TURNS} turns, alternating A and B, starting with A.

Return ONLY valid JSON, no markdown fence, in exactly this shape:
{{"turns": [{{"speaker": "A", "text": "..."}}, {{"speaker": "B", "text": "..."}}]}}
"""


def _clean_text(text: str) -> str:
    """Strip anything that would be read aloud as punctuation noise."""
    text = re.sub(r"\*+", "", str(text or ""))
    text = re.sub(r"^\s*(HOST\s*)?[AB]\s*[:\-]\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\[[^\]]*\]", " ", text)          # stray stage directions
    text = re.sub(r"\((?:laughs|chuckles)[^)]*\)", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _fallback(notes: str, title: str) -> list[dict]:
    """
    Deterministic two-host reading if the model is unreachable, built from the
    notes' own headings and bullets. Not as lively, but truthful and it keeps
    the feature working rather than erroring.
    """
    lines: list[str] = []
    for raw in (notes or "").splitlines():
        line = raw.strip()
        if line.startswith("#"):
            line = line.lstrip("#").strip()
        elif line.startswith(("- ", "* ")):
            line = line[2:].strip()
        else:
            continue
        line = _clean_text(line)
        if 25 < len(line) < 260:
            lines.append(line)

    turns: list[dict] = [{"speaker": "A", "text": f"Today we're going through {title}."}]
    for i, line in enumerate(lines[: MAX_TURNS - 1]):
        turns.append({"speaker": "B" if i % 2 == 0 else "A", "text": line})
    return turns


def write_podcast(notes_markdown: str, title: str = "these notes") -> list[dict]:
    """
    Build the dialogue. Never raises — falls back to a derived reading so the
    audio step always has something to voice.
    """
    notes = (notes_markdown or "").strip()
    if not notes:
        return []

    user_block = f'Title: "{title}"\n\nStudy notes:\n{notes[:MAX_NOTES_CHARS]}'

    try:
        from agents.observability import get_langfuse_callbacks

        messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_block)]
        result = _llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
        raw = (result.content or "").strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group(0) if match else raw)
        raw_turns = data.get("turns") or []
    except Exception as e:
        print(f"PYMSG: [podcast_writer] generation failed ({e}); using a derived reading.", flush=True)
        return _fallback(notes, title)

    turns: list[dict] = []
    for turn in raw_turns[:MAX_TURNS]:
        text = _clean_text(turn.get("text", ""))
        if not text:
            continue
        speaker = "B" if str(turn.get("speaker", "")).strip().upper() == "B" else "A"
        turns.append({"speaker": speaker, "text": text})

    if len(turns) < 2:
        print("PYMSG: [podcast_writer] model returned too few turns; using a derived reading.", flush=True)
        return _fallback(notes, title)

    print(f"PYMSG: [podcast_writer] wrote {len(turns)} turns.", flush=True)
    return turns
