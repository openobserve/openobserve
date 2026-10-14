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

//! DTOs for public dashboards. `PublicDashboardConfig` is the admin request
//! body; `SanitizedDashboard` is the projection the anonymous plane serves
//! (no ids/SQL/stream internals); `SnapshotData` is what the rebuilder stores
//! and the viewer point-reads.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::meta::dashboards::Dashboard;

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

/// One window a link offers: rolling and rebuilt every refresh, or fixed and built once.
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
    /// The id its snapshot is stored under and the viewer asks for.
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
}

/// The ranges a link offers; with more than one, viewers can switch between them.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimeRangePolicy {
    pub ranges: Vec<TimeRange>,
    pub default: TimeRange,
}

impl TimeRangePolicy {
    pub fn has_relative(&self) -> bool {
        self.ranges.iter().any(TimeRange::is_relative)
    }
}

/// Admin request body to create/update a public link. Variables are frozen at
/// the values the author selected when generating the link.
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
    pub rebuild_secs: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// A link's state as the admin UI shows it, derived from the stored row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicLinkStatus {
    Live,
    Paused,
    Preparing,
    NeedsAttention,
    Expired,
    DashboardDeleted,
}

impl PublicLinkStatus {
    /// Precedence: deleted dashboard, expired, paused, never built, failed or stale, live.
    pub fn derive(link: &PublicLinkState, now: i64) -> Self {
        if !link.dashboard_exists {
            return Self::DashboardDeleted;
        }
        if link.expires_at.is_some_and(|exp| exp <= now) {
            return Self::Expired;
        }
        if !link.enabled {
            return Self::Paused;
        }
        let Some(built) = link.last_rebuilt_at else {
            return Self::Preparing;
        };
        // Three missed rebuilds means the viewer is looking at data the author didn't promise.
        let stale_after = 3 * i64::from(link.rebuild_secs.max(1)) * 1_000_000;
        let stale = link.has_relative && now - built > stale_after;
        if link.rebuild_failed || stale {
            return Self::NeedsAttention;
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
    pub last_rebuilt_at: Option<i64>,
    pub rebuild_failed: bool,
    pub rebuild_secs: i32,
    /// Absolute ranges are built once, so only a relative range can go stale.
    pub has_relative: bool,
}

/// Whether a panel rendered, or was withheld (unreadable stream / unsupported).
/// `reason` is deliberately generic — it never names a stream on the public plane.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PanelState {
    Ok,
    NotAvailable { reason: String },
}

/// One panel's materialized output, shaped for the client renderer: `data` and
/// `result_meta_data` are per-query (index-aligned to the panel's queries), and
/// `metadata.queries[i]` carries that query's time window. The viewer feeds these
/// straight into the same `convertPanelData` the live dashboard uses — no query
/// runs on the anonymous plane. Serialized camelCase to match the frontend.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PanelSnapshot {
    pub state: PanelState,
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

/// Stored per `(public_dashboard, range key)`; serialized into the snapshot row's
/// `data` column and point-read by the anonymous plane. Keyed by panel id so the
/// viewer can look up each panel's slice directly.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SnapshotData {
    pub panels: BTreeMap<String, PanelSnapshot>,
    pub built_at: i64,
    /// The values this snapshot was built with, defaults included, as the viewer shows them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<PublicVariable>,
}

/// The sanitized config the anonymous plane returns — layout + viz specs and
/// the offered ranges only. No ids, no SQL, no stream internals.
#[derive(Clone, Debug, Serialize)]
pub struct SanitizedDashboard {
    pub title: String,
    pub layout: serde_json::Value,
    pub ranges: Vec<KeyedRange>,
    pub default_key: String,
    /// Keys of the ranges that have a snapshot to show.
    pub available_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built_at: Option<i64>,
    /// The renderer keys time-series axes off this; anonymous viewers get no `/config`.
    pub timestamp_column: String,
    /// Viewer re-read interval — the author's "Refresh every" rebuild cadence.
    pub refresh_secs: i64,
    /// Frozen variable values, shown read-only; no variable is ever viewer-editable.
    pub variables: Vec<PublicVariable>,
}

