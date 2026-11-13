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

use config::meta::service_identity::{AliasRow, WhereSummaryRecord};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DbBackend, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Select, Set, TransactionTrait,
    sea_query::{Expr, Func, LikeExpr, OnConflict},
};

use super::{
    entity::service_name_aliases::{ActiveModel, Column, Entity, Model},
    service_versions::Dialect,
};
use crate::errors;

static CONFLICT_RULE: std::sync::OnceLock<ConflictRule> = std::sync::OnceLock::new();

/// Alias list filters; `accepted` is active with `accepted_by`; a conflicted row is `proposed`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AliasFilter {
    pub kind: Option<String>,
    pub status: Option<String>,
    pub confidence: Option<String>,
    pub q: Option<String>,
}

/// Picks the live alias keys the collision rule keeps inactive, from the org's committed state.
pub type ConflictRule =
    fn(&[WhereSummaryRecord], &[AliasRow], &[super::service_streams::ServiceRecord]) -> Vec<String>;

pub async fn put_learned_batch<C: ConnectionTrait + sea_orm::TransactionTrait>(
    conn: &C,
    region: &str,
    token: i64,
    rows: &[AliasRow],
) -> Result<std::collections::HashSet<String>, errors::Error> {
    let tx = conn.begin().await?;
    for org_id in rows
        .iter()
        .map(|row| row.org_id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
    {
        lock_org(&tx, org_id).await?;
    }
    let statement = sea_orm::Statement::from_sql_and_values(
        tx.get_database_backend(),
        "INSERT INTO service_name_alias_fences (region, fencing_token) VALUES ($1, $2) ON CONFLICT (region) DO UPDATE SET fencing_token = excluded.fencing_token WHERE excluded.fencing_token >= service_name_alias_fences.fencing_token",
        vec![region.into(), token.into()],
    );
    if tx.execute(statement).await?.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(sea_orm::DbErr::Custom("service alias ownership changed".into()).into());
    }
    let mut changed = std::collections::HashSet::new();
    for row in rows {
        let mut row = row.clone();
        row.fencing_token = token;
        if upsert_learned(&tx, &row).await? {
            changed.insert(row.alias_key);
        }
    }
    // A batch that changed no row of an org leaves that org's conflicts as they were.
    for org_id in rows
        .iter()
        .filter(|row| changed.contains(&row.alias_key))
        .map(|row| row.org_id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
    {
        recompute_conflicts(&tx, org_id).await?;
    }
    tx.commit().await?;
    Ok(changed)
}

/// Orders every alias writer of the org until its transaction ends; call it inside one.
pub async fn lock_org<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<(), errors::Error> {
    // SQLite admits one writer at a time, and a transaction whose reads went stale cannot commit.
    if conn.get_database_backend() != DbBackend::Postgres {
        return Ok(());
    }
    conn.execute(sea_orm::Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        vec![format!("service_name_aliases/{org_id}").into()],
    ))
    .await?;
    Ok(())
}

pub async fn upsert<C: ConnectionTrait>(conn: &C, row: &AliasRow) -> Result<bool, errors::Error> {
    let conflict = OnConflict::column(Column::AliasKey)
        .update_columns([
            Column::FencingToken,
            Column::Kind,
            Column::Scope,
            Column::Alias,
            Column::Canonical,
            Column::Status,
            Column::Origin,
            Column::Evidence,
            Column::Confidence,
            Column::AcceptedBy,
            Column::AcceptedAt,
            Column::BatchId,
            Column::PrevStatus,
            Column::FirstSeen,
            Column::LastSeen,
            Column::CreatedBy,
            Column::CreatedAt,
            Column::UpdatedAt,
            Column::DeletedAt,
            Column::WriterCluster,
            Column::AllowCollisions,
        ])
        .action_and_where(Expr::cust(lww(conn.get_database_backend())))
        .to_owned();
    Ok(Entity::insert(active(row))
        .on_conflict(conflict)
        .exec_without_returning(conn)
        .await?
        > 0)
}

