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

//! Per-org config writes and lookups, and org teardown for the alert_hygiene config table.

use config::{ider, utils::time::now_micros};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, Insert, Iterable, QueryFilter, sea_query::OnConflict,
};
use serde::{Deserialize, Deserializer};

use super::entity::alert_hygiene_configs;
use crate::errors::{DbError, Error};

/// One field of a partial update: `Unchanged` is absence, `Set` is an explicit
/// value, so no value of `T` can be mistaken for the caller having said nothing.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Patch<T> {
    #[default]
    Unchanged,
    Set(T),
}

/// An org's full alert_hygiene settings, before the write gives them a row identity.
#[derive(Clone, Debug)]
pub struct NewConfig {
    pub enabled: bool,
    pub frequency_minutes: i32,
    pub window_minutes: i32,
}

/// The `{ enabled?, frequency_minutes?, window_minutes? }` body of a partial
/// config update, where every absent field means "leave it alone".
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ConfigPatch {
    pub enabled: Patch<bool>,
    pub frequency_minutes: Patch<i32>,
    pub window_minutes: Patch<i32>,
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    /// A present field is a set value; absence never reaches here.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Patch::Set)
    }
}

/// Scoped by org so a config id leaked from another org can never resolve here.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<alert_hygiene_configs::Model>, Error> {
    alert_hygiene_configs::Entity::find_by_id(id)
        .filter(alert_hygiene_configs::Column::Org.eq(org))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// The org's alert_hygiene config, or `None` before the org has ever written one.
pub async fn get_by_org<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Option<alert_hygiene_configs::Model>, Error> {
    alert_hygiene_configs::Entity::find()
        .filter(alert_hygiene_configs::Column::Org.eq(org))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Creates the org's config or replaces every settable field of the row it
/// already has, through `on_conflict` so two nodes cannot race a read-then-write.
pub async fn upsert_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    config: NewConfig,
) -> Result<alert_hygiene_configs::Model, Error> {
    write_config(conn, org, config_active_model(org, config, now_micros())).await
}

/// Writes only the fields the caller set: an absent field keeps its stored value,
/// and on a first write takes the column default the migration declares.
pub async fn patch_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    patch: ConfigPatch,
) -> Result<alert_hygiene_configs::Model, Error> {
    write_config(conn, org, patch_active_model(org, patch, now_micros())).await
}

/// Removes the org's alert_hygiene config.
pub async fn delete_by_org(db: &DatabaseConnection, org: &str) -> Result<(), Error> {
    alert_hygiene_configs::Entity::delete_many()
        .filter(alert_hygiene_configs::Column::Org.eq(org))
        .exec(db)
        .await?;
    Ok(())
}

async fn write_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    model: alert_hygiene_configs::ActiveModel,
) -> Result<alert_hygiene_configs::Model, Error> {
    config_upsert_statement(model)
        .exec_without_returning(conn)
        .await?;

    get_by_org(conn, org).await?.ok_or_else(|| {
        Error::DbError(DbError::SeaORMError(
            "alert_hygiene config disappeared between its upsert and its read-back".to_string(),
        ))
    })
}

fn config_active_model(
    org: &str,
    config: NewConfig,
    now: i64,
) -> alert_hygiene_configs::ActiveModel {
    alert_hygiene_configs::ActiveModel {
        id: Set(ider::uuid()),
        org: Set(org.to_string()),
        enabled: Set(config.enabled),
        frequency_minutes: Set(config.frequency_minutes),
        window_minutes: Set(config.window_minutes),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
    }
}

