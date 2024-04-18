// Copyright 2024 Zinc Labs Inc.
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
use config::CONFIG;
use sqlx::Row;
use tokio::time;

use super::{Trigger, TriggerModule, TriggerStatus};
use crate::{db::postgres::CLIENT, errors::Result};

pub struct PostgresScheduler {}

impl PostgresScheduler {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for PostgresScheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::Scheduler for PostgresScheduler {
    /// Creates the Scheduled Jobs table
    async fn create_table(&self) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(
            r#"
CREATE TABLE IF NOT EXISTS scheduled_jobs
(
    id           BIGINT GENERATED ALWAYS AS IDENTITY,
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
    created_at   TIMESTAMP default CURRENT_TIMESTAMP
);
            "#,
        )
        .execute(&pool)
        .await?;
        Ok(())
    }

    async fn create_table_index(&self) -> Result<()> {
        let pool = CLIENT.clone();

        let queries = vec![
            "CREATE INDEX IF NOT EXISTS scheduled_jobs_key_idx on scheduled_jobs (module_key);",
            "CREATE INDEX IF NOT EXISTS scheduled_jobs_org_key_idx on scheduled_jobs (org, module_key);",
            "CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_org_module_key_idx on scheduled_jobs (org, module, module_key);",
        ];

        for query in queries {
            if let Err(e) = sqlx::query(query).execute(&pool).await {
                log::error!("[POSTGRES] create table scheduled_jobs index error: {}", e);
                return Err(e.into());
            }
        }
        Ok(())
    }