pub async fn upsert_learned<C: ConnectionTrait>(
    conn: &C,
    row: &AliasRow,
) -> Result<bool, errors::Error> {
    let sql = Dialect::new(conn.get_database_backend(), "service_name_aliases");
    let locked = format!(
        "{} = 'manual' OR {} = 'rejected' OR {} IS NOT NULL",
        sql.stored("origin"),
        sql.stored("status"),
        sql.stored("deleted_at")
    );
    let mut conflict = OnConflict::column(Column::AliasKey).to_owned();
    conflict.value(
        Column::Kind,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("kind"),
            sql.incoming("kind")
        )),
    );
    conflict.value(
        Column::Scope,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("scope"),
            sql.incoming("scope")
        )),
    );
    conflict.value(
        Column::Alias,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("alias"),
            sql.incoming("alias")
        )),
    );
    conflict.value(
        Column::Canonical,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("canonical"),
            sql.incoming("canonical")
        )),
    );
    conflict.value(
        Column::Status,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("status"),
            sql.incoming("status")
        )),
    );
    conflict.value(
        Column::Origin,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("origin"),
            sql.incoming("origin")
        )),
    );
    conflict.value(
        Column::Evidence,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("evidence"),
            sql.incoming("evidence")
        )),
    );
    conflict.value(
        Column::Confidence,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("confidence"),
            sql.incoming("confidence")
        )),
    );
    conflict.value(Column::AcceptedBy, Expr::cust(sql.stored("accepted_by")));
    conflict.value(Column::AcceptedAt, Expr::cust(sql.stored("accepted_at")));
    conflict.value(Column::BatchId, Expr::cust(sql.stored("batch_id")));
    conflict.value(Column::PrevStatus, Expr::cust(sql.stored("prev_status")));
    conflict.value(Column::FirstSeen, Expr::cust(format!("CASE WHEN {0} IS NULL THEN {1} WHEN {1} IS NULL THEN {0} WHEN {0} < {1} THEN {0} ELSE {1} END", sql.stored("first_seen"), sql.incoming("first_seen"))));
    conflict.value(Column::LastSeen, Expr::cust(format!("CASE WHEN {0} IS NULL THEN {1} WHEN {1} IS NULL THEN {0} WHEN {0} > {1} THEN {0} ELSE {1} END", sql.stored("last_seen"), sql.incoming("last_seen"))));
    conflict.value(Column::CreatedBy, Expr::cust(sql.stored("created_by")));
    conflict.value(Column::CreatedAt, Expr::cust(sql.stored("created_at")));
    conflict.value(
        Column::UpdatedAt,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("updated_at"),
            sql.incoming("updated_at")
        )),
    );
    conflict.value(
        Column::DeletedAt,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("deleted_at"),
            sql.incoming("deleted_at")
        )),
    );
    conflict.value(
        Column::WriterCluster,
        Expr::cust(format!(
            "CASE WHEN {locked} THEN {} ELSE {} END",
            sql.stored("writer_cluster"),
            sql.incoming("writer_cluster")
        )),
    );
    conflict.value(
        Column::AllowCollisions,
        Expr::cust(sql.stored("allow_collisions")),
    );
    conflict.value(
        Column::FencingToken,
        Expr::cust(sql.incoming("fencing_token")),
    );
    let condition = format!(
        "{} AND {} >= {} AND (({} > {}) OR ({}))",
        exact_org(&sql),
        sql.incoming("fencing_token"),
        sql.stored("fencing_token"),
        sql.incoming("fencing_token"),
        sql.stored("fencing_token"),
        lww(conn.get_database_backend())
    );
    conflict.action_and_where(Expr::cust(condition));
    Ok(Entity::insert(active(row))
        .on_conflict(conflict.to_owned())
        .exec_without_returning(conn)
        .await?
        > 0)
}

pub async fn tombstone<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    key: &str,
    at: i64,
    cluster: &str,
) -> Result<bool, errors::Error> {
    let row = AliasRow {
        alias_key: key.into(),
        org_id: org_id.into(),
        updated_at: at,
        deleted_at: Some(at),
        writer_cluster: cluster.into(),
        ..Default::default()
    };
    let conflict = OnConflict::column(Column::AliasKey)
        .update_columns([Column::UpdatedAt, Column::DeletedAt, Column::WriterCluster])
        .action_and_where(Expr::cust(lww(conn.get_database_backend())))
        .to_owned();
    Ok(Entity::insert(active(&row))
        .on_conflict(conflict)
        .exec_without_returning(conn)
        .await?
        > 0)
}

/// Installs the collision rule every alias write re-runs; the first call wins.
pub fn set_conflict_rule(rule: ConflictRule) {
    let _ = CONFLICT_RULE.set(rule);
}

