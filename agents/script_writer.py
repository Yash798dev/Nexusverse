"""
script_writer.py — Fact-grounded script + visually-consistent image prompt generation.

Replaces the script/image-prompt half of the old agents/info_generator.py.
Two changes from the old version:
  1. The script is written from research_agent facts (RAG-grounded) instead of an
     LLM guessing from parametric memory alone.
  2. Image prompts share one "art direction" paragraph prepended to every scene
     prompt, so scene images no longer look like they came from unrelated shoots.
"""

import os
import re
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8192"))

llm = ChatGroq(model_name=GROQ_MODEL, max_tokens=GROQ_MAX_TOKENS)

CHANNEL_NICHE = os.getenv("CHANNEL_NICHE", "AI, AI tooling, and the software industry")
CHANNEL_CTA = os.getenv("CHANNEL_CTA", "Follow for the AI shifts that actually change your job.")

# Spoken delivery lands around 150 words per minute once mastering nudges the
# tempo, so a target length in seconds converts to words at ~2.5 words/second.
WORDS_PER_SECOND = float(os.getenv("SCRIPT_WORDS_PER_SECOND", "2.5"))
DEFAULT_TARGET_WORDS = 125

TONE_GUIDANCE = {
    "educational": "Explain patiently and precisely. Define a term the first time it appears. Favour clarity over punch.",
    "conversational": "Write like you are talking to one person you like. Contractions, asides, a light touch.",
    "punchy": "Short, hard sentences. Every line lands a hit. No warm-up, no wind-down.",
    "storytelling": "Carry one narrative thread the whole way through, with a turn partway that recontextualises the opening.",
    "professional": "Measured and credible. No slang, no hype, no exclamation marks.",
}


def _length_rule(target_words: int) -> str:
    seconds = max(10, round(target_words / WORDS_PER_SECOND))
    minutes = seconds / 60
    pace = "short-form" if seconds <= 90 else "mid-length explainer"
    length = f"about {seconds} seconds" if seconds < 120 else f"about {minutes:.0f} minutes"
    return (
        f"Target {target_words} words — {length} at {pace} pace. This is a hard budget: "
        f"stay within roughly 10% of it, because the visuals and the narration are cut to this length."
    )


SCRIPT_SYSTEM_PROMPT = f"""You write short-form video scripts for a channel about
{CHANNEL_NICHE}. Your audience is developers, founders and tech workers who already
know the basics — never explain what AI is, never open with a dictionary definition.

You will be given researched facts. Every number and claim must come from them.
Do not invent statistics. If the facts are thin, make fewer claims, not vaguer ones.

STRUCTURE — write to this exact shape:
1. HOOK (first sentence, under 12 words). A curiosity gap: a specific number, a
   contrarian claim, or a stake the viewer feels. Viewers decide in ~1.5 seconds,
   so the most interesting thing you know goes FIRST — never build up to it.
2. RE-HOOK (second sentence). Immediately raise the stakes or complicate the hook,
   so the viewer commits past the scroll point.
3. BODY (3-4 sentences). Concrete specifics from the research — real numbers, real
   companies, real roles. Every sentence must add new information; no restating.
   Land at least one detail the audience probably hasn't heard.
4. TAKE (one sentence). Your actual opinion on what it means. This is the single
   thing that makes a channel worth following instead of a news feed — commit to a
   position rather than "only time will tell" or "it depends".
5. PAYOFF + CTA (one sentence). Resolve the curiosity you opened with, then: "{CHANNEL_CTA}"

STYLE:
- Second person. Say "your job", "you'll", not "one might".
- Short declarative sentences. Spoken rhythm, not written prose.
- No filler openers: no "In today's world", "Let's dive in", "Imagine a world".
- No hedging stacks ("might potentially possibly").
- Concrete over abstract: "$2B" beats "a lot of money"; "Klarna cut 700 support roles"
  beats "companies are reducing headcount".

OUTPUT: only the raw spoken script text. No headings, labels, markdown or notes.
"""


def _system_prompt(tone: str | None, target_words: int) -> str:
    """
    The base brief plus the two things the user now controls: how long the script
    should run, and how it should sound. Length used to be hardcoded at 110-140
    words, which is why every video was the same 45-60 seconds.
    """
    prompt = SCRIPT_SYSTEM_PROMPT + f"\n{_length_rule(target_words)}\n"

    guidance = TONE_GUIDANCE.get((tone or "").strip().lower())
    if guidance:
        prompt += f"\nTONE — {tone.strip().lower()}: {guidance}\n"

    # A long script cannot be five sentences; tell it how to use the extra room
    # rather than letting it pad the same structure.
    if target_words > 220:
        prompt += (
            "\nAt this length the BODY carries several distinct points, each with its own "
            "concrete example. Keep the hook, the take and the payoff exactly as specified — "
            "the extra words go into the body, never into a longer intro.\n"
        )
    return prompt


