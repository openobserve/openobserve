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

/// Converts a batch of rows, dropping the ones that will not convert.
///
/// A row whose stored shape no longer parses — a `synthetics_type` written by a
/// newer build, a corrupt `locations` blob — is one check that cannot be read.
/// Collecting the batch with `?` made it every check: one such row 500s the
/// whole org's list API and stops `claim_due` for the entire deployment, so the
/// blast radius of one unreadable row was the fleet. Skipping keeps the other
/// 999 working.
///
/// Loud on purpose. The failure it replaces was at least obvious; a silent skip
/// would trade one visible outage for a check that quietly never runs, so every
/// dropped row is logged with its id and the parse error, and its id is
/// returned so the caller can surface it too.
fn convert_batch<T>(models: Vec<synthetics_checks::Model>, caller: &str) -> (Vec<T>, Vec<String>)
where
    T: TryFrom<synthetics_checks::Model, Error = errors::Error>,
{
    let mut converted = Vec::with_capacity(models.len());
    let mut skipped = Vec::new();
    for m in models {
        let id = m.id.clone();
        let org_id = m.org_id.clone();
        match T::try_from(m) {
            Ok(v) => converted.push(v),
            Err(e) => {
                log::error!("[synthetics] {caller}: skipping unreadable check {org_id}/{id}: {e}");
                config::metrics::SYNTHETICS_UNREADABLE_CHECKS_TOTAL.inc();
                skipped.push(id);
            }
        }
    }
    (converted, skipped)
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> Result<Vec<Synthetic>, errors::Error> {
    let _lock = super::get_lock().await;
    let models = list_models(conn, org_id, params).await?;
    // A single unreadable row used to 500 the whole org's list — the UI renders
    // that as "no checks yet", so a total outage looked like an empty state.
    //
    // `count` still counts the skipped row, so a page can come back one short of
    // the total. That is the same shape any server-side filter has, and it beats
    // the alternative of a second full read just to make the number agree.
    let (checks, _skipped) = convert_batch(models, "list");
    Ok(checks)
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

/// Picks the primary key for a new row. Split out of [`create`] so the
/// super-cluster branch is testable without a database. An empty id cannot be
/// honoured, so it falls back rather than inserting `""`.
fn new_check_id(check: &Synthetic, use_given_id: bool) -> String {
    if use_given_id && !check.id.is_empty() {
        check.id.clone()
    } else {
        config::ider::uuid()
    }
}

/// Inserts a new check.
///
/// `use_given_id` keeps `check.id` instead of minting a fresh one. Only the
/// super-cluster consumer sets it: a check replicated from another region must
/// keep the primary key it was created with, or every region would invent its
/// own id for the same check and nothing would ever match up again. Mirrors
/// `table::alerts::create`.
pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    check: Synthetic,
    use_given_id: bool,
) -> Result<Synthetic, errors::Error> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();
    let id = new_check_id(&check, use_given_id);

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
/// NOTE: Does not use FOR UPDATE SKIP LOCKED — scheduling runs on a single scheduler node.
/// If multi-node scheduling is needed, convert to a raw SQL query with SKIP LOCKED.
impl TryFrom<synthetics_checks::Model> for DueCheck {
    type Error = errors::Error;

    fn try_from(m: synthetics_checks::Model) -> Result<Self, Self::Error> {
        let check_type: SyntheticType = serde_json::from_value(serde_json::Value::String(
            m.synthetics_type.clone(),
        ))
        .map_err(|e| {
            errors::Error::Message(format!(
                "invalid synthetics_type '{}' for {}: {e}",
                m.synthetics_type, m.id
            ))
        })?;

        let locations: Vec<String> = serde_json::from_value(m.locations)
            .map_err(|e| errors::Error::Message(format!("invalid locations for {}: {e}", m.id)))?;

        let frequency: SyntheticFrequency = serde_json::from_value(m.frequency).unwrap_or_default();

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
    }
}

/// The one definition of "this check should be running by now": enabled, slot
/// already reached, most overdue first, bounded.
///
/// Shared by [`fetch_due`], [`claim_due`] and [`fetch_overdue`] because the
/// orphan detector's whole claim is "the scheduler would have taken this and
/// didn't". Two hand-copied predicates make that claim false the moment one of
/// them gains a filter — a replication-era `owner_region` added to the
/// scheduler's side would leave the detector alerting on every check another
/// region legitimately owns. Only the PROJECTION differs between callers: the
/// scheduler needs the whole row to fan out, the detector needs seven columns.
fn due_checks_query(now_us: i64, limit: u64) -> sea_orm::Select<Entity> {
    Entity::find()
        .filter(Column::Enabled.eq(true))
        .filter(Column::NextRunAt.lte(now_us))
        .order_by_asc(Column::NextRunAt)
        .limit(limit)
}

pub async fn fetch_due<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<DueCheck>, errors::Error> {
    let _lock = super::get_lock().await;
    let models = due_checks_query(now_us, limit).all(conn).await?;

    let (due, _skipped) = convert_batch(models, "fetch_due");
    Ok(due)
}

/// A check the orphan detector may need to report.
///
/// Deliberately **not** an extension of [`DueCheck`]. That is the scheduler's
/// fan-out payload — it carries locations and browser devices the scheduler
/// needs, and none of the anchors this needs. The detector measures against
/// `next_run_at` when it is set, and falls back to `last_triggered_at` /
/// `updated_at` when it is 0, because 0 means "fire immediately" rather than
/// "not scheduled".
pub struct OrphanCandidate {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub frequency: SyntheticFrequency,
    /// Minutes from UTC — needed to resolve a cron schedule's slot spacing.
    pub tz_offset: i32,
    pub next_run_at: i64,
    pub last_triggered_at: i64,
    pub updated_at: i64,
}

/// The projected row behind [`OrphanCandidate`] — exactly the columns the
/// detector reads, and no more. `config` (full Playwright scripts) and
/// `secrets` (encrypted blobs) run to several KB per row; pulling them a
/// thousand at a time to compare a timestamp is the same waste
/// [`get_alert_state`] avoids on the ack path.
#[derive(sea_orm::FromQueryResult)]
struct OrphanRow {
    id: String,
    org_id: String,
    name: String,
    frequency: sea_orm::JsonValue,
    tz_offset: i32,
    next_run_at: i64,
    last_triggered_at: i64,
    updated_at: i64,
}

impl From<OrphanRow> for OrphanCandidate {
    fn from(r: OrphanRow) -> Self {
        // Same tolerance as `DueCheck::try_from`: a malformed frequency degrades
        // to the default rather than failing, so one bad row cannot blind the
        // detector to every other check in the batch.
        let frequency: SyntheticFrequency = serde_json::from_value(r.frequency).unwrap_or_default();

        OrphanCandidate {
            id: r.id,
            org_id: r.org_id,
            name: r.name,
            frequency,
            tz_offset: r.tz_offset,
            next_run_at: r.next_run_at,
            last_triggered_at: r.last_triggered_at,
            updated_at: r.updated_at,
        }
    }
}

/// Enabled checks whose scheduled slot is already in the past, most overdue
/// first. `next_run_at = 0` means "fire immediately", so those are candidates
/// too — a scheduler drains them within a tick, and one still sitting at 0 is
/// the signal the orphan detector is looking for.
///
/// This is a read-only superset of what `claim_due` would take; whether a
/// candidate is actually orphaned is the caller's decision, since the threshold
/// is per-check (N of its own intervals).
pub async fn fetch_overdue<C: ConnectionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<OrphanCandidate>, errors::Error> {
    let _lock = super::get_lock().await;
    let rows = due_checks_query(now_us, limit)
        .select_only()
        .column(Column::Id)
        .column(Column::OrgId)
        .column(Column::Name)
        .column(Column::Frequency)
        .column(Column::TzOffset)
        .column(Column::NextRunAt)
        .column(Column::LastTriggeredAt)
        .column(Column::UpdatedAt)
        .into_model::<OrphanRow>()
        .all(conn)
        .await?;

    Ok(rows.into_iter().map(OrphanCandidate::from).collect())
}

/// Updates `last_triggered_at` and `next_run_at` after the scheduler fans out a check.
/// Claims every due check in one pass, returning only the ones THIS node won.
///
/// This is the design's scheduler claim (`designs/synthetics/01-server-architecture.md`
/// §4.2): "Run 2+ replicas; they self-shard via `SELECT … FOR UPDATE SKIP
/// LOCKED` — no leader election."
///
/// Why locking beats the per-row compare-and-swap it replaces, at scale:
///
/// * **The nodes self-shard.** A locker skips rows another node already holds and takes *different*
///   due checks instead, so N schedulers split the backlog. Under a CAS every node reads the same
///   candidate list, one wins them all, and the losers issue one doomed UPDATE per check —
///   `FETCH_LIMIT` wasted writes per node per tick.
/// * **Losers do no writes at all.** The skip happens in the SELECT, so a node that loses a row
///   never issues its UPDATE.
///
/// The advance happens **inside** the same transaction, because the row locks
/// only exist until COMMIT — claiming and advancing separately would reopen the
/// race this closes. `next_run_for` computes each check's next slot; it is a
/// callback because that calculation (interval vs cron, tz, skip-missed) lives
/// with the scheduler, while the lock has to be held here.
///
/// Fan-out is deliberately left to the caller, *after* the commit: holding row
/// locks on user-facing config rows across N job inserts would stall any
/// concurrent edit of those checks for the duration.
///
/// SQLite has no `FOR UPDATE`, and needs none — it is single-node by
/// construction (`config.rs:3182` restricts cluster mode to Postgres), so no
/// second scheduler can exist to race with.
pub async fn claim_due<C>(
    conn: &C,
    now_us: i64,
    limit: u64,
    next_run_for: impl Fn(&DueCheck) -> i64,
) -> Result<Vec<DueCheck>, errors::Error>
where
    C: ConnectionTrait + TransactionTrait,
{
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;

    let mut query = due_checks_query(now_us, limit);
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Postgres {
        query = query.lock_with_behavior(
            sea_orm::sea_query::LockType::Update,
            sea_orm::sea_query::LockBehavior::SkipLocked,
        );
    }
    let models = query.all(&txn).await?;

    // Skip-and-log rather than fail the batch: an unreadable row is one check
    // that cannot be scheduled, and it must not cost the other 999. Failing
    // here stopped the scheduler for the whole deployment every five seconds,
    // and nothing anywhere ran.
    //
    // The skipped rows are not silently dropped twice over: they stay enabled
    // and overdue, so the orphan detector — which reads the same predicate
    // through an infallible projection — keeps reporting them, and that is the
    // signal that says a check is not running.
    let (due, _skipped): (Vec<DueCheck>, _) = convert_batch(models, "claim_due");

    for check in &due {
        Entity::update_many()
            .col_expr(Column::LastTriggeredAt, Expr::value(now_us))
            .col_expr(Column::NextRunAt, Expr::value(next_run_for(check)))
            .filter(Column::Id.eq(check.id.as_str()))
            .exec(&txn)
            .await?;
    }

    txn.commit().await?;
    Ok(due)
}

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
    let _lock = super::get_lock().await;
    Entity::update_many()
        .col_expr(Column::LastTriggeredAt, Expr::value(last_triggered_at))
        .col_expr(Column::NextRunAt, Expr::value(next_run_at))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Updates `last_check_status` after a probe acks a job.
///
/// Returns `true` when the stored value actually CHANGED — `false` for a repeat
/// of the same status, and for a check that is not in this region at all.
///
/// The `ne` filter is what makes transition-only replication possible. This is
/// called on every ack, so a caller that published unconditionally would put a
/// message on the super-cluster queue for every run of every check, forever;
/// publishing on `true` instead makes the traffic scale with status *flips*, and
/// a healthy check acking every minute sends nothing. It also makes the write
/// idempotent, which is what lets the super-cluster consumer treat a redelivery
/// as a no-op rather than having to remember what it already applied.
///
/// One statement, so there is no read-modify-write window for two acks of the
/// same check to race through — the database decides who changed the value.
pub async fn update_last_check_status<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    status: i32,
) -> Result<bool, errors::Error> {
    let _lock = super::get_lock().await;
    let res = Entity::update_many()
        .col_expr(Column::LastCheckStatus, Expr::value(status))
        .filter(Column::Id.eq(id))
        .filter(Column::LastCheckStatus.ne(status))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
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
    let _lock = super::get_lock().await;
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

/// Writes the columns a user edit may change, and only those.
///
/// The omissions are the point: `next_run_at`, `last_triggered_at`,
/// `last_check_status`, `consecutive_failures`, `last_alert_at`, `alerting` and
/// `degraded_notified_at` are rewritten by the scheduler and ack paths of
/// whichever region is running the checks. Because the super-cluster consumer
/// applies replicated edits through [`update`], leaving them out here is what
/// stops an edit made in one region from resetting another region's schedule
/// and alert counters — see the guard test at the bottom of this file.
///
/// A new *config* column must be added here or edits to it will not propagate;
/// a new *runtime* column must not be, or every edit will clobber it.
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

    /// A row whose `synthetics_type` no longer parses — written by a newer
    /// build, or by a bad migration. One of these disabled scheduling for an
    /// entire deployment and 500ed the list API for a whole org.
    fn an_unreadable_model() -> Model {
        Model {
            id: "poison-1".to_string(),
            synthetics_type: "NOT_A_VALID_TYPE".to_string(),
            ..make_model()
        }
    }

    /// The blast radius of one bad row is one check. `claim_due` must return
    /// every readable check in the batch and advance those, not fail.
    #[tokio::test]
    async fn test_claim_due_skips_an_unreadable_row_and_keeps_the_rest() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let good = Model {
            id: "mon-2".to_string(),
            ..make_model()
        };
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![an_unreadable_model(), make_model(), good]])
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                },
            ])
            .into_connection();

        let claimed = claim_due(&db, 500, 10, |_| 900).await.unwrap();

        let ids: Vec<&str> = claimed.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["mon-1", "mon-2"],
            "the readable checks must still be claimed"
        );
    }

    /// The skip is a decision, not an accident: the caller is handed the ids it
    /// dropped, and each one is logged. Asserted on the returned set because a
    /// skip nobody can see is a worse failure than the one it replaced.
    #[test]
    fn test_convert_batch_reports_every_row_it_skips() {
        let (checks, skipped): (Vec<Synthetic>, _) =
            convert_batch(vec![an_unreadable_model(), make_model()], "test");

        assert_eq!(skipped, vec!["poison-1".to_string()]);
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].id, "mon-1");
    }

    /// The ordinary case has to stay ordinary — no dropped rows, nothing to
    /// report.
    #[test]
    fn test_convert_batch_leaves_a_healthy_batch_alone() {
        let good = Model {
            id: "mon-2".to_string(),
            ..make_model()
        };
        let (checks, skipped): (Vec<DueCheck>, _) = convert_batch(vec![make_model(), good], "test");

        assert!(skipped.is_empty());
        assert_eq!(
            checks.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            vec!["mon-1", "mon-2"]
        );
    }

    /// The list path had the same shape, and its failure mode was worse than an
    /// error: the UI renders a 500 from this endpoint as "Create your first
    /// Check", so one bad row made a working org look empty.
    #[tokio::test]
    async fn test_list_returns_the_readable_checks_despite_a_bad_row() {
        use sea_orm::{DatabaseBackend, MockDatabase};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![an_unreadable_model(), make_model()]])
            .into_connection();

        let checks = list(&db, "org1", &ListSyntheticsParams::default())
            .await
            .unwrap();

        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].id, "mon-1");
    }

    /// The lock clause is the whole HA fix: without FOR UPDATE SKIP LOCKED the
    /// SELECT is plain and every scheduler node claims every due check.
    #[tokio::test]
    async fn test_claim_due_locks_with_skip_locked_on_postgres() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![make_model()]])
            .append_exec_results(vec![MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let claimed = claim_due(&db, 500, 10, |_| 900).await.unwrap();
        assert_eq!(
            claimed.len(),
            1,
            "the due check should be returned as claimed"
        );

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(
            sql.contains("FOR UPDATE SKIP LOCKED"),
            "the claiming SELECT must lock and skip, else replicas do not self-shard: {sql}"
        );
        assert!(
            sql.contains("UPDATE"),
            "the advance must happen in the same transaction as the lock: {sql}"
        );
    }

    /// SQLite has no FOR UPDATE and needs none — it is single-node, so no second
    /// scheduler can exist to race with. Emitting the clause there is a syntax
    /// error, so the backend branch is load-bearing.
    #[tokio::test]
    async fn test_claim_due_omits_lock_clause_on_sqlite() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Sqlite)
            .append_query_results(vec![vec![make_model()]])
            .append_exec_results(vec![MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let claimed = claim_due(&db, 500, 10, |_| 900).await.unwrap();
        assert_eq!(claimed.len(), 1);

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(
            !sql.contains("FOR UPDATE"),
            "SQLite cannot parse FOR UPDATE: {sql}"
        );
    }

    /// The projected row the detector actually reads. Built from `make_model`
    /// so the two cannot drift on field names — `FromQueryResult` matches by
    /// name, so a renamed column would fail at the database, not here.
    fn make_orphan_row() -> OrphanRow {
        let m = make_model();
        OrphanRow {
            id: m.id,
            org_id: m.org_id,
            name: m.name,
            frequency: m.frequency,
            tz_offset: m.tz_offset,
            next_run_at: m.next_run_at,
            last_triggered_at: m.last_triggered_at,
            updated_at: m.updated_at,
        }
    }

    /// The detector anchors on the newest of `next_run_at`, `last_triggered_at`
    /// and `updated_at`, so all three have to survive the conversion.
    #[test]
    fn test_orphan_candidate_from_model() {
        let mut m = make_orphan_row();
        m.next_run_at = 1750000060000000;
        m.last_triggered_at = 1750000030000000;
        m.tz_offset = -300;

        let c = OrphanCandidate::from(m);
        assert_eq!(c.id, "mon-1");
        assert_eq!(c.org_id, "org1");
        assert_eq!(c.name, "Login Flow");
        assert_eq!(c.tz_offset, -300);
        assert_eq!(c.next_run_at, 1750000060000000);
        assert_eq!(c.last_triggered_at, 1750000030000000);
        assert_eq!(c.updated_at, 1750000000000000);
        assert_eq!(c.frequency.interval, 5);
        assert_eq!(
            c.frequency.frequency_type,
            config::meta::synthetics::SyntheticFrequencyType::Minutes
        );
    }

    /// A malformed `frequency` must degrade to the default, not fail — one bad
    /// row would otherwise blind the detector to the whole batch.
    #[test]
    fn test_orphan_candidate_from_model_tolerates_bad_frequency() {
        let mut m = make_orphan_row();
        m.frequency = serde_json::json!("not-a-frequency");

        let c = OrphanCandidate::from(m);
        assert_eq!(
            c.frequency.frequency_type,
            config::meta::synthetics::SyntheticFrequencyType::Minutes
        );
        assert_eq!(c.frequency.interval, 5);
    }

    /// `fetch_overdue` is the detector's whole input set: a missing `enabled`
    /// filter would report paused checks, and a missing `next_run_at` bound
    /// would pull the entire table on every reaper tick.
    ///
    /// Asserted on the WHERE clause verbatim rather than on substrings. The
    /// earlier version matched `"enabled"` and `"next_run_at"` anywhere in the
    /// statement, which the SELECT list satisfies on its own — deleting BOTH
    /// filters left it green.
    #[tokio::test]
    async fn test_fetch_overdue_filters_and_orders() {
        use sea_orm::{DatabaseBackend, MockDatabase};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![make_model()]])
            .into_connection();

        let rows = fetch_overdue(&db, 1750000000000000, 1000).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "mon-1");

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(
            sql.contains(
                r#"WHERE \"synthetics\".\"enabled\" = $1 AND \"synthetics\".\"next_run_at\" <= $2"#
            ),
            "both predicates must survive: a missing `enabled` reports paused checks, a missing \
             `next_run_at` scans the whole table every pass: {sql}"
        );
        assert!(
            sql.contains("Bool(Some(true))"),
            "the enabled predicate must bind TRUE: {sql}"
        );
        assert!(
            sql.contains(r#"ORDER BY \"synthetics\".\"next_run_at\" ASC LIMIT $3"#),
            "most overdue first and bounded, so a truncated batch reports the worst: {sql}"
        );
    }

    /// The detector compares timestamps; it has no use for the check's body.
    /// `config` holds full Playwright scripts and `secrets` holds encrypted
    /// blobs — several KB per row, a thousand rows, every pass.
    #[tokio::test]
    async fn test_fetch_overdue_projects_only_the_anchor_columns() {
        use sea_orm::{DatabaseBackend, MockDatabase};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![make_model()]])
            .into_connection();

        fetch_overdue(&db, 1750000000000000, 1000).await.unwrap();

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(
            !sql.contains(r#"\"synthetics\".\"config\""#),
            "must not pull Playwright scripts to compare a timestamp: {sql}"
        );
        assert!(
            !sql.contains(r#"\"synthetics\".\"secrets\""#),
            "must not pull encrypted credentials to compare a timestamp: {sql}"
        );
        assert!(
            sql.contains(r#"\"synthetics\".\"frequency\""#),
            "the frequency is what the threshold is measured in: {sql}"
        );
    }

    /// `fetch_due` and `fetch_overdue` must select from the same set. If the
    /// detector's predicate ever drifts from the scheduler's, it starts
    /// reporting checks the scheduler was never going to claim.
    #[tokio::test]
    async fn test_fetch_due_and_fetch_overdue_share_one_predicate() {
        use sea_orm::{DatabaseBackend, MockDatabase};

        fn where_clause(sql: &str) -> String {
            let start = sql.find("WHERE").expect("query must have a WHERE clause");
            let end = sql.find("ORDER BY").expect("query must be ordered");
            sql[start..end].to_string()
        }

        let due_db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![make_model()]])
            .into_connection();
        fetch_due(&due_db, 1750000000000000, 1000).await.unwrap();
        let due_sql = format!("{:?}", due_db.into_transaction_log());

        let overdue_db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![make_model()]])
            .into_connection();
        fetch_overdue(&overdue_db, 1750000000000000, 1000)
            .await
            .unwrap();
        let overdue_sql = format!("{:?}", overdue_db.into_transaction_log());

        assert_eq!(
            where_clause(&due_sql),
            where_clause(&overdue_sql),
            "the scheduler's candidate set and the detector's must not drift"
        );
    }

    /// The guarantee super-cluster replication rests on (spec §4, test 4).
    ///
    /// A replicated edit is applied through [`update`], which builds its
    /// `ActiveModel` from the row already in this region and hands it to
    /// [`update_mutable_fields`]. Anything that function leaves alone keeps the
    /// local value. If a runtime column ever slips into it, every edit made in
    /// any region resets this region's schedule anchor and alert counters — a
    /// silent failure: the check still runs, just on the wrong clock and with
    /// its failure count back at zero.
    ///
    /// `Unchanged` is exactly that assertion — the column will not appear in
    /// the generated `UPDATE` at all.
    #[test]
    fn an_edit_never_touches_a_runtime_column() {
        let mut m = make_model();
        // Values a region that has been running this check would hold.
        m.next_run_at = 1_750_000_000_000_000;
        m.last_triggered_at = 1_749_999_000_000_000;
        m.last_check_status = 3;
        m.consecutive_failures = 2;
        m.last_alert_at = 1_749_998_000_000_000;
        m.alerting = true;
        m.degraded_notified_at = 1_749_997_000_000_000;

        let mut check = Synthetic::try_from(m.clone()).unwrap();
        check.name = "renamed".to_string();
        check.enabled = false;

        let mut am: ActiveModel = m.into();
        update_mutable_fields(&mut am, &check).unwrap();

        assert!(am.name.is_set(), "the edit itself must still apply");
        assert!(am.enabled.is_set());

        assert!(
            am.next_run_at.is_unchanged(),
            "next_run_at is the schedule anchor"
        );
        assert!(am.last_triggered_at.is_unchanged());
        assert!(am.last_check_status.is_unchanged());
        assert!(
            am.consecutive_failures.is_unchanged(),
            "resetting this delays a real page"
        );
        assert!(
            am.last_alert_at.is_unchanged(),
            "resetting this breaks the alert cooldown"
        );
        assert!(am.alerting.is_unchanged());
        assert!(am.degraded_notified_at.is_unchanged());
    }

    /// `create` mints an id unless told otherwise. The super-cluster consumer
    /// must be able to reproduce the origin region's primary key, or the same
    /// check ends up under a different id in every region and no later update
    /// or delete ever finds it again.
    #[test]
    fn a_replicated_create_keeps_the_origin_region_id() {
        let check = Synthetic::try_from(make_model()).unwrap();
        assert_eq!(new_check_id(&check, true), "mon-1");
        assert_ne!(
            new_check_id(&check, false),
            "mon-1",
            "a user-facing create must still mint its own id"
        );

        let mut blank = check.clone();
        blank.id = String::new();
        assert!(
            !new_check_id(&blank, true).is_empty(),
            "an empty id is not an id to honour"
        );
    }

    /// A real sqlite with just this table, because the property under test is
    /// the DATABASE's answer to "did that write change anything". A mock returns
    /// whatever `rows_affected` the test queued, which would make the assertions
    /// below about the mock rather than about the `ne` filter.
    ///
    /// One connection, not a pool: separate connections to `sqlite::memory:` get
    /// separate databases, so a second checkout would see an empty table.
    async fn db_with_one_check(status: i32) -> sea_orm::DatabaseConnection {
        use sea_orm::{ActiveModelTrait, ConnectOptions, Database, Schema};

        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();

        let model = Model {
            last_check_status: status,
            ..make_model()
        };
        // `reset_all` because `From<Model>` marks every field `Unchanged`, which
        // an INSERT would skip.
        let am: ActiveModel = model.into();
        am.reset_all().insert(&db).await.unwrap();
        db
    }

    async fn stored_status(db: &sea_orm::DatabaseConnection, id: &str) -> i32 {
        Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .last_check_status
    }

    /// **The one that matters.** This is called on every ack, so the bool it
    /// returns is the entire budget for super-cluster status replication: the
    /// callers publish on `true`, so a check that keeps reporting the same
    /// status publishes once and then never again, however often it runs.
    ///
    /// If this ever returns `true` twice for the same value, a thousand
    /// 1-minute checks become a thousand messages a minute, forever.
    #[tokio::test]
    async fn acking_the_same_status_twice_reports_one_change() {
        let db = db_with_one_check(0).await;

        assert!(
            update_last_check_status(&db, "mon-1", 1).await.unwrap(),
            "0 -> 1 is a transition and must be published"
        );
        assert!(
            !update_last_check_status(&db, "mon-1", 1).await.unwrap(),
            "the second ack of the same status must be silent"
        );
        assert!(
            !update_last_check_status(&db, "mon-1", 1).await.unwrap(),
            "and stay silent"
        );

        assert_eq!(stored_status(&db, "mon-1").await, 1);
    }

    /// The flip side: a real transition must still be reported, or a check that
    /// starts failing stays green in every other region until someone edits it.
    #[tokio::test]
    async fn a_changed_status_reports_a_change() {
        let db = db_with_one_check(1).await;

        assert!(update_last_check_status(&db, "mon-1", 3).await.unwrap());
        assert_eq!(stored_status(&db, "mon-1").await, 3);
        assert!(
            update_last_check_status(&db, "mon-1", 1).await.unwrap(),
            "recovery is a transition too"
        );
        assert_eq!(stored_status(&db, "mon-1").await, 1);
    }

    /// No row is `false`, not an error. It is what the super-cluster consumer
    /// sees when a status message outran its create or arrived after a delete,
    /// and erroring there would redeliver a message about a check that does not
    /// exist until it dead-lettered.
    #[tokio::test]
    async fn a_missing_check_is_not_a_change_and_not_an_error() {
        let db = db_with_one_check(1).await;

        assert!(
            !update_last_check_status(&db, "no-such-check", 3)
                .await
                .unwrap()
        );
        assert_eq!(
            stored_status(&db, "mon-1").await,
            1,
            "and it must not have written some other row"
        );
    }

    /// The `ne` filter is the mechanism, so assert it reaches the SQL. The
    /// behavioural tests above run on sqlite; this pins the emitted statement so
    /// the filter cannot be dropped in favour of an application-side compare,
    /// which would reintroduce the read-modify-write race between two acks of
    /// the same check.
    #[tokio::test]
    async fn the_update_filters_on_the_status_being_different() {
        use sea_orm::{DatabaseBackend, MockDatabase, MockExecResult};

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        update_last_check_status(&db, "mon-1", 2).await.unwrap();

        let sql = format!("{:?}", db.into_transaction_log());
        assert!(
            sql.contains(r#"\"last_check_status\" <> $"#),
            "the transition test must be in the WHERE clause, not in Rust: {sql}"
        );
    }
}
