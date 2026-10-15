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
use config::{
    meta::triggers::{OncallSlackSyncData, SlackSyncFinish},
    utils::{json, time::now_micros},
};
use sqlx::{Pool, Row, Sqlite};

use super::{TRIGGERS_KEY, Trigger, TriggerModule, TriggerStatus, get_scheduler_max_retries};
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

// SY-2 arm: insert, or pull a waiting row earlier, or re-wait a completed one, never before
// `not_before`; a row held by a pass only counts the arm.
const ARM_SLACK_SYNC_QUERY: &str = r#"INSERT INTO scheduled_jobs
    (org, module, module_key, is_realtime, is_silenced, status, retries, next_run_at, start_time, end_time, data)
VALUES ($1, $2, $3, false, false, $4, 0, $5, 0, 0, $6)
ON CONFLICT (org, module, module_key) DO UPDATE SET
    next_run_at = CASE scheduled_jobs.status
        WHEN $4 THEN MAX(MIN(scheduled_jobs.next_run_at, excluded.next_run_at),
            COALESCE(json_extract(scheduled_jobs.data, '$.not_before'), 0))
        WHEN $7 THEN MAX(excluded.next_run_at,
            COALESCE(json_extract(scheduled_jobs.data, '$.not_before'), 0))
        ELSE scheduled_jobs.next_run_at END,
    data = CASE WHEN scheduled_jobs.status = $8
        THEN json_set(scheduled_jobs.data, '$.armed_during_pass',
            COALESCE(json_extract(scheduled_jobs.data, '$.armed_during_pass'), 0) + 1)
        ELSE scheduled_jobs.data END,
    status = CASE WHEN scheduled_jobs.status = $7 THEN $4 ELSE scheduled_jobs.status END;"#;

// SY-2 finish: the pass's outcome if no arm came in, else wait again at max(now, not_before);
// either way the pass's attempt and backoff are kept and the arm counter is not reset.
const FINISH_SLACK_SYNC_QUERY: &str = r#"UPDATE scheduled_jobs SET
    status = CASE WHEN COALESCE(json_extract(data, '$.armed_during_pass'), 0) = $1
        THEN $2 ELSE $3 END,
    next_run_at = CASE WHEN COALESCE(json_extract(data, '$.armed_during_pass'), 0) = $1
        THEN $4 ELSE MAX($5, $6) END,
    retries = 0,
    data = json_set($7, '$.armed_during_pass',
        COALESCE(json_extract(data, '$.armed_during_pass'), 0))
