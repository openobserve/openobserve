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

//! DB functions for `synthetics_jobs`.
//!
//! `lease_batch` uses the sea-orm query builder (SELECT → UPDATE → SELECT)
//! so it works on both SQLite and Postgres without raw SQL dialect branches.
//! Other functions use `Statement::from_sql_and_values` which handles
//! placeholder translation ($N → ?) automatically per backend.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    Statement, Value, sea_query::Expr,
};
use serde::Serialize;
use svix_ksuid::KsuidLike as _;

use super::entity::synthetics_jobs::{Column, Entity};
use crate::errors;

// ── Types ─────────────────────────────────────────────────────────────────────

pub struct EnqueueParams<'a> {
    pub synthetics_id: &'a str,
    pub synthetics_name: &'a str,
    pub org_id: &'a str,
    pub location: &'a str,
    pub pool: &'a str,
    pub scheduled_ts: i64,
    pub valid_until: i64,
    /// KSUID of the parent `synthetics_runs` row.
    pub run_id: &'a str,
    /// JSON array of `{execution_id, engine, device}` — browser monitors only. `None` for
    /// protocol monitors.
    pub browser_devices: Option<&'a str>,
}

#[derive(Debug, Serialize)]
pub struct LeasedRow {
    pub id: String,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub org_id: String,
    pub location: String,
    pub pool: String,
    pub scheduled_ts: i64,
    pub valid_until: i64,
    /// Current attempt number (1-indexed). 1 = first dispatch, 2+ = retry after reaper requeue.
    pub attempts: i32,
    pub run_id: String,
    pub browser_devices: Option<String>,
}

/// Returned by `dead_letter_expired` for each job that exhausted all retries.
#[derive(Debug)]
pub struct DeadLetteredRow {
    pub id: String,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub org_id: String,
    pub location: String,
    pub attempts: i32,
    pub run_id: String,
}

// ── Scheduler: enqueue ────────────────────────────────────────────────────────

/// Inserts one pending check row. ON CONFLICT DO NOTHING prevents double-scheduling.
/// Returns the KSUID assigned to the new job (or empty string on conflict-skip).
pub async fn enqueue<C: ConnectionTrait>(
    conn: &C,
    p: EnqueueParams<'_>,
) -> Result<String, errors::Error> {
    let id = svix_ksuid::Ksuid::new(None, None).to_string();
    let sql = r#"
        INSERT INTO synthetics_jobs
            (id, synthetics_id, synthetics_name, org_id, location, pool,
             scheduled_ts, valid_until, status, attempts, run_id, browser_devices)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $10)
        ON CONFLICT (synthetics_id, location, scheduled_ts) DO NOTHING
    "#;

    conn.execute(Statement::from_sql_and_values(
        conn.get_database_backend(),
        sql,
        [
            Value::from(id.clone()),
            Value::from(p.synthetics_id),
            Value::from(p.synthetics_name),
            Value::from(p.org_id),
            Value::from(p.location),
            Value::from(p.pool),
            Value::from(p.scheduled_ts),
            Value::from(p.valid_until),
            Value::from(p.run_id),
            p.browser_devices
                .map(Value::from)
                .unwrap_or(Value::from(None::<String>)),
        ],
    ))
    .await?;

    Ok(id)
}

/// Gets a single job by its ID. Used by the job API `resolve` and `artifact_urls` endpoints.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<LeasedRow>, errors::Error> {
    let sql = r#"
        SELECT id, synthetics_id, synthetics_name, org_id, location, pool,
               scheduled_ts, valid_until, attempts, run_id, browser_devices
        FROM synthetics_jobs
        WHERE id = $1
    "#;
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(id.to_owned())],
        ))
        .await?;

    rows.into_iter()
        .next()
        .map(|row| -> Result<LeasedRow, DbErr> {
            Ok(LeasedRow {
                id: row.try_get("", "id")?,
                synthetics_id: row.try_get("", "synthetics_id")?,
                synthetics_name: row.try_get("", "synthetics_name")?,
                org_id: row.try_get("", "org_id")?,
                location: row.try_get("", "location")?,
                pool: row.try_get("", "pool")?,
                scheduled_ts: row.try_get("", "scheduled_ts")?,
                valid_until: row.try_get("", "valid_until")?,
                attempts: row.try_get("", "attempts")?,
                run_id: row.try_get("", "run_id")?,
                browser_devices: row.try_get("", "browser_devices")?,
            })
        })
        .transpose()
        .map_err(errors::Error::from)
}