/// Re-derives every row's conflicted flag from the org's rows, so arrival order never matters.
pub async fn recompute_conflicts<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<std::collections::HashSet<String>, errors::Error> {
    let Some(rule) = CONFLICT_RULE.get() else {
        return Ok(Default::default());
    };
    let aliases = list(conn, org_id).await?;
    let summaries = super::service_where_summary::list_by_org(conn, org_id).await?;
    let identities = super::service_streams::list_with(conn, org_id).await?;
    let wanted: std::collections::HashSet<String> = rule(&summaries, &aliases, &identities)
        .into_iter()
        .collect();
    let (raise, clear): (Vec<&AliasRow>, Vec<&AliasRow>) = aliases
        .iter()
        .filter(|row| row.conflicted != wanted.contains(&row.alias_key))
        .partition(|row| !row.conflicted);
    let keys = |rows: &[&AliasRow]| {
        rows.iter()
            .map(|row| row.alias_key.clone())
            .collect::<Vec<_>>()
    };
    set_conflicted(conn, org_id, &keys(&raise), true).await?;
    set_conflicted(conn, org_id, &keys(&clear), false).await?;
    Ok(raise
        .iter()
        .chain(&clear)
        .map(|row| row.alias_key.clone())
        .collect())
}

/// Sets the derived flag only; status, revision and writer stay as the row's writer left them.
pub async fn set_conflicted<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    keys: &[String],
    conflicted: bool,
) -> Result<u64, errors::Error> {
    let mut changed = 0;
    for chunk in keys.chunks(500) {
        changed += Entity::update_many()
            .col_expr(Column::Conflicted, Expr::value(conflicted))
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::AliasKey.is_in(chunk.iter().map(String::as_str)))
            .exec(conn)
            .await?
            .rows_affected;
    }
    Ok(changed)
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<AliasRow>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::AliasKey)
        .all(conn)
        .await?
        .into_iter()
        .map(from_model)
        .collect())
}

/// One row by key, tombstones included.
pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    key: &str,
) -> Result<Option<AliasRow>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AliasKey.eq(key))
        .one(conn)
        .await?
        .map(from_model))
}

/// Live rows matching `filter`, newest `updated_at` first, plus the total before paging.
pub async fn list_page<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    filter: &AliasFilter,
    limit: u64,
    offset: u64,
) -> Result<(Vec<AliasRow>, u64), errors::Error> {
    let total = filtered(org_id, filter).count(conn).await?;
    let rows = filtered(org_id, filter)
        .order_by_desc(Column::UpdatedAt)
        .order_by_asc(Column::AliasKey)
        .offset(offset)
        .limit(limit)
        .all(conn)
        .await?
        .into_iter()
        .map(from_model)
        .collect();
    Ok((rows, total))
}

/// Live rows still carrying `batch_id`, the set an undo restores.
pub async fn list_batch<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    batch_id: &str,
) -> Result<Vec<AliasRow>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::BatchId.eq(batch_id))
        .filter(Column::DeletedAt.is_null())
        .order_by_asc(Column::AliasKey)
        .all(conn)
        .await?
        .into_iter()
        .map(from_model)
        .collect())
}

/// Admin writes in one transaction; returns the keys whose row changed.
pub async fn put_manual_batch<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    rows: &[AliasRow],
) -> Result<std::collections::HashSet<String>, errors::Error> {
    let tx = conn.begin().await?;
    let mut changed = std::collections::HashSet::new();
    for row in rows.iter().filter(|row| row.org_id == org_id) {
        if upsert(&tx, row).await? {
            changed.insert(row.alias_key.clone());
        }
    }
    recompute_conflicts(&tx, org_id).await?;
    tx.commit().await?;
    Ok(changed)
}

/// The row a bulk accept or reject writes; `prev_status` and `batch_id` make it undoable.
pub fn bulk_transition(
    row: &AliasRow,
    accept: bool,
    user: &str,
    batch_id: &str,
    at: i64,
    cluster: &str,
) -> AliasRow {
    let mut next = row.clone();
    next.prev_status = Some(row.status.clone());
    next.batch_id = Some(batch_id.to_string());
    next.origin = "manual".into();
    next.updated_at = at.max(row.updated_at + 1);
    next.writer_cluster = cluster.to_string();
    if accept {
        next.status = "active".into();
        next.accepted_by = Some(user.to_string());
        next.accepted_at = Some(at);
    } else {
        next.status = "rejected".into();
    }
    next
}

