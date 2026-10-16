"""
Thin wrapper around the hosted LLM (the ONLY part of the system that is not local). Uses the official `openai` SDK pointed at
ANY OpenAI-compatible base URL (DashScope, OpenRouter, OpenAI, Together, ...).
Switching provider = changing LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env.

Two entry points:
  chat(messages, tools)        -> one model turn (may contain tool_calls)
  analyze_image(path, intent)  -> structured JSON extraction from an image
"""
import base64
import json
import mimetypes
import re
from functools import lru_cache
from pathlib import Path

from openai import OpenAI

import config


class LLMNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def client() -> OpenAI:
    if not config.LLM_API_KEY or config.LLM_API_KEY == "your-key-here":
        raise LLMNotConfigured("No LLM_API_KEY set. Copy .env.example to .env and add your key (see README).")
    return OpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY, timeout=config.LLM_TIMEOUT_SECONDS)


def _extra_body() -> dict | None:
    # Qwen3-family on DashScope: thinking mode must be OFF for non-streaming calls.
    # Sent as extra_body because it's not a standard OpenAI parameter.
    return {"enable_thinking": False} if config.LLM_DISABLE_THINKING else None


def chat(messages: list[dict], tools: list[dict] | None = None):
    """One round-trip to the model. Returns the assistant message object."""
    kwargs = dict(model=config.LLM_MODEL, messages=messages, temperature=config.LLM_TEMPERATURE)
    if tools:
        kwargs.update(tools=tools, tool_choice="auto")
    if body := _extra_body():
        kwargs["extra_body"] = body
    resp = client().chat.completions.create(**kwargs)
    return resp.choices[0].message


def image_to_data_url(path: Path) -> str:
    """Encode an image file as a base64 data URL: the OpenAI multimodal input format."""
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(Path(path).read_bytes()).decode()}"


# Domain-neutral on purpose: the image could be an invoice, a student ID, a
# POS receipt or a chart. The model decides the type; the agent decides the action.
VISION_PROMPT = """You extract structured data from images for business software. Intent: {intent}
Reply with ONE JSON object only, no prose:
{{"image_type": "invoice|receipt|id_card|form|student_record|product_photo|chart|screenshot|other",
  "summary": "one sentence",
  "extracted": {{ every relevant field with clear snake_case keys, e.g. vendor_name, document_number,
                 date (YYYY-MM-DD), currency, total (number), tax (number), payment_method,
                 line_items [{{description, quantity, unit_price, amount}}], person_name, id_number;
                 for charts: title, series, notable_values }},
  "confidence": 0.0-1.0,
  "suggested_actions": ["short actions, e.g. record as expense / create invoice"]}}"""


def _parse_json(text: str) -> dict:
    """Models sometimes wrap JSON in ```fences``` or add a sentence; pull out the object."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {"image_type": "unknown", "summary": text[:500], "extracted": {}, "parse_error": True}


def analyze_image(path: Path, intent: str) -> dict:
    """Separate, focused vision call so extraction quality doesn't depend on the chat context."""
    messages = [{"role": "user", "content": [
        {"type": "text", "text": VISION_PROMPT.format(intent=intent)},
        {"type": "image_url", "image_url": {"url": image_to_data_url(path)}},
    ]}]
    kwargs = dict(model=config.VISION_MODEL, messages=messages, temperature=0)
    if body := _extra_body():
        kwargs["extra_body"] = body
    resp = client().chat.completions.create(**kwargs)
    return _parse_json(resp.choices[0].message.content)


def ping() -> dict:
    """Used by /health: confirms config without spending tokens."""
    return {"base_url": config.LLM_BASE_URL, "model": config.LLM_MODEL, "vision_model": config.VISION_MODEL,
            "api_key_set": bool(config.LLM_API_KEY) and config.LLM_API_KEY != "your-key-here"}