/// A field the patch leaves `Unchanged` stays `NotSet`, which keeps it out of
/// both the INSERT and the conflict clause `config_update_columns` derives.
fn patch_active_model(
    org: &str,
    patch: ConfigPatch,
    now: i64,
) -> alert_hygiene_configs::ActiveModel {
    let mut model = alert_hygiene_configs::ActiveModel {
        id: Set(ider::uuid()),
        org: Set(org.to_string()),
        created_at: Set(Some(now)),
        // Always set, so an all-absent patch still has a column to update.
        updated_at: Set(Some(now)),
        ..Default::default()
    };
    if let Patch::Set(enabled) = patch.enabled {
        model.enabled = Set(enabled);
    }
    if let Patch::Set(frequency_minutes) = patch.frequency_minutes {
        model.frequency_minutes = Set(frequency_minutes);
    }
    if let Patch::Set(window_minutes) = patch.window_minutes {
        model.window_minutes = Set(window_minutes);
    }
    model
}

/// Every column the write actually set, minus the ones an update must not move:
/// `id` and `org` key the row, and `created_at` records when it first appeared.
fn config_update_columns(
    model: &alert_hygiene_configs::ActiveModel,
) -> Vec<alert_hygiene_configs::Column> {
    alert_hygiene_configs::Column::iter()
        .filter(|column| {
            !matches!(
                column,
                alert_hygiene_configs::Column::Id
                    | alert_hygiene_configs::Column::Org
                    | alert_hygiene_configs::Column::CreatedAt
            )
        })
        .filter(|column| model.get(*column).is_set())
        .collect()
}

