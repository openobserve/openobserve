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

use config::meta::synthetics::RunClass;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Statement, TransactionTrait, Value,
};
use svix_ksuid::KsuidLike as _;

pub use super::synthetics_checks::StatusStreaks;
use super::{
    entity::{synthetics_checks as checks_entity, synthetics_jobs as jobs_entity},
    synthetics_checks, synthetics_jobs,
    synthetics_jobs::JobMetadata,
};
use crate::errors;

/// Status page streaks stop growing here, so a steady check stops writing its row.
pub const STREAK_CAP: i32 = 10;
/// How far back the stuck-run sweep looks, in microseconds.
const STUCK_LOOKBACK_US: i64 = 86_400_000_000;
const SWAP_ATTEMPTS: usize = 3;
/// Completed runs a late run replays; enough to rebuild a streak capped at 10.
const REPLAY_RUNS: i64 = 20;
const STATUS_ERROR: i32 = 4;
// `synthetics_jobs.status` values; a different scale from SyntheticStatus.
const JOB_DEAD: i32 = 2;
const JOB_PASSED: i32 = 3;
const JOB_FAILED: i32 = 4;
const JOB_WARNING: i32 = 5;
const JOB_ERROR: i32 = 6;
/// `synthetics_runs.trigger_type` of a scheduled run.
pub const TRIGGER_SCHEDULE: &str = "schedule";
/// `synthetics_runs.trigger_type` of the one extra run that fills a Not measured gap.
pub const TRIGGER_GAP_RETRY: &str = "gap_retry";
/// What a confirm job tells its probe, which writes it to the result row. The run keeps its own
/// trigger type.
pub const TRIGGER_CONFIRM: &str = "confirm";
/// How often a steady check past the streak cap publishes its `tested_at` to other regions. The
/// status page calls a check stale after three intervals, and the shortest interval is one minute.
const TESTED_AT_PUBLISH_US: i64 = 120_000_000;
/// `error_source` values for a job that never tested the site because of us. Mirrors
/// `synthetics::alerting::classify`.
const NOT_MEASURED_SOURCES: [&str; 4] = ["queue", "control_plane", "dispatch", "orphan"];
/// The subset of [`NOT_MEASURED_SOURCES`] that earns one extra run.
const GAP_RETRY_SOURCES: [&str; 2] = ["control_plane", "dispatch"];
const SOURCE_CONFIG: &str = "config";
const REASON_CONFIG_REFERENCE_PENDING: &str = "config_reference_pending";

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

/// The completed run, with the check row to replicate when it changed.
#[derive(Debug, Clone)]
pub struct RunFinalized {
    pub run_id: String,
    pub synthetics_id: String,
    pub org_id: String,
    /// Worst job result on the SyntheticStatus DB scale.
    pub run_result: i32,
    pub job_count: i32,
    pub verdict: Verdict,
    pub run_class: RunClass,
    /// A confirm job passed, so a failed location counts as up (`flaky`).
    pub confirmed_flaky: bool,
    /// The run held a confirm job, so its answer is the merged vote, not the worst raw result.
    pub had_confirm: bool,
    /// The run earns one extra run: it is a scheduled run that measured nothing because the probe
    /// could not reach the job API or could not be dispatched.
    pub gap_retry: bool,
    /// `Some` only when the badge, a streak or the run class changed.
    pub check_update: Option<StatusStreaks>,
    /// Distinct locations of the original jobs; `job_count` without confirm jobs when unknown.
    pub voters: i32,
    /// Locations whose vote is a failure after confirm pairs merge, sorted, each once.
    pub failed_locations: Vec<String>,
}

/// One job of a run, as finalization reads it.
#[derive(Debug, Clone, Default)]
pub struct JobOutcome {
    pub id: String,
    /// `synthetics_jobs.status`.
    pub status: i32,
    pub error_source: Option<String>,
    pub status_reason: Option<String>,
    /// The job this one confirms, for a confirm job.
    pub confirm_of: Option<String>,
    pub location: String,
}

/// What a run's jobs add up to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tally {
    pub verdict: Verdict,
    pub class: RunClass,
    /// The worst result after confirm pairs merge, on the SyntheticStatus DB scale. `None` when
    /// the run has no confirm job, so the stored `run_result` stands.
    pub run_result: Option<i32>,
    pub confirmed_flaky: bool,
    pub has_confirm: bool,
    /// Some job measured nothing because of [`GAP_RETRY_SOURCES`].
    pub gap_cause: bool,
    /// See [`RunFinalized::voters`].
    pub voters: i32,
    /// See [`RunFinalized::failed_locations`].
    pub failed_locations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Vote {
    Healthy,
    Failed,
    NotMeasured,
    Config,
}

impl JobOutcome {
    fn vote(&self) -> Vote {
        match self.status {
            JOB_PASSED | JOB_WARNING => Vote::Healthy,
            JOB_FAILED => Vote::Failed,
            JOB_ERROR
                if self.error_source.as_deref() == Some(SOURCE_CONFIG)
                    && self.status_reason.as_deref() != Some(REASON_CONFIG_REFERENCE_PENDING) =>
            {
                Vote::Config
            }
            // Dead letters, our own errors, probe crashes and unfinished jobs did not test the
            // site.
            _ => Vote::NotMeasured,
        }
    }

    fn is_gap_cause(&self) -> bool {
        self.status == JOB_DEAD
            || (self.status == JOB_ERROR
                && self
                    .error_source
                    .as_deref()
                    .is_some_and(|s| GAP_RETRY_SOURCES.contains(&s)))
    }
}

/// Whether an `error_source` means we never tested the site.
pub fn is_not_measured_source(error_source: &str, status_reason: Option<&str>) -> bool {
    NOT_MEASURED_SOURCES.contains(&error_source)
        || (error_source == SOURCE_CONFIG && status_reason == Some(REASON_CONFIG_REFERENCE_PENDING))
}

