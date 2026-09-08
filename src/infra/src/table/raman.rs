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

//! Per-org config writes, digest writes and lookups, and org teardown for the raman tables.

use config::{ider, utils::time::now_micros};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, FromQueryResult, Insert, Iterable, QueryFilter, QueryOrder, QuerySelect, Select,
    TransactionTrait, sea_query::OnConflict,
};
use serde::{Deserialize, Deserializer, Serialize};

use super::entity::{raman_configs, raman_digests};
use crate::errors::{DbError, Error};

/// One scheduled run's digest, before the write gives it a row identity.
#[derive(Clone, Debug)]
pub struct NewDigest {
    pub org: String,
    pub config_id: String,
    pub cluster: String,
    pub window_start: i64,
    pub window_end: i64,
    pub generated_at: i64,
    pub finding_count: i32,
    pub findings: serde_json::Value,
    pub coverage_gap: bool,
}

/// One field of a partial update: `Unchanged` is absence, `Set` is an explicit
/// value, so no value of `T` can be mistaken for the caller having said nothing.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Patch<T> {
    #[default]
    Unchanged,
    Set(T),
}

/// An org's full raman settings, before the write gives them a row identity.
#[derive(Clone, Debug)]
pub struct NewConfig {
    pub enabled: bool,
    pub frequency_minutes: i32,
    pub window_minutes: i32,
    /// SQL NULL is "no overrides"; `{}` is an empty override document and stays one.
    pub rule_overrides: Option<serde_json::Value>,
}

/// The `{ enabled?, frequency_minutes?, window_minutes?, rule_overrides? }` body
/// of a partial config update, where every absent field means "leave it alone".
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ConfigPatch {
    pub enabled: Patch<bool>,
    pub frequency_minutes: Patch<i32>,
    pub window_minutes: Patch<i32>,
    /// `Set(None)` clears the overrides; `Unchanged` keeps whatever is stored.
    pub rule_overrides: Patch<Option<serde_json::Value>>,
}

/// A digest without its `findings` blob, so a timeline listing never ships one.
#[derive(Clone, Debug, PartialEq, FromQueryResult, Serialize, Deserialize)]
pub struct DigestSummary {
    pub id: String,
    pub org: String,
    pub config_id: String,
    pub cluster: String,
    pub window_start: i64,
    pub window_end: i64,
    pub generated_at: i64,
    pub finding_count: i32,
    pub coverage_gap: bool,
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    /// A present field is a set value, `null` included; absence never reaches here.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Patch::Set)
    }
}

/// Scoped by org so a config id leaked from another org can never resolve here.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<raman_configs::Model>, Error> {
    raman_configs::Entity::find_by_id(id)
        .filter(raman_configs::Column::Org.eq(org))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// The org's raman config, or `None` before the org has ever written one.
pub async fn get_by_org<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Option<raman_configs::Model>, Error> {
    raman_configs::Entity::find()
        .filter(raman_configs::Column::Org.eq(org))
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
) -> Result<raman_configs::Model, Error> {
    write_config(conn, org, config_active_model(org, config, now_micros())).await
}

/// Writes only the fields the caller set: an absent field keeps its stored value,
/// and on a first write takes the column default the migration declares.
pub async fn patch_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    patch: ConfigPatch,
) -> Result<raman_configs::Model, Error> {
    write_config(conn, org, patch_active_model(org, patch, now_micros())).await
}

