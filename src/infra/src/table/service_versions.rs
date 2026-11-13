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

//! The `service_versions` registry: a min/max semilattice the database applies in one upsert.

use std::collections::BTreeMap;

use config::meta::service_identity::{OverrideScope, ServiceVersionRecord, scope_key};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DbBackend, DbErr, EntityTrait, FromQueryResult,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, Set, Statement,
    sea_query::{Expr, OnConflict, Query, SimpleExpr},
};

use super::entity::{
    service_versions::{ActiveModel, Column, Entity, Model},
    service_where_summary,
};
use crate::errors;

/// 500 rows × 23 columns = 11,500 binds, under SQLite's 32,766 and PostgreSQL's 65,535.
pub const UPSERT_CHUNK_ROWS: usize = 500;
/// Bounds every `IN (…)` list and batched delete; purges delete in batches of 1,000.
pub const KEY_BATCH: usize = 1000;
pub(crate) const TABLE: &str = "service_versions";

/// A page of live registry rows, newest first; `limit` 0 reads one `KEY_BATCH`.
#[derive(Clone, Debug, Default)]
pub struct ListQuery {
    pub service_name: Option<String>,
    pub where_key: Option<String>,
    pub limit: u64,
    pub offset: u64,
}

/// Distinct services and live rows an override target covers, the API's `affected`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScopeCount {
    pub services: u64,
    pub versions: u64,
}

/// The two Unresolved groups of the overrides API; env is never unresolved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnresolvedKind {
    NoVersion,
    PlaceholderName,
}

/// SQL text that differs between SQLite and PostgreSQL in the conflict clauses.
pub(crate) struct Dialect {
    backend: DbBackend,
    table: &'static str,
}

impl Dialect {
    pub(crate) fn new(backend: DbBackend, table: &'static str) -> Self {
        Self { backend, table }
    }

    pub(crate) fn stored(&self, column: &str) -> String {
        format!("\"{}\".\"{column}\"", self.table)
    }

    pub(crate) fn incoming(&self, column: &str) -> String {
        format!("excluded.\"{column}\"")
    }

    pub(crate) fn least(&self, a: &str, b: &str) -> String {
        match self.backend {
            DbBackend::Postgres => format!("LEAST({a}, {b})"),
            _ => format!("min({a}, {b})"),
        }
    }

    pub(crate) fn greatest(&self, a: &str, b: &str) -> String {
        match self.backend {
            DbBackend::Postgres => format!("GREATEST({a}, {b})"),
            _ => format!("max({a}, {b})"),
        }
    }

    /// NULL is the identity: SQLite `min` returns NULL when any argument is NULL.
    pub(crate) fn least_nullable(&self, a: &str, b: &str) -> String {
        self.least(
            &format!("COALESCE({a}, {b})"),
            &format!("COALESCE({b}, {a})"),
        )
    }

    pub(crate) fn greatest_nullable(&self, a: &str, b: &str) -> String {
        self.greatest(
            &format!("COALESCE({a}, {b})"),
            &format!("COALESCE({b}, {a})"),
        )
    }

    /// Compared as bytes, not by the store's collation, so every region picks the same winner.
    pub(crate) fn bytes(&self, expr: &str) -> String {
        match self.backend {
            DbBackend::Postgres => format!("({expr}) COLLATE \"C\""),
            _ => format!("({expr}) COLLATE BINARY"),
        }
    }

    pub(crate) fn rank(&self, parts: &[String]) -> String {
        format!("({})", parts.join(", "))
    }
}

/// Folds every record into its row, one conditional upsert per chunk; returns the merged rows.
pub async fn merge_upsert_many<C: ConnectionTrait>(
    conn: &C,
    records: Vec<ServiceVersionRecord>,
) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    let mut merged = Vec::with_capacity(records.len());
    for statement in upsert_statements(conn.get_database_backend(), records) {
        let rows = conn.query_all(statement).await?;
        let models = rows
            .iter()
            .map(|row| Model::from_query_result(row, ""))
            .collect::<Result<Vec<_>, DbErr>>()?;
        merged.extend(to_records(models)?);
    }
    Ok(merged)
}

/// The conflict-clause assignments for `backend`, mirroring `ServiceVersionRecord::merge`.
pub fn semilattice_upsert_exprs(backend: DbBackend) -> Vec<(Column, SimpleExpr)> {
    let sql = Dialect::new(backend, TABLE);
    let (t, e) = (|c: &str| sql.stored(c), |c: &str| sql.incoming(c));
    let floor = sql.greatest_nullable(&t("deleted_at"), &e("deleted_at"));
    let rank = |side: &dyn Fn(&str) -> String| {
        sql.rank(&[
            side("last_seen"),
            sql.bytes(&side("env")),
            sql.bytes(&side("env_source")),
            sql.bytes(&side("env_source_value")),
            sql.bytes(&side("version_source")),
            sql.bytes(&format!("COALESCE({}, '')", side("raw_version"))),
            sql.bytes(&format!("COALESCE({}, '')", side("image_ref"))),
            sql.bytes(&side("service_name")),
        ])
    };
    let newest = format!("{} > {}", rank(&e), rank(&t));
    let mut exprs: Vec<(Column, String)> = [
        (Column::ServiceName, "service_name"),
        (Column::Env, "env"),
        (Column::EnvSource, "env_source"),
        (Column::EnvSourceValue, "env_source_value"),
        (Column::VersionSource, "version_source"),
        (Column::RawVersion, "raw_version"),
        (Column::ImageRef, "image_ref"),
    ]
    .into_iter()
    .map(|(column, name)| {
        let picked = format!("CASE WHEN {newest} THEN {} ELSE {} END", e(name), t(name));
        (column, picked)
    })
    .collect();
    for (column, name) in [
        (Column::WhereKind, "where_kind"),
        (Column::K8sCluster, "k8s_cluster"),
        (Column::K8sNamespace, "k8s_namespace"),
    ] {
        exprs.push((
            column,
            format!(
                "CASE WHEN {} = 0 AND {} > 0 THEN {} ELSE {} END",
                t("last_seen"),
                e("last_seen"),
                e(name),
                t(name)
            ),
        ));
    }
    exprs.push((
        Column::Image,
        format!("COALESCE({}, {})", t("image"), e("image")),
    ));
    let first_seen = sql.least(&t("first_seen"), &e("first_seen"));
    exprs.push((
        Column::FirstSeen,
        format!(
            "CASE WHEN {floor} IS NULL THEN {first_seen} ELSE {} END",
            sql.greatest(&first_seen, &floor)
        ),
    ));
    for (first_col, last_col, first_name, last_name) in [
        (
            Column::TracesFirstSeen,
            Column::TracesLastSeen,
            "traces_first_seen",
            "traces_last_seen",
        ),
        (
            Column::RumFirstSeen,
            Column::RumLastSeen,
            "rum_first_seen",
            "rum_last_seen",
        ),
    ] {
        let last = sql.greatest_nullable(&t(last_name), &e(last_name));
        let first = sql.least_nullable(&t(first_name), &e(first_name));
        exprs.push((
            first_col,
            format!(
                "CASE WHEN {floor} IS NULL OR {first} IS NULL THEN {first} ELSE {} END",
                sql.greatest(&first, &floor)
            ),
        ));
        exprs.push((last_col, last));
    }
    exprs.push((
        Column::LastSeen,
        sql.greatest(&t("last_seen"), &e("last_seen")),
    ));
    exprs.push((Column::DeletedAt, floor.clone()));
    exprs.push((
        Column::CreatedAt,
        sql.least(&t("created_at"), &e("created_at")),
    ));
    exprs.push((
        Column::UpdatedAt,
        sql.greatest(&t("updated_at"), &e("updated_at")),
    ));
    exprs
        .into_iter()
        .map(|(column, text)| (column, Expr::cust(text)))
        .collect()
}

