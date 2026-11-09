"""
critic.py — Reviews a generated script against the research facts and engagement
rules, and decides whether the script writer needs to revise.

Uses a small local Ollama model by default (cheap, no extra Groq API cost for a
step that runs in a loop) with automatic fallback to Groq if Ollama isn't
reachable. Controlled by USE_LOCAL_CRITIC=true|false in .env.
"""

import os
import json
import re
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage

load_dotenv()

USE_LOCAL_CRITIC = os.getenv("USE_LOCAL_CRITIC", "true").lower() == "true"
OLLAMA_CRITIC_MODEL = os.getenv("OLLAMA_CRITIC_MODEL", "gemma4:e4b")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

CRITIC_SYSTEM_PROMPT = """You are a strict short-form video script editor for a channel
about AI and the software industry. You are given the topic, the research facts the
script should be grounded in, and the drafted script.

Check for:
1. Any claim/statistic NOT supported by the research facts (possible hallucination).
2. Weak hook: the first sentence must lead with a specific number, a contrarian claim,
   or a concrete stake — not a definition, a generic statement, or a slow build-up.
3. No clear opinion/take: the script must commit to a position, not end in hedging
   like "only time will tell" or "it depends".
4. Missing call-to-action in the closing line.
5. Filler openers ("In today's world", "Let's dive in", "Imagine a world") or vague
   abstractions where a concrete number or named company was available in the facts.
6. Script length outside 110-150 words.

Respond with ONLY compact JSON, no other text:
{"pass": true|false, "issues": ["issue 1", "issue 2"]}
"""


def _get_llm():
    if USE_LOCAL_CRITIC:
        try:
            from langchain_ollama import ChatOllama
            return ChatOllama(model=OLLAMA_CRITIC_MODEL, temperature=0)
        except Exception:
            pass
    from langchain_groq import ChatGroq
    # Reasoning models spend output tokens thinking before the JSON verdict;
    # 1024 left nothing for the answer.
    return ChatGroq(model_name=GROQ_MODEL, max_tokens=4096)


def critique_script(user_prompt: str, facts: list[str], script: str) -> dict:
    """
    Returns {"passed": bool, "issues": [str, ...]}.
    On any failure to get/parse a verdict, defaults to passed=True so a flaky
    critic model never blocks the whole pipeline indefinitely.
    """
    facts_block = "\n".join(facts) if facts else "(no research facts provided)"
    user_block = f"""Topic: "{user_prompt}"

Research facts:
{facts_block}

Drafted script:
{script}
"""
    try:
        from agents.observability import get_langfuse_callbacks

        llm = _get_llm()
        messages = [SystemMessage(content=CRITIC_SYSTEM_PROMPT), HumanMessage(content=user_block)]
        result = llm.invoke(messages, config={"callbacks": get_langfuse_callbacks()})
        raw = result.content.strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group(0) if match else raw)
        return {"passed": bool(data.get("pass", True)), "issues": data.get("issues", [])}
    except Exception as e:
        return {"passed": True, "issues": [f"critic_unavailable: {e}"]}
