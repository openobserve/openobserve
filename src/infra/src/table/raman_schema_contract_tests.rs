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
    entity::{raman_configs, raman_digests},
    migration::{
        Migrator, create_raman_tables_for_test, drop_raman_tables_for_test,
        raman_migration_sql_for_test,
    },
};

const ORG: &str = "org-a";

async fn db() -> DatabaseConnection {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    create_raman_tables_for_test(&db).await.unwrap();
    db
}

fn config(id: &str, org: &str) -> raman_configs::ActiveModel {
    raman_configs::ActiveModel {
        id: Set(id.to_string()),
        org: Set(org.to_string()),
        ..Default::default()
    }
}

fn digest(
    id: &str,
    config_id: &str,
    cluster: &str,
    window_start: i64,
    window_end: i64,
) -> raman_digests::ActiveModel {
    raman_digests::ActiveModel {
        id: Set(id.to_string()),
        org: Set(ORG.to_string()),
        config_id: Set(config_id.to_string()),
        cluster: Set(cluster.to_string()),
        window_start: Set(window_start),
        window_end: Set(window_end),
        generated_at: Set(window_end),
        finding_count: Set(0),
        findings: Set(serde_json::json!([])),
        coverage_gap: Set(false),
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
async fn raman_configs_columns_types_nullability_and_primary_key_are_pinned() {
    let db = db().await;
    assert_eq!(
        columns(&db, "raman_configs").await,
        vec![
            ("id".to_string(), "varchar(27)".to_string(), 1, 1),
            ("org".to_string(), "varchar(100)".to_string(), 1, 0),
            ("enabled".to_string(), "boolean".to_string(), 1, 0),
            ("frequency_minutes".to_string(), "integer".to_string(), 1, 0),
            ("window_minutes".to_string(), "integer".to_string(), 1, 0),
            ("rule_overrides".to_string(), "json_text".to_string(), 0, 0),
            ("created_at".to_string(), "bigint".to_string(), 0, 0),
            ("updated_at".to_string(), "bigint".to_string(), 0, 0),
        ]
    );
    assert_eq!(
        defaulted_columns(&db, "raman_configs").await,
        vec![
            "enabled".to_string(),
            "frequency_minutes".to_string(),
            "window_minutes".to_string(),
        ]
    );
}

#[tokio::test]
async fn raman_digests_columns_types_nullability_and_primary_key_are_pinned() {
    let db = db().await;
    assert_eq!(
        columns(&db, "raman_digests").await,
        vec![
            ("id".to_string(), "varchar(27)".to_string(), 1, 1),
            ("org".to_string(), "varchar(100)".to_string(), 1, 0),
            ("config_id".to_string(), "varchar(27)".to_string(), 1, 0),
            ("cluster".to_string(), "varchar(100)".to_string(), 1, 0),
            ("window_start".to_string(), "bigint".to_string(), 1, 0),
            ("window_end".to_string(), "bigint".to_string(), 1, 0),
            ("generated_at".to_string(), "bigint".to_string(), 1, 0),
            ("finding_count".to_string(), "integer".to_string(), 1, 0),
            ("findings".to_string(), "json_text".to_string(), 1, 0),
            ("coverage_gap".to_string(), "boolean".to_string(), 1, 0),
        ]
    );
    assert_eq!(
        defaulted_columns(&db, "raman_digests").await,
        vec![
            "cluster".to_string(),
            "finding_count".to_string(),
            "coverage_gap".to_string(),
        ]
    );
}

#[tokio::test]
async fn raman_epoch_micros_columns_are_big_integer_and_never_timestamp() {
    let db = db().await;
    let mut typed: Vec<(String, String)> = columns(&db, "raman_configs")
        .await
        .into_iter()
        .chain(columns(&db, "raman_digests").await)
        .map(|(name, kind, ..)| (name, kind))
        .collect();
    typed.retain(|(name, _)| {
        matches!(
            name.as_str(),
            "created_at" | "updated_at" | "window_start" | "window_end" | "generated_at"
        )
    });
    assert_eq!(typed.len(), 5);
    for (name, kind) in typed {
        assert_eq!(kind, "bigint", "{name} must store epoch micros");
    }
    for backend in [DatabaseBackend::Sqlite, DatabaseBackend::Postgres] {
        let sql = raman_migration_sql_for_test(backend)
            .join(" ")
            .to_lowercase();
        assert!(!sql.contains("timestamp"), "{backend:?} used a timestamp");
        assert!(!sql.contains("autoincrement"));
        assert!(!sql.contains("auto_increment"));
    }
}

#[tokio::test]
async fn raman_digests_unique_window_index_is_config_cluster_start_end_in_order() {
    let db = db().await;
    let indexes = indexes_with_uniqueness(&db, "raman_digests").await;
    let unique = indexes
        .iter()
        .find(|(name, _)| name == "idx_raman_digests_config_cluster_window")
        .expect("the per-window idempotency index must exist");
    assert!(unique.1, "the per-window index must be UNIQUE");
    assert_eq!(
        index_columns(&db, "idx_raman_digests_config_cluster_window").await,
        vec![
            "config_id".to_string(),
            "cluster".to_string(),
            "window_start".to_string(),
            "window_end".to_string(),
        ]
    );
    assert_eq!(
        index_columns(&db, "idx_raman_digests_org_window_end").await,
        vec!["org".to_string(), "window_end".to_string()]
    );
}

#[tokio::test]
async fn raman_digests_reject_a_second_row_for_the_same_config_cluster_and_window() {
    let db = db().await;
    let first = digest("digest-1", "config-1", "cluster-a", 10, 20);
    let second = digest("digest-2", "config-1", "cluster-a", 10, 20);
    first.insert(&db).await.unwrap();
    assert!(second.insert(&db).await.is_err());

    digest("digest-3", "config-1", "cluster-b", 10, 20)
        .insert(&db)
        .await
        .unwrap();
    digest("digest-4", "config-1", "cluster-a", 20, 30)
        .insert(&db)
        .await
        .unwrap();
}

#[tokio::test]
async fn raman_configs_allow_one_row_per_org() {
    let db = db().await;
    // The whole declared set: org is UNIQUE, so a second index on org only costs writes.
    let declared: Vec<(String, bool)> = indexes_with_uniqueness(&db, "raman_configs")
        .await
        .into_iter()
        .filter(|(name, _)| name.starts_with("idx_"))
        .collect();
    assert_eq!(declared, vec![("idx_raman_configs_org".to_string(), true)]);
    assert_eq!(
        index_columns(&db, "idx_raman_configs_org").await,
        vec!["org".to_string()]
    );

    config("config-1", ORG).insert(&db).await.unwrap();
    assert!(config("config-2", ORG).insert(&db).await.is_err());
    config("config-3", "org-b").insert(&db).await.unwrap();
}

#[tokio::test]
async fn raman_defaults_apply_when_the_writer_omits_the_columns() {
    let db = db().await;
    config("config-1", ORG).insert(&db).await.unwrap();
    let stored = raman_configs::Entity::find_by_id("config-1")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert!(!stored.enabled);
    assert_eq!(stored.frequency_minutes, 60);
    assert_eq!(stored.window_minutes, 1440);
    assert_eq!(stored.rule_overrides, None);
    assert_eq!(stored.created_at, None);
    assert_eq!(stored.updated_at, None);

    raman_digests::ActiveModel {
        id: Set("digest-1".to_string()),
        org: Set(ORG.to_string()),
        config_id: Set("config-1".to_string()),
        window_start: Set(10),
        window_end: Set(20),
        generated_at: Set(30),
        findings: Set(serde_json::json!([])),
        ..Default::default()
    }
    .insert(&db)
    .await
    .unwrap();
    let stored = raman_digests::Entity::find_by_id("digest-1")
        .one(&db)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.cluster, "");
    assert_eq!(stored.finding_count, 0);
    assert!(!stored.coverage_gap);
}

#[test]
fn raman_migration_is_registered_exactly_once_in_the_migrator() {
    let names: Vec<String> = Migrator::migrations()
        .into_iter()
        .map(|migration| migration.name().to_string())
        .collect();
    assert_eq!(
        names
            .iter()
            .filter(|name| name.as_str() == "m20260907_000001_create_raman_tables")
            .count(),
        1
    );
}

#[test]
fn raman_entities_generate_portable_sql_for_supported_meta_stores() {
    for backend in [DatabaseBackend::Sqlite, DatabaseBackend::Postgres] {
        let schema = Schema::new(backend);
        for statement in [
            schema.create_table_from_entity(raman_configs::Entity),
            schema.create_table_from_entity(raman_digests::Entity),
        ] {
            let sql = backend.build(&statement).to_string().to_lowercase();
            assert!(!sql.contains("autoincrement"));
            assert!(!sql.contains("timestamp"));
        }
    }
}

#[tokio::test]
async fn raman_entity_columns_match_the_migrated_tables() {
    let migrated = db().await;
    let derived = Database::connect("sqlite::memory:").await.unwrap();
    let schema = Schema::new(DatabaseBackend::Sqlite);
    for statement in [
        schema.create_table_from_entity(raman_configs::Entity),
        schema.create_table_from_entity(raman_digests::Entity),
    ] {
        derived
            .execute(DatabaseBackend::Sqlite.build(&statement))
            .await
            .unwrap();
    }
    for table in ["raman_configs", "raman_digests"] {
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
}

#[tokio::test]
async fn raman_migration_down_drops_both_tables() {
    let db = db().await;
    drop_raman_tables_for_test(&db).await.unwrap();
    let manager = sea_orm_migration::SchemaManager::new(&db);
    assert!(!manager.has_table("raman_configs").await.unwrap());
    assert!(!manager.has_table("raman_digests").await.unwrap());
}
