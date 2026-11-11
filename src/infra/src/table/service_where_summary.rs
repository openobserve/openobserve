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

use std::collections::BTreeMap;

use config::meta::service_identity::WhereSummaryRecord;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, DbErr, EntityTrait, QueryFilter, QueryOrder,
    Statement,
    sea_query::{Expr, Func, OnConflict, Query, SimpleExpr},
};

use super::{
    entity::{
        service_versions as service_versions_entity,
        service_where_summary::{Column, Entity, Model},
    },
    service_versions::{Dialect, TABLE as REGISTRY_TABLE, UPSERT_CHUNK_ROWS},
};
use crate::errors;

const TABLE: &str = "service_where_summary";
const INSERT_COLUMNS: [Column; 21] = [
    Column::SummaryKey,
    Column::OrgId,
    Column::ServiceName,
    Column::WhereKey,
    Column::ScopeKey,
    Column::SourceStream,
    Column::Signal,
    Column::K8sCluster,
    Column::K8sNamespace,
    Column::Env,
    Column::EnvSource,
    Column::EnvSourceValue,
    Column::Envs,
    Column::NewestVersion,
    Column::NewestVersionKey,
    Column::NewestFirstSeen,
    Column::HasVersion,
    Column::FirstSeen,
    Column::LastSeen,
    Column::PurgedVersions,
    Column::UpdatedAt,
];

/// Folds every record into its row in one conditional upsert per chunk; returns the statements run.
pub async fn upsert_many<C: ConnectionTrait>(
    conn: &C,
    records: Vec<WhereSummaryRecord>,
) -> Result<usize, errors::Error> {
    let statements = upsert_statements(conn.get_database_backend(), records);
    for statement in &statements {
        conn.execute(statement.clone()).await?;
    }
    Ok(statements.len())
}

/// The conflict-clause assignments for `backend`: `WhereSummaryRecord::merge` with registry ranks.
pub fn summary_upsert_exprs(backend: DbBackend) -> Vec<(Column, SimpleExpr)> {
    let sql = Dialect::new(backend, TABLE);
    let (t, e) = (|c: &str| sql.stored(c), |c: &str| sql.incoming(c));
    // Re-read from the registry: late history or a delayed write must not keep a stale rank.
    let registry_rank = |side: &dyn Fn(&str) -> String| {
        format!(
            "COALESCE((SELECT r.\"first_seen\" FROM \"{REGISTRY_TABLE}\" r WHERE r.\"version_key\" \
             = {}), {})",
            side("newest_version_key"),
            side("newest_first_seen")
        )
    };
    // A real version always outranks '', so a version-less stream never hides a released one.
    let version_rank = |side: &dyn Fn(&str) -> String| {
        sql.rank(&[
            format!("({} <> '')", side("newest_version")),
            registry_rank(side),
            sql.bytes(&side("newest_version_key")),
        ])
    };
    let env_rank = |side: &dyn Fn(&str) -> String| {
        sql.rank(&[
            side("first_seen"),
            sql.bytes(&side("env")),
            sql.bytes(&side("env_source")),
            sql.bytes(&side("env_source_value")),
        ])
    };
    let name_rank = |side: &dyn Fn(&str) -> String| {
        sql.rank(&[side("last_seen"), sql.bytes(&side("service_name"))])
    };
    let newer_version = format!("{} > {}", version_rank(&e), version_rank(&t));
    let newer_name = format!("{} > {}", name_rank(&e), name_rank(&t));
    let first_env = format!("{} < {}", env_rank(&e), env_rank(&t));
    let pick = |condition: &str, name: &str| {
        format!(
            "CASE WHEN {condition} THEN {} ELSE {} END",
            e(name),
            t(name)
        )
    };
    let exprs: Vec<(Column, String)> = vec![
        (Column::ServiceName, pick(&newer_name, "service_name")),
        (
            Column::NewestVersion,
            pick(&newer_version, "newest_version"),
        ),
        (
            Column::NewestVersionKey,
            pick(&newer_version, "newest_version_key"),
        ),
        (
            Column::NewestFirstSeen,
            format!(
                "CASE WHEN {newer_version} THEN {} ELSE {} END",
                registry_rank(&e),
                registry_rank(&t)
            ),
        ),
        (Column::Env, pick(&first_env, "env")),
        (Column::EnvSource, pick(&first_env, "env_source")),
        (Column::EnvSourceValue, pick(&first_env, "env_source_value")),
        (Column::Envs, env_union(backend, &t("envs"), &e("envs"))),
        (
            Column::HasVersion,
            format!("({} OR {})", t("has_version"), e("has_version")),
        ),
        (
            Column::FirstSeen,
            sql.least(&t("first_seen"), &e("first_seen")),
        ),
        (
            Column::LastSeen,
            sql.greatest(&t("last_seen"), &e("last_seen")),
        ),
        (
            Column::PurgedVersions,
            sql.greatest(&t("purged_versions"), &e("purged_versions")),
        ),
        (
            Column::UpdatedAt,
            sql.greatest(&t("updated_at"), &e("updated_at")),
        ),
    ];
    exprs
        .into_iter()
        .map(|(column, text)| (column, Expr::cust(text)))
        .collect()
}