pub async fn transition_above_floor<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    key: &str,
    at: i64,
) -> Result<bool, errors::Error> {
    conn.execute(sea_orm::Statement::from_sql_and_values(conn.get_database_backend(),
        "UPDATE service_versions SET updated_at = updated_at WHERE org_id = $1 AND version_key = $2",
        vec![org.into(), key.into()],
    )).await?;
    let rows = get_by_keys(conn, org, &[key.into()]).await?;
    Ok(rows
        .first()
        .is_none_or(|row| row.deleted_at.is_none_or(|floor| at > floor)))
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    query: &ListQuery,
) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    let mut select = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(live());
    select = match (&query.service_name, &query.where_key) {
        (Some(service), Some(where_key)) => {
            select.filter(Column::ScopeKey.eq(scope_key(org_id, service, where_key)))
        }
        (Some(service), None) => select.filter(Column::ServiceName.eq(service.as_str())),
        (None, Some(where_key)) => select.filter(Column::WhereKey.eq(where_key.as_str())),
        (None, None) => select,
    };
    let rows = select
        .order_by_desc(Column::FirstSeen)
        .order_by_asc(Column::VersionKey)
        .limit(page_limit(query.limit))
        .offset(query.offset)
        .all(conn)
        .await?;
    to_records(rows)
}

pub async fn active_by_scopes<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scopes: &[String],
    since: i64,
) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    let mut records = Vec::new();
    for keys in scopes.chunks(KEY_BATCH) {
        records.extend(to_records(
            Entity::find()
                .filter(Column::OrgId.eq(org_id))
                .filter(live())
                .filter(Column::ScopeKey.is_in(keys.to_vec()))
                .filter(Column::LastSeen.gte(since))
                .order_by_desc(Column::FirstSeen)
                .all(conn)
                .await?,
        )?);
    }
    Ok(records)
}

/// Rows by key, tombstoned ones included, so a caller can tell a delete from an absence.
pub async fn get_by_keys<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    version_keys: &[String],
) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    let mut records = Vec::with_capacity(version_keys.len());
    for keys in version_keys.chunks(KEY_BATCH) {
        let rows = Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::VersionKey.is_in(keys.to_vec()))
            .all(conn)
            .await?;
        records.extend(to_records(rows)?);
    }
    Ok(records)
}

/// Version keys of the org seen at or after `since`, tombstones included: the restart seed.
pub async fn version_keys_seen_since<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    since: i64,
) -> Result<Vec<String>, errors::Error> {
    Ok(Entity::find()
        .select_only()
        .column(Column::VersionKey)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::LastSeen.gte(since))
        .into_tuple::<String>()
        .all(conn)
        .await?)
}

/// Counts what an override target covers; an unused field of the scope is ignored.
pub async fn count_by_scope<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scope: OverrideScope,
    k8s_cluster: &str,
    where_key: &str,
    service_name: &str,
) -> Result<ScopeCount, errors::Error> {
    let select = Entity::find()
        .select_only()
        .column_as(Expr::cust("COUNT(DISTINCT service_name)"), "services")
        .column_as(Expr::cust("COUNT(*)"), "versions")
        .filter(Column::OrgId.eq(org_id))
        .filter(live());
    let select = match scope {
        OverrideScope::Service => {
            select.filter(Column::ScopeKey.eq(scope_key(org_id, service_name, where_key)))
        }
        OverrideScope::Where => select.filter(Column::WhereKey.eq(where_key)),
        OverrideScope::Cluster => select.filter(Column::K8sCluster.eq(k8s_cluster)),
    };
    let (services, versions) = select
        .into_tuple::<(i64, i64)>()
        .one(conn)
        .await?
        .unwrap_or_default();
    Ok(ScopeCount {
        services: u64::try_from(services).unwrap_or_default(),
        versions: u64::try_from(versions).unwrap_or_default(),
    })
}

/// Live rows with a known image in `scope_keys`; they size the image suffix of each version.
pub async fn imaged_by_scopes<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scope_keys: &[String],
) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    let mut out = Vec::new();
    for chunk in scope_keys.chunks(KEY_BATCH) {
        let rows = Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::ScopeKey.is_in(chunk.iter().cloned()))
            .filter(Column::Image.is_not_null())
            .filter(live())
            .all(conn)
            .await?;
        out.extend(to_records(rows)?);
    }
    Ok(out)
}

/// Live versions per scope key for one org, the grouped form of [`count_by_scope`].
pub async fn versions_by_scope<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<BTreeMap<String, u64>, errors::Error> {
    let rows = Entity::find()
        .select_only()
        .column(Column::ScopeKey)
        .column_as(Expr::cust("COUNT(*)"), "versions")
        .filter(Column::OrgId.eq(org_id))
        .filter(live())
        .group_by(Column::ScopeKey)
        .into_tuple::<(String, i64)>()
        .all(conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(|(key, versions)| (key, u64::try_from(versions).unwrap_or_default()))
        .collect())
}

/// Distinct live (scope, version, raw version) rows of one org, to count normalised labels.
pub async fn raw_versions<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<(String, String, String)>, errors::Error> {
    Ok(Entity::find()
        .select_only()
        .column(Column::ScopeKey)
        .column(Column::Version)
        .column(Column::RawVersion)
        .distinct()
        .filter(Column::OrgId.eq(org_id))
        .filter(live())
        .filter(Column::RawVersion.is_not_null())
        .into_tuple::<(String, String, String)>()
        .all(conn)
        .await?)
}

pub async fn latest_in_scope<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scope: OverrideScope,
    k8s_cluster: &str,
    where_key: &str,
    service_name: &str,
) -> Result<Option<ServiceVersionRecord>, errors::Error> {
    let select = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(live());
    let select = match scope {
        OverrideScope::Service => {
            select.filter(Column::ScopeKey.eq(scope_key(org_id, service_name, where_key)))
        }
        OverrideScope::Where => select.filter(Column::WhereKey.eq(where_key)),
        OverrideScope::Cluster => select.filter(Column::K8sCluster.eq(k8s_cluster)),
    };
    let rows = select
        .order_by_desc(Column::LastSeen)
        .order_by_asc(Column::VersionKey)
        .limit(1)
        .all(conn)
        .await?;
    Ok(to_records(rows)?.pop())
}

