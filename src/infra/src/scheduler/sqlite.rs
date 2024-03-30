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
use crate::{
    db::sqlite::{CLIENT_RO, CLIENT_RW},
    errors::Result,
};

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
        let client = client.lock().await;
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
    created_at   TIMESTAMP default CURRENT_TIMESTAMP
);
            "#,
        )
        .execute(&*client)
        .await?;
        Ok(())
    }

    async fn create_table_index(&self) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        let queries = vec![
            "CREATE INDEX IF NOT EXISTS scheduled_jobs_key_idx on scheduled_jobs (module_key);",
            "CREATE INDEX IF NOT EXISTS scheduled_jobs_org_key_idx on scheduled_jobs (org, module_key);",
            "CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_org_module_key_idx on scheduled_jobs (org, module, module_key);",
        ];

        for query in queries {
            sqlx::query(query).execute(&*client).await?;
        }
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
                log::error!("[SQLITE] triggers len error: {}", e);
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
        let client = client.lock().await;
        let mut tx = client.begin().await?;

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
                log::error!("[SQLITE] rollback push scheduled_jobs error: {}", e);
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[SQLITE] commit push scheduled_jobs error: {}", e);
            return Err(e.into());
        }
        Ok(())
    }

    /// Deletes the Trigger job matching the given parameters
    async fn delete(&self, org: &str, module: TriggerModule, key: &str) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(
            r#"DELETE FROM scheduled_jobs WHERE org = $1 AND module_key = $2 AND module = $3;"#,
        )
        .bind(org)
        .bind(key)
        .bind(module)
        .execute(&*client)
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
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
        sqlx::query(
            r#"UPDATE scheduled_jobs SET status = $1, retries = $2 WHERE org = $3 AND module_key = $4 AND module = $5;"#
        )
        .bind(status)
        .bind(retries)
        .bind(org)
        .bind(key)
        .bind(module)
        .execute(&*client).await?;
        Ok(())
    }

    async fn update_trigger(&self, trigger: Trigger) -> Result<()> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;
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
        .bind(trigger.module_key.clone())
        .bind(trigger.module)
        .execute(&*client)
        .await?;
        Ok(())
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
    ) -> Result<Vec<Trigger>> {
        let client = CLIENT_RW.clone();
        let client = client.lock().await;

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
            .fetch_all(&*client)
            .await?;
        Ok(jobs)
    }

    /// Background job that frequently (30 secs interval) cleans "Completed" jobs or jobs with
    /// retries >= threshold set through environment
    async fn clean_complete(&self, interval: u64) {
        let mut interval = time::interval(time::Duration::from_secs(interval));
        let client = CLIENT_RW.clone();
        interval.tick().await; // trigger the first run
        loop {
            interval.tick().await;
            let client = client.lock().await;
            let res =
                sqlx::query(r#"DELETE FROM scheduled_jobs WHERE status = $1 OR retries >= $2;"#)
                    .bind(TriggerStatus::Completed)
                    .bind(CONFIG.limit.scheduler_max_retries)
                    .execute(&*client)
                    .await;

            if res.is_err() {
                log::error!(
                    "[SQLITE] error cleaning up completed and dead scheduled_jobs: {}",
                    res.err().unwrap()
                );
            } else {
                log::debug!("[JOBS SCHEDULER] clean up complete");
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
        let client = CLIENT_RW.clone();
        interval.tick().await; // trigger the first run
        loop {
            interval.tick().await;
            let client = client.lock().await;
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
            .execute(&*client)
            .await;

            if res.is_err() {
                log::error!(
                    "[SQLITE] error during watching for timeout for dead scheduled_jobs: {}",
                    res.err().unwrap()
                );
            } else {
                log::debug!("[JOBS SCHEDULER] watch timeout run complete");
            }
        }
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
                log::error!("[SQLITE] triggers len error: {}", e);
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
        let client = client.lock().await;
        match sqlx::query(r#"DELETE FROM scheduled_jobs;"#)
            .execute(&*client)
            .await
        {
            Ok(_) => log::info!("[SCHEDULER] scheduled_jobs table cleared"),
            Err(e) => log::error!("[SQLITE] error clearing scheduled_jobs table: {}", e),
        }

        Ok(())
    }
}
