// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectionTrait, Database, DatabaseBackend,
    DatabaseConnection, EntityTrait, Schema, Statement,
};
use sea_orm_migration::MigratorTrait;

use super::{
    entity::alert_hygiene_configs,
    migration::{
        Migrator, alert_hygiene_migration_sql_for_test, create_alert_hygiene_tables_for_test,
        drop_alert_hygiene_tables_for_test,
    },
};

const ORG: &str = "org-a";

async fn db() -> DatabaseConnection {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    create_alert_hygiene_tables_for_test(&db).await.unwrap();
    db
}

fn config(id: &str, org: &str) -> alert_hygiene_configs::ActiveModel {
    alert_hygiene_configs::ActiveModel {
        id: Set(id.to_string()),
        org: Set(org.to_string()),
        ..Default::default()
    }
}

async fn columns(db: &DatabaseConnection, table: &str) -> Vec<(String, String, i32, i32)> {
    db.query_all(Statement::from_string(
        DatabaseBackend::Sqlite,
        format!("PRAGMA table_info('{table}')"),
    ))
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.try_get::<String>("", "name").unwrap(),
            row.try_get::<String>("", "type").unwrap().to_lowercase(),
            row.try_get::<i32>("", "notnull").unwrap(),
            row.try_get::<i32>("", "pk").unwrap(),
        )
    })
    .collect()
}

fn type_family(column_type: &str) -> String {
    let base = column_type.split('(').next().unwrap_or_default().trim();
    match base {
        "json_text" | "jsonb" => "json".to_string(),
        "char" | "text" | "string" => "varchar".to_string(),
        _ => base.to_string(),
    }
}

async fn defaulted_columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
    db.query_all(Statement::from_string(
        DatabaseBackend::Sqlite,
        format!("PRAGMA table_info('{table}')"),
    ))
    .await
    .unwrap()
    .into_iter()
    .filter_map(|row| {
        row.try_get::<Option<String>>("", "dflt_value")
            .unwrap()
            .map(|_| row.try_get::<String>("", "name").unwrap())
    })
    .collect()
}

async fn index_columns(db: &DatabaseConnection, index: &str) -> Vec<String> {
    db.query_all(Statement::from_string(
        DatabaseBackend::Sqlite,
        format!("PRAGMA index_info('{index}')"),
    ))
    .await
    .unwrap()
    .into_iter()
    .map(|row| row.try_get::<String>("", "name").unwrap())
    .collect()
}

async fn indexes_with_uniqueness(db: &DatabaseConnection, table: &str) -> Vec<(String, bool)> {
    db.query_all(Statement::from_string(
        DatabaseBackend::Sqlite,
        format!("PRAGMA index_list('{table}')"),
    ))
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.try_get::<String>("", "name").unwrap(),
            row.try_get::<i32>("", "unique").unwrap() == 1,
        )
    })
    .collect()
}

#[tokio::test]
async fn alert_hygiene_configs_columns_types_nullability_and_primary_key_are_pinned() {
    let db = db().await;
    assert_eq!(
        columns(&db, "alert_hygiene_configs").await,
        vec![
            ("id".to_string(), "varchar(27)".to_string(), 1, 1),
            ("org".to_string(), "varchar(100)".to_string(), 1, 0),
            ("enabled".to_string(), "boolean".to_string(), 1, 0),
            ("frequency_minutes".to_string(), "integer".to_string(), 1, 0),
            ("window_minutes".to_string(), "integer".to_string(), 1, 0),
            ("created_at".to_string(), "bigint".to_string(), 0, 0),
            ("updated_at".to_string(), "bigint".to_string(), 0, 0),
        ]
    );
    assert_eq!(
        defaulted_columns(&db, "alert_hygiene_configs").await,
        vec![
            "enabled".to_string(),
            "frequency_minutes".to_string(),
            "window_minutes".to_string(),
        ]
    );
}