WHERE id = $8 AND claim_epoch = $9 AND status = $10;"#;

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
        sqlx::query(
            r#"
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
    claim_epoch  BIGINT default 0 not null
);
            "#,
        )
        .execute(&client)
        .await?;

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
        let client = CLIENT_RW.clone();
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
        let client = CLIENT_RW.clone();
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
        let client = CLIENT_RW.clone();
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

    async fn complete_claim(&self, trigger: Trigger) -> Result<bool> {
        let client = CLIENT_RW.clone();
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

    async fn arm_slack_sync(&self, org: &str, response_id: &str, at: i64) -> Result<()> {
        arm_slack_sync_in(&CLIENT_RW.clone(), org, response_id, at).await
    }

    async fn finish_slack_sync(
        &self,
        claim: &Trigger,
        read_armed: i64,
        finish: SlackSyncFinish,
        data: &OncallSlackSyncData,
        now: i64,
    ) -> Result<bool> {
        finish_slack_sync_in(&CLIENT_RW.clone(), claim, read_armed, finish, data, now).await
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
        let client = CLIENT_RW.clone();

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

        let mut q = sqlx::query_as::<_, Trigger>(query)
            .bind(TriggerStatus::Processing)
            .bind(now)
            .bind(TriggerModule::Report)
            .bind(report_max_time)
            .bind(alert_max_time)
            .bind(TriggerStatus::Waiting)
            .bind(now)
            .bind(true)
            .bind(false);
        if let Some(m) = module {
            q = q.bind(m);
        }
        q = q.bind(concurrency);
        let jobs: Vec<Trigger> = q.fetch_all(&client).await?;
        Ok(jobs)
    }

    async fn get(&self, org: &str, module: TriggerModule, key: &str) -> Result<Trigger> {
        let pool = CLIENT_RO.clone();
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

    /// Background job that frequently (30 secs interval) cleans "Completed" jobs or jobs with
    /// retries >= threshold set through environment
    async fn clean_complete(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let (include_max, mut max_retries) = get_scheduler_max_retries();
        if include_max {
            max_retries += 1;
        }
        // Since alert scheduled_jobs contain last_satisfied_at field, we should not delete them
        sqlx::query(
            r#"DELETE FROM scheduled_jobs WHERE (status = $1 OR retries >= $2) AND module != $3;"#,
        )
        .bind(TriggerStatus::Completed)
        .bind(max_retries)
        .bind(TriggerModule::Alert)
        .execute(&client)
        .await?;
        Ok(())
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

/// Runs the SY-2 arm on `pool`.
async fn arm_slack_sync_in(
    pool: &Pool<Sqlite>,
    org: &str,
    response_id: &str,
    at: i64,
) -> Result<()> {
    sqlx::query(ARM_SLACK_SYNC_QUERY)
        .bind(org)
        .bind(TriggerModule::OncallSlackSync)
        .bind(response_id)
        .bind(TriggerStatus::Waiting)
        .bind(at)
        .bind(json::to_string(&OncallSlackSyncData::default())?)
        .bind(TriggerStatus::Completed)
        .bind(TriggerStatus::Processing)
        .execute(pool)
        .await?;
    Ok(())
}

/// Runs the SY-2 finish on `pool`.
async fn finish_slack_sync_in(
    pool: &Pool<Sqlite>,
    claim: &Trigger,
    read_armed: i64,
    finish: SlackSyncFinish,
    data: &OncallSlackSyncData,
    now: i64,
) -> Result<bool> {
    let (status, next_run_at) = match finish {
        SlackSyncFinish::Done => (TriggerStatus::Completed, claim.next_run_at),
        SlackSyncFinish::Retry => (TriggerStatus::Waiting, data.not_before),
    };
    let result = sqlx::query(FINISH_SLACK_SYNC_QUERY)
        .bind(read_armed)
        .bind(status)
        .bind(TriggerStatus::Waiting)
        .bind(next_run_at)
        .bind(now)
        .bind(data.not_before)
        .bind(json::to_string(data)?)
        .bind(claim.id)
        .bind(claim.claim_epoch)
        .bind(TriggerStatus::Processing)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() == 1)
}

#[cfg(test)]
mod tests {
    use config::meta::triggers::{OncallSlackSyncData, SlackSyncFinish};
    use sqlx::{Pool, Sqlite};

    use super::{
        COMPLETE_CLAIM_QUERY, KEEP_ALIVE_CLAIM_QUERY, PULL_QUERY, PULL_QUERY_BY_MODULE,
        SqliteScheduler, Trigger, TriggerModule, TriggerStatus, arm_slack_sync_in,
        finish_slack_sync_in,
    };
    use crate::scheduler::slack_sync_tests::{self as cases, KEY, ORG, SyncDb};

    // One in-memory database with the scheduler table and its unique key; one connection, one db.
    struct SqliteDb(Pool<Sqlite>);

    impl SyncDb for SqliteDb {
        async fn fresh() -> Self {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query(
                "CREATE TABLE scheduled_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, \
                 org VARCHAR(100) NOT NULL, module INT NOT NULL, module_key VARCHAR(256) NOT NULL, \
                 is_realtime BOOLEAN DEFAULT false NOT NULL, is_silenced BOOLEAN DEFAULT false NOT NULL, \
                 status INT NOT NULL, start_time BIGINT, end_time BIGINT, retries INT NOT NULL, \
                 next_run_at BIGINT NOT NULL, data TEXT NOT NULL, claim_epoch BIGINT DEFAULT 0 NOT NULL)",
            )
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
            Self(pool)
        }

        async fn arm(&self, at: i64) {
            arm_slack_sync_in(&self.0, ORG, KEY, at).await.unwrap();
        }

        async fn finish(
            &self,
            claim: &Trigger,
            read_armed: i64,
            finish: SlackSyncFinish,
            data: &OncallSlackSyncData,
            now: i64,
        ) -> bool {
            finish_slack_sync_in(&self.0, claim, read_armed, finish, data, now)
                .await
                .unwrap()
        }

        async fn claim(&self, now: i64) -> Vec<Trigger> {
            sqlx::query_as::<_, Trigger>(PULL_QUERY_BY_MODULE)
                .bind(TriggerStatus::Processing)
                .bind(now)
                .bind(TriggerModule::Report)
                .bind(now + 60_000_000)
                .bind(now + 60_000_000)
                .bind(TriggerStatus::Waiting)
                .bind(now)
                .bind(true)
                .bind(false)
                .bind(TriggerModule::OncallSlackSync)
                .bind(10)
                .fetch_all(&self.0)
                .await
                .unwrap()
        }

        async fn set(&self, status: TriggerStatus, next_run_at: i64, data: &str) {
            sqlx::query("UPDATE scheduled_jobs SET status = $1, next_run_at = $2, data = $3")
                .bind(status)
                .bind(next_run_at)
                .bind(data)
                .execute(&self.0)
                .await
                .unwrap();
        }

        async fn row(&self) -> Trigger {
            sqlx::query_as::<_, Trigger>("SELECT * FROM scheduled_jobs WHERE module_key = $1")
                .bind(KEY)
                .fetch_one(&self.0)
                .await
                .unwrap()
        }
    }

    #[tokio::test]
    async fn an_arm_follows_sy2_on_every_row_state() {
        cases::an_arm_follows_sy2_on_every_row_state::<SqliteDb>().await;
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
    async fn an_arm_mid_pass_gives_exactly_one_more_pass_after_it() {
        cases::an_arm_mid_pass_gives_exactly_one_more_pass_after_it::<SqliteDb>().await;
    }

    #[test]
    fn test_sqlite_scheduler_new() {
        let _scheduler = SqliteScheduler::new();
    }

    #[test]
    fn test_sqlite_scheduler_default() {
        let _scheduler = SqliteScheduler::default();
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