    /// The count of jobs for the given module (Report/Alert etc.)
    async fn len_module(&self, module: TriggerModule) -> usize {
        let pool = CLIENT.clone();
        let ret = match sqlx::query(
            r#"
SELECT COUNT(*)::BIGINT AS num FROM scheduled_jobs WHERE module = $1;"#,
        )
        .bind(module)
        .fetch_one(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[POSTGRES] triggers len error: {}", e);
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
        // let db = db::get_db().await;
        let pool = CLIENT.clone();
        let mut tx = pool.begin().await?;

        if let Err(e) = sqlx::query(
            r#"
INSERT INTO scheduled_jobs (org, module, module_key, is_realtime, is_silenced, status, retries, next_run_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        .execute(&mut *tx)
        .await
        {
            if let Err(e) = tx.rollback().await {
                log::error!("[POSTGRES] rollback push scheduled_jobs error: {}", e);
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit push scheduled_jobs error: {}", e);
            return Err(e.into());
        }
        Ok(())
    }

    /// Deletes the Trigger job matching the given parameters
    async fn delete(&self, org: &str, module: TriggerModule, key: &str) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(
            r#"DELETE FROM scheduled_jobs WHERE org = $1 AND module_key = $2 AND module = $3;"#,
        )
        .bind(org)
        .bind(key)
        .bind(module)
        .execute(&pool)
        .await?;
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
    ) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(
            r#"UPDATE scheduled_jobs SET status = $1, retries = $2 WHERE org = $3 AND module_key = $4 AND module = $5;"#
        )
        .bind(status)
        .bind(retries)
        .bind(org)
        .bind(key)
        .bind(module)
        .execute(&pool).await?;
        Ok(())
    }

    async fn update_trigger(&self, trigger: Trigger) -> Result<()> {
        let pool = CLIENT.clone();
        sqlx::query(
            r#"UPDATE scheduled_jobs
SET status = $1, retries = $2, next_run_at = $3, is_realtime = $4, is_silenced = $5
WHERE org = $6 AND module_key = $7 AND module = $8;"#,
        )
        .bind(trigger.status)
        .bind(trigger.retries)
        .bind(trigger.next_run_at)
        .bind(trigger.is_realtime)
        .bind(trigger.is_silenced)
        .bind(trigger.org)
        .bind(trigger.module_key)
        .bind(trigger.module)
        .execute(&pool)
        .await?;
        Ok(())
    }

    /// Returns the Trigger jobs with "Waiting" status.
    /// Steps:
    /// - Read the records with status "Waiting", oldest createdAt, next_run_at <= now and limit =
    ///   `concurrency`
    /// - Skip locked rows and lock the read rows with "FOR UPDATE SKIP LOCKED"
    /// - Changes their statuses from "Waiting" to "Processing"
    /// - Commits as a single transaction
    /// - Returns the Trigger jobs
    async fn pull(
        &self,
        concurrency: i64,
        alert_timeout: i64,
        report_timeout: i64,
    ) -> Result<Vec<Trigger>> {
        let pool = CLIENT.clone();

        let now = chrono::Utc::now().timestamp_micros();
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
        let query = r#"UPDATE scheduled_jobs
SET status = $1, start_time = $2,
    end_time = CASE
        WHEN module = $3 THEN $4
        ELSE $5
    END
WHERE id IN (
    SELECT id
    FROM scheduled_jobs
    WHERE status = $6 AND next_run_at <= $7 AND retries < $8 AND NOT (is_realtime = $9 AND is_silenced = $10)
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT $11
)
RETURNING *;"#;

        let jobs: Vec<Trigger> = sqlx::query_as::<_, Trigger>(query)
            .bind(TriggerStatus::Processing)
            .bind(now)
            .bind(TriggerModule::Alert)
            .bind(alert_max_time)
            .bind(report_max_time)
            .bind(TriggerStatus::Waiting)
            .bind(now)
            .bind(CONFIG.limit.scheduler_max_retries)
            .bind(true)
            .bind(false)
            .bind(concurrency)
            .fetch_all(&pool)
            .await?;
        Ok(jobs)
    }

    async fn list(&self) -> Result<Vec<Trigger>> {
        let pool = CLIENT.clone();
        let query = r#"SELECT * FROM scheduled_jobs ORDER BY id;"#;
        let jobs: Vec<Trigger> = sqlx::query_as::<_, Trigger>(query).fetch_all(&pool).await?;
        Ok(jobs)
    }

    /// Background job that frequently (30 secs interval) cleans "Completed" jobs or jobs with
    /// retries >= threshold set through environment
    async fn clean_complete(&self, interval: u64) {
        let mut interval = time::interval(time::Duration::from_secs(interval));
        let pool = CLIENT.clone();
        interval.tick().await; // trigger the first run
        loop {
            interval.tick().await;
            let res =
                sqlx::query(r#"DELETE FROM scheduled_jobs WHERE status = $1 OR retries >= $2;"#)
                    .bind(TriggerStatus::Completed)
                    .bind(CONFIG.limit.scheduler_max_retries)
                    .execute(&pool)
                    .await;

            if res.is_err() {
                log::error!(
                    "[POSTGRES] error cleaning up completed and dead scheduled_jobs: {}",
                    res.err().unwrap()
                );
            } else {
                log::debug!("[SCHEDULER] clean up complete");
            }
        }
    }

    /// Background job that watches for timeout of a job
    /// Steps:
    /// - Select all the records with status = "Processing"
    /// - calculate the current timestamp and difference from `start_time` of each record
    /// - Get the record ids with difference more than the given timeout
    /// - Update their status back to "Waiting" and increase their "retries" by 1
    async fn watch_timeout(&self, interval: u64) {
        let mut interval = time::interval(time::Duration::from_secs(interval));
        let pool = CLIENT.clone();
        interval.tick().await; // trigger the first run
        loop {
            interval.tick().await;
            let now = chrono::Utc::now().timestamp_micros();
            let res = sqlx::query(
                r#"UPDATE scheduled_jobs
SET status = $1, retries = retries + 1
WHERE status = $2 AND end_time <= $3;
                "#,
            )
            .bind(TriggerStatus::Waiting)
            .bind(TriggerStatus::Processing)
            .bind(now)
            .execute(&pool)
            .await;

            if res.is_err() {
                log::error!(
                    "[SCHEDULER] error during watching timeout jobs: {}",
                    res.err().unwrap()
                );
            } else {
                log::debug!("[SCHEDULER] watching timeout jobs run complete");
            }
        }
    }

    async fn len(&self) -> usize {
        let pool = CLIENT.clone();
        let ret = match sqlx::query(
            r#"
SELECT COUNT(*)::BIGINT AS num FROM scheduled_jobs;"#,
        )
        .fetch_one(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[POSTGRES] triggers len error: {}", e);
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
        let pool = CLIENT.clone();
        match sqlx::query(r#"DELETE FROM scheduled_jobs;"#)
            .execute(&pool)
            .await
        {
            Ok(_) => log::info!("[SCHEDULER] scheduled_jobs table cleared"),
            Err(e) => log::error!("[POSTGRES] error clearing scheduled_jobs table: {}", e),
        }

        Ok(())
    }
}
