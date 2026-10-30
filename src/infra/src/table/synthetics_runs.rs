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

//! DB functions for `synthetics_runs`.
//!
//! One `synthetics_runs` row is created per scheduled slot (before jobs are enqueued).
//! Each job acks via `finalize_run`; when `jobs_done = job_count` the run is
//! complete, `completed_at` is set, and the run result reaches the check row.

use sea_orm::{ConnectionTrait, Statement, TransactionTrait, Value};

use super::synthetics_checks;
pub use super::synthetics_checks::StatusStreaks;
use crate::errors;

/// Status page streaks stop growing here, so a steady check stops writing its row.
pub const STREAK_CAP: i32 = 10;
/// How far back the stuck-run sweep looks, in microseconds.
const STUCK_LOOKBACK_US: i64 = 86_400_000_000;
const SWAP_ATTEMPTS: usize = 3;
const STATUS_ERROR: i32 = 4;
// `synthetics_jobs.status` values; a different scale from SyntheticStatus.
const JOB_DEAD: i32 = 2;
const JOB_PASSED: i32 = 3;
const JOB_FAILED: i32 = 4;
const JOB_WARNING: i32 = 5;
const JOB_ERROR: i32 = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

pub struct InsertRunParams<'a> {
    /// Pre-generated KSUID — this becomes the `run_id` referenced by all child jobs.
    pub id: &'a str,
    pub synthetics_id: &'a str,
    pub org_id: &'a str,
    pub scheduled_ts: i64,
    /// "schedule" | "manual"
    pub trigger_type: &'a str,
    /// Total number of jobs that will be enqueued for this run (one per location).
    pub job_count: i32,
    pub created_at: i64,
}

#[derive(Debug)]
pub struct RunRow {
    pub id: String,
    pub synthetics_id: String,
    pub org_id: String,
    pub scheduled_ts: i64,
    pub trigger_type: String,
    pub job_count: i32,
    pub jobs_done: i32,
    /// NULL until first job completes. SyntheticStatus DB integers: 1=Passed, 2=Warning,
    /// 3=Failed, 4=Error. Tracks worst-case across completed jobs.
    pub run_result: Option<i32>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

/// The status page verdict of one completed run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Down,
    Up,
    NoVerdict,
}

/// What the caller that completed a run needs: the run result for alerting, and the check row to
/// publish to the super cluster when it changed.
#[derive(Debug, Clone)]
pub struct RunFinalized {
    pub synthetics_id: String,
    pub org_id: String,
    /// Worst job result on the SyntheticStatus DB scale.
    pub run_result: i32,
    pub job_count: i32,
    pub verdict: Verdict,
    /// `Some` only when the badge or a streak changed.
    pub check_update: Option<StatusStreaks>,
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/// Inserts a new run row. Called by the scheduler before enqueuing child jobs.
pub async fn insert_run<C: ConnectionTrait>(
    conn: &C,
    p: InsertRunParams<'_>,
) -> Result<(), errors::Error> {
    let sql = r#"
        INSERT INTO synthetics_runs
            (id, synthetics_id, org_id, scheduled_ts, trigger_type, job_count, jobs_done,
             run_result, created_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, $7, NULL)
    "#;

    conn.execute(Statement::from_sql_and_values(
        conn.get_database_backend(),
        sql,
        [
            Value::from(p.id),
            Value::from(p.synthetics_id),
            Value::from(p.org_id),
            Value::from(p.scheduled_ts),
            Value::from(p.trigger_type),
            Value::from(p.job_count),
            Value::from(p.created_at),
        ],
    ))
    .await?;
    Ok(())
}

// ── Runs API ──────────────────────────────────────────────────────────────────

pub struct ListRunsParams<'a> {
    pub org_id: &'a str,
    pub synthetics_id: &'a str,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub page: i64,
    pub page_size: i64,
}

