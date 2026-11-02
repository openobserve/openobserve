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

//! DTOs for public dashboards: the admin body and the anonymous config and data responses.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::meta::{dashboards::Dashboard, stream::StreamType};

/// The refresh interval a new link gets when the request names none.
pub const DEFAULT_REFRESH_SECS: i32 = 300;
/// The longest refresh interval a link can select.
pub const MAX_REFRESH_SECS: i32 = 30 * 86_400;
/// The shortest refresh interval a link can select.
pub const MIN_REFRESH_SECS: i32 = 60;

/// Draft configures the share without exposing it; Public serves it and is the default.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Draft,
    #[default]
    Public,
}

impl Visibility {
    pub fn to_i32(self) -> i32 {
        match self {
            Self::Draft => 0,
            Self::Public => 1,
        }
    }

    pub fn from_i32(v: i32) -> Self {
        match v {
            1 => Self::Public,
            _ => Self::Draft,
        }
    }
}

/// One window a link offers: rolling and refreshed on read, or fixed and built once.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TimeRange {
    Relative {
        secs: i64,
    },
    /// UTC micros.
    Absolute {
        start: i64,
        end: i64,
    },
}

impl TimeRange {
    /// The id its result is stored under and the viewer asks for.
    pub fn key(&self) -> String {
        match self {
            Self::Relative { secs } => format!("r{secs}"),
            Self::Absolute { start, end } => format!("a{start}-{end}"),
        }
    }

    pub fn is_relative(&self) -> bool {
        matches!(self, Self::Relative { .. })
    }

    pub fn length_secs(&self) -> i64 {
        match self {
            Self::Relative { secs } => *secs,
            Self::Absolute { start, end } => (end - start) / 1_000_000,
        }
    }

    /// The `(start, end)` micros a build at `now` covers.
    pub fn window(&self, now: i64) -> (i64, i64) {
        match self {
            Self::Relative { secs } => (now - secs * 1_000_000, now),
            Self::Absolute { start, end } => (*start, *end),
        }
    }

    /// `ceil_to_minute(max(selected, window / 288, min_refresh))`, from the current settings.
    pub fn effective_refresh_secs(&self, selected: i64, min_refresh: i64) -> i64 {
        // ceil(window / 288): a 1441-minute window needs 301 s, not 300.
        let secs = selected
            .max((self.length_secs().max(0) + 287) / 288)
            .max(min_refresh)
            .max(1);
        (secs + 59) / 60 * 60
    }
}

/// The ranges a link offers; with more than one, viewers can switch between them.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimeRangePolicy {
    pub ranges: Vec<TimeRange>,
    pub default: TimeRange,
}

/// Admin body to create or update a link; variables stay frozen at the author's values.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicDashboardConfig {
    /// Label that tells a dashboard's links apart; empty is allowed.
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub visibility: Visibility,
    pub time_range: TimeRangePolicy,
    #[serde(default)]
    pub frozen_variables: BTreeMap<String, serde_json::Value>,
    #[serde(default = "default_refresh_secs")]
    pub refresh_secs: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Admin body to take over a link; a publisher other than the one the caller saw is a 409.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeOverRequest {
    pub expected_publisher: String,
}

/// A link's state as the admin UI shows it; `NeedsAttention` comes from the batch status call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicLinkStatus {
    Live,
    Paused,
    NotViewed,
    NeedsAttention,
    Expired,
    DashboardDeleted,
    /// The org's public dashboards switch is off, so no link of the org is served.
    Disabled,
}

impl PublicLinkStatus {
    /// The lifecycle state from the row and the org switch. Precedence: deleted dashboard,
    /// expired, org switch off, paused, unviewed.
    pub fn derive(link: &PublicLinkState, org_enabled: bool, now: i64) -> Self {
        if !link.dashboard_exists {
            return Self::DashboardDeleted;
        }
        if link.expires_at.is_some_and(|exp| exp <= now) {
            return Self::Expired;
        }
        if !org_enabled {
            return Self::Disabled;
        }
        if !link.enabled {
            return Self::Paused;
        }
        if link.access_count == 0 {
            return Self::NotViewed;
        }
        Self::Live
    }
}

