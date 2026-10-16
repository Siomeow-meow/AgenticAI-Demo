"""
Implementations of the 10 UNIVERSAL tools + execute_tool(), the one
dispatcher the agent calls. Definitions the model sees: tool_schemas.py.

Every tool takes (schema, entity) as plain arguments and asks the schema
registry what is valid. There is no "search_students" or "create_invoice"
anywhere: that's the whole point.

Tools never raise to the agent: errors come back as {"error": "..."}
so the model can read the message, fix its arguments and retry.
"""
import json
import re
from collections import defaultdict

from config import UPLOADS_DIR
from backend import schemas, store
from backend.query import _num, select
from backend.reports import generate_report
from backend.schemas import SchemaError

MAX_ROWS = 25  # cap on records returned to the model: keeps context (and cost) small
# Fields whose values identify a record; analyze_image looks for them in the extracted text.
MATCH_FIELDS = {"name", "full_name", "title", "company", "customer_name", "sku", "code", "email", "invoice_number"}


# ---------------------------------------------------------------- discovery
def list_schemas():
    db = store.load()
    return {"schemas": [
        {"schema": s, "display_name": d["display_name"], "description": d["description"],
         "entities": {e: {"description": ed["description"], "records": len(db.get(s, {}).get(e, []))}
                      for e, ed in d["entities"].items()}}
        for s, d in schemas.registry().items()]}


def describe_schema(schema, entity=None):
    out = schemas.describe(schema, entity)
    if entity:  # one real record shows the model what the values look like
        sample = store.rows(out["schema"], next(iter(out["entities"])))[:1]
        out["sample_record"] = sample[0] if sample else None
    return out


# ---------------------------------------------------------------- CRUD
def search_records(schema=None, entity=None, query=None, filters=None, limit=10):
    s, e, _, found = select(schema, entity, query=query, filters=filters)
    limit = max(1, min(int(limit or 10), MAX_ROWS))
    return {"schema": s, "entity": e, "total_matches": len(found), "returned": min(limit, len(found)),
            "records": found[:limit]}


def _ref_warnings(data: dict, edef: dict) -> list[str]:
    """Flag links to records that don't exist (e.g. a vendor_id nobody has)."""
    warnings = []
    for f, v in data.items():
        ref = edef["fields"][f].get("ref")
        if ref and v and store.get(*ref.split(".", 1), v) is None:
            warnings.append(f"{f}={v} does not exist in {ref}")
    return warnings


def create_record(schema=None, entity=None, data=None):
    s, e, edef = schemas.resolve(schema, entity)
    clean = schemas.validate(data, edef)
    record = store.insert(s, e, clean, edef)
    return {"created": record, "schema": s, "entity": e, "warnings": _ref_warnings(clean, edef) or None}


def update_record(schema=None, entity=None, record_id=None, changes=None):
    s, e, edef = schemas.resolve(schema, entity)
    clean = schemas.validate(changes, edef, partial=True)  # ids are never changeable
    result = store.update(s, e, record_id, clean)
    if not result:
        raise SchemaError(f"No {s}.{e} record with id '{record_id}'. Use search_records to find it.")
    before, after = result
    return {"updated": after["id"], "before": before, "after": {k: after[k] for k in before},
            "warnings": _ref_warnings(clean, edef) or None}


def delete_record(schema=None, entity=None, record_id=None):
    s, e, _ = schemas.resolve(schema, entity)
    removed = store.delete(s, e, record_id)
    if not removed:
        raise SchemaError(f"No {s}.{e} record with id '{record_id}'.")
    return {"deleted": removed["id"], "record": removed, "note": "Reset Demo restores seed data."}


# ---------------------------------------------------------------- analytics
def get_analytics(schema=None, entity=None, metric="count", field=None, group_by=None, filters=None, period=None):
    metric = (metric or "count").lower()
    if metric not in ("count", "sum", "avg", "min", "max"):
        raise SchemaError("metric must be one of count, sum, avg, min, max.")
    s, e, edef, rows = select(schema, entity, filters=filters, period=period)
    for f in (field, group_by):
        if f and f not in edef["fields"]:
            raise SchemaError(f"Unknown field '{f}'. Valid fields: {list(edef['fields'])}.")
    if metric != "count" and not field:
        raise SchemaError(f"metric '{metric}' needs a numeric 'field'.")

    groups = defaultdict(list)
    for r in rows:
        groups[str(r.get(group_by)) if group_by else "all"].append(r)

    def agg(items):
        if metric == "count":
            return len(items)
        vals = [v for v in (_num(i.get(field)) for i in items) if isinstance(v, float)]
        if not vals:
            return None
        fn = {"sum": sum, "min": min, "max": max, "avg": lambda x: sum(x) / len(x)}[metric]
        return round(fn(vals), 2)

    result = {k: agg(v) for k, v in sorted(groups.items())}
    return {"schema": s, "entity": e, "metric": metric, "field": field, "group_by": group_by,
            "rows_considered": len(rows), "result": result if group_by else result.get("all", 0)}


# ---------------------------------------------------------------- RAG
def search_documents(query, k=4):
    from backend import rag  # lazy: the embedding model takes a few seconds to load
    hits = rag.retrieve(query, int(k or 4))
    return {"results": hits} if hits else {"results": [], "note": "No documents indexed. Click 'Ingest Docs' first."}


# ---------------------------------------------------------------- vision
def analyze_image(image_id, intent="general analysis"):
    from backend import llm
    files = list(UPLOADS_DIR.glob(f"{image_id}.*")) if re.fullmatch(r"img_[a-f0-9]+", str(image_id)) else []
    if not files:
        raise SchemaError(f"Image '{image_id}' not found. Upload it first.")
    analysis = llm.analyze_image(files[0], intent or "general analysis")

    # Ground the extraction: find existing records (any schema) whose identifying
    # values appear in what the model read, so the next tool call can use real IDs.
    text, found = json.dumps(analysis).lower(), []
    for s, ents in store.load().items():
        for e, rows in ents.items():
            for r in rows:
                for f in MATCH_FIELDS & r.keys():
                    v = str(r.get(f) or "")
                    if len(v) >= 4 and v.lower() in text:
                        found.append({"schema": s, "entity": e, "id": r["id"], "field": f, "value": v})
    return {"image_id": image_id, "analysis": analysis, "matched_records": found[:10]}


# ---------------------------------------------------------------- dispatcher
TOOL_FUNCTIONS = {f.__name__: f for f in (
    list_schemas, describe_schema, search_records, create_record, update_record, delete_record,
    get_analytics, search_documents, generate_report, analyze_image)}


def execute_tool(name: str, args: dict) -> dict:
    """Run one tool call from the model. Always returns a JSON-serialisable dict."""
    fn = TOOL_FUNCTIONS.get(name)
    if not fn:
        return {"error": f"Unknown tool '{name}'. Available: {', '.join(TOOL_FUNCTIONS)}"}
    try:
        return fn(**(args or {}))
    except SchemaError as e:
        return {"error": str(e)}
    except TypeError as e:  # wrong or missing argument names
        return {"error": f"Bad arguments for {name}: {e}"}
    except Exception as e:  # anything else is reported, never crashes the chat
        return {"error": f"{type(e).__name__}: {e}"}
