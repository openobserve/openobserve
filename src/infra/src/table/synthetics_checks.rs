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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::{
    RwHashMap,
    meta::synthetics::{
        BrowserConfig, ListSyntheticsParams, Synthetic, SyntheticAuth, SyntheticCookie,
        SyntheticFrequency, SyntheticSettings, SyntheticStatus, SyntheticType, SyntheticVariable,
    },
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait, TryIntoModel, prelude::Expr,
};
use serde::{Deserialize, Serialize};

use super::entity::synthetics_checks::{self, ActiveModel, Column, Entity};
use crate::errors;

/// `org_id/synthetics_id` → the synthetic check **definition**, with load time.
///
/// The probe job path reads a check twice per job — once at `resolve` to build
/// the `CheckJob`, once at `ack` for its type and destinations — which is the
/// single biggest per-job read in the feature (~400/min at 100 checks). The
/// definition changes only when a user edits the check.
///
/// **This cache backs [`get_cached`] only, never [`get`].** The distinction is
/// load-bearing: `Synthetic` carries `next_run_at` and `last_check_status`
/// alongside the definition, and those are rewritten on *every run* by
/// `advance_schedule` / `update_last_check_status`. Invalidating on those would
/// make the cache useless (they fire at the same rate as the reads it serves),
/// so instead they deliberately do **not** invalidate — and callers that need
/// scheduling or status state must use [`get`], `fetch_due` or `get_alert_state`.
static SYNTHETIC_CACHE: LazyLock<RwHashMap<String, (Synthetic, Instant)>> =
    LazyLock::new(Default::default);

const SYNTHETIC_CACHE_TTL: Duration = Duration::from_secs(15);

fn synthetic_cache_key(org_id: &str, id: &str) -> String {
    format!("{org_id}/{id}")
}

/// Drops one check from the definition cache. Called by every path that edits
/// a definition, so an edit is visible on this node immediately.
pub fn invalidate_cache(org_id: &str, id: &str) {
    SYNTHETIC_CACHE.remove(&synthetic_cache_key(org_id, id));
}

/// Drops the whole definition cache. Used where a write may touch many rows.
pub fn invalidate_all_cache() {
    SYNTHETIC_CACHE.clear();
}

/// Invalidates locally **and** tells every other node to do the same.
///
/// Write paths call this; the coordinator watcher calls the plain
/// [`invalidate_cache`], which is what stops an event from echoing forever.
///
/// A failed emit is logged, not propagated: the database write has already
/// committed, and the cache TTL is the backstop for a dropped event. Failing
/// the user's save because a cache hint did not send would be the worse trade.
async fn invalidate_and_publish(org_id: &str, id: &str) {
    invalidate_cache(org_id, id);
    if let Err(e) = crate::coordinator::synthetics::emit_check_put(org_id, id).await {
        log::error!("[synthetics] emit check cache event failed for {org_id}/{id}: {e}");
    }
}

/// Same as [`invalidate_and_publish`], but emits a *delete* event.
///
/// Both events invalidate identically on the receiving side, so this is not
/// about the handler — it is about the coordinator's key store. `emit_*_put`
/// writes a key; only a delete event removes it. Publishing a put on the delete
/// path would leave one dead key per check ever created, growing without bound.
async fn invalidate_and_publish_delete(org_id: &str, id: &str) {
    invalidate_cache(org_id, id);
    if let Err(e) = crate::coordinator::synthetics::emit_check_delete(org_id, id).await {
        log::error!("[synthetics] emit check delete event failed for {org_id}/{id}: {e}");
    }
}

// ── TryFrom: ORM model → meta type ───────────────────────────────────────────

impl TryFrom<synthetics_checks::Model> for Synthetic {
    type Error = errors::Error;