def _format_facts(facts: list[str]) -> str:
    if not facts:
        return "(No research facts available — write from general knowledge, but stay conservative and avoid fabricating specific statistics.)"
    return "\n".join(facts)


def write_script(
    user_prompt: str,
    facts: list[str] | None = None,
    feedback: str | None = None,
    news_date: str | None = None,
    tone: str | None = None,
    target_words: int | None = None,
) -> str:
    """
    Generate a script grounded in `facts` (from research_agent.research_topic).
    If `feedback` is provided (from agents.critic), the LLM revises against it.
    If `news_date` is given (from agents.news_agent — a real, verified publish
    date within the last few days), the script is instructed to actually reference
    the recency truthfully ("this week", not a vague "recently") — otherwise it's
    told explicitly NOT to claim freshness it can't back up.
    """
    facts_block = _format_facts(facts or [])
    user_block = f"""Topic: "{user_prompt}"

Researched facts to ground the script in:
{facts_block}
"""
    if news_date:
        user_block += (
            f"\nThese facts are dated as recently as {news_date} — this is genuinely "
            f"breaking/current news. Reference the recency truthfully (e.g. \"this week\", "
            f"\"just announced\") since it's real, not a generic hook.\n"
        )
    else:
        user_block += (
            "\nNo verified recent-news facts were found for this topic — do NOT claim "
            "this is breaking, new, or \"just happened\". Frame it as an established fact "
            "or ongoing trend instead.\n"
        )

    if feedback:
        user_block += f"\nA reviewer found issues with your previous draft. Revise to address this feedback:\n{feedback}\n"

    from agents.observability import get_langfuse_callbacks

    system_prompt = _system_prompt(tone, target_words or DEFAULT_TARGET_WORDS)
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_block)]
    result = llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
    script = (result.content or "").strip()
    if not script:
        # Reasoning models (e.g. openai/gpt-oss-120b) spend part of max_tokens thinking;
        # when the thinking uses it all, the reply is empty with finish_reason="length".
        # Fail here, loudly, instead of passing an empty script to TTS and video.
        finish_reason = (result.response_metadata or {}).get("finish_reason")
        raise RuntimeError(
            f"The language model returned an empty script (finish_reason={finish_reason}). "
            f"If this is 'length', raise GROQ_MAX_TOKENS (currently {GROQ_MAX_TOKENS}) "
            f"so {GROQ_MODEL} has room to finish thinking and still write the script."
        )
    return script


HOOK_TEXT_SYSTEM = """You write the big on-screen text that burns over the opening
seconds of a short-form video — the thing a scrolling viewer reads before they hear
a single word.

Rules:
- 3 to 6 words. It must be readable at a glance on a phone.
- Carry the same idea as the script's opening line, sharpened. Do not restate the topic.
- Front-load the striking part: a number, a stake, or a contradiction.
- No trailing punctuation except "?" — no periods, no ellipses, no emoji, no quotes.

Output ONLY those words. Nothing else.
"""


def generate_hook_text(user_prompt: str, script: str) -> str:
    """
    The on-screen hook for the opening beat. Derived from the *script's* first line
    rather than the raw topic, so the text a viewer reads matches what they hear —
    the topic string alone ("Will AI kill jobs?") is the query, not a hook.
    """
    from agents.observability import get_langfuse_callbacks

    opening = " ".join((script or "").split()[:40])
    messages = [
        SystemMessage(content=HOOK_TEXT_SYSTEM),
        HumanMessage(content=f'Topic: "{user_prompt}"\n\nScript opening:\n{opening}'),
    ]
    try:
        result = llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
        hook = result.content.strip().strip('"').strip()
        hook = re.sub(r"[.…]+$", "", hook).strip()
        words = hook.split()
        if 2 <= len(words) <= 8:
            return hook
    except Exception as e:
        print(f"PYMSG: [script_writer] hook text generation failed ({e}); using topic.", flush=True)
    return user_prompt


