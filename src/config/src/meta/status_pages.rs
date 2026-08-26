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

//! Status-page uptime engine: the auto-incident state machine and the
//! notice-derived downtime math (segment union, day buckets, uptime windows).
//!
//! Pure logic, no I/O. Lives in `config::meta` rather than `openobserve-core`
//! because the rebuilder in `openobserve-synthetics` must drive it and that
//! crate does not depend on core.
//!
//! The semantics implemented here are the published contract of the public
//! page: downtime accrues only inside incident notices (impact ≥ partial
//! outage), as a union of per-notice segments — never summed overlaps, never
//! counting the healthy gap a merge-window re-open spans. Uptime denominators
//! are capped at `tracking_since` so a young page never fabricates a 90-day
//! figure.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// Consecutive failed runs before an auto-incident opens.
pub const DEFAULT_CONFIRM_FAILURES: i32 = 2;
/// Consecutive passing observations before an auto-incident resolves.
pub const DEFAULT_CONFIRM_RECOVERY: i32 = 2;
/// A re-fail within this window re-opens the resolved notice (new segment)
/// instead of opening a new one, so flap episodes stay one incident.
pub const MERGE_WINDOW_MICROS: i64 = 10 * 60 * 1_000_000;
/// Days of public history.
pub const HISTORY_DAYS: usize = 90;

/// `synthetics.last_check_status` values (entity/synthetics_checks.rs).
pub const CHECK_STATUS_UNKNOWN: i32 = 0;
pub const CHECK_STATUS_UP: i32 = 1;
pub const CHECK_STATUS_WARNING: i32 = 2;
pub const CHECK_STATUS_DOWN: i32 = 3;

const MICROS_PER_MIN: i64 = 60 * 1_000_000;
const MICROS_PER_DAY: i64 = 86_400 * 1_000_000;

/// Day-cell grade, Statuspage-style: one confirmed blip colors a day yellow at
/// most, never solid red.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Grade {
    Ok,
    Minor,
    Major,
    Severe,
    Maint,
    NoData,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Impact {
    None = 0,
    Degraded = 1,
    PartialOutage = 2,
    MajorOutage = 3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    Incident = 0,
    Maintenance = 1,
    Info = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeState {
    Scheduled = 0,
    Active = 1,
    Resolved = 2,
}

/// Component status by notice precedence: Major > Partial > Degraded >
/// Maintenance > Operational. NoData is orthogonal (a dead probe is gray, not
/// green — and not an outage either).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentStatus {
    Operational = 0,
    NoData = 1,
    Maintenance = 2,
    Degraded = 3,
    PartialOutage = 4,
    MajorOutage = 5,
}

/// One downtime interval inside a notice. `to = None` means still open.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment {
    pub from: i64,
    pub to: Option<i64>,
}

/// What the rebuilder observed about one mapped check this tick.
#[derive(Clone, Debug)]
pub struct EngineCheck {
    pub id: String,
    pub last_check_status: i32,
    pub consecutive_failures: i32,
    /// First failing run of the current streak, when the caller can supply it
    /// (from run records). Used to backdate `starts_at`; falls back to `now`.
    pub first_fail_at: Option<i64>,
    /// When the streak started failing, for time-based confirmation.
    pub failing_since: Option<i64>,
}

