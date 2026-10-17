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

use std::collections::HashSet;

use config::meta::cluster::Node;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder,
    QuerySelect, Set, UpdateMany, entity::prelude::*,
};

use super::entity::org_cleanup_tasks::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Each lease-aware compactor's uuid; a compactor without one may still run a task it claimed.
const LEASE_NODES_PREFIX: &str = "/org_cleanup/lease_nodes/";
// A waiting drain's `last_error`: when it last removed rows, so its stall bound counts from there.
const STALL_CLOCK_PREFIX: &str = "rows pending; no rows removed since ";
// A stalled attempt's `last_error`: it keeps the clock, so each later quiet pass spends an attempt.
const STALLED_PREFIX: &str = "drain stalled: ";

pub type CleanupTask = Model;

pub struct NewCleanupTask {
    pub org_id: String,
    pub org_name: String,
    pub step: String,
    pub step_order: i32,
}

/// One worker's hold on a task: its owner token and the `updated_at` its claim wrote.
#[derive(Debug, Clone)]
pub struct Claim {
    pub id: String,
    pub owner: String,
    claimed_at: i64,
}

/// Renews a claim's lease from its own tokio task, so a step that blocks still keeps it.
pub struct LeaseKeeper {
    handle: tokio::task::JoinHandle<()>,
}

impl LeaseKeeper {
    pub fn spawn(claim: &Claim) -> Self {
        let claim = claim.clone();
        Self {
            handle: tokio::spawn(async move { keep_lease(&claim).await }),
        }
    }

    /// Resolves only once the lease is lost; the worker must then drop the step.
    pub async fn lost(&mut self) {
        let _ = (&mut self.handle).await;
    }
}

impl Drop for LeaseKeeper {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

pub async fn add_batch(tasks: &[NewCleanupTask]) -> Result<(), errors::Error> {
    add_batch_in(get_orm_client_rw().await, tasks).await
}

/// `add_batch` on a caller's connection, so it can share a transaction with the status change.
pub async fn add_batch_in<C: ConnectionTrait>(
    conn: &C,
    tasks: &[NewCleanupTask],
) -> Result<(), errors::Error> {
    if tasks.is_empty() {
        return Ok(());
    }
    let now = config::utils::time::now_micros();
    let models: Vec<ActiveModel> = tasks
        .iter()
        .map(|t| ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(t.org_id.clone()),
            org_name: Set(t.org_name.clone()),
            step: Set(t.step.clone()),
            step_order: Set(t.step_order),
            status: Set("pending".to_string()),
            attempts: Set(0),
            last_error: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            running_by: Set(None),
            lease_until: Set(None),
        })
        .collect();
    // INSERT OR IGNORE: ignore conflicts on (org_id, step) unique index
    Entity::insert_many(models)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([Column::OrgId, Column::Step])
                .do_nothing()
                .to_owned(),
        )
        .do_nothing()
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(())
}

/// Claimable tasks with attempts left, including running ones whose worker lost its lease.
pub async fn list_pending(max_attempts: i32) -> Result<Vec<CleanupTask>, errors::Error> {
    list_pending_in(
        get_orm_client_ro().await,
        max_attempts,
        config::utils::time::now_micros(),
    )
    .await
}

/// Twice the worker poll interval; a paused worker (interval 0) still gets two seconds.
pub fn lease_micros() -> i64 {
    lease_micros_for(config::get_config().common.org_cleanup_poll_interval_secs)
}

/// The `last_error` a waiting drain records, carrying when it last removed rows.
pub fn stall_clock_message(since: i64) -> String {
    format!("{STALL_CLOCK_PREFIX}{since}")
}

/// The `last_error` of a stalled attempt, which carries the same clock as `stall_clock_message`.
pub fn stalled_message(since: i64) -> String {
    format!("{STALLED_PREFIX}{STALL_CLOCK_PREFIX}{since}")
}

/// The time a `stall_clock_message` or `stalled_message` carries; None for any other message.
pub fn stall_clock(last_error: Option<&str>) -> Option<i64> {
    let message = last_error?;
    let message = message.strip_prefix(STALLED_PREFIX).unwrap_or(message);
    message.strip_prefix(STALL_CLOCK_PREFIX)?.parse().ok()
}

/// Claims the task under a fresh owner. None when a live lease holds it or it is done.
pub async fn mark_running(id: &str) -> Result<Option<Claim>, errors::Error> {
    mark_running_in(
        get_orm_client_rw().await,
        id,
        &new_lease_owner(),
        config::utils::time::now_micros(),
        lease_micros(),
    )
    .await
}

