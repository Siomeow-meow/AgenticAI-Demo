# Acme Assistant

A React + TypeScript (Vite) AI assistant that runs entirely on your machine through [Ollama](https://ollama.com): 177 tools in 28 categories, advanced RAG over a knowledge base, long-term memory, and file and image understanding. No account, API key or server is needed.

The assistant tunes itself to the model you have installed (context size, tools per question, step limit, reasoning), so a small model on a laptop and a large model on a workstation both work. If the model you last used isn't installed on this machine, it picks the most capable installed model that supports tools.

## Setup

You need Node 20 or newer and [Ollama](https://ollama.com).

```bat
ollama pull qwen2.5:7b
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173) and pick a model in the box next to the send button. Pick one that shows **tools** next to its name, because the assistant relies on tool calling. Small models (3B) work but are less reliable than 7B and up. The **Models** tab can pull and delete models.

### Optional: semantic search

`ollama pull nomic-embed-text`, then switch on semantic search in the **Knowledge** tab. Keyword search always works without it.

## What the assistant can do

**Toolsets** (see the **Toolkit** tab for every tool with an example and a "Try it" button)

| Pattern | Tools |
|---|---|
| Maths | `calculator` (functions, constants, factorials), `solve_equation`, `derivative`, `integral`, `series_sum`, `matrix_op`, `formula_eval`, plus statistics, finance and more |
| Search and data | knowledge base, imported tables (`query_dataset`, `aggregate_dataset`), company records, `search_everything` |
| Memory and state | `remember`, `recall`, `forget`, `summarize_text`. Remembered facts are shown to the model every turn, and older chat is summarized automatically |
| Workflow | `assign_task`, `schedule_reminder`, `list_reminders`, notes and tasks |
| Communication | `compose_email` and `compose_sms` (draft and open in your own app, nothing is sent by itself), `send_notification`, `post_webhook` (Slack, Teams, Discord) |
| Files | `write_file` and `export_dataset` (downloads), upload PDF, Word, Excel, CSV, PowerPoint, JSON and text |
| Code | `run_javascript` in a sandboxed worker: no network, no storage, 3 second limit |
| Vision | `analyze_image`: describe, OCR, read charts, extract receipt fields. Needs a vision model: `ollama pull qwen2.5vl:3b` |
| Web and APIs | `fetch_url`, `scrape_page`, `http_request`, plus weather, Wikipedia, currency and more. All need the **Internet tools** switch |
| Agent tools | `list_tools`, `describe_tool`, `chain_tools` (run several tools as one workflow) |

**Retrieval (RAG)**

| Technique | How it is done |
|---|---|
| Hybrid | Keyword (TF-IDF) plus optional embeddings, merged with reciprocal rank fusion |
| Contextual retrieval | The nearest heading is indexed with every chunk |
| Graph RAG | An entity graph (things mentioned together) finds related passages; `explore_graph` shows it |
| Multi-representation | Each document also has a summary view (title, headings, first sentences) that boosts its chunks |
| Reranking | Phrase, word-pair, coverage and heading matches re-score the candidates |
| Parent-child | Small chunks are searched; the neighbouring text is returned with each match |
| Agentic | The model decides when to search, and which tool to use |
| Accurate mode (`research_knowledge_base`) | Query rewriting, HyDE (search with a hypothetical answer), the model grades each passage (Self-RAG), a broader retry if nothing fits, then a Wikipedia fallback (Corrective RAG) |
| Recursive (`deep_research`) | Search, work out what is still missing, search again, up to 3 rounds |
| Federated (`search_everything`) | Documents, company data, tables, notes, tasks, memory and Wikipedia in one call |

`search_knowledge_base` uses the fast pipeline (no extra model calls). The accurate and deep tools make several model calls, so they are slower, especially on small models.

**Views**: Chat, Toolkit, Knowledge (documents the assistant can search), Models (install, switch and remove Ollama models) and Workspace (notes and tasks).

## How the pieces fit

| File | Role |
|---|---|
| `src/App.tsx` | App shell: model choice, chat state, views |
| `src/ai/llm.ts` | Agent loop for Ollama models: system prompt, tool calling, streaming |
| `src/ai/profile.ts` | Tunes the agent to the installed model: context size, tools per question, steps, reasoning |
| `src/ai/router.ts` | Picks the few tools shown to the model for each question |
| `src/ai/rag.ts` | Chunking, keyword (TF-IDF) search, optional semantic search, rank fusion |
| `src/ai/rag-advanced.ts` | Entity graph, reranking, parent-child expansion, query rewriting, HyDE, grading and corrective retrieval |
| `src/ai/generate.ts` | Lets tools make their own model calls (rewriting, grading, summaries, vision) |
| `src/ai/ollama.ts` | Ollama client: model list, pull, delete, embeddings |
| `src/ai/files.ts` | Reads attached files into tables and documents |
| `src/ai/tools.ts` | Tool registry. Tools live in `src/ai/tools/`, one file per group |
| `src/ai/tool-examples.ts` | One example prompt per tool |

To add a tool, add it to a file in `src/ai/tools/` (or create a new group and list it in `tools.ts`) and add an example in `tool-examples.ts`. New categories show up in the Toolkit automatically.

## Scripts

- `npm run dev`: start the app with hot reload
- `npm run build`: type-check and build to `dist/`
- `npm run lint`: ESLint