#[tokio::test]
async fn alert_hygiene_epoch_micros_columns_are_big_integer_and_never_timestamp() {
    let db = db().await;
    let mut typed: Vec<(String, String)> = columns(&db, "alert_hygiene_configs")
        .await
        .into_iter()
        .map(|(name, kind, ..)| (name, kind))
        .collect();
    typed.retain(|(name, _)| matches!(name.as_str(), "created_at" | "updated_at"));
    assert_eq!(typed.len(), 2);
    for (name, kind) in typed {
        assert_eq!(kind, "bigint", "{name} must store epoch micros");
    }
    for backend in [DatabaseBackend::Sqlite, DatabaseBackend::Postgres] {
        let sql = alert_hygiene_migration_sql_for_test(backend)
            .join(" ")
            .to_lowercase();
        assert!(!sql.contains("timestamp"), "{backend:?} used a timestamp");
        assert!(!sql.contains("autoincrement"));
        assert!(!sql.contains("auto_increment"));
    }
}

#[tokio::test]
async fn alert_hygiene_configs_allow_one_row_per_org() {
    let db = db().await;
    // The whole declared set: org is UNIQUE, so a second index on org only costs writes.
    let declared: Vec<(String, bool)> = indexes_with_uniqueness(&db, "alert_hygiene_configs")
        .await
        .into_iter()
        .filter(|(name, _)| name.starts_with("idx_"))
        .collect();
    assert_eq!(
        declared,
        vec![("idx_alert_hygiene_configs_org".to_string(), true)]
    );
    assert_eq!(
        index_columns(&db, "idx_alert_hygiene_configs_org").await,
        vec!["org".to_string()]
    );

    config("config-1", ORG).insert(&db).await.unwrap();
    assert!(config("config-2", ORG).insert(&db).await.is_err());
    config("config-3", "org-b").insert(&db).await.unwrap();
}

#[tokio::test]
async fn alert_hygiene_defaults_apply_when_the_writer_omits_the_columns() {
    let db = db().await;
    config("config-1", ORG).insert(&db).await.unwrap();
    let stored = alert_hygiene_configs::Entity::find_by_id("config-1")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(!stored.enabled);
    assert_eq!(stored.frequency_minutes, 1440);
    assert_eq!(stored.window_minutes, 43200);
    assert_eq!(stored.created_at, None);
    assert_eq!(stored.updated_at, None);
}

#[test]
fn alert_hygiene_migration_is_registered_exactly_once_in_the_migrator() {
    let names: Vec<String> = Migrator::migrations()
        .into_iter()
        .map(|migration| migration.name().to_string())
        .collect();
    assert_eq!(
        names
            .iter()
            .filter(|name| name.as_str() == "m20260907_000001_create_alert_hygiene_tables")
            .count(),
        1
    );
}

#[test]
fn alert_hygiene_entities_generate_portable_sql_for_supported_meta_stores() {
    for backend in [DatabaseBackend::Sqlite, DatabaseBackend::Postgres] {
        let schema = Schema::new(backend);
        let statement = schema.create_table_from_entity(alert_hygiene_configs::Entity);
        let sql = backend.build(&statement).to_string().to_lowercase();
        assert!(!sql.contains("autoincrement"));
        assert!(!sql.contains("timestamp"));
    }
}

#[tokio::test]
async fn alert_hygiene_entity_columns_match_the_migrated_tables() {
    let migrated = db().await;
    let derived = Database::connect("sqlite::memory:").await.unwrap();
    let schema = Schema::new(DatabaseBackend::Sqlite);
    let statement = schema.create_table_from_entity(alert_hygiene_configs::Entity);
    derived
        .execute(DatabaseBackend::Sqlite.build(&statement))
        .await
        .unwrap();
    let table = "alert_hygiene_configs";
    // The entities declare no width, so varchar(27) and a bare varchar must compare equal.
    let shape = |rows: Vec<(String, String, i32, i32)>| {
        rows.into_iter()
            .map(|(name, kind, notnull, pk)| (name, type_family(&kind), notnull, pk))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        shape(columns(&derived, table).await),
        shape(columns(&migrated, table).await),
        "the {table} entity drifted from the migration"
    );
}

#[tokio::test]
async fn alert_hygiene_migration_down_drops_the_config_table() {
    let db = db().await;
    drop_alert_hygiene_tables_for_test(&db).await.unwrap();
    let manager = sea_orm_migration::SchemaManager::new(&db);
    assert!(!manager.has_table("alert_hygiene_configs").await.unwrap());
}