IMAGE_PROMPT_SYSTEM = """You are a visual art director briefing a diffusion model for a
YouTube video's scene images. First define ONE consistent visual style (art style, colour
palette, lighting mood) used across every scene so the video looks like one coherent
production. Then write per-scene prompts.

HARD RULE — the single biggest failure mode you must avoid: diffusion models CANNOT render
legible text, logos, brand marks, or specific software UI. NEVER write a scene as "X logo",
"app icon", "text reading X", "Chrome browser", "[Brand] interface", or anything requiring
recognisable text/wordmarks — the model will render garbled pseudo-text instead, which looks
broken. Every scene must be renderable as a photo/render with ZERO legible text or logos in
frame. Translate a "show the brand/product" idea into a photographable REAL-WORLD SITUATION
instead: not "Google Gemini logo" but "a person's hands typing on a laptop keyboard, glowing
blue screen reflection on their face"; not "NVIDIA logo on chip" but "close-up of a graphics
card's cooling fins and circuit board, dramatic side lighting".

Each scene prompt must lead with the CONCRETE SUBJECT first (what/who, doing what, what
shot type), then any mood/style words last — subject-first gets far more weight from the
model than style-first, and a specific subject beats a generic atmospheric description.

These prompts feed a diffusion model whose text encoder hard-truncates at 77 tokens, and the
style line is prepended to every scene, so keep both within the word limits below.

Compose for a vertical 9:16 phone screen: single clear subject, close or medium shot,
strong central composition. Avoid wide panoramas that fall apart when cropped tall.

For each scene, also decide: does it depict ONE specific, real, named product/device/chip
(e.g. "NVIDIA H100", "iPhone 16 Pro", "Tesla Cybertruck") where a REAL photo would look far
more credible than AI-generated art? If yes, add an ENTITY tag with a good photo-search
query for that exact product — this is also the right move for anything logo/brand-related,
since a real photo can legitimately show a logo where a diffusion render cannot. Most scenes
are conceptual/abstract and should be NONE — only tag a scene when the topic genuinely
centers on one identifiable physical product.

Output format (nothing else, no explanations):
STYLE: <max 8 words: art style, palette, lighting — no full scene descriptions here>
1. <scene prompt, max 26 words: SUBJECT AND ACTION FIRST, shot type, mood last> || ENTITY: <search query or NONE>
2. <scene prompt...> || ENTITY: <search query or NONE>
...(4-6 scenes total)
"""


def generate_image_prompts(
    user_prompt: str,
    script: str | None = None,
    scene_count: int | None = None,
) -> list[dict]:
    """
    Returns a list of {"prompt": <fully-formed image prompt, style-prefixed>,
    "entity": <real-product search query, or None>} — one per scene. `entity` is
    set only when the LLM judged the scene depicts one specific real product a
    photo would serve better than AI art (see agents.real_image_agent).
    """
    context = f'Topic: "{user_prompt}"'
    if script:
        context += f"\n\nScript (for scene ideas):\n{script[:3000]}"

    from agents.observability import get_langfuse_callbacks

    # A longer video needs more scenes or every shot holds far too long. The
    # system prompt's "4-6 scenes" is replaced when the caller knows the length.
    system_prompt = IMAGE_PROMPT_SYSTEM
    if scene_count:
        low = max(3, scene_count - 1)
        system_prompt = re.sub(
            r"\(4-6 scenes total\)",
            f"({low}-{scene_count} scenes total)",
            system_prompt,
        )

    messages = [SystemMessage(content=system_prompt), HumanMessage(content=context)]
    result = llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
    raw = result.content.strip()

    style_line = ""
    scene_lines = []
    entities = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("STYLE:"):
            style_line = line.split(":", 1)[1].strip()
            continue
        if re.match(r"^\d+[\.\)]", line):
            body = re.sub(r"^\d+[\.\)]\s*", "", line)
            if "||" in body:
                scene_text, entity_tag = body.split("||", 1)
                entity_match = re.search(r"ENTITY:\s*(.+)", entity_tag, re.IGNORECASE)
                entity = entity_match.group(1).strip() if entity_match else None
                entity = None if not entity or entity.upper() == "NONE" else entity
            else:
                scene_text, entity = body, None
            scene_lines.append(scene_text.strip())
            entities.append(entity)

    if not scene_lines:
        # fallback: treat every non-empty line as a scene prompt, no entities
        scene_lines = [l for l in raw.splitlines() if l.strip()]
        entities = [None] * len(scene_lines)

    # Subject first, style last: diffusion models (especially few-step turbo
    # variants) weight earlier tokens more heavily, so a style-first prompt lets
    # generic atmosphere words dominate over the actual scene subject. Style is
    # still applied to every scene (visual consistency), just as a lighter,
    # trailing modifier instead of the first thing the model reads.
    prompts = [f"{scene}, {style_line}" if style_line else scene for scene in scene_lines]
    return [{"prompt": p, "entity": e} for p, e in zip(prompts, entities)]