/// A range with the key the viewer requests its snapshot by.
#[derive(Clone, Debug, Serialize)]
pub struct KeyedRange {
    pub key: String,
    #[serde(flatten)]
    pub range: TimeRange,
}

/// A dashboard variable as the public viewer sees it: display label and frozen value only.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PublicVariable {
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
                    .map(|(key, tab_id, panel_id)| Self {
                        label: label.clone(),
                        value: values.get(&key).cloned().unwrap_or(serde_json::Value::Null),
                        tab_id,
                        panel_id,
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }
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
        let p = PanelSnapshot {
            state: PanelState::NotAvailable {
                reason: "unauthorized".to_string(),
            },
            data: vec![],
            result_meta_data: vec![],
            metadata: serde_json::Value::Null,
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(!s.contains("\"data\""), "{s}");
        assert!(!s.contains("\"metadata\""), "{s}");
        assert!(s.contains("not_available"), "{s}");
    }

    #[test]
    fn snapshot_serializes_result_meta_data_camelcase() {
        let mut panels = BTreeMap::new();
        panels.insert(
            "panel-1".to_string(),
            PanelSnapshot {
                state: PanelState::Ok,
                data: vec![serde_json::json!({ "hits": [] })],
                result_meta_data: vec![serde_json::json!({ "histogram_interval": 60 })],
                metadata: serde_json::json!({ "queries": [] }),
            },
        );
        let s = serde_json::to_string(&SnapshotData {
            panels,
            built_at: 1,
            variables: vec![],
        })
        .unwrap();
        assert!(s.contains("resultMetaData"), "{s}");
        assert!(s.contains("\"panel-1\""), "{s}");
        assert!(!s.contains("variables"), "{s}");
    }

    fn state() -> PublicLinkState {
        PublicLinkState {
            dashboard_exists: true,
            enabled: true,
            expires_at: None,
            last_rebuilt_at: Some(1_000_000_000),
            rebuild_failed: false,
            rebuild_secs: 60,
            has_relative: true,
        }
    }

    #[test]
    fn link_status_follows_its_precedence() {
        let now = 1_000_000_000 + 30_000_000;
        assert_eq!(
            PublicLinkStatus::derive(&state(), now),
            PublicLinkStatus::Live
        );
        let s = PublicLinkState {
            dashboard_exists: false,
            enabled: false,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, now),
            PublicLinkStatus::DashboardDeleted
        );
        let s = PublicLinkState {
            expires_at: Some(now),
            enabled: false,
            ..state()
        };
        assert_eq!(PublicLinkStatus::derive(&s, now), PublicLinkStatus::Expired);
        let s = PublicLinkState {
            enabled: false,
            ..state()
        };
        assert_eq!(PublicLinkStatus::derive(&s, now), PublicLinkStatus::Paused);
        let s = PublicLinkState {
            last_rebuilt_at: None,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, now),
            PublicLinkStatus::Preparing
        );
        let s = PublicLinkState {
            rebuild_failed: true,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&s, now),
            PublicLinkStatus::NeedsAttention
        );
    }

    #[test]
    fn link_goes_stale_after_three_missed_rebuilds() {
        let built = 1_000_000_000;
        assert_eq!(
            PublicLinkStatus::derive(&state(), built + 180_000_000),
            PublicLinkStatus::Live
        );
        assert_eq!(
            PublicLinkStatus::derive(&state(), built + 180_000_001),
            PublicLinkStatus::NeedsAttention
        );
        let absolute_only = PublicLinkState {
            has_relative: false,
            ..state()
        };
        assert_eq!(
            PublicLinkStatus::derive(&absolute_only, built + 86_400_000_000),
            PublicLinkStatus::Live
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
}
