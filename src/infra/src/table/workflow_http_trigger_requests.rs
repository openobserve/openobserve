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

//! Region-local run ledger of HTTP triggers; each queued row owns one `workflow_run_data` payload.

use std::collections::{HashMap, HashSet};

use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, DbErr, EntityTrait, NotSet, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, SqlErr, TransactionTrait,
    sea_query::{Expr, Query},
};

use crate::table::entity::{
    organizations, workflow_http_trigger_requests as requests, workflow_run_data,
};

pub const ERR_RUN_TIMEOUT: &str = "run_timeout";
pub const ERR_WORKER_LOST: &str = "worker_lost";
pub const ERR_WORKFLOW_DISABLED: &str = "workflow_disabled";
pub const IDEM_KEY_TTL_US: i64 = 24 * 3600 * 1_000_000;
const DELETE_BATCH: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookRunStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Expired,
}

impl HookRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Expired)
    }
}

#[derive(Clone, Debug)]
pub struct NewHookRequest {
    pub trigger_id: String,
    pub org_id: String,
    pub workflow_id: String,
    pub run_id: String,
    pub idem_key: Option<String>,
    pub body_sha256: String,
    pub body_bytes: i64,
    pub content_type: Option<String>,
    pub meta: String,
    pub credential_id: String,
    pub credential_prefix: String,
    pub caller_ip: String,
    pub received_at: i64,
}

impl NewHookRequest {
    fn queued_row(self) -> requests::ActiveModel {
        requests::ActiveModel {
            id: NotSet,
            trigger_id: Set(self.trigger_id),
            org_id: Set(self.org_id),
            workflow_id: Set(self.workflow_id),
            run_id: Set(self.run_id),
            idem_key: Set(self.idem_key),
            body_sha256: Set(self.body_sha256),
            body_bytes: Set(self.body_bytes),
            content_type: Set(self.content_type),
            meta: Set(self.meta),
            status: Set(HookRunStatus::Queued.as_str().to_string()),
            claimed_by: Set(None),
            claimed_at: Set(None),
            error: Set(None),
            credential_id: Set(self.credential_id),
            credential_prefix: Set(self.credential_prefix),
            caller_ip: Set(self.caller_ip),
            received_at: Set(self.received_at),
            finished_at: Set(None),
        }
    }
}

#[derive(Debug)]
pub enum LedgerInsert {
    Inserted,
    KeyTaken(Box<requests::Model>),
    QueueFull,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RunningCounts {
    pub total: u64,
    pub by_org: HashMap<String, u64>,
}

/// The reaping node and the ledger ids its own tasks still run.
#[derive(Clone, Copy, Debug)]
pub struct LocalClaims<'a> {
    pub node_uuid: &'a str,
    pub in_flight: &'a HashSet<i64>,
    pub stale_before_us: i64,
}

/// Writes payload and queued row in one transaction; a lost idempotency race returns the winner.
pub async fn enqueue<C: TransactionTrait>(
    db: &C,
    request: NewHookRequest,
    payload: String,
) -> Result<LedgerInsert, DbErr> {
    write_queued(db, None, request, payload, None).await
}

/// Frees an expired original's key and enqueues its replacement in the same transaction.
pub async fn reissue_expired<C: TransactionTrait>(
    db: &C,
    expired_id: i64,
    request: NewHookRequest,
    payload: String,
) -> Result<LedgerInsert, DbErr> {
    write_queued(db, Some(expired_id), request, payload, None).await
}

/// Enqueues (or reissues `expired_id`); refused once the org has `queue_max` queued rows.
pub async fn enqueue_capped<C: TransactionTrait>(
    db: &C,
    expired_id: Option<i64>,
    request: NewHookRequest,
    payload: String,
    queue_max: u64,
) -> Result<LedgerInsert, DbErr> {
    write_queued(db, expired_id, request, payload, Some(queue_max)).await
}