/// False when the claim was lost, so the outcome was not recorded.
pub async fn mark_done(claim: &Claim) -> Result<bool, errors::Error> {
    mark_done_in(
        get_orm_client_rw().await,
        claim,
        config::utils::time::now_micros(),
    )
    .await
}

/// False when the claim was lost, so the outcome was not recorded.
pub async fn mark_failed(claim: &Claim, error: &str) -> Result<bool, errors::Error> {
    mark_failed_in(
        get_orm_client_rw().await,
        claim,
        error,
        config::utils::time::now_micros(),
    )
    .await
}

/// Puts a running task back to pending and undoes the `mark_running` increment of `attempts`.
pub async fn mark_retry(claim: &Claim, message: &str) -> Result<bool, errors::Error> {
    mark_retry_in(
        get_orm_client_rw().await,
        claim,
        message,
        config::utils::time::now_micros(),
    )
    .await
}

/// Puts a running task back to pending with a full attempt budget, as a drain that removed rows.
pub async fn mark_progress(claim: &Claim, message: &str) -> Result<bool, errors::Error> {
    mark_progress_in(
        get_orm_client_rw().await,
        claim,
        message,
        config::utils::time::now_micros(),
    )
    .await
}

/// Requeues expired leases, and pre-lease claims once no pre-lease compactor is left.
pub async fn requeue_running() -> Result<u64, errors::Error> {
    let legacy_holders_gone = legacy_holders_gone().await;
    requeue_running_in(
        get_orm_client_rw().await,
        config::utils::time::now_micros(),
        legacy_holders_gone,
    )
    .await
}