/// Every summary row of the org, most recently seen first.
pub async fn list_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<WhereSummaryRecord>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_desc(Column::LastSeen)
        .order_by_asc(Column::SummaryKey)
        .all(conn)
        .await?
        .into_iter()
        .map(to_record)
        .collect()
}

pub async fn catalog_page<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scopes: &[String],
    limit: usize,
    offset: usize,
) -> Result<Vec<String>, errors::Error> {
    if scopes.is_empty() {
        return Ok(Vec::new());
    }
    let quoted = scopes
        .iter()
        .map(|key| format!("'{}'", key.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT s.scope_key FROM service_where_summary s LEFT JOIN service_versions v ON v.org_id = s.org_id AND v.version_key = s.newest_version_key AND (v.deleted_at IS NULL OR v.last_seen > v.deleted_at) WHERE s.org_id = $1 AND s.scope_key IN ({quoted}) GROUP BY s.scope_key ORDER BY COALESCE(MAX(v.first_seen), -9223372036854775807) DESC, s.scope_key ASC LIMIT {} OFFSET {}",
        limit.min(1000),
        offset
    );
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            vec![org_id.into()],
        ))
        .await?;
    rows.into_iter()
        .map(|row| row.try_get("", "scope_key").map_err(Into::into))
        .collect()
}

/// Matches the exact `org_id` only, so a sibling org with a shared prefix keeps its rows.
pub async fn delete_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

