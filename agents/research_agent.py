"""
research_agent.py — Grounds a video topic in real facts before any script is written.

Runs a LangGraph ReAct agent over Wikipedia, Arxiv, DuckDuckGo, and Tavily search
tools, then asks it to distill everything into a compact set of citable facts.
This is the fix for the old pipeline's "just ask the LLM" script generation,
which had no real research loop despite binding tools that were never invoked.
"""

import os
import re
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage
from langchain_community.tools import WikipediaQueryRun, DuckDuckGoSearchRun, ArxivQueryRun
from langchain_community.utilities import WikipediaAPIWrapper, ArxivAPIWrapper
from langgraph.prebuilt import create_react_agent

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8192"))

_llm = ChatGroq(model_name=GROQ_MODEL, max_tokens=GROQ_MAX_TOKENS)

_wiki = WikipediaQueryRun(
    api_wrapper=WikipediaAPIWrapper(top_k_results=3, doc_content_chars_max=2000)
)
_arxiv = ArxivQueryRun(
    api_wrapper=ArxivAPIWrapper(top_k_results=2, doc_content_chars_max=2000)
)
_ddg = DuckDuckGoSearchRun()

_tools = [_wiki, _arxiv, _ddg]

if os.getenv("TAVILY_API_KEY"):
    from langchain_community.tools import TavilySearchResults
    _tools.append(TavilySearchResults(max_results=5))

_researcher = create_react_agent(_llm, _tools)

_RESEARCH_INSTRUCTIONS = """You are a research assistant preparing source material for a YouTube video.
Topic: "{topic}"

Use your tools (Wikipedia, Arxiv, DuckDuckGo, Tavily) to gather accurate, current facts,
statistics, historical context, and notable examples about this topic. Make at least 2
tool calls before answering so the facts are actually grounded, not guessed.

When you are done researching, reply with ONLY a numbered list of 8-12 distinct facts.
Each fact must be a single line in this exact format:
N. <fact text> — Source: <tool/site name>

Do not include any preamble, headings, or closing remarks — only the numbered list.
"""


def research_topic(topic: str) -> dict:
    """
    Runs the ReAct research agent for `topic` and returns:
      {
        "facts": [ "fact text — Source: X", ... ],   # for prompting downstream LLMs
        "sources": [ "X", "Y", ... ],                  # deduped source names, for transparency
        "raw": "<agent's raw final text>"
      }
    Never raises for empty/failed research — falls back to an empty fact set so the
    script writer can still proceed (unlike hard-blocking tool errors would).
    """
    from agents.observability import get_langfuse_callbacks

    prompt = _RESEARCH_INSTRUCTIONS.format(topic=topic)
    try:
        result = _researcher.invoke(
            {"messages": [HumanMessage(content=prompt)]},
            config={"callbacks": get_langfuse_callbacks()},
        )
        final_message = result["messages"][-1]
        raw = final_message.content if hasattr(final_message, "content") else str(final_message)
    except Exception as e:
        return {"facts": [], "sources": [], "raw": f"[research_agent failed: {e}]"}

    facts = []
    sources = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or not re.match(r"^\d+[\.\)]", line):
            continue
        facts.append(line)
        m = re.search(r"Source:\s*(.+)$", line)
        if m:
            src = m.group(1).strip()
            if src not in sources:
                sources.append(src)

    return {"facts": facts, "sources": sources, "raw": raw}
