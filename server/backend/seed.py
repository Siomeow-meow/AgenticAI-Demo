"""
Generic demo-data generator. It reads the SCHEMA FILES, not hard-coded domain
logic, so any schema you drop in gets realistic seed data too.

How a value is chosen for each field (first rule that applies):
  only_if   -> field only set when another field matches (else "otherwise")
  unique + examples -> examples used in order (keeps rows like SLAs consistent)
  pattern   -> "SKU-{n}" with a running number
  ref       -> a real ID from the referenced entity (seeded first)
  enum      -> random choice (optional weights)
  examples  -> random choice
  type      -> person/email/phone/number/date... generated from the type

Deterministic (fixed random seed) so every demo starts identical. Dates are
relative to TODAY so "recent" questions always have answers.

Run directly:   python -m backend.seed
"""
import json
import random
import re
from datetime import date, datetime, timedelta

from config import DB_PATH
from backend import schemas

FIRST = ["Maria", "James", "Aisha", "Chen", "Lucas", "Priya", "Tom", "Sofia", "Kenji", "Grace", "Omar", "Elena",
         "Diego", "Hana", "Noah", "Zara", "Ivan", "Leah", "Mateo", "Nina", "Ravi", "Amara", "Felix", "Yuki"]
LAST = ["Santos", "Reyes", "Khan", "Wei", "Garcia", "Patel", "Nguyen", "Rossi", "Tanaka", "Cruz", "Okafor",
        "Silva", "Novak", "Haddad", "Larsen", "Mendoza", "Kim", "Dubois", "Moreno", "Fischer"]


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _value(fname, spec, i, rec, ctx):
    rng, today = ctx["rng"], date.today()
    cond = spec.get("only_if")
    if cond and not all(rec.get(k) in v for k, v in cond.items()):
        return spec.get("otherwise")
    if spec.get("unique") and spec.get("examples"):
        return spec["examples"][i % len(spec["examples"])]
    if spec.get("pattern"):
        return spec["pattern"].replace("{n}", str(spec.get("start", 1) + i))
    if spec.get("ref"):
        pool = ctx["ids"].get(spec["ref"], [])
        if spec.get("unique"):  # each referenced ID used at most once
            used = ctx["used"].setdefault((ctx["key"], fname), set())
            pool = [p for p in pool if p not in used]
            if not pool:
                return None
            pick = rng.choice(pool)
            used.add(pick)
            return pick
        return rng.choice(pool) if pool else None
    if spec.get("enum"):
        return rng.choices(spec["enum"], weights=spec.get("weights"))[0]
    if spec.get("examples"):
        return rng.choice(spec["examples"])

    t, lo, hi = spec["type"], spec.get("min", 0), spec.get("max", 1000)
    if t == "person":
        return f"{rng.choice(FIRST)} {rng.choice(LAST)}"
    if t == "email":
        person = next((v for k, v in rec.items() if k in ("full_name", "cashier_name") and v), None)
        if person:
            return f"{person.lower().replace(' ', '.')}@example.com"
        return f"contact@{_slug(str(rec.get('name') or rec.get('company') or 'org' + str(i)))}.example.com"
    if t == "phone":
        return f"+1-555-{rng.randint(100, 999)}-{rng.randint(1000, 9999)}"
    if t == "integer":
        return rng.randint(int(lo), int(hi))
    if t == "number":
        val = round(rng.uniform(lo, hi), spec.get("decimals", 2))
        return int(val) if spec.get("decimals") == 0 else val
    if t == "boolean":
        return rng.random() < 0.8
    if t in ("date", "datetime"):
        a, b = spec.get("range_days", [-90, 0])
        d = today + timedelta(days=rng.randint(a, b))
        if t == "date":
            return d.isoformat()
        return datetime(d.year, d.month, d.day, rng.randint(7, 20), rng.choice([0, 15, 30, 45])).isoformat()
    return f"{fname.replace('_', ' ').title()} {i + 1}"


def _order(targets: list[tuple[str, str]], reg: dict) -> list[tuple[str, str]]:
    """Topological order: an entity is seeded after every entity it references."""
    done, out = set(), []

    def visit(node, path=()):
        if node in done or node in path:
            return
        s, e = node
        for spec in reg[s]["entities"][e]["fields"].values():
            if spec.get("ref"):
                ref = tuple(spec["ref"].split(".", 1))
                if ref in targets and ref != node:
                    visit(ref, path + (node,))
        done.add(node)
        out.append(node)

    for t in targets:
        visit(t)
    return out


def seed_schemas(db: dict, names: list[str]) -> dict:
    """Generate records for the given schemas, using IDs already in db for cross-schema refs."""
    reg = schemas.registry()
    rng = random.Random(42)
    ids = {f"{s}.{e}": [r["id"] for r in rs] for s, ents in db.items() for e, rs in ents.items()}
    targets = [(s, e) for s in names for e in reg[s]["entities"]]
    ctx = {"rng": rng, "ids": ids, "used": {}}
    for s, e in _order(targets, reg):
        edef = reg[s]["entities"][e]
        ctx["key"] = f"{s}.{e}"
        records = []
        for i in range(edef["seed_count"]):
            rec = {"id": f"{edef['id_prefix']}-{i + 1:03d}"}
            for fname, spec in edef["fields"].items():
                if fname != "id":
                    rec[fname] = _value(fname, spec, i, rec, ctx)
            records.append(rec)
        db.setdefault(s, {})[e] = records
        ids[f"{s}.{e}"] = [r["id"] for r in records]
    return db


def seed_all() -> dict:
    """(Re)generate the whole store from every schema file. Used on first run and by Reset Demo."""
    db = seed_schemas({}, list(schemas.registry()))
    DB_PATH.write_text(json.dumps(db, indent=2), encoding="utf-8")
    return db


if __name__ == "__main__":
    data = seed_all()
    for schema, ents in data.items():
        print(f"{schema:8s} " + ", ".join(f"{e}: {len(r)}" for e, r in ents.items()))
    print(f"Wrote {DB_PATH}")
