"""
agents/youtube_metadata.py — Writes the packaging a published video is judged by.

Until this existed the uploader sent the user's raw prompt as the title, the
first 200 characters of the script as the description, and the fixed tag list
["AI", "autogen", "youtube"] on every single video. That is the part of a
YouTube upload that decides whether anyone clicks it.

Everything here is written from the script and the researched facts that were
actually used, so the title never promises something the video does not deliver.
When the run was grounded in the user's own documents, the description credits
them — the attribution follows the video all the way out to YouTube.
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

# YouTube's own limits. Exceeding them makes the upload fail, so they are
# enforced here rather than discovered at publish time.
MAX_TITLE = 100
MAX_DESCRIPTION = 4800          # real cap is 5000; leave room for attribution
MAX_TAGS = 15
MAX_TAG_LENGTH = 30

_llm = ChatGroq(model_name=GROQ_MODEL, max_tokens=GROQ_MAX_TOKENS)

CHANNEL_CTA = os.getenv("CHANNEL_CTA", "Follow for the AI shifts that actually change your job.")


METADATA_SYSTEM_PROMPT = f"""You write the packaging for a short-form video: the
title, description and tags. Packaging decides whether anyone watches, so treat
it as the most important text attached to the video.

TITLE
- Under {MAX_TITLE} characters, ideally 45-65.
- Lead with the most specific, surprising thing the video actually says — a
  number, a named thing, a concrete claim.
- No clickbait the script does not pay off. No ALL CAPS. No emoji.
- Do not end with a period.

DESCRIPTION
- First sentence repeats the hook and must stand alone: it is all most viewers see.
- Then 2-4 short lines of what the video covers, in plain language.
- Close with this call to action on its own line: "{CHANNEL_CTA}"
- No hashtag spam. At most 3 hashtags, on the final line, only if genuinely relevant.

TAGS
- 8-15 lowercase tags, each under {MAX_TAG_LENGTH} characters.
- Mix broad topic terms with the specific entities named in the script.
- No duplicates, no hashes, no punctuation.

Return ONLY valid JSON, no markdown fence, in exactly this shape:
{{"title": "...", "description": "...", "tags": ["...", "..."]}}
"""


def _clean_title(title: str) -> str:
    title = " ".join((title or "").split()).strip().strip('"').rstrip(".")
    return title[:MAX_TITLE].strip()


def _clean_tags(tags) -> list[str]:
    cleaned: list[str] = []
    for tag in tags or []:
        tag = re.sub(r"[#,]", " ", str(tag)).strip().lower()
        tag = re.sub(r"\s+", " ", tag)
        if tag and len(tag) <= MAX_TAG_LENGTH and tag not in cleaned:
            cleaned.append(tag)
    return cleaned[:MAX_TAGS]


def _attribution(knowledge_titles: list[str] | None) -> str:
    """Credit the user's own documents on the published video."""
    titles = [t for t in (knowledge_titles or []) if t]
    if not titles:
        return ""
    lines = "\n".join(f"• {t}" for t in titles)
    return f"\n\nCreated from:\n{lines}"


def _fallback(topic: str, script: str, knowledge_titles: list[str] | None) -> dict:
    """
    Used when the model is unreachable or returns nothing parsable. Still far
    better packaging than the raw prompt plus a 200-character slice.
    """
    first_sentence = re.split(r"(?<=[.!?])\s+", (script or "").strip())[0] if script else ""
    title = _clean_title(first_sentence or topic) or topic[:MAX_TITLE]
    description = ((script or "").strip()[:1200] + f"\n\n{CHANNEL_CTA}").strip()
    tags = _clean_tags(re.findall(r"[A-Za-z][A-Za-z0-9+-]{3,}", topic or ""))
    return {
        "title": title,
        "description": (description + _attribution(knowledge_titles))[:MAX_DESCRIPTION],
        "tags": tags or ["ai", "technology", "explainer"],
    }


def build_metadata(
    topic: str,
    script: str,
    facts: list[str] | None = None,
    knowledge_titles: list[str] | None = None,
) -> dict:
    """
    Returns {"title": str, "description": str, "tags": [str, ...]}.

    Never raises — packaging must not be the reason a finished video fails to
    publish, so any failure falls back to a derived-from-the-script version.
    """
    facts_block = "\n".join(facts or [])[:2500]
    user_block = f"""Topic: "{topic}"

Script that was narrated:
{(script or '').strip()[:3000]}

Facts the script was built from:
{facts_block or '(none recorded)'}
"""

    try:
        from agents.observability import get_langfuse_callbacks

        messages = [
            SystemMessage(content=METADATA_SYSTEM_PROMPT),
            HumanMessage(content=user_block),
        ]
        result = _llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
        raw = (result.content or "").strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group(0) if match else raw)
    except Exception as e:
        print(f"PYMSG: [youtube_metadata] generation failed ({e}); deriving from the script.", flush=True)
        return _fallback(topic, script, knowledge_titles)

    title = _clean_title(data.get("title", ""))
    # Newlines are kept deliberately: a YouTube description is multi-line, and
    # the call to action has to sit on its own line.
    description = str(data.get("description", "")).strip()
    tags = _clean_tags(data.get("tags"))

    if not title or not description:
        return _fallback(topic, script, knowledge_titles)

    description = (description + _attribution(knowledge_titles))[:MAX_DESCRIPTION]
    print(f"PYMSG: [youtube_metadata] title={title!r} ({len(tags)} tags)", flush=True)
    return {"title": title, "description": description, "tags": tags}