/// Lists runs for a check in reverse chronological order, with optional time range filter.
/// Returns (rows, total_count).
pub async fn list_runs<C: ConnectionTrait>(
    conn: &C,
    p: ListRunsParams<'_>,
) -> Result<(Vec<RunRow>, i64), errors::Error> {
    let mut where_parts: Vec<String> =
        vec!["org_id = $1".to_string(), "synthetics_id = $2".to_string()];
    let mut values: Vec<Value> = vec![
        Value::from(p.org_id.to_owned()),
        Value::from(p.synthetics_id.to_owned()),
    ];

    if let Some(start) = p.start_time {
        let n = values.len() + 1;
        where_parts.push(format!("scheduled_ts >= ${n}"));
        values.push(Value::from(start));
    }
    if let Some(end) = p.end_time {
        let n = values.len() + 1;
        where_parts.push(format!("scheduled_ts <= ${n}"));
        values.push(Value::from(end));
    }

    let where_clause = where_parts.join(" AND ");

    // Count
    let count_sql = format!("SELECT COUNT(*) AS total FROM synthetics_runs WHERE {where_clause}");
    let count_rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            &count_sql,
            values.clone(),
        ))
        .await?;
    let total: i64 = count_rows
        .into_iter()
        .next()
        .and_then(|row| row.try_get::<i64>("", "total").ok())
        .unwrap_or(0);

    // Data (paginated, newest first)
    let limit_n = values.len() + 1;
    let offset_n = values.len() + 2;
    let data_sql = format!(
        "SELECT id, synthetics_id, org_id, scheduled_ts, trigger_type, job_count, \
         jobs_done, run_result, created_at, completed_at \
         FROM synthetics_runs \
         WHERE {where_clause} \
         ORDER BY scheduled_ts DESC \
         LIMIT ${limit_n} OFFSET ${offset_n}"
    );
    values.push(Value::from(p.page_size));
    values.push(Value::from(p.page * p.page_size));

    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            &data_sql,
            values,
        ))
        .await?;

    let runs = rows
        .into_iter()
        .map(|row| -> Result<RunRow, sea_orm::DbErr> {
            Ok(RunRow {
                id: row.try_get("", "id")?,
                synthetics_id: row.try_get("", "synthetics_id")?,
                org_id: row.try_get("", "org_id")?,
                scheduled_ts: row.try_get("", "scheduled_ts")?,
                trigger_type: row.try_get("", "trigger_type")?,
                job_count: row.try_get("", "job_count")?,
                jobs_done: row.try_get("", "jobs_done")?,
                run_result: row.try_get("", "run_result")?,
                created_at: row.try_get("", "created_at")?,
                completed_at: row.try_get("", "completed_at")?,
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(errors::Error::from)?;

    Ok((runs, total))
}

// ── Job API ───────────────────────────────────────────────────────────────────

/// Fetches a run by its KSUID.
pub async fn get_run<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
) -> Result<Option<RunRow>, errors::Error> {
    let sql = r#"
        SELECT id, synthetics_id, org_id, scheduled_ts, trigger_type, job_count,
               jobs_done, run_result, created_at, completed_at
        FROM synthetics_runs
        WHERE id = $1
    "#;
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(run_id.to_owned())],
        ))
        .await?;

    rows.into_iter()
        .next()
        .map(|row| -> Result<RunRow, sea_orm::DbErr> {
            Ok(RunRow {
                id: row.try_get("", "id")?,
                synthetics_id: row.try_get("", "synthetics_id")?,
                org_id: row.try_get("", "org_id")?,
                scheduled_ts: row.try_get("", "scheduled_ts")?,
                trigger_type: row.try_get("", "trigger_type")?,
                job_count: row.try_get("", "job_count")?,
                jobs_done: row.try_get("", "jobs_done")?,
                run_result: row.try_get("", "run_result")?,
                created_at: row.try_get("", "created_at")?,
                completed_at: row.try_get("", "completed_at")?,
            })
        })
        .transpose()
        .map_err(errors::Error::from)
}

