// Copyright 2023 Zinc Labs Inc.
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

use chrono::{Duration, Utc};

use crate::{db::postgres::CLIENT, errors::Result};

pub enum TriggerStatus {
    Waiting,
    Processing,
    Completed,
}

pub enum TriggerModule {
    Report,
    Alert,
}

pub struct Trigger {
    pub org: String,
    pub module: TriggerModule,
    pub key: String,
    pub next_run_at: i64,
    pub is_real_time: bool,
    pub is_silenced: bool,
    pub status: TriggerStatus,
    pub start_time: i64,
    pub retries: u8,
}

/// Creates the Scheduled Jobs table
pub async fn create_table() -> Result<()> {
    let pool = CLIENT.clone();
    sqlx::query(
        r#"
CREATE TABLE IF NOT EXISTS scheduled_jobs
(
    id           BIGINT GENERATED ALWAYS AS IDENTITY,
    org          VARCHAR(100) not null,
    module       VARCHAR(100) not null
    key          VARCHAR(256) not null,
    is_realtime  BOOLEAN,
    is_silenced  BOOLEAN,
    status       ENUM('Waiting', 'InProcess', 'Completed') DEFAULT 'Waiting',
    start_time   TIMESTAMP,
    retries      INT,
    next_run_at  TIMESTAMP,
    createdAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
        "#,
    )
    .execute(&pool)
    .await?;
    Ok(())
}

/// The count of jobs for the given module (Report/Alert etc.)
pub async fn count(module: TriggerModule) -> Result<usize> {
    // let db = db::get_db().await;
    // let key = format!("/triggers/{}", key);
    // let items = db.list_keys(&key).await?;
    Ok(1)
}

/// Pushes a Trigger job into the queue
pub async fn push(trigger: Trigger) -> Result<()> {
    // let db = db::get_db().await;
    let pool = CLIENT.clone();
    let mut tx = pool.begin().await?;

    if let Err(e) = sqlx::query(
        r#"INSERT INTO scheduled_jobs (module, key) VALUES ($1, $2) ON CONFLICT DO NOTHING;"#,
    )
    .bind(&trigger.module)
    .bind(&trigger.key)
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
pub async fn delete(org: &str, module: &str, key: &str) -> Result<()> {
    let sql = format!(
        r#"DELETE FROM scheduled_jobs WHERE org = '{}' AND module = '{}' AND key = '{}';"#,
        org, module, key
    );

    let pool = CLIENT.clone();
    sqlx::query(&sql).execute(&pool).await?;
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
pub async fn pull(concurrency: u32) -> Result<Vec<Trigger>> {
    let pool = CLIENT.clone();

    Ok(vec![])
}

/// Background job that frequently (30 secs interval) cleans "Completed" jobs or jobs with
/// retries >= threshold set through environment
pub(crate) async fn clean_complete() -> Result<()> {
    Ok(())
}

/// Background job that watches for timeout of a job
/// Steps:
/// - Select all the records with status = "Processing"
/// - calculate the current timestamp and difference from `start_time` of each record
/// - Get the record ids with difference more than the given timeout
/// - Update their status back to "Waiting" and increase their "retries" by 1
/// Need suggestion: Can it be optimized more? how to handle the case where
/// it genuinely takes more than the timeout period to process the trigger?
pub(crate) async fn watch_timeout(timeout: i64) -> Result<()> {
    Ok(())
}