    fn try_from(m: synthetics_checks::Model) -> Result<Self, Self::Error> {
        let check_type: SyntheticType = serde_json::from_value(serde_json::Value::String(
            m.synthetics_type.clone(),
        ))
        .map_err(|e| {
            errors::Error::Message(format!(
                "invalid synthetics_type '{}': {e}",
                m.synthetics_type
            ))
        })?;

        let locations: Vec<String> = serde_json::from_value(m.locations)
            .map_err(|e| errors::Error::Message(format!("invalid locations JSON: {e}")))?;

        let destinations: Vec<String> = serde_json::from_value(m.destinations)
            .map_err(|e| errors::Error::Message(format!("invalid destinations JSON: {e}")))?;

        let tags: Vec<String> = serde_json::from_value(m.tags).unwrap_or_default();

        let frequency: SyntheticFrequency = serde_json::from_value(m.frequency).unwrap_or_default();

        let settings: SyntheticSettings = serde_json::from_value(m.settings).unwrap_or_default();

        let stored: StoredSecrets = serde_json::from_str(&m.secrets).unwrap_or_default();
        let auth = stored.auth;
        let cookies = stored.cookies;
        let variables = stored.variables;
        let config_secrets = stored.config;

        let last_check_status = SyntheticStatus::from_db(m.last_check_status);

        Ok(Synthetic {
            id: m.id,
            org_id: m.org_id,
            folder_id: m.folder_id,
            tz_offset: m.tz_offset,
            name: m.name,
            description: m.description,
            tags,
            check_type,
            target: m.target,
            config: m.config,
            frequency,
            locations,
            enabled: m.enabled,
            destinations,
            retries: settings.retries,
            cooldown_mins: settings.cooldown_mins,
            wait_before_retry_secs: settings.wait_before_retry_secs,
            alert_if_fails: settings.alert_if_fails,
            collect_rum_data: settings.collect_rum_data,
            session_replay: settings.session_replay,
            auth,
            cookies,
            variables,
            config_secrets,
            start: settings.start,
            next_run_at: m.next_run_at,
            last_triggered_at: m.last_triggered_at,
            last_check_status,
            owner: m.owner,
            created_at: m.created_at,
            updated_at: m.updated_at,
        })
    }
}

// ── Public CRUD API ───────────────────────────────────────────────────────────

/// Reads a check straight from the database. Every field is current, including
/// `next_run_at` and `last_check_status`.
///
/// Use this anywhere scheduling or status state matters. For the probe job path,
/// which only needs the definition, prefer [`get_cached`].
pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    let maybe = get_model(conn, org_id, id).await?;
    maybe.map(Synthetic::try_from).transpose()
}

/// Reads a check **definition**, served from [`SYNTHETIC_CACHE`] when fresh.
///
/// Intended for the probe job path (`resolve`, `ack`), which needs `config`,
/// `check_type`, `target`, `destinations` and the retry settings — all of
/// which change only on a user edit.
///
/// # Staleness contract
///
/// - **Definition fields are correct**, within `SYNTHETIC_CACHE_TTL` of an edit made on another
///   node, and immediately for an edit made on this one.
/// - **`next_run_at` and `last_check_status` may be stale by design.** They are rewritten every run
///   and this cache is not invalidated when they change. Read them via [`get`], [`fetch_due`] or
///   [`get_alert_state`] instead.
///
/// A missing check is not cached — a resolve for a deleted check should keep
/// reaching the DB and failing loudly rather than being served from memory.
pub async fn get_cached<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Synthetic>, errors::Error> {
    let key = synthetic_cache_key(org_id, id);
    if let Some(entry) = SYNTHETIC_CACHE.get(&key)
        && entry.1.elapsed() < SYNTHETIC_CACHE_TTL
    {
        return Ok(Some(entry.0.clone()));
    }

    let found = get(conn, org_id, id).await?;
    if let Some(synthetic) = &found {
        SYNTHETIC_CACHE.insert(key, (synthetic.clone(), Instant::now()));
    }
    Ok(found)
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<Vec<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    list_models(conn, org_id, params)
        .await?
        .into_iter()
        .map(Synthetic::try_from)
        .collect()
}