/// The row an undo writes: the status before the batch, and a proposal goes back to the learner.
pub fn undo_transition(row: &AliasRow, at: i64, cluster: &str) -> AliasRow {
    let mut next = row.clone();
    next.status = row
        .prev_status
        .clone()
        .unwrap_or_else(|| row.status.clone());
    next.prev_status = None;
    next.batch_id = None;
    if next.status == "proposed" {
        next.origin = "learned".into();
        next.accepted_by = None;
        next.accepted_at = None;
        next.allow_collisions = false;
    }
    next.updated_at = at.max(row.updated_at + 1);
    next.writer_cluster = cluster.to_string();
    next
}

/// Restores each snapshot row only while it still holds the revision the batch wrote.
pub async fn restore_batch<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    batch_id: &str,
    snapshot: &[AliasRow],
    at: i64,
    cluster: &str,
) -> Result<std::collections::HashSet<String>, errors::Error> {
    let mut restored = std::collections::HashSet::new();
    let rows = snapshot
        .iter()
        .filter(|row| row.org_id == org_id && row.batch_id.as_deref() == Some(batch_id));
    for row in rows {
        let next = undo_transition(row, at, cluster);
        // Only the columns undo owns change, so a learner's last_seen or evidence bump survives.
        let changed = Entity::update_many()
            .col_expr(Column::Status, Expr::value(next.status))
            .col_expr(Column::Origin, Expr::value(next.origin))
            .col_expr(Column::AcceptedBy, Expr::value(next.accepted_by))
            .col_expr(Column::AcceptedAt, Expr::value(next.accepted_at))
            .col_expr(Column::AllowCollisions, Expr::value(next.allow_collisions))
            .col_expr(Column::PrevStatus, Expr::value(Option::<String>::None))
            .col_expr(Column::BatchId, Expr::value(Option::<String>::None))
            .col_expr(Column::UpdatedAt, Expr::value(next.updated_at))
            .col_expr(Column::WriterCluster, Expr::value(next.writer_cluster))
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::AliasKey.eq(row.alias_key.as_str()))
            .filter(Column::BatchId.eq(batch_id))
            .filter(Column::UpdatedAt.eq(row.updated_at))
            .filter(Column::WriterCluster.eq(row.writer_cluster.as_str()))
            .filter(Column::DeletedAt.is_null())
            .exec(conn)
            .await?
            .rows_affected;
        if changed > 0 {
            restored.insert(row.alias_key.clone());
        }
    }
    Ok(restored)
}

/// Undo in one transaction; a row a later write replaced, re-batched or deleted stays as it is.
pub async fn undo_batch<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    batch_id: &str,
    at: i64,
    cluster: &str,
) -> Result<std::collections::HashSet<String>, errors::Error> {
    let tx = conn.begin().await?;
    let snapshot = list_batch(&tx, org_id, batch_id).await?;
    let restored = restore_batch(&tx, org_id, batch_id, &snapshot, at, cluster).await?;
    recompute_conflicts(&tx, org_id).await?;
    tx.commit().await?;
    Ok(restored)
}

pub async fn delete_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?
        .rows_affected)
}

pub async fn purge_tombstones<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    before: i64,
) -> Result<u64, errors::Error> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DeletedAt.lte(before))
        .filter(Column::UpdatedAt.lte(before))
        .exec(conn)
        .await?
        .rows_affected)
}

