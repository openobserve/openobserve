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

//! DB functions for `synthetics_pending_checks`.
//!
//! All operations use raw SQL. Sea-orm's query builder does not support
//! `FOR UPDATE SKIP LOCKED` or `RETURNING`, which are both required here.
//! No `get_lock()` — SKIP LOCKED handles concurrency at the DB level.

use sea_orm::{ConnectionTrait, DbErr, Statement, Value};

use crate::errors;

// ── Types ─────────────────────────────────────────────────────────────────────

pub struct EnqueueParams<'a> {
    pub monitor_id: &'a str,
    pub org_id: &'a str,
    pub location: &'a str,
    pub pool: &'a str,
    /// `None` for protocol monitors; `Some("chromium"|"firefox"|"edge")` for browser.
    pub browser_engine: Option<&'a str>,
    /// `None` for protocol monitors; `Some("laptop_large"|"tablet"|"mobile_small")` for browser.
    pub device: Option<&'a str>,
    pub scheduled_ts: i64,
    pub valid_until: i64,
}

pub struct LeasedRow {
    pub id: i64,
    pub monitor_id: String,
    pub org_id: String,
    pub location: String,
    pub pool: String,
    pub browser_engine: Option<String>,
    pub device: Option<String>,
    pub scheduled_ts: i64,
    pub valid_until: i64,
}

// ── Scheduler: enqueue ────────────────────────────────────────────────────────

/// Inserts one pending check row. ON CONFLICT DO NOTHING prevents double-scheduling.
pub async fn enqueue<C: ConnectionTrait>(
    conn: &C,
    p: EnqueueParams<'_>,
) -> Result<(), errors::Error> {
    let sql = r#"
        INSERT INTO synthetics_pending_checks
            (monitor_id, org_id, location, pool, browser_engine, device,
             scheduled_ts, valid_until, status, attempts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0)
        ON CONFLICT (monitor_id, location, pool, device, scheduled_ts) DO NOTHING
    "#;

    conn.execute(Statement::from_sql_and_values(
        conn.get_database_backend(),
        sql,
        [
            Value::from(p.monitor_id),
            Value::from(p.org_id),
            Value::from(p.location),
            Value::from(p.pool),
            p.browser_engine
                .map(Value::from)
                .unwrap_or(Value::from(None::<String>)),
            p.device
                .map(Value::from)
                .unwrap_or(Value::from(None::<String>)),
            Value::from(p.scheduled_ts),
            Value::from(p.valid_until),
        ],
    ))
    .await?;

    Ok(())
}

/// Gets a single pending check by its ID. Used by the job API `resolve` endpoint.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    id: i64,
) -> Result<Option<LeasedRow>, errors::Error> {
    let sql = r#"
        SELECT id, monitor_id, org_id, location, pool,
               browser_engine, device, scheduled_ts, valid_until
        FROM synthetics_pending_checks
        WHERE id = $1
    "#;
    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(id)],
        ))
        .await?;

    rows.into_iter()
        .next()
        .map(|row| {
            Ok(LeasedRow {
                id: row.try_get("", "id")?,
                monitor_id: row.try_get("", "monitor_id")?,
                org_id: row.try_get("", "org_id")?,
                location: row.try_get("", "location")?,
                pool: row.try_get("", "pool")?,
                browser_engine: row.try_get("", "browser_engine")?,
                device: row.try_get("", "device")?,
                scheduled_ts: row.try_get("", "scheduled_ts")?,
                valid_until: row.try_get("", "valid_until")?,
            })
        })
        .transpose()
        .map_err(errors::Error::from)
}

/// Deletes all pending checks for a monitor (called on monitor delete).
pub async fn drain_monitor<C: ConnectionTrait>(
    conn: &C,
    monitor_id: &str,
) -> Result<u64, errors::Error> {
    let sql = "DELETE FROM synthetics_pending_checks WHERE monitor_id = $1";
    let res = conn
        .execute(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(monitor_id)],
        ))
        .await?;
    Ok(res.rows_affected())
}

// ── Dispatcher: lease ─────────────────────────────────────────────────────────

