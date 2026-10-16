"""
Row selection shared by search_records, get_analytics and generate_report:
free-text query, field filters (with operators) and time periods.

Filters support:  {"status": "open"}                  exact match (case-insensitive)
                  {"amount": {"gt": 1000}}            eq ne gt gte lt lte contains in
                  {"stock": {"lt": "$reorder_point"}} compare with another field
"""
import re
from datetime import date, timedelta

from backend import schemas, store
from backend.schemas import SchemaError

OPS = ("eq", "ne", "gt", "gte", "lt", "lte", "contains", "in")


def _num(v):
    if isinstance(v, bool):
        return v
    try:
        return float(v)
    except (TypeError, ValueError):
        return v


def _check(value, op, target, row) -> bool:
    if isinstance(target, str) and target.startswith("$"):  # field-to-field comparison
        target = row.get(target[1:])
    a, b = _num(value), _num(target)
    try:
        if op == "eq":
            return str(a).lower() == str(b).lower() if isinstance(a, str) or isinstance(b, str) else a == b
        if op == "ne":
            return not _check(value, "eq", target, row)
        if op == "gt": return a > b
        if op == "gte": return a >= b
        if op == "lt": return a < b
        if op == "lte": return a <= b
        if op == "contains": return str(b).lower() in str(a).lower()
        if op == "in": return str(a).lower() in [str(x).lower() for x in (b or [])]
    except TypeError:
        return False  # e.g. None vs number: simply "no match"
    raise SchemaError(f"Unknown filter operator '{op}'. Use: {', '.join(OPS)}.")


def matches(row: dict, filters: dict | None, edef: dict) -> bool:
    for field, cond in (filters or {}).items():
        if field not in edef["fields"]:
            raise SchemaError(f"Unknown filter field '{field}'. Valid fields: {list(edef['fields'])}.")
        conds = cond if isinstance(cond, dict) else {"in": cond} if isinstance(cond, list) else {"eq": cond}
        if not all(_check(row.get(field), op, tgt, row) for op, tgt in conds.items()):
            return False
    return True


def period_start(period: str | None) -> date | None:
    p = (period or "all").lower().strip()
    today = date.today()
    if p in ("", "all", "all_time"):
        return None
    if m := re.fullmatch(r"last_(\d+)_days?", p):
        return today - timedelta(days=int(m.group(1)))
    if p == "this_month":
        return today.replace(day=1)
    if p == "last_month":
        return (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    if p == "this_year":
        return today.replace(month=1, day=1)
    raise SchemaError(f"Unknown period '{period}'. Use last_N_days, this_month, last_month, this_year, all.")


def select(schema, entity, query=None, filters=None, period=None) -> tuple[str, str, dict, list[dict]]:
    """Resolve the entity via the registry, then return the matching rows."""
    s, e, edef = schemas.resolve(schema, entity)
    start = period_start(period)
    dfield = (schemas.date_fields(edef) or [None])[0]  # first date field drives `period`
    if start and not dfield:
        raise SchemaError(f"{s}.{e} has no date field, so 'period' can't be applied.")
    words = (query or "").lower().split()
    out = []
    for r in store.rows(s, e):
        if start and (not r.get(dfield) or date.fromisoformat(str(r[dfield])[:10]) < start):
            continue
        if words:
            blob = " ".join(str(v) for v in r.values()).lower()
            if not all(w in blob for w in words):
                continue
        if matches(r, filters, edef):
            out.append(r)
    return s, e, edef, out
