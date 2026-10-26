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

use std::sync::LazyLock as Lazy;

use async_trait::async_trait;
use config::{
    meta::{
        meta_store::MetaStore,
        triggers::{Trigger, TriggerModule, TriggerStatus},
    },
    utils::json,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

use crate::errors::Result;

pub mod postgres;
pub mod sqlite;

static CLIENT: Lazy<Box<dyn Scheduler>> = Lazy::new(connect);
pub const TRIGGERS_KEY: &str = "/triggers/";

pub fn connect() -> Box<dyn Scheduler> {
    match config::get_config().common.meta_store.as_str().into() {
        MetaStore::PostgreSQL => Box::<postgres::PostgresScheduler>::default(),
        _ => Box::<sqlite::SqliteScheduler>::default(),
    }
}

#[async_trait]
pub trait Scheduler: Sync + Send + 'static {
    async fn create_table(&self) -> Result<()>;
    async fn create_table_index(&self) -> Result<()>;
    async fn push(&self, trigger: Trigger) -> Result<()>;
    async fn delete(&self, org: &str, module: TriggerModule, key: &str) -> Result<()>;
    async fn update_status(
        &self,
        org: &str,
        module: TriggerModule,
        key: &str,
        status: TriggerStatus,
        retries: i32,
        data: Option<&str>,
    ) -> Result<()>;
    async fn update_trigger(&self, trigger: Trigger, clone: bool) -> Result<()>;
    async fn bulk_update_triggers(&self, triggers: Vec<Trigger>) -> Result<()>;
    async fn bulk_update_status(
        &self,
        updates: Vec<(
            String,
            TriggerModule,
            String,
            TriggerStatus,
            i32,
            Option<String>,
        )>,
    ) -> Result<()>;
    async fn keep_alive(&self, ids: &[i64], alert_timeout: i64, report_timeout: i64) -> Result<()>;
    /// Renew one physical claim only while its epoch still owns the row.
    async fn keep_alive_claim(
        &self,
        claim: &Trigger,
        alert_timeout: i64,
        report_timeout: i64,
    ) -> Result<bool>;
    /// Persist completion/reschedule fields only for the captured claim epoch.
    async fn complete_claim(&self, trigger: Trigger) -> Result<bool>;
    async fn pull(
        &self,
        concurrency: i64,
        alert_timeout: i64,
        report_timeout: i64,
        module: Option<TriggerModule>,
    ) -> Result<Vec<Trigger>>;
    async fn get(&self, org: &str, module: TriggerModule, key: &str) -> Result<Trigger>;
    async fn list(&self, module: Option<TriggerModule>) -> Result<Vec<Trigger>>;
    async fn list_by_org(&self, org: &str, module: Option<TriggerModule>) -> Result<Vec<Trigger>>;
    /// Deletes every job of the org, sending the events `delete` sends; returns `(module, key)`s.
    async fn delete_by_org(&self, org: &str) -> Result<Vec<(TriggerModule, String)>>;
    /// Makes due at `now` each future run of the org on the `park` grid laid from `deleted_at`.
    async fn release_parked(&self, org: &str, deleted_at: i64, park: i64, now: i64) -> Result<u64>;
    /// Makes one parked run due at `now` only while its org row is active, in one statement.
    async fn release_if_org_active(&self, parked: &Trigger, now: i64) -> Result<bool>;
    async fn watch_timeout(&self) -> Result<()>;
    async fn len_module(&self, module: TriggerModule) -> usize;
    async fn len(&self) -> usize;
    async fn is_empty(&self) -> bool;
    async fn clear(&self) -> Result<()>;
}

/// Initializes the scheduler - creates table and index
pub async fn init() -> Result<()> {
    CLIENT.create_table().await?;
    CLIENT.create_table_index().await?;
    Ok(())
}

/// Pushes a Trigger job into the queue
#[inline]
pub async fn push(trigger: Trigger) -> Result<()> {
    CLIENT.push(trigger).await
}

/// Deletes the Trigger job matching the given parameters
#[inline]
pub async fn delete(org: &str, module: TriggerModule, key: &str) -> Result<()> {
    log::info!("deleting scheduled job: {key}, {module}");
    CLIENT.delete(org, module, key).await
}

