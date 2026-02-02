// Copyright 2025 OpenObserve Inc.
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
use bytes::Bytes;
use chrono::Duration;
use config::{
    metrics::DB_QUERY_NUMS,
    utils::{hash::Sum64, time::now_micros},
};
use sqlx::Row;

use super::{TRIGGERS_KEY, Trigger, TriggerModule, TriggerStatus, get_scheduler_max_retries};
use crate::{
    db::{
        self, IndexStatement,
        postgres::{CLIENT, CLIENT_DDL, CLIENT_RO, add_column, create_index, drop_column},
    },
    errors::{DbError, Error, Result},
};

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
        let pool = CLIENT_DDL.clone();
        DB_QUERY_NUMS
            .with_label_values(&["create", "scheduled_jobs"])
            .inc();
        sqlx::query(
            r#"
CREATE TABLE IF NOT EXISTS scheduled_jobs
(
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    data         TEXT not null
);
            "#,
        )
        .execute(&pool)
        .await?;

        // create data column for old version <= 0.10.9
        add_column("scheduled_jobs", "data", "TEXT NOT NULL DEFAULT ''").await?;

        // drop created_at column for old version <= 0.40.0
        drop_column("scheduled_jobs", "created_at").await?;

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
        DB_QUERY_NUMS
            .with_label_values(&["select", "scheduled_jobs"])
            .inc();
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
                log::error!("[POSTGRES] triggers len error: {e}");
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
        DB_QUERY_NUMS
            .with_label_values(&["insert", "scheduled_jobs"])
            .inc();
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
                log::error!("[POSTGRES] rollback push scheduled_jobs error: {e}");
            }
            return Err(e.into());
        }

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit push scheduled_jobs error: {e}");
            return Err(e.into());
        }

        // For now, only send realtime alert triggers
        if trigger.module == TriggerModule::Alert && trigger.is_realtime {
            let key = format!(
                "{TRIGGERS_KEY}{}/{}/{}",
                trigger.module, &trigger.org, &trigger.module_key
            );
            let cluster_coordinator = db::get_coordinator().await;
            cluster_coordinator
                .put(&key, Bytes::from(""), true, None)
                .await?;
        }
        Ok(())
    }

    /// Deletes the Trigger job matching the given parameters
    async fn delete(&self, org: &str, module: TriggerModule, key: &str) -> Result<()> {
        let pool = CLIENT.clone();
        log::debug!("Deleting scheduled job for org: {org}, module: {module}, key: {key}",);
        DB_QUERY_NUMS
            .with_label_values(&["delete", "scheduled_jobs"])
            .inc();
        sqlx::query(
            r#"DELETE FROM scheduled_jobs WHERE org = $1 AND module_key = $2 AND module = $3;"#,
        )
        .bind(org)
        .bind(key)
        .bind(&module)
        .execute(&pool)
        .await?;

        // For now, only send alert triggers events
        if module == TriggerModule::Alert {
            // It will send event even if the alert is not realtime alert.
            // But that is okay, for non-realtime alerts, since the triggers are not
            // present in the cache at all, it will just do nothing.
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
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "scheduled_jobs"])
            .inc();
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
            }
            None => {
                sqlx::query(
                    r#"UPDATE scheduled_jobs SET status = $1, retries = $2 WHERE org = $3 AND module_key = $4 AND module = $5;"#,
                )
                .bind(status)
                .bind(retries)
                .bind(org)
                .bind(key)
                .bind(&module)
            }
        };
        query.execute(&pool).await?;

        // For status update of triggers, we don't need to send put events
        // to cluster coordinator for now as it only changes the status and retries
        // fields of scheduled jobs and not anything else
        Ok(())
    }

    async fn update_trigger(&self, trigger: Trigger, clone: bool) -> Result<()> {
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "scheduled_jobs"])
            .inc();
        let query = if clone {
            sqlx::query(
                r#"UPDATE scheduled_jobs
    SET status = $1, start_time = $2, end_time = $3, retries = $4, next_run_at = $5, is_realtime = $6, is_silenced = $7, data = $8
    WHERE org = $9 AND module_key = $10 AND module = $11;"#,
            )
            .bind(trigger.status)
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
            .bind(trigger.status)
            .bind(trigger.retries)
            .bind(trigger.next_run_at)
            .bind(trigger.is_realtime)
            .bind(trigger.is_silenced)
            .bind(&trigger.data)
            .bind(&trigger.org)
            .bind(&trigger.module_key)
            .bind(&trigger.module)
        };

        query.execute(&pool).await?;

        // For now, only send realtime alert triggers
        if trigger.module == TriggerModule::Alert && trigger.is_realtime {
            let key = format!(
                "{TRIGGERS_KEY}{}/{}/{}",
                trigger.module, &trigger.org, &trigger.module_key
            );
            let cluster_coordinator = db::get_coordinator().await;
            cluster_coordinator
                .put(&key, Bytes::from(""), true, None)
                .await?;
        }
        Ok(())
    }

    async fn bulk_update_triggers(&self, triggers: Vec<Trigger>) -> Result<()> {
        if triggers.is_empty() {
            return Ok(());
        }

        let pool = CLIENT.clone();

        // Build bulk update query using UNNEST
        let query_builder = String::from(
            r#"UPDATE scheduled_jobs SET
                    status = bulk_data.status,
                    retries = bulk_data.retries,
                    next_run_at = bulk_data.next_run_at,
                    is_realtime = bulk_data.is_realtime,
                    is_silenced = bulk_data.is_silenced,
                    data = bulk_data.data
                FROM (SELECT * FROM UNNEST($1::integer[], $2::text[], $3::text[], $4::integer[], $5::integer[], $6::bigint[], $7::boolean[], $8::boolean[], $9::text[])
                    AS bulk_data(module, org, module_key, status, retries, next_run_at, is_realtime, is_silenced, data)) AS bulk_data
                WHERE scheduled_jobs.module = bulk_data.module
                    AND scheduled_jobs.org = bulk_data.org
                    AND scheduled_jobs.module_key = bulk_data.module_key"#,
        );

        let mut modules = Vec::new();
        let mut orgs = Vec::new();
        let mut module_keys = Vec::new();
        let mut statuses: Vec<TriggerStatus> = Vec::new();
        let mut retries_vec = Vec::new();
        let mut next_run_ats = Vec::new();
        let mut is_realtimes = Vec::new();
        let mut is_silenceds = Vec::new();
        let mut datas = Vec::new();

        for trigger in &triggers {
            modules.push(trigger.module.clone());
            orgs.push(trigger.org.clone());
            module_keys.push(trigger.module_key.clone());
            statuses.push(trigger.status.clone());
            retries_vec.push(trigger.retries);
            next_run_ats.push(trigger.next_run_at);
            is_realtimes.push(trigger.is_realtime);
            is_silenceds.push(trigger.is_silenced);
            datas.push(trigger.data.clone());
        }

        let query = sqlx::query(&query_builder)
            .bind(modules)
            .bind(orgs)
            .bind(module_keys)
            .bind(statuses)
            .bind(retries_vec)
            .bind(next_run_ats)
            .bind(is_realtimes)
            .bind(is_silenceds)
            .bind(datas);

        match query.execute(&pool).await {
            Ok(_) => {
                // Report the metric only after the db op is successful
                DB_QUERY_NUMS
                    .with_label_values(&["bulk_update", "scheduled_jobs"])
                    .inc();
                // Handle cluster coordinator for realtime alerts
                for trigger in &triggers {
                    if trigger.module == TriggerModule::Alert && trigger.is_realtime {
                        let key = format!(
                            "{TRIGGERS_KEY}{}/{}/{}",
                            trigger.module, &trigger.org, &trigger.module_key
                        );
                        let cluster_coordinator = db::get_coordinator().await;
                        if let Err(e) = cluster_coordinator
                            .put(&key, Bytes::from(""), true, None)
                            .await
                        {
                            log::error!(
                                "Error updating cluster coordinator for trigger {}: {}",
                                key,
                                e
                            );
                        }
                    }
                }
                Ok(())
            }
            Err(e) => {
                log::warn!(
                    "Bulk update failed, falling back to individual updates: {}",
                    e
                );
                // Fallback to individual updates
                for trigger in triggers {
                    self.update_trigger(trigger, false).await?;
                }
                Ok(())
            }
        }
    }

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
    ) -> Result<()> {
        if updates.is_empty() {
            return Ok(());
        }

        let pool = CLIENT.clone();

        // Separate updates with and without data
        let mut updates_with_data = Vec::new();
        let mut updates_without_data = Vec::new();

        for update in updates {
            if update.5.is_some() {
                updates_with_data.push(update);
            } else {
                updates_without_data.push(update);
            }
        }

        // Handle updates with data
        if !updates_with_data.is_empty() {
            let mut orgs = Vec::new();
            let mut modules = Vec::new();
            let mut module_keys = Vec::new();
            let mut statuses = Vec::new();
            let mut retries_vec = Vec::new();
            let mut datas = Vec::new();

            for (org, module, module_key, status, retries, data) in &updates_with_data {
                orgs.push(org.clone());
                modules.push(module.clone());
                module_keys.push(module_key.clone());
                statuses.push(status.clone());
                retries_vec.push(*retries);
                datas.push(data.as_ref().unwrap().clone());
            }

            let query = sqlx::query(
                r#"UPDATE scheduled_jobs SET
                    status = bulk_data.status,
                    retries = bulk_data.retries,
                    data = bulk_data.data
                FROM (SELECT * FROM UNNEST($1::text[], $2::integer[], $3::text[], $4::integer[], $5::integer[], $6::text[])
                    AS bulk_data(org, module, module_key, status, retries, data)) AS bulk_data
                WHERE scheduled_jobs.org = bulk_data.org
                    AND scheduled_jobs.module = bulk_data.module
                    AND scheduled_jobs.module_key = bulk_data.module_key"#,
            )
            .bind(orgs)
            .bind(modules)
            .bind(module_keys)
            .bind(statuses)
            .bind(retries_vec)
            .bind(datas);

            if let Err(e) = query.execute(&pool).await {
                log::warn!(
                    "Bulk status update with data failed, falling back to individual updates: {}",
                    e
                );
                for (org, module, module_key, status, retries, data) in updates_with_data {
                    self.update_status(&org, module, &module_key, status, retries, data.as_deref())
                        .await?;
                }
            } else {
                DB_QUERY_NUMS
                    .with_label_values(&["bulk_update_status", "scheduled_jobs"])
                    .inc();
            }
        }

        // Handle updates without data
        if !updates_without_data.is_empty() {
            let mut orgs = Vec::new();
            let mut modules = Vec::new();
            let mut module_keys = Vec::new();
            let mut statuses: Vec<TriggerStatus> = Vec::new();
            let mut retries_vec = Vec::new();

            for (org, module, module_key, status, retries, _) in &updates_without_data {
                orgs.push(org.clone());
                modules.push(module.clone());
                module_keys.push(module_key.clone());
                statuses.push(status.clone());
                retries_vec.push(*retries);
            }

            let query = sqlx::query(
                r#"UPDATE scheduled_jobs SET
                    status = bulk_data.status,
                    retries = bulk_data.retries
                FROM (SELECT * FROM UNNEST($1::text[], $2::integer[], $3::text[], $4::integer[], $5::integer[])
                    AS bulk_data(org, module, module_key, status, retries)) AS bulk_data
                WHERE scheduled_jobs.org = bulk_data.org
                    AND scheduled_jobs.module = bulk_data.module
                    AND scheduled_jobs.module_key = bulk_data.module_key"#,
            )
            .bind(orgs)
            .bind(modules)
            .bind(module_keys)
            .bind(statuses)
            .bind(retries_vec);

            if let Err(e) = query.execute(&pool).await {
                log::warn!(
                    "Bulk status update without data failed, falling back to individual updates: {}",
                    e
                );
                for (org, module, module_key, status, retries, data) in updates_without_data {
                    self.update_status(&org, module, &module_key, status, retries, data.as_deref())
                        .await?;
                }
            } else {
                DB_QUERY_NUMS
                    .with_label_values(&["bulk_update_status", "scheduled_jobs"])
                    .inc();
            }
        }

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
        let pool = CLIENT.clone();
        sqlx::query(&sql)
            .bind(TriggerModule::Report)
            .bind(report_max_time)
            .bind(alert_max_time)
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
        let query = r#"UPDATE scheduled_jobs
SET status = $1, start_time = $2,
    end_time = CASE
        WHEN module = $3 THEN $4
        ELSE $5
    END
WHERE id IN (
    SELECT id
    FROM scheduled_jobs
    WHERE status = $6 AND next_run_at <= $7 AND NOT (is_realtime = $8 AND is_silenced = $9)
    ORDER BY next_run_at
    LIMIT $10
)
RETURNING *;"#;

        let mut tx = pool.begin().await?;

        // Lock the table for the duration of the transaction
        let lock_key = "scheduler_pull_lock";
        let lock_id = config::utils::hash::gxhash::new().sum64(lock_key);
        let lock_id = if lock_id > i64::MAX as u64 {
            (lock_id >> 1) as i64
        } else {
            lock_id as i64
        };
        let lock_sql = format!("SELECT pg_advisory_xact_lock({lock_id})");
        DB_QUERY_NUMS
            .with_label_values(&["get_lock", "scheduled_jobs"])
            .inc();
        if let Err(e) = sqlx::query(&lock_sql).execute(&mut *tx).await {
            if let Err(e) = tx.rollback().await {
                log::error!("[SCHEDULER] rollback pull scheduled_jobs error: {e}");
            }
            return Err(e.into());
        }

        DB_QUERY_NUMS
            .with_label_values(&["update", "scheduled_jobs"])
            .inc();
        let jobs: Vec<Trigger> = match sqlx::query_as::<_, Trigger>(query)
            .bind(TriggerStatus::Processing)
            .bind(now)
            .bind(TriggerModule::Report)
            .bind(report_max_time)
            .bind(alert_max_time)
            .bind(TriggerStatus::Waiting)
            .bind(now)
            .bind(true)
            .bind(false)
            .bind(concurrency)
            .fetch_all(&mut *tx)
            .await
        {
            Ok(jobs) => jobs,
            Err(e) => {
                if let Err(e) = tx.rollback().await {
                    log::error!("[POSTGRES] rollback pull scheduled_jobs error: {e}");
                }
                return Err(e.into());
            }
        };

        if let Err(e) = tx.commit().await {
            log::error!("[POSTGRES] commit pull scheduled_jobs error: {e}");
            return Err(e.into());
        }
        Ok(jobs)
    }

    async fn get(&self, org: &str, module: TriggerModule, key: &str) -> Result<Trigger> {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "scheduled_jobs"])
            .inc();
        let query = r#"
