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

//! Profiles stream columns shared by the ingest, schema and query paths.

use crate::TIMESTAMP_COL_NAME;

/// Profiled time of one OTLP Profile, on one row per (profile, instance) so sums count it once.
pub const PROFILE_DURATION_COLUMN: &str = "profile_duration_nanos";
/// Columns that identify one profiled process; profiled time is tracked per this identity.
pub const INSTANCE_KEY_COLUMNS: &[&str] = &[
    "service_name",
    "service_instance_id",
    "host_name",
    "process_pid",
];
/// Top-bar dimensions from `/profiles/meta`; not Tags Filter keys.
pub const META_DIMENSION_COLUMNS: &[&str] = &["otel_scope_name", "service_name", "profile_type"];

/// Internal / measurement columns that must not become Tags Filter keys.
pub const EXCLUDED_TAG_DISCOVERY_KEYS: &[&str] = &[
    "_timestamp",
    "stack",
    "value",
    "tags",
    "sample_tags",
    "event_id",
    "extractor_version",
    "frame_count",
    "duration_nanos",
    PROFILE_DURATION_COLUMN,
    "period",
    "period_nanos",
    "period_type",
    "period_unit",
    "profile_id",
    "profile_unit",
    "otel_scope_version",
    // Payload / summary columns (not business tags).
    "bytes",
    "profile_blob",
    "profile_encoding",
    "has_original_payload",
    "has_trace_link",
    "original_payload_format",
    "original_payload_size",
    "sample_count",
    "sample_value_count",
    "sample_value_sum",
    "linked_sample_count",
];
/// Columns that link a sample to the span it was taken in.
const TRACE_LINK_COLUMNS: &[&str] = &["trace_id", "span_id"];

/// Columns the profiles query endpoints read, so a user-defined schema must never drop them.
pub fn uds_required_columns() -> impl Iterator<Item = &'static str> {
    EXCLUDED_TAG_DISCOVERY_KEYS
        .iter()
        .chain(META_DIMENSION_COLUMNS)
        .chain(INSTANCE_KEY_COLUMNS)
        .chain(TRACE_LINK_COLUMNS)
        .copied()
        .filter(|name| *name != TIMESTAMP_COL_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uds_required_columns_cover_query_columns_but_not_timestamp() {
        let columns: Vec<&str> = uds_required_columns().collect();
        for name in [
            "stack",
            "value",
            "profile_type",
            "profile_unit",
            "service_name",
            "otel_scope_name",
            "host_name",
            "process_pid",
            "trace_id",
            "span_id",
            PROFILE_DURATION_COLUMN,
        ] {
            assert!(columns.contains(&name), "missing {name}");
        }
        assert!(!columns.contains(&TIMESTAMP_COL_NAME));
    }
}