pub async fn count<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<u64, errors::Error> {
    let _lock = super::get_lock().await;
    let q = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .apply_filters(params);
    Ok(q.count(conn).await?)
}

/// Counts synthetics (any org) whose `locations` JSON array contains the given
/// location id — used to reject deleting a location that is still referenced.
/// Scans the locations column in Rust: the table is small (hundreds of rows)
/// and JSON LIKE semantics differ across Postgres/MySQL/SQLite.
pub async fn count_referencing_location<C: ConnectionTrait>(
    conn: &C,
    location_id: &str,
) -> Result<u64, errors::Error> {
    let rows: Vec<serde_json::Value> = Entity::find()
        .select_only()
        .column(Column::Locations)
        .into_tuple()
        .all(conn)
        .await?;
    Ok(rows
        .iter()
        .filter(|locs| {
            locs.as_array()
                .map(|a| a.iter().any(|v| v.as_str() == Some(location_id)))
                .unwrap_or(false)
        })
        .count() as u64)
}

/// Synthetics in one org whose `locations` array contains the given location
/// id. Filtered in Rust for the same cross-DB reason as
/// `count_referencing_location`; the per-org set is small.
pub async fn list_referencing_location<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    location_id: &str,
) -> Result<Vec<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    let models = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(conn)
        .await?;
    let mut out = Vec::new();
    for m in models {
        let s = Synthetic::try_from(m)?;
        if s.locations.iter().any(|l| l == location_id) {
            out.push(s);
        }
    }
    Ok(out)
}

pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    check: Synthetic,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();
    let id = config::ider::uuid();

    let mut am = build_active_model(&check)?;
    am.id = Set(id);
    am.org_id = Set(org_id.to_owned());
    am.folder_id = Set(check.folder_id.clone());
    am.synthetics_type = Set(check_type_to_str(&check.check_type).to_owned());
    am.created_at = Set(now);
    am.updated_at = Set(now);
    am.next_run_at = Set(check.start.unwrap_or(0));
    am.owner = Set(check.owner.clone());

    let model = am.insert(&txn).await?.try_into_model()?;
    let result = Synthetic::try_from(model)?;
    txn.commit().await?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish(&result.org_id, &result.id).await;
    Ok(result)
}

pub async fn update<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    check: Synthetic,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;

    let Some(m) = get_model(&txn, org_id, id).await? else {
        return Err(errors::Error::Message(format!("check not found: {id}")));
    };

    let mut am: ActiveModel = m.into();
    update_mutable_fields(&mut am, &check)?;
    am.updated_at = Set(config::utils::time::now_micros());

    let model = am.update(&txn).await?.try_into_model()?;
    let result = Synthetic::try_from(model)?;
    txn.commit().await?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish(&result.org_id, &result.id).await;
    Ok(result)
}

pub async fn put<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    check: Synthetic,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();

    let result = match get_model(&txn, org_id, &check.id).await? {
        Some(m) => {
            let mut am: ActiveModel = m.into();
            update_mutable_fields(&mut am, &check)?;
            am.updated_at = Set(now);
            let model = am.update(&txn).await?.try_into_model()?;
            Synthetic::try_from(model)?
        }
        None => {
            let mut am = build_active_model(&check)?;
            am.id = Set(check.id.clone());
            am.org_id = Set(org_id.to_owned());
            am.folder_id = Set(check.folder_id.clone());
            am.synthetics_type = Set(check_type_to_str(&check.check_type).to_owned());
            am.created_at = Set(now);
            am.updated_at = Set(now);
            let model = am.insert(&txn).await?.try_into_model()?;
            Synthetic::try_from(model)?
        }
    };

    txn.commit().await?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish(&result.org_id, &result.id).await;
    Ok(result)
}

pub async fn delete<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let _lock = super::get_lock().await;
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish_delete(org_id, id).await;
    Ok(res.rows_affected > 0)
}