pub async fn list_by_org_status(
    org_id: &str,
    status: Option<&str>,
) -> Result<Vec<CleanupTask>, errors::Error> {
    let client = get_orm_client_ro().await;
    let mut q = Entity::find().filter(Column::OrgId.eq(org_id));
    if let Some(s) = status {
        q = q.filter(Column::Status.eq(s));
    }
    q.order_by(Column::StepOrder, Order::Asc)
        .all(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Unfinished tasks that `list_pending` no longer returns because they used up their attempts.
pub async fn list_exhausted(max_attempts: i32) -> Result<Vec<CleanupTask>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .filter(Column::Status.is_in(["pending", "failed"]))
        .filter(Column::Attempts.gte(max_attempts))
        .order_by(Column::StepOrder, Order::Asc)
        .all(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Gives every unfinished, idle task of the org a fresh attempt budget and a fresh stall clock.
pub async fn reset_exhausted(org_id: &str) -> Result<u64, errors::Error> {
    reset_exhausted_in(
        get_orm_client_rw().await,
        org_id,
        config::utils::time::now_micros(),
    )
    .await
}

pub async fn list_orgs_with_tasks() -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .select_only()
        .column(Column::OrgId)
        .distinct()
        .into_tuple::<String>()
        .all(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Whether the task row still exists; an outcome that matched no row may have outlived it.
pub async fn exists(id: &str) -> Result<bool, errors::Error> {
    exists_in(get_orm_client_ro().await, id).await
}

/// Delete all cleanup-task rows for an org. Called immediately when a deletion
/// completes (org gone) or when an org is resurrected — the ledger for a
/// nonexistent/restored org has no value.
pub async fn delete_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected)
}

/// Capped at half of `i64::MAX`, so `now + lease` never overflows a BIGINT.
fn lease_micros_for(poll_interval_secs: u64) -> i64 {
    i64::try_from(poll_interval_secs.max(1))
        .unwrap_or(i64::MAX)
        .min(i64::MAX / 4_000_000)
        * 2_000_000
}

/// A token unique to one claim, so two workers on one node never share a lease.
fn new_lease_owner() -> String {
    format!(
        "{}/{}",
        config::cluster::LOCAL_NODE.uuid,
        config::ider::generate()
    )
}

/// Renews until the lease is lost, or until renewals failed for so long that it may have expired.
async fn keep_lease(claim: &Claim) {
    let (id, owner) = (&claim.id, &claim.owner);
    let lease = lease_micros();
    let every = (lease / 4).max(1);
    let mut expires = claim.claimed_at + lease;
    loop {
        tokio::time::sleep(std::time::Duration::from_micros(every.unsigned_abs())).await;
        let now = config::utils::time::now_micros();
        match renew_lease_in(get_orm_client_rw().await, claim, now, lease).await {
            Ok(true) => expires = now + lease,
            Ok(false) => {
                log::warn!("[org_cleanup] task {id}: {owner} lost its lease");
                disown(claim).await;
                return;
            }
            // Give up one renewal early: another worker may claim the task the moment it expires.
            Err(e) if now + every >= expires => {
                log::error!("[org_cleanup] task {id}: lease renewal failed until expiry: {e}");
                return;
            }
            Err(e) => log::error!("[org_cleanup] task {id}: lease renewal failed: {e}"),
        }
    }
}

/// True once every known compactor is lease-aware, so no node can still run a pre-lease claim.
async fn legacy_holders_gone() -> bool {
    if config::get_config().common.local_mode {
        return true;
    }
    let db = crate::db::get_db().await;
    let key = format!("{LEASE_NODES_PREFIX}{}", config::cluster::LOCAL_NODE.uuid);
    let now = config::utils::time::now_micros().to_string();
    if let Err(e) = db.put(&key, now.into(), false, None).await {
        log::error!("[org_cleanup] cannot record lease support of this node: {e}");
        return false;
    }
    let marked: HashSet<String> = match db.list_keys(LEASE_NODES_PREFIX).await {
        Ok(keys) => keys
            .iter()
            .filter_map(|k| k.rsplit('/').next())
            .map(String::from)
            .collect(),
        Err(e) => {
            log::error!("[org_cleanup] cannot list lease-aware nodes: {e}");
            return false;
        }
    };
    let Some(nodes) = crate::cluster::get_cached_nodes(|_| true).await else {
        return false;
    };
    // A live node whose marker is pruned here writes it again on its next pass.
    for uuid in marked
        .iter()
        .filter(|u| !nodes.iter().any(|n| &n.uuid == *u))
    {
        let _ = db
            .delete_if_exists(&format!("{LEASE_NODES_PREFIX}{uuid}"), false, false)
            .await;
    }
    all_compactors_lease_aware(&nodes, &marked)
}

async fn disown(claim: &Claim) {
    if let Err(e) = disown_in(get_orm_client_rw().await, claim).await {
        log::error!(
            "[org_cleanup] task {}: cannot clear a lost lease: {e}",
            claim.id
        );
    }
}

fn all_compactors_lease_aware(nodes: &[Node], marked: &HashSet<String>) -> bool {
    nodes
        .iter()
        .filter(|n| n.is_compactor())
        .all(|n| marked.contains(&n.uuid))
}

/// Not held by a live worker: pending, failed, or running past a lease its own claim wrote.
fn idle(now: i64) -> Condition {
    Condition::any()
        .add(Column::Status.is_in(["pending", "failed"]))
        .add(expired_lease(now))
}

/// Our claims prefix `running_by` with their `updated_at`, which an old node's re-claim moves.
fn expired_lease(now: i64) -> Condition {
    Condition::all()
        .add(Column::Status.eq("running"))
        .add(Column::LeaseUntil.lt(now))
        .add(Expr::cust(
            "running_by LIKE (CAST(updated_at AS TEXT) || '/%')",
        ))
}

/// A pre-lease node writes `updated_at` on every claim and requeue, so a changed value means lost.
fn held_by(claim: &Claim) -> Condition {
    Condition::all()
        .add(Column::Id.eq(claim.id.as_str()))
        .add(Column::Status.eq("running"))
        .add(Column::RunningBy.eq(claim.owner.as_str()))
        .add(Column::UpdatedAt.eq(claim.claimed_at))
}

async fn list_pending_in<C: ConnectionTrait>(
    conn: &C,
    max_attempts: i32,
    now: i64,
) -> Result<Vec<CleanupTask>, errors::Error> {
    Entity::find()
        .filter(idle(now))
        .filter(Column::Attempts.lt(max_attempts))
        .order_by(Column::StepOrder, Order::Asc)
        .all(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))
}

async fn mark_running_in<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    owner: &str,
    now: i64,
    lease: i64,
) -> Result<Option<Claim>, errors::Error> {
    let owner = format!("{now}/{owner}");
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value("running"))
        .col_expr(Column::Attempts, Expr::col(Column::Attempts).add(1))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .col_expr(Column::RunningBy, Expr::value(owner.as_str()))
        .col_expr(Column::LeaseUntil, Expr::value(now + lease))
        .filter(Column::Id.eq(id))
        .filter(idle(now))
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok((result.rows_affected > 0).then(|| Claim {
        id: id.to_string(),
        owner,
        claimed_at: now,
    }))
}