/// Updates the status of the Trigger job. This method is supposed
/// to be used only by the node that is currently processing the trigger.
#[inline]
pub async fn update_status(
    org: &str,
    module: TriggerModule,
    key: &str,
    status: TriggerStatus,
    retries: i32,
    data: Option<&str>,
) -> Result<()> {
    CLIENT
        .update_status(org, module, key, status, retries, data)
        .await
}

/// Updates the triggers with given identifiers.
/// Does not update start_time, end_time, org, module and key. Must
/// only be used by the node that is currently processing the trigger.
/// Use `pull()` method to set the status of the job from `Waiting` to `Processing`.
#[inline]
pub async fn update_trigger(trigger: Trigger, clone: bool) -> Result<()> {
    CLIENT.update_trigger(trigger, clone).await
}

/// Bulk updates multiple triggers at once for better performance
#[inline]
pub async fn bulk_update_triggers(triggers: Vec<Trigger>) -> Result<()> {
    CLIENT.bulk_update_triggers(triggers).await
}

/// Bulk updates status of multiple triggers at once for better performance
#[inline]
pub async fn bulk_update_status(
    updates: Vec<(
        String,
        TriggerModule,
        String,
        TriggerStatus,
        i32,
        Option<String>,
    )>,
) -> Result<()> {
    CLIENT.bulk_update_status(updates).await
}

/// Keeps the trigger alive
#[inline]
pub async fn keep_alive(ids: &[i64], alert_timeout: i64, report_timeout: i64) -> Result<()> {
    CLIENT.keep_alive(ids, alert_timeout, report_timeout).await
}

#[inline]
pub async fn keep_alive_claim(
    claim: &Trigger,
    alert_timeout: i64,
    report_timeout: i64,
) -> Result<bool> {
    CLIENT
        .keep_alive_claim(claim, alert_timeout, report_timeout)
        .await
}

#[inline]
pub async fn complete_claim(trigger: Trigger) -> Result<bool> {
    CLIENT.complete_claim(trigger).await
}

/// Acquire the scheduler row's write lock, verify the physical claim, and
/// renew its lease through a caller-owned SeaORM transaction. The evaluator
/// calls this before state/transition writes so claim validation and durable
/// alert state commit atomically. `UPDATE` is used instead of a portable
/// `SELECT FOR UPDATE`: it locks on PostgreSQL and acquires SQLite's writer
/// lock while remaining valid on both supported metadata stores.
pub async fn renew_claim_in_transaction<C: ConnectionTrait>(
    conn: &C,
    job_id: i64,
    claim_epoch: i64,
    end_time: i64,
) -> std::result::Result<bool, sea_orm::DbErr> {
    let backend = conn.get_database_backend();
    let sql = match backend {
        DatabaseBackend::Postgres => {
            "UPDATE scheduled_jobs SET end_time = $1 WHERE id = $2 AND claim_epoch = $3 AND status = $4"
        }
        DatabaseBackend::Sqlite => {
            "UPDATE scheduled_jobs SET end_time = ? WHERE id = ? AND claim_epoch = ? AND status = ?"
        }
        _ => {
            return Err(sea_orm::DbErr::Custom(
                "unsupported metadata store for scheduler claim fencing".to_string(),
            ));
        }
    };
    let result = conn
        .execute(Statement::from_sql_and_values(
            backend,
            sql,
            [
                end_time.into(),
                job_id.into(),
                claim_epoch.into(),
                (TriggerStatus::Processing as i32).into(),
            ],
        ))
        .await?;
    Ok(result.rows_affected() == 1)
}

/// Re-arms a claimed job as `Waiting` in the caller's transaction while `claim_epoch` owns it.
pub async fn rearm_claim_in_transaction<C: ConnectionTrait>(
    conn: &C,
    job_id: i64,
    claim_epoch: i64,
    next_run_at: i64,
) -> std::result::Result<bool, sea_orm::DbErr> {
    let sql = "UPDATE scheduled_jobs SET status = ?, next_run_at = ?, retries = 0 \
               WHERE id = ? AND claim_epoch = ? AND status = ?";
    let values = [
        (TriggerStatus::Waiting as i32).into(),
        next_run_at.into(),
        job_id.into(),
        claim_epoch.into(),
        (TriggerStatus::Processing as i32).into(),
    ];
    claim_statement(conn, sql, values).await
}