/// Records one job's outcome and, for the caller whose job completes the run, applies the run's
/// result to the check row. Replaces the old `increment_jobs_done`.
///
/// `job_result` uses SyntheticStatus DB integers: 1=Passed, 2=Warning, 3=Failed, 4=Error.
/// The increment, the `completed_at` claim and the check-row write share one transaction, so a
/// stop between them cannot complete a run whose result never reaches the check row.
/// `completed_at IS NULL` is the compare-and-swap that tells exactly one caller it completed the
/// run.
pub async fn finalize_run<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    run_id: &str,
    job_result: i32,
    now_us: i64,
) -> Result<Option<RunFinalized>, errors::Error> {
    finalize(conn, run_id, Some(job_result), now_us).await
}

/// Finalizes runs whose jobs are all terminal but whose finalization never committed.
///
/// That state is left by a stop between a job's `ack_complete` and its `finalize_run`. Only jobs
/// that completed more than `grace_us` ago count, so an ack still in flight is left alone.
pub async fn finalize_stuck_runs<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    now_us: i64,
    grace_us: i64,
) -> Result<Vec<RunFinalized>, errors::Error> {
    let cutoff = now_us - grace_us;
    let sql = r#"
        SELECT r.id AS id FROM synthetics_runs r
        WHERE r.completed_at IS NULL
          AND r.id IN (
              SELECT j.run_id FROM synthetics_jobs j
              WHERE j.completed_at < $1 AND j.completed_at > $2
          )
          AND NOT EXISTS (
              SELECT 1 FROM synthetics_jobs j2
              WHERE j2.run_id = r.id
                AND (j2.status < 2 OR j2.completed_at IS NULL OR j2.completed_at >= $1)
          )
        LIMIT 100
    "#;
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(cutoff), Value::from(now_us - STUCK_LOOKBACK_US)],
        ))
        .await?;
    let mut done = Vec::new();
    for row in rows {
        let id: String = row.try_get("", "id")?;
        if let Some(f) = finalize(conn, &id, None, now_us).await? {
            done.push(f);
        }
    }
    Ok(done)
}

/// The status page verdict of one run: a majority of `job_count`, where error jobs do not vote.
pub fn run_verdict(job_count: i32, failed: i32, healthy: i32) -> Verdict {
    let quorum = job_count.max(1) / 2 + 1;
    if failed >= quorum {
        Verdict::Down
    } else if healthy >= quorum {
        Verdict::Up
    } else {
        Verdict::NoVerdict
    }
}

/// The check row after a run, or `None` when the run is older than the run the row already holds.
pub fn next_streaks(
    cur: &StatusStreaks,
    run_result: i32,
    verdict: Verdict,
    run_ts: i64,
) -> Option<StatusStreaks> {
    if cur.run_ts >= run_ts {
        return None;
    }
    let (down_runs, up_runs) = match verdict {
        Verdict::Down => ((cur.down_runs + 1).min(STREAK_CAP), 0),
        Verdict::Up => (0, (cur.up_runs + 1).min(STREAK_CAP)),
        Verdict::NoVerdict => (cur.down_runs, cur.up_runs),
    };
    Some(StatusStreaks {
        last_check_status: run_result,
        down_runs,
        up_runs,
        run_ts,
    })
}

async fn finalize<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    run_id: &str,
    job_result: Option<i32>,
    now_us: i64,
) -> Result<Option<RunFinalized>, errors::Error> {
    let txn = conn.begin().await?;
    if !claim_completion(&txn, run_id, job_result, now_us).await? {
        txn.commit().await?;
        return Ok(None);
    }
    let Some(run) = get_run(&txn, run_id).await? else {
        txn.commit().await?;
        return Ok(None);
    };
    let statuses = job_statuses(&txn, run_id).await?;
    let failed = statuses.iter().filter(|s| **s == JOB_FAILED).count() as i32;
    let healthy = statuses
        .iter()
        .filter(|s| **s == JOB_PASSED || **s == JOB_WARNING)
        .count() as i32;
    let verdict = run_verdict(run.job_count, failed, healthy);
    let run_result = run.run_result.or(job_result).unwrap_or(STATUS_ERROR);
    let check_update = write_check_row(
        &txn,
        &run.synthetics_id,
        run_result,
        verdict,
        run.scheduled_ts,
    )
    .await?;
    txn.commit().await?;
    Ok(Some(RunFinalized {
        synthetics_id: run.synthetics_id,
        org_id: run.org_id,
        run_result,
        job_count: run.job_count,
        verdict,
        check_update,
    }))
}

