"""
agents/knowledge_grounding.py — Turns a user's own study notes into the grounded
fact set the rest of the pipeline already knows how to write from.

The normal path researches a topic on the web (agents/research_agent.py). When a
run is started from the Knowledge Hub instead, the facts must come from the
user's OWN sources, so the finished video can honestly claim it was made from
them.

The notes arrive as Markdown — Gemini's Cornell-style output from NexusNotes.
Rather than pasting whole documents into the prompt (which buries the relevant
part and invites the model to pad from parametric memory), an LLM pass SELECTS
the sections that actually bear on the topic and restates them as discrete,
citable facts.

The output format is deliberately identical to what research_agent.py emits:

    N. <fact text> — Source: <document title>

Keeping that shape is the whole trick — script_writer, the critic loop, the
artifact stream and source attribution then work with no changes at all.
"""

import os
import re
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8192"))

# Notes for a long lecture can run to tens of thousands of characters. Trim per
# source so several sources still fit one request without truncating the tail.
MAX_CHARS_PER_SOURCE = int(os.getenv("KNOWLEDGE_MAX_CHARS_PER_SOURCE", "12000"))
MAX_FACTS = int(os.getenv("KNOWLEDGE_MAX_FACTS", "12"))

_llm = ChatGroq(model_name=GROQ_MODEL, max_tokens=GROQ_MAX_TOKENS)


GROUNDING_SYSTEM_PROMPT = """You are preparing source material for a short video,
working ONLY from the study notes provided. The notes are the single source of truth.

Your task: select the material that genuinely bears on the requested topic and
restate it as a numbered list of distinct, self-contained facts.

Hard rules:
- Every fact must be supported by the notes. Do NOT add anything you happen to
  know — if the notes do not say it, it does not go in the list.
- Prefer concrete specifics: numbers, definitions, named steps, causes, results.
- One idea per fact. Do not merge two claims into one line.
- No duplicates, and no restating the same idea in different words.
- If the notes barely cover the topic, return FEWER facts rather than vaguer ones.
- Attribute each fact to the document it came from, using the exact title given.

Output ONLY a numbered list, each line in this exact format:
N. <fact text> — Source: <document title>

No preamble, no headings, no closing remarks.
"""


def _clean_markdown(md: str) -> str:
    """
    Strip the parts of the notes that carry no factual content: mermaid blocks
    (rendered diagrams), timestamp anchors, and images. Keeps headings and prose,
    which is where the substance lives.
    """
    text = re.sub(r"```mermaid\r?\n[\s\S]*?```", " ", md)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)          # images
    text = re.sub(r"\[([^\]]*)\]\(#t=\d+\)", r"\1", text)       # timestamp links
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)        # other links
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _trim(text: str, limit: int) -> str:
    """Cut on a paragraph boundary where possible, so a fact is not halved."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    boundary = cut.rfind("\n\n")
    return (cut[:boundary] if boundary > limit * 0.5 else cut).rstrip() + "\n…"


def _fallback_facts(sources: list[dict]) -> tuple[list[str], list[str]]:
    """
    Deterministic extraction used when the LLM call fails, so a grounded run
    never dies just because the model was unreachable. Headings and bullet
    points are already the most fact-like lines in Cornell notes.
    """
    facts: list[str] = []
    names: list[str] = []

    for source in sources:
        title = source.get("title") or "Untitled document"
        if title not in names:
            names.append(title)
        for raw in _clean_markdown(source.get("markdown") or "").splitlines():
            line = raw.strip()
            if line.startswith("#"):
                line = line.lstrip("#").strip()
            elif line.startswith(("- ", "* ")):
                line = line[2:].strip()
            else:
                continue
            line = line.replace("**", "").strip()
            if 25 < len(line) < 220:
                facts.append(f"{len(facts) + 1}. {line} — Source: {title}")
            if len(facts) >= MAX_FACTS:
                break
        if len(facts) >= MAX_FACTS:
            break

    return facts, names


def build_grounded_facts(topic: str, sources: list[dict]) -> dict:
    """
    Distil the selected knowledge sources into citable facts about `topic`.

    Parameters
    ----------
    topic   : what the video should be about.
    sources : [{"id": str, "title": str, "markdown": str}, ...]

    Returns
    -------
    {
      "facts":   ["1. ... — Source: X", ...],   # for the script writer
      "sources": ["X", "Y"],                     # document titles, for attribution
      "grounded": bool,                          # False only if there was nothing usable
    }

    Never raises: on any failure it falls back to deterministic extraction, and
    finally to an empty set, so the pipeline keeps its own error handling.
    """
    usable = [s for s in (sources or []) if (s.get("markdown") or "").strip()]
    if not usable:
        print("PYMSG: [knowledge_grounding] No usable note content in the selected sources.", flush=True)
        return {"facts": [], "sources": [], "grounded": False}

    titles = []
    blocks = []
    for source in usable:
        title = source.get("title") or "Untitled document"
        if title not in titles:
            titles.append(title)
        body = _trim(_clean_markdown(source["markdown"]), MAX_CHARS_PER_SOURCE)
        blocks.append(f'--- DOCUMENT: "{title}" ---\n{body}')

    user_block = (
        f'Topic for the video: "{topic}"\n\n'
        f"Study notes to work from ({len(usable)} document(s)):\n\n"
        + "\n\n".join(blocks)
        + f"\n\nReturn at most {MAX_FACTS} facts."
    )

    try:
        from agents.observability import get_langfuse_callbacks

        messages = [
            SystemMessage(content=GROUNDING_SYSTEM_PROMPT),
            HumanMessage(content=user_block),
        ]
        result = _llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
        raw = (result.content or "").strip()
    except Exception as e:
        print(f"PYMSG: [knowledge_grounding] LLM selection failed ({e}); using direct extraction.", flush=True)
        facts, names = _fallback_facts(usable)
        return {"facts": facts, "sources": names, "grounded": bool(facts)}

    # Same parsing shape as research_agent.research_topic.
    facts = []
    for line in raw.splitlines():
        line = line.strip()
        if line and re.match(r"^\d+[\.\)]", line):
            facts.append(line)

    if not facts:
        print("PYMSG: [knowledge_grounding] Model returned no parsable facts; using direct extraction.", flush=True)
        facts, names = _fallback_facts(usable)
        return {"facts": facts, "sources": names, "grounded": bool(facts)}

    facts = facts[:MAX_FACTS]
    print(
        f"PYMSG: [knowledge_grounding] Built {len(facts)} grounded facts from {len(titles)} document(s): {titles}",
        flush=True,
    )
    return {"facts": facts, "sources": titles, "grounded": True}