/// Deletes a claimed job inside the caller's transaction, only while `claim_epoch` still owns it.
pub async fn delete_claim_in_transaction<C: ConnectionTrait>(
    conn: &C,
    job_id: i64,
    claim_epoch: i64,
) -> std::result::Result<bool, sea_orm::DbErr> {
    let sql = "DELETE FROM scheduled_jobs WHERE id = ? AND claim_epoch = ? AND status = ?";
    let values = [
        job_id.into(),
        claim_epoch.into(),
        (TriggerStatus::Processing as i32).into(),
    ];
    claim_statement(conn, sql, values).await
}

/// One upsert: `push` alone keeps an existing job's time, and update-then-insert loses races.
pub async fn arm_with<C: ConnectionTrait>(
    conn: &C,
    trigger: &Trigger,
) -> std::result::Result<(), sea_orm::DbErr> {
    let sql = "INSERT INTO scheduled_jobs (org, module, module_key, is_realtime, is_silenced, \
               status, retries, next_run_at, data) VALUES (?, ?, ?, false, false, ?, 0, ?, '') \
               ON CONFLICT (org, module, module_key) DO UPDATE SET status = excluded.status, \
               next_run_at = excluded.next_run_at, retries = 0";
    let values = [
        trigger.org.clone().into(),
        (trigger.module.clone() as i32).into(),
        trigger.module_key.clone().into(),
        (TriggerStatus::Waiting as i32).into(),
        trigger.next_run_at.into(),
    ];
    claim_statement(conn, sql, values).await?;
    Ok(())
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    trigger: &Trigger,
) -> std::result::Result<(), sea_orm::DbErr> {
    let sql = "DELETE FROM scheduled_jobs WHERE org = ? AND module = ? AND module_key = ?";
    let values = [
        trigger.org.clone().into(),
        (trigger.module.clone() as i32).into(),
        trigger.module_key.clone().into(),
    ];
    claim_statement(conn, sql, values).await?;
    Ok(())
}

/// Scheduler pulls only those triggers that match the conditions-
/// - trigger.next_run_at <= now
/// - !(trigger.is_realtime && !trigger.is_silenced)
/// - trigger.status == "Waiting"
///
/// `concurrency` - Defines the maximum number of jobs to pull at a time.
/// `timeout` - Used to set the maximum time duration the job execution can take.
///     This is used to calculate the `end_time` of the trigger.
/// `module` - When `Some(m)`, pull only jobs for that module (per-module pullers, A3); the
///     postgres backend also takes a per-module advisory lock so modules don't serialize
///     against each other. When `None`, pull across all modules under a single global lock
///     (legacy behavior).
#[inline]
pub async fn pull(
    concurrency: i64,
    alert_timeout: i64,
    report_timeout: i64,
    module: Option<TriggerModule>,
) -> Result<Vec<Trigger>> {
    CLIENT
        .pull(concurrency, alert_timeout, report_timeout, module)
        .await
}

/// Returns the scheduled job associated with the given id in read-only fashion
#[inline]
pub async fn get(org: &str, module: TriggerModule, key: &str) -> Result<Trigger> {
    CLIENT.get(org, module, key).await
}

/// Background job that watches for timeout of a job
/// Steps:
/// - Select all the records with status = "Processing"
/// - calculate the current timestamp and difference from `start_time` of each record
/// - Get the record ids with difference more than the given timeout
/// - Update their status back to "Waiting" and increase their "retries" by 1
#[inline]
pub async fn watch_timeout() -> Result<()> {
    CLIENT.watch_timeout().await
}

/// The count of jobs for the given module (Report/Alert etc.)
#[inline]
pub async fn len_module(module: TriggerModule) -> usize {
    CLIENT.len_module(module).await
}

#[inline]
pub async fn len() -> usize {
    CLIENT.len().await
}

/// List the jobs for the given module
#[inline]
pub async fn list(module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
    CLIENT.list(module).await
}

/// List the jobs for the given module
#[inline]
pub async fn list_by_org(org: &str, module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
    CLIENT.list_by_org(org, module).await
}