/// The stored facts [`PublicLinkStatus::derive`] needs, independent of the DB row type.
#[derive(Clone, Copy, Debug)]
pub struct PublicLinkState {
    pub dashboard_exists: bool,
    pub enabled: bool,
    pub expires_at: Option<i64>,
    pub access_count: i64,
}

/// Why a panel is withheld; deliberately generic, it never names a stream on the public plane.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotAvailableReason {
    Unauthorized,
    Unsupported,
    NoQuery,
    TooLarge,
    TooManyPanels,
    Truncated,
    BuildError,
    TooOld,
    Changed,
}

/// A panel's outcome: served (possibly retained, partial or truncated) or withheld.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PanelState {
    Ok {
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        retained: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_since: Option<i64>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        partial: bool,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        truncated: bool,
    },
    NotAvailable {
        reason: NotAvailableReason,
    },
}

impl PanelState {
    /// A fresh, complete panel.
    pub fn ok() -> Self {
        Self::Ok {
            retained: false,
            error_since: None,
            partial: false,
            truncated: false,
        }
    }
}

/// A panel the result file masks on every serve, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WithheldPanel {
    pub panel_id: String,
    pub reason: NotAvailableReason,
}

/// One range's result on the querier that owns the link, as the publisher's status call reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RangeState {
    Cached,
    NotCached,
    Building,
    NeedsAttention,
}

/// Status of one offered range, read from the owning querier's result file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RangeStatus {
    pub key: String,
    pub state: RangeState,
    pub built_at: Option<i64>,
    pub withheld_panels: Vec<WithheldPanel>,
    pub unavailable_count: u16,
    pub incomplete_count: u16,
    pub last_error: Option<String>,
    /// When the next build may start after a failure; absent from a querier that predates it.
    #[serde(default)]
    pub next_retry_at: Option<i64>,
    /// Panel id to the typed streams its data was read from; left out of the batch call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<BTreeMap<String, Vec<(StreamType, String)>>>,
}

/// One link's status call: its ranges from the owning querier and its access counters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LinkStatusReport {
    pub link_id: String,
    pub ranges: Vec<RangeStatus>,
    pub access_count: i64,
    pub last_accessed_at: Option<i64>,
}

/// The org's settings as the settings API has them; a null `max_links` is the env default.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrgPublicDashboardSettings {
    pub enabled: bool,
    #[serde(default)]
    pub max_links: Option<i32>,
}

/// A window in UTC micros.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    pub start: i64,
    pub end: i64,
}

/// One panel's output as the live renderer reads it; `data` is index-aligned to the queries.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PanelResult {
    pub state: PanelState,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub intent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub built_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<Window>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data: Vec<serde_json::Value>,
    #[serde(
        rename = "resultMetaData",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub result_meta_data: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub metadata: serde_json::Value,
}

impl PanelResult {
    /// A withheld panel: its state and nothing else.
    pub fn not_available(reason: NotAvailableReason) -> Self {
        Self {
            state: PanelState::NotAvailable { reason },
            intent: String::new(),
            built_at: None,
            window: None,
            data: Vec::new(),
            result_meta_data: Vec::new(),
            metadata: serde_json::Value::Null,
        }
    }
}

/// One range's panels and the variable values they were built with.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ResultBody {
    pub panels: BTreeMap<String, PanelResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<PublicVariable>,
    /// The frozen-value key of each entry of `variables`; it stays in the result file.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variable_keys: Vec<String>,
}

/// Why a served result is due again.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StaleReason {
    Interval,
    Dashboard,
    Link,
    Settings,
    Retry,
}