fn filtered(org_id: &str, filter: &AliasFilter) -> Select<Entity> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DeletedAt.is_null());
    if let Some(kind) = &filter.kind {
        query = query.filter(Column::Kind.eq(kind.as_str()));
    }
    match filter.status.as_deref() {
        Some("accepted") => {
            query = query
                .filter(Column::Status.eq("active"))
                .filter(Column::Conflicted.eq(false))
                .filter(Column::AcceptedBy.is_not_null());
        }
        Some("active") => {
            query = query
                .filter(Column::Status.eq("active"))
                .filter(Column::Conflicted.eq(false));
        }
        Some("proposed") => {
            query = query.filter(
                Condition::any().add(Column::Status.eq("proposed")).add(
                    Condition::all()
                        .add(Column::Status.eq("active"))
                        .add(Column::Conflicted.eq(true)),
                ),
            );
        }
        Some(status) => query = query.filter(Column::Status.eq(status)),
        None => (),
    }
    if let Some(confidence) = &filter.confidence {
        query = query.filter(Column::Confidence.eq(confidence.as_str()));
    }
    if let Some(q) = filter.q.as_deref().filter(|q| !q.is_empty()) {
        let escaped = q
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = || LikeExpr::new(format!("%{escaped}%")).escape('\\');
        query = query.filter(
            Condition::any()
                .add(Expr::expr(Func::lower(Expr::col(Column::Alias))).like(pattern()))
                .add(Expr::expr(Func::lower(Expr::col(Column::Canonical))).like(pattern())),
        );
    }
    query
}

fn exact_org(sql: &Dialect) -> String {
    format!("{} = {}", sql.stored("org_id"), sql.incoming("org_id"))
}

fn lww(backend: DbBackend) -> String {
    let sql = Dialect::new(backend, "service_name_aliases");
    let rank = |incoming: bool| {
        let col = |c: &str| {
            if incoming {
                sql.incoming(c)
            } else {
                sql.stored(c)
            }
        };
        sql.rank(&[
            col("updated_at"),
            sql.bytes(&col("writer_cluster")),
            format!("CASE WHEN {} IS NULL THEN 0 ELSE 1 END", col("deleted_at")),
            sql.bytes(&col("canonical")),
        ])
    };
    format!("{} AND {} > {}", exact_org(&sql), rank(true), rank(false))
}

fn active(row: &AliasRow) -> ActiveModel {
    ActiveModel {
        alias_key: Set(row.alias_key.clone()),
        org_id: Set(row.org_id.clone()),
        kind: Set(row.kind.clone()),
        scope: Set(row.scope.clone()),
        alias: Set(row.alias.clone()),
        canonical: Set(row.canonical.clone()),
        status: Set(row.status.clone()),
        origin: Set(row.origin.clone()),
        evidence: Set(row.evidence.clone()),
        confidence: Set(row.confidence.clone()),
        accepted_by: Set(row.accepted_by.clone()),
        accepted_at: Set(row.accepted_at),
        batch_id: Set(row.batch_id.clone()),
        prev_status: Set(row.prev_status.clone()),
        first_seen: Set(row.first_seen),
        last_seen: Set(row.last_seen),
        created_by: Set(row.created_by.clone()),
        created_at: Set(row.created_at),
        updated_at: Set(row.updated_at),
        deleted_at: Set(row.deleted_at),
        writer_cluster: Set(row.writer_cluster.clone()),
        fencing_token: Set(row.fencing_token),
        allow_collisions: Set(row.allow_collisions),
        conflicted: Set(row.conflicted),
    }
}