/// Scoped by org for the same reason `get_by_id` is: the unique window key
/// carries no org, so a config id leaked from another org would resolve here.
pub async fn get_digest_for_window<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    config_id: &str,
    cluster: &str,
    window_start: i64,
    window_end: i64,
) -> Result<Option<raman_digests::Model>, Error> {
    raman_digests::Entity::find()
        .filter(raman_digests::Column::Org.eq(org))
        .filter(raman_digests::Column::ConfigId.eq(config_id))
        .filter(raman_digests::Column::Cluster.eq(cluster))
        .filter(raman_digests::Column::WindowStart.eq(window_start))
        .filter(raman_digests::Column::WindowEnd.eq(window_end))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Idempotent per window: the scheduler can re-pull a run that overran its
/// keep-alive, and the second attempt must overwrite rather than duplicate.
pub async fn upsert_digest<C: ConnectionTrait>(
    conn: &C,
    digest: NewDigest,
) -> Result<raman_digests::Model, Error> {
    let org = digest.org.clone();
    let config_id = digest.config_id.clone();
    let cluster = digest.cluster.clone();
    let (window_start, window_end) = (digest.window_start, digest.window_end);

    digest_upsert_statement(digest_active_model(digest))
        .exec_without_returning(conn)
        .await?;

    get_digest_for_window(conn, &org, &config_id, &cluster, window_start, window_end)
        .await?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(
                "raman digest disappeared between its upsert and its read-back".to_string(),
            ))
        })
}