/// GET /api/public_dashboards/{slug}/data, 200: one range's result and its freshness.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DataResponse {
    /// Hex hash over the visible state; also the ETag.
    pub rev: String,
    pub built_at: i64,
    pub window: Window,
    /// The effective interval of this range.
    pub refresh_secs: i64,
    /// Null for an absolute range.
    pub fresh_until: Option<i64>,
    pub stale: bool,
    pub stale_reason: Option<StaleReason>,
    pub refreshing: bool,
    pub next_retry_at: Option<i64>,
    pub last_error_at: Option<i64>,
    pub dashboard_updated_at: i64,
    pub link_rev: i64,
    pub settings_rev: i64,
    pub variables: Vec<PublicVariable>,
    pub panels: BTreeMap<String, PanelResult>,
}

/// GET /data when there is no result to serve yet: 202 building or 503 cooldown.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum NotReadyResponse {
    Building {
        started_at: i64,
        estimated_secs: u64,
        progress: f64,
    },
    Cooldown {
        last_error_at: Option<i64>,
        next_retry_at: i64,
    },
}

/// GET /api/public_dashboards/{slug}: layout and offered ranges, with no ids, SQL or streams.
#[derive(Clone, Debug, Serialize)]
pub struct SanitizedDashboard {
    pub title: String,
    pub layout: serde_json::Value,
    pub ranges: Vec<KeyedRange>,
    pub default_key: String,
    /// The renderer keys time-series axes off this; anonymous viewers get no `/config`.
    pub timestamp_column: String,
    /// The default range's effective refresh interval.
    pub refresh_secs: i64,
    /// Frozen variable values, shown read-only; no variable is ever viewer-editable.
    pub variables: Vec<PublicVariable>,
    pub dashboard_updated_at: i64,
    pub link_rev: i64,
    pub settings_rev: i64,
    /// Panel id to the intent fingerprint a served panel must match.
    pub intents: BTreeMap<String, String>,
}

/// A range with the key the viewer requests its data by and its effective refresh interval.
#[derive(Clone, Debug, Serialize)]
pub struct KeyedRange {
    pub key: String,
    #[serde(flatten)]
    pub range: TimeRange,
    pub refresh_secs: i64,
}

/// A dashboard variable as the public viewer sees it: name, display label and frozen value only.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PublicVariable {
    /// The name panel titles reference as `$name`; empty in a result stored before it was added.
    #[serde(default)]
    pub name: String,
    pub label: String,
    pub value: serde_json::Value,
    /// Set for a tab-scoped variable: the tab this value belongs to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<String>,
    /// Set for a panel-scoped variable: the panel this value belongs to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panel_id: Option<String>,
}

impl PublicVariable {
    /// One entry per visible scope instance, valued from `values` by its key (`name.t.<tab>`).
    pub fn list(dash: &Dashboard, values: &BTreeMap<String, serde_json::Value>) -> Vec<Self> {
        Self::list_keyed(dash, values)
            .into_iter()
            .map(|(_, v)| v)
            .collect()
    }