/// Live rows of one Unresolved group, most recently seen first.
pub async fn list_unresolved<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    kind: UnresolvedKind,
    limit: u64,
) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    let select = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(live());
    let select = match kind {
        UnresolvedKind::NoVersion => select.filter(Column::Version.eq("")),
        UnresolvedKind::PlaceholderName => select.filter(Expr::cust(
            "substr(service_name, 1, 15) = 'unknown_service'",
        )),
    };
    let rows = select
        .order_by_desc(Column::LastSeen)
        .order_by_asc(Column::VersionKey)
        .limit(page_limit(limit))
        .all(conn)
        .await?;
    to_records(rows)
}

/// Joins a tombstone into each row like `apply_tombstone`; `last_seen_before` is rechecked here.
pub async fn tombstone_many<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    version_keys: &[String],
    deleted_at: i64,
    last_seen_before: Option<i64>,
) -> Result<u64, errors::Error> {
    let sql = Dialect::new(conn.get_database_backend(), TABLE);
    let at = deleted_at.to_string();
    let clamp = |first: &str| {
        format!(
            "CASE WHEN {first} IS NULL THEN NULL ELSE {} END",
            sql.greatest(first, &at)
        )
    };
    let mut affected = 0;
    for keys in version_keys.chunks(KEY_BATCH) {
        let mut update = Entity::update_many()
            .col_expr(Column::DeletedAt, Expr::value(deleted_at))
            .col_expr(
                Column::FirstSeen,
                Expr::cust(sql.greatest("first_seen", &at)),
            )
            .col_expr(
                Column::TracesFirstSeen,
                Expr::cust(clamp("traces_first_seen")),
            )
            .col_expr(Column::RumFirstSeen, Expr::cust(clamp("rum_first_seen")))
            .col_expr(
                Column::UpdatedAt,
                Expr::cust(sql.greatest("updated_at", &at)),
            )
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::VersionKey.is_in(keys.to_vec()))
            .filter(
                Condition::any()
                    .add(Column::DeletedAt.is_null())
                    .add(Column::DeletedAt.lt(deleted_at)),
            );
        if let Some(cutoff) = last_seen_before {
            update = update.filter(Column::LastSeen.lt(cutoff));
        }
        affected += update.exec(conn).await?.rows_affected;
    }
    Ok(affected)
}

/// Live keys with no traffic since `last_seen_before` that are not their scope's newest.
pub async fn purge_candidates<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    last_seen_before: i64,
    limit: u64,
) -> Result<Vec<String>, errors::Error> {
    purge_candidates_since(conn, org_id, last_seen_before, i64::MIN, limit).await
}

pub async fn purge_candidates_since<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    last_seen_before: i64,
    history_floor: i64,
    limit: u64,
) -> Result<Vec<String>, errors::Error> {
    let newest = Query::select()
        .column(service_where_summary::Column::NewestVersionKey)
        .from(service_where_summary::Entity)
        .and_where(service_where_summary::Column::OrgId.eq(org_id))
        .to_owned();
    Ok(Entity::find()
        .select_only()
        .column(Column::VersionKey)
        .filter(Column::OrgId.eq(org_id))
        .filter(live())
        .filter(Column::LastSeen.lt(last_seen_before))
        .filter(Column::FirstSeen.gte(history_floor))
        .filter(Column::VersionKey.not_in_subquery(newest))
        .filter(
            Column::VersionKey.not_in_subquery(
                Query::select()
                    .column(super::entity::service_version_deploys::Column::ToVersionKey)
                    .from(super::entity::service_version_deploys::Entity)
                    .and_where(super::entity::service_version_deploys::Column::OrgId.eq(org_id))
                    .to_owned(),
            ),
        )
        .order_by_asc(Column::LastSeen)
        .order_by_asc(Column::VersionKey)
        .limit(page_limit(limit))
        .into_tuple::<String>()
        .all(conn)
        .await?)
}

/// Deletes up to `limit` rows hidden by a tombstone older than `deleted_before`.
pub async fn hard_delete_tombstones<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    deleted_before: i64,
    limit: u64,
) -> Result<u64, errors::Error> {
    let keys = expired_tombstones(conn, org_id, deleted_before, limit).await?;
    delete_expired(conn, org_id, keys, deleted_before).await
}

/// Creates the service identity tables if absent; for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub async fn create_tables_for_tests(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    super::migration::create_service_identity_tables_for_test(db).await
}

/// A fresh SQLite database, plus a fresh PostgreSQL schema when `ZO_META_POSTGRES_DSN` is set.
#[cfg(any(test, feature = "test-utils"))]
pub async fn sqlite_and_postgres_for_tests(label: &str) -> Vec<sea_orm::DatabaseConnection> {
    super::migration::sqlite_and_postgres_for_test(label).await
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

async fn expired_tombstones<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    deleted_before: i64,
    limit: u64,
) -> Result<Vec<String>, errors::Error> {
    Ok(Entity::find()
        .select_only()
        .column(Column::VersionKey)
        .filter(Column::OrgId.eq(org_id))
        .filter(expired(deleted_before))
        .order_by_asc(Column::DeletedAt)
        .limit(page_limit(limit))
        .into_tuple::<String>()
        .all(conn)
        .await?)
}

/// Rechecks age and hiddenness: a revive or re-tombstone may land after the scan.
async fn delete_expired<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    keys: Vec<String>,
    deleted_before: i64,
) -> Result<u64, errors::Error> {
    if keys.is_empty() {
        return Ok(0);
    }
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::VersionKey.is_in(keys))
        .filter(expired(deleted_before))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

fn expired(deleted_before: i64) -> Condition {
    Condition::all()
        .add(Column::DeletedAt.lt(deleted_before))
        .add(Expr::col(Column::LastSeen).lte(Expr::col(Column::DeletedAt)))
}

/// `0` means the batch size, and nothing reads more than one batch at a time.
fn page_limit(limit: u64) -> u64 {
    if limit == 0 {
        KEY_BATCH as u64
    } else {
        limit.min(KEY_BATCH as u64)
    }
}

/// Rows hidden by a tombstone are skipped by every read but `get_by_keys`.
fn live() -> Condition {
    Condition::any()
        .add(Column::DeletedAt.is_null())
        .add(Expr::col(Column::LastSeen).gt(Expr::col(Column::DeletedAt)))
}