pub async fn find_by_idem_key<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
    idem_key: &str,
) -> Result<Option<requests::Model>, DbErr> {
    requests::Entity::find()
        .filter(requests::Column::TriggerId.eq(trigger_id))
        .filter(requests::Column::IdemKey.eq(idem_key))
        .one(db)
        .await
}

pub async fn get_run<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
    run_id: &str,
) -> Result<Option<requests::Model>, DbErr> {
    requests::Entity::find()
        .filter(requests::Column::TriggerId.eq(trigger_id))
        .filter(requests::Column::RunId.eq(run_id))
        .one(db)
        .await
}

pub async fn count_queued_for_org<C: ConnectionTrait>(db: &C, org_id: &str) -> Result<u64, DbErr> {
    requests::Entity::find()
        .filter(requests::Column::Status.eq(HookRunStatus::Queued.as_str()))
        .filter(requests::Column::OrgId.eq(org_id))
        .count(db)
        .await
}

pub async fn running_counts<C: ConnectionTrait>(db: &C) -> Result<RunningCounts, DbErr> {
    let rows: Vec<(String, i64)> = requests::Entity::find()
        .select_only()
        .column(requests::Column::OrgId)
        .column_as(requests::Column::Id.count(), "running")
        .filter(requests::Column::Status.eq(HookRunStatus::Running.as_str()))
        .group_by(requests::Column::OrgId)
        .into_tuple()
        .all(db)
        .await?;
    let mut counts = RunningCounts::default();
    for (org_id, running) in rows {
        let running = u64::try_from(running).unwrap_or_default();
        counts.total += running;
        counts.by_org.insert(org_id, running);
    }
    Ok(counts)
}

pub async fn orgs_with_queued<C: ConnectionTrait>(db: &C) -> Result<Vec<String>, DbErr> {
    requests::Entity::find()
        .select_only()
        .column(requests::Column::OrgId)
        .distinct()
        .filter(requests::Column::Status.eq(HookRunStatus::Queued.as_str()))
        .order_by_asc(requests::Column::OrgId)
        .into_tuple()
        .all(db)
        .await
}

pub async fn oldest_queued_for_org<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
) -> Result<Option<requests::Model>, DbErr> {
    requests::Entity::find()
        .filter(requests::Column::Status.eq(HookRunStatus::Queued.as_str()))
        .filter(requests::Column::OrgId.eq(org_id))
        .order_by_asc(requests::Column::ReceivedAt)
        .order_by_asc(requests::Column::Id)
        .one(db)
        .await
}

pub async fn claim<C: ConnectionTrait>(
    db: &C,
    id: i64,
    node_uuid: &str,
    now_us: i64,
) -> Result<bool, DbErr> {
    let updated = requests::Entity::update_many()
        .col_expr(
            requests::Column::Status,
            Expr::value(HookRunStatus::Running.as_str()),
        )
        .col_expr(requests::Column::ClaimedBy, Expr::value(node_uuid))
        .col_expr(requests::Column::ClaimedAt, Expr::value(now_us))
        .filter(requests::Column::Id.eq(id))
        .filter(requests::Column::Status.eq(HookRunStatus::Queued.as_str()))
        .exec(db)
        .await?;
    Ok(updated.rows_affected == 1)
}

/// Ends a row that is still queued, for runs refused at claim time.
pub async fn finish_unclaimed<C: ConnectionTrait>(
    db: &C,
    id: i64,
    status: HookRunStatus,
    error: Option<&str>,
    now_us: i64,
) -> Result<bool, DbErr> {
    let updated = finished(status, error, now_us)
        .filter(requests::Column::Id.eq(id))
        .filter(requests::Column::Status.eq(HookRunStatus::Queued.as_str()))
        .exec(db)
        .await?;
    Ok(updated.rows_affected == 1)
}

/// Conditional on the claim, so a row the reaper already failed keeps `worker_lost`.
pub async fn finish<C: ConnectionTrait>(
    db: &C,
    id: i64,
    node_uuid: &str,
    status: HookRunStatus,
    error: Option<&str>,
    now_us: i64,
) -> Result<bool, DbErr> {
    let updated = finished(status, error, now_us)
        .filter(requests::Column::Id.eq(id))
        .filter(requests::Column::Status.eq(HookRunStatus::Running.as_str()))
        .filter(requests::Column::ClaimedBy.eq(node_uuid))
        .exec(db)
        .await?;
    Ok(updated.rows_affected == 1)
}