/// Counts the job into the run (when `job_result` is set) and claims `completed_at`.
async fn claim_completion<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
    job_result: Option<i32>,
    now_us: i64,
) -> Result<bool, errors::Error> {
    let backend = conn.get_database_backend();
    let claimed = match job_result {
        Some(result) => {
            // `jobs_done < job_count` stops a duplicate or replayed ack from overshooting the
            // total.
            let increment = r#"
                UPDATE synthetics_runs
                SET
                    jobs_done = jobs_done + 1,
                    run_result = CASE
                        WHEN COALESCE(run_result, 0) >= $1 THEN run_result
                        ELSE $1
                    END
                WHERE id = $2 AND jobs_done < job_count AND completed_at IS NULL
            "#;
            conn.execute(Statement::from_sql_and_values(
                backend,
                increment,
                [Value::from(result), Value::from(run_id.to_owned())],
            ))
            .await?;
            let claim = r#"
                UPDATE synthetics_runs
                SET completed_at = $1
                WHERE id = $2 AND jobs_done >= job_count AND completed_at IS NULL
            "#;
            conn.execute(Statement::from_sql_and_values(
                backend,
                claim,
                [Value::from(now_us), Value::from(run_id.to_owned())],
            ))
            .await?
            .rows_affected()
        }
        None => {
            // The sweep: the increments never committed, so the run result comes from the jobs.
            let worst = job_statuses(conn, run_id)
                .await?
                .into_iter()
                .map(job_to_status)
                .max();
            let claim = r#"
                UPDATE synthetics_runs
                SET jobs_done = job_count, run_result = $1, completed_at = $2
                WHERE id = $3 AND completed_at IS NULL
            "#;
            conn.execute(Statement::from_sql_and_values(
                backend,
                claim,
                [
                    Value::from(worst),
                    Value::from(now_us),
                    Value::from(run_id.to_owned()),
                ],
            ))
            .await?
            .rows_affected()
        }
    };
    Ok(claimed > 0)
}

async fn job_statuses<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
) -> Result<Vec<i32>, errors::Error> {
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            "SELECT status FROM synthetics_jobs WHERE run_id = $1",
            [Value::from(run_id.to_owned())],
        ))
        .await?;
    rows.into_iter()
        .map(|row| {
            row.try_get::<i32>("", "status")
                .map_err(errors::Error::from)
        })
        .collect()
}

/// Applies the run to the check row. Returns the new row only when the badge or a streak changed.
async fn write_check_row<C: ConnectionTrait>(
    conn: &C,
    synthetics_id: &str,
    run_result: i32,
    verdict: Verdict,
    run_ts: i64,
) -> Result<Option<StatusStreaks>, errors::Error> {
    // Retried because a concurrent run of the same check can win the swap between read and write.
    for _ in 0..SWAP_ATTEMPTS {
        let Some(cur) = synthetics_checks::get_status_streaks(conn, synthetics_id).await? else {
            return Ok(None);
        };
        let Some(next) = next_streaks(&cur, run_result, verdict, run_ts) else {
            return Ok(None);
        };
        if synthetics_checks::swap_status_streaks(conn, synthetics_id, &cur, &next).await? {
            let changed = cur.last_check_status != next.last_check_status
                || cur.down_runs != next.down_runs
                || cur.up_runs != next.up_runs;
            return Ok(changed.then_some(next));
        }
    }
    // Rolls the finalization back, so the stuck-run sweep retries it instead of losing the run.
    Err(errors::Error::Message(format!(
        "check {synthetics_id}: status streak swap lost {SWAP_ATTEMPTS} times"
    )))
}

