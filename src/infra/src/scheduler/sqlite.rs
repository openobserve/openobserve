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

use async_trait::async_trait;
use chrono::Duration;
use config::{meta::triggers::SlackSyncFinish, utils::time::now_micros};
use sqlx::{Pool, Row, Sqlite};

use super::{EscalationFinish, TRIGGERS_KEY, Trigger, TriggerModule, TriggerStatus};
use crate::{
    db::{
        self, IndexStatement,
        sqlite::{CLIENT_RO, CLIENT_RW, add_column, create_index, drop_column},
    },
    errors::{DbError, Error, Result},
};

const PULL_QUERY: &str = r#"UPDATE scheduled_jobs
SET status = $1, start_time = $2, claim_epoch = claim_epoch + 1,
    end_time = CASE WHEN module = $3 THEN $4 ELSE $5 END
WHERE id IN (
    SELECT id FROM scheduled_jobs
    WHERE status = $6 AND next_run_at <= $7
      AND NOT (is_realtime = $8 AND is_silenced = $9)
    ORDER BY next_run_at, id LIMIT $10
)
RETURNING *;"#;

const PULL_QUERY_BY_MODULE: &str = r#"UPDATE scheduled_jobs
SET status = $1, start_time = $2, claim_epoch = claim_epoch + 1,
    end_time = CASE WHEN module = $3 THEN $4 ELSE $5 END
WHERE id IN (
    SELECT id FROM scheduled_jobs
    WHERE status = $6 AND next_run_at <= $7
      AND NOT (is_realtime = $8 AND is_silenced = $9) AND module = $10
    ORDER BY next_run_at, id LIMIT $11
)
RETURNING *;"#;

const KEEP_ALIVE_CLAIM_QUERY: &str = r#"UPDATE scheduled_jobs
SET end_time = CASE WHEN module = $1 THEN $2 ELSE $3 END
WHERE id = $4 AND claim_epoch = $5 AND status = $6;"#;

const COMPLETE_CLAIM_QUERY: &str = r#"UPDATE scheduled_jobs
SET status = $1, retries = $2, next_run_at = $3,
    is_realtime = $4, is_silenced = $5, end_time = $6, data = $7
WHERE id = $8 AND claim_epoch = $9 AND status = $10;"#;

/// The scheduler table; `armed_for` is only written by the `OncallSlackSync` statements (SY-2).
pub(super) const CREATE_TABLE_QUERY: &str = r#"
CREATE TABLE IF NOT EXISTS scheduled_jobs
(
    id           INTEGER not null primary key autoincrement,
    org          VARCHAR(100) not null,
    module       INT not null,
    module_key   VARCHAR(256) not null,
    is_realtime  BOOLEAN default false not null,
    is_silenced  BOOLEAN default false not null,
    status       INT not null,
    start_time   BIGINT,
    end_time     BIGINT,
    retries      INT not null,
    next_run_at  BIGINT not null,
    data         TEXT not null,
    claim_epoch  BIGINT default 0 not null,
    armed_for    BIGINT
);"#;

/// Moves only a Waiting row: `$5` is Waiting, so a running job keeps its key until it ends.
const RENAME_KEY_QUERY: &str = r#"UPDATE scheduled_jobs SET module_key = $1
    WHERE org = $2 AND module = $3 AND module_key = $4 AND status = $5
    RETURNING *;"#;

/// SY-2.2 arm: insert at `$5`; a Waiting row moves no later, a Completed one waits again, and a
/// row a pass holds only notes the earliest asked-for time. `$4` Waiting, `$6` Processing.
const ARM_SLACK_SYNC_QUERY: &str = r#"INSERT INTO scheduled_jobs
    (org, module, module_key, is_realtime, is_silenced, status, retries, next_run_at, data)
VALUES ($1, $2, $3, false, false, $4, 0, $5, '')
ON CONFLICT (org, module, module_key) DO UPDATE SET
    status = CASE WHEN scheduled_jobs.status = $6 THEN scheduled_jobs.status ELSE $4 END,
    next_run_at = CASE
        WHEN scheduled_jobs.status = $6 THEN scheduled_jobs.next_run_at
        WHEN scheduled_jobs.status = $4 THEN MIN(scheduled_jobs.next_run_at, $5)
        ELSE $5 END,
    armed_for = CASE
        WHEN scheduled_jobs.status = $6 THEN MIN(COALESCE(scheduled_jobs.armed_for, $5), $5)
        ELSE scheduled_jobs.armed_for END;"#;

/// SY-2.3 finish: the pass's `$1`/`$3`, or Waiting (`$2`) at the arm's time but not before the
/// pass's new backoff `$4`; fenced on id, claim epoch and Processing (`$8`).
const FINISH_SLACK_SYNC_QUERY: &str = r#"UPDATE scheduled_jobs SET
    status = CASE WHEN armed_for IS NULL THEN $1 ELSE $2 END,
    next_run_at = CASE WHEN armed_for IS NULL THEN $3 ELSE MAX(armed_for, $4) END,
    data = $5,
    armed_for = NULL
WHERE id = $6 AND claim_epoch = $7 AND status = $8;"#;

/// M138 (a) arm while `data` is still the read `$8`: insert at `$5` with `$7`; a Waiting row
/// moves no later, a finished one waits again, and a row a tick holds (`$6`) notes `armed_for`.
const ARM_ESCALATION_QUERY: &str = r#"INSERT INTO scheduled_jobs
    (org, module, module_key, is_realtime, is_silenced, status, retries, next_run_at, data)
VALUES ($1, $2, $3, false, false, $4, 0, $5, $7)
ON CONFLICT (org, module, module_key) DO UPDATE SET
    status = CASE WHEN scheduled_jobs.status = $6 THEN scheduled_jobs.status ELSE $4 END,
    next_run_at = CASE
        WHEN scheduled_jobs.status = $6 THEN scheduled_jobs.next_run_at
        WHEN scheduled_jobs.status = $4 THEN MIN(scheduled_jobs.next_run_at, $5)
        ELSE $5 END,
    retries = CASE WHEN scheduled_jobs.status = $6 THEN scheduled_jobs.retries ELSE 0 END,
    data = excluded.data,
    armed_for = CASE
        WHEN scheduled_jobs.status = $6 THEN MIN(COALESCE(scheduled_jobs.armed_for, $5), $5)
        ELSE scheduled_jobs.armed_for END