/// Fails rows whose claimer left `live_nodes`, and own overdue rows no local task runs any more.
pub async fn reap<C: ConnectionTrait>(
    db: &C,
    live_nodes: &HashSet<String>,
    local: LocalClaims<'_>,
    now_us: i64,
) -> Result<u64, DbErr> {
    let running: Vec<(i64, Option<String>, Option<i64>)> = requests::Entity::find()
        .select_only()
        .column(requests::Column::Id)
        .column(requests::Column::ClaimedBy)
        .column(requests::Column::ClaimedAt)
        .filter(requests::Column::Status.eq(HookRunStatus::Running.as_str()))
        .into_tuple()
        .all(db)
        .await?;
    let mut reaped = 0;
    for (id, claimed_by, claimed_at) in running {
        let claimer_gone = claimed_by
            .as_ref()
            .is_none_or(|node| !live_nodes.contains(node));
        // A live peer's overdue run may still be draining after its cancel, holding its slot.
        let abandoned_here = claimed_by.as_deref() == Some(local.node_uuid)
            && !local.in_flight.contains(&id)
            && claimed_at.is_none_or(|at| at < local.stale_before_us);
        if !claimer_gone && !abandoned_here {
            continue;
        }
        reaped += finished(HookRunStatus::Failed, Some(ERR_WORKER_LOST), now_us)
            .filter(requests::Column::Id.eq(id))
            .filter(requests::Column::Status.eq(HookRunStatus::Running.as_str()))
            .exec(db)
            .await?
            .rows_affected;
    }
    Ok(reaped)
}

pub async fn read_payload<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
) -> Result<Option<String>, DbErr> {
    let data: Option<String> = workflow_run_data::Entity::find()
        .select_only()
        .column(workflow_run_data::Column::Data)
        .filter(workflow_run_data::Column::OrgId.eq(org_id))
        .filter(workflow_run_data::Column::WorkflowId.eq(workflow_id))
        .filter(workflow_run_data::Column::RunId.eq(run_id))
        .into_tuple()
        .one(db)
        .await?;
    Ok(data)
}

/// Mean claim-to-finish seconds of the org's last `sample` finished runs.
pub async fn recent_mean_run_secs<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    sample: u64,
) -> Result<Option<f64>, DbErr> {
    let spans: Vec<(i64, i64)> = requests::Entity::find()
        .select_only()
        .column(requests::Column::ClaimedAt)
        .column(requests::Column::FinishedAt)
        .filter(requests::Column::OrgId.eq(org_id))
        .filter(requests::Column::Status.is_in([
            HookRunStatus::Succeeded.as_str(),
            HookRunStatus::Failed.as_str(),
        ]))
        .filter(requests::Column::ClaimedAt.is_not_null())
        .filter(requests::Column::FinishedAt.is_not_null())
        .order_by_desc(requests::Column::FinishedAt)
        .limit(sample)
        .into_tuple()
        .all(db)
        .await?;
    if spans.is_empty() {
        return Ok(None);
    }
    let total_us: i64 = spans
        .iter()
        .map(|(claimed, finished)| (finished - claimed).max(0))
        .sum();
    Ok(Some(total_us as f64 / 1_000_000.0 / spans.len() as f64))
}

pub async fn list_for_workflow<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    workflow_id: &str,
    start_us: i64,
    end_us: i64,
    limit: u64,
) -> Result<Vec<requests::Model>, DbErr> {
    requests::Entity::find()
        .filter(requests::Column::OrgId.eq(org_id))
        .filter(requests::Column::WorkflowId.eq(workflow_id))
        .filter(requests::Column::ReceivedAt.between(start_us, end_us))
        .order_by_desc(requests::Column::ReceivedAt)
        .order_by_desc(requests::Column::Id)
        .limit(limit)
        .all(db)
        .await
}