/// Duplicate keys are folded first: PostgreSQL rejects a statement that updates one row twice.
fn upsert_statements(backend: DbBackend, records: Vec<ServiceVersionRecord>) -> Vec<Statement> {
    let mut by_key: BTreeMap<String, ServiceVersionRecord> = BTreeMap::new();
    for record in records {
        match by_key.get_mut(&record.version_key) {
            Some(stored) => stored.merge(&record),
            None => {
                by_key.insert(record.version_key.clone(), record);
            }
        }
    }
    let rows: Vec<ServiceVersionRecord> = by_key
        .into_values()
        .map(|mut row| {
            row.apply_floor();
            row
        })
        .collect();
    let on_conflict = OnConflict::column(Column::VersionKey)
        .values(semilattice_upsert_exprs(backend))
        .to_owned();
    // Rows go in key order, so concurrent writers lock overlapping rows in one order.
    rows.chunks(UPSERT_CHUNK_ROWS)
        .map(|chunk| {
            let mut statement = Entity::insert_many(chunk.iter().map(to_active_model))
                .on_conflict(on_conflict.clone())
                .build(backend);
            statement.sql.push_str(" RETURNING *");
            statement
        })
        .collect()
}

fn to_active_model(r: &ServiceVersionRecord) -> ActiveModel {
    ActiveModel {
        version_key: Set(r.version_key.clone()),
        org_id: Set(r.org_id.clone()),
        service_name: Set(r.service_name.clone()),
        where_key: Set(r.where_key.clone()),
        where_kind: Set(r.where_kind.as_str().to_string()),
        k8s_cluster: Set(r.k8s_cluster.clone()),
        k8s_namespace: Set(r.k8s_namespace.clone()),
        scope_key: Set(r.scope_key.clone()),
        env: Set(r.env.clone()),
        version: Set(r.version.clone()),
        raw_version: Set(r.raw_version.clone()),
        version_source: Set(r.version_source.clone()),
        image: Set(r.image.clone()),
        image_ref: Set(r.image_ref.clone()),
        env_source: Set(r.env_source.as_str().to_string()),
        env_source_value: Set(r.env_source_value.clone()),
        first_seen: Set(r.first_seen),
        last_seen: Set(r.last_seen),
        traces_first_seen: Set(r.traces_first_seen),
        traces_last_seen: Set(r.traces_last_seen),
        rum_first_seen: Set(r.rum_first_seen),
        rum_last_seen: Set(r.rum_last_seen),
        deleted_at: Set(r.deleted_at),
        created_at: Set(r.created_at),
        updated_at: Set(r.updated_at),
    }
}

