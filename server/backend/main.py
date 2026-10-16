"""
FastAPI server for the Acme Assistant React app. Start it from the server/ folder:

    uvicorn backend.main:app --port 8000

The React app (npm run dev) reaches it through Vite's /api proxy, see
vite.config.ts. The hosted LLM's API key lives only here, never in the browser.

Endpoints
  GET  /tools/schemas the 10 universal tool definitions (sent to the model by the app)
  POST /llm/chat      one model turn for the app's agent loop (adds the system prompt + images)
  GET  /health        config + data status (no tokens spent)
  POST /chat          {message, history, image_id} -> {reply, trace}
  POST /chat/stream   same, but streams trace events live (NDJSON)
  POST /upload-image  multipart image -> {image_id}
  POST /ingest        (re)index data/docs/ into ChromaDB
  GET  /schemas       all schemas + entities + record counts (Schema Explorer)
  GET  /schemas/{name} full field definitions of one schema
  POST /reset-demo    regenerate data/universal_db.json from the schema files
  POST /tools/{name}  run one tool directly, no LLM (for testing without a key)
"""
import json
import uuid
from datetime import date

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import DB_PATH, DOCS_DIRS, REPORTS_DIR, UPLOADS_DIR
from backend import llm
from backend.agent import SYSTEM_PROMPT, user_message, run_agent, run_agent_stream
from backend import schemas, store
from backend.seed import seed_all
from backend.tool_schemas import build_tool_schemas
from backend.tools import TOOL_FUNCTIONS, execute_tool, list_schemas

app = FastAPI(title="Universal AI Layer", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# Uploaded images and generated reports are downloadable from the browser.
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/reports", StaticFiles(directory=REPORTS_DIR), name="reports")

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB; bigger images cost a lot of tokens anyway


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []      # [{role: "user"|"assistant", content: "..."}]
    image_id: str | None = None   # optional; ids typed in the message are detected too


@app.on_event("startup")
def _startup():
    store.load()  # seeds data/universal_db.json on first run


class LLMRequest(BaseModel):
    messages: list[dict]               # chat history from the app, without a system message
    tools: list[dict] | None = None    # universal tools + the app's own routed tools
    app_instructions: str | None = None  # app-specific notes appended to the system prompt


@app.get("/")
def index():
    return {"service": "Acme Assistant server", "app": "run `npm run dev` in the project root", "docs": "/docs"}


@app.get("/tools/schemas")
def tool_schemas():
    return build_tool_schemas()


@app.post("/llm/chat")
def llm_chat(req: LLMRequest):
    """
    One round-trip to the hosted model, for the agent loop that runs in the React app.
    The server adds the single universal system prompt, and turns any `image_ids`
    on a user message into OpenAI multimodal content, so images never travel as
    base64 through the browser and the API key never leaves this process.
    """
    system = SYSTEM_PROMPT.format(today=date.today().isoformat())
    if req.app_instructions:
        system += "\n\n" + req.app_instructions
    messages = [{"role": "system", "content": system}]
    for m in req.messages:
        ids = m.pop("image_ids", None)
        messages.append(user_message(m["content"], ids) if ids and m.get("role") == "user" else m)
    try:
        msg = llm.chat(messages, req.tools)
    except llm.LLMNotConfigured as e:
        raise HTTPException(503, str(e))
    except Exception as e:  # auth, model name, network: show the provider's message in the app
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    calls = [{"id": tc.id, "name": tc.function.name, "arguments": tc.function.arguments or "{}"}
             for tc in (msg.tool_calls or [])]
    return {"content": msg.content or "", "tool_calls": calls}


@app.get("/health")
def health():
    from backend import rag  # lazy: avoids loading chromadb before it's needed
    return {"status": "ok", "llm": llm.ping(), "db": {"path": str(DB_PATH), "exists": DB_PATH.exists()},
            "schemas": list(schemas.registry()),
            "rag": rag.stats(), "docs_in_folders": sum(1 for d in DOCS_DIRS for p in d.rglob("*") if p.is_file())}


@app.post("/chat")
def chat(req: ChatRequest):
    # Plain `def` (not async): FastAPI runs it in a thread pool, so slow LLM calls don't block the server.
    return run_agent(req.message, req.history, req.image_id)


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    # Newline-delimited JSON: one trace event per line, sent the moment it happens.
    def lines():
        for event in run_agent_stream(req.message, req.history, req.image_id):
            yield json.dumps(event, default=str) + "\n"
    return StreamingResponse(lines(), media_type="application/x-ndjson")


@app.post("/upload-image")
async def upload_image(file: UploadFile = File(...)):
    ext = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, f"Unsupported type {file.content_type}. Use PNG, JPEG, WEBP or GIF.")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Image too large (max 10 MB).")
    image_id = f"img_{uuid.uuid4().hex[:12]}"
    (UPLOADS_DIR / f"{image_id}{ext}").write_bytes(data)
    return {"image_id": image_id, "filename": file.filename, "bytes": len(data), "url": f"/uploads/{image_id}{ext}"}


@app.post("/ingest")
def ingest():
    from backend import rag
    try:
        return rag.ingest_docs()
    except Exception as e:
        raise HTTPException(500, f"Ingest failed: {type(e).__name__}: {e}")


@app.get("/schemas")
def get_schemas():
    return list_schemas()


@app.get("/schemas/{name}")
def get_schema(name: str):
    try:
        return schemas.describe(name)
    except schemas.SchemaError as e:
        raise HTTPException(404, str(e))


@app.post("/reset-demo")
def reset_demo():
    """Regenerate ALL data from the schema files (also picks up newly added schemas)."""
    db = seed_all()
    return {"reset": True, "counts": {s: {e: len(r) for e, r in ents.items()} for s, ents in db.items()}}


@app.post("/tools/{name}")
def run_tool(name: str, args: dict):
    if name not in TOOL_FUNCTIONS:
        raise HTTPException(404, f"Unknown tool. Available: {list(TOOL_FUNCTIONS)}")
    return execute_tool(name, args)