/// Atomically leases up to `limit` pending checks from a pool using SKIP LOCKED.
/// Sets status=1, records claimed_by/claimed_at, and sets lease_expires_at.
pub async fn lease_batch<C: ConnectionTrait>(
    conn: &C,
    pool: &str,
    claimed_by: &str,
    limit: i64,
    now_us: i64,
    lease_secs: i64,
) -> Result<Vec<LeasedRow>, errors::Error> {
    let lease_expires_at = now_us + lease_secs * 1_000_000;

    let sql = r#"
        UPDATE synthetics_pending_checks SET
            status           = 1,
            claimed_by       = $1,
            claimed_at       = $2,
            lease_expires_at = $3,
            attempts         = attempts + 1
        WHERE id IN (
            SELECT id FROM synthetics_pending_checks
            WHERE pool = $4
              AND status = 0
              AND valid_until > $2
            ORDER BY scheduled_ts
            FOR UPDATE SKIP LOCKED
            LIMIT $5
        )
        RETURNING id, monitor_id, org_id, location, pool,
                  browser_engine, device, scheduled_ts, valid_until
    "#;

    let rows = conn
        .query_all(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [
                Value::from(claimed_by),
                Value::from(now_us),
                Value::from(lease_expires_at),
                Value::from(pool),
                Value::from(limit),
            ],
        ))
        .await?;

    rows.into_iter()
        .map(|row| {
            Ok(LeasedRow {
                id: row.try_get("", "id")?,
                monitor_id: row.try_get("", "monitor_id")?,
                org_id: row.try_get("", "org_id")?,
                location: row.try_get("", "location")?,
                pool: row.try_get("", "pool")?,
                browser_engine: row.try_get("", "browser_engine")?,
                device: row.try_get("", "device")?,
                scheduled_ts: row.try_get("", "scheduled_ts")?,
                valid_until: row.try_get("", "valid_until")?,
            })
        })
        .collect::<Result<Vec<_>, DbErr>>()
        .map_err(errors::Error::from)
}

// ── Job API: ack ──────────────────────────────────────────────────────────────

/// Deletes a leased row when the probe successfully POSTs its result.
/// Returns true if the row was found and deleted.
pub async fn ack_delete<C: ConnectionTrait>(conn: &C, job_id: i64) -> Result<bool, errors::Error> {
    let sql = "DELETE FROM synthetics_pending_checks WHERE id = $1";
    let res = conn
        .execute(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            [Value::from(job_id)],
        ))
        .await?;
    Ok(res.rows_affected() > 0)
}

// ── Reaper ────────────────────────────────────────────────────────────────────

/// Resets expired leases back to Pending (status=0) when attempts < max_attempts.
pub async fn requeue_expired<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    max_attempts: i32,
) -> Result<u64, errors::Error> {
    let sql = r#"
        UPDATE synthetics_pending_checks
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
pub async fn dead_letter_expired<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    max_attempts: i32,
) -> Result<u64, errors::Error> {
    let sql = r#"
        UPDATE synthetics_pending_checks
        SET status = 2
        WHERE status = 1
          AND lease_expires_at < $1
          AND attempts >= $2
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

/// Deletes stale Pending rows whose valid_until has passed (missed entirely).
pub async fn prune_stale<C: ConnectionTrait>(conn: &C, now_us: i64) -> Result<u64, errors::Error> {
    let sql = r#"
        DELETE FROM synthetics_pending_checks
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
            monitor_id: "mon-1",
            org_id: "org1",
            location: "aws-us-east-1",
            pool: "aws-browser-chromium",
            browser_engine: Some("chromium"),
            device: Some("laptop_large"),
            scheduled_ts: 1750000000000000,
            valid_until: 1750000300000000,
        };
        assert_eq!(p.monitor_id, "mon-1");
        assert_eq!(p.browser_engine, Some("chromium"));
        assert_eq!(p.device, Some("laptop_large"));
    }

    #[test]
    fn test_leased_row_fields() {
        let row = LeasedRow {
            id: 42,
            monitor_id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            location: "aws-us-east-1".to_string(),
            pool: "aws".to_string(),
            browser_engine: None,
            device: None,
            scheduled_ts: 1750000000000000,
            valid_until: 1750000300000000,
        };
        assert_eq!(row.id, 42);
        assert!(row.browser_engine.is_none());
        assert!(row.device.is_none());
    }
}