/// Moves a batch of checks to a different folder.
pub async fn move_to_folder<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    ids: &[String],
    dst_folder_id: &str,
) -> Result<u64, errors::Error> {
    let _lock = super::get_lock().await;
    if ids.is_empty() {
        return Ok(0);
    }
    let res = Entity::update_many()
        .col_expr(Column::FolderId, Expr::value(dst_folder_id.to_owned()))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.is_in(ids.to_vec()))
        .exec(conn)
        .await?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    for id in ids {
        invalidate_and_publish(org_id, id).await;
    }
    Ok(res.rows_affected)
}

/// Sets the `enabled` flag — used by the enable/pause API.
pub async fn set_enabled<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    enabled: bool,
) -> Result<bool, errors::Error> {
    let _lock = super::get_lock().await;
    let res = Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    // Release the SQLite write mutex BEFORE emitting. On a sqlite meta_store
    // the coordinator's put() takes the *same* CLIENT_RW lock `get_lock()`
    // returns, so emitting while holding it deadlocks the process — and the
    // mutex is then held forever, hanging every later synthetics query.
    drop(_lock);
    invalidate_and_publish(org_id, id).await;
    Ok(res.rows_affected > 0)
}

// ── Scheduler helpers ─────────────────────────────────────────────────────────

/// Scheduler's fan-out data — the subset of Synthetic fields the scheduler needs.
pub struct DueCheck {
    pub id: String,
    pub name: String,
    pub org_id: String,
    pub check_type: SyntheticType,
    pub locations: Vec<String>,
    pub frequency: SyntheticFrequency,
    /// Minutes from UTC — used for cron scheduling. 0 = UTC.
    pub tz_offset: i32,
    /// The scheduled due time that made this check eligible. The scheduler
    /// anchors the NEXT run to this (fixed-rate) instead of `now`, so the tick
    /// lag doesn't accumulate into schedule drift.
    pub next_run_at: i64,
    /// Populated only for browser checks (parsed from config.browser_devices).
    pub browser_devices: Vec<config::meta::synthetics::BrowserDevice>,
    pub tags: Vec<String>,
}

/// Returns up to `limit` enabled checks whose `next_run_at` is at or before `now_us`.
/// Ordered by next_run_at ASC so the most overdue fire first.
///
/// NOTE: Does not use FOR UPDATE SKIP LOCKED — the scheduler is single-node on alert_manager.
/// If multi-node scheduling is needed, convert to a raw SQL query with SKIP LOCKED.
pub async fn fetch_due<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<DueCheck>, errors::Error> {
    let _lock = super::get_lock().await;
    let models = Entity::find()
        .filter(Column::Enabled.eq(true))
        .filter(Column::NextRunAt.lte(now_us))
        .order_by_asc(Column::NextRunAt)
        .limit(limit)
        .all(conn)
        .await?;

    models
        .into_iter()
        .map(|m| {
            let check_type: SyntheticType =
                serde_json::from_value(serde_json::Value::String(m.synthetics_type.clone()))
                    .map_err(|e| {
                        errors::Error::Message(format!(
                            "invalid synthetics_type '{}' for {}: {e}",
                            m.synthetics_type, m.id
                        ))
                    })?;

            let locations: Vec<String> = serde_json::from_value(m.locations).map_err(|e| {
                errors::Error::Message(format!("invalid locations for {}: {e}", m.id))
            })?;

            let frequency: SyntheticFrequency =
                serde_json::from_value(m.frequency).unwrap_or_default();

            let browser_devices = if check_type == SyntheticType::Browser {
                let cfg: BrowserConfig = serde_json::from_value(m.config).unwrap_or_default();
                cfg.browser_devices
            } else {
                vec![]
            };

            let tags: Vec<String> = serde_json::from_value(m.tags).unwrap_or_default();

            Ok(DueCheck {
                id: m.id,
                name: m.name,
                org_id: m.org_id,
                check_type,
                locations,
                frequency,
                tz_offset: m.tz_offset,
                next_run_at: m.next_run_at,
                browser_devices,
                tags,
            })
        })
        .collect()
}