WHERE scheduled_jobs.data = $8;"#;

/// The escalation row's `data`, read before an arm merges over it.
const ESCALATION_DATA_QUERY: &str =
    "SELECT data FROM scheduled_jobs WHERE org = $1 AND module = $2 AND module_key = $3;";

/// OF-10 finish with a next tick: Waiting (`$1`) at `$2`, or earlier for an arm made during the
/// tick; `data` is left to the tick's own writes. Fenced on id, epoch and Processing (`$5`).
const FINISH_ESCALATION_QUERY: &str = r#"UPDATE scheduled_jobs SET
    status = $1, retries = 0,
    next_run_at = CASE WHEN armed_for IS NULL THEN $2 ELSE MIN(armed_for, $2) END,
    armed_for = NULL
WHERE id = $3 AND claim_epoch = $4 AND status = $5
RETURNING *;"#;

/// OF-10 finish of an ended ladder that an arm re-opened: Waiting (`$1`) at `armed_for`.
const REQUEUE_ARMED_ESCALATION_QUERY: &str = r#"UPDATE scheduled_jobs SET
    status = $1, retries = 0, next_run_at = armed_for, armed_for = NULL
WHERE id = $2 AND claim_epoch = $3 AND status = $4 AND armed_for IS NOT NULL
RETURNING *;"#;

/// OF-10 finish of an ended ladder nothing armed; `$3` Processing.
const DELETE_UNARMED_ESCALATION_QUERY: &str = r#"DELETE FROM scheduled_jobs
WHERE id = $1 AND claim_epoch = $2 AND status = $3 AND armed_for IS NULL;"#;

/// [`super::Scheduler::rename_key`] on `pool`.
async fn rename_key_in(
    pool: &Pool<Sqlite>,
    org: &str,
    module: TriggerModule,
    key: &str,
    new_key: &str,
) -> Result<Option<Trigger>> {
    Ok(sqlx::query_as::<_, Trigger>(RENAME_KEY_QUERY)
        .bind(new_key)
        .bind(org)
        .bind(module)
        .bind(key)
        .bind(TriggerStatus::Waiting)
        .fetch_optional(pool)
        .await?)
}

/// [`super::Scheduler::arm_slack_sync`] on `pool`.
async fn arm_slack_sync_in(
    pool: &Pool<Sqlite>,
    org: &str,
    response_id: &str,
    t: i64,
) -> Result<()> {
    sqlx::query(ARM_SLACK_SYNC_QUERY)
        .bind(org)
        .bind(TriggerModule::OncallSlackSync)
        .bind(response_id)
        .bind(TriggerStatus::Waiting)
        .bind(t)
        .bind(TriggerStatus::Processing)
        .execute(pool)
        .await?;
    Ok(())
}

/// [`super::Scheduler::finish_slack_sync`] on `pool`.
async fn finish_slack_sync_in(
    pool: &Pool<Sqlite>,
    claim: &Trigger,
    finish: &SlackSyncFinish,
) -> Result<bool> {
    let result = sqlx::query(FINISH_SLACK_SYNC_QUERY)
        .bind(&finish.status)
        .bind(TriggerStatus::Waiting)
        .bind(finish.next_run_at)
        .bind(finish.data.not_before)
        .bind(config::utils::json::to_string(&finish.data)?)
        .bind(claim.id)
        .bind(claim.claim_epoch)
        .bind(TriggerStatus::Processing)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() == 1)
}

/// [`super::Scheduler::arm_escalation`] on `pool`.
async fn arm_escalation_in(
    pool: &Pool<Sqlite>,
    org: &str,
    response_id: &str,
    at: i64,
    data: &str,
) -> Result<()> {
    for _ in 0..super::ESCALATION_ARM_ATTEMPTS {
        let stored: Option<String> = sqlx::query_scalar(ESCALATION_DATA_QUERY)
            .bind(org)
            .bind(TriggerModule::OncallEscalation)
            .bind(response_id)
            .fetch_optional(pool)
            .await?;
        crate::race_point!("arm_escalation.read");
        let merged = super::escalation_arm_data(stored.as_deref(), data);
        crate::race_point!("arm_escalation.before_write");
        let armed = sqlx::query(ARM_ESCALATION_QUERY)
            .bind(org)
            .bind(TriggerModule::OncallEscalation)
            .bind(response_id)
            .bind(TriggerStatus::Waiting)
            .bind(at)
            .bind(TriggerStatus::Processing)
            .bind(merged)
            .bind(stored)
            .execute(pool)
            .await?;
        if armed.rows_affected() > 0 {
            return Ok(());
        }
    }
    Err(Error::Message(format!(
        "the escalation arm of {response_id} lost every race for its row's data"
    )))
}

/// [`super::Scheduler::finish_escalation`] on `pool`.
async fn finish_escalation_in(
    pool: &Pool<Sqlite>,
    claim: &Trigger,
    next_run_at: Option<i64>,
) -> Result<EscalationFinish> {
    if let Some(at) = next_run_at {
        let row = sqlx::query_as::<_, Trigger>(FINISH_ESCALATION_QUERY)
            .bind(TriggerStatus::Waiting)
            .bind(at)
            .bind(claim.id)
            .bind(claim.claim_epoch)
            .bind(TriggerStatus::Processing)
            .fetch_optional(pool)
            .await?;
        return Ok(row.map_or(EscalationFinish::Lost, EscalationFinish::Requeued));
    }
    if let Some(row) = requeue_armed_escalation(pool, claim).await? {
        return Ok(EscalationFinish::Requeued(row));
    }
    crate::race_point!("escalation_finish.unarmed");
    crate::race_point!("escalation_finish.before_delete");
    let deleted = sqlx::query(DELETE_UNARMED_ESCALATION_QUERY)
        .bind(claim.id)
        .bind(claim.claim_epoch)
        .bind(TriggerStatus::Processing)
        .execute(pool)
        .await?;
    if deleted.rows_affected() == 1 {
        return Ok(EscalationFinish::Deleted);
    }
    // Only a finish clears `armed_for`, so an arm that landed between the two statements is
    // still there; a second miss means the claim is gone.
    Ok(requeue_armed_escalation(pool, claim)
        .await?
        .map_or(EscalationFinish::Lost, EscalationFinish::Requeued))
}

