"""
generate_report: combines structured data from one or more schemas with
related document snippets (RAG), and saves the result to data/reports/.

Totals and breakdowns are chosen from the schema TYPES (numbers get summed,
enum fields get counted), so it works for any domain without changes.
"""
import json
import re
from collections import Counter
from datetime import datetime

from config import REPORTS_DIR
from backend import schemas as registry
from backend import store
from backend.schemas import SchemaError


def _summary(schema: str, entity: str, edef: dict, rows: list[dict]) -> dict:
    fields = edef["fields"]
    totals = {f: round(sum(r.get(f) or 0 for r in rows), 2) for f, s in fields.items()
              if s["type"] == "number" and s.get("max", 1e9) > 100 and rows}  # skip scores/ratings
    breakdowns = {f: dict(Counter(str(r.get(f)) for r in rows)) for f, s in fields.items()
                  if s.get("enum") and rows}
    return {"schema": schema, "entity": entity, "record_count": len(rows), "totals": totals,
            "breakdowns": breakdowns}


def _related_docs(title: str) -> list[dict]:
    try:
        from backend import rag
        return [{"source": h["source"], "snippet": h["text"][:300]} for h in rag.retrieve(title, 3)]
    except Exception:
        return []  # reports still work if documents were never ingested


def _markdown(title: str, sections: list[dict], docs: list[dict]) -> str:
    out = [f"# {title}", f"_Generated {datetime.now():%Y-%m-%d %H:%M}_", ""]
    for sec in sections:
        out += [f"## {sec['schema'].upper()} · {sec['entity'].replace('_', ' ').title()}",
                f"- Records: **{sec['record_count']}**"]
        out += [f"- Total {k}: **{v:,.2f}**" for k, v in sec["totals"].items()]
        out += [f"- By {k}: " + ", ".join(f"{a}: {b}" for a, b in v.items()) for k, v in sec["breakdowns"].items()]
        rows = store.rows(sec["schema"], sec["entity"])[:5]
        if rows:
            cols = list(rows[0])[:6]  # first 6 columns keep the table readable
            out += ["", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
            out += ["| " + " | ".join(str(r.get(c, "")) for c in cols) + " |" for r in rows]
        out.append("")
    if docs:
        out.append("## Related document context")
        out += [f"- **{d['source']}**: {d['snippet']}..." for d in docs]
    return "\n".join(out)


def _targets(schemas: list[str], entities: list[str] | None) -> list[tuple[str, str, dict]]:
    reg = registry.registry()
    out = []
    for s in schemas:
        if s.lower() not in reg:
            raise SchemaError(f"Unknown schema '{s}'. Available: {', '.join(reg)}.")
        s = s.lower()
        wanted = [e.split(".")[-1] for e in (entities or []) if "." not in e or e.split(".")[0] == s]
        for e in (wanted or list(reg[s]["entities"])):
            if e in reg[s]["entities"]:
                out.append((s, e, reg[s]["entities"][e]))
    if not out:
        raise SchemaError("No matching entities for the given schemas.")
    return out


def generate_report(title, schemas, entities=None, format="markdown"):
    fmt = (format or "markdown").lower()
    if fmt not in ("markdown", "json"):
        raise SchemaError("format must be markdown or json.")
    if isinstance(schemas, str):
        schemas = [schemas]
    sections = [_summary(s, e, edef, store.rows(s, e)) for s, e, edef in _targets(schemas, entities)]
    docs = _related_docs(title)
    if fmt == "markdown":
        content, ext = _markdown(title, sections, docs), "md"
    else:
        content, ext = json.dumps({"title": title, "generated_at": datetime.now().isoformat(timespec="seconds"),
                                   "sections": sections, "related_documents": docs}, indent=2), "json"
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50] or "report"
    fname = f"{slug}-{datetime.now():%Y%m%d-%H%M%S}.{ext}"
    (REPORTS_DIR / fname).write_text(content, encoding="utf-8")
    return {"title": title, "format": fmt, "file": f"data/reports/{fname}", "download_url": f"/reports/{fname}",
            "sections": sections, "content_preview": content[:3000]}