/// Updates `last_triggered_at` and `next_run_at` after the scheduler fans out a check.
/// Unconditionally sets a check's schedule. For user-initiated changes (edit,
/// disable, run-now), where the user's action must always win.
///
/// **Schedulers must not use this** — see [`try_claim_slot`].
pub async fn advance_schedule<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    last_triggered_at: i64,
    next_run_at: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::LastTriggeredAt, Expr::value(last_triggered_at))
        .col_expr(Column::NextRunAt, Expr::value(next_run_at))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Claims a check's due slot by advancing its schedule, returning whether THIS
/// caller won it.
///
/// `expected_next_run_at` is the `next_run_at` the caller read in `fetch_due`.
/// The UPDATE only matches while the row still holds that value, so of N
/// schedulers racing the same slot exactly one gets `rows_affected == 1` and the
/// rest get 0. This is a compare-and-swap, the same shape as
/// `synthetics_jobs::lease_batch`'s `status = 0` guard.
///
/// Without it, `fetch_due` is a plain SELECT and every alert_manager node fired
/// every due check: each inserted its own `synthetics_runs` row under a fresh
/// KSUID, so the rows were genuinely distinct and no unique constraint
/// downstream could collapse them. Two nodes meant every check ran twice —
/// double probe cost, double records, double alert evaluation. Latent only
/// because every environment happens to run `alertmanager 1/1`; scaling for HA
/// would have silently doubled the fleet.
///
/// Callers MUST treat `false` as "another node owns this slot" and do nothing
/// further — no run row, no jobs.
///
/// Deliberately a CAS rather than `SELECT … FOR UPDATE SKIP LOCKED` (which the
/// design proposed): SKIP LOCKED is Postgres-only and this table is also served
/// by SQLite and MySQL. A CAS is portable, holds no lock across the fan-out, and
/// gives the same exactly-once-per-slot guarantee. Synthetic checks are
/// order-independent, so the advisory lock the OSS alert scheduler adds for
/// strict FIFO (`scheduler/postgres.rs:672`) is not needed here.
pub async fn try_claim_slot<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    last_triggered_at: i64,
    next_run_at: i64,
    expected_next_run_at: i64,
) -> Result<bool, errors::Error> {
    let res = Entity::update_many()
        .col_expr(Column::LastTriggeredAt, Expr::value(last_triggered_at))
        .col_expr(Column::NextRunAt, Expr::value(next_run_at))
        .filter(Column::Id.eq(id))
        .filter(Column::NextRunAt.eq(expected_next_run_at))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Updates `last_check_status` after a probe acks a job.
pub async fn update_last_check_status<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    status: i32,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::LastCheckStatus, Expr::value(status))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

/// The alert bookkeeping a completed run needs in order to decide whether to
/// notify. Read and written by the ack path only.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AlertState {
    /// Runs that failed back to back. Reset to 0 by a pass.
    pub consecutive_failures: i32,
    /// When a notification was last sent, in microseconds. 0 = never.
    pub last_alert_at: i64,
    /// Whether the check is currently in the alerting state.
    pub alerting: bool,
    /// When a degradation was last reported, in microseconds. 0 = not currently
    /// degraded. Degradation persists for as long as the certificate takes to
    /// expire, so it is suppressed by transition rather than by a time window.
    pub degraded_notified_at: i64,
}

/// Reads the alert state without pulling the whole check (config, secrets and
/// step definitions are several KB, and this runs on every ack).
pub async fn get_alert_state<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<AlertState>, errors::Error> {
    let row = Entity::find_by_id(id)
        .select_only()
        .column(Column::ConsecutiveFailures)
        .column(Column::LastAlertAt)
        .column(Column::Alerting)
        .column(Column::DegradedNotifiedAt)
        .into_tuple::<(i32, i64, bool, i64)>()
        .one(conn)
        .await?;
    Ok(row.map(
        |(consecutive_failures, last_alert_at, alerting, degraded_notified_at)| AlertState {
            consecutive_failures,
            last_alert_at,
            alerting,
            degraded_notified_at,
        },
    ))
}