fn to_records(rows: Vec<Model>) -> Result<Vec<ServiceVersionRecord>, errors::Error> {
    rows.into_iter()
        .map(|m| {
            Ok(ServiceVersionRecord {
                where_kind: m.where_kind.parse().map_err(DbErr::Type)?,
                env_source: m.env_source.parse().map_err(DbErr::Type)?,
                version_key: m.version_key,
                org_id: m.org_id,
                service_name: m.service_name,
                where_key: m.where_key,
                k8s_cluster: m.k8s_cluster,
                k8s_namespace: m.k8s_namespace,
                scope_key: m.scope_key,
                env: m.env,
                version: m.version,
                raw_version: m.raw_version,
                version_source: m.version_source,
                image: m.image,
                image_ref: m.image_ref,
                env_source_value: m.env_source_value,
                first_seen: m.first_seen,
                last_seen: m.last_seen,
                traces_first_seen: m.traces_first_seen,
                traces_last_seen: m.traces_last_seen,
                rum_first_seen: m.rum_first_seen,
                rum_last_seen: m.rum_last_seen,
                deleted_at: m.deleted_at,
                created_at: m.created_at,
                updated_at: m.updated_at,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{
        EnvSource, OverrideScope, SIGNAL_RUM, SIGNAL_TRACES, ServiceVersionObservation, WhereKind,
        version_key,
    };
    use sea_orm::{DatabaseConnection, PaginatorTrait};

    use super::*;
    use crate::table::{
        migration::{create_service_identity_tables_for_test, sqlite_and_postgres_for_test},
        service_identity_rules, service_where_summary as summary,
    };

    const ORG: &str = "acme";

    async fn dbs(label: &str) -> Vec<DatabaseConnection> {
        let dbs = sqlite_and_postgres_for_test(label).await;
        for db in &dbs {
            create_service_identity_tables_for_test(db).await.unwrap();
        }
        dbs
    }

    fn obs(version: &str, first: i64, last: i64) -> ServiceVersionObservation {
        ServiceVersionObservation {
            service_name: "ingester".to_string(),
            where_key: "k8s:obs-region/openobserve".to_string(),
            where_kind: WhereKind::K8s,
            k8s_cluster: "obs-region".to_string(),
            k8s_namespace: "openobserve".to_string(),
            env: "obs-region".to_string(),
            env_source: EnvSource::ClusterName,
            env_source_value: "obs-region".to_string(),
            version: version.to_string(),
            raw_version: Some(version.to_string()),
            version_source: "service.version".to_string(),
            image: None,
            image_ref: None,
            source_stream: "default".to_string(),
            signal: SIGNAL_TRACES.to_string(),
            first_seen: first,
            last_seen: last,
        }
    }

    fn imaged(version: &str, image: &str, image_ref: &str, last: i64) -> ServiceVersionRecord {
        let mut o = obs(version, 100, last);
        o.image = Some(image.to_string());
        o.image_ref = Some(image_ref.to_string());
        o.to_record(ORG, 1)
    }

    fn rum(mut o: ServiceVersionObservation) -> ServiceVersionObservation {
        o.signal = SIGNAL_RUM.to_string();
        o
    }

    fn with_env(
        mut o: ServiceVersionObservation,
        env: &str,
        source: EnvSource,
    ) -> ServiceVersionObservation {
        o.env = env.to_string();
        o.env_source = source;
        o.env_source_value = format!("deployment.environment={env}");
        o
    }

    fn serial_merge(records: &[ServiceVersionRecord]) -> ServiceVersionRecord {
        let mut acc = records[0].clone();
        for r in &records[1..] {
            acc.merge(r);
        }
        acc
    }

    fn permutations(n: usize) -> Vec<Vec<usize>> {
        if n == 0 {
            return vec![vec![]];
        }
        let mut out = Vec::new();
        for rest in permutations(n - 1) {
            for at in 0..=rest.len() {
                let mut p = rest.clone();
                p.insert(at, n - 1);
                out.push(p);
            }
        }
        out
    }

    async fn row(db: &DatabaseConnection, key: &str) -> ServiceVersionRecord {
        let mut rows = get_by_keys(db, ORG, &[key.to_string()]).await.unwrap();
        assert_eq!(rows.len(), 1, "exactly one row for {key}");
        rows.pop().unwrap()
    }

    async fn rows_in_org(db: &DatabaseConnection, org: &str) -> u64 {
        Entity::find()
            .filter(Column::OrgId.eq(org))
            .count(db)
            .await
            .unwrap()
    }

    async fn count(
        db: &DatabaseConnection,
        scope: OverrideScope,
        where_key: &str,
        service: &str,
    ) -> ScopeCount {
        count_by_scope(db, ORG, scope, "obs-region", where_key, service)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn case_variants_fold_into_one_row_named_by_the_newest_observation() {
        let named = |name: &str, last: i64| {
            let mut o = obs("v1", 100, last);
            o.service_name = name.to_string();
            o
        };
        let observed = [
            named("ingester", 500),
            named("Ingester", 600),
            named("INGESTER.service", 550),
        ];
        let records: Vec<_> = observed.iter().map(|o| o.to_record(ORG, 1)).collect();
        let key = records[0].version_key.clone();
        assert!(records.iter().all(|r| r.version_key == key));
        let expected = serial_merge(&records);
        assert_eq!(expected.service_name, "Ingester");
        for db in dbs("sv_case").await {
            for order in permutations(records.len()) {
                delete_by_org(&db, ORG).await.unwrap();
                summary::delete_by_org(&db, ORG).await.unwrap();
                for i in &order {
                    merge_upsert_many(&db, vec![records[*i].clone()])
                        .await
                        .unwrap();
                    let o = &observed[*i];
                    summary::upsert_many(&db, vec![o.to_summary(ORG, &records[*i], 1)])
                        .await
                        .unwrap();
                }
                assert_eq!(row(&db, &key).await, expected, "order {order:?}");
                let summaries = summary::list_by_org(&db, ORG).await.unwrap();
                assert_eq!(summaries.len(), 1, "order {order:?}");
                assert_eq!(summaries[0].service_name, "Ingester", "order {order:?}");
            }
        }
    }

    #[tokio::test]
    async fn two_images_of_one_version_are_two_rows_and_the_newest_ref_wins() {
        let a = imaged("2.4.0", "3f9c2ab", "acme/checkout:2.4.0", 200);
        let b_old = imaged("2.4.0", "9c1e4b7", "old/checkout:2.4.0", 300);
        let b_new = imaged("2.4.0", "9c1e4b7", "acme/checkout:2.4.0", 400);
        let plain = obs("2.4.0", 100, 200).to_record(ORG, 1);
        assert_eq!(
            plain.version_key,
            version_key(ORG, "ingester", "k8s:obs-region/openobserve", "2.4.0")
        );
        let records = [b_new.clone(), a.clone(), b_old.clone(), plain.clone()];
        for db in dbs("sv_images").await {
            for order in permutations(records.len()) {
                delete_by_org(&db, ORG).await.unwrap();
                for i in &order {
                    merge_upsert_many(&db, vec![records[*i].clone()])
                        .await
                        .unwrap();
                }
                assert_eq!(rows_in_org(&db, ORG).await, 3, "order {order:?}");
                let b = row(&db, &b_new.version_key).await;
                assert_eq!(b.version, "2.4.0");
                assert_eq!(b.image.as_deref(), Some("9c1e4b7"));
                assert_eq!(
                    b.image_ref.as_deref(),
                    Some("acme/checkout:2.4.0"),
                    "order {order:?}"
                );
                assert_eq!(
                    row(&db, &a.version_key).await.image.as_deref(),
                    Some("3f9c2ab")
                );
                assert_eq!(row(&db, &plain.version_key).await.image, None);
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn merge_upsert_concurrent_writers_converge() {
        let mut all = Vec::new();
        for v in 0..40 {
            for step in 0..6_i64 {
                let o = obs(&format!("v{v}"), 1000 - step * 37 + v, 2000 + step * 53 - v);
                let o = if step % 2 == 0 { rum(o) } else { o };
                let env = ["prod", "staging", "dev"][(step % 3) as usize];
                all.push(with_env(o, env, EnvSource::Namespace).to_record(ORG, step));
            }
        }
        for db in dbs("sv_concurrent").await {
            let db = std::sync::Arc::new(db);
            let (left, right): (Vec<_>, Vec<_>) = all
                .iter()
                .cloned()
                .enumerate()
                .partition(|(i, _)| i % 2 == 0);
            let writer = |part: Vec<(usize, ServiceVersionRecord)>,
                          db: std::sync::Arc<DatabaseConnection>| {
                tokio::spawn(async move {
                    let part: Vec<ServiceVersionRecord> =
                        part.into_iter().map(|(_, r)| r).collect();
                    for chunk in part.chunks(7) {
                        merge_upsert_many(db.as_ref(), chunk.to_vec())
                            .await
                            .unwrap();
                    }
                })
            };
            let (a, b) = tokio::join!(writer(left, db.clone()), writer(right, db.clone()));
            a.unwrap();
            b.unwrap();
            for v in 0..40 {
                let key = version_key(
                    ORG,
                    "ingester",
                    "k8s:obs-region/openobserve",
                    &format!("v{v}"),
                );
                let mine: Vec<ServiceVersionRecord> = all
                    .iter()
                    .filter(|r| r.version_key == key)
                    .cloned()
                    .collect();
                assert_eq!(row(&db, &key).await, serial_merge(&mine), "v{v}");
            }
        }
    }

    async fn tombstone(db: &DatabaseConnection, key: &str, at: i64, guard: Option<i64>) -> u64 {
        tombstone_many(db, ORG, &[key.to_string()], at, guard)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn tombstone_ignores_older_and_revives_newer() {
        for db in dbs("sv_tombstone").await {
            let first = obs("v1", 100, 200).to_record(ORG, 1);
            let key = first.version_key.clone();
            let mut expected = first.clone();
            merge_upsert_many(&db, vec![first]).await.unwrap();

            assert_eq!(tombstone(&db, &key, 300, None).await, 1);
            expected.apply_tombstone(300);
            assert_eq!(tombstone(&db, &key, 250, None).await, 0, "an older delete");
            expected.apply_tombstone(250);
            assert_eq!(row(&db, &key).await, expected);
            assert!(!expected.is_live());
            assert!(
                list(&db, ORG, &ListQuery::default())
                    .await
                    .unwrap()
                    .is_empty()
            );

            let older = obs("v1", 250, 290).to_record(ORG, 2);
            merge_upsert_many(&db, vec![older.clone()]).await.unwrap();
            expected.merge(&older);
            assert_eq!(row(&db, &key).await, expected);
            assert!(
                !expected.is_live(),
                "traffic before the tombstone keeps it hidden"
            );

            let newer = rum(obs("v1", 280, 400)).to_record(ORG, 3);
            for _ in 0..2 {
                let returned = merge_upsert_many(&db, vec![newer.clone()]).await.unwrap();
                expected.merge(&newer);
                assert_eq!(
                    returned,
                    vec![expected.clone()],
                    "the upsert returns the merged row"
                );
                let revived = row(&db, &key).await;
                assert_eq!(revived, expected, "revival is idempotent under redelivery");
                assert!(revived.is_live());
                assert_eq!((revived.first_seen, revived.last_seen), (300, 400));
                assert_eq!(
                    (revived.rum_first_seen, revived.rum_last_seen),
                    (Some(300), Some(400))
                );
                assert_eq!(
                    (revived.traces_first_seen, revived.traces_last_seen),
                    (Some(300), Some(290)),
                    "the dead traces history stays clamped, not revived"
                );
            }
            let pre_delete = obs("v1", 50, 260).to_record(ORG, 4);
            merge_upsert_many(&db, vec![pre_delete.clone()])
                .await
                .unwrap();
            expected.merge(&pre_delete);
            assert_eq!(row(&db, &key).await, expected);
            assert_eq!(
                expected.first_seen, 300,
                "pre-delete history is never merged back"
            );
            assert_eq!(
                list(&db, ORG, &ListQuery::default()).await.unwrap(),
                vec![expected]
            );
        }
    }

    #[tokio::test]
    async fn tombstone_under_newer_traffic_floors_the_row_and_stays_live() {
        for db in dbs("sv_floor_live").await {
            let mut o = obs("v1", 100, 500);
            o.signal = SIGNAL_TRACES.to_string();
            let mut expected = o.to_record(ORG, 1);
            let browser = rum(obs("v1", 50, 250)).to_record(ORG, 1);
            merge_upsert_many(&db, vec![expected.clone(), browser.clone()])
                .await
                .unwrap();
            expected.merge(&browser);
            assert_eq!(tombstone(&db, &expected.version_key, 300, None).await, 1);
            expected.apply_tombstone(300);
            let stored = row(&db, &expected.version_key).await;
            assert_eq!(stored, expected);
            assert!(stored.is_live());
            assert_eq!(
                (stored.first_seen, stored.traces_first_seen),
                (300, Some(300))
            );
            assert_eq!(
                (stored.rum_first_seen, stored.rum_last_seen),
                (Some(300), Some(250))
            );
        }
    }

    /// A delayed delete at 300 clamps a version first seen at 500, through every write path.
    #[tokio::test]
    async fn delayed_tombstone_clamps_first_seen_on_both_backends() {
        let after = obs("v1", 500, 600).to_record(ORG, 1);
        let mut tombstoned = after.clone();
        tombstoned.deleted_at = Some(300);
        let key = after.version_key.clone();
        let v2 = obs("v2", 400, 600).to_record(ORG, 1);
        for db in dbs("sv_clamp").await {
            merge_upsert_many(&db, vec![after.clone(), v2.clone()])
                .await
                .unwrap();
            assert_eq!(tombstone(&db, &key, 300, None).await, 1);
            let mut expected = after.clone();
            expected.apply_tombstone(300);
            let stored = row(&db, &key).await;
            assert_eq!(stored, expected);
            assert_eq!(
                (stored.first_seen, stored.traces_first_seen),
                (500, Some(500))
            );
            assert!(stored.is_live());
            assert!(
                stored.first_seen > row(&db, &v2.version_key).await.first_seen,
                "v1 still ranks newer than v2, first seen at 400"
            );
            for pair in [
                [after.clone(), tombstoned.clone()],
                [tombstoned.clone(), after.clone()],
            ] {
                delete_by_org(&db, ORG).await.unwrap();
                for r in &pair {
                    merge_upsert_many(&db, vec![r.clone()]).await.unwrap();
                }
                let merged = row(&db, &key).await;
                assert_eq!(merged, serial_merge(&pair));
                assert_eq!(
                    (merged.first_seen, merged.last_seen, merged.deleted_at),
                    (500, 600, Some(300))
                );
            }
        }
    }

    /// Live, revived, dead and RUM histories of one key, plus a duplicate of the revived one.
    fn floored() -> Vec<ServiceVersionRecord> {
        let live = with_env(obs("v1", 100, 400), "prod", EnvSource::Attribute).to_record(ORG, 1);
        let mut revived = obs("v1", 300, 400).to_record(ORG, 2);
        revived.deleted_at = Some(300);
        let mut dead = obs("v1", 50, 250).to_record(ORG, 3);
        dead.deleted_at = Some(260);
        let browser = rum(obs("v1", 10, 450)).to_record(ORG, 0);
        vec![live, revived.clone(), dead, browser, revived]
    }

    #[tokio::test]
    async fn merge_upsert_with_floors_is_order_insensitive_on_both_backends() {
        let records = floored();
        let key = records[0].version_key.clone();
        let expected = serial_merge(&records);
        assert_eq!(expected.deleted_at, Some(300));
        assert_eq!((expected.first_seen, expected.last_seen), (300, 450));
        assert_eq!(
            (expected.rum_first_seen, expected.rum_last_seen),
            (Some(300), Some(450))
        );
        for db in dbs("sv_floors").await {
            for order in permutations(records.len()) {
                delete_by_org(&db, ORG).await.unwrap();
                for i in &order {
                    merge_upsert_many(&db, vec![records[*i].clone()])
                        .await
                        .unwrap();
                }
                assert_eq!(
                    row(&db, &key).await,
                    expected,
                    "one call per record, {order:?}"
                );
                delete_by_org(&db, ORG).await.unwrap();
                let batch = order.iter().map(|i| records[*i].clone()).collect();
                merge_upsert_many(&db, batch).await.unwrap();
                assert_eq!(row(&db, &key).await, expected, "one batch, {order:?}");
            }
        }
    }

    #[tokio::test]
    async fn hard_delete_rechecks_age_and_hiddenness_after_the_scan() {
        for db in dbs("sv_hard_delete").await {
            let records: Vec<ServiceVersionRecord> =
                ["refreshed", "revived", "redeleted", "expired"]
                    .iter()
                    .map(|v| obs(v, 10, 20).to_record(ORG, 1))
                    .collect();
            let keys: Vec<String> = records.iter().map(|r| r.version_key.clone()).collect();
            merge_upsert_many(&db, records.clone()).await.unwrap();
            tombstone_many(&db, ORG, &keys, 50, None).await.unwrap();
            let mut scanned = expired_tombstones(&db, ORG, 60, 10).await.unwrap();
            scanned.sort();
            let mut all = keys.clone();
            all.sort();
            assert_eq!(scanned, all);

            tombstone(&db, &keys[0], 100, None).await;
            merge_upsert_many(&db, vec![obs("revived", 70, 80).to_record(ORG, 2)])
                .await
                .unwrap();
            merge_upsert_many(&db, vec![obs("redeleted", 70, 80).to_record(ORG, 2)])
                .await
                .unwrap();
            tombstone(&db, &keys[2], 90, None).await;

            assert_eq!(delete_expired(&db, ORG, scanned, 60).await.unwrap(), 1);
            let left: Vec<String> = get_by_keys(&db, ORG, &keys)
                .await
                .unwrap()
                .into_iter()
                .map(|r| r.version)
                .collect();
            assert_eq!(left.len(), 3);
            assert!(!left.contains(&"expired".to_string()));
        }
    }

    #[tokio::test]
    async fn purge_excludes_served_newest_and_expired_provenance() {
        use super::super::entity::service_version_deploys as deploys;
        for db in dbs("purge_history_floor").await {
            let records: Vec<_> = [
                obs("historical", 1, 10),
                obs("junk", 30, 35),
                obs("served", 40, 80),
                obs("newest", 100, 150),
            ]
            .into_iter()
            .map(|o| o.to_record(ORG, 1))
            .collect();
            merge_upsert_many(&db, records.clone()).await.unwrap();
            summary::upsert_many(
                &db,
                vec![obs("newest", 100, 150).to_summary(ORG, &records[3], 1)],
            )
            .await
            .unwrap();
            let row = deploys::Model {
                deploy_key: sha256::digest(
                    serde_json::json!([
                        ORG,
                        "ingester",
                        "k8s:obs-region/openobserve",
                        "region",
                        "served",
                        50
                    ])
                    .to_string(),
                ),
                org_id: ORG.into(),
                service_name: "ingester".into(),
                where_key: "k8s:obs-region/openobserve".into(),
                scope_key: records[2].scope_key.clone(),
                cluster: "region".into(),
                to_version: "served".into(),
                to_version_key: records[2].version_key.clone(),
                kind: "deploy".into(),
                entry_source: "traffic".into(),
                at: 50,
                source_streams: "[]".into(),
                serving_versions: "[]".into(),
                full_serving: "[]".into(),
                ..Default::default()
            };
            super::super::service_version_deploys::put(&db, row)
                .await
                .unwrap();
            assert_eq!(
                purge_candidates_since(&db, ORG, 90, 20, 100).await.unwrap(),
                vec![records[1].version_key.clone()]
            );
            super::super::service_version_deploys::delete_by_org(&db, ORG)
                .await
                .unwrap();
            assert!(
                purge_candidates_since(&db, ORG, 90, 60, 100)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[tokio::test]
    async fn purge_tombstone_rechecks_last_seen_against_traffic_after_the_scan() {
        for db in dbs("sv_purge_race").await {
            let stale = obs("v0", 10, 20).to_record(ORG, 1);
            let key = stale.version_key.clone();
            merge_upsert_many(&db, vec![stale]).await.unwrap();
            assert_eq!(
                purge_candidates(&db, ORG, 100, 10).await.unwrap(),
                vec![key.clone()]
            );
            merge_upsert_many(&db, vec![obs("v0", 150, 190).to_record(ORG, 2)])
                .await
                .unwrap();
            assert_eq!(tombstone(&db, &key, 200, Some(100)).await, 0);
            assert!(
                row(&db, &key).await.is_live(),
                "fresh traffic keeps the row"
            );
            assert_eq!(
                tombstone(&db, &key, 200, None).await,
                1,
                "unguarded it would hide it"
            );
            assert!(!row(&db, &key).await.is_live());
        }
    }

    #[test]
    fn semilattice_exprs_coalesce_every_nullable_arg() {
        for backend in [DbBackend::Sqlite, DbBackend::Postgres] {
            for (column, expr) in semilattice_upsert_exprs(backend) {
                let SimpleExpr::Custom(text) = expr else {
                    panic!("{column:?} is not a custom expression");
                };
                let nullable = matches!(
                    column,
                    Column::TracesFirstSeen
                        | Column::TracesLastSeen
                        | Column::RumFirstSeen
                        | Column::RumLastSeen
                );
                if nullable {
                    assert!(text.contains("COALESCE("), "{backend:?} {column:?}: {text}");
                }
                let foreign = match backend {
                    DbBackend::Postgres => ["min(", "max("],
                    _ => ["LEAST(", "GREATEST("],
                };
                assert!(
                    foreign.iter().all(|f| !text.contains(f)),
                    "{backend:?} {column:?} mixes dialects: {text}"
                );
            }
        }
    }

    #[tokio::test]
    async fn semilattice_null_side_never_nulls_the_result() {
        for db in dbs("sv_nulls").await {
            let traces = obs("v1", 100, 200).to_record(ORG, 1);
            let mut browser = rum(obs("v1", 150, 300)).to_record(ORG, 1);
            browser.raw_version = None;
            for pair in [
                [traces.clone(), browser.clone()],
                [browser.clone(), traces.clone()],
            ] {
                delete_by_org(&db, ORG).await.unwrap();
                for r in &pair {
                    merge_upsert_many(&db, vec![r.clone()]).await.unwrap();
                }
                let merged = row(&db, &traces.version_key).await;
                assert_eq!(
                    (merged.traces_first_seen, merged.traces_last_seen),
                    (Some(100), Some(200))
                );
                assert_eq!(
                    (merged.rum_first_seen, merged.rum_last_seen),
                    (Some(150), Some(300))
                );
                assert_eq!(merged, serial_merge(&pair));
            }
        }
    }

    #[tokio::test]
    async fn merge_upsert_chunks_at_500_rows_under_bind_limits() {
        let records: Vec<ServiceVersionRecord> = (0..1201)
            .map(|v| obs(&format!("v{v}"), v, v + 10).to_record(ORG, 1))
            .collect();
        for backend in [DbBackend::Sqlite, DbBackend::Postgres] {
            let statements = upsert_statements(backend, records.clone());
            assert_eq!(statements.len(), 3, "{backend:?}");
            let binds: Vec<usize> = statements
                .iter()
                .map(|s| s.values.as_ref().map_or(0, |v| v.0.len()))
                .collect();
            assert_eq!(binds, vec![500 * 25, 500 * 25, 201 * 25], "{backend:?}");
            let limit = if backend == DbBackend::Sqlite {
                32_766
            } else {
                65_535
            };
            assert!(binds.iter().all(|b| *b <= limit));
        }
        for db in dbs("sv_chunks").await {
            let merged = merge_upsert_many(&db, records.clone()).await.unwrap();
            assert_eq!(merged.len(), 1201, "one merged row back per record");
            assert_eq!(rows_in_org(&db, ORG).await, 1201);
        }
    }

    #[tokio::test]
    async fn columns_hold_max_inputs() {
        let cluster = "c".repeat(253);
        let namespace = "n".repeat(253);
        let env = "e".repeat(253);
        let mut o = obs("v1", 1, 2);
        o.where_key = format!("k8s:{cluster}/{namespace}");
        o.k8s_cluster = cluster.clone();
        o.k8s_namespace = namespace.clone();
        o.env = env.clone();
        o.env_source_value = format!("deployment.environment.name={env}");
        assert_eq!(o.where_key.len(), 511);
        assert_eq!(o.env_source_value.len(), 281);
        for db in dbs("sv_sizes").await {
            let record = o.to_record(ORG, 1);
            merge_upsert_many(&db, vec![record.clone()]).await.unwrap();
            assert_eq!(row(&db, &record.version_key).await, record);
            let summary_row = o.to_summary(ORG, &record, 1);
            summary::upsert_many(&db, vec![summary_row.clone()])
                .await
                .unwrap();
            assert_eq!(
                summary::list_by_org(&db, ORG).await.unwrap(),
                vec![summary_row]
            );
            let rule = config::meta::service_identity::Override {
                rule_key: config::meta::service_identity::rule_key(
                    ORG,
                    "where",
                    &cluster,
                    &o.where_key,
                    "",
                ),
                org_id: ORG.to_string(),
                rule_type: config::meta::service_identity::RULE_TYPE_ENV_OVERRIDE.to_string(),
                scope: OverrideScope::Where,
                k8s_cluster: cluster.clone(),
                where_key: o.where_key.clone(),
                service_name: String::new(),
                value: "p".repeat(128),
                inferred_value: env.clone(),
                inferred_source: EnvSource::ClusterName,
                created_by: "a".repeat(256),
                updated_by: "a".repeat(256),
                created_at: 1,
                updated_at: 1,
                deleted_at: None,
                writer_cluster: "w".repeat(128),
            };
            assert!(service_identity_rules::upsert(&db, &rule).await.unwrap());
            assert_eq!(
                service_identity_rules::list(&db, ORG).await.unwrap(),
                vec![rule]
            );
        }
    }

    #[tokio::test]
    async fn org_delete_removes_identity_tables() {
        for db in dbs("sv_org_delete").await {
            for org in ["acme", "acme2", "acm"] {
                let o = obs("v1", 1, 2);
                merge_upsert_many(&db, vec![o.to_record(org, 1)])
                    .await
                    .unwrap();
                summary::upsert_many(&db, vec![o.to_summary(org, &o.to_record(org, 1), 1)])
                    .await
                    .unwrap();
                let key = config::meta::service_identity::rule_key(org, "cluster", "c", "", "");
                service_identity_rules::tombstone(&db, org, &key, 5, "eu")
                    .await
                    .unwrap();
            }
            assert_eq!(delete_by_org(&db, "acme").await.unwrap(), 1);
            assert_eq!(summary::delete_by_org(&db, "acme").await.unwrap(), 1);
            assert_eq!(
                service_identity_rules::delete_by_org(&db, "acme")
                    .await
                    .unwrap(),
                1
            );
            assert_eq!(rows_in_org(&db, "acme").await, 0);
            for org in ["acme2", "acm"] {
                assert_eq!(
                    rows_in_org(&db, org).await,
                    1,
                    "{org} keeps its registry row"
                );
                assert_eq!(summary::list_by_org(&db, org).await.unwrap().len(), 1);
                let rules = crate::table::entity::service_identity_rules::Entity::find()
                    .filter(crate::table::entity::service_identity_rules::Column::OrgId.eq(org))
                    .count(&db)
                    .await
                    .unwrap();
                assert_eq!(rules, 1, "{org} keeps its override tombstone");
            }
        }
    }

    #[tokio::test]
    async fn reads_skip_tombstones_and_scope_their_counts() {
        for db in dbs("sv_reads").await {
            let mut other_where = obs("v2", 10, 20);
            other_where.where_key = "k8s:obs-region/pentest".to_string();
            other_where.k8s_namespace = "pentest".to_string();
            let mut other_service = obs("", 10, 30);
            other_service.service_name = "unknown_service:node".to_string();
            let records = vec![
                obs("v1", 10, 100).to_record(ORG, 1),
                obs("v0", 5, 15).to_record(ORG, 1),
                other_where.to_record(ORG, 1),
                other_service.to_record(ORG, 1),
            ];
            merge_upsert_many(&db, records.clone()).await.unwrap();
            let one_scope = ListQuery {
                service_name: Some("ingester".to_string()),
                where_key: Some("k8s:obs-region/openobserve".to_string()),
                limit: 10,
                offset: 0,
            };
            let listed: Vec<String> = list(&db, ORG, &one_scope)
                .await
                .unwrap()
                .into_iter()
                .map(|r| r.version)
                .collect();
            assert_eq!(listed, vec!["v1", "v0"]);
            assert_eq!(
                count(
                    &db,
                    OverrideScope::Service,
                    "k8s:obs-region/openobserve",
                    "ingester"
                )
                .await,
                ScopeCount {
                    services: 1,
                    versions: 2
                }
            );
            assert_eq!(
                count(&db, OverrideScope::Where, "k8s:obs-region/openobserve", "").await,
                ScopeCount {
                    services: 2,
                    versions: 3
                }
            );
            assert_eq!(
                count(&db, OverrideScope::Cluster, "", "").await,
                ScopeCount {
                    services: 2,
                    versions: 4
                }
            );
            let unresolved = list_unresolved(&db, ORG, UnresolvedKind::NoVersion, 10)
                .await
                .unwrap();
            assert_eq!(unresolved.len(), 1);
            let placeholders = list_unresolved(&db, ORG, UnresolvedKind::PlaceholderName, 10)
                .await
                .unwrap();
            assert_eq!(placeholders[0].service_name, "unknown_service:node");

            let newest = obs("v1", 10, 100).to_summary(ORG, &records[0], 1);
            assert_eq!(newest.newest_version_key, records[0].version_key);
            summary::upsert_many(&db, vec![newest]).await.unwrap();
            let candidates = purge_candidates(&db, ORG, 1_000, 10).await.unwrap();
            assert!(
                !candidates.contains(&records[0].version_key),
                "the scope's newest is kept"
            );
            assert_eq!(candidates.len(), 3);

            tombstone_many(&db, ORG, &[records[1].version_key.clone()], 50, None)
                .await
                .unwrap();
            assert_eq!(count(&db, OverrideScope::Cluster, "", "").await.versions, 3);
            assert_eq!(hard_delete_tombstones(&db, ORG, 40, 10).await.unwrap(), 0);
            assert_eq!(hard_delete_tombstones(&db, ORG, 60, 10).await.unwrap(), 1);
            assert_eq!(rows_in_org(&db, ORG).await, 3);
        }
    }

    #[tokio::test]
    async fn seen_since_keeps_recent_and_tombstoned_keys_of_one_org() {
        for db in dbs("sv_seen").await {
            let recent = obs("v2", 100, 900).to_record(ORG, 1);
            let old = obs("v1", 10, 50).to_record(ORG, 1);
            let mut deleted = obs("v3", 200, 800).to_record(ORG, 1);
            deleted.deleted_at = Some(850);
            let sibling = obs("v2", 100, 900).to_record("acme2", 1);
            merge_upsert_many(&db, vec![recent.clone(), old, deleted.clone(), sibling])
                .await
                .unwrap();
            let mut keys = version_keys_seen_since(&db, ORG, 800).await.unwrap();
            keys.sort();
            let mut expected = vec![recent.version_key, deleted.version_key];
            expected.sort();
            assert_eq!(keys, expected);
        }
    }
}