/// Deletes all pending checks for a synthetic (called on monitor delete).
pub async fn drain_monitor<C: ConnectionTrait>(
    conn: &C,
    synthetics_id: &str,
) -> Result<u64, errors::Error> {
    let sql = "DELETE FROM synthetics_jobs WHERE synthetics_id = $1";
    let res = conn
        .execute(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(synthetics_id)],
        ))
        .await?;
    Ok(res.rows_affected())
}

// ── Dispatcher: lease ─────────────────────────────────────────────────────────

/// Leases up to `limit` pending checks from a pool.
///
/// Three steps: SELECT candidate IDs → UPDATE status/lease fields → SELECT
/// full rows. No raw SQL, works on SQLite and Postgres.
pub async fn lease_batch<C: ConnectionTrait>(
    conn: &C,
    pool: &str,
    claimed_by: &str,
    limit: i64,
    now_us: i64,
    lease_secs: i64,
) -> Result<Vec<LeasedRow>, errors::Error> {
    let lease_expires_at = now_us + lease_secs * 1_000_000;

    // Step 1: pick candidate IDs.
    let ids: Vec<String> = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::Pool.eq(pool))
        .filter(Column::Status.eq(0i32))
        .filter(Column::ValidUntil.gt(now_us))
        .order_by_asc(Column::ScheduledTs)
        .limit(limit as u64)
        .into_tuple::<String>()
        .all(conn)
        .await?;

    if ids.is_empty() {
        return Ok(vec![]);
    }

    // Step 2: mark them leased.
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(1i32))
        .col_expr(Column::ClaimedBy, Expr::value(claimed_by))
        .col_expr(Column::ClaimedAt, Expr::value(now_us))
        .col_expr(Column::LeaseExpiresAt, Expr::value(lease_expires_at))
        .col_expr(Column::Attempts, Expr::col(Column::Attempts).add(1i32))
        .filter(Column::Id.is_in(ids.clone()))
        .exec(conn)
        .await?;

    // Step 3: return the leased rows (attempts already incremented).
    let models = Entity::find()
        .filter(Column::Id.is_in(ids))
        .all(conn)
        .await?;

    Ok(models
        .into_iter()
        .map(|m| LeasedRow {
            id: m.id,
            synthetics_id: m.synthetics_id,
            synthetics_name: m.synthetics_name,
            org_id: m.org_id,
            location: m.location,
            pool: m.pool,
            scheduled_ts: m.scheduled_ts,
            valid_until: m.valid_until,
            attempts: m.attempts,
            run_id: m.run_id,
            browser_devices: m.browser_devices,
        })
        .collect())
}

// ── Job API: ack ──────────────────────────────────────────────────────────────

/// Marks a job as complete: sets status, result JSON, and completed_at.
/// Returns the `run_id` of the updated row (for callers to increment run counter).
///
/// Status values: 3=Passed, 4=Failed, 5=Warning, 6=Error (dispatch error).
pub async fn ack_complete<C: ConnectionTrait>(
    conn: &C,
    job_id: &str,
    status: i32,
    result_json: Option<&str>,
    now_us: i64,
) -> Result<Option<String>, errors::Error> {
    let sql = r#"
        UPDATE synthetics_jobs
        SET status = $1, result = $2, completed_at = $3
        WHERE id = $4
    "#;
    conn.execute(Statement::from_sql_and_values(
        conn.get_database_backend(),
        sql,
        [
            Value::from(status),
            result_json
                .map(Value::from)
                .unwrap_or(Value::from(None::<String>)),
            Value::from(now_us),
            Value::from(job_id.to_owned()),
        ],
    ))
    .await?;

    // Fetch run_id so caller can call synthetics_runs::increment_jobs_done.
    let select_sql = "SELECT run_id FROM synthetics_jobs WHERE id = $1";
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            select_sql,
            [Value::from(job_id.to_owned())],
        ))
        .await?;

    Ok(rows
        .into_iter()
        .next()
        .and_then(|row| row.try_get::<String>("", "run_id").ok()))
}

// ── Reaper ────────────────────────────────────────────────────────────────────