/// Writes the alert state back after a run completes.
/// Writes the alert state back, but only if it still holds `expected`.
///
/// Returns `true` when the write applied, `false` when another writer got there
/// first and the caller's decision was made against a stale read.
///
/// This is a compare-and-swap because the caller does a read-modify-write with no
/// transaction around it: `get_alert_state` then decide then write. Two runs of
/// the SAME check can complete close together — a run takes longer than the
/// interval whenever the target is slow, which is exactly when it is failing — and
/// both would read `consecutive_failures = 2`, both write 3, and both conclude
/// they were outside the cooldown. The streak would undercount and the
/// notification would double.
///
/// The three columns are guarded, not just the counter: a lost `alerting`
/// transition is what produces a recovery for an incident nobody was told about.
///
/// Compare `synthetics_runs::increment_jobs_done`, which is a single atomic
/// `jobs_done = jobs_done + 1`. That shape is not available here because the new
/// value depends on a policy decision, not on arithmetic over the old one.
pub async fn update_alert_state_if<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    expected: AlertState,
    state: AlertState,
) -> Result<bool, errors::Error> {
    let res = Entity::update_many()
        .col_expr(
            Column::ConsecutiveFailures,
            Expr::value(state.consecutive_failures),
        )
        .col_expr(Column::LastAlertAt, Expr::value(state.last_alert_at))
        .col_expr(Column::Alerting, Expr::value(state.alerting))
        .col_expr(
            Column::DegradedNotifiedAt,
            Expr::value(state.degraded_notified_at),
        )
        .filter(Column::Id.eq(id))
        .filter(Column::ConsecutiveFailures.eq(expected.consecutive_failures))
        .filter(Column::LastAlertAt.eq(expected.last_alert_at))
        .filter(Column::Alerting.eq(expected.alerting))
        .filter(Column::DegradedNotifiedAt.eq(expected.degraded_notified_at))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

// ── Private helpers ───────────────────────────────────────────────────────────

async fn get_model<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<synthetics_checks::Model>, sea_orm::DbErr> {
    Entity::find_by_id(id)
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await
}

async fn list_models<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<Vec<synthetics_checks::Model>, sea_orm::DbErr> {
    let q = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .apply_filters(params)
        .order_by_asc(Column::Name);

    if let (Some(page_size), Some(page)) = (params.page_size, params.page)
        && page_size > 0
    {
        return q.paginate(conn, page_size).fetch_page(page).await;
    }
    q.all(conn).await
}

fn pack_settings(check: &Synthetic) -> Result<serde_json::Value, errors::Error> {
    Ok(serde_json::to_value(SyntheticSettings {
        retries: check.retries,
        cooldown_mins: check.cooldown_mins,
        wait_before_retry_secs: check.wait_before_retry_secs,
        alert_if_fails: check.alert_if_fails,
        collect_rum_data: check.collect_rum_data,
        session_replay: check.session_replay,
        start: check.start,
    })?)
}

/// Internal serde shape for the `secrets` column.
/// All fields default to empty so missing keys deserialize cleanly.
#[derive(Serialize, Deserialize, Default)]
struct StoredSecrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth: Option<SyntheticAuth>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    cookies: Vec<SyntheticCookie>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    variables: Vec<SyntheticVariable>,
    /// Encrypted config-embedded secrets keyed by JSON pointer into `config`
    /// (e.g. "/headers/0/value") — extracted so the config column stores no
    /// secret material at all.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    config: std::collections::BTreeMap<String, String>,
}