/// Maps a `synthetics_jobs.status` to the SyntheticStatus DB scale; non-terminal jobs map to 0.
fn job_to_status(job_status: i32) -> i32 {
    match job_status {
        JOB_PASSED => 1,
        JOB_WARNING => 2,
        JOB_FAILED => 3,
        JOB_DEAD | JOB_ERROR => STATUS_ERROR,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insert_run_params_fields() {
        let p = InsertRunParams {
            id: "3Fzn001XXXXXXXXXXXXXXXX",
            synthetics_id: "mon-1",
            org_id: "org1",
            scheduled_ts: 1750000000000000,
            trigger_type: "schedule",
            job_count: 2,
            created_at: 1750000000000000,
        };
        assert_eq!(p.id, "3Fzn001XXXXXXXXXXXXXXXX");
        assert_eq!(p.job_count, 2);
        assert_eq!(p.trigger_type, "schedule");
    }

    #[test]
    fn test_run_row_fields() {
        let r = RunRow {
            id: "3Fzn001XXXXXXXXXXXXXXXX".to_string(),
            synthetics_id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            scheduled_ts: 1750000000000000,
            trigger_type: "schedule".to_string(),
            job_count: 2,
            jobs_done: 1,
            run_result: Some(1),
            created_at: 1750000000000000,
            completed_at: None,
        };
        assert_eq!(r.job_count, 2);
        assert_eq!(r.jobs_done, 1);
        assert_eq!(r.run_result, Some(1));
    }

    use sea_orm::{ActiveModelTrait, ConnectOptions, Database, DatabaseConnection, Schema};

    use crate::table::entity::{
        synthetics_checks as checks, synthetics_jobs as jobs, synthetics_runs as runs,
    };

    const MIN: i64 = 60_000_000;

    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(checks::Entity),
            schema.create_table_from_entity(runs::Entity),
            schema.create_table_from_entity(jobs::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        let check = checks::Model {
            id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            folder_id: "f".to_string(),
            tz_offset: 0,
            name: "n".to_string(),
            synthetics_type: "http".to_string(),
            target: "https://example.com".to_string(),
            description: String::new(),
            tags: serde_json::json!([]),
            config: serde_json::json!({}),
            frequency: serde_json::json!({}),
            locations: serde_json::json!([]),
            enabled: true,
            destinations: serde_json::json!([]),
            settings: serde_json::json!({}),
            secrets: "{}".to_string(),
            next_run_at: 0,
            last_triggered_at: 0,
            last_check_status: 0,
            consecutive_failures: 0,
            last_alert_at: 0,
            alerting: false,
            degraded_notified_at: 0,
            status_down_runs: 0,
            status_up_runs: 0,
            status_run_ts: 0,
            owner: None,
            created_at: 0,
            updated_at: 0,
        };
        let am: checks::ActiveModel = check.into();
        am.reset_all().insert(&db).await.unwrap();
        db
    }

    /// Inserts a run with one claimed job per location.
    async fn run_with_jobs(db: &DatabaseConnection, run_id: &str, scheduled_ts: i64, n: usize) {
        insert_run(
            db,
            InsertRunParams {
                id: run_id,
                synthetics_id: "mon-1",
                org_id: "org1",
                scheduled_ts,
                trigger_type: "schedule",
                job_count: n as i32,
                created_at: scheduled_ts,
            },
        )
        .await
        .unwrap();
        for i in 0..n {
            let job = jobs::Model {
                id: format!("{run_id}-job-{i}"),
                synthetics_id: "mon-1".to_string(),
                synthetics_name: "n".to_string(),
                org_id: "org1".to_string(),
                location: format!("loc-{i}"),
                env: None,
                pool: "p".to_string(),
                scheduled_ts,
                valid_until: scheduled_ts + 10 * MIN,
                status: 1,
                claimed_by: None,
                claimed_at: None,
                lease_expires_at: None,
                dispatch_attempts: 0,
                run_id: run_id.to_string(),
                browser_devices: None,
                steps_configured: 1,
                metadata: "{}".to_string(),
                result: None,
                started_at: None,
                completed_at: None,
            };
            let am: jobs::ActiveModel = job.into();
            am.reset_all().insert(db).await.unwrap();
        }
    }

    /// What `ack_complete` does to the job row, then the run finalization.
    async fn ack(
        db: &DatabaseConnection,
        run_id: &str,
        i: usize,
        status_db: i32,
        now: i64,
    ) -> Option<RunFinalized> {
        complete_job(db, run_id, i, status_db, now).await;
        finalize_run(db, run_id, status_db, now).await.unwrap()
    }

    async fn complete_job(
        db: &DatabaseConnection,
        run_id: &str,
        i: usize,
        status_db: i32,
        now: i64,
    ) {
        let job_status = match status_db {
            1 => 3,
            2 => 5,
            3 => 4,
            _ => 6,
        };
        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            "UPDATE synthetics_jobs SET status = $1, completed_at = $2 WHERE id = $3",
            [
                Value::from(job_status),
                Value::from(now),
                Value::from(format!("{run_id}-job-{i}")),
            ],
        ))
        .await
        .unwrap();
    }

    async fn check_row(db: &DatabaseConnection) -> (StatusStreaks, i64) {
        let m = checks::Entity::find_by_id("mon-1")
            .one(db)
            .await
            .unwrap()
            .unwrap();
        (
            StatusStreaks {
                last_check_status: m.last_check_status,
                down_runs: m.status_down_runs,
                up_runs: m.status_up_runs,
                run_ts: m.status_run_ts,
            },
            m.updated_at,
        )
    }

    async fn completed_at(db: &DatabaseConnection, run_id: &str) -> Option<i64> {
        get_run(db, run_id).await.unwrap().unwrap().completed_at
    }

    use sea_orm::EntityTrait;

    #[test]
    fn verdict_table() {
        use Verdict::*;
        // (job_count, failed, healthy) -> verdict; error jobs fill the rest of job_count.
        for (n, failed, healthy, want) in [
            (1, 1, 0, Down),
            (2, 1, 1, NoVerdict),
            (2, 2, 0, Down),
            (2, 1, 0, NoVerdict),
            (2, 0, 1, NoVerdict),
            (2, 0, 2, Up),
            (3, 2, 0, Down),
            (3, 0, 1, NoVerdict),
            (1, 0, 0, NoVerdict),
        ] {
            assert_eq!(
                run_verdict(n, failed, healthy),
                want,
                "n={n} f={failed} h={healthy}"
            );
        }
    }

    #[test]
    fn streaks_cap_at_ten_and_no_verdict_moves_nothing() {
        let mut cur = StatusStreaks::default();
        for ts in 1..=15 {
            cur = next_streaks(&cur, 3, Verdict::Down, ts).unwrap();
        }
        assert_eq!((cur.down_runs, cur.up_runs), (STREAK_CAP, 0));
        let after = next_streaks(&cur, 3, Verdict::NoVerdict, 16).unwrap();
        assert_eq!((after.down_runs, after.up_runs), (STREAK_CAP, 0));
        let up = next_streaks(&after, 1, Verdict::Up, 17).unwrap();
        assert_eq!((up.down_runs, up.up_runs), (0, 1));
        assert!(
            next_streaks(&up, 3, Verdict::Down, 17).is_none(),
            "same run_ts is not newer"
        );
    }

    #[tokio::test]
    async fn failing_location_acking_last_writes_the_run_result_once() {
        let db = db().await;
        run_with_jobs(&db, "r1", 100, 2).await;
        assert!(ack(&db, "r1", 0, 1, 200).await.is_none());
        let (row, _) = check_row(&db).await;
        assert_eq!(
            row,
            StatusStreaks::default(),
            "an unfinished run must not touch the check"
        );

        let done = ack(&db, "r1", 1, 3, 300)
            .await
            .expect("last job completes the run");
        assert_eq!(done.run_result, 3);
        assert_eq!(done.verdict, Verdict::NoVerdict);
        let (row, _) = check_row(&db).await;
        assert_eq!(
            row,
            StatusStreaks {
                last_check_status: 3,
                down_runs: 0,
                up_runs: 0,
                run_ts: 100
            }
        );
        assert_eq!(done.check_update, Some(row));

        // A duplicate ack after completion moves nothing.
        assert!(finalize_run(&db, "r1", 3, 400).await.unwrap().is_none());
        assert_eq!(check_row(&db).await.0, row);
        assert_eq!(get_run(&db, "r1").await.unwrap().unwrap().jobs_done, 2);
    }

    #[tokio::test]
    async fn error_job_completes_the_run_without_voting() {
        let db = db().await;
        run_with_jobs(&db, "r1", 100, 2).await;
        ack(&db, "r1", 0, 1, 200).await;
        // The dispatcher and the reaper finalize with 4 = Error.
        let done = ack(&db, "r1", 1, 4, 300).await.unwrap();
        assert_eq!(done.run_result, 4);
        assert_eq!(done.verdict, Verdict::NoVerdict);
        assert_eq!(check_row(&db).await.0.last_check_status, 4);
    }

    #[tokio::test]
    async fn passing_check_stops_writing_after_the_cap() {
        let db = db().await;
        for k in 0..12 {
            let run_id = format!("r{k}");
            run_with_jobs(&db, &run_id, 100 + k, 1).await;
            let (_, before) = check_row(&db).await;
            let done = ack(&db, &run_id, 0, 1, 1000 + k).await.unwrap();
            let (row, after) = check_row(&db).await;
            assert_eq!(row.run_ts, 100 + k);
            if k < STREAK_CAP as i64 {
                assert!(done.check_update.is_some(), "run {k} changes the streak");
            } else {
                assert!(done.check_update.is_none(), "run {k} must not publish");
                assert_eq!(before, after, "run {k} must not bump updated_at");
            }
        }
        assert_eq!(check_row(&db).await.0.up_runs, STREAK_CAP);
    }

    #[tokio::test]
    async fn older_run_finishing_late_does_not_change_the_check() {
        let db = db().await;
        run_with_jobs(&db, "a", 100, 1).await;
        run_with_jobs(&db, "b", 200, 1).await;
        ack(&db, "b", 0, 1, 300).await.unwrap();
        let before = check_row(&db).await;
        let late = ack(&db, "a", 0, 3, 400).await.unwrap();
        assert!(late.check_update.is_none());
        assert_eq!(check_row(&db).await, before);
        assert!(
            completed_at(&db, "a").await.is_some(),
            "the late run itself still completes"
        );
    }

    #[tokio::test]
    async fn rolled_back_finalization_is_recovered_once_by_the_sweep() {
        let db = db().await;
        run_with_jobs(&db, "r1", 100, 2).await;
        ack(&db, "r1", 0, 3, 200).await;
        complete_job(&db, "r1", 1, 3, 300).await;
        {
            let txn = db.begin().await.unwrap();
            assert!(claim_completion(&txn, "r1", Some(3), 300).await.unwrap());
            txn.rollback().await.unwrap();
        }
        assert!(completed_at(&db, "r1").await.is_none());
        assert_eq!(check_row(&db).await.0, StatusStreaks::default());

        assert!(
            finalize_stuck_runs(&db, 300 + MIN, 2 * MIN)
                .await
                .unwrap()
                .is_empty(),
            "inside the grace period an ack may still be in flight"
        );
        let swept = finalize_stuck_runs(&db, 300 + 3 * MIN, 2 * MIN)
            .await
            .unwrap();
        assert_eq!(swept.len(), 1);
        assert_eq!(swept[0].verdict, Verdict::Down);
        assert_eq!(
            check_row(&db).await.0,
            StatusStreaks {
                last_check_status: 3,
                down_runs: 1,
                up_runs: 0,
                run_ts: 100
            }
        );
        let run = get_run(&db, "r1").await.unwrap().unwrap();
        assert_eq!((run.jobs_done, run.run_result), (2, Some(3)));
        assert!(
            finalize_stuck_runs(&db, 300 + 4 * MIN, 2 * MIN)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
