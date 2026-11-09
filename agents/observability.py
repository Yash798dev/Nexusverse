"""
agents/observability.py — Optional Langfuse tracing for every LLM call in the pipeline.

If LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are set, every agent (research, script
writer, critic) attaches this callback to its LLM invocations, giving a full trace
of prompts, tool calls, latencies, and token usage per job in the Langfuse UI.
If not configured, this is a no-op — nothing about the pipeline depends on it.
"""

import os

_handler = None
_checked = False


def get_langfuse_callbacks() -> list:
    global _handler, _checked
    if _checked:
        return [_handler] if _handler else []
    _checked = True

    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        return []

    try:
        from langfuse.langchain import CallbackHandler
        _handler = CallbackHandler()
    except Exception as e:
        print(f"PYMSG: [observability] Langfuse unavailable, tracing disabled: {e}", flush=True)
        _handler = None

    return [_handler] if _handler else []
