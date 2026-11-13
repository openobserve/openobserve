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

//! Status-page snapshot rebuilder: the fixed-cadence loop that turns check
//! state into notices (via the engine in `config::meta::status_pages`) and
//! notices into prebuilt snapshots the public plane serves with two
//! point-reads.
//!
//! Cost model, which is the whole point: reads are batched per tick, writes
//! happen only when the computed snapshot content actually changed
//! (dirty-skip by hash), and the search cluster is never touched here.

use std::collections::{HashMap, HashSet};

use config::meta::status_pages as engine;
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{entity::status_page_notices, status_pages as table},
};

const RESOLVED_LOOKBACK_MICROS: i64 = 90 * 86_400 * 1_000_000;

/// (history_hash, current_hash) per page — the dirty-skip memory.
type SnapshotHashes = HashMap<String, (u64, u64)>;

/// Everything one tick reads, batched.
struct TickData {
    pages: Vec<infra::table::entity::status_pages::Model>,
    components: Vec<infra::table::entity::status_page_components::Model>,
    mappings: Vec<infra::table::entity::status_page_component_checks::Model>,
    states: Vec<table::CheckStateRow>,
    /// Manual snoozes and downtime mutes: the engine opens no notice for these.
    snoozed: HashSet<String>,
    /// Downtime mutes only; a muted check that fails shows Maintenance (D2).
    muted: HashSet<String>,
    notices: Vec<status_page_notices::Model>,
    /// False alarm holds apply only while every node runs this build. See
    /// [`infra::cluster::all_online_nodes_run_this_build`].
    holds_allowed: bool,
}

