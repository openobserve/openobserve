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

//! The `slo_slices` reserved stream (`alerts_2.md` §6b.8, D32).
//!
//! Slices are a **stream**, not a meta-store table, for the reason the volume
//! makes obvious: 90 days × 5-minute slices × groups × SLOs is timeseries
//! data, and the meta store is SQLite in local deployments. `triggers` is the
//! precedent — reserved name, schema by reflection over the Rust struct,
//! written by the job that produces it.
//!
//! Every row carries `definition_generation`. Readers filter on it, which is
//! what makes a generation bump a clean break rather than a migration: the old
//! epoch's slices simply stop being visible and age out with retention.

use serde::{Deserialize, Serialize};

/// The reserved stream name. Registered in
/// [`crate::meta::self_reporting::usage::RESERVED_INTERNAL_STREAMS`], which is
/// what stops a user creating, ingesting into, or deleting it.
pub const SLO_SLICES_STREAM: &str = "slo_slices";

/// One measured slice.
///
/// `good`/`total` are stored raw rather than as a ratio: the running aggregate
/// sums them, and summing pre-divided ratios would weight a slice with 3
/// events the same as one with 30,000.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SloSliceRow {
    /// Ingest timestamp — when the slice was *written*, not what it measures.
    /// `slice_start` is the measurement time, and the two differ by the
    /// evaluation delay and by however late the data arrived.
    pub _timestamp: i64,
    pub org: String,
    pub slo_id: String,
    /// The epoch this measurement belongs to. Readers filter on it (D59).
    pub definition_generation: i32,
    /// `""` is the ungrouped / rollup series (S-9).
    pub group_key: String,
    /// Display labels for the group, denormalized so a reader does not need
    /// the definition to render a chart.
    pub group_labels: String,
    /// Aligned to the slice grid. THE measurement time.
    pub slice_start: i64,
    pub good: f64,
    pub total: f64,
    /// Monotonic per `(slo_id, generation, group_key, slice_start)`. Late data
    /// and recomputes produce a higher revision, and readers keep the highest
    /// (D54).
    ///
    /// This is for **dedupe**, not publication ordering — there is no
    /// publication protocol to order (D64).
    pub rev: i64,
}

impl SloSliceRow {
    /// A fully-populated sample used to infer the Arrow schema, so every field
    /// exists from the first write rather than appearing as data happens to
    /// contain it. Mirrors `TriggerData::init_for_reflection`.
    ///
    /// Every field must be non-null and of its real type here: a field left
    /// empty would be inferred as `Utf8` and then conflict with the first real
    /// numeric write.
    pub fn init_for_reflection() -> Self {
        Self {
            _timestamp: 1,
            org: "org".to_string(),
            slo_id: "slo".to_string(),
            definition_generation: 1,
            group_key: "group".to_string(),
            group_labels: "label".to_string(),
            slice_start: 1,
            good: 1.0,
            total: 1.0,
            rev: 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_reflection_sample_populates_every_field() {
        // A field left at its default would be inferred with the wrong Arrow
        // type and then conflict with the first real write.
        let v = serde_json::to_value(SloSliceRow::init_for_reflection()).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.len(), 10, "a field was added without a sample value");
        for (k, val) in obj {
            assert!(!val.is_null(), "{k} is null in the reflection sample");
            if let Some(s) = val.as_str() {
                assert!(!s.is_empty(), "{k} is empty in the reflection sample");
            }
        }
    }

    /// `good` and `total` must infer as floats. If the sample used whole
    /// numbers they could infer as integers, and the first fractional write
    /// would then conflict with the stored schema.
    #[test]
    fn the_numeric_fields_are_floats_in_the_sample() {
        let v = serde_json::to_value(SloSliceRow::init_for_reflection()).unwrap();
        assert!(v["good"].is_f64(), "good must infer as a float");
        assert!(v["total"].is_f64(), "total must infer as a float");
    }

    #[test]
    fn a_slice_row_round_trips() {
        let row = SloSliceRow {
            _timestamp: 1_700_000_000_000_000,
            org: "acme".into(),
            slo_id: "slo1".into(),
            definition_generation: 3,
            group_key: "region=eu".into(),
            group_labels: "region: eu".into(),
            slice_start: 1_700_000_000,
            good: 98.0,
            total: 100.0,
            rev: 2,
        };
        let json = serde_json::to_string(&row).unwrap();
        assert_eq!(serde_json::from_str::<SloSliceRow>(&json).unwrap(), row);
    }

    /// The stored field names are a wire contract with the reader SQL. A
    /// rename here silently breaks every query in §6b.4.
    #[test]
    fn the_field_names_are_pinned() {
        let v = serde_json::to_value(SloSliceRow::init_for_reflection()).unwrap();
        for field in [
            "_timestamp",
            "org",
            "slo_id",
            "definition_generation",
            "group_key",
            "group_labels",
            "slice_start",
            "good",
            "total",
            "rev",
        ] {
            assert!(v.get(field).is_some(), "field `{field}` was renamed");
        }
    }
}
