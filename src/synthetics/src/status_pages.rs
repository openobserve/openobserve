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
    db::{ORM_CLIENT, connect_to_orm},
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
    snoozed: HashSet<String>,
    notices: Vec<status_page_notices::Model>,
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
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

    let data = TickData {
        pages: vec![page.clone()],
        components,
        mappings,
        states: Vec::new(),
        snoozed: HashSet::new(),
        notices: notices.clone(),
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
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

pub async fn run() {
    let interval = config::get_config()
        .synthetics
        .status_page_rebuild_interval
        .max(10);
    let mut hashes = SnapshotHashes::new();
    // Confirmation streaks observed by THIS loop from `last_check_status`.
    // Deliberately not the checks table's `consecutive_failures`: the ack path
    // clears that column for destination-less checks (it is alert bookkeeping,
    // not neutral state), so a status page keyed on it would never confirm an
    // outage on a check with no alert destinations.
    let mut down_streaks: HashMap<String, i32> = HashMap::new();
    // Full mapped-check state, carried across ticks and refreshed by an
    // `updated_at`-watermark delta so per-tick DB cost tracks status *changes*,
    // not the mapped-check count. A full sweep every FULL_SWEEP_TICKS catches
    // deletions and refreshes `last_triggered_at` for the dead-probe rule.
    let mut rt = RebuilderState::default();
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
        if let Err(e) = tick(&mut hashes, &mut down_streaks, &mut rt).await {
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
}

async fn tick(
    hashes: &mut SnapshotHashes,
    down_streaks: &mut HashMap<String, i32>,
    rt: &mut RebuilderState,
) -> Result<(), infra::errors::Error> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = config::utils::time::now_micros();
    let data = load(conn, now, rt).await?;
    for s in &data.states {
        if s.last_check_status == engine::CHECK_STATUS_DOWN {
            *down_streaks.entry(s.id.clone()).or_insert(0) += 1;
        } else {
            down_streaks.remove(&s.id);
        }
    }
    apply_engine_actions(conn, &data, down_streaks, now).await?;
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

    // Delta by default; full sweep on the Nth tick. The sweep replaces the
    // cache wholesale (so deleted/unmapped checks drop out); the delta merges
    // only changed rows over the carried cache.
    let full_sweep = rt.tick_count.is_multiple_of(FULL_SWEEP_TICKS);
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

    let snoozed = table::list_active_snoozes(conn, now)
        .await?
        .into_iter()
        .map(|s| s.synthetics_id)
        .collect();
    let notices = table::list_notices_since(conn, now - RESOLVED_LOOKBACK_MICROS).await?;
    Ok(TickData {
        pages,
        components,
        mappings,
        states,
        snoozed,
        notices,
    })
}

async fn apply_engine_actions(
    conn: &sea_orm::DatabaseConnection,
    data: &TickData,
    down_streaks: &HashMap<String, i32>,
    now: i64,
) -> Result<(), infra::errors::Error> {
    let checks: Vec<engine::EngineCheck> = data
        .states
        .iter()
        .map(|s| engine::EngineCheck {
            id: s.id.clone(),
            last_check_status: s.last_check_status,
            // The loop's own observed streak, never the DB column — see run().
            consecutive_failures: down_streaks.get(&s.id).copied().unwrap_or(0),
            first_fail_at: None,
            failing_since: None,
        })
        .collect();

    let mut open_by_check = HashMap::new();
    let mut recently_resolved = HashMap::new();
    for n in &data.notices {
        let Some(check_id) = n.auto_check_id.clone() else {
            continue;
        };
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
                .or_insert((n.id.clone(), resolved_at));
            if resolved_at > entry.1 {
                *entry = (n.id.clone(), resolved_at);
            }
        }
    }

    let actions = engine::incident_actions(
        &checks,
        &open_by_check,
        &recently_resolved,
        &data.snoozed,
        &engine::Thresholds::default(),
        now,
    );
    for action in actions {
        apply_one(conn, data, action, now).await?;
    }
    Ok(())
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
        let has_checks = data.mappings.iter().any(|m| m.component_id == component.id);
        if !has_checks {
            status = engine::ComponentStatus::NoData;
        }
        current_components.push(engine::CurrentComponent {
            key: key.clone(),
            name: component.name.clone(),
            status,
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
    (current, history, page_notice_ids.into_iter().collect())
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