pub async fn null_idem_keys_before<C: ConnectionTrait>(
    db: &C,
    before_us: i64,
) -> Result<u64, DbErr> {
    let updated = requests::Entity::update_many()
        .col_expr(
            requests::Column::IdemKey,
            Expr::value(Option::<String>::None),
        )
        .filter(requests::Column::IdemKey.is_not_null())
        .filter(requests::Column::ReceivedAt.lt(before_us))
        .exec(db)
        .await?;
    Ok(updated.rows_affected)
}

/// Deletes terminal rows received before the cutoff together with their payloads.
pub async fn delete_terminal_before<C: TransactionTrait>(
    db: &C,
    before_us: i64,
) -> Result<u64, DbErr> {
    let txn = db.begin().await?;
    let rows: Vec<(i64, String)> = requests::Entity::find()
        .select_only()
        .column(requests::Column::Id)
        .column(requests::Column::RunId)
        .filter(requests::Column::Status.is_in([
            HookRunStatus::Succeeded.as_str(),
            HookRunStatus::Failed.as_str(),
            HookRunStatus::Expired.as_str(),
        ]))
        .filter(requests::Column::ReceivedAt.lt(before_us))
        .into_tuple()
        .all(&txn)
        .await?;
    let mut deleted = 0;
    for batch in rows.chunks(DELETE_BATCH) {
        let run_ids = batch.iter().map(|(_, run_id)| run_id.as_str());
        workflow_run_data::Entity::delete_many()
            .filter(workflow_run_data::Column::RunId.is_in(run_ids))
            .exec(&txn)
            .await?;
        deleted += requests::Entity::delete_many()
            .filter(requests::Column::Id.is_in(batch.iter().map(|(id, _)| *id)))
            .exec(&txn)
            .await?
            .rows_affected;
    }
    txn.commit().await?;
    Ok(deleted)
}

/// Deletes the trigger's queued rows and their payloads; running rows finish on their own.
pub async fn delete_queued_for_trigger<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
) -> Result<u64, DbErr> {
    let queued_runs = Query::select()
        .column(requests::Column::RunId)
        .from(requests::Entity)
        .and_where(Expr::col(requests::Column::TriggerId).eq(trigger_id))
        .and_where(Expr::col(requests::Column::Status).eq(HookRunStatus::Queued.as_str()))
        .to_owned();
    workflow_run_data::Entity::delete_many()
        .filter(workflow_run_data::Column::RunId.in_subquery(queued_runs))
        .exec(db)
        .await?;
    let deleted = requests::Entity::delete_many()
        .filter(requests::Column::TriggerId.eq(trigger_id))
        .filter(requests::Column::Status.eq(HookRunStatus::Queued.as_str()))
        .exec(db)
        .await?;
    Ok(deleted.rows_affected)
}

pub async fn delete_by_org<C: ConnectionTrait>(db: &C, org_id: &str) -> Result<u64, DbErr> {
    let deleted = requests::Entity::delete_many()
        .filter(requests::Column::OrgId.eq(org_id))
        .exec(db)
        .await?;
    Ok(deleted.rows_affected)
}

#[cfg(any(test, feature = "test-utils"))]
pub async fn create_tables_for_tests(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    super::migration::create_workflow_http_trigger_tables(db).await
}

