"""
agents/news_agent.py — Latest-news research, separate from the general research_agent.

The general research_agent.py (Wikipedia/Arxiv/DuckDuckGo/Tavily) is built for
grounding evergreen explainer scripts and has no concept of recency — Wikipedia
in particular skews toward settled, months/years-old information. For "what
happened this week in AI" content, that's the wrong tool.

This queries Tavily's and DuckDuckGo's dedicated NEWS endpoints (not general web
search), which return actual publish timestamps, and filters out anything older
than MAX_AGE_DAYS. Facts here are always dated, so the script writer can say
"this week" truthfully instead of guessing.
"""

import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

MAX_AGE_DAYS = int(os.getenv("NEWS_MAX_AGE_DAYS", "7"))
MAX_ARTICLES = int(os.getenv("NEWS_MAX_ARTICLES", "10"))


def _parse_date(raw: str) -> datetime | None:
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw[: len(fmt) + 6], fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _fetch_tavily_news(query: str) -> list[dict]:
    if not os.getenv("TAVILY_API_KEY"):
        return []
    try:
        from tavily import TavilyClient

        client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
        result = client.search(query, topic="news", time_range="week", max_results=MAX_ARTICLES)
        articles = []
        for item in result.get("results", []):
            articles.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": (item.get("content") or "")[:400],
                "published": item.get("published_date"),
                "source": "Tavily News",
            })
        return articles
    except Exception as e:
        print(f"PYMSG: [news_agent] Tavily news search failed: {e}", flush=True)
        return []


def _fetch_ddgs_news(query: str) -> list[dict]:
    try:
        from ddgs import DDGS

        results = DDGS().news(query, max_results=MAX_ARTICLES, timelimit="w")
        articles = []
        for item in results:
            articles.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": (item.get("body") or "")[:400],
                "published": item.get("date"),
                "source": item.get("source") or "DuckDuckGo News",
            })
        return articles
    except Exception as e:
        print(f"PYMSG: [news_agent] DuckDuckGo news search failed: {e}", flush=True)
        return []


def research_latest_news(topic: str) -> dict:
    """
    Returns:
      {
        "facts": ["<dated fact> — Source: <outlet>, <date> (<url>)", ...],
        "sources": ["<outlet>: <title> (<url>)", ...],
        "most_recent_date": "YYYY-MM-DD" or None,
        "is_stale": bool,  # True if nothing found inside MAX_AGE_DAYS
      }

    Never raises: an empty/failed search returns is_stale=True so the caller
    (script_writer) can fall back to evergreen framing rather than fabricate a
    "breaking news" angle with no real recent facts behind it.
    """
    raw_articles = _fetch_tavily_news(topic) + _fetch_ddgs_news(topic)

    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    dated_articles = []
    for a in raw_articles:
        dt = _parse_date(a.get("published"))
        if dt is None or dt < cutoff:
            continue
        a["_dt"] = dt
        dated_articles.append(a)

    # dedupe by URL, keep most recent first
    seen_urls = set()
    deduped = []
    for a in sorted(dated_articles, key=lambda x: x["_dt"], reverse=True):
        if a["url"] in seen_urls:
            continue
        seen_urls.add(a["url"])
        deduped.append(a)

    if not deduped:
        print(f"PYMSG: [news_agent] No articles found within {MAX_AGE_DAYS} days for {topic!r}", flush=True)
        return {"facts": [], "sources": [], "most_recent_date": None, "is_stale": True}

    facts, sources = [], []
    for a in deduped[:MAX_ARTICLES]:
        date_str = a["_dt"].strftime("%Y-%m-%d")
        snippet = a["snippet"].strip().replace("\n", " ")
        facts.append(f"{a['title']}: {snippet} — Source: {a['source']}, {date_str} ({a['url']})")
        sources.append(f"{a['source']}: {a['title']} ({a['url']})")

    print(f"PYMSG: [news_agent] Found {len(deduped)} recent articles for {topic!r}, newest {deduped[0]['_dt'].strftime('%Y-%m-%d')}", flush=True)
    return {
        "facts": facts,
        "sources": sources,
        "most_recent_date": deduped[0]["_dt"].strftime("%Y-%m-%d"),
        "is_stale": False,
    }