/// Scoped by org for the same reason `get_by_id` is: an id leaked from another
/// org must not resolve a digest here.
pub async fn get_digest_by_id<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<raman_digests::Model>, Error> {
    raman_digests::Entity::find_by_id(id)
        .filter(raman_digests::Column::Org.eq(org))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Newest first and without `findings`, served by `idx_raman_digests_org_window_end`.
pub async fn list_digest_summaries<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    limit: u64,
    offset: u64,
) -> Result<Vec<DigestSummary>, Error> {
    digest_summary_query(org, limit, offset)
        .into_model::<DigestSummary>()
        .all(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Removes the org's raman config together with every digest it produced.
pub async fn delete_by_org(db: &DatabaseConnection, org: &str) -> Result<(), Error> {
    let txn = db.begin().await?;
    // Digests identify their run through `config_id`, so they go before the config.
    raman_digests::Entity::delete_many()
        .filter(raman_digests::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    raman_configs::Entity::delete_many()
        .filter(raman_configs::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

async fn write_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    model: raman_configs::ActiveModel,
) -> Result<raman_configs::Model, Error> {
    config_upsert_statement(model)
        .exec_without_returning(conn)
        .await?;

    get_by_org(conn, org).await?.ok_or_else(|| {
        Error::DbError(DbError::SeaORMError(
            "raman config disappeared between its upsert and its read-back".to_string(),
        ))
    })
}

fn config_active_model(org: &str, config: NewConfig, now: i64) -> raman_configs::ActiveModel {
    raman_configs::ActiveModel {
        id: Set(ider::uuid()),
        org: Set(org.to_string()),
        enabled: Set(config.enabled),
        frequency_minutes: Set(config.frequency_minutes),
        window_minutes: Set(config.window_minutes),
        rule_overrides: Set(config.rule_overrides),
        created_at: Set(Some(now)),
        updated_at: Set(Some(now)),
    }
}

/// A field the patch leaves `Unchanged` stays `NotSet`, which keeps it out of
/// both the INSERT and the conflict clause `config_update_columns` derives.
fn patch_active_model(org: &str, patch: ConfigPatch, now: i64) -> raman_configs::ActiveModel {
    let mut model = raman_configs::ActiveModel {
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
    if let Patch::Set(rule_overrides) = patch.rule_overrides {
        model.rule_overrides = Set(rule_overrides);
    }
    model
}

/// Every column the write actually set, minus the ones an update must not move:
/// `id` and `org` key the row, and `created_at` records when it first appeared.
fn config_update_columns(model: &raman_configs::ActiveModel) -> Vec<raman_configs::Column> {
    raman_configs::Column::iter()
        .filter(|column| {
            !matches!(
                column,
                raman_configs::Column::Id
                    | raman_configs::Column::Org
                    | raman_configs::Column::CreatedAt
            )
        })
        .filter(|column| model.get(*column).is_set())
        .collect()
}

fn config_upsert_statement(
    model: raman_configs::ActiveModel,
) -> Insert<raman_configs::ActiveModel> {
    let updated = config_update_columns(&model);
    raman_configs::Entity::insert(model).on_conflict(
        // mysql ignores this target and fires on any unique key, the same key here.
        OnConflict::column(raman_configs::Column::Org)
            .update_columns(updated)
            .to_owned(),
    )
}

fn digest_active_model(digest: NewDigest) -> raman_digests::ActiveModel {
    raman_digests::ActiveModel {
        id: Set(ider::uuid()),
        org: Set(digest.org),
        config_id: Set(digest.config_id),
        cluster: Set(digest.cluster),
        window_start: Set(digest.window_start),
        window_end: Set(digest.window_end),
        generated_at: Set(digest.generated_at),
        finding_count: Set(digest.finding_count),
        findings: Set(digest.findings),
        coverage_gap: Set(digest.coverage_gap),
    }
}

fn digest_upsert_statement(
    model: raman_digests::ActiveModel,
) -> Insert<raman_digests::ActiveModel> {
    raman_digests::Entity::insert(model).on_conflict(
        // mysql ignores this target and fires on any unique key, the same key here.
        OnConflict::columns([
            raman_digests::Column::ConfigId,
            raman_digests::Column::Cluster,
            raman_digests::Column::WindowStart,
            raman_digests::Column::WindowEnd,
        ])
        // `id` is excluded so a re-run cannot re-key a digest others already reference.
        .update_columns([
            raman_digests::Column::Org,
            raman_digests::Column::GeneratedAt,
            raman_digests::Column::FindingCount,
            raman_digests::Column::Findings,
            raman_digests::Column::CoverageGap,
        ])
        .to_owned(),
    )
}

fn digest_summary_query(org: &str, limit: u64, offset: u64) -> Select<raman_digests::Entity> {
    raman_digests::Entity::find()
        .select_only()
        .columns([
            raman_digests::Column::Id,
            raman_digests::Column::Org,
            raman_digests::Column::ConfigId,
            raman_digests::Column::Cluster,
            raman_digests::Column::WindowStart,
            raman_digests::Column::WindowEnd,
            raman_digests::Column::GeneratedAt,
            raman_digests::Column::FindingCount,
            raman_digests::Column::CoverageGap,
        ])
        .filter(raman_digests::Column::Org.eq(org))
        .order_by_desc(raman_digests::Column::WindowEnd)
        // Per-cluster runs share a window, so `id` keeps a page boundary stable.
        .order_by_desc(raman_digests::Column::Id)
        .limit(limit)
        .offset(offset)
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ActiveValue::Set, ConnectionTrait, Database, DatabaseBackend,
        PaginatorTrait, QueryTrait, Statement,
    };

    use super::*;
    use crate::table::migration::{create_raman_tables_for_test, raman_migration_sql_for_test};

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";
    const CONFIG: &str = "config-1";
    const WINDOW_START: i64 = 1_757_000_000_000_000;
    const WINDOW_END: i64 = 1_757_003_600_000_000;
    const NOW: i64 = 1_757_004_000_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_raman_tables_for_test(&db).await.unwrap();
        db
    }

    fn new_digest(config_id: &str, cluster: &str, window_start: i64, window_end: i64) -> NewDigest {
        NewDigest {
            org: ORG.to_string(),
            config_id: config_id.to_string(),
            cluster: cluster.to_string(),
            window_start,
            window_end,
            generated_at: window_end,
            finding_count: 0,
            findings: serde_json::json!([]),
            coverage_gap: false,
        }
    }

    async fn digest_count(db: &DatabaseConnection) -> u64 {
        raman_digests::Entity::find().count(db).await.unwrap()
    }

    fn new_config() -> NewConfig {
        NewConfig {
            enabled: true,
            frequency_minutes: 60,
            window_minutes: 720,
            rule_overrides: Some(serde_json::json!({"noise": {"enabled": false}})),
        }
    }

    async fn config_count(db: &DatabaseConnection) -> u64 {
        raman_configs::Entity::find().count(db).await.unwrap()
    }

    async fn seeded_config(db: &DatabaseConnection) -> raman_configs::Model {
        upsert_config(db, ORG, new_config()).await.unwrap()
    }

    async fn seed_digest(db: &DatabaseConnection, window_end: i64) -> raman_digests::Model {
        upsert_digest(
            db,
            new_digest(CONFIG, "", window_end - 3_600_000_000, window_end),
        )
        .await
        .unwrap()
    }

    /// Every table the raman migration creates, read from the migration itself
    /// so a table added later cannot quietly escape the sweep test below.
    fn migrated_tables() -> Vec<String> {
        raman_migration_sql_for_test(DatabaseBackend::Sqlite)
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

    /// The completeness pin: a raman table added to the migration but not to
    /// `delete_by_org` fails here, without anyone remembering to update a list.
    #[tokio::test]
    async fn delete_by_org_sweeps_every_org_scoped_raman_table() {
        let db = db().await;
        let tables = migrated_tables();
        assert!(!tables.is_empty(), "the raman migration creates tables");

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
        assert!(!swept.is_empty(), "no org-scoped raman table was exercised");

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
            let mut digest = new_digest(CONFIG, "eu-1", WINDOW_START, WINDOW_END);
            digest.org = org.to_string();
            // The digest window key carries no org, so each org needs its own config id.
            digest.config_id = format!("config-{org}");
            upsert_digest(&db, digest).await.unwrap();
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

    /// The consequence the sweep exists to prevent: `idx_raman_configs_org` is
    /// UNIQUE, and auto-provisioned orgs reuse the deleted org's identifier.
    #[tokio::test]
    async fn a_recreated_org_can_still_write_its_config() {
        let db = db().await;
        raman_configs::ActiveModel {
            id: Set("config-1".to_string()),
            org: Set(ORG.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();

        delete_by_org(&db, ORG).await.unwrap();

        raman_configs::ActiveModel {
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
        raman_configs::ActiveModel {
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
    async fn delete_by_org_is_a_no_op_for_an_org_that_never_used_raman() {
        let db = db().await;
        insert_row(&db, "raman_configs", OTHER_ORG, "b").await;
        delete_by_org(&db, ORG).await.unwrap();
        assert_eq!(count(&db, "raman_configs", OTHER_ORG).await, 1);
    }

    /// The 900 s keep-alive ceiling lets the scheduler re-pull a run that is still
    /// executing, so both attempts write the same window.
    #[tokio::test]
    async fn re_running_the_same_window_leaves_exactly_one_digest() {
        let db = db().await;
        let first = upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        let second = upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();

        assert_eq!(
            digest_count(&db).await,
            1,
            "the re-run duplicated the window"
        );
        assert_eq!(
            first.id, second.id,
            "the re-run re-keyed the digest, orphaning anything referencing the first id"
        );
    }

    /// The second attempt overwrites, because a re-run may have seen a coverage
    /// gap the first did not.
    #[tokio::test]
    async fn a_re_run_overwrites_the_payload_of_the_digest_it_replaces() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();

        let mut rerun = new_digest(CONFIG, "", WINDOW_START, WINDOW_END);
        rerun.generated_at = WINDOW_END + 900_000_000;
        rerun.finding_count = 3;
        rerun.findings = serde_json::json!([{"rule_id": "noise"}]);
        rerun.coverage_gap = true;
        let stored = upsert_digest(&db, rerun).await.unwrap();

        assert_eq!(stored.generated_at, WINDOW_END + 900_000_000);
        assert_eq!(stored.finding_count, 3);
        assert_eq!(stored.findings, serde_json::json!([{"rule_id": "noise"}]));
        assert!(
            stored.coverage_gap,
            "the re-run's coverage gap was discarded"
        );
    }

    #[tokio::test]
    async fn a_different_window_gets_its_own_digest_row() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        upsert_digest(
            &db,
            new_digest(
                CONFIG,
                "",
                WINDOW_START + 3_600_000_000,
                WINDOW_END + 3_600_000_000,
            ),
        )
        .await
        .unwrap();

        assert_eq!(
            digest_count(&db).await,
            2,
            "the next window overwrote the previous one"
        );
    }

    /// Per-cluster runs analyse the same window, so they collide without
    /// `cluster` in the key.
    #[tokio::test]
    async fn a_different_cluster_gets_its_own_digest_row() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        upsert_digest(&db, new_digest(CONFIG, "eu-1", WINDOW_START, WINDOW_END))
            .await
            .unwrap();

        assert_eq!(
            digest_count(&db).await,
            2,
            "a second cluster's run overwrote the first cluster's digest"
        );
    }

    #[tokio::test]
    async fn a_different_config_gets_its_own_digest_row() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        upsert_digest(&db, new_digest("config-2", "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();

        assert_eq!(
            digest_count(&db).await,
            2,
            "another config's run overwrote this config's digest"
        );
    }

    #[tokio::test]
    async fn a_large_findings_payload_round_trips_intact() {
        let db = db().await;
        let findings = serde_json::Value::Array(
            (0..500)
                .map(|i| {
                    serde_json::json!({
                        "rule_id": format!("noise-{i}"),
                        "severity": "High",
                        "subject_alert_ids": [format!("alert-{i}"), format!("alert-{}", i + 1)],
                        "evidence": {"kind": "Noise", "firings": i, "ratio": 0.75},
                        "note": "a \u{1f50e} unicode \"quoted\" string with a , comma",
                    })
                })
                .collect(),
        );

        let mut digest = new_digest(CONFIG, "", WINDOW_START, WINDOW_END);
        digest.finding_count = 500;
        digest.findings = findings.clone();
        upsert_digest(&db, digest).await.unwrap();

        let stored = get_digest_for_window(&db, ORG, CONFIG, "", WINDOW_START, WINDOW_END)
            .await
            .unwrap()
            .expect("the digest was not written");
        assert_eq!(stored.findings, findings);
    }

    /// The payload is queried with `json_get`, which needs the array at the top
    /// level rather than a wrapper object or a doubly-encoded string.
    #[tokio::test]
    async fn the_findings_column_holds_the_payload_verbatim_at_its_top_level() {
        let db = db().await;
        let findings = serde_json::json!([{"rule_id": "silent", "severity": "Low"}]);
        let mut digest = new_digest(CONFIG, "", WINDOW_START, WINDOW_END);
        digest.findings = findings.clone();
        upsert_digest(&db, digest).await.unwrap();

        let raw: String = db
            .query_one(Statement::from_string(
                DatabaseBackend::Sqlite,
                "SELECT findings FROM raman_digests".to_string(),
            ))
            .await
            .unwrap()
            .unwrap()
            .try_get("", "findings")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&raw).unwrap(),
            findings,
            "the findings column is not the payload itself: {raw}"
        );
    }

    /// A digest that under-covered its window must say so; a defaulted `false`
    /// makes it lie about its own completeness.
    #[tokio::test]
    async fn a_coverage_gap_survives_the_round_trip() {
        let db = db().await;
        let mut digest = new_digest(CONFIG, "", WINDOW_START, WINDOW_END);
        digest.coverage_gap = true;
        let returned = upsert_digest(&db, digest).await.unwrap();
        assert!(returned.coverage_gap);

        let stored = get_digest_for_window(&db, ORG, CONFIG, "", WINDOW_START, WINDOW_END)
            .await
            .unwrap()
            .expect("the digest was not written");
        assert!(stored.coverage_gap, "the coverage gap was dropped on write");
    }

    #[tokio::test]
    async fn delete_by_org_sweeps_upserted_digests() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        let mut other = new_digest(CONFIG, "", WINDOW_START, WINDOW_END);
        other.org = OTHER_ORG.to_string();
        other.config_id = "config-2".to_string();
        upsert_digest(&db, other).await.unwrap();

        delete_by_org(&db, ORG).await.unwrap();

        assert_eq!(count(&db, "raman_digests", ORG).await, 0);
        assert_eq!(count(&db, "raman_digests", OTHER_ORG).await, 1);
    }

    /// `id` is `varchar(27)`, so a snowflake id here would be rejected by
    /// postgres and silently truncated by a non-strict mysql.
    #[tokio::test]
    async fn a_generated_digest_id_is_a_ksuid_that_fits_its_column() {
        let db = db().await;
        let stored = upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        assert_eq!(
            stored.id.len(),
            27,
            "digest id {} is not a ksuid",
            stored.id
        );
    }

    /// sqlite and postgres take `ON CONFLICT`, mysql `ON DUPLICATE KEY UPDATE`;
    /// a backend that silently emitted a plain INSERT would duplicate the window.
    #[test]
    fn the_digest_upsert_compiles_to_conflict_handling_on_every_meta_store() {
        for (backend, clause) in [
            (DatabaseBackend::Sqlite, "ON CONFLICT"),
            (DatabaseBackend::Postgres, "ON CONFLICT"),
            (DatabaseBackend::MySql, "ON DUPLICATE KEY UPDATE"),
        ] {
            let sql = digest_upsert_statement(digest_active_model(new_digest(
                CONFIG,
                "",
                WINDOW_START,
                WINDOW_END,
            )))
            .build(backend)
            .to_string();
            assert!(sql.contains(clause), "{backend:?} emitted no upsert: {sql}");
        }
    }

    /// The digest read backs the org-scoped API, so a config id leaked from
    /// another org must not resolve a window here either.
    #[tokio::test]
    async fn get_digest_for_window_is_scoped_to_the_org() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "", WINDOW_START, WINDOW_END))
            .await
            .unwrap();

        assert!(
            get_digest_for_window(&db, OTHER_ORG, CONFIG, "", WINDOW_START, WINDOW_END)
                .await
                .unwrap()
                .is_none(),
            "another org read a digest it does not own"
        );
        assert!(
            get_digest_for_window(&db, ORG, CONFIG, "", WINDOW_START, WINDOW_END + 1)
                .await
                .unwrap()
                .is_none()
        );
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

    /// `idx_raman_configs_org` is UNIQUE, so a second write that inserts instead
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
                rule_overrides: None,
            },
        )
        .await
        .unwrap();

        assert!(!stored.enabled);
        assert_eq!(stored.frequency_minutes, 5);
        assert_eq!(stored.window_minutes, 30);
        assert_eq!(stored.rule_overrides, None);
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
        assert_eq!(after.rule_overrides, before.rule_overrides);
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
        assert_eq!(after.rule_overrides, before.rule_overrides);
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
        assert_eq!(after.rule_overrides, before.rule_overrides);
    }

    #[tokio::test]
    async fn a_patch_of_rule_overrides_alone_leaves_every_other_field_at_its_stored_value() {
        let db = db().await;
        let before = seeded_config(&db).await;
        let overrides = serde_json::json!({"silent": {"enabled": true}});

        let after = patch_config(
            &db,
            ORG,
            ConfigPatch {
                rule_overrides: Patch::Set(Some(overrides.clone())),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(after.rule_overrides, Some(overrides));
        assert_eq!(after.id, before.id);
        assert_eq!(after.enabled, before.enabled);
        assert_eq!(after.frequency_minutes, before.frequency_minutes);
        assert_eq!(after.window_minutes, before.window_minutes);
    }

    /// NULL is the one "no overrides"; clearing must reach it explicitly.
    #[tokio::test]
    async fn a_patch_clears_rule_overrides_only_when_it_sets_them_to_null() {
        let db = db().await;
        let before = seeded_config(&db).await;
        assert!(
            before.rule_overrides.is_some(),
            "the fixture stores overrides"
        );

        patch_config(&db, ORG, ConfigPatch::default())
            .await
            .unwrap();
        assert_eq!(
            get_by_org(&db, ORG).await.unwrap().unwrap().rule_overrides,
            before.rule_overrides,
            "an absent rule_overrides cleared the stored overrides"
        );

        let cleared = patch_config(
            &db,
            ORG,
            ConfigPatch {
                rule_overrides: Patch::Set(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(cleared.rule_overrides, None);
    }

    /// An empty override document is a decision the caller made; NULL is the
    /// absence of one, and collapsing the two loses that distinction.
    #[tokio::test]
    async fn an_empty_rule_overrides_object_is_stored_as_an_object_and_not_as_null() {
        let db = db().await;
        seeded_config(&db).await;

        let after = patch_config(
            &db,
            ORG,
            ConfigPatch {
                rule_overrides: Patch::Set(Some(serde_json::json!({}))),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(after.rule_overrides, Some(serde_json::json!({})));
        assert_ne!(after.rule_overrides, None);
    }

    #[tokio::test]
    async fn a_non_trivial_rule_overrides_payload_round_trips_intact() {
        let db = db().await;
        let overrides = serde_json::json!({
            "noise": {"enabled": false, "min_firings": 12, "labels": ["a", "b"]},
            "silent": {"enabled": true, "note": "a \u{1f50e} \"quoted\" string, with a comma"},
            "nested": {"deep": {"deeper": [1, 2.5, null, true]}},
        });
        let mut config = new_config();
        config.rule_overrides = Some(overrides.clone());
        upsert_config(&db, ORG, config).await.unwrap();

        assert_eq!(
            get_by_org(&db, ORG).await.unwrap().unwrap().rule_overrides,
            Some(overrides)
        );
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
        assert_eq!(after.rule_overrides, before.rule_overrides);
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
        assert_eq!(created.rule_overrides, None);
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
                rule_overrides: Patch::Set(None),
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

    /// The API contract is `{ enabled?, ... }`: absence must not decode as a
    /// value, and an explicit `null` must not decode as absence.
    #[test]
    fn an_absent_patch_field_decodes_as_unchanged_and_an_explicit_null_as_a_cleared_value() {
        let absent: ConfigPatch = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.enabled, Patch::Unchanged);
        assert_eq!(absent.frequency_minutes, Patch::Unchanged);
        assert_eq!(absent.window_minutes, Patch::Unchanged);
        assert_eq!(absent.rule_overrides, Patch::Unchanged);

        let cleared: ConfigPatch = serde_json::from_str(r#"{"rule_overrides": null}"#).unwrap();
        assert_eq!(cleared.rule_overrides, Patch::Set(None));

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
        assert!(update.contains("\"rule_overrides\""));
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
        for absent in [
            "\"frequency_minutes\"",
            "\"window_minutes\"",
            "\"rule_overrides\"",
        ] {
            assert!(
                !update.contains(absent),
                "{absent} was not patched but is written anyway: {update}"
            );
        }
    }

    #[tokio::test]
    async fn digest_summaries_are_listed_newest_window_first() {
        let db = db().await;
        let oldest = seed_digest(&db, WINDOW_END).await;
        let middle = seed_digest(&db, WINDOW_END + 3_600_000_000).await;
        let newest = seed_digest(&db, WINDOW_END + 7_200_000_000).await;

        let listed = list_digest_summaries(&db, ORG, 10, 0).await.unwrap();

        assert_eq!(
            listed.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(),
            vec![newest.id.as_str(), middle.id.as_str(), oldest.id.as_str()]
        );
        assert_eq!(listed[0].window_end, newest.window_end);
        assert_eq!(listed[0].finding_count, newest.finding_count);
        assert_eq!(listed[0].coverage_gap, newest.coverage_gap);
        assert_eq!(listed[0].config_id, newest.config_id);
        assert_eq!(listed[0].cluster, newest.cluster);
        assert_eq!(listed[0].window_start, newest.window_start);
        assert_eq!(listed[0].generated_at, newest.generated_at);
        assert_eq!(listed[0].org, ORG);
    }

    #[tokio::test]
    async fn digest_summaries_page_through_the_org_s_timeline_without_repeating_a_row() {
        let db = db().await;
        seed_digest(&db, WINDOW_END).await;
        seed_digest(&db, WINDOW_END + 3_600_000_000).await;
        seed_digest(&db, WINDOW_END + 7_200_000_000).await;

        let first = list_digest_summaries(&db, ORG, 2, 0).await.unwrap();
        let second = list_digest_summaries(&db, ORG, 2, 2).await.unwrap();
        let past_the_end = list_digest_summaries(&db, ORG, 2, 9).await.unwrap();

        assert_eq!(first.len(), 2);
        assert_eq!(second.len(), 1);
        assert!(past_the_end.is_empty());
        assert!(
            !first.iter().any(|d| d.id == second[0].id),
            "a row appeared on two pages"
        );
    }

    /// Per-cluster runs of one window share a `window_end`, and paging across
    /// them must serve each row exactly once.
    #[tokio::test]
    async fn digest_summaries_of_one_window_page_deterministically_across_clusters() {
        let db = db().await;
        upsert_digest(&db, new_digest(CONFIG, "eu-1", WINDOW_START, WINDOW_END))
            .await
            .unwrap();
        upsert_digest(&db, new_digest(CONFIG, "us-1", WINDOW_START, WINDOW_END))
            .await
            .unwrap();

        let whole = list_digest_summaries(&db, ORG, 10, 0).await.unwrap();
        let first = list_digest_summaries(&db, ORG, 1, 0).await.unwrap();
        let second = list_digest_summaries(&db, ORG, 1, 1).await.unwrap();

        assert_eq!(whole.len(), 2);
        assert_ne!(first[0].id, second[0].id, "one row filled both pages");
        assert_eq!(first[0].id, whole[0].id);
        assert_eq!(second[0].id, whole[1].id);
    }

    #[tokio::test]
    async fn digest_summaries_are_scoped_to_the_org() {
        let db = db().await;
        seed_digest(&db, WINDOW_END).await;
        let mut theirs = new_digest("config-2", "", WINDOW_START, WINDOW_END);
        theirs.org = OTHER_ORG.to_string();
        upsert_digest(&db, theirs).await.unwrap();

        let listed = list_digest_summaries(&db, ORG, 10, 0).await.unwrap();

        assert_eq!(listed.len(), 1, "another org's digests were listed");
        assert_eq!(listed[0].org, ORG);
    }

    /// The blob is why the summary exists: a timeline must never ship it.
    #[test]
    fn the_digest_summary_query_never_selects_the_findings_blob() {
        for backend in [
            DatabaseBackend::Sqlite,
            DatabaseBackend::Postgres,
            DatabaseBackend::MySql,
        ] {
            let sql = digest_summary_query(ORG, 10, 0).build(backend).to_string();
            assert!(
                !sql.contains("findings"),
                "{backend:?} ships the findings blob: {sql}"
            );
            assert!(sql.contains("finding_count"), "{backend:?}: {sql}");
        }
    }

    /// `idx_raman_digests_org_window_end` has to serve both the filter and the
    /// leading sort key, or a timeline page sorts the whole org's history.
    #[test]
    fn the_digest_summary_query_filters_and_sorts_on_the_indexed_columns() {
        let sql = digest_summary_query(ORG, 10, 5)
            .build(DatabaseBackend::Postgres)
            .to_string();

        assert!(sql.contains(r#""raman_digests"."org" = 'acme'"#), "{sql}");
        assert!(
            sql.contains(
                r#"ORDER BY "raman_digests"."window_end" DESC, "raman_digests"."id" DESC"#
            ),
            "a page boundary inside one window is not deterministic: {sql}"
        );
        assert!(sql.contains("LIMIT 10"), "{sql}");
        assert!(sql.contains("OFFSET 5"), "{sql}");
    }

    #[tokio::test]
    async fn get_digest_by_id_is_scoped_to_the_org() {
        let db = db().await;
        let stored = seed_digest(&db, WINDOW_END).await;

        assert!(
            get_digest_by_id(&db, ORG, &stored.id)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            get_digest_by_id(&db, OTHER_ORG, &stored.id)
                .await
                .unwrap()
                .is_none(),
            "another org read a digest it does not own"
        );
        assert!(
            get_digest_by_id(&db, ORG, "missing")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn get_digest_by_id_returns_the_findings_the_summary_leaves_out() {
        let db = db().await;
        let findings = serde_json::json!([{"rule_id": "noise", "severity": "High"}]);
        let mut digest = new_digest(CONFIG, "", WINDOW_START, WINDOW_END);
        digest.findings = findings.clone();
        digest.finding_count = 1;
        let stored = upsert_digest(&db, digest).await.unwrap();

        let read = get_digest_by_id(&db, ORG, &stored.id)
            .await
            .unwrap()
            .expect("the digest was not written");

        assert_eq!(read.findings, findings);
        assert_eq!(read.finding_count, 1);
    }
}