fn pack_secrets(check: &Synthetic) -> Result<String, errors::Error> {
    serde_json::to_string(&StoredSecrets {
        auth: check.auth.clone(),
        cookies: check.cookies.clone(),
        variables: check.variables.clone(),
        config: check.config_secrets.clone(),
    })
    .map_err(|e| errors::Error::Message(format!("secrets serialize failed: {e}")))
}

fn update_mutable_fields(am: &mut ActiveModel, check: &Synthetic) -> Result<(), errors::Error> {
    let locations = serde_json::to_value(&check.locations)?;
    let destinations = serde_json::to_value(&check.destinations)?;
    let tags = serde_json::to_value(&check.tags)?;
    let frequency = serde_json::to_value(&check.frequency)?;
    let settings = pack_settings(check)?;
    am.folder_id = Set(check.folder_id.clone());
    am.tz_offset = Set(check.tz_offset);
    am.name = Set(check.name.clone());
    am.description = Set(check.description.clone());
    am.tags = Set(tags);
    am.target = Set(check.target.clone());
    am.config = Set(check.config.clone());
    am.frequency = Set(frequency);
    am.locations = Set(locations);
    am.enabled = Set(check.enabled);
    am.destinations = Set(destinations);
    am.settings = Set(settings);
    am.secrets = Set(pack_secrets(check)?);
    Ok(())
}

fn build_active_model(check: &Synthetic) -> Result<ActiveModel, errors::Error> {
    let locations = serde_json::to_value(&check.locations)?;
    let destinations = serde_json::to_value(&check.destinations)?;
    let tags = serde_json::to_value(&check.tags)?;
    let frequency = serde_json::to_value(&check.frequency)?;
    let settings = pack_settings(check)?;
    Ok(ActiveModel {
        name: Set(check.name.clone()),
        description: Set(check.description.clone()),
        tags: Set(tags),
        target: Set(check.target.clone()),
        config: Set(check.config.clone()),
        frequency: Set(frequency),
        locations: Set(locations),
        enabled: Set(check.enabled),
        destinations: Set(destinations),
        settings: Set(settings),
        secrets: Set(pack_secrets(check)?),
        ..Default::default()
    })
}

fn check_type_to_str(t: &SyntheticType) -> &'static str {
    match t {
        SyntheticType::Http => "http",
        SyntheticType::Api => "api",
        SyntheticType::Tcp => "tcp",
        SyntheticType::Tls => "tls",
        SyntheticType::Ssh => "ssh",
        SyntheticType::Browser => "browser",
        SyntheticType::Ping => "ping",
        SyntheticType::Dns => "dns",
    }
}

// ── Filter extension ──────────────────────────────────────────────────────────

trait ApplyCheckFilters {
    fn apply_filters(self, params: &ListSyntheticsParams) -> Self;
}