async fn requeue_armed_escalation(pool: &Pool<Sqlite>, claim: &Trigger) -> Result<Option<Trigger>> {
    Ok(sqlx::query_as::<_, Trigger>(REQUEUE_ARMED_ESCALATION_QUERY)
        .bind(TriggerStatus::Waiting)
        .bind(claim.id)
        .bind(claim.claim_epoch)
        .bind(TriggerStatus::Processing)
        .fetch_optional(pool)
        .await?)
}

pub struct SqliteScheduler {}

impl SqliteScheduler {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for SqliteScheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::Scheduler for SqliteScheduler {
    /// Creates the Scheduled Jobs table
    async fn create_table(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        sqlx::query(CREATE_TABLE_QUERY).execute(&client).await?;

        // create data column for old version <= 0.10.9
        add_column(
            &client,
            "scheduled_jobs",
            "data",
            "TEXT NOT NULL DEFAULT ''",
        )
        .await?;
        add_column(
            &client,
            "scheduled_jobs",
            "claim_epoch",
            "BIGINT NOT NULL DEFAULT 0",
        )
        .await?;
        add_column(&client, "scheduled_jobs", "armed_for", "BIGINT").await?;

        // drop created_at column for old version <= 0.40.0
        drop_column(&client, "scheduled_jobs", "created_at").await?;

        Ok(())
    }

    async fn create_table_index(&self) -> Result<()> {
        create_index(IndexStatement::new(
            "scheduled_jobs_key_idx",
            "scheduled_jobs",
            false,
            &["module_key"],
        ))
        .await?;
        create_index(IndexStatement::new(
            "scheduled_jobs_org_key_idx",
            "scheduled_jobs",
            false,
            &["org", "module_key"],
        ))
        .await?;
        create_index(IndexStatement::new(
            "scheduled_jobs_org_module_key_idx",
            "scheduled_jobs",
            true,
            &["org", "module", "module_key"],
        ))
        .await?;

        Ok(())
    }

    /// The count of jobs for the given module (Report/Alert etc.)
    async fn len_module(&self, module: TriggerModule) -> usize {
        let pool = CLIENT_RO.clone();
        let ret = match sqlx::query(
            r#"
SELECT COUNT(*) as num FROM scheduled_jobs WHERE module = $1;"#,
        )
        .bind(module)
        .fetch_one(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[SQLITE] triggers len error: {e}");
                return 0;
            }
        };
        match ret.try_get::<i64, &str>("num") {
            Ok(v) => v as usize,
            _ => 0,
        }
    }

    /// Pushes a Trigger job into the queue
    async fn push(&self, trigger: Trigger) -> Result<()> {
        let client = scheduler_write_pool();
        let mut tx = client.begin().await?;

        if let Err(e) = sqlx::query(
            r#"
INSERT INTO scheduled_jobs (org, module, module_key, is_realtime, is_silenced, status, retries, next_run_at, start_time, end_time, data)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT DO NOTHING;
        "#,
        )
        .bind(&trigger.org)
        .bind(&trigger.module)
        .bind(&trigger.module_key)
        .bind(trigger.is_realtime)
        .bind(trigger.is_silenced)
        .bind(&trigger.status)
        .bind(0)
        .bind(trigger.next_run_at)
        .bind(0)
        .bind(0)
        .bind(&trigger.data)
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[SQLITE] rollback push scheduled_jobs error: {e}");
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit push scheduled_jobs error: {e}");
            return Err(e.into());
        }

        // release lock
        drop(client);