async fn renew_lease_in<C: ConnectionTrait>(
    conn: &C,
    claim: &Claim,
    now: i64,
    lease: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::LeaseUntil, Expr::value(now + lease))
        .filter(held_by(claim))
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected > 0)
}

async fn mark_done_in<C: ConnectionTrait>(
    conn: &C,
    claim: &Claim,
    now: i64,
) -> Result<bool, errors::Error> {
    release_in(conn, claim, now, "done", |update| {
        update.col_expr(Column::LastError, Expr::value(Option::<String>::None))
    })
    .await
}

async fn mark_failed_in<C: ConnectionTrait>(
    conn: &C,
    claim: &Claim,
    error: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    release_in(conn, claim, now, "failed", |update| {
        update.col_expr(Column::LastError, Expr::value(error))
    })
    .await
}

async fn mark_retry_in<C: ConnectionTrait>(
    conn: &C,
    claim: &Claim,
    message: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    release_in(conn, claim, now, "pending", |update| {
        update
            .col_expr(Column::Attempts, Expr::col(Column::Attempts).sub(1))
            .col_expr(Column::LastError, Expr::value(message))
    })
    .await
}

async fn mark_progress_in<C: ConnectionTrait>(
    conn: &C,
    claim: &Claim,
    message: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    release_in(conn, claim, now, "pending", |update| {
        update
            .col_expr(Column::Attempts, Expr::value(0))
            .col_expr(Column::LastError, Expr::value(message))
    })
    .await
}

async fn reset_exhausted_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    now: i64,
) -> Result<u64, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value("pending"))
        .col_expr(Column::Attempts, Expr::value(0))
        .col_expr(
            Column::LastError,
            Expr::cust(format!(
                "CASE WHEN last_error LIKE '{STALL_CLOCK_PREFIX}%' \
                 OR last_error LIKE '{STALLED_PREFIX}{STALL_CLOCK_PREFIX}%' \
                 THEN NULL ELSE last_error END"
            )),
        )
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .col_expr(Column::RunningBy, Expr::value(Option::<String>::None))
        .col_expr(Column::LeaseUntil, Expr::value(Option::<i64>::None))
        .filter(Column::OrgId.eq(org_id))
        .filter(idle(now))
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected)
}

async fn exists_in<C: ConnectionTrait>(conn: &C, id: &str) -> Result<bool, errors::Error> {
    Entity::find_by_id(id)
        .one(conn)
        .await
        .map(|row| row.is_some())
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Moves a task the claim still holds to `status` and drops the lease.
async fn release_in<C: ConnectionTrait>(
    conn: &C,
    claim: &Claim,
    now: i64,
    status: &str,
    extra: impl FnOnce(UpdateMany<Entity>) -> UpdateMany<Entity>,
) -> Result<bool, errors::Error> {
    let update = Entity::update_many()
        .col_expr(Column::Status, Expr::value(status))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .col_expr(Column::RunningBy, Expr::value(Option::<String>::None))
        .col_expr(Column::LeaseUntil, Expr::value(Option::<i64>::None))
        .filter(held_by(claim));
    let result = extra(update)
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    if result.rows_affected == 0 {
        disown_in(conn, claim).await?;
    }
    Ok(result.rows_affected > 0)
}

/// Clears our lease from a row an old node requeued or re-claimed, so it reads as pre-lease.
async fn disown_in<C: ConnectionTrait>(conn: &C, claim: &Claim) -> Result<u64, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::RunningBy, Expr::value(Option::<String>::None))
        .col_expr(Column::LeaseUntil, Expr::value(Option::<i64>::None))
        .filter(Column::Id.eq(claim.id.as_str()))
        .filter(Column::RunningBy.eq(claim.owner.as_str()))
        .filter(Column::UpdatedAt.ne(claim.claimed_at))
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected)
}