fn from_model(row: Model) -> AliasRow {
    AliasRow {
        alias_key: row.alias_key,
        org_id: row.org_id,
        kind: row.kind,
        scope: row.scope,
        alias: row.alias,
        canonical: row.canonical,
        status: row.status,
        origin: row.origin,
        evidence: row.evidence,
        confidence: row.confidence,
        accepted_by: row.accepted_by,
        accepted_at: row.accepted_at,
        batch_id: row.batch_id,
        prev_status: row.prev_status,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        writer_cluster: row.writer_cluster,
        fencing_token: row.fencing_token,
        allow_collisions: row.allow_collisions,
        conflicted: row.conflicted,
    }
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::alias_key;

    use super::*;
    use crate::table::migration::{
        create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
    };

    #[tokio::test]
    async fn regional_fence_rejects_absent_rename_after_takeover_and_empty_batch() {
        for conn in sqlite_and_postgres_for_test("alias_absent_takeover").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            for (region, empty) in [("proposed", false), ("empty", true)] {
                let workload = AliasRow {
                    alias_key: format!("{region}-workload"),
                    org_id: region.into(),
                    kind: "k8s_workload".into(),
                    alias: "work".into(),
                    canonical: "old".into(),
                    origin: "learned".into(),
                    status: "active".into(),
                    updated_at: 300,
                    fencing_token: 10,
                    ..Default::default()
                };
                put_learned_batch(&conn, region, 10, std::slice::from_ref(&workload))
                    .await
                    .unwrap();
                let rename = AliasRow {
                    alias_key: format!("{region}-rename"),
                    kind: "rename".into(),
                    alias: "old".into(),
                    canonical: "z".into(),
                    ..workload.clone()
                };
                let proposed = AliasRow {
                    status: "proposed".into(),
                    canonical: "work".into(),
                    fencing_token: 20,
                    ..workload.clone()
                };
                let takeover = if empty { vec![] } else { vec![proposed] };
                put_learned_batch(&conn, region, 20, &takeover)
                    .await
                    .unwrap();
                let before = list(&conn, region).await.unwrap();
                assert!(
                    put_learned_batch(&conn, region, 10, &[rename.clone(), workload])
                        .await
                        .is_err()
                );
                assert_eq!(list(&conn, region).await.unwrap(), before);
                assert!(put_learned_batch(&conn, region, 19, &[]).await.is_err());
                // Only this path accepts absent keys even after the newer owner's batch.
                assert!(upsert_learned(&conn, &rename).await.unwrap());
                assert!(
                    list(&conn, region)
                        .await
                        .unwrap()
                        .iter()
                        .any(|row| row.alias_key == rename.alias_key)
                );
            }
        }
    }

    #[tokio::test]
    async fn aliases_lww_locks_tombstones_and_exact_org_cleanup() {
        for conn in sqlite_and_postgres_for_test("aliases_lww").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let mut row = AliasRow {
                alias_key: alias_key("org", "k8s_workload", "ns", "work"),
                org_id: "org".into(),
                kind: "k8s_workload".into(),
                scope: "ns".into(),
                alias: "work".into(),
                canonical: "svc".into(),
                origin: "learned".into(),
                status: "active".into(),
                confidence: "high".into(),
                first_seen: Some(10),
                last_seen: Some(20),
                updated_at: 20,
                writer_cluster: "a".into(),
                ..Default::default()
            };
            assert!(upsert_learned(&conn, &row).await.unwrap());
            row.updated_at = 30;
            row.origin = "manual".into();
            row.accepted_by = Some("admin".into());
            assert!(upsert(&conn, &row).await.unwrap());
            let mut learned = row.clone();
            learned.origin = "learned".into();
            learned.canonical = "wrong".into();
            learned.updated_at = 100;
            learned.last_seen = Some(100);
            learned.first_seen = Some(15);
            upsert_learned(&conn, &learned).await.unwrap();
            let saved = list(&conn, "org").await.unwrap().remove(0);
            assert_eq!(saved.canonical, "svc");
            assert_eq!(saved.accepted_by, row.accepted_by);
            assert_eq!(saved.first_seen, Some(10));
            assert_eq!(saved.last_seen, Some(100));
            assert!(
                tombstone(&conn, "org", &row.alias_key, 40, "b")
                    .await
                    .unwrap()
            );
            assert!(!upsert(&conn, &row).await.unwrap());
            upsert_learned(&conn, &learned).await.unwrap();
            assert_eq!(list(&conn, "org").await.unwrap()[0].deleted_at, Some(40));
            assert!(
                !tombstone(&conn, "other", &row.alias_key, 200, "z")
                    .await
                    .unwrap()
            );
            let mut sibling = row.clone();
            sibling.org_id = "org-extra".into();
            sibling.alias_key = alias_key(&sibling.org_id, &row.kind, &row.scope, &row.alias);
            upsert(&conn, &sibling).await.unwrap();
            let mut rejected = row.clone();
            rejected.alias = "rejected".into();
            rejected.alias_key = alias_key("org", &rejected.kind, &rejected.scope, &rejected.alias);
            rejected.origin = "learned".into();
            rejected.status = "rejected".into();
            upsert(&conn, &rejected).await.unwrap();
            let mut proposal = rejected.clone();
            proposal.status = "active".into();
            proposal.canonical = "wrong".into();
            proposal.updated_at = 200;
            upsert_learned(&conn, &proposal).await.unwrap();
            assert_eq!(
                list(&conn, "org")
                    .await
                    .unwrap()
                    .into_iter()
                    .find(|r| r.alias == "rejected")
                    .unwrap()
                    .status,
                "rejected"
            );
            assert_eq!(purge_tombstones(&conn, "org", 39).await.unwrap(), 0);
            assert_eq!(purge_tombstones(&conn, "org", 40).await.unwrap(), 1);
            assert_eq!(delete_by_org(&conn, "org").await.unwrap(), 1);
            assert!(list(&conn, "org").await.unwrap().is_empty());
            assert_eq!(list(&conn, "org-extra").await.unwrap().len(), 1);
        }
    }

    fn manual(org: &str, alias: &str, status: &str, confidence: &str, at: i64) -> AliasRow {
        AliasRow {
            alias_key: alias_key(org, "k8s_workload", "ns", alias),
            org_id: org.into(),
            kind: "k8s_workload".into(),
            scope: "ns".into(),
            alias: alias.into(),
            canonical: format!("{alias}-svc"),
            status: status.into(),
            origin: "learned".into(),
            confidence: confidence.into(),
            created_by: "system".into(),
            created_at: at,
            updated_at: at,
            writer_cluster: "r1".into(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn list_page_filters_pages_and_excludes_tombstones() {
        for conn in sqlite_and_postgres_for_test("alias_list_page").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let org = "page";
            let mut accepted = manual(org, "Querier", "active", "high", 40);
            accepted.accepted_by = Some("admin@example.com".into());
            let rows = vec![
                manual(org, "alpha", "proposed", "high", 10),
                manual(org, "beta_x", "proposed", "low", 20),
                manual(org, "gamma", "active", "high", 30),
                accepted,
                manual(org, "gone", "proposed", "high", 50),
                manual("page2", "alpha", "proposed", "high", 60),
            ];
            for row in &rows {
                assert!(upsert(&conn, row).await.unwrap());
            }
            assert!(
                tombstone(&conn, org, &rows[4].alias_key, 70, "r1")
                    .await
                    .unwrap()
            );
            let keys = |page: &[AliasRow]| page.iter().map(|r| r.alias.clone()).collect::<Vec<_>>();
            let (all, total) = list_page(&conn, org, &AliasFilter::default(), 50, 0)
                .await
                .unwrap();
            assert_eq!(total, 4);
            assert_eq!(keys(&all), ["Querier", "gamma", "beta_x", "alpha"]);
            let (page, total) = list_page(&conn, org, &AliasFilter::default(), 2, 1)
                .await
                .unwrap();
            assert_eq!(
                (keys(&page), total),
                (vec!["gamma".to_string(), "beta_x".into()], 4)
            );
            let filter =
                |status: Option<&str>, confidence: Option<&str>, q: Option<&str>| AliasFilter {
                    kind: Some("k8s_workload".into()),
                    status: status.map(Into::into),
                    confidence: confidence.map(Into::into),
                    q: q.map(Into::into),
                };
            let (proposed_high, total) = list_page(
                &conn,
                org,
                &filter(Some("proposed"), Some("high"), None),
                50,
                0,
            )
            .await
            .unwrap();
            assert_eq!(
                (keys(&proposed_high), total),
                (vec!["alpha".to_string()], 1)
            );
            let (accepted, _) = list_page(&conn, org, &filter(Some("accepted"), None, None), 50, 0)
                .await
                .unwrap();
            assert_eq!(keys(&accepted), ["Querier"]);
            let (active, _) = list_page(&conn, org, &filter(Some("active"), None, None), 50, 0)
                .await
                .unwrap();
            assert_eq!(keys(&active), ["Querier", "gamma"]);
            let (by_q, _) = list_page(&conn, org, &filter(None, None, Some("QUERIER-S")), 50, 0)
                .await
                .unwrap();
            assert_eq!(keys(&by_q), ["Querier"]);
            let (literal, _) = list_page(&conn, org, &filter(None, None, Some("a_x")), 50, 0)
                .await
                .unwrap();
            assert_eq!(keys(&literal), ["beta_x"]);
            let (wildcard, _) = list_page(&conn, org, &filter(None, None, Some("%")), 50, 0)
                .await
                .unwrap();
            assert!(wildcard.is_empty());
            assert!(
                get(&conn, org, &rows[4].alias_key)
                    .await
                    .unwrap()
                    .unwrap()
                    .deleted_at
                    .is_some()
            );
            assert!(
                get(&conn, "page2", &rows[0].alias_key)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[tokio::test]
    async fn bulk_batch_and_undo_restore_prev_status_in_one_transaction() {
        for conn in sqlite_and_postgres_for_test("alias_bulk_undo").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let org = "bulk";
            let rows = [
                manual(org, "one", "proposed", "high", 10),
                manual(org, "two", "proposed", "high", 10),
            ];
            put_manual_batch(&conn, org, &rows).await.unwrap();
            let accepted: Vec<_> = rows
                .iter()
                .map(|row| bulk_transition(row, true, "admin@example.com", "batch-1", 100, "r1"))
                .collect();
            let changed = put_manual_batch(&conn, org, &accepted).await.unwrap();
            assert_eq!(changed.len(), 2);
            let stored = list_batch(&conn, org, "batch-1").await.unwrap();
            assert_eq!(stored.len(), 2);
            for row in &stored {
                assert_eq!(row.status, "active");
                assert_eq!(row.origin, "manual");
                assert_eq!(row.prev_status.as_deref(), Some("proposed"));
                assert_eq!(row.accepted_by.as_deref(), Some("admin@example.com"));
            }
            let (accepted_list, _) = list_page(
                &conn,
                org,
                &AliasFilter {
                    status: Some("accepted".into()),
                    ..Default::default()
                },
                50,
                0,
            )
            .await
            .unwrap();
            assert_eq!(accepted_list.len(), 2);
            let restored: Vec<_> = stored
                .iter()
                .map(|row| undo_transition(row, 200, "r1"))
                .collect();
            put_manual_batch(&conn, org, &restored).await.unwrap();
            assert!(list_batch(&conn, org, "batch-1").await.unwrap().is_empty());
            for row in list(&conn, org).await.unwrap() {
                assert_eq!(row.status, "proposed");
                assert_eq!(row.origin, "learned");
                assert!(row.accepted_by.is_none() && row.prev_status.is_none());
                assert_eq!(row.updated_at, 200);
            }
            let other = manual("bulk-other", "one", "proposed", "high", 10);
            assert!(
                put_manual_batch(&conn, org, &[other])
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[tokio::test]
    async fn the_conflicted_flag_keeps_intent_and_lists_the_row_as_proposed() {
        for conn in sqlite_and_postgres_for_test("aliases_allow").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let mut row = manual("org", "allowed", "active", "high", 10);
            row.accepted_by = Some("admin".into());
            row.allow_collisions = true;
            assert!(upsert(&conn, &row).await.unwrap());
            let mut learned = row.clone();
            learned.allow_collisions = false;
            learned.updated_at = 20;
            assert!(upsert_learned(&conn, &learned).await.unwrap());
            let saved = get(&conn, "org", &row.alias_key).await.unwrap().unwrap();
            assert_eq!(
                (saved.status.as_str(), saved.allow_collisions),
                ("active", true)
            );
            row.allow_collisions = false;
            row.updated_at = 30;
            assert!(upsert(&conn, &row).await.unwrap());
            let keys = [row.alias_key.clone()];
            assert_eq!(set_conflicted(&conn, "org", &keys, true).await.unwrap(), 1);
            let mut replayed = row.clone();
            replayed.updated_at = 31;
            assert!(upsert(&conn, &replayed).await.unwrap());
            let saved = get(&conn, "org", &row.alias_key).await.unwrap().unwrap();
            assert_eq!(
                (
                    saved.status.as_str(),
                    saved.accepted_by.as_deref(),
                    saved.updated_at,
                    saved.conflicted
                ),
                ("active", Some("admin"), 31, true)
            );
            let listed = |status: &str| AliasFilter {
                status: Some(status.into()),
                ..Default::default()
            };
            for (status, expected) in [("proposed", 1), ("active", 0), ("accepted", 0)] {
                let (_, total) = list_page(&conn, "org", &listed(status), 10, 0)
                    .await
                    .unwrap();
                assert_eq!(total, expected, "{status}");
            }
            set_conflicted(&conn, "org", &keys, false).await.unwrap();
            for (status, expected) in [("proposed", 0), ("active", 1), ("accepted", 1)] {
                let (_, total) = list_page(&conn, "org", &listed(status), 10, 0)
                    .await
                    .unwrap();
                assert_eq!(total, expected, "{status}");
            }
            let mut batched = row.clone();
            batched.allow_collisions = true;
            batched.prev_status = Some("active".into());
            assert!(undo_transition(&batched, 40, "r1").allow_collisions);
            batched.prev_status = Some("proposed".into());
            assert!(!undo_transition(&batched, 40, "r1").allow_collisions);
        }
    }
}
