"""
Every SeaORM entity column must have a Postgres type sqlx can decode it from.

SQLite accepts any type in any column, so an entity that says `Json` over a
migration that made `TEXT` only fails on Postgres (cloud), and only once a row
holds a value. This compares the entity source against the migrated schema.
"""
import re
from pathlib import Path

import pytest

ENTITY_DIR = Path(__file__).resolve().parents[3] / "src" / "infra" / "src" / "table"

PG_TYPES = {
    "Json": {"json", "jsonb"},
    "serde_json::Value": {"json", "jsonb"},
    "String": {"text", "character varying", "character"},
    "i64": {"bigint"},
    "i32": {"integer"},
    "i16": {"smallint"},
    "bool": {"boolean"},
    "f64": {"double precision"},
    "f32": {"real"},
    "Vec<u8>": {"bytea"},
}

TABLE_RE = re.compile(r'#\[sea_orm\([^\]]*table_name\s*=\s*"([^"]+)"')
MODEL_RE = re.compile(r"pub struct Model\s*\{(.*?)\n\}", re.S)
FIELD_RE = re.compile(r"^\s*pub\s+(?:r#)?(\w+)\s*:\s*([^,]+),", re.M)
ATTR_RE = re.compile(r"#\[sea_orm\(((?:(?!#\[).)*?)\)\]\s*$", re.S)
COLUMN_NAME_RE = re.compile(r'column_name\s*=\s*"([^"]+)"')
CFG_GATED_RE = re.compile(r"#\[cfg\(feature\s*=")

# Columns whose migrations live in o2-enterprise's cloud migrator, so this build never adds them.
ENTERPRISE_CLOUD_COLUMNS = {
    ("trial_quota_usage", "usage_limit"),
    ("trial_quota_usage", "period"),
}


def _entity_files() -> list[Path]:
    files = sorted((ENTITY_DIR / "entity").glob("*.rs")) + sorted(ENTITY_DIR.glob("*.rs"))
    return [f for f in files if "DeriveEntityModel" in f.read_text()]


def _columns(model_body: str) -> list[tuple[str, str]]:
    columns = []
    prev_end = 0
    for m in FIELD_RE.finditer(model_body):
        name, rust_type = m.group(1), m.group(2).strip()
        gated = CFG_GATED_RE.search(model_body[prev_end : m.start()])
        prev_end = m.end()
        # A feature-gated field is not compiled into this build, so it is never decoded here.
        if gated:
            continue
        attr = ATTR_RE.search(model_body[: m.start()])
        if attr:
            renamed = COLUMN_NAME_RE.search(attr.group(1))
            if renamed:
                name = renamed.group(1)
        inner = re.fullmatch(r"Option<(.+)>", rust_type)
        columns.append((name, inner.group(1) if inner else rust_type))
    return columns


def _entities() -> list[tuple[str, list[tuple[str, str]]]]:
    entities = {}
    for path in _entity_files():
        source = path.read_text().split("#[cfg(test)]")[0]
        table, model = TABLE_RE.search(source), MODEL_RE.search(source)
        if table and model:
            entities.setdefault(table.group(1), _columns(model.group(1)))
    return sorted(entities.items())


ENTITIES = _entities()


def test_entity_sources_were_found():
    assert len(ENTITIES) > 100, f"expected the entity sources under {ENTITY_DIR}, parsed {len(ENTITIES)}"


@pytest.mark.parametrize("table,columns", ENTITIES, ids=[t for t, _ in ENTITIES])
def test_entity_column_types_match_postgres(db_cursor, table, columns):
    db_cursor.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s",
        (table,),
    )
    actual = dict(db_cursor.fetchall())
    assert actual, f"table {table} has an entity but no migration created it"

    mismatches = []
    for column, rust_type in columns:
        expected = PG_TYPES.get(rust_type)
        if expected is None:
            continue
        if (table, column) in ENTERPRISE_CLOUD_COLUMNS:
            continue
        if column not in actual:
            mismatches.append(f"{column}: entity has it, table does not")
        elif actual[column] not in expected:
            mismatches.append(f"{column}: entity {rust_type} needs {sorted(expected)}, table has {actual[column]}")
    assert not mismatches, f"{table} entity and Postgres schema disagree:\n  " + "\n  ".join(mismatches)