/// The cap is counted inside the insert's transaction, so concurrent calls cannot overshoot it.
async fn write_queued<C: TransactionTrait>(
    db: &C,
    expired_id: Option<i64>,
    request: NewHookRequest,
    payload: String,
    queue_max: Option<u64>,
) -> Result<LedgerInsert, DbErr> {
    let trigger_id = request.trigger_id.clone();
    let idem_key = request.idem_key.clone();
    let txn = db.begin().await?;
    if let Some(queue_max) = queue_max
        && !has_queue_room(&txn, &request.org_id, queue_max).await?
    {
        txn.rollback().await?;
        return Ok(LedgerInsert::QueueFull);
    }
    let written = async {
        if let Some(expired_id) = expired_id {
            requests::Entity::update_many()
                .col_expr(
                    requests::Column::IdemKey,
                    Expr::value(Option::<String>::None),
                )
                .filter(requests::Column::Id.eq(expired_id))
                .filter(requests::Column::Status.eq(HookRunStatus::Expired.as_str()))
                .exec(&txn)
                .await?;
        }
        insert_queued(&txn, request, payload).await
    }
    .await;
    match written {
        Ok(()) => {
            txn.commit().await?;
            Ok(LedgerInsert::Inserted)
        }
        Err(error) => {
            txn.rollback().await?;
            key_taken(db, &trigger_id, idem_key.as_deref(), error).await
        }
    }
}

/// Postgres serialises on the org row lock; the SQLite pool already has one writer connection.
async fn has_queue_room<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    queue_max: u64,
) -> Result<bool, DbErr> {
    if txn.get_database_backend() != DbBackend::Sqlite {
        organizations::Entity::find()
            .filter(organizations::Column::Identifier.eq(org_id))
            .lock_exclusive()
            .one(txn)
            .await?;
    }
    Ok(count_queued_for_org(txn, org_id).await? < queue_max)
}

async fn insert_queued<C: ConnectionTrait>(
    db: &C,
    request: NewHookRequest,
    payload: String,
) -> Result<(), DbErr> {
    workflow_run_data::Entity::insert(workflow_run_data::ActiveModel {
        id: NotSet,
        org_id: Set(request.org_id.clone()),
        workflow_id: Set(request.workflow_id.clone()),
        run_id: Set(request.run_id.clone()),
        triggered_at: Set(request.received_at),
        data: Set(payload),
    })
    .exec_without_returning(db)
    .await?;
    requests::Entity::insert(request.queued_row())
        .exec_without_returning(db)
        .await?;
    Ok(())
}

/// Re-reads the holder of a duplicate idempotency key; any other insert failure is returned as is.
async fn key_taken<C: TransactionTrait>(
    db: &C,
    trigger_id: &str,
    idem_key: Option<&str>,
    error: DbErr,
) -> Result<LedgerInsert, DbErr> {
    let (Some(idem_key), Some(SqlErr::UniqueConstraintViolation(_))) = (idem_key, error.sql_err())
    else {
        return Err(error);
    };
    let txn = db.begin().await?;
    let winner = find_by_idem_key(&txn, trigger_id, idem_key).await?;
    txn.commit().await?;
    winner
        .map(|winner| LedgerInsert::KeyTaken(Box::new(winner)))
        .ok_or(error)
}