/// An auto-incident notice currently open (or just resolved, for the merge
/// window) for a check.
#[derive(Clone, Debug)]
pub struct OpenAutoIncident {
    pub notice_id: String,
    pub check_id: String,
    pub recovery_streak: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct Thresholds {
    pub confirm_failures: i32,
    pub confirm_recovery: i32,
    pub confirm_after_micros: Option<i64>,
}

/// What the rebuilder must do to the notices table after one tick.
#[derive(Clone, Debug, PartialEq)]
pub enum EngineAction {
    Open {
        check_id: String,
        starts_at: i64,
    },
    /// Merge-window re-fail: append a fresh open segment to the old notice.
    Reopen {
        notice_id: String,
        from: i64,
    },
    /// Recovery observed but not yet confirmed (or reset to 0 on a re-fail).
    RecoveryProgress {
        notice_id: String,
        streak: i32,
    },
    Resolve {
        notice_id: String,
        at: i64,
    },
}

// ── Admin API DTOs (authenticated plane) ─────────────────────────────────────
// Request/response shapes for the admin CRUD plane. The load-bearing security
// property: NO response type here carries `password_hash` — it is write-only
// (R-6). `password` on the request is plaintext-in, Argon2id-at-rest, never
// echoed back.

#[derive(Debug, Clone, Deserialize)]
pub struct CreatePageRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdatePageRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    /// 0 draft, 1 public, 2 password.
    pub visibility: Option<i32>,
    /// Plaintext in; hashed at rest; never returned. Setting an empty string
    /// clears the password (visibility must then leave 2).
    pub password: Option<String>,
    pub noindex: Option<bool>,
    pub show_uptime_percent: Option<bool>,
    pub show_timeline_bars: Option<bool>,
    pub show_response_time: Option<bool>,
    pub confirm_failures: Option<i32>,
    pub confirm_recovery: Option<i32>,
    pub confirm_after_secs: Option<i32>,
    pub brand_name: Option<String>,
    pub accent_color: Option<String>,
    /// Base64-encoded image. Enterprise-gated on write (see
    /// `apply_logo_field`); an already-set logo keeps rendering under a
    /// lapsed license or an OSS build.
    pub logo_img: Option<String>,
}

/// Admin view of a page. Deliberately omits `password_hash`; carries only
/// whether a password is set.
#[derive(Debug, Clone, Serialize)]
pub struct PageAdminView {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub visibility: i32,
    pub password_set: bool,
    pub noindex: bool,
    pub show_uptime_percent: bool,
    pub show_timeline_bars: bool,
    pub show_response_time: bool,
    pub confirm_failures: i32,
    pub confirm_recovery: i32,
    pub confirm_after_secs: Option<i32>,
    pub brand_name: Option<String>,
    pub accent_color: Option<String>,
    pub logo_img: Option<String>,
    pub tracking_since: Option<i64>,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Live health summary for the list view (worst component status).
    pub health: Option<ComponentStatus>,
    pub component_count: i64,
    /// Populated only by the detail GET (not the list), so the edit UI can
    /// render and round-trip the existing component→check mapping.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub components: Option<Vec<ComponentView>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageListResponse {
    pub pages: Vec<PageAdminView>,
    pub total: i64,
}

/// A component as returned by the admin GET (id + name + its mapped check ids),
/// so the edit UI can render the existing mapping. The list view omits this.
#[derive(Debug, Clone, Serialize)]
pub struct ComponentView {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub check_ids: Vec<String>,
}