SELECT * FROM scheduled_jobs
WHERE org = $1 AND module = $2 AND module_key = $3;"#;
        let job = match sqlx::query_as::<_, Trigger>(query)
            .bind(org)
            .bind(&module)
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
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "scheduled_jobs"])
            .inc();
        let jobs: Vec<Trigger> = if let Some(module) = module {
            let query = r#"SELECT * FROM scheduled_jobs WHERE module = $1 ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .bind(module)
                .fetch_all(&pool)
                .await?
        } else {
            let query = r#"SELECT * FROM scheduled_jobs ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query).fetch_all(&pool).await?
        };
        Ok(jobs)
    }

    /// List all the jobs for the given module and organization
    async fn list_by_org(&self, org: &str, module: Option<TriggerModule>) -> Result<Vec<Trigger>> {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "scheduled_jobs"])
            .inc();
        let jobs: Vec<Trigger> = if let Some(module) = module {
            let query =
                r#"SELECT * FROM scheduled_jobs WHERE org = $1 AND module = $2 ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .bind(org)
                .bind(module)
                .fetch_all(&pool)
                .await?
        } else {
            let query = r#"SELECT * FROM scheduled_jobs WHERE org = $1 ORDER BY id;"#;
            sqlx::query_as::<_, Trigger>(query)
                .bind(org)
                .fetch_all(&pool)
                .await?
        };
        Ok(jobs)
    }

    /// Background job that frequently (30 secs interval) cleans "Completed" jobs or jobs with
    /// retries >= threshold set through environment
    async fn clean_complete(&self) -> Result<()> {
        let pool = CLIENT.clone();
        log::debug!("[SCHEDULER] cleaning completed jobs");
        let (include_max, mut max_retries) = get_scheduler_max_retries();
        if include_max {
            max_retries += 1;
        }
        DB_QUERY_NUMS
            .with_label_values(&["delete", "scheduled_jobs"])
            .inc();
        // Since alert scheduled_jobs contain last_satisfied_at field, we should not delete them
        sqlx::query(
            r#"DELETE FROM scheduled_jobs WHERE (status = $1 OR retries >= $2) AND module != $3;"#,
        )
        .bind(TriggerStatus::Completed)
        .bind(max_retries)
        .bind(TriggerModule::Alert)
        .execute(&pool)
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
        let pool = CLIENT.clone();
        DB_QUERY_NUMS
            .with_label_values(&["update", "scheduled_jobs"])
            .inc();
        let now = now_micros();
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
        .await?;
        log::debug!(
            "[SCHEDULER] watch_timeout for scheduler updated {} rows",
            res.rows_affected()
        );
        Ok(())
    }

    async fn len(&self) -> usize {
        let pool = CLIENT_RO.clone();
        DB_QUERY_NUMS
            .with_label_values(&["select", "scheduled_jobs"])
            .inc();
        let ret = match sqlx::query(
            r#"
SELECT COUNT(*)::BIGINT AS num FROM scheduled_jobs;"#,
        )
        .fetch_one(&pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("[POSTGRES] triggers len error: {e}");
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
        log::debug!("[SCHEDULER] clearing scheduled_jobs table");
        DB_QUERY_NUMS
            .with_label_values(&["delete", "scheduled_jobs"])
            .inc();
        match sqlx::query(r#"DELETE FROM scheduled_jobs;"#)
            .execute(&pool)
            .await
        {
            Ok(_) => log::info!("[SCHEDULER] scheduled_jobs table cleared"),
            Err(e) => log::error!("[POSTGRES] error clearing scheduled_jobs table: {e}"),
        }

        Ok(())
    }
}
