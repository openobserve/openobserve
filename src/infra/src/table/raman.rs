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

//! Digest writes, lookups and org teardown for the raman tables.

use config::ider;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, Insert,
    QueryFilter, TransactionTrait, sea_query::OnConflict,
};

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

        delete_by_org(&db, ORG).await.unwrap();

        for table in &swept {
            assert_eq!(count(&db, table, ORG).await, 0, "{table} was not swept");
            assert_eq!(
                count(&db, table, OTHER_ORG).await,
                1,
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
}
