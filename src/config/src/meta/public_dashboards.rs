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

/// Draft configures the share without exposing it; Public serves it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    #[default]
    Draft,
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

/// The viewer's time-range contract: locked to a default, or a bounded set of
/// pre-materialized relative presets (seconds).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TimeRangePolicy {
    #[serde(default)]
    pub editable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_range_secs: Option<i64>,
    #[serde(default)]
    pub allowed_presets_secs: Vec<i64>,
}

/// Admin request body to create/update a public link. Variables are frozen at
/// the values the author selected when generating the link.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicDashboardConfig {
    #[serde(default)]
    pub visibility: Visibility,
    pub time_range: TimeRangePolicy,
    #[serde(default)]
    pub frozen_variables: BTreeMap<String, serde_json::Value>,
    pub rebuild_secs: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
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

/// Stored per `(public_dashboard, preset)`; serialized into the snapshot row's
/// `data` column and point-read by the anonymous plane. Keyed by panel id so the
/// viewer can look up each panel's slice directly.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SnapshotData {
    pub panels: BTreeMap<String, PanelSnapshot>,
    pub built_at: i64,
}

/// The sanitized config the anonymous plane returns — layout + viz specs and
/// available presets only. No ids, no SQL, no stream internals, no variables.
#[derive(Clone, Debug, Serialize)]
pub struct SanitizedDashboard {
    pub title: String,
    pub layout: serde_json::Value,
    pub time_range: TimeRangePolicy,
    pub available_presets: Vec<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built_at: Option<i64>,
    /// The renderer keys time-series axes off this; anonymous viewers get no `/config`.
    pub timestamp_column: String,
    /// Viewer re-read interval — the author's "Refresh every" rebuild cadence.
    pub refresh_secs: i64,
    /// Frozen variable values, shown read-only; no variable is ever viewer-editable.
    pub variables: Vec<PublicVariable>,
}

/// A dashboard variable as the public viewer sees it: display label and frozen value only.
#[derive(Clone, Debug, Serialize)]
pub struct PublicVariable {
    pub label: String,
    pub value: serde_json::Value,
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
        })
        .unwrap();
        assert!(s.contains("resultMetaData"), "{s}");
        assert!(s.contains("\"panel-1\""), "{s}");
    }
}
