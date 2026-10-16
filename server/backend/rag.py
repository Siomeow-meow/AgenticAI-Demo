"""
RAG = Retrieval-Augmented Generation. Two functions:

  ingest_docs(path) : read every .pdf/.txt/.md in data/docs/, split into
                      ~500-token chunks (50-token overlap), embed on CPU,
                      store in a persistent ChromaDB at data/chroma/.
  retrieve(query,k) : embed the question, return the k most similar chunks
                      WITH their source file + page, so answers are citable.

Embeddings run locally (sentence-transformers on CPU, no GPU needed).
Only the final answer generation uses the hosted LLM. Works for any
documents: policies, manuals, contracts, handbooks, in any domain.
"""
from functools import lru_cache
from pathlib import Path

import chromadb
from chromadb.config import Settings

from config import CHROMA_COLLECTION, CHROMA_DIR, CHUNK_OVERLAP, CHUNK_TOKENS, DOCS_DIR, DOCS_DIRS, EMBED_MODEL

SUPPORTED = {".pdf", ".txt", ".md", ".csv"}
# BGE models retrieve better when the QUERY (not the documents) carries this prefix.
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@lru_cache(maxsize=1)
def _embedder():
    # Imported lazily: torch takes a few seconds to load, and the API should start fast.
    # First call downloads the model (~130 MB) to the Hugging Face cache, then it's offline.
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(EMBED_MODEL, device="cpu")


@lru_cache(maxsize=1)
def _client():
    return chromadb.PersistentClient(path=str(CHROMA_DIR), settings=Settings(anonymized_telemetry=False))


def _collection():
    # cosine distance, because the embeddings are normalised.
    return _client().get_or_create_collection(CHROMA_COLLECTION, metadata={"hnsw:space": "cosine"})


def _embed(texts: list[str]) -> list[list[float]]:
    return _embedder().encode(texts, normalize_embeddings=True, batch_size=16).tolist()


def _read_pages(path: Path) -> list[tuple[int, str]]:
    """Return [(page_number, text)]. Text files are treated as one page."""
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader
        return [(i + 1, p.extract_text() or "") for i, p in enumerate(PdfReader(str(path)).pages)]
    return [(1, path.read_text(encoding="utf-8", errors="ignore"))]


def chunk_text(text: str, size: int = CHUNK_TOKENS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Token-based sliding window. We count tokens with the embedding model's own
    tokenizer, so a "500-token chunk" is exactly what the embedder sees
    (bge-small's limit is 512, so nothing is silently cut off).
    """
    tok = _embedder().tokenizer
    ids = tok(text, add_special_tokens=False, verbose=False)["input_ids"]
    if not ids:
        return []
    step = size - overlap
    chunks = []
    for start in range(0, len(ids), step):
        piece = tok.decode(ids[start:start + size]).strip()
        if piece:
            chunks.append(piece)
        if start + size >= len(ids):
            break
    return chunks


def ingest_docs(paths: list[Path] | None = None) -> dict:
    """Rebuild the index from scratch (simple + idempotent: re-ingesting never duplicates)."""
    paths = [Path(p) for p in (paths or DOCS_DIRS)]
    try:
        _client().delete_collection(CHROMA_COLLECTION)
    except Exception:
        pass  # collection didn't exist yet
    col = _collection()

    ids, texts, metas, files, skipped = [], [], [], [], []
    # Files outside data/docs (the app's src/docs) are labelled with their folder.
    found = [(p, f) for p in paths for f in sorted(p.rglob("*")) if f.is_file()]
    for path, f in found:
        if f.suffix.lower() not in SUPPORTED:
            skipped.append(f.name)
            continue
        rel = f.relative_to(path).as_posix()
        if path != DOCS_DIR:
            rel = f"{path.parent.name}/{path.name}/{rel}"
        n_before = len(ids)
        for page, text in _read_pages(f):
            for i, chunk in enumerate(chunk_text(text)):
                ids.append(f"{rel}::p{page}::c{i}")  # stable ID per chunk
                texts.append(chunk)
                metas.append({"source": rel, "page": page, "chunk": i})
        files.append({"file": rel, "chunks": len(ids) - n_before})

    # Add in batches: Chroma has a max batch size, and big PDFs can exceed it.
    for s in range(0, len(ids), 256):
        col.add(ids=ids[s:s + 256], documents=texts[s:s + 256],
                embeddings=_embed(texts[s:s + 256]), metadatas=metas[s:s + 256])
    return {"files": files, "total_chunks": len(ids), "skipped": skipped, "embed_model": EMBED_MODEL}


def retrieve(query: str, k: int = 4) -> list[dict]:
    col = _collection()
    if col.count() == 0:
        return []
    q = (BGE_QUERY_PREFIX + query) if "bge" in EMBED_MODEL.lower() else query
    res = col.query(query_embeddings=_embed([q]), n_results=min(max(1, k), col.count()))
    hits = []
    for text, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        hits.append({"source": meta["source"], "page": meta["page"], "chunk": meta["chunk"],
                     "score": round(1 - dist, 3),  # cosine similarity: higher = more relevant
                     "text": text})
    return hits


def stats() -> dict:
    try:
        return {"chunks_indexed": _collection().count()}
    except Exception as e:
        return {"chunks_indexed": 0, "error": str(e)}