fn config_upsert_statement(
    model: alert_hygiene_configs::ActiveModel,
) -> Insert<alert_hygiene_configs::ActiveModel> {
    let updated = config_update_columns(&model);
    alert_hygiene_configs::Entity::insert(model).on_conflict(
        // mysql ignores this target and fires on any unique key, the same key here.
        OnConflict::column(alert_hygiene_configs::Column::Org)
            .update_columns(updated)
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ActiveValue::Set, ConnectionTrait, Database, DatabaseBackend,
        PaginatorTrait, QueryTrait, Statement,
    };

    use super::*;
    use crate::table::migration::{
        alert_hygiene_migration_sql_for_test, create_alert_hygiene_tables_for_test,
    };

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";
    const NOW: i64 = 1_757_004_000_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_alert_hygiene_tables_for_test(&db).await.unwrap();
        db
    }

    fn new_config() -> NewConfig {
        NewConfig {
            enabled: true,
            frequency_minutes: 60,
            window_minutes: 720,
        }
    }

    async fn config_count(db: &DatabaseConnection) -> u64 {
        alert_hygiene_configs::Entity::find()
            .count(db)
            .await
            .unwrap()
    }

    async fn seeded_config(db: &DatabaseConnection) -> alert_hygiene_configs::Model {
        upsert_config(db, ORG, new_config()).await.unwrap()
    }

    /// Every table the alert_hygiene migration creates, read from the migration itself
    /// so a table added later cannot quietly escape the sweep test below.
    fn migrated_tables() -> Vec<String> {
        alert_hygiene_migration_sql_for_test(DatabaseBackend::Sqlite)
            .iter()
            .filter_map(|sql| {
                sql.to_lowercase()
                    .starts_with("create table")
                    .then(|| sql.split('"').nth(1).expect("a quoted table name"))
                    .map(str::to_string)
            })
            .collect()
    }

    /// (name, type, notnull, has_default) for each column of `table`.
    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<(String, String, bool, bool)> {
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
                row.try_get::<i32>("", "notnull").unwrap() == 1,
                row.try_get::<Option<String>>("", "dflt_value")
                    .unwrap()
                    .is_some(),
            )
        })
        .collect()
    }

    fn literal(table: &str, column: &str, column_type: &str, seed: &str) -> String {
        let base = column_type.split('(').next().unwrap_or_default().trim();
        match base {
            "varchar" | "char" | "text" | "string" => format!("'{seed}'"),
            "json_text" | "json" | "jsonb" => "'[]'".to_string(),
            "integer" | "int" | "bigint" | "smallint" => "1".to_string(),
            "boolean" => "0".to_string(),
            "real" | "double" | "float" | "decimal" => "1.0".to_string(),
            _ => panic!("{table}.{column} has type {column_type}; teach this fixture about it"),
        }
    }

    async fn insert_row(db: &DatabaseConnection, table: &str, org: &str, seed: &str) {
        let mut names = Vec::new();
        let mut values = Vec::new();
        for (name, column_type, notnull, has_default) in columns(db, table).await {
            if !notnull || has_default {
                continue;
            }
            values.push(if name == "org" {
                format!("'{org}'")
            } else {
                literal(table, &name, &column_type, seed)
            });
            names.push(format!("\"{name}\""));
        }
        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!(
                "INSERT INTO \"{table}\" ({}) VALUES ({})",
                names.join(", "),
                values.join(", ")
            ),
        ))
        .await
        .unwrap();
    }

    async fn count(db: &DatabaseConnection, table: &str, org: &str) -> i64 {
        db.query_one(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!("SELECT COUNT(*) AS n FROM \"{table}\" WHERE org = '{org}'"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "n")
        .unwrap()
    }

    async fn has_org_column(db: &DatabaseConnection, table: &str) -> bool {
        columns(db, table)
            .await
            .iter()
            .any(|(name, ..)| name == "org")
    }

    /// The completeness pin: an alert_hygiene table added to the migration but not to
    /// `delete_by_org` fails here, without anyone remembering to update a list.
    #[tokio::test]
    async fn delete_by_org_sweeps_every_org_scoped_alert_hygiene_table() {
        let db = db().await;
        let tables = migrated_tables();
        assert!(
            !tables.is_empty(),
            "the alert_hygiene migration creates tables"
        );

        let mut swept = Vec::new();
        for table in &tables {
            // A table with no org column resolves its org through a parent, not here.
            if !has_org_column(&db, table).await {
                continue;
            }
            insert_row(&db, table, ORG, "a").await;
            insert_row(&db, table, OTHER_ORG, "b").await;
            swept.push(table.clone());
        }
        assert!(
            !swept.is_empty(),
            "no org-scoped alert_hygiene table was exercised"
        );

        // The fixture rows above are hand-built; these go through the real writers.
        for org in [ORG, OTHER_ORG] {
            upsert_config(&db, org, new_config()).await.unwrap();
            patch_config(
                &db,
                org,
                ConfigPatch {
                    enabled: Patch::Set(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        }

        let mut kept = Vec::new();
        for table in &swept {
            kept.push(count(&db, table, OTHER_ORG).await);
        }

        delete_by_org(&db, ORG).await.unwrap();

        for (table, kept) in swept.iter().zip(kept) {
            assert!(
                kept > 0,
                "{table} held no rows for the org that must survive"
            );
            assert_eq!(count(&db, table, ORG).await, 0, "{table} was not swept");
            assert_eq!(
                count(&db, table, OTHER_ORG).await,
                kept,
                "{table}: another org's rows were deleted"
            );
        }
    }

    /// The consequence the sweep exists to prevent: `idx_alert_hygiene_configs_org` is
    /// UNIQUE, and auto-provisioned orgs reuse the deleted org's identifier.
    #[tokio::test]
    async fn a_recreated_org_can_still_write_its_config() {
        let db = db().await;
        alert_hygiene_configs::ActiveModel {
            id: Set("config-1".to_string()),
            org: Set(ORG.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();

        delete_by_org(&db, ORG).await.unwrap();

        alert_hygiene_configs::ActiveModel {
            id: Set("config-2".to_string()),
            org: Set(ORG.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .expect("a leftover config row blocked the re-created org");
    }

    /// The super-cluster sync uses this as an existence check before pushing a
    /// scheduler job, so a cross-org hit would create a job in the wrong org.
    #[tokio::test]
    async fn get_by_id_is_scoped_to_the_org() {
        let db = db().await;
        alert_hygiene_configs::ActiveModel {
            id: Set("config-1".to_string()),
            org: Set(ORG.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();

        assert!(get_by_id(&db, ORG, "config-1").await.unwrap().is_some());
        assert!(
            get_by_id(&db, OTHER_ORG, "config-1")
                .await
                .unwrap()
                .is_none(),
            "another org resolved a config it does not own"
        );
        assert!(get_by_id(&db, ORG, "missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_by_org_is_a_no_op_for_an_org_that_never_used_alert_hygiene() {
        let db = db().await;
        insert_row(&db, "alert_hygiene_configs", OTHER_ORG, "b").await;
        delete_by_org(&db, ORG).await.unwrap();
        assert_eq!(count(&db, "alert_hygiene_configs", OTHER_ORG).await, 1);
    }

    #[tokio::test]
    async fn get_by_org_returns_none_until_the_org_writes_a_config() {
        let db = db().await;
        assert!(get_by_org(&db, ORG).await.unwrap().is_none());

        upsert_config(&db, OTHER_ORG, new_config()).await.unwrap();

        assert!(
            get_by_org(&db, ORG).await.unwrap().is_none(),
            "an org read a config another org owns"
        );
        assert!(get_by_org(&db, OTHER_ORG).await.unwrap().is_some());
    }

    /// `idx_alert_hygiene_configs_org` is UNIQUE, so a second write that inserts instead
    /// of updating fails the org outright rather than merely duplicating a row.
    #[tokio::test]
    async fn writing_an_org_s_config_twice_leaves_exactly_one_row() {
        let db = db().await;
        let first = upsert_config(&db, ORG, new_config()).await.unwrap();
        let second = upsert_config(&db, ORG, new_config()).await.unwrap();

        assert_eq!(
            config_count(&db).await,
            1,
            "the second write duplicated the org's config"
        );
        assert_eq!(
            first.id, second.id,
            "the second write re-keyed the config, orphaning anything referencing the first id"
        );
    }

    #[tokio::test]
    async fn two_orgs_get_separate_config_rows() {
        let db = db().await;
        let mine = upsert_config(&db, ORG, new_config()).await.unwrap();
        let mut theirs = new_config();
        theirs.frequency_minutes = 15;
        let theirs = upsert_config(&db, OTHER_ORG, theirs).await.unwrap();

        assert_eq!(config_count(&db).await, 2);
        assert_ne!(mine.id, theirs.id);
        assert_eq!(
            get_by_org(&db, ORG)
                .await
                .unwrap()
                .unwrap()
                .frequency_minutes,
            60,
            "another org's write landed on this org's row"
        );
        assert_eq!(
            get_by_org(&db, OTHER_ORG)
                .await
                .unwrap()
                .unwrap()
                .frequency_minutes,
            15
        );
    }

    #[tokio::test]
    async fn a_full_write_replaces_every_settable_field() {
        let db = db().await;
        seeded_config(&db).await;

        let stored = upsert_config(
            &db,
            ORG,
            NewConfig {
                enabled: false,
                frequency_minutes: 5,
                window_minutes: 30,
            },
        )
        .await
        .unwrap();

        assert!(!stored.enabled);
        assert_eq!(stored.frequency_minutes, 5);
        assert_eq!(stored.window_minutes, 30);
    }

    /// `id` is `varchar(27)`, so a snowflake here would be rejected by postgres
    /// and silently truncated by a non-strict mysql.
    #[tokio::test]
    async fn a_generated_config_id_is_a_ksuid_that_fits_its_column() {
        let db = db().await;
        let stored = seeded_config(&db).await;

        assert_eq!(
            stored.id.len(),
            27,
            "config id {} is not a ksuid",
            stored.id
        );
        assert!(
            stored.id.parse::<u64>().is_err(),
            "config id {} is a snowflake, not a ksuid",
            stored.id
        );
    }

    #[tokio::test]
    async fn a_patch_of_enabled_alone_leaves_every_other_field_at_its_stored_value() {
        let db = db().await;
        let before = seeded_config(&db).await;

        let after = patch_config(
            &db,
            ORG,
            ConfigPatch {
                enabled: Patch::Set(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert!(!after.enabled, "an explicit false was dropped");
        assert_eq!(after.id, before.id);
        assert_eq!(after.frequency_minutes, before.frequency_minutes);
        assert_eq!(after.window_minutes, before.window_minutes);
    }

    #[tokio::test]
    async fn a_patch_of_frequency_minutes_alone_leaves_every_other_field_at_its_stored_value() {
        let db = db().await;
        let before = seeded_config(&db).await;

        let after = patch_config(
            &db,
            ORG,
            ConfigPatch {
                frequency_minutes: Patch::Set(15),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(after.frequency_minutes, 15);
        assert_eq!(after.id, before.id);
        assert_eq!(after.enabled, before.enabled);
        assert_eq!(after.window_minutes, before.window_minutes);
    }

    #[tokio::test]
    async fn a_patch_of_window_minutes_alone_leaves_every_other_field_at_its_stored_value() {
        let db = db().await;
        let before = seeded_config(&db).await;

        let after = patch_config(
            &db,
            ORG,
            ConfigPatch {
                window_minutes: Patch::Set(90),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(after.window_minutes, 90);
        assert_eq!(after.id, before.id);
        assert_eq!(after.enabled, before.enabled);
        assert_eq!(after.frequency_minutes, before.frequency_minutes);
    }

    #[tokio::test]
    async fn an_empty_patch_leaves_every_field_at_its_stored_value() {
        let db = db().await;
        let before = seeded_config(&db).await;

        let after = patch_config(&db, ORG, ConfigPatch::default())
            .await
            .unwrap();

        assert_eq!(after.id, before.id);
        assert_eq!(after.enabled, before.enabled);
        assert_eq!(after.frequency_minutes, before.frequency_minutes);
        assert_eq!(after.window_minutes, before.window_minutes);
    }

    /// The row is created lazily on the org's first write, so a patch has no
    /// stored value to keep and the migration's defaults stand in.
    #[tokio::test]
    async fn a_patch_creates_the_config_with_the_column_defaults_when_the_org_has_none() {
        let db = db().await;
        let created = patch_config(
            &db,
            ORG,
            ConfigPatch {
                enabled: Patch::Set(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert!(created.enabled);
        assert_eq!(created.frequency_minutes, 1440);
        assert_eq!(created.window_minutes, 43200);
        assert_eq!(config_count(&db).await, 1);
    }

    #[tokio::test]
    async fn patching_an_org_s_config_twice_leaves_exactly_one_row() {
        let db = db().await;
        let first = patch_config(
            &db,
            ORG,
            ConfigPatch {
                enabled: Patch::Set(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let second = patch_config(
            &db,
            ORG,
            ConfigPatch {
                window_minutes: Patch::Set(90),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(
            config_count(&db).await,
            1,
            "the second patch inserted a row"
        );
        assert_eq!(first.id, second.id, "the second patch re-keyed the config");
        assert!(
            second.enabled,
            "the second patch reset the first patch's field"
        );
    }

    #[tokio::test]
    async fn a_patch_never_touches_another_org_s_config() {
        let db = db().await;
        seeded_config(&db).await;
        let theirs = upsert_config(&db, OTHER_ORG, new_config()).await.unwrap();

        patch_config(
            &db,
            ORG,
            ConfigPatch {
                enabled: Patch::Set(false),
                frequency_minutes: Patch::Set(5),
                window_minutes: Patch::Set(30),
            },
        )
        .await
        .unwrap();

        assert_eq!(get_by_org(&db, OTHER_ORG).await.unwrap(), Some(theirs));
    }

    /// Both columns are epoch micros the writer supplies, so nothing but this
    /// layer stops an update from rewriting the row's own creation time.
    #[tokio::test]
    async fn an_update_keeps_created_at_and_moves_updated_at() {
        let db = db().await;
        let created = seeded_config(&db).await;
        assert!(
            created.created_at.is_some(),
            "the write left created_at null"
        );
        assert_eq!(created.created_at, created.updated_at);

        std::thread::sleep(std::time::Duration::from_millis(2));
        let patched = patch_config(
            &db,
            ORG,
            ConfigPatch {
                enabled: Patch::Set(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(
            patched.created_at, created.created_at,
            "the patch clobbered created_at"
        );
        assert!(
            patched.updated_at > created.updated_at,
            "the patch left updated_at behind"
        );

        std::thread::sleep(std::time::Duration::from_millis(2));
        let rewritten = upsert_config(&db, ORG, new_config()).await.unwrap();
        assert_eq!(
            rewritten.created_at, created.created_at,
            "the full write clobbered created_at"
        );
        assert!(
            rewritten.updated_at > patched.updated_at,
            "the full write left updated_at behind"
        );
    }

    /// The API contract is `{ enabled?, ... }`: absence must not decode as a value.
    #[test]
    fn an_absent_patch_field_decodes_as_unchanged_and_a_present_one_as_a_set_value() {
        let absent: ConfigPatch = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.enabled, Patch::Unchanged);
        assert_eq!(absent.frequency_minutes, Patch::Unchanged);
        assert_eq!(absent.window_minutes, Patch::Unchanged);

        let disabled: ConfigPatch = serde_json::from_str(r#"{"enabled": false}"#).unwrap();
        assert_eq!(
            disabled.enabled,
            Patch::Set(false),
            "an explicit false decoded as absence"
        );

        assert!(
            serde_json::from_str::<ConfigPatch>(r#"{"enabledd": true}"#).is_err(),
            "a misspelled field decoded as a patch that changes nothing"
        );
    }

    /// sqlite and postgres take `ON CONFLICT`, mysql `ON DUPLICATE KEY UPDATE`;
    /// a backend that silently emitted a plain INSERT would fail the unique org.
    #[test]
    fn the_config_upsert_compiles_to_conflict_handling_on_every_meta_store() {
        for (backend, clause) in [
            (DatabaseBackend::Sqlite, "ON CONFLICT"),
            (DatabaseBackend::Postgres, "ON CONFLICT"),
            (DatabaseBackend::MySql, "ON DUPLICATE KEY UPDATE"),
        ] {
            for model in [
                config_active_model(ORG, new_config(), NOW),
                patch_active_model(ORG, ConfigPatch::default(), NOW),
            ] {
                let sql = config_upsert_statement(model).build(backend).to_string();
                assert!(sql.contains(clause), "{backend:?} emitted no upsert: {sql}");
            }
        }
    }

    #[test]
    fn a_full_write_never_updates_the_row_s_identity_or_its_created_at() {
        let sql = config_upsert_statement(config_active_model(ORG, new_config(), NOW))
            .build(DatabaseBackend::Postgres)
            .to_string();
        let update = sql
            .split("DO UPDATE SET")
            .nth(1)
            .expect("no conflict clause");

        assert!(
            !update.contains("\"id\""),
            "an update re-keys the row: {update}"
        );
        assert!(
            !update.contains("\"org\""),
            "an update re-owns the row: {update}"
        );
        assert!(
            !update.contains("\"created_at\""),
            "an update rewrites created_at: {update}"
        );
        assert!(update.contains("\"updated_at\""));
        assert!(update.contains("\"enabled\""));
        assert!(update.contains("\"frequency_minutes\""));
        assert!(update.contains("\"window_minutes\""));
    }

    /// The column list is the whole guarantee: a column named here is written
    /// with the insert's value, which for an absent field is a default.
    #[test]
    fn a_patch_updates_only_the_columns_the_caller_set() {
        let patch = ConfigPatch {
            enabled: Patch::Set(true),
            ..Default::default()
        };
        let sql = config_upsert_statement(patch_active_model(ORG, patch, NOW))
            .build(DatabaseBackend::Postgres)
            .to_string();
        let update = sql
            .split("DO UPDATE SET")
            .nth(1)
            .expect("no conflict clause");

        assert!(update.contains("\"enabled\""));
        assert!(update.contains("\"updated_at\""));
        for absent in ["\"frequency_minutes\"", "\"window_minutes\""] {
            assert!(
                !update.contains(absent),
                "{absent} was not patched but is written anyway: {update}"
            );
        }
    }
}