/// Deletes every job of the org, in one statement
#[inline]
pub async fn delete_by_org(org: &str) -> Result<Vec<(TriggerModule, String)>> {
    CLIENT.delete_by_org(org).await
}

/// Makes the org's parked runs due, deciding which are parked in the same statement
#[inline]
pub async fn release_parked(org: &str, deleted_at: i64, park: i64, now: i64) -> Result<u64> {
    CLIENT.release_parked(org, deleted_at, park, now).await
}

/// Makes a parked run due again if its org is active, deciding on the org row in the same statement
#[inline]
pub async fn release_if_org_active(parked: &Trigger, now: i64) -> Result<bool> {
    CLIENT.release_if_org_active(parked, now).await
}

#[inline]
pub async fn is_empty() -> bool {
    CLIENT.is_empty().await
}

#[inline]
pub async fn clear() -> Result<()> {
    CLIENT.clear().await
}

/// `i32::MIN` has no positive magnitude, so `abs` would wrap it back to a negative cap.
pub fn get_scheduler_max_retries() -> i32 {
    config::get_config()
        .limit
        .scheduler_max_retries
        .saturating_abs()
}

/// Realtime alert triggers are cached on every node; the trigger rides in the
/// event body so watchers can update their cache without a db read.
async fn emit_realtime_trigger_event(trigger: &Trigger) -> Result<()> {
    if trigger.module != TriggerModule::Alert || !trigger.is_realtime {
        return Ok(());
    }
    let key = format!(
        "{TRIGGERS_KEY}{}/{}/{}",
        trigger.module, trigger.org, trigger.module_key
    );
    let cluster_coordinator = crate::db::get_coordinator().await;
    cluster_coordinator
        .put(&key, json::to_vec(trigger).unwrap().into(), true, None)
        .await
}

/// Runs a claim-fenced statement written with `?`, numbered for PostgreSQL.
async fn claim_statement<C: ConnectionTrait, const N: usize>(
    conn: &C,
    sql: &str,
    values: [sea_orm::Value; N],
) -> std::result::Result<bool, sea_orm::DbErr> {
    let backend = conn.get_database_backend();
    let sql = match backend {
        DatabaseBackend::Postgres => {
            let mut n = 0;
            sql.chars()
                .map(|c| {
                    if c == '?' {
                        n += 1;
                        format!("${n}")
                    } else {
                        c.to_string()
                    }
                })
                .collect()
        }
        DatabaseBackend::Sqlite => sql.to_string(),
        _ => {
            return Err(sea_orm::DbErr::Custom(
                "unsupported metadata store for scheduler claim fencing".to_string(),
            ));
        }
    };
    let result = conn
        .execute(Statement::from_sql_and_values(backend, sql, values))
        .await?;
    Ok(result.rows_affected() == 1)
}

/// A failed event cannot undo the committed release, so it is logged and the release reported.
async fn finish_release<F>(
    parked: &Trigger,
    now: i64,
    released_rows: u64,
    emit: impl FnOnce(Trigger) -> F,
) -> bool
where
    F: std::future::Future<Output = Result<()>>,
{
    if released_rows == 0 {
        return false;
    }
    let mut due = parked.clone();
    due.next_run_at = now;
    if let Err(e) = emit(due).await {
        log::error!(
            "[SCHEDULER] released {}/{}/{} but its realtime event failed: {e}",
            parked.module,
            parked.org,
            parked.module_key
        );
    }
    true
}

#[cfg(test)]
mod tests {
    use std::future::Future;

    use sea_orm::{ConnectionTrait, Database, TransactionTrait};

    use super::*;

    fn assert_bool_result_future<F>(_: F)
    where
        F: Future<Output = Result<bool>>,
    {
    }

    #[test]
    fn test_triggers_key_value() {
        assert_eq!(TRIGGERS_KEY, "/triggers/");
    }

    #[test]
    fn test_triggers_key_starts_with_slash() {
        assert!(TRIGGERS_KEY.starts_with('/'));
    }