        // TODO: For sqlite cluster coordinator, the alert triggers are put
        // into the sqlite meta database to send watch events. Hence, there is a
        // redundancy of alert triggers stored both in scheduled_jobs and meta
        // tables. How to remove this redundancy?
        super::emit_realtime_trigger_event(&trigger).await?;
        Ok(())
    }

    /// Deletes the Trigger job matching the given parameters
    async fn delete(&self, org: &str, module: TriggerModule, key: &str) -> Result<()> {
        let client = scheduler_write_pool();
        sqlx::query(
            r#"DELETE FROM scheduled_jobs WHERE org = $1 AND module_key = $2 AND module = $3;"#,
        )
        .bind(org)
        .bind(key)
        .bind(&module)
        .execute(&client)
        .await?;

        drop(client);

        // For now, only send alert triggers
        if module == TriggerModule::Alert {
            // For status update of triggers, we don't need to send put events
            // to cluster coordinator for now as it only changes the status and retries
            // fields of scheduled jobs and not anything else
            let key = format!("{TRIGGERS_KEY}{module}/{org}/{key}");
            let cluster_coordinator = db::get_coordinator().await;
            cluster_coordinator.delete(&key, false, true, None).await?;
        }
        Ok(())
    }

    /// Updates the status of the Trigger job
    async fn update_status(
        &self,
        org: &str,
        module: TriggerModule,
        key: &str,
        status: TriggerStatus,
        retries: i32,
        data: Option<&str>,
    ) -> Result<()> {
        let client = CLIENT_RW.clone();
        let query = match data {
            Some(data) => {
                sqlx::query(
                    r#"UPDATE scheduled_jobs SET status = $1, retries = $2, data = $3 WHERE org = $4 AND module_key = $5 AND module = $6;"#,
                )
                .bind(status)
                .bind(retries)
                .bind(data)
                .bind(org)
                .bind(key)
                .bind(&module)
            },
            None => {
                sqlx::query(
                    r#"UPDATE scheduled_jobs SET status = $1, retries = $2 WHERE org = $3 AND module_key = $4 AND module = $5;"#,
                )
                .bind(status)
                .bind(retries)
                .bind(org)
                .bind(key)
                .bind(&module)
            },
        };
        query.execute(&client).await?;

        drop(client);

        // For status update of triggers, we don't need to send put events
        // to cluster coordinator for now as it only changes the status and retries
        // fields of scheduled jobs and not anything else
        Ok(())
    }

    async fn update_trigger(&self, trigger: Trigger, clone: bool) -> Result<()> {
        let client = scheduler_write_pool();
        let query = if clone {
            sqlx::query(
                r#"UPDATE scheduled_jobs
    SET status = $1, start_time = $2, end_time = $3, retries = $4, next_run_at = $5, is_realtime = $6, is_silenced = $7, data = $8
    WHERE org = $9 AND module_key = $10 AND module = $11;"#,
            )
            .bind(&trigger.status)
            .bind(trigger.start_time)
            .bind(trigger.end_time)
            .bind(trigger.retries)
            .bind(trigger.next_run_at)
            .bind(trigger.is_realtime)
            .bind(trigger.is_silenced)
            .bind(&trigger.data)
            .bind(&trigger.org)
            .bind(&trigger.module_key)
            .bind(&trigger.module)
        } else {
            sqlx::query(
                r#"UPDATE scheduled_jobs
    SET status = $1, retries = $2, next_run_at = $3, is_realtime = $4, is_silenced = $5, data = $6
    WHERE org = $7 AND module_key = $8 AND module = $9;"#,
            )
            .bind(&trigger.status)
            .bind(trigger.retries)
            .bind(trigger.next_run_at)
            .bind(trigger.is_realtime)
            .bind(trigger.is_silenced)
            .bind(&trigger.data)
            .bind(&trigger.org)
            .bind(&trigger.module_key)
            .bind(&trigger.module)
        };

        query.execute(&client).await?;

        // release lock
        drop(client);

        super::emit_realtime_trigger_event(&trigger).await?;
        Ok(())
    }

    // Does not support bulk updates
    async fn bulk_update_triggers(&self, _triggers: Vec<Trigger>) -> Result<()> {
        Ok(())
    }

    /// Does not support bulk updates
    async fn bulk_update_status(
        &self,
        _updates: Vec<(
            String,
            TriggerModule,
            String,
            TriggerStatus,
            i32,
            Option<String>,
        )>,
    ) -> Result<()> {
        Ok(())
    }

    /// Keeps the trigger alive
    async fn keep_alive(&self, ids: &[i64], alert_timeout: i64, report_timeout: i64) -> Result<()> {
        let now = now_micros();
        let report_max_time = now
            + Duration::try_seconds(report_timeout)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let alert_max_time = now
            + Duration::try_seconds(alert_timeout)
                .unwrap()
                .num_microseconds()
                .unwrap();

        let sql = format!(
            "UPDATE scheduled_jobs SET end_time = CASE WHEN module = $1 THEN $2 ELSE $3 END WHERE id IN ({});",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        let client = CLIENT_RW.clone();
        sqlx::query(&sql)
            .bind(TriggerModule::Report)
            .bind(report_max_time)
            .bind(alert_max_time)
            .execute(&client)
            .await?;

        Ok(())
    }

    async fn keep_alive_claim(
        &self,
        claim: &Trigger,
        alert_timeout: i64,
        report_timeout: i64,
    ) -> Result<bool> {
        let now = now_micros();
        let report_max_time = now
            + Duration::try_seconds(report_timeout)
                .ok_or_else(|| Error::Message("invalid report timeout".into()))?
                .num_microseconds()
                .ok_or_else(|| Error::Message("report timeout overflow".into()))?;
        let alert_max_time = now
            + Duration::try_seconds(alert_timeout)
                .ok_or_else(|| Error::Message("invalid alert timeout".into()))?
                .num_microseconds()
                .ok_or_else(|| Error::Message("alert timeout overflow".into()))?;
        let client = CLIENT_RW.clone();
        let result = sqlx::query(KEEP_ALIVE_CLAIM_QUERY)
            .bind(TriggerModule::Report)
            .bind(report_max_time)
            .bind(alert_max_time)
            .bind(claim.id)
            .bind(claim.claim_epoch)
            .bind(TriggerStatus::Processing)
            .execute(&client)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn rename_key(
        &self,
        org: &str,
        module: TriggerModule,
        key: &str,
        new_key: &str,
    ) -> Result<Option<Trigger>> {
        rename_key_in(&CLIENT_RW.clone(), org, module, key, new_key).await
    }

    async fn arm_slack_sync(&self, org: &str, response_id: &str, t: i64) -> Result<()> {
        arm_slack_sync_in(&CLIENT_RW.clone(), org, response_id, t).await
    }

    async fn finish_slack_sync(&self, claim: &Trigger, finish: &SlackSyncFinish) -> Result<bool> {
        finish_slack_sync_in(&CLIENT_RW.clone(), claim, finish).await
    }

    async fn arm_escalation(
        &self,
        org: &str,
        response_id: &str,
        at: i64,
        data: &str,
    ) -> Result<()> {
        arm_escalation_in(&CLIENT_RW.clone(), org, response_id, at, data).await
    }

    async fn write_escalation_tick_data(
        &self,
        current: &Trigger,
        data: &str,
        renew_until: Option<i64>,
    ) -> Result<bool> {
        let result = sqlx::query(super::WRITE_ESCALATION_TICK_DATA_QUERY)
            .bind(data)
            .bind(renew_until)
            .bind(current.id)
            .bind(current.claim_epoch)
            .bind(&current.status)
            .bind(&current.data)
            .execute(&scheduler_write_pool())
            .await?;
        Ok(result.rows_affected() == 1)
    }

    async fn finish_escalation(
        &self,
        claim: &Trigger,
        next_run_at: Option<i64>,
    ) -> Result<EscalationFinish> {
        finish_escalation_in(&CLIENT_RW.clone(), claim, next_run_at).await
    }

    async fn complete_claim(&self, trigger: Trigger) -> Result<bool> {
        let client = scheduler_write_pool();
        let result = sqlx::query(COMPLETE_CLAIM_QUERY)
            .bind(&trigger.status)
            .bind(trigger.retries)
            .bind(trigger.next_run_at)
            .bind(trigger.is_realtime)
            .bind(trigger.is_silenced)
            .bind(trigger.end_time)
            .bind(&trigger.data)
            .bind(trigger.id)
            .bind(trigger.claim_epoch)
            .bind(TriggerStatus::Processing)
            .execute(&client)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Returns the Trigger jobs with "Waiting" status.
    /// Steps:
    /// - Lock the Sqlite client for read-write
    /// - Read the records with status "Waiting", oldest createdAt, next_run_at <= now and limit =
    ///   `concurrency`
    /// - Changes their statuses from "Waiting" to "Processing"
    /// - Commits as a single transaction
    /// - Returns the Trigger jobs
    async fn pull(
        &self,
        concurrency: i64,
        alert_timeout: i64,
        report_timeout: i64,
        module: Option<TriggerModule>,
    ) -> Result<Vec<Trigger>> {
        let client = scheduler_write_pool();

        let now = now_micros();
        let report_max_time = now
            + Duration::try_seconds(report_timeout)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let alert_max_time = now
            + Duration::try_seconds(alert_timeout)
                .unwrap()
                .num_microseconds()
                .unwrap();
        // Sqlite holds the single global CLIENT_RW write lock here, so there is no per-module
        // advisory lock — all writes are already serialized (single-node/dev backend). The
        // `module` filter still scopes which rows a per-module puller claims; see postgres.rs for
        // the C3 lock rationale. Legacy `None` string is byte-identical (LIMIT $10).
        let query = if module.is_some() {
            PULL_QUERY_BY_MODULE
        } else {
            PULL_QUERY
        };
        let (skip_realtime, skip_silenced) = super::pull_skip_binds(module.as_ref());

        let mut q = sqlx::query_as::<_, Trigger>(query)
            .bind(TriggerStatus::Processing)
            .bind(now)
            .bind(TriggerModule::Report)
            .bind(report_max_time)
            .bind(alert_max_time)
            .bind(TriggerStatus::Waiting)
            .bind(now)
            .bind(skip_realtime)
            .bind(skip_silenced);
        if let Some(m) = module {
            q = q.bind(m);
        }
        q = q.bind(concurrency);
        let jobs: Vec<Trigger> = q.fetch_all(&client).await?;
        Ok(jobs)
    }

    async fn get(&self, org: &str, module: TriggerModule, key: &str) -> Result<Trigger> {
        let pool = scheduler_read_pool();
        let query = r#"
SELECT * FROM scheduled_jobs
WHERE org = $1 AND module = $2 AND module_key = $3;"#;
        let job = match sqlx::query_as::<_, Trigger>(query)
            .bind(org)
            .bind(module.clone())
            .bind(key)
            .fetch_one(&pool)
            .await
        {
            Ok(job) => job,
            Err(_) => {
                return Err(Error::from(DbError::KeyNotExists(format!(
                    "{org}/{module}/{key}"
                ))));
            }
        };
        Ok(job)
    }

    async fn list(&self, module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
        let client = CLIENT_RO.clone();
        let jobs: Vec<Trigger> = if let Some(module) = module {
            let query = r#"SELECT * FROM scheduled_jobs WHERE module = $1 ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .bind(module)
                .fetch_all(&client)
                .await?
        } else {
            let query = r#"SELECT * FROM scheduled_jobs ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .fetch_all(&client)
                .await?
        };
        Ok(jobs)
    }

    /// List all the jobs for the given module and organization
    async fn list_by_org(&self, org: &str, module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
        let client = CLIENT_RO.clone();
        let jobs: Vec<Trigger> = if let Some(module) = module {
            let query =
                r#"SELECT * FROM scheduled_jobs WHERE org = $1 AND module = $2 ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .bind(org)
                .bind(module)
                .fetch_all(&client)
                .await?
        } else {
            let query = r#"SELECT * FROM scheduled_jobs WHERE org = $1 ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .bind(org)
                .fetch_all(&client)
                .await?
        };
        Ok(jobs)
    }

    async fn delete_by_org(&self, org: &str) -> Result<Vec<(TriggerModule, String)>> {
        let client = CLIENT_RW.clone();
        let deleted: Vec<(TriggerModule, String)> = sqlx::query_as(
            r#"DELETE FROM scheduled_jobs WHERE org = $1 RETURNING module, module_key;"#,
        )
        .bind(org)
        .fetch_all(&client)
        .await?;
        let cluster_coordinator = db::get_coordinator().await;
        for (module, key) in &deleted {
            if *module == TriggerModule::Alert {
                let key = format!("{TRIGGERS_KEY}{module}/{org}/{key}");
                cluster_coordinator.delete(&key, false, true, None).await?;
            }
        }
        Ok(deleted)
    }

    async fn release_parked(&self, org: &str, deleted_at: i64, park: i64, now: i64) -> Result<u64> {
        let client = CLIENT_RW.clone();
        let released = sqlx::query(
            r#"UPDATE scheduled_jobs SET next_run_at = $4
WHERE org = $1 AND next_run_at > $4 AND next_run_at > $2 AND (next_run_at - $2) % $3 = 0;"#,
        )
        .bind(org)
        .bind(deleted_at)
        .bind(park)
        .bind(now)
        .execute(&client)
        .await?;
        Ok(released.rows_affected())
    }

    async fn release_if_org_active(&self, parked: &Trigger, now: i64) -> Result<bool> {
        let client = CLIENT_RW.clone();
        let released = sqlx::query(
            r#"UPDATE scheduled_jobs SET next_run_at = $5
WHERE org = $1 AND module = $2 AND module_key = $3 AND next_run_at = $4
AND EXISTS (SELECT 1 FROM organizations WHERE identifier = $1 AND status = 'active');"#,
        )
        .bind(&parked.org)
        .bind(&parked.module)
        .bind(&parked.module_key)
        .bind(parked.next_run_at)
        .bind(now)
        .execute(&client)
        .await?;
        let emit = |due: Trigger| async move { super::emit_realtime_trigger_event(&due).await };
        Ok(super::finish_release(parked, now, released.rows_affected(), emit).await)
    }

    /// Background job that watches for timeout of a job
    /// Steps:
    /// - Select all the records with status = "Processing"
    /// - calculate the current timestamp and difference from `start_time` of each record
    /// - Get the record ids with difference more than the given timeout
    /// - Update their status back to "Waiting" and increase their "retries" by 1
    async fn watch_timeout(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let now = now_micros();
        sqlx::query(
            r#"UPDATE scheduled_jobs
SET status = $1, retries = retries + 1
WHERE status = $2 AND end_time <= $3;
                "#,
        )
        .bind(TriggerStatus::Waiting)
        .bind(TriggerStatus::Processing)
        .bind(now)
        .execute(&client)
        .await?;
        Ok(())
    }

    async fn watch_timeout_module(&self, module: TriggerModule) -> Result<()> {
        let client = CLIENT_RW.clone();
        sqlx::query(
            r#"UPDATE scheduled_jobs
SET status = $1, retries = retries + 1
WHERE status = $2 AND end_time <= $3 AND module = $4;
                "#,
        )
        .bind(TriggerStatus::Waiting)
        .bind(TriggerStatus::Processing)
        .bind(now_micros())
        .bind(module)
        .execute(&client)
        .await?;
        Ok(())
    }

    async fn len(&self) -> usize {
        let pool = CLIENT_RO.clone();
        let ret = match sqlx::query(
            r#"
SELECT COUNT(*) as num FROM scheduled_jobs;"#,
        )
        .fetch_one(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[SQLITE] triggers len error: {e}");
                return 0;
            }
        };
        match ret.try_get::<i64, &str>("num") {
            Ok(v) => v as usize,
            _ => 0,
        }
    }

    async fn is_empty(&self) -> bool {
        self.len().await == 0
    }

    async fn clear(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        match sqlx::query(r#"DELETE FROM scheduled_jobs;"#)
            .execute(&client)
            .await
        {
            Ok(_) => log::info!("[SCHEDULER] scheduled_jobs table cleared"),
            Err(e) => log::error!("[SQLITE] error clearing scheduled_jobs table: {e}"),
        }

        Ok(())
    }
}

fn scheduler_write_pool() -> sqlx::SqlitePool {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(Some(pool)) = super::with_test_db(|pool| match pool {
        super::TestPool::Sqlite(pool) => Some(pool.clone()),
        _ => None,
    }) {
        return pool;
    }
    CLIENT_RW.clone()
}

fn scheduler_read_pool() -> sqlx::SqlitePool {
    #[cfg(any(test, feature = "test-utils"))]
    if let Some(Some(pool)) = super::with_test_db(|pool| match pool {
        super::TestPool::Sqlite(pool) => Some(pool.clone()),
        _ => None,
    }) {
        return pool;
    }
    CLIENT_RO.clone()
}

#[cfg(test)]
mod tests {

    use config::utils::time::now_micros;
    use sqlx::{Pool, Sqlite};

    use super::{
        ARM_SLACK_SYNC_QUERY, CREATE_TABLE_QUERY, EscalationFinish, FINISH_SLACK_SYNC_QUERY,
        PULL_QUERY_BY_MODULE, SlackSyncFinish, Trigger, TriggerModule, TriggerStatus,
        arm_escalation_in, arm_slack_sync_in, finish_escalation_in, finish_slack_sync_in,
        rename_key_in,
    };
    use crate::{
        scheduler,
        scheduler::{
            escalation_tests::{self as escalation, EscalationDb},
            slack_sync_tests::{self as cases, KEY, ORG, SyncDb},
        },
    };

    struct SqliteDb(Pool<Sqlite>);

    /// The production table plus its unique key, which the arm's upsert needs.
    async fn with_table(pool: Pool<Sqlite>) -> Pool<Sqlite> {
        sqlx::query(CREATE_TABLE_QUERY)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE UNIQUE INDEX scheduled_jobs_org_module_key_idx \
             ON scheduled_jobs (org, module, module_key)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    impl EscalationDb for SqliteDb {
        async fn write_data(&self, data: &str) {
            <Self as SyncDb>::set_data(self, data).await;
        }

        async fn fresh_table() -> Option<Self> {
            <Self as SyncDb>::fresh().await
        }

        async fn arm_at(&self, at: i64, data: &str) {
            arm_escalation_in(&self.0, ORG, KEY, at, data)
                .await
                .unwrap();
        }

        async fn finish_at(&self, claim: &Trigger, next_run_at: Option<i64>) -> EscalationFinish {
            finish_escalation_in(&self.0, claim, next_run_at)
                .await
                .unwrap()
        }

        async fn claim_due(&self, now: i64) -> Vec<Trigger> {
            sqlx::query_as::<_, Trigger>(PULL_QUERY_BY_MODULE)
                .bind(TriggerStatus::Processing)
                .bind(now)
                .bind(TriggerModule::Report)
                .bind(now + 90_000_000)
                .bind(now + 90_000_000)
                .bind(TriggerStatus::Waiting)
                .bind(now)
                .bind(true)
                .bind(false)
                .bind(TriggerModule::OncallEscalation)
                .bind(10_i64)
                .fetch_all(&self.0)
                .await
                .unwrap()
        }

        async fn force(&self, status: TriggerStatus, next_run_at: i64) {
            sqlx::query(
                "UPDATE scheduled_jobs SET status = $1, next_run_at = $2 WHERE module = $3",
            )
            .bind(status)
            .bind(next_run_at)
            .bind(TriggerModule::OncallEscalation)
            .execute(&self.0)
            .await
            .unwrap();
        }

        async fn escalation_row(&self) -> Option<(Trigger, Option<i64>)> {
            let row = sqlx::query_as::<_, Trigger>(
                "SELECT * FROM scheduled_jobs WHERE module_key = $1 AND module = $2",
            )
            .bind(KEY)
            .bind(TriggerModule::OncallEscalation)
            .fetch_optional(&self.0)
            .await
            .unwrap()?;
            let armed: (Option<i64>,) = sqlx::query_as(
                "SELECT armed_for FROM scheduled_jobs WHERE module_key = $1 AND module = $2",
            )
            .bind(KEY)
            .bind(TriggerModule::OncallEscalation)
            .fetch_one(&self.0)
            .await
            .unwrap();
            Some((row, armed.0))
        }
    }

    impl SyncDb for SqliteDb {
        async fn rename(&self, module: TriggerModule, key: &str, new_key: &str) -> bool {
            rename_key_in(&self.0, ORG, module, key, new_key)
                .await
                .unwrap()
                .is_some()
        }

        async fn row_at(&self, module: TriggerModule, key: &str) -> Option<Trigger> {
            sqlx::query_as::<_, Trigger>(
                "SELECT * FROM scheduled_jobs WHERE module_key = $1 AND module = $2",
            )
            .bind(key)
            .bind(module)
            .fetch_optional(&self.0)
            .await
            .unwrap()
        }

        async fn set_data(&self, data: &str) {
            sqlx::query("UPDATE scheduled_jobs SET data = $1")
                .bind(data)
                .execute(&self.0)
                .await
                .unwrap();
        }

        async fn fresh() -> Option<Self> {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            Some(Self(with_table(pool).await))
        }

        async fn arm(&self, t: i64) {
            arm_slack_sync_in(&self.0, ORG, KEY, t).await.unwrap();
        }

        async fn finish(&self, claim: &Trigger, finish: &SlackSyncFinish) -> bool {
            finish_slack_sync_in(&self.0, claim, finish).await.unwrap()
        }

        async fn claim(&self, now: i64) -> Vec<Trigger> {
            sqlx::query_as::<_, Trigger>(PULL_QUERY_BY_MODULE)
                .bind(TriggerStatus::Processing)
                .bind(now)
                .bind(TriggerModule::Report)
                .bind(now + 90_000_000)
                .bind(now + 90_000_000)
                .bind(TriggerStatus::Waiting)
                .bind(now)
                .bind(true)
                .bind(false)
                .bind(TriggerModule::OncallSlackSync)
                .bind(10_i64)
                .fetch_all(&self.0)
                .await
                .unwrap()
        }

        async fn set(&self, status: TriggerStatus, next_run_at: i64) {
            sqlx::query(
                "UPDATE scheduled_jobs SET status = $1, next_run_at = $2 WHERE module = $3",
            )
            .bind(status)
            .bind(next_run_at)
            .bind(TriggerModule::OncallSlackSync)
            .execute(&self.0)
            .await
            .unwrap();
        }

        async fn row_of(&self, module: TriggerModule) -> (Trigger, Option<i64>) {
            let row = sqlx::query_as::<_, Trigger>(
                "SELECT * FROM scheduled_jobs WHERE module_key = $1 AND module = $2",
            )
            .bind(KEY)
            .bind(module.clone())
            .fetch_one(&self.0)
            .await
            .unwrap();
            let armed: (Option<i64>,) = sqlx::query_as(
                "SELECT armed_for FROM scheduled_jobs WHERE module_key = $1 AND module = $2",
            )
            .bind(KEY)
            .bind(module)
            .fetch_one(&self.0)
            .await
            .unwrap();
            (row, armed.0)
        }

        async fn insert(&self, module: TriggerModule, next_run_at: i64) {
            sqlx::query(
                "INSERT INTO scheduled_jobs (org, module, module_key, status, retries, next_run_at, data) \
                 VALUES ($1, $2, $3, $4, 0, $5, '')",
            )
            .bind(ORG)
            .bind(module)
            .bind(KEY)
            .bind(TriggerStatus::Waiting)
            .bind(next_run_at)
            .execute(&self.0)
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn an_escalation_arm_keeps_a_running_ticks_claim() {
        escalation::an_escalation_arm_keeps_a_running_ticks_claim::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn a_finish_requeues_at_the_tick_or_an_earlier_arm() {
        escalation::a_finish_requeues_at_the_tick_or_an_earlier_arm::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn fenced_finish_keeps_armed_for() {
        escalation::fenced_finish_keeps_armed_for::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn a_finish_of_a_lost_claim_writes_nothing() {
        escalation::a_finish_of_a_lost_claim_writes_nothing::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn an_arm_between_the_finish_statements_still_requeues() {
        escalation::an_arm_between_the_finish_statements_still_requeues::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn an_arm_keeps_a_budget_the_tick_wrote_after_its_read() {
        escalation::an_arm_keeps_a_budget_the_tick_wrote_after_its_read::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn a_rename_moves_only_a_waiting_row() {
        cases::a_rename_moves_only_a_waiting_row::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn an_arm_follows_sy2_on_every_row_state() {
        cases::an_arm_follows_sy2_on_every_row_state::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn arms_during_a_pass_keep_the_earliest() {
        cases::arms_during_a_pass_keep_the_earliest::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn a_finish_applies_the_pass_unless_an_arm_came_in() {
        cases::a_finish_applies_the_pass_unless_an_arm_came_in::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn a_finish_of_a_reclaimed_row_changes_nothing() {
        cases::a_finish_of_a_reclaimed_row_changes_nothing::<SqliteDb>().await;
    }

    #[tokio::test]
    async fn another_modules_row_is_untouched() {
        cases::another_modules_row_is_untouched::<SqliteDb>().await;
    }

    /// SY-2: no JSON operator in the sync statements (openobserve AGENTS.md).
    #[test]
    fn the_sync_statements_read_no_json() {
        for q in [ARM_SLACK_SYNC_QUERY, FINISH_SLACK_SYNC_QUERY] {
            for op in ["->", "json", "jsonb"] {
                assert!(!q.contains(op), "{op} in {q}");
            }
        }
    }
    use super::{COMPLETE_CLAIM_QUERY, KEEP_ALIVE_CLAIM_QUERY, PULL_QUERY, SqliteScheduler};

    #[test]
    fn test_sqlite_scheduler_new() {
        let _scheduler = SqliteScheduler::new();
    }

    #[test]
    fn test_sqlite_scheduler_default() {
        let _scheduler = SqliteScheduler::default();
    }

    /// Every timeout watch in here touches all lapsed rows, so the tests that make some take turns.
    static WATCH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn claimed(rows: Vec<Trigger>, org: &str) -> Option<Trigger> {
        rows.into_iter().find(|t| t.org == org)
    }

    #[tokio::test]
    async fn a_hidden_row_is_skipped_by_every_shared_pull_and_taken_by_its_own_lane() {
        let cfg = config::get_config();
        if !(cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite") {
            return;
        }
        std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
        scheduler::init().await.unwrap();
        let _serial = WATCH_LOCK.lock().await;
        let module = TriggerModule::AutoObserve;
        let org = format!("hidden_{}", now_micros());
        let get = || scheduler::get(&org, module.clone(), "engine");
        scheduler::push(Trigger {
            org: org.clone(),
            module: module.clone(),
            module_key: "engine".to_string(),
            next_run_at: 1,
            status: TriggerStatus::Waiting,
            ..Default::default()
        })
        .await
        .unwrap();
        let stored = get().await.unwrap();
        assert_eq!(stored.module, TriggerModule::AutoObserve);
        assert!(stored.is_realtime && !stored.is_silenced);

        // Older releases run this same shared query, so they never decode the row.
        let shared = scheduler::pull(1000, 60, 60, None).await.unwrap();
        assert!(claimed(shared, &org).is_none());
        let first = claimed(
            scheduler::pull(10, 0, 0, Some(module.clone()))
                .await
                .unwrap(),
            &org,
        )
        .expect("the module's own lane takes its row");
        assert_eq!(first.status, TriggerStatus::Processing);

        scheduler::watch_timeout().await.unwrap();
        let second = claimed(
            scheduler::pull(10, 60, 60, Some(module.clone()))
                .await
                .unwrap(),
            &org,
        )
        .expect("an expired lease is claimed again");
        assert_eq!(second.claim_epoch, first.claim_epoch + 1);

        let mut late = first.clone();
        late.status = TriggerStatus::Waiting;
        late.next_run_at = 2;
        assert!(!scheduler::complete_claim(late).await.unwrap());
        let mut done = second.clone();
        done.status = TriggerStatus::Waiting;
        done.next_run_at = 3;
        done.is_realtime = false;
        assert!(scheduler::complete_claim(done).await.unwrap());
        let settled = get().await.unwrap();
        assert_eq!(
            (settled.next_run_at, settled.status),
            (3, TriggerStatus::Waiting)
        );
        assert!(settled.is_realtime, "a settle keeps the row hidden");
        let shared = scheduler::pull(1000, 60, 60, None).await.unwrap();
        assert!(claimed(shared, &org).is_none());
        scheduler::delete(&org, module, "engine").await.unwrap();
    }

    #[tokio::test]
    async fn a_module_timeout_watch_frees_only_that_modules_lapsed_rows() {
        let cfg = config::get_config();
        if !(cfg.common.meta_store.is_empty() || cfg.common.meta_store == "sqlite") {
            return;
        }
        std::fs::create_dir_all(&cfg.common.data_db_dir).unwrap();
        scheduler::init().await.unwrap();
        let _serial = WATCH_LOCK.lock().await;
        let org = format!("watch_module_{}", now_micros());
        let modules = [TriggerModule::AutoObserve, TriggerModule::Report];
        for module in &modules {
            scheduler::push(Trigger {
                org: org.clone(),
                module: module.clone(),
                module_key: "k".to_string(),
                status: TriggerStatus::Processing,
                ..Default::default()
            })
            .await
            .unwrap();
        }
        scheduler::watch_timeout_module(TriggerModule::AutoObserve)
            .await
            .unwrap();
        let mut after = Vec::new();
        for module in &modules {
            let t = scheduler::get(&org, module.clone(), "k").await.unwrap();
            after.push((t.status, t.retries));
            scheduler::delete(&org, module.clone(), "k").await.unwrap();
        }
        assert_eq!(
            after,
            vec![(TriggerStatus::Waiting, 1), (TriggerStatus::Processing, 0)]
        );
    }

    #[test]
    fn sqlite_claim_epoch_is_created_incremented_and_returned_by_claim() {
        assert!(PULL_QUERY.contains("claim_epoch = claim_epoch + 1"));
        assert!(PULL_QUERY.contains("RETURNING"));
    }

    #[test]
    fn sqlite_composite_keepalive_and_completion_are_epoch_fenced() {
        for (operation, query) in [
            ("keep alive", KEEP_ALIVE_CLAIM_QUERY),
            ("completion", COMPLETE_CLAIM_QUERY),
        ] {
            let compact = query.split_whitespace().collect::<Vec<_>>().join(" ");
            assert!(
                compact.contains("id = $"),
                "{operation} must match the job ID"
            );
            assert!(
                compact.contains("claim_epoch = $"),
                "{operation} must match the captured epoch"
            );
            assert!(
                compact.contains("status = $"),
                "{operation} must require Processing status"
            );
        }
    }
}