    /// [`Self::list`] with each entry's frozen-value key.
    pub fn list_keyed(
        dash: &Dashboard,
        values: &BTreeMap<String, serde_json::Value>,
    ) -> Vec<(String, Self)> {
        let Some(list) = dash.v8.as_ref().and_then(|v8| v8.variables.as_ref()) else {
            return vec![];
        };
        list.list
            .iter()
            .filter(|v| v.hide_on_dashboard != Some(true) && v.type_field != "dynamic_filters")
            .flat_map(|v| {
                let label = if v.label.is_empty() {
                    v.name.clone()
                } else {
                    v.label.clone()
                };
                let instances: Vec<(String, Option<String>, Option<String>)> =
                    match v.scope.as_deref() {
                        Some("tabs") => v
                            .tabs
                            .iter()
                            .flatten()
                            .map(|t| (format!("{}.t.{t}", v.name), Some(t.clone()), None))
                            .collect(),
                        Some("panels") => v
                            .panels
                            .iter()
                            .flatten()
                            .map(|p| (format!("{}.p.{p}", v.name), None, Some(p.clone())))
                            .collect(),
                        _ => vec![(v.name.clone(), None, None)],
                    };
                instances
                    .into_iter()
                    .map(|(key, tab_id, panel_id)| {
                        let entry = Self {
                            name: v.name.clone(),
                            label: label.clone(),
                            value: values.get(&key).cloned().unwrap_or(serde_json::Value::Null),
                            tab_id,
                            panel_id,
                        };
                        (key, entry)
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }
}

/// The virtual user public dashboard searches run as; it has no users row and no permissions.
pub fn public_dashboard_identity(org_id: &str) -> String {
    format!("public-dashboard.org-{org_id}@openobserve.internal")
}

fn default_refresh_secs() -> i32 {
    DEFAULT_REFRESH_SECS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visibility_round_trips_through_i32() {
        for v in [Visibility::Draft, Visibility::Public] {
            assert_eq!(Visibility::from_i32(v.to_i32()), v);
        }
        // Unknown ints degrade to Draft (never accidentally Public).
        assert_eq!(Visibility::from_i32(9), Visibility::Draft);
    }

    #[test]
    fn not_available_panel_omits_data_and_names_no_stream() {
        let p = PanelResult::not_available(NotAvailableReason::TooLarge);
        assert_eq!(
            serde_json::to_value(&p).unwrap(),
            serde_json::json!({ "state": { "state": "not_available", "reason": "too_large" } })
        );
    }

    #[test]
    fn panel_state_flags_are_omitted_unless_set() {
        assert_eq!(
            serde_json::to_value(PanelState::ok()).unwrap(),
            serde_json::json!({ "state": "ok" })
        );
        let retained = PanelState::Ok {
            retained: true,
            error_since: Some(5),
            partial: false,
            truncated: false,
        };
        let json = serde_json::to_value(&retained).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "state": "ok", "retained": true, "error_since": 5 })
        );
        assert_eq!(
            serde_json::from_value::<PanelState>(json).unwrap(),
            retained
        );
    }

    #[test]
    fn data_response_uses_the_contract_field_names() {
        let mut panels = BTreeMap::new();
        panels.insert(
            "p1".to_string(),
            PanelResult {
                state: PanelState::ok(),
                intent: "9c1e".into(),
                built_at: Some(10),
                window: Some(Window { start: 1, end: 10 }),
                data: vec![serde_json::json!({ "hits": [] })],
                result_meta_data: vec![serde_json::json!({ "histogram_interval": 60 })],
                metadata: serde_json::json!({ "queries": [] }),
            },
        );
        let resp = DataResponse {
            rev: "a1f3".into(),
            built_at: 10,
            window: Window { start: 1, end: 10 },
            refresh_secs: 300,
            fresh_until: None,
            stale: true,
            stale_reason: Some(StaleReason::Interval),
            refreshing: true,
            next_retry_at: None,
            last_error_at: None,
            dashboard_updated_at: 7,
            link_rev: 8,
            settings_rev: 0,
            variables: vec![],
            panels,
        };
        let json = serde_json::to_value(&resp).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "built_at",
                "dashboard_updated_at",
                "fresh_until",
                "last_error_at",
                "link_rev",
                "next_retry_at",
                "panels",
                "refresh_secs",
                "refreshing",
                "rev",
                "settings_rev",
                "stale",
                "stale_reason",
                "variables",
                "window"
            ]
        );
        assert!(json["fresh_until"].is_null());
        assert_eq!(json["stale_reason"], "interval");
        assert_eq!(json["rev"], "a1f3");
        let p1 = &json["panels"]["p1"];
        assert_eq!(p1["intent"], "9c1e");
        assert_eq!(p1["window"], serde_json::json!({ "start": 1, "end": 10 }));
        assert!(p1.get("resultMetaData").is_some());
    }

    #[test]
    fn not_ready_bodies_carry_their_state() {
        let building = NotReadyResponse::Building {
            started_at: 1,
            estimated_secs: 12,
            progress: 0.4,
        };
        assert_eq!(
            serde_json::to_value(&building).unwrap(),
            serde_json::json!({ "state": "building", "started_at": 1, "estimated_secs": 12, "progress": 0.4 })
        );
        let cooldown = NotReadyResponse::Cooldown {
            last_error_at: Some(2),
            next_retry_at: 3,
        };
        assert_eq!(
            serde_json::to_value(&cooldown).unwrap(),
            serde_json::json!({ "state": "cooldown", "last_error_at": 2, "next_retry_at": 3 })
        );
    }

    fn state() -> PublicLinkState {
        PublicLinkState {
            dashboard_exists: true,
            enabled: true,
            expires_at: None,
            access_count: 3,
        }
    }

    #[test]
    fn link_status_follows_its_precedence() {
        let now = 1_000_000_000;
        assert_eq!(
            PublicLinkStatus::derive(&state(), true, now),
            PublicLinkStatus::Live
        );
        let s = PublicLinkState {
            dashboard_exists: false,
            enabled: false,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, true, now),
            PublicLinkStatus::DashboardDeleted
        );
        let s = PublicLinkState {
            expires_at: Some(now),
            enabled: false,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, true, now),
            PublicLinkStatus::Expired
        );
        let s = PublicLinkState {
            enabled: false,
            access_count: 0,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, true, now),
            PublicLinkStatus::Paused
        );
        let s = PublicLinkState {
            access_count: 0,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, true, now),
            PublicLinkStatus::NotViewed
        );
        assert_eq!(
            serde_json::to_value(PublicLinkStatus::NeedsAttention).unwrap(),
            "needs_attention"
        );
        assert_eq!(
            serde_json::to_value(PublicLinkStatus::Disabled).unwrap(),
            "disabled"
        );
        assert_eq!(
            serde_json::to_value(PublicLinkStatus::NotViewed).unwrap(),
            "not_viewed"
        );
    }

    #[test]
    fn an_org_switched_off_shows_disabled_below_deleted_and_expired_only() {
        let now = 1_000_000_000;
        let derive = |s: &PublicLinkState| PublicLinkStatus::derive(s, false, now);
        assert_eq!(derive(&state()), PublicLinkStatus::Disabled);
        let paused = PublicLinkState {
            enabled: false,
            ..state()
        };
        assert_eq!(derive(&paused), PublicLinkStatus::Disabled);
        let unviewed = PublicLinkState {
            access_count: 0,
            ..state()
        };
        assert_eq!(derive(&unviewed), PublicLinkStatus::Disabled);
        let expired = PublicLinkState {
            expires_at: Some(now),
            ..state()
        };
        assert_eq!(derive(&expired), PublicLinkStatus::Expired);
        let deleted = PublicLinkState {
            dashboard_exists: false,
            expires_at: Some(now),
            ..state()
        };
        assert_eq!(derive(&deleted), PublicLinkStatus::DashboardDeleted);
    }

    #[test]
    fn effective_refresh_is_the_largest_floor_rounded_up_to_a_minute() {
        let rel = |secs| TimeRange::Relative { secs };
        assert_eq!(rel(3600).effective_refresh_secs(300, 60), 300);
        assert_eq!(rel(86_400).effective_refresh_secs(60, 60), 300);
        assert_eq!(rel(30 * 86_400).effective_refresh_secs(300, 60), 9000);
        assert_eq!(rel(3600).effective_refresh_secs(60, 120), 120);
        assert_eq!(rel(3600).effective_refresh_secs(61, 60), 120);
        assert_eq!(rel(90_000).effective_refresh_secs(60, 60), 360);
        assert_eq!(rel(1441 * 60).effective_refresh_secs(300, 60), 360);
        assert_eq!(rel(1440 * 60).effective_refresh_secs(300, 60), 300);
        let abs = TimeRange::Absolute {
            start: 0,
            end: 7 * 86_400 * 1_000_000,
        };
        assert_eq!(abs.effective_refresh_secs(300, 60), 2100);
    }

    #[test]
    fn config_defaults_to_a_five_minute_refresh() {
        let cfg: PublicDashboardConfig = serde_json::from_value(serde_json::json!({
            "time_range": { "ranges": [{ "type": "relative", "secs": 3600 }],
                            "default": { "type": "relative", "secs": 3600 } }
        }))
        .unwrap();
        assert_eq!(cfg.refresh_secs, 300);
    }

    #[test]
    fn public_variables_carry_the_name_panel_titles_reference() {
        let dash = Dashboard {
            v8: Some(
                serde_json::from_value(serde_json::json!({
                    "variables": { "list": [
                        { "type": "custom", "name": "level", "label": "Level" },
                        { "type": "custom", "name": "svc", "scope": "tabs", "tabs": ["t1"] }
                    ] }
                }))
                .unwrap(),
            ),
            ..Default::default()
        };
        let values = BTreeMap::from([("level".to_string(), serde_json::json!("error"))]);
        let list = PublicVariable::list(&dash, &values);
        let names: Vec<(&str, &str)> = list
            .iter()
            .map(|v| (v.name.as_str(), v.label.as_str()))
            .collect();
        assert_eq!(names, [("level", "Level"), ("svc", "svc")]);
        assert_eq!(serde_json::to_value(&list[0]).unwrap()["name"], "level");
        let stored: PublicVariable =
            serde_json::from_value(serde_json::json!({ "label": "Level", "value": "error" }))
                .unwrap();
        assert_eq!(stored.name, "");
    }

    #[test]
    fn identity_names_the_org() {
        assert_eq!(
            public_dashboard_identity("acme"),
            "public-dashboard.org-acme@openobserve.internal"
        );
    }

    #[test]
    fn ranges_key_and_window_by_type() {
        let rel = TimeRange::Relative { secs: 3600 };
        let abs = TimeRange::Absolute {
            start: 1_000_000,
            end: 61_000_000,
        };
        assert_eq!(rel.key(), "r3600");
        assert_eq!(abs.key(), "a1000000-61000000");
        assert_eq!(rel.window(5_000_000_000), (1_400_000_000, 5_000_000_000));
        assert_eq!(abs.window(5_000_000_000), (1_000_000, 61_000_000));
        assert_eq!(abs.length_secs(), 60);
        let json = serde_json::to_string(&abs).unwrap();
        assert_eq!(
            json,
            r#"{"type":"absolute","start":1000000,"end":61000000}"#
        );
        assert_eq!(serde_json::from_str::<TimeRange>(&json).unwrap(), abs);
    }

    #[test]
    fn range_status_uses_the_status_contract() {
        let mut sources = BTreeMap::new();
        sources.insert(
            "p1".to_string(),
            vec![(StreamType::Logs, "default".to_string())],
        );
        let status = RangeStatus {
            key: "r3600".into(),
            state: RangeState::NeedsAttention,
            built_at: Some(5),
            withheld_panels: vec![WithheldPanel {
                panel_id: "p2".into(),
                reason: NotAvailableReason::Unauthorized,
            }],
            unavailable_count: 1,
            incomplete_count: 0,
            last_error: None,
            next_retry_at: None,
            sources: Some(sources),
        };
        assert_eq!(
            serde_json::to_value(&status).unwrap(),
            serde_json::json!({
                "key": "r3600", "state": "needs_attention", "built_at": 5,
                "withheld_panels": [{ "panel_id": "p2", "reason": "unauthorized" }],
                "unavailable_count": 1, "incomplete_count": 0, "last_error": null,
                "next_retry_at": null, "sources": { "p1": [["logs", "default"]] }
            })
        );
        let batch = RangeStatus {
            sources: None,
            state: RangeState::NotCached,
            ..status
        };
        let json = serde_json::to_value(&batch).unwrap();
        assert!(json.get("sources").is_none());
        assert_eq!(json["state"], "not_cached");
    }
}
