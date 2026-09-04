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
    async fn clean_complete(&self) -> Result<()>;
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

/// Background job that frequently (with the given interval) cleans "Completed" jobs
/// or jobs with retries >= scheduler_max_retries set through environment config
#[inline]
pub async fn clean_complete() -> Result<()> {
    CLIENT.clean_complete().await
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

#[inline]
pub async fn is_empty() -> bool {
    CLIENT.is_empty().await
}

#[inline]
pub async fn clear() -> Result<()> {
    CLIENT.clear().await
}

/// Returns the scheduler_max_retries set through environment config
/// The bool element in the tuple indicates if the max retries value is included
pub fn get_scheduler_max_retries() -> (bool, i32) {
    let max_retries = config::get_config().limit.scheduler_max_retries;
    (max_retries > 0, max_retries.unsigned_abs() as i32)
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

    #[test]
    fn test_get_scheduler_max_retries_returns_tuple() {
        let (has_max, _max) = get_scheduler_max_retries();
        // when config is default (0), should return false and abs(0) = 0
        let max_retries = config::get_config().limit.scheduler_max_retries;
        assert_eq!(has_max, max_retries > 0);
    }
}
