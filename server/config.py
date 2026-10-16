"""
Central configuration. Every other module imports from here, so there is
exactly one place to change paths, model names, or limits.
Nothing in here is domain-specific: domains live in data/schemas/*.json.

Values come from .env (see .env.example). Swapping LLM provider = editing .env.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Project root = the folder this file lives in. Using pathlib keeps paths
# correct on Windows (backslashes) and Linux/macOS alike.
ROOT_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

# ---------- LLM (hosted, OpenAI-compatible) ----------
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3.6-35b-a3b")
# Vision falls back to the main model when not set.
VISION_MODEL = os.getenv("VISION_MODEL") or LLM_MODEL
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_DISABLE_THINKING = os.getenv("LLM_DISABLE_THINKING", "true").lower() == "true"
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "120"))

# ---------- Agent ----------
AGENT_MAX_ITERATIONS = int(os.getenv("AGENT_MAX_ITERATIONS", "8"))

# ---------- Local data ----------
DATA_DIR = ROOT_DIR / "data"
SCHEMAS_DIR = DATA_DIR / "schemas"    # one JSON file per domain = the schema registry
DOCS_DIR = DATA_DIR / "docs"          # drop PDFs / .txt / .md here
# The React app's own knowledge base (src/docs) is indexed too, so the hosted
# model searches one ChromaDB index that covers both sets of documents.
APP_DOCS_DIR = ROOT_DIR.parent / "src" / "docs"
DOCS_DIRS = [DOCS_DIR] + ([APP_DOCS_DIR] if APP_DOCS_DIR.exists() else [])
UPLOADS_DIR = DATA_DIR / "uploads"    # images saved by /upload-image
REPORTS_DIR = DATA_DIR / "reports"    # files written by generate_report
CHROMA_DIR = DATA_DIR / "chroma"      # persistent vector store
DB_PATH = DATA_DIR / "universal_db.json"  # all records for all schemas

# ---------- RAG ----------
# bge-small has a 512-token window, so 500-token chunks are embedded whole
# (all-MiniLM-L6-v2 would silently truncate them at 256).
EMBED_MODEL = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
CHUNK_TOKENS = 500
CHUNK_OVERLAP = 50
CHROMA_COLLECTION = "universal_docs"

for _d in (SCHEMAS_DIR, DOCS_DIR, UPLOADS_DIR, REPORTS_DIR, CHROMA_DIR):
    _d.mkdir(parents=True, exist_ok=True)