/// Pre-lease holds (NULL or an inherited lease) are freed only once no pre-lease compactor is left.
async fn requeue_running_in<C: ConnectionTrait>(
    conn: &C,
    now: i64,
    legacy_holders_gone: bool,
) -> Result<u64, errors::Error> {
    let mut freed = Condition::any().add(expired_lease(now));
    if legacy_holders_gone {
        freed = freed
            .add(Column::LeaseUntil.is_null())
            .add(Column::LeaseUntil.lt(now));
    }
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value("pending"))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .col_expr(Column::RunningBy, Expr::value(Option::<String>::None))
        .col_expr(Column::LeaseUntil, Expr::value(Option::<i64>::None))
        .filter(Column::Status.eq("running"))
        .filter(freed)
        .exec(conn)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    const LEASE: i64 = 2_000_000;
    const T0: i64 = 1_000_000_000;

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();
        db
    }

    async fn seed(db: &DatabaseConnection, id: &str, status: &str, lease_until: Option<i64>) {
        ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("org".to_string()),
            org_name: Set("org".to_string()),
            step: Set(id.to_string()),
            step_order: Set(100),
            status: Set(status.to_string()),
            attempts: Set(0),
            last_error: Set(None),
            created_at: Set(T0),
            updated_at: Set(lease_until.map_or(T0, |until| until - LEASE)),
            running_by: Set(lease_until.map(|until| format!("{}/w0", until - LEASE))),
            lease_until: Set(lease_until),
        }
        .insert(db)
        .await
        .unwrap();
    }

    async fn row(db: &DatabaseConnection, id: &str) -> CleanupTask {
        Entity::find_by_id(id).one(db).await.unwrap().unwrap()
    }

    #[test]
    fn test_cleanup_task_default_status() {
        // CleanupTask has a status field defaulting to "pending" when constructed from
        // NewCleanupTask We can only test the NewCleanupTask struct here since CleanupTask
        // comes from DB
        let t = NewCleanupTask {
            org_id: "org1".to_string(),
            org_name: "Org One".to_string(),
            step: "delete_streams".to_string(),
            step_order: 100,
        };
        assert_eq!(t.step, "delete_streams");
        assert_eq!(t.step_order, 100);
    }

    #[test]
    fn test_new_cleanup_task_step_order_zero_allowed() {
        let t = NewCleanupTask {
            org_id: "org".to_string(),
            org_name: "Org".to_string(),
            step: "custom".to_string(),
            step_order: 0,
        };
        assert_eq!(t.step_order, 0);
    }

    #[test]
    fn test_delete_by_org_builds_scoped_delete() {
        use sea_orm::{QueryTrait, sea_query::PostgresQueryBuilder};
        let stmt = Entity::delete_many()
            .filter(Column::OrgId.eq("myorg"))
            .into_query()
            .to_string(PostgresQueryBuilder);
        assert!(stmt.contains("org_cleanup_tasks"));
        assert!(stmt.contains("org_id"));
        assert!(stmt.contains("myorg"));
    }

    async fn claim(db: &DatabaseConnection, id: &str, owner: &str, now: i64) -> Option<Claim> {
        mark_running_in(db, id, owner, now, LEASE).await.unwrap()
    }

    /// What a node that predates leases runs: `requeue_running` at startup, then `mark_running`.
    async fn pre_lease_requeue_and_claim(db: &DatabaseConnection, id: &str, now: i64) {
        db.execute_unprepared(&format!(
            "UPDATE org_cleanup_tasks SET status = 'pending', updated_at = {now} \
             WHERE status = 'running'"
        ))
        .await
        .unwrap();
        db.execute_unprepared(&format!(
            "UPDATE org_cleanup_tasks SET status = 'running', attempts = attempts + 1, \
             updated_at = {} WHERE id = '{id}' AND status != 'running'",
            now + 1
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_mark_running_rejects_done_rows() {
        let db = db().await;
        seed(&db, "t1", "pending", None).await;
        let a = claim(&db, "t1", "a", T0).await.unwrap();
        assert!(mark_done_in(&db, &a, T0 + 1).await.unwrap());
        for at in [T0 + 2, T0 + 10 * LEASE] {
            assert!(
                claim(&db, "t1", "b", at).await.is_none(),
                "a done step was claimed again at {at}"
            );
        }
        let done = row(&db, "t1").await;
        assert_eq!(done.status, "done");
        assert_eq!(done.attempts, 1);
    }

    #[tokio::test]
    async fn test_requeue_only_expired_leases() {
        let db = db().await;
        seed(&db, "live", "running", Some(T0 + LEASE)).await;
        seed(&db, "expired", "running", Some(T0 - 1)).await;
        seed(&db, "pre_lease", "running", None).await;
        seed(&db, "pending", "pending", None).await;
        seed(&db, "done", "done", None).await;

        assert_eq!(requeue_running_in(&db, T0, false).await.unwrap(), 1);
        let live = row(&db, "live").await;
        assert_eq!(live.status, "running");
        assert_eq!(live.running_by, Some(format!("{}/w0", T0)));
        let expired = row(&db, "expired").await;
        assert_eq!(expired.status, "pending");
        assert_eq!(expired.running_by, None);
        assert_eq!(expired.lease_until, None);
        assert_eq!(row(&db, "pre_lease").await.status, "running");
        assert_eq!(row(&db, "done").await.status, "done");
    }

    #[tokio::test]
    async fn test_pre_lease_claim_waits_for_its_node_then_requeues() {
        let db = db().await;
        seed(&db, "pre_lease", "running", None).await;

        for at in [T0, T0 + 100 * LEASE] {
            assert!(claim(&db, "pre_lease", "b", at).await.is_none());
            assert!(list_pending_in(&db, 10, at).await.unwrap().is_empty());
            assert_eq!(requeue_running_in(&db, at, false).await.unwrap(), 0);
        }
        assert_eq!(requeue_running_in(&db, T0, true).await.unwrap(), 1);
        assert_eq!(row(&db, "pre_lease").await.status, "pending");
        assert!(claim(&db, "pre_lease", "b", T0 + 1).await.is_some());
    }

    #[test]
    fn test_pre_lease_holders_gone_only_when_every_compactor_is_marked() {
        use config::meta::cluster::Role;

        let node = |uuid: &str, role: Role| Node {
            uuid: uuid.to_string(),
            role: vec![role],
            ..config::cluster::LOCAL_NODE.clone()
        };
        let marked = HashSet::from(["new".to_string()]);
        assert!(all_compactors_lease_aware(
            &[node("new", Role::Compactor), node("old", Role::Ingester)],
            &marked
        ));
        assert!(!all_compactors_lease_aware(
            &[node("new", Role::Compactor), node("old", Role::Compactor)],
            &marked
        ));
        assert!(!all_compactors_lease_aware(
            &[node("new", Role::Compactor), node("old", Role::All)],
            &marked
        ));
    }

    #[tokio::test]
    async fn test_pre_lease_reclaim_revokes_the_new_claim() {
        let db = db().await;
        seed(&db, "t1", "pending", None).await;
        let a = claim(&db, "t1", "a", T0).await.unwrap();

        pre_lease_requeue_and_claim(&db, "t1", T0 + 10).await;
        assert!(!renew_lease_in(&db, &a, T0 + 20, LEASE).await.unwrap());
        assert!(!mark_done_in(&db, &a, T0 + 21).await.unwrap());
        let taken = row(&db, "t1").await;
        assert_eq!(taken.status, "running");
        assert_eq!(taken.running_by, None);
        assert_eq!(
            taken.lease_until, None,
            "a stale lease would expire under the old node"
        );
        assert!(claim(&db, "t1", "b", T0 + 10 * LEASE).await.is_none());
    }

    #[tokio::test]
    async fn test_old_node_reclaim_after_its_owner_died_never_expires_into_a_second_run() {
        let db = db().await;
        seed(&db, "t1", "pending", None).await;
        claim(&db, "t1", "a", T0).await.unwrap();

        pre_lease_requeue_and_claim(&db, "t1", T0 + 10).await;
        let after_stale_lease = T0 + 10 * LEASE;
        assert!(claim(&db, "t1", "b", after_stale_lease).await.is_none());
        assert!(
            list_pending_in(&db, 10, after_stale_lease)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            requeue_running_in(&db, after_stale_lease, false)
                .await
                .unwrap(),
            0
        );
        assert_eq!(row(&db, "t1").await.status, "running");

        assert_eq!(
            requeue_running_in(&db, after_stale_lease, true)
                .await
                .unwrap(),
            1
        );
        assert!(claim(&db, "t1", "b", after_stale_lease + 1).await.is_some());
    }

    #[tokio::test]
    async fn test_old_node_reclaim_never_expires_under_a_shorter_lease_or_a_slow_clock() {
        let cases = [
            (
                "checker lease shorter than the claimer's",
                10 * LEASE,
                T0 + 10,
            ),
            ("old node's clock behind the claimer's", LEASE, T0 - 100),
        ];
        for (case, claimer_lease, reclaim_at) in cases {
            let db = db().await;
            seed(&db, "t1", "pending", None).await;
            mark_running_in(&db, "t1", "a", T0, claimer_lease)
                .await
                .unwrap()
                .unwrap();
            pre_lease_requeue_and_claim(&db, "t1", reclaim_at).await;

            let after_stale_lease = T0 + claimer_lease + 1;
            assert!(
                claim(&db, "t1", "b", after_stale_lease).await.is_none(),
                "{case}: a second worker claimed the old node's step"
            );
            assert!(
                list_pending_in(&db, 10, after_stale_lease)
                    .await
                    .unwrap()
                    .is_empty(),
                "{case}"
            );
            assert_eq!(
                requeue_running_in(&db, after_stale_lease, false)
                    .await
                    .unwrap(),
                0,
                "{case}"
            );
        }
    }

    #[tokio::test]
    async fn test_live_lease_blocks_a_second_claim_until_it_expires() {
        let db = db().await;
        seed(&db, "t1", "pending", None).await;
        let a = claim(&db, "t1", "a", T0).await.unwrap();
        assert!(claim(&db, "t1", "b", T0 + LEASE - 1).await.is_none());

        let b = claim(&db, "t1", "b", T0 + LEASE + 1).await.unwrap();
        assert_eq!(b.owner, format!("{}/b", T0 + LEASE + 1));
        let taken = row(&db, "t1").await;
        assert_eq!(taken.running_by.as_deref(), Some(b.owner.as_str()));
        assert_eq!(taken.lease_until, Some(T0 + 2 * LEASE + 1));
        assert_eq!(taken.attempts, 2);
        assert!(!mark_done_in(&db, &a, T0 + LEASE + 2).await.unwrap());
        assert!(mark_done_in(&db, &b, T0 + LEASE + 2).await.unwrap());
    }

    #[tokio::test]
    async fn test_only_the_claim_holder_renews_or_records_the_outcome() {
        let db = db().await;
        seed(&db, "t1", "pending", None).await;
        let a = claim(&db, "t1", "a", T0).await.unwrap();
        let forged = Claim {
            owner: "b".to_string(),
            ..a.clone()
        };

        assert!(!renew_lease_in(&db, &forged, T0 + 1, LEASE).await.unwrap());
        assert!(!mark_done_in(&db, &forged, T0 + 1).await.unwrap());
        assert!(!mark_failed_in(&db, &forged, "x", T0 + 1).await.unwrap());
        assert!(!mark_retry_in(&db, &forged, "x", T0 + 1).await.unwrap());
        assert_eq!(
            row(&db, "t1").await.running_by.as_deref(),
            Some(a.owner.as_str())
        );

        assert!(renew_lease_in(&db, &a, T0 + LEASE, LEASE).await.unwrap());
        assert!(claim(&db, "t1", "b", T0 + LEASE + 1).await.is_none());
        assert!(
            mark_retry_in(&db, &a, "3 rows pending", T0 + LEASE + 2)
                .await
                .unwrap()
        );
        let retried = row(&db, "t1").await;
        assert_eq!(retried.status, "pending");
        assert_eq!(retried.attempts, 0);
        assert_eq!(retried.running_by, None);
        assert_eq!(retried.lease_until, None);
        assert!(
            !mark_failed_in(&db, &a, "late", T0 + LEASE + 3)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_done_clears_the_error_of_an_earlier_attempt() {
        let db = db().await;
        seed(&db, "t1", "pending", None).await;
        let first = claim(&db, "t1", "a", T0).await.unwrap();
        assert!(mark_failed_in(&db, &first, "boom", T0 + 1).await.unwrap());
        let second = claim(&db, "t1", "b", T0 + 2).await.unwrap();
        assert!(mark_done_in(&db, &second, T0 + 3).await.unwrap());
        let done = row(&db, "t1").await;
        assert_eq!(done.status, "done");
        assert_eq!(done.last_error, None);
    }

    #[tokio::test]
    async fn test_retry_restarts_a_drain_stall_clock_and_keeps_other_errors() {
        let db = db().await;
        seed(&db, "drain", "pending", None).await;
        seed(&db, "boom", "pending", None).await;
        let waiting = claim(&db, "drain", "a", T0).await.unwrap();
        assert!(
            mark_retry_in(&db, &waiting, &stall_clock_message(T0 - 7), T0 + 1)
                .await
                .unwrap()
        );
        let failing = claim(&db, "boom", "a", T0).await.unwrap();
        assert!(mark_failed_in(&db, &failing, "boom", T0 + 1).await.unwrap());
        assert_eq!(
            stall_clock(row(&db, "drain").await.last_error.as_deref()),
            Some(T0 - 7)
        );

        assert_eq!(reset_exhausted_in(&db, "org", T0 + 2).await.unwrap(), 2);
        assert_eq!(row(&db, "drain").await.last_error, None);
        assert_eq!(row(&db, "boom").await.last_error.as_deref(), Some("boom"));
        assert_eq!(stall_clock(Some("3 rows pending")), None);
        assert_eq!(stall_clock(None), None);
    }

    #[tokio::test]
    async fn test_a_stalled_attempt_keeps_its_clock_until_a_retry() {
        let db = db().await;
        seed(&db, "stalled", "pending", None).await;
        let stalled = claim(&db, "stalled", "a", T0).await.unwrap();
        assert!(
            mark_failed_in(&db, &stalled, &stalled_message(T0 - 9), T0 + 1)
                .await
                .unwrap()
        );
        let kept = row(&db, "stalled").await;

        assert_eq!(reset_exhausted_in(&db, "org", T0 + 2).await.unwrap(), 1);
        let retried = row(&db, "stalled").await;
        assert_eq!(
            stall_clock(kept.last_error.as_deref()),
            Some(T0 - 9),
            "a stalled attempt restarted the clock: {kept:?}"
        );
        assert!(
            kept.last_error
                .as_deref()
                .is_some_and(|e| e.starts_with("drain stalled")),
            "{kept:?}"
        );
        assert_eq!(retried.last_error, None, "a retry kept the stall clock");
    }

    #[tokio::test]
    async fn test_progress_restores_the_attempts_that_stalls_spent() {
        let db = db().await;
        seed(&db, "drain", "pending", None).await;
        for at in 0..3 {
            let stalled = claim(&db, "drain", "a", T0 + 2 * at).await.unwrap();
            assert!(
                mark_failed_in(&db, &stalled, &stalled_message(T0 - 9), T0 + 2 * at + 1)
                    .await
                    .unwrap()
            );
        }
        let spent = row(&db, "drain").await.attempts;
        let busy = claim(&db, "drain", "a", T0 + 10).await.unwrap();
        assert!(
            mark_progress_in(&db, &busy, &stall_clock_message(T0 + 10), T0 + 11)
                .await
                .unwrap()
        );
        let lost = Claim {
            owner: "b".to_string(),
            ..busy
        };

        let after = row(&db, "drain").await;
        assert_eq!(spent, 3);
        assert_eq!((after.status.as_str(), after.attempts), ("pending", 0));
        assert_eq!(stall_clock(after.last_error.as_deref()), Some(T0 + 10));
        assert!(!mark_progress_in(&db, &lost, "late", T0 + 12).await.unwrap());
    }

    #[tokio::test]
    async fn test_exists_tells_a_deleted_row_from_a_lost_claim() {
        let db = db().await;
        seed(&db, "lost", "pending", None).await;
        seed(&db, "gone", "pending", None).await;
        let lost = claim(&db, "lost", "a", T0).await.unwrap();
        let forged = Claim {
            owner: "b".to_string(),
            ..lost.clone()
        };
        let gone = claim(&db, "gone", "a", T0).await.unwrap();
        db.execute_unprepared("DELETE FROM org_cleanup_tasks WHERE id = 'gone'")
            .await
            .unwrap();

        assert!(!mark_done_in(&db, &forged, T0 + 1).await.unwrap());
        assert!(exists_in(&db, &forged.id).await.unwrap());
        assert!(!mark_done_in(&db, &gone, T0 + 1).await.unwrap());
        assert!(!exists_in(&db, &gone.id).await.unwrap());
    }

    #[tokio::test]
    async fn test_list_pending_includes_running_rows_past_their_lease() {
        let db = db().await;
        seed(&db, "pending", "pending", None).await;
        seed(&db, "failed", "failed", None).await;
        seed(&db, "live", "running", Some(T0 + 1)).await;
        seed(&db, "expired", "running", Some(T0 - 1)).await;
        seed(&db, "pre_lease", "running", None).await;
        seed(&db, "done", "done", None).await;

        let mut ids: Vec<String> = list_pending_in(&db, 10, T0)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        ids.sort();
        assert_eq!(ids, ["expired", "failed", "pending"]);
        assert!(list_pending_in(&db, 0, T0).await.unwrap().is_empty());
    }

    #[test]
    fn test_lease_fits_in_i64_for_any_poll_interval() {
        assert_eq!(lease_micros_for(0), 2_000_000);
        assert_eq!(lease_micros_for(3600), 7_200_000_000);
        let now = config::utils::time::now_micros();
        let first_saturating = u64::try_from(i64::MAX / 2_000_000).unwrap() + 1;
        for secs in [first_saturating, u64::try_from(i64::MAX).unwrap(), u64::MAX] {
            let lease = lease_micros_for(secs);
            assert!(
                now.checked_add(lease).is_some(),
                "interval {secs}s gives lease {lease}"
            );
        }
    }

    #[test]
    fn test_lease_owner_is_unique_per_claim() {
        assert_ne!(new_lease_owner(), new_lease_owner());
    }
}