fn finished(
    status: HookRunStatus,
    error: Option<&str>,
    now_us: i64,
) -> sea_orm::UpdateMany<requests::Entity> {
    requests::Entity::update_many()
        .col_expr(requests::Column::Status, Expr::value(status.as_str()))
        .col_expr(
            requests::Column::Error,
            Expr::value(error.map(str::to_string)),
        )
        .col_expr(requests::Column::FinishedAt, Expr::value(now_us))
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    const NOW: i64 = 1_760_000_000_000_000;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn request(run_id: &str, idem_key: Option<&str>, received_at: i64) -> NewHookRequest {
        NewHookRequest {
            trigger_id: "t1".to_string(),
            org_id: "acme".to_string(),
            workflow_id: "wf-1".to_string(),
            run_id: run_id.to_string(),
            idem_key: idem_key.map(str::to_string),
            body_sha256: "cd".repeat(32),
            body_bytes: 7,
            content_type: Some("application/json".to_string()),
            meta: r#"{"method":"POST"}"#.to_string(),
            credential_id: "c1".to_string(),
            credential_prefix: "o2wh_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.7".to_string(),
            received_at,
        }
    }

    async fn enqueue_one(db: &DatabaseConnection, run_id: &str, received_at: i64) -> i64 {
        let inserted = enqueue(
            db,
            request(run_id, None, received_at),
            format!("p-{run_id}"),
        )
        .await
        .unwrap();
        assert!(matches!(inserted, LedgerInsert::Inserted));
        get_run(db, "t1", run_id).await.unwrap().unwrap().id
    }

    async fn status_of(db: &DatabaseConnection, run_id: &str) -> (String, Option<String>) {
        let row = get_run(db, "t1", run_id).await.unwrap().unwrap();
        (row.status, row.error)
    }

    fn local<'a>(node_uuid: &'a str, in_flight: &'a HashSet<i64>, stale: i64) -> LocalClaims<'a> {
        LocalClaims {
            node_uuid,
            in_flight,
            stale_before_us: stale,
        }
    }

    async fn payloads(db: &DatabaseConnection) -> u64 {
        workflow_run_data::Entity::find().count(db).await.unwrap()
    }

    #[test]
    fn hook_run_statuses_round_trip() {
        for status in [
            HookRunStatus::Queued,
            HookRunStatus::Running,
            HookRunStatus::Succeeded,
            HookRunStatus::Failed,
            HookRunStatus::Expired,
        ] {
            assert_eq!(HookRunStatus::parse(status.as_str()), Some(status));
        }
        assert!(!HookRunStatus::Running.is_terminal());
        assert!(HookRunStatus::Expired.is_terminal());
    }

    #[tokio::test]
    async fn enqueue_writes_the_ledger_row_and_payload_together() {
        let db = db().await;
        enqueue_one(&db, "run-1", NOW).await;
        let row = get_run(&db, "t1", "run-1").await.unwrap().unwrap();
        assert_eq!(row.status, "queued");
        assert_eq!(row.run_id, "run-1");
        assert_eq!(
            read_payload(&db, "acme", "wf-1", "run-1").await.unwrap(),
            Some("p-run-1".to_string())
        );
        assert_eq!(count_queued_for_org(&db, "acme").await.unwrap(), 1);
    }

    #[tokio::test]
    async fn enqueue_rolls_back_the_payload_when_the_ledger_insert_fails() {
        let db = db().await;
        enqueue_one(&db, "run-1", NOW).await;
        let duplicate = enqueue(&db, request("run-1", None, NOW), "second".to_string()).await;
        assert!(duplicate.is_err(), "a reused run_id must not insert");
        assert_eq!(payloads(&db).await, 1);
        assert_eq!(
            read_payload(&db, "acme", "wf-1", "run-1").await.unwrap(),
            Some("p-run-1".to_string())
        );
    }

    #[tokio::test]
    async fn a_duplicate_key_insert_reports_the_winner() {
        let db = db().await;
        let first = enqueue(&db, request("run-1", Some("k1"), NOW), "a".to_string())
            .await
            .unwrap();
        assert!(matches!(first, LedgerInsert::Inserted));
        let second = enqueue(&db, request("run-2", Some("k1"), NOW), "b".to_string())
            .await
            .unwrap();
        let LedgerInsert::KeyTaken(winner) = second else {
            panic!("the second insert must lose the key");
        };
        assert_eq!(winner.run_id, "run-1");
        assert_eq!(payloads(&db).await, 1);
    }

    #[tokio::test]
    async fn reissue_expired_nulls_the_old_key_and_inserts_a_new_run() {
        let db = db().await;
        enqueue(&db, request("run-1", Some("k1"), NOW), "a".to_string())
            .await
            .unwrap();
        let original = find_by_idem_key(&db, "t1", "k1").await.unwrap().unwrap();
        assert!(
            finish_unclaimed(&db, original.id, HookRunStatus::Expired, None, NOW + 1)
                .await
                .unwrap()
        );

        let reissued = reissue_expired(
            &db,
            original.id,
            request("run-2", Some("k1"), NOW + 2),
            "b".to_string(),
        )
        .await
        .unwrap();
        assert!(matches!(reissued, LedgerInsert::Inserted));
        let holder = find_by_idem_key(&db, "t1", "k1").await.unwrap().unwrap();
        assert_eq!(
            (holder.run_id.as_str(), holder.status.as_str()),
            ("run-2", "queued")
        );
        let old = get_run(&db, "t1", "run-1").await.unwrap().unwrap();
        assert_eq!((old.idem_key, old.status.as_str()), (None, "expired"));
    }

    #[tokio::test]
    async fn reap_fails_rows_claimed_by_a_node_missing_from_nodes() {
        let db = db().await;
        let id = enqueue_one(&db, "run-1", NOW).await;
        assert!(claim(&db, id, "gone-node", NOW).await.unwrap());
        let live = HashSet::from(["live-node".to_string()]);
        assert_eq!(
            reap(
                &db,
                &live,
                local("live-node", &HashSet::new(), NOW - 1),
                NOW + 1
            )
            .await
            .unwrap(),
            1
        );
        assert_eq!(
            status_of(&db, "run-1").await,
            ("failed".to_string(), Some(ERR_WORKER_LOST.to_string()))
        );
    }

    #[tokio::test]
    async fn reap_fails_own_rows_claimed_longer_than_timeout_plus_a_minute() {
        let db = db().await;
        let id = enqueue_one(&db, "run-1", NOW).await;
        assert!(claim(&db, id, "live-node", NOW).await.unwrap());
        let live = HashSet::from(["live-node".to_string()]);
        let timeout_plus_minute = (900 + 60) * 1_000_000;
        let now = NOW + timeout_plus_minute + 1;
        let stale = now - timeout_plus_minute;
        let draining = HashSet::from([id]);
        assert_eq!(
            reap(&db, &live, local("live-node", &draining, stale), now)
                .await
                .unwrap(),
            0,
            "a run its task still drains keeps its slot"
        );
        assert_eq!(
            reap(&db, &live, local("live-node", &HashSet::new(), stale), now)
                .await
                .unwrap(),
            1
        );
        assert_eq!(status_of(&db, "run-1").await.0, "failed");
    }

    #[tokio::test]
    async fn reap_leaves_live_rows_alone() {
        let db = db().await;
        let running = enqueue_one(&db, "run-1", NOW).await;
        enqueue_one(&db, "run-2", NOW).await;
        assert!(claim(&db, running, "live-node", NOW).await.unwrap());
        let live = HashSet::from(["live-node".to_string()]);
        assert_eq!(
            reap(
                &db,
                &live,
                local("live-node", &HashSet::new(), NOW - 1),
                NOW + 1
            )
            .await
            .unwrap(),
            0
        );
        assert_eq!(status_of(&db, "run-1").await.0, "running");
        assert_eq!(status_of(&db, "run-2").await.0, "queued");
    }

    #[tokio::test]
    async fn finish_write_loses_to_the_reaper() {
        let db = db().await;
        let id = enqueue_one(&db, "run-1", NOW).await;
        assert!(claim(&db, id, "node-a", NOW).await.unwrap());
        assert_eq!(
            reap(
                &db,
                &HashSet::new(),
                local("node-b", &HashSet::new(), NOW - 1),
                NOW + 1
            )
            .await
            .unwrap(),
            1
        );
        let finished = finish(&db, id, "node-a", HookRunStatus::Succeeded, None, NOW + 2)
            .await
            .unwrap();
        assert!(!finished);
        assert_eq!(
            status_of(&db, "run-1").await,
            ("failed".to_string(), Some(ERR_WORKER_LOST.to_string()))
        );
    }

    #[tokio::test]
    async fn reap_leaves_a_live_peers_overdue_run_alone() {
        let db = db().await;
        let id = enqueue_one(&db, "run-1", NOW).await;
        assert!(claim(&db, id, "peer-node", NOW).await.unwrap());
        let live = HashSet::from(["peer-node".to_string(), "local-node".to_string()]);
        let now = NOW + 10_000 * 1_000_000;
        assert_eq!(
            reap(
                &db,
                &live,
                local("local-node", &HashSet::new(), now - 1),
                now
            )
            .await
            .unwrap(),
            0,
            "a live peer may still be draining the run"
        );
        assert_eq!(status_of(&db, "run-1").await.0, "running");
    }

    #[tokio::test]
    async fn a_capped_enqueue_refuses_once_the_org_queue_is_full() {
        let db = db().await;
        let first = enqueue_capped(&db, None, request("run-1", None, NOW), "p".to_string(), 1)
            .await
            .unwrap();
        assert!(matches!(first, LedgerInsert::Inserted));
        let full = enqueue_capped(&db, None, request("run-2", None, NOW), "p".to_string(), 1)
            .await
            .unwrap();
        assert!(matches!(full, LedgerInsert::QueueFull));
        assert!(get_run(&db, "t1", "run-2").await.unwrap().is_none());
        assert_eq!(payloads(&db).await, 1, "a refused run leaves no payload");
        let mut other = request("run-3", None, NOW);
        other.org_id = "globex".to_string();
        let other = enqueue_capped(&db, None, other, "p".to_string(), 1)
            .await
            .unwrap();
        assert!(
            matches!(other, LedgerInsert::Inserted),
            "the cap is per org"
        );
    }

    #[tokio::test]
    async fn concurrent_capped_enqueues_never_overshoot_the_cap() {
        let db = db().await;
        let attempts = (0..8).map(|i| {
            enqueue_capped(
                &db,
                None,
                request(&format!("run-{i}"), None, NOW),
                "p".to_string(),
                3,
            )
        });
        let inserted = futures::future::join_all(attempts)
            .await
            .into_iter()
            .filter(|written| matches!(written, Ok(LedgerInsert::Inserted)))
            .count();
        assert_eq!(inserted, 3);
        assert_eq!(count_queued_for_org(&db, "acme").await.unwrap(), 3);
    }

    #[tokio::test]
    async fn idem_keys_older_than_a_day_are_cleared() {
        let db = db().await;
        enqueue(
            &db,
            request("old", Some("k-old"), NOW - IDEM_KEY_TTL_US - 1),
            "a".into(),
        )
        .await
        .unwrap();
        enqueue(&db, request("new", Some("k-new"), NOW), "b".into())
            .await
            .unwrap();
        assert_eq!(
            null_idem_keys_before(&db, NOW - IDEM_KEY_TTL_US)
                .await
                .unwrap(),
            1
        );
        assert!(
            find_by_idem_key(&db, "t1", "k-old")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            find_by_idem_key(&db, "t1", "k-new")
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn terminal_rows_past_retention_are_deleted_with_their_payload() {
        let db = db().await;
        let old = NOW - 31 * 24 * 3600 * 1_000_000;
        for (run_id, status) in [
            ("succeeded", HookRunStatus::Succeeded),
            ("failed", HookRunStatus::Failed),
            ("expired", HookRunStatus::Expired),
        ] {
            let id = enqueue_one(&db, run_id, old).await;
            assert!(
                finish_unclaimed(&db, id, status, None, old + 1)
                    .await
                    .unwrap()
            );
        }
        let recent = enqueue_one(&db, "recent", NOW).await;
        assert!(
            finish_unclaimed(&db, recent, HookRunStatus::Succeeded, None, NOW)
                .await
                .unwrap()
        );

        let cutoff = NOW - 30 * 24 * 3600 * 1_000_000;
        assert_eq!(delete_terminal_before(&db, cutoff).await.unwrap(), 3);
        assert!(get_run(&db, "t1", "succeeded").await.unwrap().is_none());
        assert!(get_run(&db, "t1", "recent").await.unwrap().is_some());
        assert_eq!(payloads(&db).await, 1);
    }

    #[tokio::test]
    async fn queued_and_running_rows_are_never_purged() {
        let db = db().await;
        let old = NOW - 31 * 24 * 3600 * 1_000_000;
        enqueue_one(&db, "queued", old).await;
        let running = enqueue_one(&db, "running", old).await;
        assert!(claim(&db, running, "node-a", old).await.unwrap());
        assert_eq!(delete_terminal_before(&db, NOW).await.unwrap(), 0);
        assert_eq!(payloads(&db).await, 2);
        assert_eq!(status_of(&db, "running").await.0, "running");
    }
}
