"""Every SeaORM entity column must match the migrated Postgres column type and nullability (SQLite hides drift)."""
import os
import re
from pathlib import Path

import pytest

# ENTITY_DIRS adds entity roots (e.g. o2-enterprise cloud tables); BUILD_FEATURES resolves #[cfg(feature)] fields.
OSS_ENTITY_DIR = Path(__file__).resolve().parents[3] / "src" / "infra" / "src" / "table"
ENTITY_DIRS = [OSS_ENTITY_DIR] + [Path(p) for p in os.getenv("ENTITY_DIRS", "").split(os.pathsep) if p]
BUILD_FEATURES = {f.strip() for f in os.getenv("BUILD_FEATURES", "").split(",") if f.strip()}

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
    "DateTime": {"timestamp without time zone"},
    "DateTimeWithTimeZone": {"timestamp with time zone"},
}

TABLE_RE = re.compile(r'#\[sea_orm\([^\]]*table_name\s*=\s*"([^"]+)"')
MODEL_RE = re.compile(r"pub struct Model\s*\{(.*?)\n\}", re.S)
FIELD_RE = re.compile(r"^\s*pub\s+(?:r#)?(\w+)\s*:\s*([^,]+),", re.M)
ATTR_RE = re.compile(r"#\[sea_orm\(((?:(?!#\[).)*?)\)\]\s*$", re.S)
COLUMN_NAME_RE = re.compile(r'column_name\s*=\s*"([^"]+)"')
ACTIVE_ENUM_RE = re.compile(r'#\[sea_orm\(rs_type\s*=\s*"([^"]+)"[^\]]*\)\]\s*pub enum (\w+)')
CFG_RE = re.compile(r'#\[cfg\((not\()?feature\s*=\s*"([^"]+)"\)?\)\]')

# Columns whose migrations live in o2-enterprise's cloud migrator, so only a cloud build adds them.
ENTERPRISE_CLOUD_COLUMNS = {
    ("trial_quota_usage", "usage_limit"),
    ("trial_quota_usage", "period"),
}

# Nullable in the migration but always written as a String by the app, so no NULL reaches the decoder.
WRITTEN_NON_NULL_COLUMNS = {
    ("org_ingestion_tokens", "description"),
}


def _entity_files() -> list[Path]:
    files = []
    for root in ENTITY_DIRS:
        # Hand-written table modules first: the code uses them, `entity/` can hold stale codegen copies.
        files += sorted(root.glob("*.rs")) + sorted((root / "entity").glob("*.rs"))
    return [f for f in files if "DeriveEntityModel" in f.read_text()]


def _compiled(attrs: str) -> bool:
    for negated, feature in CFG_RE.findall(attrs):
        if (feature in BUILD_FEATURES) == bool(negated):
            return False
    return True


def _columns(model_body: str) -> list[tuple[str, str, bool]]:
    columns = []
    prev_end = 0
    for m in FIELD_RE.finditer(model_body):
        name, rust_type = m.group(1), m.group(2).strip()
        attrs = model_body[prev_end : m.start()]
        prev_end = m.end()
        # A field cfg'd out of this build is never decoded by it.
        if not _compiled(attrs):
            continue
        attr = ATTR_RE.search(model_body[: m.start()])
        if attr:
            renamed = COLUMN_NAME_RE.search(attr.group(1))
            if renamed:
                name = renamed.group(1)
        inner = re.fullmatch(r"Option<(.+)>", rust_type)
        columns.append((name, inner.group(1) if inner else rust_type, inner is not None))
    return columns


def _entities() -> list[tuple[str, list[tuple[str, str, bool]]]]:
    entities = {}
    for path in _entity_files():
        source = path.read_text().split("#[cfg(test)]")[0]
        table, model = TABLE_RE.search(source), MODEL_RE.search(source)
        if table and model:
            entities.setdefault(table.group(1), _columns(model.group(1)))
    return sorted(entities.items())


def _schema(db_cursor, table: str) -> dict[str, tuple[str, bool]]:
    db_cursor.execute(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s",
        (table,),
    )
    schema = {name: (data_type, nullable == "YES") for name, data_type, nullable in db_cursor.fetchall()}
    assert schema, f"table {table} has an entity but no migration created it"
    return schema


def _checked(table: str, columns, schema):
    for column, rust_type, optional in columns:
        if (table, column) in ENTERPRISE_CLOUD_COLUMNS and "cloud" not in BUILD_FEATURES:
            continue
        yield column, rust_type, optional, schema.get(column)


def _active_enums() -> dict[str, str]:
    """DeriveActiveEnum name -> the Rust type it is stored as."""
    enums = {}
    for root in ENTITY_DIRS:
        for path in sorted((root / "entity").glob("*.rs")) + sorted(root.glob("*.rs")):
            for rs_type, name in ACTIVE_ENUM_RE.findall(path.read_text()):
                enums[name] = rs_type
    return enums


ENTITIES = _entities()
ACTIVE_ENUMS = _active_enums()


def test_entity_sources_were_found():
    assert len(ENTITIES) > 100, f"expected the entity sources under {ENTITY_DIRS}, parsed {len(ENTITIES)}"


@pytest.mark.parametrize("table,columns", ENTITIES, ids=[t for t, _ in ENTITIES])
def test_entity_column_types_match_postgres(db_cursor, table, columns):
    schema = _schema(db_cursor, table)
    mismatches = []
    for column, rust_type, _, actual in _checked(table, columns, schema):
        expected = PG_TYPES.get(ACTIVE_ENUMS.get(rust_type, rust_type))
        if expected is None:
            mismatches.append(f"{column}: entity type {rust_type} has no Postgres mapping; add it to PG_TYPES")
        elif actual is None:
            mismatches.append(f"{column}: entity has it, table does not")
        elif actual[0] not in expected:
            mismatches.append(f"{column}: entity {rust_type} needs {sorted(expected)}, table has {actual[0]}")
    assert not mismatches, f"{table} entity and Postgres schema disagree:\n  " + "\n  ".join(mismatches)


@pytest.mark.parametrize("table,columns", ENTITIES, ids=[t for t, _ in ENTITIES])
def test_entity_nullability_matches_postgres(db_cursor, table, columns):
    schema = _schema(db_cursor, table)
    mismatches = []
    for column, _, optional, actual in _checked(table, columns, schema):
        if actual is None:
            continue
        if actual[1] and not optional and (table, column) not in WRITTEN_NON_NULL_COLUMNS:
            mismatches.append(f"{column}: column allows NULL, entity field is not Option and cannot decode it")
        elif optional and not actual[1]:
            mismatches.append(f"{column}: entity field is Option, column is NOT NULL so saving None fails")
    assert not mismatches, f"{table} entity and Postgres nullability disagree:\n  " + "\n  ".join(mismatches)