/// Repeated keys go to later statements, never folded, so the database ranks every candidate.
fn upsert_statements(backend: DbBackend, records: Vec<WhereSummaryRecord>) -> Vec<Statement> {
    // PostgreSQL rejects a statement that updates one row twice.
    let mut layers: Vec<BTreeMap<String, WhereSummaryRecord>> = Vec::new();
    for record in records.into_iter().flat_map(one_env_each) {
        match layers
            .iter_mut()
            .find(|layer| !layer.contains_key(&record.summary_key))
        {
            Some(layer) => {
                layer.insert(record.summary_key.clone(), record);
            }
            None => layers.push(BTreeMap::from([(record.summary_key.clone(), record)])),
        }
    }
    let on_conflict = OnConflict::column(Column::SummaryKey)
        .values(summary_upsert_exprs(backend))
        .to_owned();
    layers
        .iter()
        .flat_map(|layer| {
            let rows: Vec<&WhereSummaryRecord> = layer.values().collect();
            rows.chunks(UPSERT_CHUNK_ROWS)
                .map(|chunk| {
                    let mut insert = Query::insert();
                    insert
                        .into_table(Entity)
                        .columns(INSERT_COLUMNS)
                        .on_conflict(on_conflict.clone());
                    for r in chunk {
                        insert.values_panic(insert_values(r));
                    }
                    backend.build(&insert)
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// In `INSERT_COLUMNS` order; a first-ever row also takes its rank from the registry.
fn insert_values(r: &WhereSummaryRecord) -> [SimpleExpr; 21] {
    let registry = Query::select()
        .column(service_versions_entity::Column::FirstSeen)
        .from(service_versions_entity::Entity)
        .and_where(service_versions_entity::Column::VersionKey.eq(r.newest_version_key.clone()))
        .to_owned();
    let rank: SimpleExpr = Func::coalesce([
        SimpleExpr::SubQuery(None, Box::new(registry.into_sub_query_statement())),
        Expr::value(r.newest_first_seen),
    ])
    .into();
    [
        Expr::value(r.summary_key.clone()),
        Expr::value(r.org_id.clone()),
        Expr::value(r.service_name.clone()),
        Expr::value(r.where_key.clone()),
        Expr::value(r.scope_key.clone()),
        Expr::value(r.source_stream.clone()),
        Expr::value(r.signal.clone()),
        Expr::value(r.k8s_cluster.clone()),
        Expr::value(r.k8s_namespace.clone()),
        Expr::value(r.env.clone()),
        Expr::value(r.env_source.as_str()),
        Expr::value(r.env_source_value.clone()),
        Expr::value(serde_json::to_string(&r.envs).expect("env strings serialize")),
        Expr::value(r.newest_version.clone()),
        Expr::value(r.newest_version_key.clone()),
        rank,
        Expr::value(r.has_version),
        Expr::value(r.first_seen),
        Expr::value(r.last_seen),
        Expr::value(r.purged_versions),
        Expr::value(r.updated_at),
    ]
}

/// Splits a record so each carries at most one env; the conflict clause adds one member at a time.
fn one_env_each(record: WhereSummaryRecord) -> Vec<WhereSummaryRecord> {
    if record.envs.len() <= 1 {
        return vec![record];
    }
    record
        .envs
        .iter()
        .map(|env| WhereSummaryRecord {
            envs: vec![env.clone()],
            ..record.clone()
        })
        .collect()
}

/// Adds the incoming one-member array to the stored array unless it is already a member.
fn env_union(backend: DbBackend, stored: &str, incoming: &str) -> String {
    let find = match backend {
        DbBackend::Postgres => "strpos",
        _ => "instr",
    };
    let inner = |side: &str| format!("substr({side}, 2, length({side}) - 2)");
    format!(
        "CASE WHEN {incoming} = '[]' THEN {stored} WHEN {stored} = '[]' THEN {incoming} \
         WHEN {find}(',' || {} || ',', ',' || {} || ',') > 0 THEN {stored} \
         ELSE substr({stored}, 1, length({stored}) - 1) || ',' || substr({incoming}, 2) END",
        inner(stored),
        inner(incoming)
    )
}

/// The stored set, sorted, always holding the pinned env; an unreadable set falls back to it.
fn env_set(env: &str, envs: &str) -> Vec<String> {
    let mut set: std::collections::BTreeSet<String> = serde_json::from_str::<Vec<String>>(envs)
        .unwrap_or_default()
        .into_iter()
        .collect();
    if !env.is_empty() {
        set.insert(env.to_string());
    }
    set.into_iter().collect()
}

fn to_record(m: Model) -> Result<WhereSummaryRecord, errors::Error> {
    Ok(WhereSummaryRecord {
        env_source: m.env_source.parse().map_err(DbErr::Type)?,
        summary_key: m.summary_key,
        org_id: m.org_id,
        service_name: m.service_name,
        where_key: m.where_key,
        scope_key: m.scope_key,
        source_stream: m.source_stream,
        signal: m.signal,
        k8s_cluster: m.k8s_cluster,
        k8s_namespace: m.k8s_namespace,
        envs: env_set(&m.env, &m.envs),
        env: m.env,
        env_source_value: m.env_source_value,
        newest_version: m.newest_version,
        newest_version_key: m.newest_version_key,
        newest_first_seen: m.newest_first_seen,
        has_version: m.has_version,
        first_seen: m.first_seen,
        last_seen: m.last_seen,
        purged_versions: m.purged_versions,
        updated_at: m.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{
        EnvSource, SIGNAL_TRACES, ServiceVersionObservation, WhereKind, summary_key,
    };
    use sea_orm::DatabaseConnection;

    use super::*;
    use crate::table::migration::{
        create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
    };

    const ORG: &str = "acme";

    async fn dbs(label: &str) -> Vec<DatabaseConnection> {
        let dbs = sqlite_and_postgres_for_test(label).await;
        for db in &dbs {
            create_service_identity_tables_for_test(db).await.unwrap();
        }
        dbs
    }

    fn observation(version: &str, first: i64, last: i64) -> ServiceVersionObservation {
        ServiceVersionObservation {
            service_name: "router".to_string(),
            where_key: "k8s:/openobserve".to_string(),
            where_kind: WhereKind::K8s,
            k8s_cluster: String::new(),
            k8s_namespace: "openobserve".to_string(),
            env: "openobserve".to_string(),
            env_source: EnvSource::NamespaceName,
            env_source_value: "openobserve".to_string(),
            version: version.to_string(),
            raw_version: None,
            version_source: "service.version".to_string(),
            image: None,
            image_ref: None,
            source_stream: "default".to_string(),
            signal: SIGNAL_TRACES.to_string(),
            first_seen: first,
            last_seen: last,
        }
    }

    fn summary(version: &str, first: i64, last: i64) -> WhereSummaryRecord {
        let o = observation(version, first, last);
        o.to_summary(ORG, &o.to_record(ORG, last), last)
    }

    async fn apply_each(
        db: &DatabaseConnection,
        rows: &[WhereSummaryRecord],
    ) -> WhereSummaryRecord {
        delete_by_org(db, ORG).await.unwrap();
        for row in rows {
            upsert_many(db, vec![row.clone()]).await.unwrap();
        }
        let mut stored = list_by_org(db, ORG).await.unwrap();
        assert_eq!(stored.len(), 1);
        stored.pop().unwrap()
    }

    fn orders(rows: &[WhereSummaryRecord]) -> Vec<Vec<WhereSummaryRecord>> {
        let n = rows.len();
        (0..n)
            .flat_map(|start| {
                [
                    (0..n).map(|i| rows[(start + i) % n].clone()).collect(),
                    (0..n)
                        .rev()
                        .map(|i| rows[(start + i) % n].clone())
                        .collect(),
                ]
            })
            .collect()
    }

    #[tokio::test]
    async fn catalog_pages_rank_registry_and_filter_scopes_and_org() {
        for db in dbs("catalog_page").await {
            let mut scopes = Vec::new();
            for (service, first) in [("old", 100), ("new", 300), ("middle", 200)] {
                let mut obs = observation("v1", first, 400);
                obs.service_name = service.into();
                let row = obs.to_record(ORG, 400);
                scopes.push(row.scope_key.clone());
                super::super::service_versions::merge_upsert_many(&db, vec![row.clone()])
                    .await
                    .unwrap();
                upsert_many(&db, vec![obs.to_summary(ORG, &row, 400)])
                    .await
                    .unwrap();
            }
            assert_eq!(
                catalog_page(&db, ORG, &scopes, 1, 0).await.unwrap(),
                vec![scopes[1].clone()]
            );
            assert_eq!(
                catalog_page(&db, ORG, &scopes, 1, 1).await.unwrap(),
                vec![scopes[2].clone()]
            );
            assert_eq!(
                catalog_page(&db, ORG, &[scopes[0].clone()], 10, 0)
                    .await
                    .unwrap(),
                vec![scopes[0].clone()]
            );
            assert!(
                catalog_page(&db, "acme-sibling", &scopes, 10, 0)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(
                catalog_page(&db, ORG, &scopes, 10, 3)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[tokio::test]
    async fn summary_newest_version_moves_only_forward() {
        let rows = vec![
            summary("v2", 200, 210),
            summary("v1", 100, 900),
            summary("", 300, 950),
            summary("v2", 200, 220),
        ];
        assert_eq!(
            rows[0].summary_key,
            summary_key(ORG, "router", "k8s:/openobserve", "default")
        );
        for db in dbs("sum_forward").await {
            for order in orders(&rows) {
                let stored = apply_each(&db, &order).await;
                assert_eq!(stored.newest_version, "v2", "{order:?}");
                assert_eq!(stored.newest_version_key, rows[0].newest_version_key);
                assert_eq!(stored.newest_first_seen, 200);
                assert_eq!((stored.first_seen, stored.last_seen), (100, 950));
                let mut expected = order[0].clone();
                for row in &order[1..] {
                    expected.merge(row);
                }
                assert_eq!(stored, expected);
                delete_by_org(&db, ORG).await.unwrap();
                upsert_many(&db, order.clone()).await.unwrap();
                assert_eq!(list_by_org(&db, ORG).await.unwrap(), vec![expected]);
            }
            let stored = apply_each(&db, &[summary("v2", 200, 210), summary("v3", 500, 510)]).await;
            assert_eq!(
                stored.newest_version, "v3",
                "a newer first_seen moves it forward"
            );
        }
    }

    #[tokio::test]
    async fn summary_has_version_is_sticky() {
        for db in dbs("sum_sticky").await {
            assert!(
                !apply_each(&db, &[summary("", 1, 2), summary("", 3, 4)])
                    .await
                    .has_version
            );
            for rows in [
                [summary("v1", 1, 2), summary("", 3, 4)],
                [summary("", 3, 4), summary("v1", 1, 2)],
            ] {
                let stored = apply_each(&db, &rows).await;
                assert!(stored.has_version);
                assert_eq!(stored.newest_version, "v1");
            }
        }
    }

    /// Rank by the registry's merged first_seen, fed through the registry upsert.
    #[tokio::test]
    async fn summary_newest_follows_registry_first_seen_when_an_old_version_keeps_emitting() {
        for db in dbs("sum_producer").await {
            let flushes = [
                observation("v1", 100, 110),
                observation("v2", 200, 210),
                observation("v1", 300, 310),
            ];
            for o in &flushes {
                let merged = super::super::service_versions::merge_upsert_many(
                    &db,
                    vec![o.to_record(ORG, 1)],
                )
                .await
                .unwrap();
                upsert_many(&db, vec![o.to_summary(ORG, &merged[0], 1)])
                    .await
                    .unwrap();
            }
            let stored = list_by_org(&db, ORG).await.unwrap();
            assert_eq!(stored.len(), 1);
            assert_eq!(stored[0].newest_version, "v2", "v1 first appeared at 100");
            assert_eq!(stored[0].newest_first_seen, 200);
            assert_eq!((stored[0].first_seen, stored[0].last_seen), (100, 310));
        }
    }

    async fn flush(db: &DatabaseConnection, o: &ServiceVersionObservation) -> WhereSummaryRecord {
        let merged =
            super::super::service_versions::merge_upsert_many(db, vec![o.to_record(ORG, 1)])
                .await
                .unwrap();
        let written = o.to_summary(ORG, &merged[0], 1);
        upsert_many(db, vec![written.clone()]).await.unwrap();
        written
    }

    async fn default_stream(db: &DatabaseConnection) -> WhereSummaryRecord {
        let rows = list_by_org(db, ORG).await.unwrap();
        let mut rows: Vec<_> = rows
            .into_iter()
            .filter(|r| r.source_stream == "default")
            .collect();
        assert_eq!(rows.len(), 1);
        rows.pop().unwrap()
    }

    /// One batch with a delayed v1 carrying 300 and v2 carrying 200, registry v1=100 v2=200.
    #[tokio::test]
    async fn summary_batch_keeps_every_candidate_for_the_registry_comparison() {
        for db in dbs("sum_batch").await {
            let stale_v1 = flush(&db, &observation("v1", 300, 310)).await;
            flush(&db, &observation("v1", 100, 110)).await;
            let v2 = flush(&db, &observation("v2", 200, 210)).await;
            assert_eq!(stale_v1.newest_first_seen, 300);
            for (stored, batch) in [
                (None, vec![stale_v1.clone(), v2.clone()]),
                (None, vec![v2.clone(), stale_v1.clone()]),
                (Some(stale_v1.clone()), vec![stale_v1.clone(), v2.clone()]),
                (Some(v2.clone()), vec![stale_v1.clone(), stale_v1.clone()]),
            ] {
                delete_by_org(&db, ORG).await.unwrap();
                if let Some(row) = stored.clone() {
                    upsert_many(&db, vec![row]).await.unwrap();
                }
                upsert_many(&db, batch.clone()).await.unwrap();
                let got = default_stream(&db).await;
                assert_eq!(
                    (got.newest_version.as_str(), got.newest_first_seen),
                    ("v2", 200),
                    "stored {stored:?}, batch {batch:?}"
                );
            }
        }
    }

    /// The very first write for a stream carries 300 while the registry already says 100.
    #[tokio::test]
    async fn summary_first_insert_takes_its_rank_from_the_registry() {
        for db in dbs("sum_first").await {
            let early = observation("v1", 300, 310);
            let stale_v1 = early.to_summary(ORG, &early.to_record(ORG, 1), 1);
            super::super::service_versions::merge_upsert_many(
                &db,
                vec![observation("v1", 100, 110).to_record(ORG, 1)],
            )
            .await
            .unwrap();
            upsert_many(&db, vec![stale_v1.clone()]).await.unwrap();
            let stored = default_stream(&db).await;
            assert_eq!(
                (stored.newest_version.as_str(), stored.newest_first_seen),
                ("v1", 100)
            );

            delete_by_org(&db, ORG).await.unwrap();
            let unknown = summary("v9", 700, 710);
            upsert_many(&db, vec![unknown.clone()]).await.unwrap();
            assert_eq!(
                default_stream(&db).await.newest_first_seen,
                700,
                "no registry row: the carried rank stays"
            );
        }
    }

    /// v1@300, v2@200, then late v1@100 history lowers v1's rank below v2's.
    #[tokio::test]
    async fn summary_rank_follows_late_registry_history_and_ignores_delayed_writes() {
        for db in dbs("sum_late").await {
            let stale_v1 = flush(&db, &observation("v1", 300, 310)).await;
            flush(&db, &observation("v2", 200, 210)).await;
            assert_eq!(default_stream(&db).await.newest_version, "v1");

            let mut late = observation("v1", 100, 110);
            late.source_stream = "late".to_string();
            flush(&db, &late).await;

            flush(&db, &observation("v2", 400, 410)).await;
            let stored = default_stream(&db).await;
            assert_eq!(
                (stored.newest_version.as_str(), stored.newest_first_seen),
                ("v2", 200),
                "v1 first appeared at 100, so v2 is newer"
            );

            upsert_many(&db, vec![stale_v1.clone()]).await.unwrap();
            let stored = default_stream(&db).await;
            assert_eq!(
                (stored.newest_version.as_str(), stored.newest_first_seen),
                ("v2", 200),
                "a delayed write still carrying rank 300 does not win"
            );

            delete_by_org(&db, ORG).await.unwrap();
            super::super::service_versions::delete_by_org(&db, ORG)
                .await
                .unwrap();
            flush(&db, &observation("v1", 300, 310)).await;
            flush(&db, &observation("v2", 200, 210)).await;
            flush(&db, &observation("v1", 100, 110)).await;
            // The summary is a cache, so v2 wins on its next observation, not on the late v1.
            flush(&db, &observation("v2", 500, 510)).await;
            let stored = default_stream(&db).await;
            assert_eq!(
                (stored.newest_version.as_str(), stored.newest_first_seen),
                ("v2", 200),
                "healed: v1 first appeared at 100, v2 at 200"
            );
        }
    }

    fn in_env(env: &str, first: i64, last: i64) -> WhereSummaryRecord {
        let mut o = observation("v1", first, last);
        o.env = env.to_string();
        o.env_source = EnvSource::Attribute;
        o.env_source_value = "deployment.environment".to_string();
        o.to_summary(ORG, &o.to_record(ORG, last), last)
    }

    #[tokio::test]
    async fn the_first_env_wins_and_every_env_joins_the_set_in_any_order() {
        let mut both = in_env("staging", 300, 700);
        both.envs = vec!["qa \"eu\"".to_string(), "staging".to_string()];
        let rows = vec![
            in_env("prod", 200, 500),
            in_env("staging", 250, 900),
            both,
            in_env("prod", 600, 950),
        ];
        let mut expected = rows[0].clone();
        for row in &rows[1..] {
            expected.merge(row);
        }
        assert_eq!(expected.env, "prod");
        assert_eq!(expected.envs, ["prod", "qa \"eu\"", "staging"]);
        for db in dbs("sws_envs").await {
            for order in orders(&rows) {
                let stored = apply_each(&db, &order).await;
                assert_eq!(
                    (stored.env.as_str(), &stored.envs, stored.first_seen),
                    (expected.env.as_str(), &expected.envs, expected.first_seen),
                    "{:?}",
                    db.get_database_backend()
                );
            }
            delete_by_org(&db, ORG).await.unwrap();
            upsert_many(&db, rows.clone()).await.unwrap();
            assert_eq!(list_by_org(&db, ORG).await.unwrap()[0].envs, expected.envs);
        }
    }
}