/// One component in the bulk component-replace PUT. `check_ids` are the
/// synthetics checks it maps; the handler MUST verify folder-level synthetics
/// read on each before writing (R-1 — top build risk).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentInput {
    /// Present = update in place (stable id); absent = create.
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub check_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetComponentsRequest {
    pub components: Vec<ComponentInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateNoticeRequest {
    /// 0 incident, 1 maintenance, 2 info.
    pub kind: i32,
    /// 0 none, 1 degraded, 2 partial_outage, 3 major_outage.
    pub impact: i32,
    pub title: String,
    pub body: String,
    /// Component ids this notice affects (drives status + uptime).
    #[serde(default)]
    pub component_ids: Vec<String>,
    /// Maintenance scheduling (micros); None = active now.
    pub starts_at: Option<i64>,
}

/// Partial edit of a manual notice. `state`/`resolved_at` are the manual
/// resolve path; auto-incidents are otherwise owned by the rebuilder and this
/// must not race it (the handler rejects editing state on an auto-sourced
/// notice — see R-4 in the design).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateNoticeRequest {
    pub impact: Option<i32>,
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default)]
    pub component_ids: Option<Vec<String>>,
    /// 0 scheduled, 1 active, 2 resolved.
    pub state: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NoticeUpdateRequest {
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MarkFalsePositiveRequest {
    /// Hours to snooze the underlying check org-wide (default 6, per mockup
    /// B1's "snooze 6h").
    #[serde(default = "default_snooze_hours")]
    pub snooze_hours: i64,
}

/// Admin view of a notice: unlike [`PublicNotice`], this carries the internal
/// id and mapped component ids the edit UI needs to round-trip — it must
/// never be reachable from the public plane.
#[derive(Debug, Clone, Serialize)]
pub struct NoticeAdminView {
    pub id: String,
    pub kind: i32,
    pub impact: i32,
    /// 0 auto, 1 manual.
    pub source: i32,
    pub title: String,
    pub body: String,
    pub state: i32,
    pub starts_at: i64,
    pub resolved_at: Option<i64>,
    pub excluded_from_uptime: bool,
    pub component_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoticeUpdateView {
    pub id: String,
    pub body: String,
    pub owner: Option<String>,
    pub created_at: i64,
}

// ── Snapshot types: the ONLY shapes the public plane ever serializes ─────────
// Adding a field here means publishing it to the internet; the allowlist test
// at the bottom is the merge gate.

#[derive(Clone, Debug, Serialize)]
pub struct PublicNotice {
    // No internal notice id — the public page never addresses a notice, and a
    // snowflake id is needless IDOR surface (pentest finding, 2026-08-22).
    pub kind: NoticeKind,
    pub impact: Impact,
    pub title: String,
    pub body: String,
    pub state: NoticeState,
    pub starts_at: i64,
    pub resolved_at: Option<i64>,
    pub excluded_from_uptime: bool,
    /// The "investigating / mitigated / resolved" narrative timeline, oldest
    /// first. No internal update id — same IDOR reasoning as the notice.
    pub updates: Vec<PublicNoticeUpdate>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PublicNoticeUpdate {
    pub body: String,
    pub at: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct CurrentComponent {
    /// Per-page opaque key ("c0", "c1", …) that joins current↔history on the
    /// client. Deliberately NOT the internal component id — that id is a
    /// sequential internal handle and must not reach the public plane.
    pub key: String,
    pub name: String,
    pub status: ComponentStatus,
}

/// The hot snapshot half: rewritten on state change (~1-2KB).
#[derive(Clone, Debug, Serialize)]
pub struct SnapshotCurrent {
    pub overall: ComponentStatus,
    pub generated_at: i64,
    pub components: Vec<CurrentComponent>,
    pub notices: Vec<PublicNotice>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DayBucket {
    pub date: String,
    pub downtime_min: i64,
    pub maint_min: i64,
    pub grade: Grade,
}

#[derive(Clone, Debug, Serialize)]
pub struct UptimeWindows {
    pub d1: Option<f64>,
    pub d7: Option<f64>,
    pub d30: Option<f64>,
    pub d90: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct HistoryComponent {
    /// Same per-page opaque key as `CurrentComponent.key` — the client join
    /// handle, never the internal component id.
    pub key: String,
    pub name: String,
    pub uptime: UptimeWindows,
    pub daily: Vec<DayBucket>,
}

/// The cold snapshot half: rewritten on day rollover or notice change (~30KB).
#[derive(Clone, Debug, Serialize)]
pub struct SnapshotHistory {
    pub generated_at: i64,
    pub components: Vec<HistoryComponent>,
}

/// The admin preview response: both snapshot halves through the exact same
/// serializer the public plane uses, so preview cannot diverge from what
/// visitors will see once published.
#[derive(Clone, Debug, Serialize)]
pub struct PreviewResponse {
    pub current: SnapshotCurrent,
    pub history: SnapshotHistory,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateDomainRequest {
    pub domain: String,
}

/// The DNS TXT record the admin needs to create — `txt_name`/`txt_value`
/// spelled out because the raw `domain` + `verification_token` pairing isn't
/// self-explanatory to a non-engineer reading it off an API response.
#[derive(Debug, Clone, Serialize)]
pub struct CreateDomainResponse {
    pub id: String,
    pub domain: String,
    pub txt_name: String,
    pub txt_value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DomainAdminView {
    pub id: String,
    pub domain: String,
    /// 0 pending, 1 verified, 2 failed.
    pub verification_state: i32,
    /// 0 record-missing, 1 value-mismatch, 2 dns-resolution-failed.
    pub verification_failure_reason: Option<i32>,
    pub verified_at: Option<i64>,
    pub last_checked_at: Option<i64>,
    pub created_at: i64,
}

fn default_snooze_hours() -> i64 {
    6
}

impl Default for Thresholds {
    fn default() -> Self {
        Self {
            confirm_failures: DEFAULT_CONFIRM_FAILURES,
            confirm_recovery: DEFAULT_CONFIRM_RECOVERY,
            confirm_after_micros: None,
        }
    }
}

impl Impact {
    pub fn from_i16(v: i16) -> Self {
        match v {
            1 => Self::Degraded,
            2 => Self::PartialOutage,
            3 => Self::MajorOutage,
            _ => Self::None,
        }
    }

    /// Only partial and major outages accrue downtime; degraded shows amber
    /// but never moves the percentage (published semantics).
    pub fn accrues_downtime(self) -> bool {
        matches!(self, Self::PartialOutage | Self::MajorOutage)
    }

    pub fn component_status(self) -> ComponentStatus {
        match self {
            Self::None => ComponentStatus::Operational,
            Self::Degraded => ComponentStatus::Degraded,
            Self::PartialOutage => ComponentStatus::PartialOutage,
            Self::MajorOutage => ComponentStatus::MajorOutage,
        }
    }
}

impl NoticeKind {
    pub fn from_i16(v: i16) -> Self {
        match v {
            1 => Self::Maintenance,
            2 => Self::Info,
            _ => Self::Incident,
        }
    }
}

impl NoticeState {
    pub fn from_i16(v: i16) -> Self {
        match v {
            0 => Self::Scheduled,
            2 => Self::Resolved,
            _ => Self::Active,
        }
    }
}

/// Decides open/re-open/recover/resolve for every mapped check this tick.
///
/// `recently_resolved` carries (notice_id, resolved_at) per check for the
/// merge window. `snoozed` suppresses opening only — an already-open incident
/// is resolved by the false-positive action itself, not by the snooze.
pub fn incident_actions(
    checks: &[EngineCheck],
    open_by_check: &HashMap<String, OpenAutoIncident>,
    recently_resolved: &HashMap<String, (String, i64)>,
    snoozed: &HashSet<String>,
    th: &Thresholds,
    now: i64,
) -> Vec<EngineAction> {
    let mut actions = Vec::new();
    for check in checks {
        match open_by_check.get(&check.id) {
            Some(open) => handle_open(check, open, th, now, &mut actions),
            None => handle_closed(check, recently_resolved, snoozed, th, now, &mut actions),
        }
    }
    actions
}

/// True once the failing streak clears either the run-count or the time-based
/// confirmation bar.
fn is_confirmed_failing(check: &EngineCheck, th: &Thresholds, now: i64) -> bool {
    if check.last_check_status != CHECK_STATUS_DOWN {
        return false;
    }
    if check.consecutive_failures >= th.confirm_failures {
        return true;
    }
    match (th.confirm_after_micros, check.failing_since) {
        (Some(after), Some(since)) => check.consecutive_failures > 0 && now - since >= after,
        _ => false,
    }
}

fn handle_open(
    check: &EngineCheck,
    open: &OpenAutoIncident,
    th: &Thresholds,
    now: i64,
    actions: &mut Vec<EngineAction>,
) {
    if check.last_check_status == CHECK_STATUS_UP {
        let streak = open.recovery_streak + 1;
        if streak >= th.confirm_recovery {
            actions.push(EngineAction::Resolve {
                notice_id: open.notice_id.clone(),
                at: now,
            });
        } else {
            actions.push(EngineAction::RecoveryProgress {
                notice_id: open.notice_id.clone(),
                streak,
            });
        }
    } else if check.last_check_status == CHECK_STATUS_DOWN && open.recovery_streak > 0 {
        // Failed again mid-recovery: the streak restarts from zero.
        actions.push(EngineAction::RecoveryProgress {
            notice_id: open.notice_id.clone(),
            streak: 0,
        });
    }
}

fn handle_closed(
    check: &EngineCheck,
    recently_resolved: &HashMap<String, (String, i64)>,
    snoozed: &HashSet<String>,
    th: &Thresholds,
    now: i64,
    actions: &mut Vec<EngineAction>,
) {
    if snoozed.contains(&check.id) || !is_confirmed_failing(check, th, now) {
        return;
    }
    let starts_at = check.first_fail_at.unwrap_or(now);
    match recently_resolved.get(&check.id) {
        Some((notice_id, resolved_at)) if now - resolved_at <= MERGE_WINDOW_MICROS => {
            actions.push(EngineAction::Reopen {
                notice_id: notice_id.clone(),
                from: starts_at,
            });
        }
        _ => actions.push(EngineAction::Open {
            check_id: check.id.clone(),
            starts_at,
        }),
    }
}

/// Minutes of downtime inside `[win_start, win_end)` from a set of segments,
/// as a UNION — overlapping segments (two checks confirming the same outage)
/// count once, and the healthy gap between a notice's segments counts never.
pub fn union_downtime_micros(segments: &[Segment], win_start: i64, win_end: i64) -> i64 {
    let mut clipped: Vec<(i64, i64)> = segments
        .iter()
        .filter_map(|s| {
            let from = s.from.max(win_start);
            let to = s.to.unwrap_or(win_end).min(win_end);
            (to > from).then_some((from, to))
        })
        .collect();
    clipped.sort_unstable();
    let mut total = 0;
    let mut cur: Option<(i64, i64)> = None;
    for (from, to) in clipped {
        match cur {
            Some((cf, ct)) if from <= ct => cur = Some((cf, ct.max(to))),
            Some((cf, ct)) => {
                total += ct - cf;
                cur = Some((from, to));
            }
            None => cur = Some((from, to)),
        }
    }
    if let Some((cf, ct)) = cur {
        total += ct - cf;
    }
    total
}

pub fn grade_for(downtime_min: i64, maint_min: i64, has_data: bool) -> Grade {
    if !has_data {
        Grade::NoData
    } else if downtime_min >= 40 {
        Grade::Severe
    } else if downtime_min >= 20 {
        Grade::Major
    } else if downtime_min > 0 {
        Grade::Minor
    } else if maint_min > 0 {
        Grade::Maint
    } else {
        Grade::Ok
    }
}

/// The 90 day cells for one component. POC bucketing is by fixed UTC offset
/// (`tz_offset_micros`); the working module replaces this with IANA-zone
/// bucketing via chrono-tz per the design.
pub fn day_buckets(
    incident_segments: &[Segment],
    maint_segments: &[Segment],
    tz_offset_micros: i64,
    tracking_since: Option<i64>,
    now: i64,
) -> Vec<DayBucket> {
    let today_start =
        ((now + tz_offset_micros) / MICROS_PER_DAY) * MICROS_PER_DAY - tz_offset_micros;
    (0..HISTORY_DAYS as i64)
        .rev()
        .map(|back| {
            let start = today_start - back * MICROS_PER_DAY;
            let end = (start + MICROS_PER_DAY).min(now);
            let has_data = tracking_since.is_some_and(|t| end > t);
            let downtime = union_downtime_micros(incident_segments, start, end) / MICROS_PER_MIN;
            let maint = union_downtime_micros(maint_segments, start, end) / MICROS_PER_MIN;
            DayBucket {
                date: format_utc_date((start + tz_offset_micros) / MICROS_PER_DAY),
                downtime_min: downtime,
                maint_min: maint,
                grade: grade_for(downtime, maint, has_data),
            }
        })
        .collect()
}

/// Rolling-window uptime percentages with the denominator capped at
/// `tracking_since` — a page tracking for 10 days reports "100% since <date>",
/// never a fabricated 90-day figure. `None` = no tracked time in the window.
pub fn uptime_windows(
    incident_segments: &[Segment],
    tracking_since: Option<i64>,
    now: i64,
) -> UptimeWindows {
    let one = |days: i64| -> Option<f64> {
        let win_start = now - days * MICROS_PER_DAY;
        let start = tracking_since.map_or(win_start, |t| t.max(win_start));
        let window = now - start;
        if tracking_since.is_none() || window <= 0 {
            return None;
        }
        let down = union_downtime_micros(incident_segments, start, now);
        Some(((window - down) as f64 / window as f64) * 100.0)
    };
    UptimeWindows {
        d1: one(1),
        d7: one(7),
        d30: one(30),
        d90: one(90),
    }
}

/// Worst-wins across components, NoData never masquerading as an outage.
pub fn overall_status(components: &[CurrentComponent]) -> ComponentStatus {
    components
        .iter()
        .map(|c| c.status)
        .max()
        .unwrap_or(ComponentStatus::Operational)
}

/// Days since epoch → "YYYY-MM-DD" without pulling a date crate into the hot
/// path (civil-date algorithm, Howard Hinnant's `civil_from_days`).
fn format_utc_date(days_since_epoch: i64) -> String {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = MICROS_PER_MIN;

    fn seg(from: i64, to: i64) -> Segment {
        Segment { from, to: Some(to) }
    }

    fn check(id: &str, status: i32, streak: i32) -> EngineCheck {
        EngineCheck {
            id: id.into(),
            last_check_status: status,
            consecutive_failures: streak,
            first_fail_at: None,
            failing_since: None,
        }
    }

    #[test]
    fn union_counts_overlaps_once() {
        // Two checks confirm the same outage: 10:00-10:30 and 10:10-10:40.
        let segs = [seg(0, 30 * MIN), seg(10 * MIN, 40 * MIN)];
        assert_eq!(union_downtime_micros(&segs, 0, 60 * MIN), 40 * MIN);
    }

    #[test]
    fn union_never_counts_the_gap_between_segments() {
        // A merge-window re-open: down 0-9, healthy 9-19, down again 19-28.
        let segs = [seg(0, 9 * MIN), seg(19 * MIN, 28 * MIN)];
        assert_eq!(union_downtime_micros(&segs, 0, 60 * MIN), 18 * MIN);
    }

    #[test]
    fn union_clips_to_the_window_and_extends_open_segments() {
        let segs = [Segment {
            from: 50 * MIN,
            to: None,
        }];
        assert_eq!(union_downtime_micros(&segs, 0, 60 * MIN), 10 * MIN);
        assert_eq!(union_downtime_micros(&segs, 55 * MIN, 60 * MIN), 5 * MIN);
        assert_eq!(union_downtime_micros(&segs, 0, 40 * MIN), 0);
    }

    #[test]
    fn incident_opens_only_at_the_confirmation_threshold() {
        let th = Thresholds::default();
        let none = HashMap::new();
        let quiet = HashSet::new();
        let one_fail = [check("c1", CHECK_STATUS_DOWN, 1)];
        assert!(incident_actions(&one_fail, &none, &HashMap::new(), &quiet, &th, 0).is_empty());
        let confirmed = [check("c1", CHECK_STATUS_DOWN, 2)];
        let actions = incident_actions(&confirmed, &none, &HashMap::new(), &quiet, &th, 7);
        assert_eq!(
            actions,
            vec![EngineAction::Open {
                check_id: "c1".into(),
                starts_at: 7
            }]
        );
    }

    #[test]
    fn backdating_uses_the_first_failing_run_when_known() {
        let th = Thresholds::default();
        let mut c = check("c1", CHECK_STATUS_DOWN, 2);
        c.first_fail_at = Some(1_000);
        let actions = incident_actions(
            &[c],
            &HashMap::new(),
            &HashMap::new(),
            &HashSet::new(),
            &th,
            9_000,
        );
        assert_eq!(
            actions,
            vec![EngineAction::Open {
                check_id: "c1".into(),
                starts_at: 1_000
            }]
        );
    }

    #[test]
    fn time_based_confirmation_catches_slow_checks() {
        let th = Thresholds {
            confirm_after_micros: Some(5 * MIN),
            ..Default::default()
        };
        // One failed run of an hourly check, failing for six minutes.
        let mut c = check("slow", CHECK_STATUS_DOWN, 1);
        c.failing_since = Some(0);
        let actions = incident_actions(
            &[c],
            &HashMap::new(),
            &HashMap::new(),
            &HashSet::new(),
            &th,
            6 * MIN,
        );
        assert!(matches!(actions.as_slice(), [EngineAction::Open { .. }]));
    }

    #[test]
    fn snooze_suppresses_opening() {
        let th = Thresholds::default();
        let snoozed: HashSet<String> = ["c1".to_string()].into();
        let confirmed = [check("c1", CHECK_STATUS_DOWN, 5)];
        assert!(
            incident_actions(
                &confirmed,
                &HashMap::new(),
                &HashMap::new(),
                &snoozed,
                &th,
                0
            )
            .is_empty()
        );
    }

    #[test]
    fn refail_inside_the_merge_window_reopens_the_same_notice() {
        let th = Thresholds::default();
        let resolved: HashMap<String, (String, i64)> =
            [("c1".to_string(), ("n1".to_string(), 100))].into();
        let confirmed = [check("c1", CHECK_STATUS_DOWN, 2)];
        let inside = incident_actions(
            &confirmed,
            &HashMap::new(),
            &resolved,
            &HashSet::new(),
            &th,
            100 + MERGE_WINDOW_MICROS,
        );
        assert!(
            matches!(inside.as_slice(), [EngineAction::Reopen { notice_id, .. }] if notice_id == "n1")
        );
        let outside = incident_actions(
            &confirmed,
            &HashMap::new(),
            &resolved,
            &HashSet::new(),
            &th,
            101 + MERGE_WINDOW_MICROS,
        );
        assert!(matches!(outside.as_slice(), [EngineAction::Open { .. }]));
    }

    #[test]
    fn recovery_confirms_then_resolves_and_a_refail_resets_the_streak() {
        let th = Thresholds::default();
        let open: HashMap<String, OpenAutoIncident> = [(
            "c1".to_string(),
            OpenAutoIncident {
                notice_id: "n1".into(),
                check_id: "c1".into(),
                recovery_streak: 0,
            },
        )]
        .into();
        let up = [check("c1", CHECK_STATUS_UP, 0)];
        let first = incident_actions(&up, &open, &HashMap::new(), &HashSet::new(), &th, 0);
        assert_eq!(
            first,
            vec![EngineAction::RecoveryProgress {
                notice_id: "n1".into(),
                streak: 1
            }]
        );

        let mut recovering = open.clone();
        recovering.get_mut("c1").unwrap().recovery_streak = 1;
        let second = incident_actions(&up, &recovering, &HashMap::new(), &HashSet::new(), &th, 9);
        assert_eq!(
            second,
            vec![EngineAction::Resolve {
                notice_id: "n1".into(),
                at: 9
            }]
        );

        let down = [check("c1", CHECK_STATUS_DOWN, 1)];
        let reset = incident_actions(&down, &recovering, &HashMap::new(), &HashSet::new(), &th, 9);
        assert_eq!(
            reset,
            vec![EngineAction::RecoveryProgress {
                notice_id: "n1".into(),
                streak: 0
            }]
        );
    }

    #[test]
    fn grades_follow_the_statuspage_thresholds() {
        assert_eq!(grade_for(0, 0, true), Grade::Ok);
        assert_eq!(grade_for(1, 0, true), Grade::Minor);
        assert_eq!(grade_for(19, 0, true), Grade::Minor);
        assert_eq!(grade_for(20, 0, true), Grade::Major);
        assert_eq!(grade_for(40, 0, true), Grade::Severe);
        assert_eq!(grade_for(0, 30, true), Grade::Maint);
        assert_eq!(grade_for(0, 0, false), Grade::NoData);
        // Maintenance never hides real downtime in the same day.
        assert_eq!(grade_for(5, 30, true), Grade::Minor);
    }

    #[test]
    fn uptime_denominator_is_capped_at_tracking_since() {
        let now = 100 * MICROS_PER_DAY;
        // Tracking for exactly 10 days, one hour down inside them.
        let tracking = Some(now - 10 * MICROS_PER_DAY);
        let segs = [seg(
            now - 2 * MICROS_PER_DAY,
            now - 2 * MICROS_PER_DAY + 60 * MIN,
        )];
        let w = uptime_windows(&segs, tracking, now);
        // The 90d and 30d figures use a 10-day denominator, so they are equal.
        assert_eq!(w.d90, w.d30);
        let ten_days = (10 * MICROS_PER_DAY) as f64;
        let expected = ((ten_days - (60 * MIN) as f64) / ten_days) * 100.0;
        assert!((w.d90.unwrap() - expected).abs() < 1e-9);
        // Untracked page: no numbers, never a fake 100%.
        assert_eq!(uptime_windows(&segs, None, now).d90, None);
    }

    #[test]
    fn overall_is_worst_component_and_no_data_never_outranks_an_outage() {
        let comps = vec![
            CurrentComponent {
                key: "c0".into(),
                name: "A".into(),
                status: ComponentStatus::NoData,
            },
            CurrentComponent {
                key: "c1".into(),
                name: "B".into(),
                status: ComponentStatus::PartialOutage,
            },
        ];
        assert_eq!(overall_status(&comps), ComponentStatus::PartialOutage);
        assert_eq!(overall_status(&[]), ComponentStatus::Operational);
    }

    #[test]
    fn day_buckets_span_90_days_and_pretracking_days_are_gray() {
        let now = 200 * MICROS_PER_DAY + 12 * 60 * MIN; // midday
        let tracking = Some(now - 10 * MICROS_PER_DAY);
        let buckets = day_buckets(&[], &[], 0, tracking, now);
        assert_eq!(buckets.len(), HISTORY_DAYS);
        assert_eq!(buckets[0].grade, Grade::NoData); // 90 days ago
        assert_eq!(buckets[HISTORY_DAYS - 1].grade, Grade::Ok); // today
    }

    /// The serializer allowlist: the public snapshot JSON must never leak
    /// internal identifiers. Serializes fully-populated snapshots and asserts
    /// the banned vocabulary is absent — the merge gate from the design.
    #[test]
    fn snapshot_json_never_contains_internal_fields() {
        let current = SnapshotCurrent {
            overall: ComponentStatus::PartialOutage,
            generated_at: 1,
            components: vec![CurrentComponent {
                key: "c0".into(),
                name: "API".into(),
                status: ComponentStatus::PartialOutage,
            }],
            notices: vec![PublicNotice {
                kind: NoticeKind::Incident,
                impact: Impact::PartialOutage,
                title: "Elevated errors".into(),
                body: "Investigating".into(),
                state: NoticeState::Active,
                starts_at: 1,
                resolved_at: None,
                excluded_from_uptime: false,
                updates: vec![PublicNoticeUpdate {
                    body: "Mitigation deployed".into(),
                    at: 2,
                }],
            }],
        };
        let history = SnapshotHistory {
            generated_at: 1,
            components: vec![HistoryComponent {
                key: "c0".into(),
                name: "API".into(),
                uptime: uptime_windows(&[], Some(0), 10),
                daily: day_buckets(&[], &[], 0, Some(0), 10 * MICROS_PER_DAY),
            }],
        };
        let json = format!(
            "{}{}",
            serde_json::to_string(&current).unwrap(),
            serde_json::to_string(&history).unwrap()
        );
        for banned in [
            "target",
            "\"url\"",
            "\"config\"",
            "secret",
            "org_id",
            "folder",
            "synthetics_id",
            "check_id",
            "location",
            "password",
            // Internal handles must never reach the public plane; the client
            // joins on the opaque per-page "key" instead (pentest finding).
            "component_id",
            "notice_id",
            "\"id\"",
        ] {
            assert!(
                !json.contains(banned),
                "public snapshot leaks {banned}: {json}"
            );
        }
    }

    /// R-6: the admin page view must never serialize the password hash, only
    /// whether a password is set. A regression here leaks the hash to any
    /// authorized admin GET.
    #[test]
    fn admin_page_view_never_serializes_password_hash() {
        let view = PageAdminView {
            id: "p1".into(),
            name: "Acme".into(),
            slug: "abc".into(),
            description: None,
            visibility: 2,
            password_set: true,
            noindex: true,
            show_uptime_percent: true,
            show_timeline_bars: true,
            show_response_time: false,
            confirm_failures: 2,
            confirm_recovery: 2,
            confirm_after_secs: None,
            brand_name: None,
            accent_color: None,
            logo_img: None,
            tracking_since: None,
            owner: Some("a@b.c".into()),
            created_at: 1,
            updated_at: 1,
            health: Some(ComponentStatus::Operational),
            component_count: 3,
            components: None,
        };
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("password_hash"), "{json}");
        assert!(json.contains("\"password_set\":true"), "{json}");
    }
}