    #[test]
    fn scheduler_trait_exposes_claim_scoped_keep_alive_and_completion() {
        let scheduler = sqlite::SqliteScheduler::new();
        let claim = Trigger {
            id: 17,
            claim_epoch: 3,
            module: TriggerModule::CompositeAlert,
            status: TriggerStatus::Processing,
            ..Default::default()
        };

        assert_bool_result_future(scheduler.keep_alive_claim(&claim, 60, 300));
        assert_bool_result_future(scheduler.complete_claim(claim));
    }

    #[tokio::test]
    async fn transactional_claim_renewal_rejects_a_reclaimed_epoch() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE scheduled_jobs (\
             id BIGINT PRIMARY KEY, claim_epoch BIGINT NOT NULL, \
             status INT NOT NULL, end_time BIGINT)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO scheduled_jobs (id, claim_epoch, status, end_time) VALUES (17, 4, 1, 10)",
        )
        .await
        .unwrap();

        let txn = db.begin().await.unwrap();
        assert!(renew_claim_in_transaction(&txn, 17, 4, 20).await.unwrap());
        txn.commit().await.unwrap();

        let stale_txn = db.begin().await.unwrap();
        assert!(
            !renew_claim_in_transaction(&stale_txn, 17, 3, 30)
                .await
                .unwrap()
        );
        stale_txn.commit().await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT end_time FROM scheduled_jobs WHERE id = 17".to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "end_time").unwrap(), 20);
    }

    #[tokio::test]
    async fn claim_fenced_rearm_and_delete_apply_only_to_the_owning_epoch() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE scheduled_jobs (id BIGINT PRIMARY KEY, claim_epoch BIGINT NOT NULL, \
             status INT NOT NULL, next_run_at BIGINT, retries INT NOT NULL DEFAULT 0)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO scheduled_jobs (id, claim_epoch, status, next_run_at, retries) VALUES \
             (1, 4, 1, 0, 2), (2, 4, 1, 0, 0)",
        )
        .await
        .unwrap();
        assert!(!rearm_claim_in_transaction(&db, 1, 3, 50).await.unwrap());
        assert!(rearm_claim_in_transaction(&db, 1, 4, 50).await.unwrap());
        let row = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT status, next_run_at, retries FROM scheduled_jobs WHERE id = 1".to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                row.try_get::<i32>("", "status").unwrap(),
                row.try_get::<i64>("", "next_run_at").unwrap(),
                row.try_get::<i32>("", "retries").unwrap()
            ),
            (TriggerStatus::Waiting as i32, 50, 0)
        );
        assert!(
            !rearm_claim_in_transaction(&db, 1, 4, 60).await.unwrap(),
            "no longer claimed"
        );

        assert!(!delete_claim_in_transaction(&db, 2, 3).await.unwrap());
        assert!(delete_claim_in_transaction(&db, 2, 4).await.unwrap());
        assert!(!delete_claim_in_transaction(&db, 2, 4).await.unwrap());
    }

    #[tokio::test]
    async fn arm_moves_an_existing_job_or_adds_one() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE scheduled_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT NOT NULL, \
             module INT NOT NULL, module_key TEXT NOT NULL, is_realtime BOOLEAN DEFAULT false \
             NOT NULL, is_silenced BOOLEAN DEFAULT false NOT NULL, status INT NOT NULL, \
             start_time BIGINT, end_time BIGINT, retries INT NOT NULL, next_run_at BIGINT NOT \
             NULL, data TEXT NOT NULL, claim_epoch BIGINT DEFAULT 0 NOT NULL, \
             UNIQUE (org, module, module_key))",
        )
        .await
        .unwrap();
        db.execute_unprepared(&format!(
            "INSERT INTO scheduled_jobs (org, module, module_key, status, retries, next_run_at, \
             data) VALUES ('o', {}, 'k', 0, 3, 900, '')",
            TriggerModule::FleetRollout as i32
        ))
        .await
        .unwrap();
        let job = |key: &str, at: i64| Trigger {
            org: "o".to_string(),
            module: TriggerModule::FleetRollout,
            module_key: key.to_string(),
            next_run_at: at,
            ..Default::default()
        };
        arm_with(&db, &job("k", 50)).await.unwrap();
        arm_with(&db, &job("new", 60)).await.unwrap();
        let rows = db
            .query_all(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT module_key, status, retries, next_run_at FROM scheduled_jobs \
                 ORDER BY module_key"
                    .to_string(),
            ))
            .await
            .unwrap();
        let got: Vec<(String, i32, i32, i64)> = rows
            .iter()
            .map(|r| {
                (
                    r.try_get("", "module_key").unwrap(),
                    r.try_get("", "status").unwrap(),
                    r.try_get("", "retries").unwrap(),
                    r.try_get("", "next_run_at").unwrap(),
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![("k".to_string(), 0, 0, 50), ("new".to_string(), 0, 0, 60)],
            "moved, not duplicated, and the missing one added"
        );
        delete_with(&db, &job("k", 0)).await.unwrap();
        let left = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT COUNT(*) AS n FROM scheduled_jobs".to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(left.try_get::<i64>("", "n").unwrap(), 1);
    }

    #[tokio::test]
    async fn arm_racing_an_uncommitted_arm_still_sets_its_time_on_postgres_when_ci_provides_it() {
        let Ok(dsn) = std::env::var("ZO_META_POSTGRES_DSN") else {
            return;
        };
        // The SQLite lane sets the variable empty rather than unsetting it.
        if dsn.trim().is_empty() {
            return;
        }
        let schema = format!("scheduler_arm_test_{}", config::ider::generate());
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut pools = Vec::new();
        for _ in 0..2 {
            let mut options = sea_orm::ConnectOptions::new(dsn.clone());
            options
                .max_connections(1)
                .min_connections(1)
                .set_schema_search_path(schema.clone());
            pools.push(std::sync::Arc::new(
                Database::connect(options).await.unwrap(),
            ));
        }
        pools[0]
            .execute_unprepared(
                "CREATE TABLE scheduled_jobs (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, \
                 org VARCHAR(100) NOT NULL, module INT NOT NULL, module_key VARCHAR(256) NOT \
                 NULL, is_realtime BOOLEAN DEFAULT false NOT NULL, is_silenced BOOLEAN DEFAULT \
                 false NOT NULL, status INT NOT NULL, start_time BIGINT, end_time BIGINT, \
                 retries INT NOT NULL, next_run_at BIGINT NOT NULL, data TEXT NOT NULL, \
                 claim_epoch BIGINT DEFAULT 0 NOT NULL); CREATE UNIQUE INDEX \
                 scheduled_jobs_org_module_key_idx ON scheduled_jobs (org, module, module_key)",
            )
            .await
            .unwrap();
        let job = |at: i64| Trigger {
            org: "o".to_string(),
            module: TriggerModule::FleetRollout,
            module_key: "k".to_string(),
            next_run_at: at,
            ..Default::default()
        };
        let first = pools[0].begin().await.unwrap();
        arm_with(&first, &job(900)).await.unwrap();
        let second = pools[1].clone();
        let racing = tokio::spawn(async move { arm_with(second.as_ref(), &job(50)).await });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(!racing.is_finished(), "it waits on the uncommitted row");
        first.commit().await.unwrap();
        racing.await.unwrap().unwrap();
        let row = pools[0]
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Postgres,
                "SELECT COUNT(*) AS n, MAX(next_run_at) AS at FROM scheduled_jobs".to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            (
                row.try_get::<i64>("", "n").unwrap(),
                row.try_get::<i64>("", "at").unwrap()
            ),
            (1, 50),
            "the later arm's time wins"
        );
        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .await
            .unwrap();
    }

    #[test]
    fn test_get_scheduler_max_retries_is_never_negative() {
        assert!(get_scheduler_max_retries() >= 0);
    }

    #[tokio::test]
    async fn test_a_failed_event_after_the_release_still_reports_the_release() {
        let parked = Trigger {
            next_run_at: 5,
            ..Default::default()
        };
        let emitted = std::sync::Mutex::new(Vec::new());
        let emit = |due: Trigger| {
            emitted.lock().unwrap().push(due.next_run_at);
            async {
                Err(crate::errors::Error::Message(
                    "coordinator down".to_string(),
                ))
            }
        };
        assert!(finish_release(&parked, 9, 1, emit).await);
        assert!(!finish_release(&parked, 9, 0, emit).await);
        assert_eq!(
            *emitted.lock().unwrap(),
            vec![9],
            "no event for a run left parked"
        );
    }
}