/// Resets expired leases back to Pending (status=0) when attempts < max_attempts.
pub async fn requeue_expired<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    max_attempts: i32,
) -> Result<u64, errors::Error> {
    let sql = r#"
        UPDATE synthetics_jobs
        SET status = 0, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
        WHERE status = 1
          AND lease_expires_at < $1
          AND attempts < $2
    "#;
    let res = conn
        .execute(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(now_us), Value::from(max_attempts)],
        ))
        .await?;
    Ok(res.rows_affected())
}

/// Marks permanently failed rows as Dead (status=2) when attempts >= max_attempts.
/// Returns the affected rows so the reaper can update monitor status and write to streams.
pub async fn dead_letter_expired<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    max_attempts: i32,
) -> Result<Vec<DeadLetteredRow>, errors::Error> {
    // Step 1: find candidates before marking them dead.
    let select_sql = r#"
        SELECT id, synthetics_id, synthetics_name, org_id, location, attempts, run_id
        FROM synthetics_jobs
        WHERE status = 1
          AND lease_expires_at < $1
          AND attempts >= $2
    "#;
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            select_sql,
            [Value::from(now_us), Value::from(max_attempts)],
        ))
        .await?;

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let dead: Vec<DeadLetteredRow> = rows
        .into_iter()
        .filter_map(|row| {
            Some(DeadLetteredRow {
                id: row.try_get::<String>("", "id").ok()?,
                synthetics_id: row.try_get("", "synthetics_id").ok()?,
                synthetics_name: row.try_get("", "synthetics_name").ok()?,
                org_id: row.try_get("", "org_id").ok()?,
                location: row.try_get("", "location").ok()?,
                attempts: row.try_get("", "attempts").ok()?,
                run_id: row.try_get("", "run_id").ok()?,
            })
        })
        .collect();

    // Step 2: mark them all dead.
    let ids: Vec<Value> = dead.iter().map(|r| Value::from(r.id.clone())).collect();
    let placeholders: String = ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("${}", i + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let update_sql = format!(
        "UPDATE synthetics_jobs SET status = 2 WHERE id IN ({})",
        placeholders
    );
    conn.execute(Statement::from_sql_and_values(
        conn.get_database_backend(),
        &update_sql,
        ids,
    ))
    .await?;

    Ok(dead)
}

/// Deletes stale Pending rows whose valid_until has passed (missed entirely).
pub async fn prune_stale<C: ConnectionTrait>(conn: &C, now_us: i64) -> Result<u64, errors::Error> {
    let sql = r#"
        DELETE FROM synthetics_jobs
        WHERE status = 0 AND valid_until < $1
    "#;
    let res = conn
        .execute(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(now_us)],
        ))
        .await?;
    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enqueue_params_fields() {
        let p = EnqueueParams {
            synthetics_id: "mon-1",
            synthetics_name: "Login Flow",
            org_id: "org1",
            location: "aws-us-east-1",
            pool: "aws-browser",
            scheduled_ts: 1750000000000000,
            valid_until: 1750000300000000,
            run_id: "3Fzn001XXXXXXXXXXXXXXXX",
            browser_devices: Some(
                r#"[{"execution_id":"3Fze001XX","engine":"chromium","device":"laptop_large"}]"#,
            ),
        };
        assert_eq!(p.synthetics_id, "mon-1");
        assert_eq!(p.synthetics_name, "Login Flow");
        assert_eq!(p.run_id, "3Fzn001XXXXXXXXXXXXXXXX");
        assert!(p.browser_devices.is_some());
    }

    #[test]
    fn test_leased_row_fields() {
        let row = LeasedRow {
            id: "2MNfNTxePfZ1pnY5gKVLkwsVRXv".to_string(),
            synthetics_id: "mon-1".to_string(),
            synthetics_name: "Login Flow".to_string(),
            org_id: "org1".to_string(),
            location: "aws-us-east-1".to_string(),
            pool: "aws-browser".to_string(),
            scheduled_ts: 1750000000000000,
            valid_until: 1750000300000000,
            attempts: 1,
            run_id: "3Fzn001XXXXXXXXXXXXXXXX".to_string(),
            browser_devices: None,
        };
        assert_eq!(row.id, "2MNfNTxePfZ1pnY5gKVLkwsVRXv");
        assert_eq!(row.synthetics_id, "mon-1");
        assert_eq!(row.run_id, "3Fzn001XXXXXXXXXXXXXXXX");
        assert_eq!(row.attempts, 1);
    }
}