/// Renders one page's snapshot on demand, through the exact same serializer
/// the rebuilder writes — the design's requirement that admin preview cannot
/// diverge from what gets published. Unlike the tick loop this does not touch
/// check state or the auto-incident engine: it renders whatever notices are
/// already committed, which is what a human previewing "what would visitors
/// see right now" wants.
pub async fn preview_snapshot(
    org_id: &str,
    page_id: &str,
) -> Result<Option<(engine::SnapshotCurrent, engine::SnapshotHistory)>, infra::errors::Error> {
    let conn = get_orm_client_ro().await;
    let Some(page) = table::get_page_by_id(org_id, page_id).await? else {
        return Ok(None);
    };
    let now = config::utils::time::now_micros();
    let page_ids = [page.id.clone()];
    let components = table::list_components(conn, &page_ids).await?;
    let component_ids: Vec<String> = components.iter().map(|c| c.id.clone()).collect();
    let mappings = table::list_component_checks(conn, &component_ids).await?;
    let notices = table::list_notices_since(conn, now - RESOLVED_LOOKBACK_MICROS).await?;
    let notice_ids: Vec<String> = notices.iter().map(|n| n.id.clone()).collect();
    let notice_components = table::list_notice_components(conn, &notice_ids).await?;
    let notice_updates = table::list_notice_updates_for(conn, &notice_ids).await?;

    let mut notices_by_component: HashMap<&str, Vec<&status_page_notices::Model>> = HashMap::new();
    let by_id: HashMap<&str, &status_page_notices::Model> =
        notices.iter().map(|n| (n.id.as_str(), n)).collect();
    for join in &notice_components {
        if let Some(n) = by_id.get(join.notice_id.as_str()) {
            notices_by_component
                .entry(join.component_id.as_str())
                .or_default()
                .push(n);
        }
    }
    let mut updates_by_notice: HashMap<
        &str,
        Vec<&infra::table::entity::status_page_notice_updates::Model>,
    > = HashMap::new();
    for u in &notice_updates {
        updates_by_notice
            .entry(u.notice_id.as_str())
            .or_default()
            .push(u);
    }

    // Same state read as the rebuilder, so a preview of an all-Error component
    // shows NoData exactly as the published snapshot does.
    let preview_check_ids: Vec<String> = mappings
        .iter()
        .map(|m| m.synthetics_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let (states, _) = table::get_check_states(conn, &preview_check_ids, None).await?;
    // The same mutes as the tick, so the admin preview matches the public page.
    let muted = muted_checks(conn, &mappings).await;
    let data = TickData {
        pages: vec![page.clone()],
        components,
        mappings,
        states,
        snoozed: HashSet::new(),
        muted,
        notices: notices.clone(),
        // A preview renders the snapshot only. It runs no engine actions, so it holds nothing.
        holds_allowed: false,
    };
    let (current, history, page_notice_ids) =
        build_page_snapshot(&page, &data, &notices_by_component, now);
    let notices_json: Vec<engine::PublicNotice> = page_notice_ids
        .iter()
        .filter_map(|id| by_id.get(id.as_str()))
        .map(|n| {
            public_notice(
                n,
                updates_by_notice.get(n.id.as_str()).map_or(&[][..], |v| v),
            )
        })
        .collect();
    Ok(Some((
        engine::SnapshotCurrent {
            notices: notices_json,
            ..current
        },
        history,
    )))
}

/// Recomputes one page's snapshot and writes it straight into
/// `status_page_snapshots`, out of band from the rebuilder's own cadence —
/// the admin notice-mutation endpoints call this so the actor's change (and
/// everyone else's next read of the cache: other admins' list rows, the
/// public page) is correct immediately, not only after the next tick (up to
/// `ZO_STATUS_PAGE_REBUILD_INTERVAL`, default 60s). Best-effort by design:
/// callers log and swallow the error rather than fail the mutation over a
/// cache-refresh hiccup — the next scheduled tick would fix it regardless.
pub async fn refresh_snapshot(org_id: &str, page_id: &str) -> Result<(), infra::errors::Error> {
    let Some((current, history)) = preview_snapshot(org_id, page_id).await? else {
        return Ok(());
    };
    let current_json = serde_json::to_string(&current).unwrap_or_default();
    let history_json = serde_json::to_string(&history).unwrap_or_default();
    let conn = get_orm_client_rw().await;
    table::upsert_snapshot(
        conn,
        page_id,
        org_id,
        Some(history_json.as_str()),
        Some(current_json.as_str()),
        config::utils::time::now_micros(),
    )
    .await
}

pub async fn run(stop: crate::StopToken) {
    let interval = config::get_config()
        .synthetics
        .status_page_rebuild_interval
        .max(10);
    let mut hashes = SnapshotHashes::new();
    // Full mapped-check state, carried across ticks and refreshed by an
    // `updated_at`-watermark delta so per-tick DB cost tracks status *changes*,
    // not the mapped-check count. A full sweep every FULL_SWEEP_TICKS catches
    // deletions and refreshes `last_triggered_at` for the dead-probe rule.
    let mut rt = RebuilderState::default();
    loop {
        if stop.sleep(std::time::Duration::from_secs(interval)).await {
            tracing::info!("[status_pages] rebuilder stopped");
            return;
        }
        if let Err(e) = tick(&mut hashes, &mut rt).await {
            tracing::error!("[status_pages] rebuild tick failed: {e}");
        }
    }
}

/// Delta-read every tick; full sweep on the Nth. High enough that the sweep is
/// rare, low enough that the dead-probe staleness rule (which needs
/// `last_triggered_at`, not delta-visible) fires within a few minutes.
const FULL_SWEEP_TICKS: u64 = 10;

#[derive(Default)]
struct RebuilderState {
    /// Cached current state of every mapped check, id → row.
    check_state: HashMap<String, table::CheckStateRow>,
    /// Highest `updated_at` consumed so far (the delta watermark).
    watermark: i64,
    tick_count: u64,
    /// This process confirmed that the holds are safe for its build, see [`holds_ready`].
    holds_build_checked: bool,
    /// When the build gate was first seen open in a row, for the drain grace of [`holds_ready`].
    gate_open_since: Option<i64>,
    /// The stored build key was already removed during the current closed-gate period.
    gate_closed_cleared: bool,
}

/// Metadata key with the git commit that last checked the false alarm holds.
const HOLDS_BUILD_KEY: &str = "/synthetics/false_alarm_holds_build";

/// Whether false alarm holds may apply this tick. They need every online node on this build (the
/// gate), and once per new build a reset of all holds.
///
/// During a rolling deploy an old node can finish a recovery without moving the recovery stamp,
/// so a hold armed before or during the deploy could match the next outage. An old node leaves the
/// online list before it stops writing (it drains its HTTP requests after it goes offline), so
/// the reset waits until the gate stayed open for longer than that drain, then moves every stamp
/// and disarms every hold. A restart of the same build finds its commit under
/// [`HOLDS_BUILD_KEY`]: no old node can be left, so the holds apply at once and nothing resets.
async fn holds_ready(
    conn: &sea_orm::DatabaseConnection,
    now: i64,
    rt: &mut RebuilderState,
) -> Result<bool, infra::errors::Error> {
    let db = infra::db::get_db().await;
    if !infra::cluster::all_online_nodes_run_this_build().await {
        // Another build writes now, for example a rollback. Its recoveries may not move the stamp,
        // so the next opening must wait for the grace and reset again, also after a restart.
        rt.gate_open_since = None;
        if rt.holds_build_checked || !rt.gate_closed_cleared {
            let _ = db.delete(HOLDS_BUILD_KEY, false, false, None).await;
            rt.holds_build_checked = false;
            rt.gate_closed_cleared = true;
        }
        return Ok(false);
    }
    rt.gate_closed_cleared = false;
    if rt.holds_build_checked {
        return Ok(true);
    }
    if db.get(HOLDS_BUILD_KEY).await.ok().as_deref() == Some(config::COMMIT_HASH.as_bytes()) {
        rt.holds_build_checked = true;
        return Ok(true);
    }
    let since = *rt.gate_open_since.get_or_insert(now);
    if now - since < holds_drain_grace_micros() {
        return Ok(false);
    }
    infra::table::synthetics_checks::reset_false_alarm_holds(conn, now).await?;
    db.put(
        HOLDS_BUILD_KEY,
        config::COMMIT_HASH.as_bytes().to_vec().into(),
        false,
        None,
    )
    .await?;
    tracing::info!("[status_pages] new build — false alarm holds reset");
    rt.holds_build_checked = true;
    Ok(true)
}

/// Twice the HTTP drain timeout plus a minute, and at least ten minutes, so an old node that went
/// offline has stopped finishing runs before a new build resets the holds. The floor covers an old
/// node with a longer drain timeout than this one, and its background workers.
fn holds_drain_grace_micros() -> i64 {
    let drain = config::get_config().limit.http_shutdown_timeout.max(1) as i64;
    (2 * drain + 60).max(600) * 1_000_000
}

/// Per-check thresholds from the pages the check is mapped to. A check on
/// several pages uses the STRICTEST settings (max of each value), so one
/// result stream never opens or resolves an org-wide notice earlier than any
/// of its pages allows.
fn thresholds_by_check(data: &TickData) -> HashMap<String, engine::Thresholds> {
    let page_of_component: HashMap<&str, &str> = data
        .components
        .iter()
        .map(|c| (c.id.as_str(), c.status_page_id.as_str()))
        .collect();
    let page_th: HashMap<&str, engine::Thresholds> = data
        .pages
        .iter()
        .map(|p| (p.id.as_str(), page_thresholds(p)))
        .collect();
    let mut out: HashMap<String, engine::Thresholds> = HashMap::new();
    for m in &data.mappings {
        let Some(th) = page_of_component
            .get(m.component_id.as_str())
            .and_then(|pid| page_th.get(pid))
        else {
            continue;
        };
        out.entry(m.synthetics_id.clone())
            .and_modify(|cur| *cur = strictest(*cur, *th))
            .or_insert(*th);
    }
    out
}

fn page_thresholds(p: &infra::table::entity::status_pages::Model) -> engine::Thresholds {
    let d = engine::Thresholds::default();
    engine::Thresholds {
        confirm_failures: if p.confirm_failures > 0 {
            p.confirm_failures
        } else {
            d.confirm_failures
        },
        confirm_recovery: if p.confirm_recovery > 0 {
            p.confirm_recovery
        } else {
            d.confirm_recovery
        },
        confirm_after_micros: p
            .confirm_after_secs
            .filter(|s| *s > 0)
            .and_then(|s| (s as i64).checked_mul(1_000_000)),
    }
}

// One auto notice per check is shared by every page, so the strictest page's thresholds win.
fn strictest(a: engine::Thresholds, b: engine::Thresholds) -> engine::Thresholds {
    engine::Thresholds {
        confirm_failures: a.confirm_failures.max(b.confirm_failures),
        confirm_recovery: a.confirm_recovery.max(b.confirm_recovery),
        // Only time-confirm when every page allows it; then the longest wait.
        confirm_after_micros: match (a.confirm_after_micros, b.confirm_after_micros) {
            (Some(x), Some(y)) => Some(x.max(y)),
            _ => None,
        },
    }
}

async fn tick(
    hashes: &mut SnapshotHashes,
    rt: &mut RebuilderState,
) -> Result<(), infra::errors::Error> {
    let conn = get_orm_client_rw().await;
    let now = config::utils::time::now_micros();
    let data = load(conn, now, rt).await?;
    apply_engine_actions(conn, &data, now).await?;
    // Re-read notices only if actions changed them; a second bounded read per
    // tick is cheaper than tracking per-action deltas in the POC.
    let notices = table::list_notices_since(conn, now - RESOLVED_LOOKBACK_MICROS).await?;
    let notice_ids: Vec<String> = notices.iter().map(|n| n.id.clone()).collect();
    let notice_components = table::list_notice_components(conn, &notice_ids).await?;
    let notice_updates = table::list_notice_updates_for(conn, &notice_ids).await?;
    write_snapshots(
        conn,
        &data,
        &notices,
        &notice_components,
        &notice_updates,
        hashes,
        now,
    )
    .await
}

async fn load(
    conn: &sea_orm::DatabaseConnection,
    now: i64,
    rt: &mut RebuilderState,
) -> Result<TickData, infra::errors::Error> {
    let pages = table::list_published_pages(conn).await?;
    let page_ids: Vec<String> = pages.iter().map(|p| p.id.clone()).collect();
    let components = table::list_components(conn, &page_ids).await?;
    let component_ids: Vec<String> = components.iter().map(|c| c.id.clone()).collect();
    let mappings = table::list_component_checks(conn, &component_ids).await?;
    let check_ids: Vec<String> = mappings
        .iter()
        .map(|m| m.synthetics_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    // Before the notice and state reads, so a reset in this call is in the data this tick uses.
    let holds_allowed = match holds_ready(conn, now, rt).await {
        Ok(ready) => ready,
        Err(e) => {
            tracing::error!("[status_pages] false alarm hold check failed: {e}");
            false
        }
    };
    // Notices before check state: a false alarm mark that lands between the two reads must not
    // meet an older recovery stamp, which would open a new incident for the marked failure. A
    // mark after this read is not seen this tick, and `update_notice_runtime` skips a marked
    // notice.
    let notices = table::list_notices_since(conn, now - RESOLVED_LOOKBACK_MICROS).await?;

    // Delta by default; full sweep on the Nth tick. The sweep replaces the
    // cache wholesale (so deleted/unmapped checks drop out); the delta merges
    // only changed rows over the carried cache.
    // Always a full read: a few scalar columns of the mapped checks only.
    let full_sweep = FULL_SWEEP_TICKS > 0;
    rt.tick_count = rt.tick_count.wrapping_add(1);
    let since = if full_sweep { None } else { Some(rt.watermark) };
    let (changed, max_updated) = table::get_check_states(conn, &check_ids, since).await?;
    if full_sweep {
        // Rebuild the cache from the authoritative full read, keyed to the
        // still-mapped ids only.
        let mapped: HashSet<&str> = check_ids.iter().map(String::as_str).collect();
        rt.check_state.retain(|id, _| mapped.contains(id.as_str()));
        for row in changed {
            rt.check_state.insert(row.id.clone(), row);
        }
    } else {
        for row in changed {
            rt.check_state.insert(row.id.clone(), row);
        }
        // Drop any cached check no longer mapped (a page edit between sweeps).
        let mapped: HashSet<&str> = check_ids.iter().map(String::as_str).collect();
        rt.check_state.retain(|id, _| mapped.contains(id.as_str()));
    }
    rt.watermark = rt.watermark.max(max_updated);
    let states: Vec<table::CheckStateRow> = rt.check_state.values().cloned().collect();

    let mut snoozed: HashSet<String> = table::list_active_snoozes(conn, now)
        .await?
        .into_iter()
        .map(|s| s.synthetics_id)
        .collect();
    let muted = muted_checks(conn, &mappings).await;
    snoozed.extend(muted.iter().cloned());
    Ok(TickData {
        pages,
        components,
        mappings,
        states,
        snoozed,
        muted,
        notices,
        holds_allowed,
    })
}

/// The engine's view of a check: per-run verdict streaks written at run
/// finalization, never the badge.
fn engine_check(s: &table::CheckStateRow) -> engine::EngineCheck {
    engine::EngineCheck {
        id: s.id.clone(),
        down_runs: s.down_runs,
        up_runs: s.up_runs,
        first_fail_at: None,
        failing_since: None,
    }
}

/// A mapped check that a downtime mutes and that meets the open condition of the
/// rendered page. A passing muted check changes nothing, so a quick mute of a
/// flaky check never announces maintenance while the service works.
fn muted_and_failing(mapped: &[&str], data: &TickData, th: &engine::Thresholds, now: i64) -> bool {
    mapped.iter().any(|id| {
        data.muted.contains(*id)
            && data
                .states
                .iter()
                .find(|s| s.id == *id)
                .is_some_and(|s| engine::is_confirmed_failing(&engine_check(s), th, now))
    })
}

/// A check a downtime mutes opens no auto-notice, exactly like a snoozed one.
async fn muted_checks(
    conn: &sea_orm::DatabaseConnection,
    mappings: &[infra::table::entity::status_page_component_checks::Model],
) -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut muted = HashSet::new();
    for mapping in mappings {
        if !crate::alerting::may_mute(&mapping.org_id)
            || !seen.insert(mapping.synthetics_id.as_str())
        {
            continue;
        }
        let Ok(Some(check)) = infra::table::synthetics_checks::get_cached(
            conn,
            &mapping.org_id,
            &mapping.synthetics_id,
        )
        .await
        else {
            continue;
        };
        if crate::alerting::muted_by(&mapping.org_id, &check.id, &check.folder_id, &check.tags)
            .await
            .is_some()
        {
            muted.insert(check.id);
        }
    }
    muted
}

async fn apply_engine_actions(
    conn: &sea_orm::DatabaseConnection,
    data: &TickData,
    now: i64,
) -> Result<(), infra::errors::Error> {
    let checks: Vec<engine::EngineCheck> = data.states.iter().map(engine_check).collect();

    let mut open_by_check = HashMap::new();
    let mut recently_resolved = HashMap::new();
    for n in &data.notices {
        let Some(check_id) = n.auto_check_id.clone() else {
            continue;
        };
        // A false alarm stays hidden: a new failure opens a new incident, it never reopens this
        // one.
        if n.false_alarm_at.is_some() {
            continue;
        }
        if n.state == 1 {
            open_by_check.insert(
                check_id.clone(),
                engine::OpenAutoIncident {
                    notice_id: n.id.clone(),
                    check_id,
                    recovery_streak: n.auto_recovery_streak,
                },
            );
        } else if n.state == 2
            && let Some(resolved_at) = n.resolved_at
        {
            // Latest resolution wins for the merge window.
            let entry = recently_resolved
                .entry(check_id)
                .or_insert_with(|| (n.id.clone(), resolved_at));
            if resolved_at > entry.1 {
                *entry = (n.id.clone(), resolved_at);
            }
        }
    }

    let th_by_check = thresholds_by_check(data);
    let held = held_checks(data);
    let actions = engine::incident_actions_with(
        &checks,
        &open_by_check,
        &recently_resolved,
        &held,
        |id| th_by_check.get(id).copied().unwrap_or_default(),
        now,
    );
    for action in actions {
        apply_one(conn, data, action, now).await?;
    }
    Ok(())
}

/// Checks the engine must not open an incident for this tick: snoozed checks, and checks held by
/// a false alarm mark while [`holds_ready`] allows holds.
fn held_checks(data: &TickData) -> HashSet<String> {
    let mut held = if data.holds_allowed {
        false_alarm_holds(&data.notices, &data.states)
    } else {
        HashSet::new()
    };
    held.extend(data.snoozed.iter().cloned());
    held
}

/// The recovery stamps that armed false alarm marks saved, per check. A mark is armed when it
/// closed the incident (`resolved_at == false_alarm_at`) while the check was failing, so it saved
/// the check's stamp.
fn false_alarm_marks(notices: &[status_page_notices::Model]) -> HashMap<&str, HashSet<i64>> {
    let mut marked: HashMap<&str, HashSet<i64>> = HashMap::new();
    for n in notices {
        if let (Some(check_id), Some(at), Some(stamp)) = (
            n.auto_check_id.as_deref(),
            n.false_alarm_at,
            n.false_alarm_recovered_at,
        ) && n.resolved_at == Some(at)
        {
            marked.entry(check_id).or_default().insert(stamp);
        }
    }
    marked
}

/// Checks held by a false alarm mark: the check is failing and an armed mark saved its current
/// recovery stamp. Each recovery moves the stamp, so only a mark of the failure that is still
/// going on matches, and a new failure after a recovery opens a new incident. The rule does not
/// compare mark times, so it does not depend on wall clocks.
fn false_alarm_holds(
    notices: &[status_page_notices::Model],
    states: &[table::CheckStateRow],
) -> HashSet<String> {
    let marks = false_alarm_marks(notices);
    states
        .iter()
        .filter(|s| {
            s.down_runs > 0
                && s.signed
                && marks
                    .get(s.id.as_str())
                    .is_some_and(|stamps| stamps.contains(&s.recovered_at))
        })
        .map(|s| s.id.clone())
        .collect()
}

async fn apply_one(
    conn: &sea_orm::DatabaseConnection,
    data: &TickData,
    action: engine::EngineAction,
    now: i64,
) -> Result<(), infra::errors::Error> {
    let by_id: HashMap<&str, &status_page_notices::Model> =
        data.notices.iter().map(|n| (n.id.as_str(), n)).collect();
    match action {
        engine::EngineAction::Open {
            check_id,
            starts_at,
        } => open_notice(conn, data, &check_id, starts_at, now).await,
        engine::EngineAction::Reopen { notice_id, from } => {
            let Some(n) = by_id.get(notice_id.as_str()) else {
                return Ok(());
            };
            let mut segments = parse_segments(&n.segments);
            segments.push(engine::Segment { from, to: None });
            table::update_notice_runtime(conn, &notice_id, 1, None, &encode(&segments), 0, now)
                .await
        }
        engine::EngineAction::RecoveryProgress { notice_id, streak } => {
            let Some(n) = by_id.get(notice_id.as_str()) else {
                return Ok(());
            };
            table::update_notice_runtime(
                conn,
                &notice_id,
                n.state,
                n.resolved_at,
                &n.segments,
                streak,
                now,
            )
            .await
        }
        engine::EngineAction::Resolve { notice_id, at } => {
            let Some(n) = by_id.get(notice_id.as_str()) else {
                return Ok(());
            };
            let mut segments = parse_segments(&n.segments);
            if let Some(open) = segments.iter_mut().find(|s| s.to.is_none()) {
                open.to = Some(at);
            }
            table::update_notice_runtime(conn, &notice_id, 2, Some(at), &encode(&segments), 0, now)
                .await
        }
    }
}

/// Opens an org-scoped auto-incident and joins it to EVERY component the
/// failing check is mapped to, across all pages — one outage, one notice.
async fn open_notice(
    conn: &sea_orm::DatabaseConnection,
    data: &TickData,
    check_id: &str,
    starts_at: i64,
    now: i64,
) -> Result<(), infra::errors::Error> {
    let component_ids: Vec<&str> = data
        .mappings
        .iter()
        .filter(|m| m.synthetics_id == check_id)
        .map(|m| m.component_id.as_str())
        .collect();
    let Some(org_id) = data
        .mappings
        .iter()
        .find(|m| m.synthetics_id == check_id)
        .map(|m| m.org_id.clone())
    else {
        return Ok(());
    };
    let notice_id = config::ider::generate();
    let segments = vec![engine::Segment {
        from: starts_at,
        to: None,
    }];
    table::insert_notice(
        conn,
        status_page_notices::Model {
            id: notice_id.clone(),
            org_id: org_id.clone(),
            kind: 0,
            impact: 2,
            source: 0,
            // Public-safe wording only — never the check name or target.
            title: "Service disruption detected".to_string(),
            body: "Opened automatically after consecutive failed checks.".to_string(),
            state: 1,
            starts_at,
            resolved_at: None,
            segments: encode(&segments),
            excluded_from_uptime: false,
            deleted_at: None,
            auto_check_id: Some(check_id.to_string()),
            auto_recovery_streak: 0,
            owner: None,
            false_alarm_by: None,
            false_alarm_at: None,
            false_alarm_reason: None,
            false_alarm_recovered_at: None,
            created_at: now,
            updated_at: now,
        },
    )
    .await?;
    for component_id in component_ids {
        table::insert_notice_component(
            conn,
            infra::table::entity::status_page_notice_components::Model {
                id: config::ider::generate(),
                notice_id: notice_id.clone(),
                component_id: component_id.to_string(),
                org_id: org_id.clone(),
            },
        )
        .await?;
    }
    Ok(())
}

async fn write_snapshots(
    conn: &sea_orm::DatabaseConnection,
    data: &TickData,
    notices: &[status_page_notices::Model],
    notice_components: &[infra::table::entity::status_page_notice_components::Model],
    notice_updates: &[infra::table::entity::status_page_notice_updates::Model],
    hashes: &mut SnapshotHashes,
    now: i64,
) -> Result<(), infra::errors::Error> {
    let mut notices_by_component: HashMap<&str, Vec<&status_page_notices::Model>> = HashMap::new();
    let by_id: HashMap<&str, &status_page_notices::Model> =
        notices.iter().map(|n| (n.id.as_str(), n)).collect();
    for join in notice_components {
        if let Some(n) = by_id.get(join.notice_id.as_str()) {
            notices_by_component
                .entry(join.component_id.as_str())
                .or_default()
                .push(n);
        }
    }
    let mut updates_by_notice: HashMap<
        &str,
        Vec<&infra::table::entity::status_page_notice_updates::Model>,
    > = HashMap::new();
    for u in notice_updates {
        updates_by_notice
            .entry(u.notice_id.as_str())
            .or_default()
            .push(u);
    }

    for page in &data.pages {
        let (current, history, page_notice_ids) =
            build_page_snapshot(page, data, &notices_by_component, now);
        let notices_json: Vec<engine::PublicNotice> = page_notice_ids
            .iter()
            .filter_map(|id| by_id.get(id.as_str()))
            .map(|n| {
                public_notice(
                    n,
                    updates_by_notice.get(n.id.as_str()).map_or(&[][..], |v| v),
                )
            })
            .collect();
        let current = engine::SnapshotCurrent {
            notices: notices_json,
            ..current
        };
        let current_json = serde_json::to_string(&current).unwrap_or_default();
        let history_json = serde_json::to_string(&history).unwrap_or_default();
        let (h_hash, c_hash) = (hash_of(&history_json), hash_of(&current_json));
        let prev = hashes.get(&page.id).copied().unwrap_or((0, 0));
        let history_changed = prev.0 != h_hash;
        let current_changed = prev.1 != c_hash;
        if history_changed || current_changed {
            table::upsert_snapshot(
                conn,
                &page.id,
                &page.org_id,
                history_changed.then_some(history_json.as_str()),
                current_changed.then_some(current_json.as_str()),
                now,
            )
            .await?;
            hashes.insert(page.id.clone(), (h_hash, c_hash));
        }
    }
    Ok(())
}

/// One page's snapshot halves from notices alone — no stream data anywhere.
fn build_page_snapshot(
    page: &infra::table::entity::status_pages::Model,
    data: &TickData,
    notices_by_component: &HashMap<&str, Vec<&status_page_notices::Model>>,
    now: i64,
) -> (
    engine::SnapshotCurrent,
    engine::SnapshotHistory,
    Vec<String>,
) {
    let mut current_components = Vec::new();
    let mut history_components = Vec::new();
    let mut page_notice_ids: HashSet<String> = HashSet::new();

    let mut components: Vec<_> = data
        .components
        .iter()
        .filter(|c| c.status_page_id == page.id)
        .collect();
    components.sort_by_key(|c| c.sort_order);

    for component in components {
        // Per-page opaque join key: a short hash of (page id, component id).
        // Never the internal id, and NOT a positional c0/c1 scheme — a fixed
        // sequential prefix is itself an enumerable namespace. Stable across
        // ticks (inputs are stable), unguessable, and internal-value-free.
        let key = opaque_key(&page.id, &component.id);
        let notices = notices_by_component
            .get(component.id.as_str())
            .cloned()
            .unwrap_or_default();
        let mut status = engine::ComponentStatus::Operational;
        let mut incident_segments = Vec::new();
        let mut maint_segments = Vec::new();
        for n in &notices {
            // A false alarm leaves the public page: no history entry, no downtime.
            if n.excluded_from_uptime {
                continue;
            }
            page_notice_ids.insert(n.id.clone());
            let impact = engine::Impact::from_i16(n.impact as i16);
            if n.state == 1 {
                let s = match engine::NoticeKind::from_i16(n.kind as i16) {
                    engine::NoticeKind::Maintenance => engine::ComponentStatus::Maintenance,
                    _ => impact.component_status(),
                };
                status = status.max(s);
            }
            if !n.excluded_from_uptime && impact.accrues_downtime() {
                incident_segments.extend(parse_segments(&n.segments));
            }
            if engine::NoticeKind::from_i16(n.kind as i16) == engine::NoticeKind::Maintenance {
                maint_segments.push(engine::Segment {
                    from: n.starts_at,
                    to: n.resolved_at,
                });
            }
        }
        let mapped: Vec<&str> = data
            .mappings
            .iter()
            .filter(|m| m.component_id == component.id)
            .map(|m| m.synthetics_id.as_str())
            .collect();
        if mapped.is_empty() {
            status = engine::ComponentStatus::NoData;
        } else if status == engine::ComponentStatus::Operational
            && all_checks_in_error(&mapped, &data.states)
        {
            // Every probe is failing to produce a verdict: we cannot say the
            // service is up, so show "no data" rather than plain Operational.
            status = engine::ComponentStatus::NoData;
        }
        // A downtime-muted check that fails opens no notice, so without this the
        // component would read Operational during a muted outage (D2).
        if muted_and_failing(&mapped, data, &page_thresholds(page), now) {
            status = status.max(engine::ComponentStatus::Maintenance);
        }
        let (last_checked_at, stale_after_secs) = last_checked(&mapped, &data.states);
        current_components.push(engine::CurrentComponent {
            key: key.clone(),
            name: component.name.clone(),
            status,
            last_checked_at,
            stale_after_secs,
        });
        history_components.push(engine::HistoryComponent {
            key,
            name: component.name.clone(),
            uptime: engine::uptime_windows(&incident_segments, page.tracking_since, now),
            daily: engine::day_buckets(
                &incident_segments,
                &maint_segments,
                0,
                page.tracking_since,
                now,
            ),
        });
    }

    let current = engine::SnapshotCurrent {
        overall: engine::overall_status(&current_components),
        generated_at: now,
        components: current_components,
        notices: Vec::new(),
    };
    let history = engine::SnapshotHistory {
        generated_at: now,
        components: history_components,
    };
    // Sorted: HashSet order is random per process, and this list feeds the
    // serialized snapshot whose hash decides whether to rewrite it.
    (current, history, sorted_ids(page_notice_ids))
}

fn sorted_ids(set: HashSet<String>) -> Vec<String> {
    let mut ids: Vec<String> = set.into_iter().collect();
    ids.sort_unstable();
    ids
}

fn all_checks_in_error(mapped: &[&str], states: &[table::CheckStateRow]) -> bool {
    mapped.iter().all(|id| {
        states
            .iter()
            .find(|s| s.id == *id)
            // The badge is the worst job, so a quorum-Up run with one errored location is not No
            // data.
            .is_some_and(|s| s.last_check_status == engine::CHECK_STATUS_ERROR && s.up_runs == 0)
    })
}

/// When a check last tested the site: `last_tested_at`, the newest finalized run that tested it.
fn tested_at(s: &table::CheckStateRow) -> Option<i64> {
    use config::meta::synthetics::RunClass;
    if s.last_tested_at > 0 {
        return Some(s.last_tested_at);
    }
    // A row from before the run class existed: trust the badge.
    let legacy = RunClass::from_db(s.last_run_class) == RunClass::Unknown
        && s.last_check_status != engine::CHECK_STATUS_ERROR;
    let ts = if legacy {
        s.status_run_ts.max(s.last_triggered_at)
    } else {
        0
    };
    (ts > 0).then_some(ts)
}

/// A component's "Last checked" time, floored to the minute, and its stale threshold: three
/// intervals of its slowest mapped check.
fn last_checked(mapped: &[&str], states: &[table::CheckStateRow]) -> (Option<i64>, Option<i64>) {
    const MINUTE_US: i64 = 60_000_000;
    let rows: Vec<&table::CheckStateRow> = states
        .iter()
        .filter(|s| mapped.contains(&s.id.as_str()))
        .collect();
    let last = rows
        .iter()
        .filter_map(|s| tested_at(s))
        .max()
        .map(|ts| ts - ts.rem_euclid(MINUTE_US));
    let stale_after = rows
        .iter()
        .map(|s| s.interval_secs)
        .max()
        .filter(|secs| *secs > 0)
        .map(|secs| secs * 3);
    (last, stale_after)
}

fn public_notice(
    n: &status_page_notices::Model,
    updates: &[&infra::table::entity::status_page_notice_updates::Model],
) -> engine::PublicNotice {
    engine::PublicNotice {
        kind: engine::NoticeKind::from_i16(n.kind as i16),
        impact: engine::Impact::from_i16(n.impact as i16),
        title: n.title.clone(),
        body: n.body.clone(),
        state: engine::NoticeState::from_i16(n.state as i16),
        starts_at: n.starts_at,
        resolved_at: n.resolved_at,
        excluded_from_uptime: n.excluded_from_uptime,
        updates: updates
            .iter()
            .map(|u| engine::PublicNoticeUpdate {
                body: u.body.clone(),
                at: u.created_at,
            })
            .collect(),
    }
}

fn parse_segments(raw: &str) -> Vec<engine::Segment> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn encode(segments: &[engine::Segment]) -> String {
    serde_json::to_string(segments).unwrap_or_else(|_| "[]".to_string())
}

fn hash_of(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Opaque, per-page, stable-across-ticks join key for a component. Derived from
/// (page id, component id) so it reveals no internal value and follows no
/// enumerable sequence; the page id salts it so the same component on two pages
/// gets two different keys.
fn opaque_key(page_id: &str, component_id: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    page_id.hash(&mut h);
    0xff_u8.hash(&mut h); // domain separator between the two ids
    component_id.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Custom-domain DNS ownership verification: a tight-cadence loop separate
/// from the snapshot rebuilder above (different data, different SLA — a
/// newly-added domain with correct DNS should verify within one tick, not
/// wait behind the 60s-default snapshot cadence). TLS/cert issuance is
/// deliberately out of scope here: a verified domain's HTTPS termination is
/// the operator's own reverse proxy/CDN, which forwards the original `Host`
/// header to `page_by_host` (see the public handler) once the request is
/// already plaintext. Licensed (Custom Domains is an enterprise sub-feature of
/// status pages); the OSS stub never spawns any DNS work.
#[cfg(feature = "enterprise")]
pub async fn run_domain_verifier() {
    o2_enterprise::enterprise::status_pages::domain_verifier::run_domain_verifier().await
}

#[cfg(not(feature = "enterprise"))]
pub async fn run_domain_verifier() {}

#[cfg(test)]
mod fast_pass_tests {
    use super::*;

    fn row(id: &str, status: i32) -> table::CheckStateRow {
        table::CheckStateRow {
            id: id.into(),
            org_id: "org".into(),
            last_check_status: status,
            down_runs: 0,
            up_runs: 0,
            last_triggered_at: 0,
            status_run_ts: 0,
            last_run_class: 0,
            last_run_class_at: 0,
            last_tested_at: 0,
            recovered_at: 0,
            signed: true,
            interval_secs: 60,
            created_at: 0,
        }
    }

    #[test]
    fn a_false_alarm_holds_only_the_failure_whose_stamp_it_saved() {
        let notice = |check: &str, resolved: Option<i64>, mark: Option<i64>, stamp: Option<i64>| {
            status_page_notices::Model {
                id: format!("{check}-{mark:?}-{stamp:?}"),
                org_id: "org".into(),
                kind: 0,
                impact: 0,
                source: 0,
                title: String::new(),
                body: String::new(),
                state: 2,
                starts_at: 0,
                resolved_at: resolved,
                segments: "[]".into(),
                excluded_from_uptime: mark.is_some(),
                deleted_at: None,
                auto_check_id: Some(check.into()),
                auto_recovery_streak: 0,
                owner: None,
                false_alarm_by: None,
                false_alarm_at: mark,
                false_alarm_reason: None,
                false_alarm_recovered_at: stamp,
                created_at: 0,
                updated_at: 0,
            }
        };
        let failing = |id: &str, recovered_at: i64| {
            let mut r = row(id, 3);
            r.down_runs = 2;
            r.recovered_at = recovered_at;
            r
        };
        let notices = vec![
            // Marked while failing at stamp 7, and no recovery since: held.
            notice("same", Some(500), Some(500), Some(7)),
            // Marked at stamp 7, then a recovery moved the stamp to 9: a new failure.
            notice("recovered", Some(500), Some(500), Some(7)),
            // Marked while the check was not failing: the mark saved nothing.
            notice("unarmed", Some(500), Some(500), None),
            // Resolved at 300 and marked at 500: the mark did not close it.
            notice("old", Some(300), Some(500), Some(7)),
            // Two marks. The newer mark time has the older stamp, as after a clock step back.
            notice("two", Some(900), Some(900), Some(3)),
            notice("two", Some(400), Some(400), Some(7)),
            // Not a false alarm.
            notice("real", Some(500), None, None),
        ];
        let mut up = failing("up", 7);
        up.down_runs = 0;
        let notices = [
            notices,
            vec![
                notice("up", Some(500), Some(500), Some(7)),
                notice("unsigned", Some(500), Some(500), Some(7)),
            ],
        ]
        .concat();
        let states = [
            failing("same", 7),
            failing("recovered", 9),
            failing("unarmed", 7),
            failing("old", 7),
            failing("two", 7),
            failing("real", 7),
            // Armed stamp matches, but the check is not failing: nothing to hold.
            up,
            // Armed stamp matches, but an older build wrote the streaks.
            {
                let mut r = failing("unsigned", 7);
                r.signed = false;
                r
            },
        ];
        let held = false_alarm_holds(&notices, &states);
        assert_eq!(held, HashSet::from(["same".to_string(), "two".to_string()]));

        // A closed gate holds nothing, so a matching armed mark still opens an incident.
        let mut data = TickData {
            pages: vec![],
            components: vec![],
            mappings: vec![],
            states: states.to_vec(),
            snoozed: HashSet::from(["snoozed".to_string()]),
            muted: HashSet::new(),
            notices,
            holds_allowed: false,
        };
        assert_eq!(held_checks(&data), HashSet::from(["snoozed".to_string()]));
        data.holds_allowed = true;
        assert_eq!(
            held_checks(&data),
            HashSet::from(["same".to_string(), "two".to_string(), "snoozed".to_string()])
        );
    }

    #[test]
    fn last_checked_is_the_newest_run_that_tested_the_site() {
        const MIN: i64 = 60_000_000;
        let mut up = row("a", 1);
        up.last_run_class = 1;
        up.status_run_ts = 10 * MIN + 42_000_000;
        up.last_tested_at = 10 * MIN + 42_000_000;
        // Not measured since minute 20; the stored test time is used, not one worked out from the
        // interval.
        let mut gap = row("b", 4);
        gap.last_run_class = 4;
        gap.status_run_ts = 25 * MIN;
        gap.last_run_class_at = 20 * MIN;
        gap.last_tested_at = 13 * MIN + 5_000_000;
        gap.interval_secs = 120;
        let states = vec![up.clone(), gap.clone()];
        assert_eq!(last_checked(&["a"], &states), (Some(10 * MIN), Some(180)));
        assert_eq!(
            last_checked(&["a", "b"], &states),
            (Some(13 * MIN), Some(360))
        );
        // A check whose runs were all Not measured was never tested.
        let mut first = gap.clone();
        first.last_tested_at = 0;
        assert_eq!(tested_at(&first), None);
    }

    #[test]
    fn last_checked_is_absent_without_a_tested_run() {
        let mut fresh = row("a", 0);
        fresh.interval_secs = 0;
        assert_eq!(last_checked(&["a"], &[fresh.clone()]), (None, None));
        // A legacy row with an error badge has no known test time.
        let legacy = row("b", engine::CHECK_STATUS_ERROR);
        assert_eq!(tested_at(&legacy), None);
        let mut legacy_ok = row("c", 1);
        legacy_ok.last_triggered_at = 7;
        assert_eq!(tested_at(&legacy_ok), Some(7));
        assert_eq!(last_checked(&["missing"], &[fresh]), (None, None));
    }

    #[test]
    fn strictest_takes_max_and_requires_time_confirm_everywhere() {
        let a = engine::Thresholds {
            confirm_failures: 3,
            confirm_recovery: 4,
            confirm_after_micros: Some(10),
        };
        let b = engine::Thresholds {
            confirm_failures: 7,
            confirm_recovery: 2,
            confirm_after_micros: None,
        };
        let s = strictest(a, b);
        assert_eq!((s.confirm_failures, s.confirm_recovery), (7, 4));
        assert_eq!(s.confirm_after_micros, None);
        let c = engine::Thresholds {
            confirm_after_micros: Some(30),
            ..a
        };
        assert_eq!(strictest(a, c).confirm_after_micros, Some(30));
    }

    #[test]
    fn notice_ids_serialize_in_a_stable_order() {
        let ids = ["n3", "n1", "n2", "n9", "n0"];
        let fwd: HashSet<String> = ids.iter().map(|s| s.to_string()).collect();
        let rev: HashSet<String> = ids.iter().rev().map(|s| s.to_string()).collect();
        let a = serde_json::to_string(&sorted_ids(fwd)).unwrap();
        let b = serde_json::to_string(&sorted_ids(rev)).unwrap();
        assert_eq!(a, b);
        assert_eq!(a, r#"["n0","n1","n2","n3","n9"]"#);
    }

    #[test]
    fn all_error_component_is_not_operational() {
        let e = engine::CHECK_STATUS_ERROR;
        let states = vec![row("a", e), row("b", e), row("c", 1)];
        assert!(all_checks_in_error(&["a", "b"], &states));
        assert!(!all_checks_in_error(&["a", "c"], &states));
        assert!(!all_checks_in_error(&["a", "missing"], &states));
        // 2 passed + 1 errored: the badge is Error, but the verdict is Up.
        let mut up = row("a", e);
        up.up_runs = 1;
        assert!(!all_checks_in_error(&["a"], &[up]));
    }

    const NOW: i64 = 1_800_000_000_000_000;

    fn page(id: &str, confirm_failures: i32) -> infra::table::entity::status_pages::Model {
        infra::table::entity::status_pages::Model {
            id: id.into(),
            org_id: "org".into(),
            name: id.into(),
            slug: format!("{id}-slug"),
            description: None,
            visibility: 1,
            password_hash: None,
            noindex: false,
            show_uptime_percent: true,
            show_timeline_bars: true,
            show_response_time: false,
            confirm_failures,
            confirm_recovery: 2,
            confirm_after_secs: None,
            brand_name: None,
            accent_color: None,
            logo_img: None,
            favicon_img: None,
            tracking_since: Some(NOW - 86_400_000_000),
            owner: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn component(page_id: &str) -> infra::table::entity::status_page_components::Model {
        infra::table::entity::status_page_components::Model {
            id: format!("{page_id}-comp"),
            status_page_id: page_id.into(),
            org_id: "org".into(),
            name: "Checkout API".into(),
            description: None,
            sort_order: 0,
            backfill_days: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn mapping(
        page_id: &str,
        check: &str,
    ) -> infra::table::entity::status_page_component_checks::Model {
        infra::table::entity::status_page_component_checks::Model {
            id: format!("{page_id}-map"),
            component_id: format!("{page_id}-comp"),
            synthetics_id: check.into(),
            org_id: "org".into(),
        }
    }

    fn state(id: &str, badge: i32, down_runs: i32, up_runs: i32) -> table::CheckStateRow {
        table::CheckStateRow {
            down_runs,
            up_runs,
            ..row(id, badge)
        }
    }

    fn tick(pages: &[&str], states: Vec<table::CheckStateRow>, muted: &[&str]) -> TickData {
        TickData {
            pages: pages.iter().map(|p| page(p, 3)).collect(),
            components: pages.iter().map(|p| component(p)).collect(),
            mappings: pages.iter().map(|p| mapping(p, "chk")).collect(),
            states,
            snoozed: muted.iter().map(|s| s.to_string()).collect(),
            muted: muted.iter().map(|s| s.to_string()).collect(),
            notices: vec![],
            holds_allowed: false,
        }
    }

    fn status_of(
        page: &infra::table::entity::status_pages::Model,
        data: &TickData,
        notices: &HashMap<&str, Vec<&status_page_notices::Model>>,
    ) -> engine::ComponentStatus {
        build_page_snapshot(page, data, notices, NOW).0.components[0].status
    }

    const DOWN: i32 = engine::CHECK_STATUS_DOWN;
    const ERROR: i32 = engine::CHECK_STATUS_ERROR;

    #[test]
    fn a_muted_check_that_meets_the_open_condition_shows_maintenance() {
        let data = tick(&["p1"], vec![state("chk", DOWN, 3, 0)], &["chk"]);
        assert_eq!(
            status_of(&data.pages[0], &data, &HashMap::new()),
            engine::ComponentStatus::Maintenance
        );
    }

    #[test]
    fn a_muted_check_that_passes_or_errors_keeps_todays_status() {
        // One failing location of three: the badge is Down, the quorum verdict Up.
        let quorum_up = tick(&["p1"], vec![state("chk", DOWN, 0, 1)], &["chk"]);
        assert_eq!(
            status_of(&quorum_up.pages[0], &quorum_up, &HashMap::new()),
            engine::ComponentStatus::Operational
        );
        let up = tick(&["p1"], vec![state("chk", 1, 0, 5)], &["chk"]);
        assert_eq!(
            status_of(&up.pages[0], &up, &HashMap::new()),
            engine::ComponentStatus::Operational
        );
        let error = tick(&["p1"], vec![state("chk", ERROR, 0, 0)], &["chk"]);
        assert_eq!(
            status_of(&error.pages[0], &error, &HashMap::new()),
            engine::ComponentStatus::NoData
        );
        let below = tick(&["p1"], vec![state("chk", DOWN, 2, 0)], &["chk"]);
        assert_eq!(
            status_of(&below.pages[0], &below, &HashMap::new()),
            engine::ComponentStatus::Operational,
            "a streak below the threshold keeps the current status"
        );
    }

    #[test]
    fn a_confirmed_down_streak_counts_after_a_no_verdict_run_and_with_an_error_badge() {
        // Two failed locations and one error: a Down verdict with an Error badge.
        let data = tick(&["p1"], vec![state("chk", ERROR, 4, 0)], &["chk"]);
        assert_eq!(
            status_of(&data.pages[0], &data, &HashMap::new()),
            engine::ComponentStatus::Maintenance
        );
    }

    #[test]
    fn a_manual_snooze_without_a_downtime_keeps_todays_status() {
        let mut data = tick(&["p1"], vec![state("chk", DOWN, 3, 0)], &[]);
        data.snoozed.insert("chk".into());
        assert_eq!(
            status_of(&data.pages[0], &data, &HashMap::new()),
            engine::ComponentStatus::Operational
        );
        data.muted.clear();
        assert!(!muted_and_failing(
            &["chk"],
            &data,
            &page_thresholds(&data.pages[0]),
            NOW
        ));
    }

    #[test]
    fn an_open_major_outage_notice_wins_over_maintenance() {
        let data = tick(&["p1"], vec![state("chk", DOWN, 3, 0)], &["chk"]);
        let notice: status_page_notices::Model = serde_json::from_value(serde_json::json!({
            "id": "n1", "org_id": "org", "kind": 0, "impact": 3, "source": 0,
            "title": "Down", "body": "", "state": 1, "starts_at": NOW - 1,
            "resolved_at": null, "segments": "[]", "excluded_from_uptime": false,
            "deleted_at": null, "auto_check_id": "chk", "auto_recovery_streak": 0,
            "owner": null, "created_at": 0, "updated_at": 0
        }))
        .unwrap();
        let notices = HashMap::from([("p1-comp", vec![&notice])]);
        assert_eq!(
            status_of(&data.pages[0], &data, &notices),
            engine::ComponentStatus::MajorOutage
        );
    }

    #[test]
    fn each_page_uses_its_own_thresholds() {
        let mut data = tick(&["p1", "p2"], vec![state("chk", DOWN, 3, 0)], &["chk"]);
        data.pages[0].confirm_failures = 2;
        data.pages[1].confirm_failures = 5;
        assert_eq!(
            status_of(&data.pages[0], &data, &HashMap::new()),
            engine::ComponentStatus::Maintenance
        );
        let p2: Vec<_> = build_page_snapshot(&data.pages[1], &data, &HashMap::new(), NOW)
            .0
            .components;
        assert_eq!(p2[0].status, engine::ComponentStatus::Operational);
    }

    #[test]
    fn the_status_follows_the_current_rules_once_the_mute_ends() {
        let mut data = tick(&["p1"], vec![state("chk", DOWN, 3, 0)], &["chk"]);
        let before = build_page_snapshot(&data.pages[0], &data, &HashMap::new(), NOW).1;
        data.muted.clear();
        data.snoozed.clear();
        let (current, after, _) = build_page_snapshot(&data.pages[0], &data, &HashMap::new(), NOW);
        assert_eq!(
            current.components[0].status,
            engine::ComponentStatus::Operational
        );
        assert_eq!(
            serde_json::to_value(&before).unwrap(),
            serde_json::to_value(&after).unwrap(),
            "the uptime history does not change"
        );
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase};

    use super::*;

    #[tokio::test]
    async fn with_nothing_registered_no_check_row_is_loaded() {
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let mapping = infra::table::entity::status_page_component_checks::Model {
            id: "map-1".to_string(),
            component_id: "comp-1".to_string(),
            synthetics_id: "mon-1".to_string(),
            org_id: "org".to_string(),
        };
        let muted = muted_checks(&db, &[mapping]).await;
        assert!(muted.is_empty());
        assert!(db.into_transaction_log().is_empty(), "no query must run");
    }
}