impl ApplyCheckFilters for sea_orm::Select<Entity> {
    fn apply_filters(self, params: &ListSyntheticsParams) -> Self {
        let mut q = self;
        if let Some(folder_id) = &params.folder_id {
            q = q.filter(Column::FolderId.eq(folder_id.clone()));
        }
        if let Some(check_type) = &params.check_type {
            q = q.filter(Column::SyntheticsType.eq(check_type_to_str(check_type)));
        }
        if let Some(enabled) = params.enabled {
            q = q.filter(Column::Enabled.eq(enabled));
        }
        q
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::entity::synthetics_checks::Model;

    fn make_model() -> Model {
        Model {
            id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            folder_id: "folder-1".to_string(),
            tz_offset: 0,
            name: "Login Flow".to_string(),
            synthetics_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            description: "Checks the login flow".to_string(),
            tags: serde_json::json!(["prod"]),
            config: serde_json::json!({
                "browser_devices": [{"browser": "chromium", "device": "desktop"}],
                "steps": []
            }),
            frequency: serde_json::json!({"type": "minutes", "interval": 5, "cron": ""}),
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            destinations: serde_json::json!([]),
            settings: serde_json::json!({"retries": 1, "cooldown_mins": 0, "wait_before_retry_secs": 5, "alert_if_fails": 1, "collect_rum_data": false, "session_replay": false}),
            secrets: "{}".to_string(),
            next_run_at: 0,
            last_triggered_at: 0,
            last_check_status: 0,
            consecutive_failures: 0,
            last_alert_at: 0,
            alerting: false,
            degraded_notified_at: 0,
            owner: None,
            created_at: 1750000000000000,
            updated_at: 1750000000000000,
        }
    }

    #[test]
    fn test_try_from_model() {
        let check = Synthetic::try_from(make_model()).unwrap();
        assert_eq!(check.id, "mon-1");
        assert_eq!(check.check_type, SyntheticType::Browser);
        assert_eq!(check.locations, vec!["aws-us-east-1"]);
        assert!(check.enabled);
        assert_eq!(check.frequency.interval, 5);
        assert_eq!(
            check.frequency.frequency_type,
            config::meta::synthetics::SyntheticFrequencyType::Minutes
        );
    }

    #[test]
    fn test_try_from_invalid_synthetics_type() {
        let mut m = make_model();
        m.synthetics_type = "invalid".to_string();
        assert!(Synthetic::try_from(m).is_err());
    }

    #[test]
    fn test_monitor_type_to_str() {
        assert_eq!(check_type_to_str(&SyntheticType::Http), "http");
        assert_eq!(check_type_to_str(&SyntheticType::Browser), "browser");
        assert_eq!(check_type_to_str(&SyntheticType::Api), "api");
        assert_eq!(check_type_to_str(&SyntheticType::Tcp), "tcp");
        assert_eq!(check_type_to_str(&SyntheticType::Tls), "tls");
        assert_eq!(check_type_to_str(&SyntheticType::Ssh), "ssh");
        assert_eq!(check_type_to_str(&SyntheticType::Ping), "ping");
        assert_eq!(check_type_to_str(&SyntheticType::Dns), "dns");
    }

    #[test]
    fn test_try_from_preserves_scheduler_fields() {
        let mut m = make_model();
        m.next_run_at = 1750000001000000;
        m.last_triggered_at = 1750000000500000;
        m.last_check_status = 1;
        let check = Synthetic::try_from(m).unwrap();
        assert_eq!(check.next_run_at, 1750000001000000);
        assert_eq!(check.last_triggered_at, 1750000000500000);
        assert_eq!(check.last_check_status, SyntheticStatus::Passed);
    }

    /// The CAS guard is the whole HA fix: without `next_run_at = <expected>` in
    /// the WHERE clause, every alert_manager node wins every slot and each check
    /// runs once per node.
    #[tokio::test]
    async fn test_try_claim_slot_emits_the_next_run_at_guard() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let won = try_claim_slot(&db, "mon-1", 200, 300, 100).await.unwrap();
        assert!(
            won,
            "rows_affected = 1 must mean this caller claimed the slot"
        );

        let log = db.into_transaction_log();
        let sql = format!("{:?}", log[0]);
        assert!(
            sql.contains("next_run_at"),
            "the UPDATE must filter on next_run_at — without it the claim is not a claim: {sql}"
        );
        // The expected value must reach the WHERE clause, not just the SET list.
        assert!(
            sql.contains("100"),
            "expected_next_run_at (100) must be bound into the guard: {sql}"
        );
    }

    /// The loser of a race must be told it lost, so it produces no run and no
    /// jobs. Reporting success here is what produced duplicate executions.
    #[tokio::test]
    async fn test_try_claim_slot_reports_false_when_another_node_won() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![MockExecResult {
                last_insert_id: 0,
                rows_affected: 0,
            }])
            .into_connection();

        let won = try_claim_slot(&db, "mon-1", 200, 300, 100).await.unwrap();
        assert!(
            !won,
            "rows_affected = 0 means the row no longer held the expected next_run_at, \
             i.e. another scheduler advanced it first"
        );
    }
}