/// Adds up a run's jobs. A confirm job and the job it confirms are one vote, a failure only when
/// the confirm job fails too; a confirm job that did not test the site leaves the failure standing.
pub fn tally(job_count: i32, jobs: &[JobOutcome]) -> Tally {
    let confirms: Vec<&JobOutcome> = jobs.iter().filter(|j| j.confirm_of.is_some()).collect();
    let mut failed = 0;
    let mut healthy = 0;
    let mut config = 0;
    let mut confirmed_flaky = false;
    let mut worst = 0;
    let mut failed_locations: Vec<String> = Vec::new();
    for job in jobs.iter().filter(|j| j.confirm_of.is_none()) {
        let mut vote = job.vote();
        let mut result = job_to_status(job.status);
        if vote == Vote::Failed
            && let Some(confirm) = confirms
                .iter()
                .find(|c| c.confirm_of.as_deref() == Some(job.id.as_str()))
            && confirm.vote() == Vote::Healthy
        {
            vote = Vote::Healthy;
            result = 2;
            confirmed_flaky = true;
        }
        worst = worst.max(result);
        match vote {
            Vote::Healthy => healthy += 1,
            Vote::Failed => {
                failed += 1;
                if !failed_locations.contains(&job.location) {
                    failed_locations.push(job.location.clone());
                }
            }
            Vote::Config => config += 1,
            Vote::NotMeasured => {}
        }
    }
    let voters = job_count - confirms.len() as i32;
    let verdict = run_verdict(voters, failed, healthy);
    // A check with environments has one job per environment and location, so coverage counts
    // distinct locations, as `failed_locations` does.
    let mut locations: Vec<&str> = jobs
        .iter()
        .filter(|j| j.confirm_of.is_none() && !j.location.is_empty())
        .map(|j| j.location.as_str())
        .collect();
    locations.sort_unstable();
    locations.dedup();
    let class = match verdict {
        _ if failed + healthy == 0 && config > 0 => RunClass::Misconfigured,
        _ if failed + healthy == 0 => RunClass::NotMeasured,
        Verdict::Down => RunClass::Down,
        // A failure below quorum is partial, even when a healthy majority makes the verdict Up.
        _ if failed > 0 => RunClass::Partial,
        // Only healthy locations tested the site.
        _ => RunClass::Up,
    };
    Tally {
        verdict,
        class,
        run_result: (!confirms.is_empty() && worst > 0).then_some(worst),
        confirmed_flaky,
        has_confirm: !confirms.is_empty(),
        gap_cause: jobs.iter().any(JobOutcome::is_gap_cause),
        voters: if locations.is_empty() {
            voters
        } else {
            locations.len() as i32
        },
        failed_locations: {
            failed_locations.sort();
            failed_locations
        },
    }
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

/// Counts the job and, for the caller that completes the run, writes the run result to the check
/// row in the same transaction.
pub async fn finalize_run<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    run_id: &str,
    job_result: i32,
    now_us: i64,
) -> Result<Option<RunFinalized>, errors::Error> {
    finalize(conn, run_id, Some(job_result), now_us).await
}

