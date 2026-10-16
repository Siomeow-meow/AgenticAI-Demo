"""
The SCHEMA REGISTRY: reads every data/schemas/*.json file at runtime.

This is what makes the layer universal. The tools never know about
"students" or "invoices"; they ask this module what exists, what fields an
entity has, and how to validate values. Drop a new JSON file into
data/schemas/ and it is live on the next request: no code change, no restart.

Field specs can be a bare type ("email") or an object:
  {"type": "string", "enum": [...], "ref": "sis.students", "required": true,
   "description": "...", "examples": [...], "min": 0, "max": 100}
"""
import json
from datetime import date, datetime

from config import SCHEMAS_DIR

# "person", "email" and "phone" are strings with a meaning the seeder understands.
TYPES = {"string", "integer", "number", "boolean", "date", "datetime", "email", "phone", "person"}

_cache: dict = {"key": None, "registry": {}}


class SchemaError(Exception):
    """Bad schema/entity/field. The message goes back to the model so it can correct itself."""


def _normalize(entity_name: str, edef: dict) -> dict:
    fields = {}
    for fname, spec in edef.get("fields", {}).items():
        spec = {"type": spec} if isinstance(spec, str) else dict(spec)
        if spec.get("type") not in TYPES:
            spec["type"] = "string"
        fields[fname] = spec
    fields.setdefault("id", {"type": "string"})
    return {"description": edef.get("description", ""), "fields": fields,
            "id_prefix": edef.get("id_prefix") or entity_name[:3].upper(),
            "seed_count": int(edef.get("seed_count", 10))}


def registry() -> dict:
    """{schema_name: {display_name, description, entities: {...}}}. Re-read only when files change."""
    files = sorted(SCHEMAS_DIR.glob("*.json"))
    key = tuple((f.name, f.stat().st_mtime) for f in files)
    if key != _cache["key"]:
        reg = {}
        for f in files:
            raw = json.loads(f.read_text(encoding="utf-8"))
            name = raw.get("domain") or f.stem
            reg[name] = {"display_name": raw.get("display_name", name.upper()),
                         "description": raw.get("description", ""),
                         "entities": {e: _normalize(e, d) for e, d in raw.get("entities", {}).items()}}
        _cache.update(key=key, registry=reg)
    return _cache["registry"]


def resolve(schema: str | None, entity: str | None) -> tuple[str, str, dict]:
    """
    Turn the model's (schema, entity) into a validated pair. Forgiving on purpose:
    accepts "sis.students" in either argument, any letter case, and a missing
    schema when the entity name is unique across all schemas.
    """
    reg = registry()
    schema = (schema or "").strip().lower()
    entity = (entity or "").strip().lower().replace(" ", "_")
    if "." in entity:
        schema, entity = entity.split(".", 1)
    elif "." in schema:
        schema, entity = schema.split(".", 1)
    if not schema:
        owners = [s for s, d in reg.items() if entity in d["entities"]]
        if len(owners) == 1:
            schema = owners[0]
    if schema not in reg:
        raise SchemaError(f"Unknown schema '{schema}'. Available: {', '.join(reg)}. Call list_schemas.")
    ents = reg[schema]["entities"]
    if entity not in ents:
        raise SchemaError(f"Unknown entity '{entity}' in schema '{schema}'. Available: {', '.join(ents)}.")
    return schema, entity, ents[entity]


def date_fields(edef: dict) -> list[str]:
    return [f for f, s in edef["fields"].items() if s["type"] in ("date", "datetime")]


def describe(schema: str, entity: str | None = None) -> dict:
    """Field definitions in a compact form the model can read cheaply."""
    reg = registry()
    if entity:
        s, e, edef = resolve(schema, entity)
        targets = {e: edef}
    else:  # whole schema
        s = (schema or "").strip().lower()
        if s not in reg:
            raise SchemaError(f"Unknown schema '{schema}'. Available: {', '.join(reg)}.")
        targets = reg[s]["entities"]
    out = {}
    for e, edef in targets.items():
        fields = {}
        for f, spec in edef["fields"].items():
            info = {"type": spec["type"]}
            for k in ("enum", "ref", "required", "description"):
                if spec.get(k):
                    info[k] = spec[k]
            fields[f] = info
        out[e] = {"description": edef["description"], "id_prefix": edef["id_prefix"], "fields": fields}
    return {"schema": s, "display_name": reg[s]["display_name"], "entities": out}


def coerce(value, spec: dict, fname: str):
    """Convert a model-supplied value to the field's type; raise a readable error if impossible."""
    t = spec["type"]
    if value is None:
        return None
    try:
        if t == "integer":
            value = int(float(value))
        elif t == "number":
            value = round(float(str(value).replace(",", "").replace("$", "")), 2)
        elif t == "boolean":
            value = value if isinstance(value, bool) else str(value).lower() in ("true", "yes", "1")
        elif t == "date":
            value = date.fromisoformat(str(value)[:10]).isoformat()
        elif t == "datetime":
            value = datetime.fromisoformat(str(value)).isoformat(timespec="seconds")
        else:
            value = str(value)
    except (TypeError, ValueError):
        raise SchemaError(f"Field '{fname}' expects {t}, got {value!r}.")
    if spec.get("enum") and value not in spec["enum"]:
        raise SchemaError(f"Field '{fname}' must be one of {spec['enum']}, got {value!r}.")
    return value


def validate(data: dict, edef: dict, partial: bool = False) -> dict:
    """Check field names, types and required fields against the schema. partial=True for updates."""
    if not isinstance(data, dict) or not data:
        raise SchemaError("Record data must be a non-empty object of field-value pairs.")
    fields = edef["fields"]
    unknown = [k for k in data if k not in fields]
    if unknown:
        raise SchemaError(f"Unknown field(s) {unknown}. Valid fields: {list(fields)}. Call describe_schema.")
    clean = {k: coerce(v, fields[k], k) for k, v in data.items() if k != "id"}
    if not partial:
        missing = [f for f, s in fields.items() if s.get("required") and clean.get(f) in (None, "")]
        if missing:
            raise SchemaError(f"Missing required field(s): {missing}.")
    return clean
