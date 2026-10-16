"""
The agent loop: plain Python, no framework, so every step is visible.

  1. messages = [system prompt] + history + [user message (+ image)]
  2. call the LLM with ALL tools available
  3. if it asks for tools: run each one, append the results, go to 2
     (max AGENT_MAX_ITERATIONS rounds)
  4. otherwise its text is the final reply

run_agent_stream() YIELDS each step as an event the moment it happens. The
frontend reads these live to draw the AI TRACE panel. run_agent() is the
same thing collected into one {reply, trace} response.
Trace event: {type, name, args, result, timestamp} where type is one of
llm_call | tool_call | tool_result | retrieval | image_attached | error.
"""
import json
import re
import time
from datetime import date, datetime

import config
from backend import llm
from backend.tool_schemas import build_tool_schemas
from backend.tools import execute_tool

# ONE stable system prompt. It names no domain and contains no examples or
# field lists: the model discovers what exists through list_schemas /
# describe_schema, so the prompt never grows when domains are added.
SYSTEM_PROMPT = """You are a universal AI layer for business software of any kind. You work with whatever systems are registered as schemas; never assume what they are. Today is {today}.

You have three capability classes:
1. Structured data through tools: list_schemas and describe_schema to discover what exists, then search_records, create_record, update_record, delete_record, get_analytics and generate_report.
2. Unstructured knowledge through search_documents, which searches the organisation's documents.
3. Visual input through analyze_image, which reads uploaded images.

Rules:
- NEVER invent data. Every fact, number, ID or policy statement must come from a tool result. If tools find nothing, say so.
- If you don't know which schema or entity holds the data, call list_schemas first. Call describe_schema before creating or updating records in an entity you haven't described yet.
- Questions can span several schemas. Follow ID fields (fields with a ref) to join records across them.
- Use search_documents when the question is about knowledge, policy or procedure that is not in the structured data, and name the source document.
- When an image is uploaded, call analyze_image first, then chain to other tools if action is needed, reusing IDs from matched_records.
- Only delete records when the user explicitly asks.
- If a tool returns an error, fix the arguments and retry.
- Call tools only through the tools API. Never write tool-call JSON or function syntax in your reply.
- Be concise: short answers, bullets or small tables, no long explanations."""

IMAGE_ID_RE = re.compile(r"\bimg_[a-f0-9]{8,}\b")
MAX_TOOL_RESULT_CHARS = 12000  # cap what goes back into the context window


def _now() -> str:
    return datetime.now().isoformat(timespec="milliseconds")


def user_message(text: str, image_ids: list[str]) -> dict:
    """Plain text, or OpenAI multimodal content when the message references uploaded images."""
    if not image_ids:
        return {"role": "user", "content": text}
    parts = [{"type": "text", "text": f"{text}\n\n[Uploaded image ids: {', '.join(image_ids)}]"}]
    for img in image_ids:
        path = next(config.UPLOADS_DIR.glob(f"{img}.*"), None)
        if path:  # inject the actual pixels so the model can see the image too
            parts.append({"type": "image_url", "image_url": {"url": llm.image_to_data_url(path)}})
    return {"role": "user", "content": parts}


def _assistant_dict(msg) -> dict:
    """Convert the SDK message object back into the plain dict the API expects in history."""
    out = {"role": "assistant", "content": msg.content or ""}
    if msg.tool_calls:
        out["tool_calls"] = [{"id": tc.id, "type": "function",
                              "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"}}
                             for tc in msg.tool_calls]
    return out


def run_agent_stream(user_message: str, history: list[dict] | None = None, image_id: str | None = None):
    """Generator of trace events. The last event is {"type": "final", "reply": ...}."""
    image_ids = list(dict.fromkeys(([image_id] if image_id else []) + IMAGE_ID_RE.findall(user_message)))
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(today=date.today().isoformat())}]
    # History is text-only: old images aren't re-sent, which keeps requests small.
    messages += [{"role": h["role"], "content": str(h["content"])} for h in (history or [])
                 if h.get("role") in ("user", "assistant") and h.get("content")]
    messages.append(user_message(user_message, image_ids))
    if image_ids:
        yield {"type": "image_attached", "timestamp": _now(), "image_ids": image_ids}

    try:
        tools = build_tool_schemas()
        for iteration in range(1, config.AGENT_MAX_ITERATIONS + 1):
            t0 = time.perf_counter()
            msg = llm.chat(messages, tools)
            yield {"type": "llm_call", "timestamp": _now(), "iteration": iteration,
                   "ms": round((time.perf_counter() - t0) * 1000),
                   "requested_tools": [tc.function.name for tc in (msg.tool_calls or [])]}

            if not msg.tool_calls:  # no tools requested -> this is the answer
                yield {"type": "final", "timestamp": _now(), "reply": (msg.content or "").strip()}
                return

            messages.append(_assistant_dict(msg))
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args, result = {}, {"error": "Arguments were not valid JSON. Retry with valid JSON."}
                else:
                    result = None
                yield {"type": "tool_call", "timestamp": _now(), "name": name, "args": args, "call_id": tc.id}

                t0 = time.perf_counter()
                result = result or execute_tool(name, args)
                ms = round((time.perf_counter() - t0) * 1000)
                # RAG results get their own trace type so the UI can show sources distinctly.
                kind = "retrieval" if name == "search_documents" else "tool_result"
                yield {"type": kind, "timestamp": _now(), "name": name, "ms": ms, "result": result, "call_id": tc.id}

                messages.append({"role": "tool", "tool_call_id": tc.id,
                                 "content": json.dumps(result, default=str)[:MAX_TOOL_RESULT_CHARS]})

        # Hit the iteration cap: ask once more WITHOUT tools to force a final answer.
        msg = llm.chat(messages + [{"role": "user", "content": "Tool budget reached. Answer now with what you have."}])
        yield {"type": "final", "timestamp": _now(), "reply": (msg.content or "").strip()}

    except llm.LLMNotConfigured as e:
        yield {"type": "error", "timestamp": _now(), "error": str(e)}
        yield {"type": "final", "timestamp": _now(), "reply": f"⚠️ {e}"}
    except Exception as e:  # network/auth/model errors: show them instead of a blank screen
        yield {"type": "error", "timestamp": _now(), "error": f"{type(e).__name__}: {e}"}
        yield {"type": "final", "timestamp": _now(), "reply": f"⚠️ LLM call failed: {type(e).__name__}: {e}"}


def run_agent(user_message: str, history: list[dict] | None = None, image_id: str | None = None) -> dict:
    """Non-streaming version: returns {reply, trace} in one JSON response."""
    trace, reply = [], ""
    for event in run_agent_stream(user_message, history, image_id):
        if event["type"] == "final":
            reply = event["reply"]
        else:
            trace.append(event)
    return {"reply": reply, "trace": trace}
