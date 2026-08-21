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
//! Each job acks via `increment_jobs_done`; when `jobs_done = job_count` the run is
//! complete and `completed_at` is set.

use sea_orm::{ConnectionTrait, Statement, Value};

use super::get_lock;
use crate::errors;

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

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

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

/// Records one job's outcome against its run, and returns `Some((run_result,
/// job_count))` **only to the caller that actually completed the run** — `None`
/// to everyone else.
///
/// `job_result` uses SyntheticStatus DB integers: 1=Passed, 2=Warning, 3=Failed, 4=Error.
/// Higher integer = higher severity, so the `CASE` naturally keeps the worst.
///
/// # Why completion is claimed rather than observed
///
/// The increment was always atomic (`jobs_done = jobs_done + 1` is computed by
/// the database). **The completion decision was not:** it re-read the row in a
/// second statement and returned `Some` whenever `jobs_done >= job_count`. Two
/// jobs of the same run acking concurrently both saw the final count:
///
/// ```text
/// ack A: UPDATE -> jobs_done = 1
/// ack B: UPDATE -> jobs_done = 2
/// ack A: SELECT -> 2 >= 2 -> Some   "I completed the run"
/// ack B: SELECT -> 2 >= 2 -> Some   "I completed the run"   <-- twice
/// ```
///
/// Everything the caller does on completion then happened twice: the run
/// rollup, the check status write, and the alert dispatch — a duplicate
/// customer-facing notification. This did not require multiple scheduler nodes to
/// reach: acks are served on ingesters (2 replicas in every environment) and the
/// probes of one run finish independently.
///
/// Now `completed_at` is the guard. Exactly one caller flips it from NULL, and
/// only that caller is told the run is complete. `completed_at IS NULL` is a
/// compare-and-swap in the same shape as `synthetics_jobs::lease_batch`'s
/// `status = 0`.
///
/// Deliberately not `RETURNING` (which would fold this into one statement):
/// SQLite only gained it in 3.35 and the bundled version is not pinned here,
/// whereas a guarded UPDATE plus `rows_affected` behaves identically on every
/// backend.
pub async fn increment_jobs_done<C: ConnectionTrait>(
    conn: &C,
    run_id: &str,
    job_result: i32,
    now_us: i64,
) -> Result<Option<(i32, i32)>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite).
    // One lock across all three steps — the guard drops at fn end.
    let _lock = get_lock().await;

    // Step 1: count this job and fold its severity in.
    //
    // `jobs_done < job_count` stops a duplicate or replayed ack from pushing the
    // counter past the total, which would leave the run permanently "over
    // complete" and, before the guard below existed, complete it twice.
    let update_sql = r#"
        UPDATE synthetics_runs
        SET
            jobs_done = jobs_done + 1,
            run_result = CASE
                WHEN COALESCE(run_result, 0) >= $1 THEN run_result
                ELSE $1
            END
        WHERE id = $2 AND jobs_done < job_count
    "#;
    conn.execute(Statement::from_sql_and_values(
        conn.get_database_backend(),
        update_sql,
        [Value::from(job_result), Value::from(run_id.to_owned())],
    ))
    .await?;

    // Step 2: claim completion. Only the caller whose increment brought
    // `jobs_done` up to `job_count` finds `completed_at` still NULL.
    let complete_sql = r#"
        UPDATE synthetics_runs
        SET completed_at = $1
        WHERE id = $2 AND jobs_done >= job_count AND completed_at IS NULL
    "#;
    let claimed = conn
        .execute(Statement::from_sql_and_values(
            conn.get_database_backend(),
            complete_sql,
            [Value::from(now_us), Value::from(run_id.to_owned())],
        ))
        .await?
        .rows_affected();

    if claimed == 0 {
        // Either jobs are still outstanding, or another ack already completed
        // this run. Both mean: not ours to report.
        return Ok(None);
    }

    // Step 3: we own the completion, so read back what the caller needs to
    // report. Safe to read outside a transaction — nothing rewrites these two
    // once `completed_at` is set.
    let check_sql = r#"
        SELECT job_count, run_result FROM synthetics_runs WHERE id = $1
    "#;
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            check_sql,
            [Value::from(run_id.to_owned())],
        ))
        .await?;

    match rows.into_iter().next() {
        Some(row) => {
            let count: i32 = row.try_get("", "job_count").unwrap_or(1);
            let result: Option<i32> = row.try_get("", "run_result").unwrap_or(None);
            Ok(Some((result.unwrap_or(job_result), count)))
        }
        None => Ok(None),
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

    /// One raw row as `query_all` sees it — the completion read-back selects
    /// only these two columns.
    fn run_row(
        job_count: i32,
        run_result: i32,
    ) -> std::collections::BTreeMap<String, sea_orm::Value> {
        let mut m = std::collections::BTreeMap::new();
        m.insert("job_count".to_owned(), sea_orm::Value::from(job_count));
        m.insert("run_result".to_owned(), sea_orm::Value::from(run_result));
        m
    }

    /// Two acks of the same run must not both be told they completed it.
    /// Before `completed_at` became the guard, both re-read `jobs_done >=
    /// job_count` and both returned Some — so the run rollup, the check status
    /// write and the ALERT all fired twice.
    #[tokio::test]
    async fn test_only_one_ack_is_told_it_completed_the_run() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        // Ack A: increment succeeds, and it wins the completed_at claim.
        let winner = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }, // increment
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }, // claimed completion
            ])
            .append_query_results(vec![vec![run_row(2, 3)]])
            .into_connection();
        let a = increment_jobs_done(&winner, "run-1", 3, 100).await.unwrap();
        assert_eq!(a, Some((3, 2)), "the ack that completed the run reports it");

        // Ack B: increment is a no-op (already at job_count) and the
        // completed_at claim matches nothing, because A already set it.
        let loser = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 0,
                }, // increment guarded out
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 0,
                }, // completion already claimed
            ])
            .into_connection();
        let b = increment_jobs_done(&loser, "run-1", 3, 100).await.unwrap();
        assert_eq!(
            b, None,
            "a second ack must NOT be told it completed the run — that is the duplicate alert"
        );
    }

    /// A run with jobs still outstanding reports nothing: the completion claim
    /// matches no row because `jobs_done < job_count`.
    #[tokio::test]
    async fn test_incomplete_run_reports_none() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                }, // counted
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 0,
                }, // not complete yet
            ])
            .into_connection();
        assert_eq!(
            increment_jobs_done(&db, "run-1", 1, 100).await.unwrap(),
            None
        );
    }

    /// The completion claim must guard on `completed_at IS NULL` — that clause
    /// is the entire fix.
    #[tokio::test]
    async fn test_completion_claim_guards_on_completed_at() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 0,
                },
            ])
            .into_connection();
        let _ = increment_jobs_done(&db, "run-1", 1, 100).await.unwrap();

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(
            sql.contains("completed_at IS NULL"),
            "without this guard both acks complete the run: {sql}"
        );
        assert!(
            sql.contains("jobs_done < job_count"),
            "the increment must be guarded so a replayed ack cannot overshoot: {sql}"
        );
    }
}
