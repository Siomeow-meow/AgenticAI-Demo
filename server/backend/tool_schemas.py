"""
The 10 UNIVERSAL tool definitions the model sees (OpenAI "tools" format).

Nothing here names a domain. The only dynamic part is the list of schema
names (enum), rebuilt on every request from data/schemas/, so a new schema
file shows up for the model immediately. Field details are NOT stuffed into
these descriptions; the model discovers them with list_schemas and
describe_schema. That keeps every request small ("no prompt bloat").
"""
from backend import schemas

FILTER_HELP = ('Optional field filters. Exact: {"status": "open"}. Operators: {"amount": {"gt": 1000}} '
               "(eq, ne, gt, gte, lt, lte, contains, in). Compare two fields with a $-prefixed value: "
               '{"stock": {"lt": "$reorder_point"}}.')


def _fn(name, description, properties=None, required=None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties or {}, "required": required or []}}}


def build_tool_schemas() -> list[dict]:
    names = list(schemas.registry())
    schema_p = {"type": "string", "enum": names, "description": "Schema (domain), e.g. " + ", ".join(names[:4])}
    entity_p = {"type": "string", "description": "Entity inside the schema, e.g. products, students"}
    se = {"schema": schema_p, "entity": entity_p}

    return [
        _fn("list_schemas", "List all available schemas (domains) and their entities with record counts. "
            "Call this first when you don't know what data exists."),
        _fn("describe_schema", "Get the field definitions (types, allowed values, links to other entities) of an entity, "
            "or of every entity in a schema if entity is omitted. Call this before creating or updating records "
            "in an unfamiliar entity.", se, ["schema"]),
        _fn("search_records", "Search any entity in any schema. Supports free-text query and field filters.",
            {**se, "query": {"type": "string", "description": "Optional free-text, all words must match"},
             "filters": {"type": "object", "description": FILTER_HELP},
             "limit": {"type": "integer", "default": 10}}, ["schema", "entity"]),
        _fn("create_record", "Create a record. The id is assigned automatically. "
            "Call describe_schema first if unsure of required fields.",
            {**se, "data": {"type": "object", "description": "Field-value pairs"}}, ["schema", "entity", "data"]),
        _fn("update_record", "Update fields on an existing record.",
            {**se, "record_id": {"type": "string"}, "changes": {"type": "object"}},
            ["schema", "entity", "record_id", "changes"]),
        _fn("delete_record", "Delete a record by ID. Use with caution: only when the user explicitly asks to delete.",
            {**se, "record_id": {"type": "string"}}, ["schema", "entity", "record_id"]),
        _fn("get_analytics", "Compute aggregates (count, sum, avg, min, max) over any entity, optionally grouped "
            "by a field, filtered, and limited to a time period.",
            {**se, "metric": {"type": "string", "enum": ["count", "sum", "avg", "min", "max"]},
             "field": {"type": "string", "description": "Field to aggregate (optional for count)"},
             "group_by": {"type": "string", "description": "Optional grouping field"},
             "filters": {"type": "object", "description": FILTER_HELP},
             "period": {"type": "string", "description": "Optional: last_N_days, this_month, last_month, this_year"}},
            ["schema", "entity", "metric"]),
        _fn("search_documents", "Semantic search over documents in data/docs/. Use when the user asks about policies, "
            "procedures, manuals, contracts, or knowledge NOT in the structured data.",
            {"query": {"type": "string"}, "k": {"type": "integer", "default": 4}}, ["query"]),
        _fn("generate_report", "Generate a structured report by combining structured data across one or more schemas "
            "with document knowledge. Saves a file and returns it.",
            {"title": {"type": "string"},
             "schemas": {"type": "array", "items": {"type": "string", "enum": names}},
             "entities": {"type": "array", "items": {"type": "string"},
                          "description": "Optional; entity names or schema.entity. Omit for all entities."},
             "format": {"type": "string", "enum": ["markdown", "json"]}},
            ["title", "schemas"]),
        _fn("analyze_image", "Analyze an uploaded image and extract structured data based on intent. Handles invoices, "
            "receipts, ID cards, student records, product photos, charts, screenshots, forms, and any "
            "document-like image. Also returns existing records that the image mentions.",
            {"image_id": {"type": "string"},
             "intent": {"type": "string", "description": "What to extract or do, e.g. 'extract invoice fields', "
                                                         "'read this form', 'identify product'"}},
            ["image_id"]),
    ]