/// Finalizes runs whose jobs all ended more than `grace_us` ago but whose finalization never
/// committed.
pub async fn finalize_stuck_runs<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    now_us: i64,
    grace_us: i64,
) -> Result<Vec<RunFinalized>, errors::Error> {
    let cutoff = now_us - grace_us;
    let sql = r#"
        SELECT r.id AS id FROM synthetics_runs r
        WHERE r.completed_at IS NULL AND r.created_at < $1 AND r.created_at > $2
          AND EXISTS (SELECT 1 FROM synthetics_jobs j WHERE j.run_id = r.id)
          AND NOT EXISTS (
              SELECT 1 FROM synthetics_jobs j2
              WHERE j2.run_id = r.id AND (j2.status < 2 OR j2.completed_at >= $1)
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
        // One failing run must not drop the runs that already committed in this batch.
        match finalize(conn, &id, None, now_us).await {
            Ok(Some(f)) => done.push(f),
            Ok(None) => {}
            Err(e) => log::warn!("[synthetics] finalize stuck run {id}: {e}"),
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
    run_class: RunClass,
    run_ts: i64,
) -> Option<StatusStreaks> {
    if cur.run_ts >= run_ts {
        return None;
    }
    let (down_runs, up_runs) = match verdict {
        Verdict::Down => ((cur.down_runs + 1).min(STREAK_CAP), 0),
        Verdict::Up => (0, (cur.up_runs + 1).min(STREAK_CAP)),
        // An unknown verdict cannot prove recovery, so it breaks an Up streak.
        Verdict::NoVerdict => (cur.down_runs, 0),
    };
    let run_class = run_class.to_db();
    // `run_class_at` marks when the current class began, so a steady check stops writing.
    let run_class_at = if cur.run_class == run_class && cur.run_class_at > 0 {
        cur.run_class_at
    } else {
        run_ts
    };
    let tested_at = if RunClass::from_db(run_class).counts_for_uptime() {
        run_ts
    } else {
        cur.tested_at
    };
    Some(StatusStreaks {
        last_check_status: run_result,
        down_runs,
        up_runs,
        run_ts,
        run_class,
        run_class_at,
        tested_at,
        recovered_at: cur.recovered_at,
        signed: true,
    })
}

/// The recovery stamp after a run: the run's finish time when it starts an Up streak, and the old
/// stamp otherwise. A late Up run (`late`) always counts, because replay cannot tell if it started
/// the streak. The stamp only rises, also when two runs finish in the same microsecond.
pub fn recovery_stamp(cur: &StatusStreaks, verdict: Verdict, late: bool, finished_at: i64) -> i64 {
    if verdict == Verdict::Up && (late || cur.up_runs == 0) {
        (cur.recovered_at + 1).max(finished_at)
    } else {
        cur.recovered_at
    }
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
    let t = tally(run.job_count, &job_outcomes(&txn, run_id).await?);
    let run_result = t
        .run_result
        .or(run.run_result)
        .or(job_result)
        .unwrap_or(STATUS_ERROR);
    if t.run_result
        .is_some_and(|merged| Some(merged) != run.run_result)
    {
        // The run history shows the merged vote, as the check row does.
        txn.execute(Statement::from_sql_and_values(
            txn.get_database_backend(),
            "UPDATE synthetics_runs SET run_result = $1 WHERE id = $2",
            [Value::from(run_result), Value::from(run_id.to_owned())],
        ))
        .await?;
    }
    let check_update = write_check_row(
        &txn,
        &run.synthetics_id,
        run_result,
        t.verdict,
        t.class,
        run.scheduled_ts,
        now_us,
    )
    .await?;
    txn.commit().await?;
    Ok(Some(RunFinalized {
        run_id: run.id,
        synthetics_id: run.synthetics_id,
        org_id: run.org_id,
        run_result,
        job_count: run.job_count,
        verdict: t.verdict,
        run_class: t.class,
        confirmed_flaky: t.confirmed_flaky,
        had_confirm: t.has_confirm,
        gap_retry: t.class == RunClass::NotMeasured
            && t.gap_cause
            && run.trigger_type == TRIGGER_SCHEDULE,
        check_update,
        voters: t.voters,
        failed_locations: t.failed_locations,
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

/// The jobs of a run with what their acks recorded.
pub async fn job_outcomes<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
) -> Result<Vec<JobOutcome>, errors::Error> {
    #[derive(serde::Deserialize, Default)]
    struct AckResult {
        error_source: Option<String>,
        status_reason: Option<String>,
    }
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            "SELECT id, status, result, metadata, location FROM synthetics_jobs WHERE run_id = $1",
            [Value::from(run_id.to_owned())],
        ))
        .await?;
    rows.into_iter()
        .map(|row| {
            let result: Option<String> = row.try_get("", "result")?;
            let metadata: String = row.try_get("", "metadata")?;
            let ack: AckResult = result
                .and_then(|r| serde_json::from_str(&r).ok())
                .unwrap_or_default();
            let meta: JobMetadata = serde_json::from_str(&metadata).unwrap_or_default();
            Ok(JobOutcome {
                id: row.try_get("", "id")?,
                status: row.try_get("", "status")?,
                error_source: ack.error_source,
                status_reason: ack.status_reason,
                confirm_of: meta.confirm_of,
                location: row.try_get("", "location")?,
            })
        })
        .collect::<Result<_, sea_orm::DbErr>>()
        .map_err(errors::Error::from)
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
    run_class: RunClass,
    run_ts: i64,
    finished_at: i64,
) -> Result<Option<StatusStreaks>, errors::Error> {
    // Retried because a concurrent run of the same check can win the swap between read and write.
    for _ in 0..SWAP_ATTEMPTS {
        let Some(cur) = synthetics_checks::lock_status_streaks(conn, synthetics_id).await? else {
            return Ok(None);
        };
        let (mut next, late) = match next_streaks(&cur, run_result, verdict, run_class, run_ts) {
            Some(next) => (next, false),
            // A run that finishes after a newer one rebuilds the streaks in run order.
            None => (
                replay_streaks(conn, synthetics_id, &cur, verdict == Verdict::Up).await?,
                true,
            ),
        };
        next.recovered_at = if cur.signed {
            recovery_stamp(&cur, verdict, late, finished_at)
        } else {
            // An older build wrote the streaks and may have missed a recovery: assume one, so no
            // false alarm hold saved before it can match. This only fails open.
            (cur.recovered_at + 1).max(finished_at)
        };
        if next == cur {
            return Ok(None);
        }
        if synthetics_checks::swap_status_streaks(conn, synthetics_id, &cur, &next).await? {
            let changed = cur.last_check_status != next.last_check_status
                || cur.down_runs != next.down_runs
                || cur.up_runs != next.up_runs
                || cur.run_class != next.run_class
                || cur.recovered_at != next.recovered_at
                || cur.tested_at / TESTED_AT_PUBLISH_US != next.tested_at / TESTED_AT_PUBLISH_US;
            return Ok(changed.then_some(next));
        }
    }
    // Rolls the finalization back, so the stuck-run sweep retries it instead of losing the run.
    Err(errors::Error::Message(format!(
        "check {synthetics_id}: status streak swap lost {SWAP_ATTEMPTS} times"
    )))
}

/// The streaks recomputed from the latest completed runs, keeping the badge and `run_ts` of `cur`.
async fn replay_streaks<C: ConnectionTrait>(
    conn: &C,
    synthetics_id: &str,
    cur: &StatusStreaks,
    late_up: bool,
) -> Result<StatusStreaks, errors::Error> {
    let backend = conn.get_database_backend();
    let runs = conn
        .query_all(Statement::from_sql_and_values(
            backend,
            r#"
                SELECT id, scheduled_ts, job_count FROM synthetics_runs
                WHERE synthetics_id = $1 AND completed_at IS NOT NULL AND scheduled_ts <= $2
                ORDER BY scheduled_ts DESC
                LIMIT $3
            "#,
            [
                Value::from(synthetics_id.to_owned()),
                Value::from(cur.run_ts),
                Value::from(REPLAY_RUNS),
            ],
        ))
        .await?;
    let mut replayed = StatusStreaks::default();
    let mut saw_up = false;
    for row in runs.iter().rev() {
        let id: String = row.try_get("", "id")?;
        let scheduled_ts: i64 = row.try_get("", "scheduled_ts")?;
        let job_count: i32 = row.try_get("", "job_count")?;
        let t = tally(job_count, &job_outcomes(conn, &id).await?);
        saw_up |= t.verdict == Verdict::Up;
        if let Some(next) = next_streaks(&replayed, 0, t.verdict, t.class, scheduled_ts) {
            replayed = next;
        }
    }
    // The window starts from an empty state. With no Up verdict in it, and no late Up that can be
    // older than the window, the failure goes on from before the window: keep the Down streak that
    // the row already had.
    let (down_runs, up_runs) = if saw_up || late_up {
        (replayed.down_runs, replayed.up_runs)
    } else {
        (cur.down_runs.max(replayed.down_runs), 0)
    };
    Ok(StatusStreaks {
        last_check_status: cur.last_check_status,
        down_runs,
        up_runs,
        run_ts: cur.run_ts,
        run_class: cur.run_class,
        run_class_at: cur.run_class_at,
        // A late run can be the newest one that tested the site.
        tested_at: cur.tested_at.max(replayed.tested_at),
        // `write_check_row` sets the stamp from the late run itself.
        recovered_at: cur.recovered_at,
        signed: true,
    })
}

// ── Confirm jobs and gap retries ──────────────────────────────────────────────

fn confirm_of(job: &jobs_entity::Model) -> Option<String> {
    serde_json::from_str::<JobMetadata>(&job.metadata)
        .ok()
        .and_then(|m| m.confirm_of)
}

/// A browser job's `browser_devices` with new execution ids, so a copied job writes its own rows.
fn fresh_execution_ids(json: &str) -> String {
    let Ok(mut entries) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
        return json.to_owned();
    };
    for e in &mut entries {
        if let Some(obj) = e.as_object_mut() {
            obj.insert(
                "execution_id".to_owned(),
                svix_ksuid::Ksuid::new(None, None).to_string().into(),
            );
        }
    }
    serde_json::to_string(&entries).unwrap_or_else(|_| json.to_owned())
}

/// Adds one confirm job for the failed job `job_id` to its run, so the run waits for it.
///
/// The confirm job runs at once from the location that failed. A pass there marks a short blip;
/// a pass elsewhere would hide a one-region outage. Returns the new job id, or `None`
/// when `job_id` is a confirm job, already has one, or its run already completed.
pub async fn add_confirm_job<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    job_id: &str,
    now_us: i64,
) -> Result<Option<String>, errors::Error> {
    let txn = conn.begin().await?;
    let Some(orig) = jobs_entity::Entity::find_by_id(job_id).one(&txn).await? else {
        txn.commit().await?;
        return Ok(None);
    };
    let meta: JobMetadata = serde_json::from_str(&orig.metadata).unwrap_or_default();
    let siblings = jobs_entity::Entity::find()
        .filter(jobs_entity::Column::RunId.eq(orig.run_id.as_str()))
        .all(&txn)
        .await?;
    if meta.confirm_of.is_some()
        || siblings
            .iter()
            .any(|j| confirm_of(j).as_deref() == Some(job_id))
    {
        txn.commit().await?;
        return Ok(None);
    }
    let bumped = txn
        .execute(Statement::from_sql_and_values(
            txn.get_database_backend(),
            "UPDATE synthetics_runs SET job_count = job_count + 1 \
             WHERE id = $1 AND completed_at IS NULL",
            [Value::from(orig.run_id.clone())],
        ))
        .await?
        .rows_affected();
    if bumped == 0 {
        txn.rollback().await?;
        return Ok(None);
    }
    let metadata = serde_json::to_string(&JobMetadata {
        confirm_of: Some(job_id.to_owned()),
        ..meta
    })
    .map_err(|e| errors::Error::Message(e.to_string()))?;
    let browser_devices = orig.browser_devices.as_deref().map(fresh_execution_ids);
    let id = synthetics_jobs::enqueue(
        &txn,
        synthetics_jobs::EnqueueParams {
            synthetics_id: &orig.synthetics_id,
            synthetics_name: &orig.synthetics_name,
            org_id: &orig.org_id,
            location: &orig.location,
            env: orig.env.as_deref(),
            pool: &orig.pool,
            scheduled_ts: now_us,
            valid_until: now_us + (orig.valid_until - orig.scheduled_ts),
            run_id: &orig.run_id,
            browser_devices: browser_devices.as_deref(),
            steps_configured: orig.steps_configured,
            metadata: &metadata,
        },
    )
    .await?;
    // `ON CONFLICT DO NOTHING` inserts nothing on a slot clash; the run must not wait for it.
    if jobs_entity::Entity::find_by_id(id.as_str())
        .one(&txn)
        .await?
        .is_none()
    {
        txn.rollback().await?;
        return Ok(None);
    }
    txn.commit().await?;
    Ok(Some(id))
}

/// Schedules one extra run of a scheduled run's locations `delay_us` from now, to fill a Not
/// measured gap. Returns the new run id, or `None` when the run is not a scheduled run, the check
/// is paused, or the scheduler fires the check by then anyway.
pub async fn add_gap_retry_run<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    run_id: &str,
    now_us: i64,
    delay_us: i64,
) -> Result<Option<String>, errors::Error> {
    let txn = conn.begin().await?;
    let Some(run) = get_run(&txn, run_id).await? else {
        txn.commit().await?;
        return Ok(None);
    };
    let scheduled_ts = now_us + delay_us;
    let check = checks_entity::Entity::find_by_id(run.synthetics_id.as_str())
        .one(&txn)
        .await?;
    let due_anyway = check
        .as_ref()
        .is_none_or(|c| !c.enabled || (c.next_run_at > 0 && c.next_run_at <= scheduled_ts));
    if run.trigger_type != TRIGGER_SCHEDULE || due_anyway {
        txn.commit().await?;
        return Ok(None);
    }
    let jobs: Vec<_> = jobs_entity::Entity::find()
        .filter(jobs_entity::Column::RunId.eq(run_id))
        .all(&txn)
        .await?
        .into_iter()
        .filter(|j| confirm_of(j).is_none())
        .collect();
    if jobs.is_empty() {
        txn.commit().await?;
        return Ok(None);
    }
    let new_id = svix_ksuid::Ksuid::new(None, None).to_string();
    insert_run(
        &txn,
        InsertRunParams {
            id: &new_id,
            synthetics_id: &run.synthetics_id,
            org_id: &run.org_id,
            scheduled_ts,
            trigger_type: TRIGGER_GAP_RETRY,
            job_count: jobs.len() as i32,
            created_at: now_us,
        },
    )
    .await?;
    for j in &jobs {
        let browser_devices = j.browser_devices.as_deref().map(fresh_execution_ids);
        synthetics_jobs::enqueue(
            &txn,
            synthetics_jobs::EnqueueParams {
                synthetics_id: &j.synthetics_id,
                synthetics_name: &j.synthetics_name,
                org_id: &j.org_id,
                location: &j.location,
                env: j.env.as_deref(),
                pool: &j.pool,
                scheduled_ts,
                valid_until: scheduled_ts + (j.valid_until - j.scheduled_ts),
                run_id: &new_id,
                browser_devices: browser_devices.as_deref(),
                steps_configured: j.steps_configured,
                metadata: &j.metadata,
            },
        )
        .await?;
    }
    txn.commit().await?;
    Ok(Some(new_id))
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
        db.execute_unprepared(&synthetics_jobs::dedup_index_sql(backend))
            .await
            .unwrap();
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
            last_run_class: 0,
            last_run_class_at: 0,
            last_tested_at: 0,
            status_recovered_at: 0,
            status_streak_sig: 0,
            gap_since: 0,
            gap_runs: 0,
            gap_notified_at: 0,
            gap_resumed_at: 0,
            owner: None,
            created_at: 0,
            updated_at: 0,
            template: None,
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
                run_class: m.last_run_class,
                run_class_at: m.last_run_class_at,
                tested_at: m.last_tested_at,
                recovered_at: m.status_recovered_at,
                signed: m.status_streak_sig
                    == synthetics_checks::streak_sig(
                        m.status_down_runs,
                        m.status_up_runs,
                        m.status_run_ts,
                        m.last_run_class,
                        m.status_recovered_at,
                    ),
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
    fn tested_at_moves_only_on_a_run_that_tested_the_site() {
        let up =
            next_streaks(&StatusStreaks::default(), 1, Verdict::Up, RunClass::Up, 100).unwrap();
        assert_eq!(up.tested_at, 100);
        let gap = next_streaks(&up, 0, Verdict::NoVerdict, RunClass::NotMeasured, 200).unwrap();
        assert_eq!(
            gap.tested_at, 100,
            "a Not measured run keeps the last test time"
        );
        let bad = next_streaks(&gap, 0, Verdict::NoVerdict, RunClass::Misconfigured, 300).unwrap();
        assert_eq!(bad.tested_at, 100);
        let down = next_streaks(&bad, 3, Verdict::Down, RunClass::Down, 400).unwrap();
        assert_eq!(down.tested_at, 400);
    }

    #[test]
    fn streaks_cap_at_ten_and_no_verdict_resets_only_up() {
        let mut cur = StatusStreaks::default();
        for ts in 1..=15 {
            cur = next_streaks(&cur, 3, Verdict::Down, RunClass::Down, ts).unwrap();
        }
        assert_eq!((cur.down_runs, cur.up_runs), (STREAK_CAP, 0));
        let after = next_streaks(&cur, 3, Verdict::NoVerdict, RunClass::Partial, 16).unwrap();
        assert_eq!((after.down_runs, after.up_runs), (STREAK_CAP, 0));
        let up = next_streaks(&after, 1, Verdict::Up, RunClass::Up, 17).unwrap();
        assert_eq!((up.down_runs, up.up_runs), (0, 1));
        assert!(
            next_streaks(&up, 3, Verdict::Down, RunClass::Down, 17).is_none(),
            "same run_ts is not newer"
        );
        let split = next_streaks(&up, 3, Verdict::NoVerdict, RunClass::Partial, 18).unwrap();
        assert_eq!(
            (split.down_runs, split.up_runs),
            (0, 0),
            "NoVerdict resets recovery"
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
                run_ts: 100,
                run_class: RunClass::Partial.to_db(),
                run_class_at: 100,
                tested_at: 100,
                recovered_at: 0,
                signed: true,
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

    /// A steady check past the cap still tells other regions when it last tested the site, or
    /// their status pages show a stale "Last checked".
    #[tokio::test]
    async fn a_steady_check_publishes_its_tested_time_every_two_minutes() {
        const MINUTE: i64 = 60_000_000;
        let db = db().await;
        let mut published = Vec::new();
        for k in 0..16 {
            let run_id = format!("r{k}");
            run_with_jobs(&db, &run_id, k * MINUTE + 1, 1).await;
            let done = ack(&db, &run_id, 0, 1, k * MINUTE + 2).await.unwrap();
            if k >= STREAK_CAP as i64 && done.check_update.is_some() {
                published.push(k);
            }
        }
        assert_eq!(published, vec![10, 12, 14]);
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
    async fn a_late_run_that_tested_the_site_moves_the_tested_time() {
        let db = db().await;
        run_with_jobs(&db, "a", 100, 1).await;
        run_with_jobs(&db, "b", 200, 1).await;
        // The newer run did not test the site.
        ack(&db, "b", 0, 4, 300).await.unwrap();
        assert_eq!(check_row(&db).await.0.tested_at, 0);
        ack(&db, "a", 0, 1, 400).await.unwrap();
        let (row, _) = check_row(&db).await;
        assert_eq!(row.tested_at, 100);
        assert_eq!(row.run_ts, 200);
    }

    #[test]
    fn the_recovery_stamp_moves_only_when_an_up_streak_starts() {
        let cur = |up_runs, recovered_at| StatusStreaks {
            up_runs,
            recovered_at,
            ..StatusStreaks::default()
        };
        assert_eq!(recovery_stamp(&cur(0, 0), Verdict::Up, false, 500), 500);
        assert_eq!(
            recovery_stamp(&cur(2, 300), Verdict::Up, false, 500),
            300,
            "steady Up"
        );
        assert_eq!(
            recovery_stamp(&cur(2, 300), Verdict::Up, true, 500),
            500,
            "late Up"
        );
        assert_eq!(recovery_stamp(&cur(0, 300), Verdict::Down, false, 500), 300);
        assert_eq!(
            recovery_stamp(&cur(0, 300), Verdict::NoVerdict, false, 500),
            300
        );
        // The clock moved back: the stamp still rises.
        assert_eq!(recovery_stamp(&cur(0, 900), Verdict::Up, false, 500), 901);
    }

    #[tokio::test]
    async fn a_recovery_moves_the_stamp_once_per_up_streak() {
        let db = db().await;
        let stamp = |db| async move { check_row(db).await.0.recovered_at };
        run_with_jobs(&db, "down", 100, 1).await;
        ack(&db, "down", 0, 3, 110).await;
        assert_eq!(stamp(&db).await, 0);
        run_with_jobs(&db, "up1", 200, 1).await;
        ack(&db, "up1", 0, 1, 210).await;
        assert_eq!(stamp(&db).await, 210, "the first Up after a failure");
        run_with_jobs(&db, "up2", 300, 1).await;
        ack(&db, "up2", 0, 1, 310).await;
        assert_eq!(stamp(&db).await, 210, "a steady check keeps its stamp");
        run_with_jobs(&db, "down2", 400, 1).await;
        ack(&db, "down2", 0, 3, 410).await;
        run_with_jobs(&db, "gap", 500, 1).await;
        ack(&db, "gap", 0, 4, 510).await;
        assert_eq!(stamp(&db).await, 210, "Down and no verdict keep the stamp");
        run_with_jobs(&db, "up3", 600, 1).await;
        ack(&db, "up3", 0, 1, 605).await;
        assert_eq!(stamp(&db).await, 605);
    }

    #[tokio::test]
    async fn a_no_verdict_replay_keeps_the_failure_and_a_late_up_moves_the_stamp() {
        let db = db().await;
        run_with_jobs(&db, "d1", 100, 1).await;
        ack(&db, "d1", 0, 3, 110).await;
        run_with_jobs(&db, "d2", 200, 1).await;
        ack(&db, "d2", 0, 3, 210).await;
        // More no-verdict runs than the replay window holds.
        for i in 0..(REPLAY_RUNS + 1) {
            let id = format!("gap-{i}");
            let ts = 1_000 + i * 100;
            run_with_jobs(&db, &id, ts, 1).await;
            ack(&db, &id, 0, 4, ts + 10).await;
        }
        assert_eq!(check_row(&db).await.0.down_runs, 2);
        // A late no-verdict run replays a window with no Up verdict: the failure goes on.
        run_with_jobs(&db, "late-gap", 300, 1).await;
        ack(&db, "late-gap", 0, 4, 9_000).await;
        let (row, _) = check_row(&db).await;
        assert_eq!((row.down_runs, row.up_runs), (2, 0));
        assert_eq!(row.recovered_at, 0);
        // A late Up outside the window still moves the stamp, and it ends the failure.
        run_with_jobs(&db, "late-up", 400, 1).await;
        ack(&db, "late-up", 0, 1, 9_500).await;
        let (row, _) = check_row(&db).await;
        assert_eq!(row.recovered_at, 9_500);
        assert_eq!(row.down_runs, 0);
    }

    #[tokio::test]
    async fn a_row_that_an_older_build_wrote_moves_the_stamp_at_the_next_run() {
        let db = db().await;
        run_with_jobs(&db, "d1", 100, 1).await;
        ack(&db, "d1", 0, 3, 110).await;
        assert!(check_row(&db).await.0.signed, "this build signs its writes");
        // An older build finishes a recovery: it writes the streaks, not the signature or stamp.
        db.execute_unprepared(
            "UPDATE synthetics SET status_down_runs = 0, status_up_runs = 1, status_run_ts = 200, \
             last_run_class = 1 WHERE id = 'mon-1'",
        )
        .await
        .unwrap();
        let (row, _) = check_row(&db).await;
        assert!(!row.signed);
        assert_eq!(
            row.recovered_at, 0,
            "the older build did not move the stamp"
        );
        // The next run of this build assumes a recovery that it cannot see.
        run_with_jobs(&db, "d2", 300, 1).await;
        ack(&db, "d2", 0, 3, 310).await;
        let (row, _) = check_row(&db).await;
        assert_eq!(row.recovered_at, 310);
        assert!(row.signed);
    }

    #[tokio::test]
    async fn a_late_recovery_message_moves_the_stamp_past_a_newer_local_run() {
        let db = db().await;
        run_with_jobs(&db, "d1", 500, 1).await;
        ack(&db, "d1", 0, 3, 510).await;
        let older = StatusStreaks {
            last_check_status: 1,
            up_runs: 1,
            run_ts: 300,
            run_class: RunClass::Up.to_db(),
            recovered_at: 320,
            ..StatusStreaks::default()
        };
        assert!(
            synthetics_checks::apply_replicated_streaks(&db, "mon-1", &older)
                .await
                .unwrap()
        );
        let (row, _) = check_row(&db).await;
        assert_eq!(row.run_ts, 500, "the streaks keep the newer local run");
        assert_eq!(row.recovered_at, 320, "the stamp moves anyway");
        let stale = StatusStreaks {
            recovered_at: 100,
            ..older
        };
        assert!(
            !synthetics_checks::apply_replicated_streaks(&db, "mon-1", &stale)
                .await
                .unwrap()
        );
        assert_eq!(check_row(&db).await.0.recovered_at, 320, "never goes down");
    }

    #[tokio::test]
    async fn a_handoff_reset_moves_every_stamp_and_disarms_every_hold() {
        use crate::table::entity::status_page_notices as notices;
        let db = db().await;
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(notices::Entity)))
            .await
            .unwrap();
        let marked = notices::Model {
            id: "n1".into(),
            org_id: "org1".into(),
            kind: 0,
            impact: 0,
            source: 0,
            title: String::new(),
            body: String::new(),
            state: 2,
            starts_at: 0,
            resolved_at: Some(50),
            segments: "[]".into(),
            excluded_from_uptime: true,
            deleted_at: None,
            auto_check_id: Some("mon-1".into()),
            auto_recovery_streak: 0,
            owner: None,
            false_alarm_by: Some("a@b.c".into()),
            false_alarm_at: Some(50),
            false_alarm_reason: Some("probe".into()),
            false_alarm_recovered_at: Some(0),
            created_at: 0,
            updated_at: 0,
        };
        let am: notices::ActiveModel = marked.into();
        am.reset_all().insert(&db).await.unwrap();

        synthetics_checks::reset_false_alarm_holds(&db, 1_000)
            .await
            .unwrap();
        assert_eq!(check_row(&db).await.0.recovered_at, 1_001);
        // Twice, with a clock behind the stamp: it still moves and never repeats a value.
        synthetics_checks::reset_false_alarm_holds(&db, 900)
            .await
            .unwrap();
        assert_eq!(check_row(&db).await.0.recovered_at, 1_002);
        let n = notices::Entity::find_by_id("n1")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(n.false_alarm_recovered_at, None);

        // The rebuilder never writes its old open state over a marked notice.
        crate::table::status_pages::update_notice_runtime(&db, "n1", 1, None, "[]", 0, 2_000)
            .await
            .unwrap();
        let n = notices::Entity::find_by_id("n1")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!((n.state, n.resolved_at), (2, Some(50)));
    }

    #[tokio::test]
    async fn late_up_between_two_downs_rebuilds_the_streak() {
        let db = db().await;
        run_with_jobs(&db, "a", 100, 1).await;
        run_with_jobs(&db, "b", 200, 1).await;
        run_with_jobs(&db, "c", 300, 1).await;
        ack(&db, "a", 0, 3, 400).await.unwrap();
        ack(&db, "c", 0, 3, 500).await.unwrap();
        assert_eq!(check_row(&db).await.0.down_runs, 2);
        let late = ack(&db, "b", 0, 1, 600).await.unwrap();
        let (row, _) = check_row(&db).await;
        assert_eq!(
            (row.down_runs, row.up_runs),
            (1, 0),
            "Down, Up, Down is one Down"
        );
        assert_eq!(
            (row.last_check_status, row.run_ts),
            (3, 300),
            "badge stays the newest run's"
        );
        assert_eq!(late.check_update, Some(row));
    }

    #[tokio::test]
    async fn dead_job_without_completed_at_counts_as_terminal_for_the_sweep() {
        let db = db().await;
        run_with_jobs(&db, "r1", 100, 1).await;
        db.execute(Statement::from_string(
            db.get_database_backend(),
            "UPDATE synthetics_jobs SET status = 2, completed_at = NULL".to_owned(),
        ))
        .await
        .unwrap();
        let swept = finalize_stuck_runs(&db, 100 + 3 * MIN, 2 * MIN)
            .await
            .unwrap();
        assert_eq!(swept.len(), 1);
        assert_eq!(swept[0].run_result, 4);
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
                run_ts: 100,
                run_class: RunClass::Down.to_db(),
                run_class_at: 100,
                tested_at: 100,
                recovered_at: 0,
                signed: true,
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

    fn job(id: &str, status: i32) -> JobOutcome {
        JobOutcome {
            id: id.to_string(),
            status,
            ..Default::default()
        }
    }

    fn errored(id: &str, source: &str) -> JobOutcome {
        JobOutcome {
            error_source: Some(source.to_string()),
            ..job(id, JOB_ERROR)
        }
    }

    fn confirm(id: &str, of: &str, status: i32) -> JobOutcome {
        JobOutcome {
            confirm_of: Some(of.to_string()),
            ..job(id, status)
        }
    }

    #[test]
    fn tally_names_the_failed_locations_of_the_voters() {
        let at = |j: JobOutcome, loc: &str| JobOutcome {
            location: loc.to_string(),
            ..j
        };
        // One of two fails, its confirm job from the same location fails too: one vote.
        let t = tally(
            3,
            &[
                at(job("a", JOB_FAILED), "aws-us-east-1"),
                at(job("b", JOB_PASSED), "aws-us-west-1"),
                at(confirm("c", "a", JOB_FAILED), "aws-us-east-1"),
            ],
        );
        assert_eq!(t.class, RunClass::Partial);
        assert_eq!(t.voters, 2);
        assert_eq!(t.failed_locations, vec!["aws-us-east-1".to_string()]);
        // Both fail: down, both named once, sorted.
        let t = tally(
            2,
            &[
                at(job("b", JOB_FAILED), "aws-us-west-1"),
                at(job("a", JOB_FAILED), "aws-us-east-1"),
            ],
        );
        assert_eq!(t.class, RunClass::Down);
        assert_eq!(
            t.failed_locations,
            vec!["aws-us-east-1".to_string(), "aws-us-west-1".to_string()]
        );
        // A failure its confirm job clears names nothing.
        let t = tally(
            2,
            &[
                at(job("a", JOB_FAILED), "aws-us-east-1"),
                at(confirm("c", "a", JOB_PASSED), "aws-us-west-1"),
            ],
        );
        assert!(t.failed_locations.is_empty());
        // Two environments at one location: one location, not two.
        let t = tally(
            2,
            &[
                at(job("a", JOB_FAILED), "aws-us-east-1"),
                at(job("b", JOB_FAILED), "aws-us-east-1"),
            ],
        );
        assert_eq!((t.voters, t.failed_locations.len()), (1, 1));
    }

    #[test]
    fn tally_gives_each_class() {
        use RunClass::*;
        let cases: Vec<(&str, i32, Vec<JobOutcome>, RunClass)> = vec![
            (
                "all pass",
                2,
                vec![job("a", JOB_PASSED), job("b", JOB_WARNING)],
                Up,
            ),
            (
                "all fail",
                2,
                vec![job("a", JOB_FAILED), job("b", JOB_FAILED)],
                Down,
            ),
            (
                "1 of 2 fails",
                2,
                vec![job("a", JOB_FAILED), job("b", JOB_PASSED)],
                Partial,
            ),
            (
                "fail + ours",
                2,
                vec![job("a", JOB_FAILED), errored("b", "control_plane")],
                Partial,
            ),
            (
                "pass + ours",
                2,
                vec![job("a", JOB_PASSED), errored("b", "queue")],
                Up,
            ),
            (
                "nothing tested",
                2,
                vec![errored("a", "control_plane"), job("b", JOB_DEAD)],
                NotMeasured,
            ),
            ("probe crash", 1, vec![errored("a", "probe")], NotMeasured),
            (
                "config",
                2,
                vec![errored("a", "config"), errored("b", "config")],
                Misconfigured,
            ),
            (
                "2 of 3 fail",
                3,
                vec![
                    job("a", JOB_FAILED),
                    job("b", JOB_FAILED),
                    job("c", JOB_PASSED),
                ],
                Down,
            ),
        ];
        for (name, n, jobs, want) in cases {
            assert_eq!(tally(n, &jobs).class, want, "{name}");
        }
        let pending = JobOutcome {
            status_reason: Some(REASON_CONFIG_REFERENCE_PENDING.to_string()),
            ..errored("a", "config")
        };
        assert_eq!(
            tally(1, &[pending]).class,
            NotMeasured,
            "replication lag is ours"
        );
    }

    #[test]
    fn tally_merges_a_confirm_pair_into_one_vote() {
        // One location, its failure confirmed: job_count is 2 with the confirm job.
        let both_fail = tally(2, &[job("a", JOB_FAILED), confirm("c", "a", JOB_FAILED)]);
        assert_eq!(
            (both_fail.verdict, both_fail.class),
            (Verdict::Down, RunClass::Down)
        );
        assert_eq!(both_fail.run_result, Some(3));
        assert!(!both_fail.confirmed_flaky);

        let confirm_passes = tally(2, &[job("a", JOB_FAILED), confirm("c", "a", JOB_PASSED)]);
        assert_eq!(
            (confirm_passes.verdict, confirm_passes.class),
            (Verdict::Up, RunClass::Up)
        );
        assert_eq!(
            confirm_passes.run_result,
            Some(2),
            "a flaky pass is a warning"
        );
        assert!(confirm_passes.confirmed_flaky);

        // A timed-out confirm job measured nothing, so the failure keeps its vote.
        let timed_out = tally(2, &[job("a", JOB_FAILED), confirm("c", "a", JOB_DEAD)]);
        assert_eq!(
            (timed_out.verdict, timed_out.class),
            (Verdict::Down, RunClass::Down)
        );
        assert!(!timed_out.gap_cause || timed_out.class != RunClass::NotMeasured);

        // Two locations, one failure that its confirm job clears: 2 of 2 healthy.
        let two = tally(
            3,
            &[
                job("a", JOB_FAILED),
                job("b", JOB_PASSED),
                confirm("c", "a", JOB_PASSED),
            ],
        );
        assert_eq!((two.verdict, two.class), (Verdict::Up, RunClass::Up));
        // A confirmed failure below quorum is partial, even with a healthy majority.
        let regional = tally(
            4,
            &[
                job("a", JOB_FAILED),
                job("b", JOB_PASSED),
                job("d", JOB_PASSED),
                confirm("c", "a", JOB_FAILED),
            ],
        );
        assert_eq!(
            (regional.verdict, regional.class),
            (Verdict::Up, RunClass::Partial)
        );
        assert!(regional.has_confirm);
        // No confirm job: the stored run result stands.
        assert_eq!(tally(1, &[job("a", JOB_FAILED)]).run_result, None);
    }

    #[test]
    fn gap_cause_is_control_plane_or_dispatch_only() {
        assert!(tally(1, &[errored("a", "control_plane")]).gap_cause);
        assert!(tally(1, &[errored("a", "dispatch")]).gap_cause);
        assert!(tally(1, &[job("a", JOB_DEAD)]).gap_cause);
        assert!(!tally(1, &[errored("a", "queue")]).gap_cause);
        assert!(!tally(1, &[errored("a", "probe")]).gap_cause);
    }

    #[test]
    fn uptime_counts_only_runs_that_tested_the_site() {
        for (class, counted) in [
            (RunClass::Unknown, false),
            (RunClass::Up, true),
            (RunClass::Partial, true),
            (RunClass::Down, true),
            (RunClass::NotMeasured, false),
            (RunClass::Misconfigured, false),
        ] {
            assert_eq!(class.counts_for_uptime(), counted, "{class:?}");
            assert_eq!(RunClass::from_db(class.to_db()), class);
        }
    }

    async fn set_job(db: &DatabaseConnection, job_id: &str, status: i32, result: Option<&str>) {
        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            "UPDATE synthetics_jobs SET status = $1, result = $2, completed_at = 1 WHERE id = $3",
            [
                Value::from(status),
                Value::from(result.map(str::to_owned)),
                Value::from(job_id.to_owned()),
            ],
        ))
        .await
        .unwrap();
    }

    async fn stored_class(db: &DatabaseConnection) -> (i32, i64) {
        let m = checks::Entity::find_by_id("mon-1")
            .one(db)
            .await
            .unwrap()
            .unwrap();
        (m.last_run_class, m.last_run_class_at)
    }

    #[tokio::test]
    async fn finalize_stores_the_run_class_and_when_it_began() {
        let db = db().await;
        run_with_jobs(&db, "a", 100, 1).await;
        let done = ack(&db, "a", 0, 1, 150).await.unwrap();
        assert_eq!(done.run_class, RunClass::Up);
        assert_eq!(stored_class(&db).await, (1, 100));
        run_with_jobs(&db, "b", 200, 1).await;
        ack(&db, "b", 0, 1, 250).await.unwrap();
        assert_eq!(
            stored_class(&db).await,
            (1, 100),
            "same class keeps its start"
        );

        run_with_jobs(&db, "c", 300, 1).await;
        set_job(
            &db,
            "c-job-0",
            JOB_ERROR,
            Some(r#"{"error_source":"control_plane"}"#),
        )
        .await;
        let done = finalize_run(&db, "c", 4, 350).await.unwrap().unwrap();
        assert_eq!(done.run_class, RunClass::NotMeasured);
        assert!(done.gap_retry);
        assert_eq!(stored_class(&db).await, (4, 300));
        assert_eq!(done.check_update.map(|u| u.run_class), Some(4));
    }

    #[tokio::test]
    async fn an_older_run_cannot_overwrite_a_newer_run_class() {
        let db = db().await;
        run_with_jobs(&db, "old", 100, 1).await;
        run_with_jobs(&db, "new", 200, 1).await;
        ack(&db, "new", 0, 1, 300).await.unwrap();
        set_job(
            &db,
            "old-job-0",
            JOB_ERROR,
            Some(r#"{"error_source":"dispatch"}"#),
        )
        .await;
        let late = finalize_run(&db, "old", 4, 400).await.unwrap().unwrap();
        assert_eq!(late.run_class, RunClass::NotMeasured);
        assert_eq!(stored_class(&db).await, (1, 200));
    }

    async fn job_count(db: &DatabaseConnection, run_id: &str) -> i32 {
        get_run(db, run_id).await.unwrap().unwrap().job_count
    }

    #[tokio::test]
    async fn a_failure_gets_one_confirm_job_from_the_location_that_failed() {
        let db = db().await;
        run_with_jobs(&db, "r", 100, 2).await;
        ack(&db, "r", 1, 1, 150).await;
        complete_job(&db, "r", 0, 3, 200).await;
        let id = add_confirm_job(&db, "r-job-0", 200)
            .await
            .unwrap()
            .expect("a failed job gets a confirm job");
        assert_eq!(job_count(&db, "r").await, 3);
        let confirm_row = jobs::Entity::find_by_id(id.as_str())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            confirm_row.location, "loc-0",
            "runs from the location that failed, not the one that passed"
        );
        assert_eq!(confirm_row.status, 0);
        assert_eq!(confirm_row.scheduled_ts, 200, "runs at once");
        assert!(
            add_confirm_job(&db, "r-job-0", 210)
                .await
                .unwrap()
                .is_none(),
            "one confirm job per failed job"
        );
        assert!(
            add_confirm_job(&db, &id, 210).await.unwrap().is_none(),
            "a confirm job never gets its own"
        );

        // The failed job's ack does not complete the run: it waits for the confirm job.
        assert!(finalize_run(&db, "r", 3, 200).await.unwrap().is_none());
        set_job(&db, &id, JOB_PASSED, None).await;
        let done = finalize_run(&db, "r", 1, 300).await.unwrap().unwrap();
        assert_eq!(done.run_class, RunClass::Up);
        assert!(done.confirmed_flaky);
        assert!(done.had_confirm);
        assert_eq!(done.run_result, 2);
        assert_eq!(
            get_run(&db, "r").await.unwrap().unwrap().run_result,
            Some(2),
            "the run history shows the merged vote"
        );
    }

    #[tokio::test]
    async fn a_single_location_confirms_from_itself_and_a_timeout_keeps_the_failure() {
        let db = db().await;
        run_with_jobs(&db, "r", 100, 1).await;
        complete_job(&db, "r", 0, 3, 200).await;
        let id = add_confirm_job(&db, "r-job-0", 200).await.unwrap().unwrap();
        let row = jobs::Entity::find_by_id(id.as_str())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.location, "loc-0");
        assert!(finalize_run(&db, "r", 3, 200).await.unwrap().is_none());
        // The reaper dead-letters the confirm job.
        set_job(&db, &id, JOB_DEAD, None).await;
        let done = finalize_run(&db, "r", 4, 900).await.unwrap().unwrap();
        assert_eq!(done.run_class, RunClass::Down);
        assert_eq!(done.verdict, Verdict::Down);
        assert!(!done.gap_retry, "the site was tested");
    }

    #[tokio::test]
    async fn a_completed_run_gets_no_confirm_job() {
        let db = db().await;
        run_with_jobs(&db, "r", 100, 1).await;
        ack(&db, "r", 0, 3, 200).await.unwrap();
        assert!(
            add_confirm_job(&db, "r-job-0", 300)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(job_count(&db, "r").await, 1);
    }

    #[tokio::test]
    async fn a_not_measured_run_gets_one_extra_run_that_never_chains() {
        let db = db().await;
        run_with_jobs(&db, "r", 100, 2).await;
        let new_run = add_gap_retry_run(&db, "r", 1_000, MIN)
            .await
            .unwrap()
            .expect("one extra run");
        let extra = get_run(&db, &new_run).await.unwrap().unwrap();
        assert_eq!(extra.trigger_type, TRIGGER_GAP_RETRY);
        assert_eq!(extra.scheduled_ts, 1_000 + MIN);
        assert_eq!(extra.job_count, 2);
        let jobs = jobs::Entity::find()
            .filter(jobs::Column::RunId.eq(new_run.as_str()))
            .all(&db)
            .await
            .unwrap();
        assert_eq!(jobs.len(), 2);

        // The extra run measures nothing either: it is not a scheduled run, so no further run.
        for j in &jobs {
            set_job(
                &db,
                &j.id,
                JOB_ERROR,
                Some(r#"{"error_source":"control_plane"}"#),
            )
            .await;
        }
        let done = finalize_stuck_runs(&db, 1_000 + 10 * MIN, 2 * MIN)
            .await
            .unwrap();
        let extra_done = done.iter().find(|d| d.run_id == new_run).unwrap();
        assert_eq!(extra_done.run_class, RunClass::NotMeasured);
        assert!(!extra_done.gap_retry);
        assert!(
            add_gap_retry_run(&db, &new_run, 2_000, MIN)
                .await
                .unwrap()
                .is_none()
        );
    }
}
