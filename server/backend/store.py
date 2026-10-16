"""
Universal data store: ONE JSON file holding every record of every schema.

    data/universal_db.json = {"erp": {"products": [...], ...}, "sis": {...}, ...}

Generic CRUD only. Validation rules come from the schema registry, never
from code here. In a real deployment this file is the piece you swap for
connectors to the actual systems' APIs or databases; the tools stay the same.
"""
import json
import threading

from config import DB_PATH
from backend import schemas

# FastAPI handles requests on a thread pool; the lock stops two tool calls
# from interleaving a read-modify-write of the JSON file.
_lock = threading.RLock()


def load() -> dict:
    with _lock:
        if not DB_PATH.exists():
            from backend.seed import seed_all
            return seed_all()
        db = json.loads(DB_PATH.read_text(encoding="utf-8"))
        # A schema file was dropped in after the DB was created: seed just that
        # domain so it's usable immediately ("new domain = zero code").
        missing = [s for s in schemas.registry() if s not in db]
        if missing:
            from backend.seed import seed_schemas
            db = seed_schemas(db, missing)
            save(db)
        return db


def save(db: dict) -> None:
    with _lock:
        tmp = DB_PATH.with_suffix(".tmp")  # write-then-rename: a crash never leaves half a file
        tmp.write_text(json.dumps(db, indent=2), encoding="utf-8")
        tmp.replace(DB_PATH)


def rows(schema: str, entity: str) -> list[dict]:
    return load().get(schema, {}).get(entity, [])


def next_id(existing: list[dict], prefix: str) -> str:
    """Next sequential ID keeping the number width, e.g. INV-012 -> INV-013."""
    nums, width = [], 3
    for r in existing:
        tail = str(r.get("id", "")).rsplit("-", 1)[-1]
        if tail.isdigit():
            nums.append(int(tail))
            width = len(tail)
    return f"{prefix}-{(max(nums) + 1 if nums else 1):0{width}d}"


def _find(records: list[dict], record_id: str) -> int:
    for i, r in enumerate(records):
        if str(r.get("id", "")).lower() == str(record_id).strip().lower():
            return i
    return -1


def get(schema: str, entity: str, record_id: str) -> dict | None:
    records = rows(schema, entity)
    i = _find(records, record_id)
    return records[i] if i >= 0 else None


def insert(schema: str, entity: str, data: dict, edef: dict) -> dict:
    with _lock:
        db = load()
        records = db.setdefault(schema, {}).setdefault(entity, [])
        record = {"id": next_id(records, edef["id_prefix"]), **data}
        records.append(record)
        save(db)
        return record


def update(schema: str, entity: str, record_id: str, changes: dict) -> tuple[dict, dict] | None:
    with _lock:
        db = load()
        records = db.get(schema, {}).get(entity, [])
        i = _find(records, record_id)
        if i < 0:
            return None
        before = {k: records[i].get(k) for k in changes}
        records[i].update(changes)
        save(db)
        return before, records[i]


def delete(schema: str, entity: str, record_id: str) -> dict | None:
    with _lock:
        db = load()
        records = db.get(schema, {}).get(entity, [])
        i = _find(records, record_id)
        if i < 0:
            return None
        removed = records.pop(i)
        save(db)
        return removed
