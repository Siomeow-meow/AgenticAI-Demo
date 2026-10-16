# Acme Assistant (with the Universal AI Layer)

A React + TypeScript (Vite) assistant with three ways to answer:

| Model (top-right picker) | Runs where | What it can do |
|---|---|---|
| **Hosted · qwen3.6-35b-a3b** | Hosted API through the local Python server in `server/` | The 10 universal tools over 6 business systems (ERP, POS, CRM, SIS, HRIS, Support), ChromaDB document search, **image understanding**, plus the app's own tools. You don't need a GPU. |
| Ollama models | Your machine (Ollama) | The app's 135 browser tools, keyword RAG, attached files |
| Basic (no AI model) | Your browser | Keyword rules only |

The hosted mode adds three capabilities:

1. **Tool calling across any system.** `list_schemas` → `describe_schema` → `search_records`, `create_record`, `update_record`, `delete_record`, `get_analytics`, `generate_report`. Every system is a JSON file in `server/data/schemas/`, so adding a system takes no code.
2. **RAG.** `search_documents` searches one ChromaDB index built from `server/data/docs/` *and* this app's `src/docs/`, with CPU embeddings.
3. **Vision.** Attach a receipt, invoice, chart or screenshot. `analyze_image` extracts it and links it to existing records, and the model can then create records from it.

The **AI Trace** panel next to the chat shows every model round, tool call, result and retrieval live. The **Schemas** tab shows the registry the model reads.

```
 Browser (React app, npm run dev)                    server/ (Python, uvicorn :8000)
 ┌───────────────────────────────┐   /api proxy    ┌──────────────────────────────────┐
 │ Chat + AI Trace + Schemas tab │ ──────────────► │ /llm/chat  adds system prompt,    │──► Hosted LLM
 │ agent loop (src/ai/hosted.ts) │                 │            images, API key        │   (DashScope or any
 │ 135 browser tools (calc, IT…) │                 │ /tools/*   10 universal tools     │    OpenAI-compatible)
 └───────────────────────────────┘                 │ schema registry · JSON store      │
                                                   │ ChromaDB + bge-small (CPU)        │
                                                   └──────────────────────────────────┘
```

The API key lives only in `server/.env`. The browser never sees it.

## Setup (Windows, cmd)

You need Node 20 or newer and Python 3.10 or newer.

**1. The server (first terminal)**

```bat
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `server\.env` and set `LLM_API_KEY` (see "Getting a free key" below). Then start the server:

```bat
uvicorn backend.main:app --port 8000
```

**2. The app (second terminal, project root)**

```bat
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173). Pick **Hosted · qwen3.6-35b-a3b** in the model menu, open **Schemas**, and click **Ingest documents** once. The first ingest downloads the embedding model (about 130 MB).

`npm run preview` (after `npm run build`) uses the same `/api` proxy.

### Getting a free key (Alibaba Cloud Model Studio / DashScope)

1. Create an Alibaba Cloud account (international: alibabacloud.com), open **Model Studio**, and activate it. New accounts usually get a free token quota. The console shows how much.
2. Under **API Keys**, create a key and put it in `server\.env` as `LLM_API_KEY`.
3. Set `LLM_BASE_URL` for your region: international `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, mainland China `https://dashscope.aliyuncs.com/compatible-mode/v1`.
4. If `qwen3.6-35b-a3b` isn't listed for your region, set `LLM_MODEL` to a Qwen model with tool calling. If that model can't read images, also set `VISION_MODEL` to a Qwen VL model.

To use another provider, edit the same three lines in `server\.env` (OpenRouter, OpenAI, a company gateway…). Set `LLM_DISABLE_THINKING=false` for anything that isn't Qwen3 on DashScope.

## Demo in 3 minutes (Hosted model)

1. **Cross-system:** *"Show me all students with unpaid tuition and their parents' contact info."* The trace shows `list_schemas`, `describe_schema`, a search of `sis.students`, then a search of `crm.contacts`, joined on `student_id`.
2. **RAG:** *"What's our data retention policy for customer records?"* The trace shows a RETRIEVAL from `retention_policy.md`, and the source chip appears under the answer.
3. **Vision + chain:** Attach `server/data/samples/sample_receipt.png` and send *"Process this."* You'll see `analyze_image` (matched to vendor VEN-001), then `create_record` for an invoice and a purchase order, then `generate_report`.
4. **Zero-code new system:** `copy server\data\examples\lms.json server\data\schemas\`, then reload the Schemas tab. LMS appears with data. Ask *"Which employees have overdue training?"*

Use **Reset demo data** on the Schemas tab between run-throughs.

## How the pieces fit

| File | Role |
|---|---|
| `src/ai/hosted.ts` | Hosted agent loop: sends the 10 universal tools plus 3 routed browser tools, runs each call where it lives, and emits trace events |
| `src/components/TracePanel.tsx` | Live AI Trace panel |
| `src/components/SchemasView.tsx` | Schema explorer, ingest and reset |
| `src/ai/files.ts` | Image attachments upload to the server (other files work as before) |
| `vite.config.ts` | `/api` → `http://127.0.0.1:8000` proxy |
| `server/backend/main.py` | FastAPI: `/llm/chat`, `/tools/*`, `/schemas`, `/ingest`, `/upload-image`, `/reset-demo` |
| `server/backend/tools.py` | The 10 universal tools (no domain-specific code) |
| `server/data/schemas/*.json` | The systems: erp, pos, crm, sis, hris, support |

In hosted mode, the server's schema data replaces the browser's sample company data (`lookup_employee`, `check_inventory`…). Those tools still work with Ollama and Basic mode, and attached files still work in every mode.

## Scripts

- `npm run dev`: start the app with hot reload
- `npm run build`: type-check and build to `dist/`
- `npm run lint`: ESLint
- `python -m backend.seed` (in `server/`): regenerate the demo data
- http://localhost:8000/docs: try every server endpoint, including `POST /tools/{name}`, without a key
