// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::LazyLock as Lazy;

use anyhow::Result;
use arrow_schema::Schema;
use config::{
    meta::{
        self_reporting::usage::{self},
        stream::StreamType,
    },
    utils::schema::schema_eq,
};
use dashmap::DashSet;
use infra;

/// Non-`Option` `TriggerData` fields, which every row of the stream carries.
pub const REQUIRED_COLUMNS: [&str; 11] = [
    "_timestamp",
    "org",
    "module",
    "key",
    "next_run_at",
    "is_realtime",
    "is_silenced",
    "status",
    "start_time",
    "end_time",
    "retries",
];

/// `Option` `TriggerData` fields, which a stream lacks until a row set one, as ingest drops nulls.
pub const OPTIONAL_COLUMNS: [&str; 38] = [
    "skipped_alerts_count",
    "error",
    "success_response",
    "is_partial",
    "delay_in_secs",
    "evaluation_took_in_secs",
    "source_node",
    "query_took",
    "scheduler_trace_id",
    "time_in_queue_ms",
    "grouped",
    "group_size",
    "actual_value",
    "rule_value",
    "threshold_value",
    "threshold_operator",
    "level",
    "severity",
    "siem",
    "historical",
    "siem_groups",
    "group_label",
    "value_is_lower_bound",
    "synthetics_error_source",
    "synthetics_location",
    "downtime_id",
    "acked_by",
    "ack_action",
    "ack_source",
    "taken_over_from",
    "delivery_attempted",
    "repeat_suppressed",
    "trigger_source",
    "triggered_by",
    "recipient_count",
    "attachment_type",
    "dashboard_count",
    "scheduled_for",
];

/// The run columns every scheduled-run history list shows.
pub const HISTORY_COLUMNS: [&str; 9] = [
    "_timestamp",
    "org",
    "key",
    "status",
    "is_realtime",
    "is_silenced",
    "start_time",
    "end_time",
    "retries",
];

/// Tracks which organizations have had their triggers stream schema initialized.
/// Uses a lock-free DashSet for better concurrency and bounded memory usage.
static INITIALIZED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

/// Ensures the triggers stream schema is initialized for a given organization.
/// This function uses a per-org Once pattern to ensure initialization happens only once
/// per organization per restart.
///
/// This should be called lazily when the first trigger is about to be ingested for an org.
///
/// # Arguments
/// * `org_id` - The organization ID to initialize the triggers stream for
///
/// # Behavior
/// - Uses lock-free per-org tracking to ensure initialization happens only once per restart
/// - Auto-generates field list from TriggerData struct via reflection
/// - Creates schema directly without ingesting sample data
/// - Does NOT manipulate defined_schema_fields (no UDS filtering for system streams)
/// - Never blocks ingestion even if initialization fails
pub async fn ensure_triggers_stream_initialized(org_id: &str) -> Result<()> {
    // Check if already initialized (lock-free read)
    if INITIALIZED_ORGS.contains(org_id) {
        return Ok(());
    }

    // Attempt initialization
    match initialize_triggers_stream_schema(org_id).await {
        Ok(_) => {
            // Mark as initialized (lock-free insert)
            INITIALIZED_ORGS.insert(org_id.to_string());
            Ok(())
        }
        Err(e) => {
            log::warn!(
                "[SELF-REPORTING] Failed to initialize triggers stream schema for org {org_id}: {e}. Continuing anyway."
            );
            // Mark as initialized even on failure to prevent retry storms.
            // Schema will be created naturally on first actual trigger ingestion through
            // OpenObserve's auto-schema evolution.
            INITIALIZED_ORGS.insert(org_id.to_string());
            Ok(())
        }
    }
}

/// Forget that the org's triggers stream was set up, so a reused org id is set up again.
pub(crate) fn forget_org(org_id: &str) {
    INITIALIZED_ORGS.remove(org_id);
}

/// Forget the org's setup mark when its triggers stream is deleted, so the next write sets it up.
pub fn forget_deleted_stream(org_id: &str, stream_type: StreamType, stream_name: &str) {
    if stream_type == StreamType::Logs && stream_name == usage::TRIGGERS_STREAM {
        forget_org(org_id);
    }
}

/// The org's triggers stream schema, empty when the stream does not exist.
pub async fn get(org_id: &str) -> infra::errors::Result<Schema> {
    infra::schema::get(org_id, usage::TRIGGERS_STREAM, StreamType::Logs).await
}

/// Each of `columns` the stream can serve, leaving out an [OPTIONAL_COLUMNS] field it lacks.
pub fn present_columns<'a>(columns: impl IntoIterator<Item = &'a str>, schema: &Schema) -> String {
    columns
        .into_iter()
        .filter(|column| is_present(column, schema))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `column`, or `_timestamp` when it is an [OPTIONAL_COLUMNS] field the stream lacks.
pub fn sortable_column<'a>(column: &'a str, schema: &Schema) -> &'a str {
    if is_present(column, schema) {
        column
    } else {
        "_timestamp"
    }
}

fn is_present(column: &str, schema: &Schema) -> bool {
    !OPTIONAL_COLUMNS.contains(&column) || schema.field_with_name(column).is_ok()
}

/// Internal function that performs the actual schema initialization.
/// This should only be called by ensure_triggers_stream_initialized.
///
/// Creates the triggers stream schema directly when the stream doesn't exist.
/// Uses reflection to get all TriggerData fields and creates an Arrow schema,
/// ensuring all fields are present from the start to prevent schema divergence.
async fn initialize_triggers_stream_schema(org_id: &str) -> Result<()> {
    let stream_name = usage::TRIGGERS_STREAM;
    let stream_type = StreamType::Logs;

    // Stream doesn't exist or has no fields - create schema using reflection
    log::info!(
        "[SELF-REPORTING] Creating triggers stream schema for {org_id}/{stream_name} via reflection"
    );

    // Create a sample TriggerData with all fields populated (for schema inference)
    let sample_trigger = config::meta::self_reporting::usage::TriggerData::init_for_reflection();

    // Convert to JSON value to infer Arrow schema
    let json_value = config::utils::json::to_value(&sample_trigger)?;
    let json_map = json_value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("Failed to convert TriggerData to JSON object"))?;

    // Infer Arrow schema from the JSON (uses OpenObserve's schema inference)
    // Pass as iterator of a single map
    let expected_schema = config::utils::schema::infer_json_schema_from_map(
        stream_name,
        stream_type,
        std::iter::once(json_map),
    )?;

    if infra::schema::get(org_id, stream_name, stream_type)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected_schema))
    {
        // Stream already exists with all fields
        log::debug!(
            "[SELF-REPORTING] Triggers stream {org_id}/{stream_name} already exists with expected schema"
        );
        return Ok(());
    }
    // Create the schema using merge (which creates if doesn't exist)
    match crate::db::schema::merge(
        org_id,
        stream_name,
        stream_type,
        &expected_schema,
        Some(config::utils::time::now_micros()),
    )
    .await
    {
        Ok(_) => {
            log::info!(
                "[SELF-REPORTING] Successfully created triggers stream schema for {org_id}/{stream_name} with {} fields",
                expected_schema.fields().len()
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[SELF-REPORTING] Failed to create triggers stream schema for {org_id}/{stream_name}: {e}"
            );
            Err(anyhow::anyhow!("Schema creation failed: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trigger_data_field_names() {
        let field_names = config::meta::self_reporting::usage::TriggerData::get_field_names();

        // Verify all expected fields are present
        assert!(field_names.contains(&"_timestamp".to_string()));
        assert!(field_names.contains(&"org".to_string()));
        assert!(field_names.contains(&"module".to_string()));
        assert!(field_names.contains(&"key".to_string()));
        assert!(field_names.contains(&"error".to_string()));
        assert!(field_names.contains(&"status".to_string()));
        assert!(field_names.contains(&"next_run_at".to_string()));

        // Value context (T-9, alerts_2.md §7.5) — these must be in the
        // reflection sample or orgs created after the change get a triggers
        // stream schema without them.
        assert!(field_names.contains(&"actual_value".to_string()));
        assert!(field_names.contains(&"rule_value".to_string()));
        assert!(field_names.contains(&"threshold_value".to_string()));
        assert!(field_names.contains(&"threshold_operator".to_string()));
        assert!(field_names.contains(&"level".to_string()));
        assert!(field_names.contains(&"group_label".to_string()));
        assert!(field_names.contains(&"value_is_lower_bound".to_string()));

        // A synthetics slot the step gate skips is dead-lettered as a trigger row, and the alert
        // rule filters on these two — absent from the reflection sample, the stream schema never
        // learns the columns and the filter matches nothing.
        assert!(field_names.contains(&"synthetics_error_source".to_string()));
        assert!(field_names.contains(&"synthetics_location".to_string()));
        assert!(field_names.contains(&"delivery_attempted".to_string()));
        for f in [
            "trigger_source",
            "triggered_by",
            "recipient_count",
            "attachment_type",
            "dashboard_count",
            "scheduled_for",
        ] {
            assert!(field_names.contains(&f.to_string()), "missing {f}");
        }

        // The history filter and the Suppressed tab of a downtime read this column.
        assert!(field_names.contains(&"downtime_id".to_string()));

        // Alert history shows who acked a run and the ack events themselves from these columns.
        for f in ["acked_by", "ack_action", "ack_source", "taken_over_from"] {
            assert!(field_names.contains(&f.to_string()), "missing {f}");
        }

        // Verify count matches struct fields
        // 44: 21 original + 2 grouping + 6 value + 2 synthetics + downtime + delivery + rule_value
        // + 6 report + 4 ack
        // `severity` stays out of the sample; history reads it only once a row carried it.
        let siem_columns = ["siem", "historical", "siem_groups"];
        let enterprise_only = if cfg!(feature = "enterprise") {
            siem_columns.len()
        } else {
            0
        };
        assert_eq!(field_names.len(), 44 + enterprise_only);
        for f in siem_columns {
            assert_eq!(
                field_names.contains(&f.to_string()),
                cfg!(feature = "enterprise"),
                "{f} is in the reflection sample exactly when enterprise is on"
            );
        }

        // Verify no duplicate fields
        let unique_count = field_names
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len();
        assert_eq!(unique_count, field_names.len());
    }

    #[tokio::test]
    async fn test_ensure_triggers_stream_initialized_marks_as_done() {
        let test_org = "test_org_unique_456";

        // First call should attempt initialization
        let result = ensure_triggers_stream_initialized(test_org).await;
        assert!(result.is_ok());

        // Verify it's marked as initialized
        assert!(INITIALIZED_ORGS.contains(test_org));
    }

    #[test]
    fn present_columns_leaves_out_only_the_optional_columns_the_stream_lacks() {
        use arrow_schema::{DataType, Field};

        let schema = Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("error", DataType::Utf8, true),
        ]);
        assert_eq!(
            present_columns(["_timestamp", "key", "error", "source_node"], &schema),
            "_timestamp, key, error"
        );
        assert_eq!(present_columns(["_timestamp"], &schema), "_timestamp");
    }

    #[test]
    fn sortable_column_falls_back_only_for_a_missing_optional_column() {
        use arrow_schema::{DataType, Field};

        let schema = Schema::new(vec![Field::new("query_took", DataType::Int64, true)]);
        assert_eq!(sortable_column("source_node", &schema), "_timestamp");
        assert_eq!(sortable_column("query_took", &schema), "query_took");
        assert_eq!(sortable_column("retries", &schema), "retries");
        assert_eq!(
            sortable_column("(end_time - start_time)", &schema),
            "(end_time - start_time)"
        );
    }

    #[test]
    fn the_column_lists_match_the_trigger_data_fields() {
        use config::meta::self_reporting::usage::TriggerData;
        use serde_json::{Map, Value, json};

        let defaults = config::utils::json::to_value(TriggerData::default()).unwrap();
        let required: Map<String, Value> = REQUIRED_COLUMNS
            .iter()
            .map(|column| (column.to_string(), defaults[*column].clone()))
            .collect();
        assert!(
            serde_json::from_value::<TriggerData>(Value::Object(required.clone())).is_ok(),
            "a TriggerData field outside REQUIRED_COLUMNS is not an Option"
        );
        for column in REQUIRED_COLUMNS {
            let mut row = required.clone();
            row.remove(column);
            assert!(
                serde_json::from_value::<TriggerData>(Value::Object(row)).is_err(),
                "{column} is an Option field, not a required one"
            );
        }

        let reflection = config::utils::json::to_value(TriggerData::init_for_reflection()).unwrap();
        for sample in [&defaults, &reflection] {
            for column in sample.as_object().unwrap().keys() {
                assert!(
                    REQUIRED_COLUMNS.contains(&column.as_str())
                        || OPTIONAL_COLUMNS.contains(&column.as_str()),
                    "{column} is in neither REQUIRED_COLUMNS nor OPTIONAL_COLUMNS"
                );
            }
        }

        let enterprise_only = ["severity", "siem", "historical", "siem_groups"];
        for column in OPTIONAL_COLUMNS {
            if enterprise_only.contains(&column) && !cfg!(feature = "enterprise") {
                continue;
            }
            let mut row = required.clone();
            row.insert(column.to_string(), json!({}));
            assert!(
                serde_json::from_value::<TriggerData>(Value::Object(row)).is_err(),
                "{column} is not a TriggerData field"
            );
        }

        for column in HISTORY_COLUMNS {
            assert!(REQUIRED_COLUMNS.contains(&column), "{column} may be absent");
        }
    }

    #[test]
    fn deleting_the_triggers_stream_forgets_only_that_orgs_mark() {
        let (gone, kept) = ("deleted_triggers_org", "kept_triggers_org");
        INITIALIZED_ORGS.insert(gone.to_string());
        INITIALIZED_ORGS.insert(kept.to_string());
        forget_deleted_stream(kept, StreamType::Metrics, usage::TRIGGERS_STREAM);
        forget_deleted_stream(kept, StreamType::Logs, usage::USAGE_STREAM);
        forget_deleted_stream(gone, StreamType::Logs, usage::TRIGGERS_STREAM);
        assert!(!INITIALIZED_ORGS.contains(gone));
        assert!(INITIALIZED_ORGS.contains(kept));
        forget_org(kept);
    }

    #[test]
    fn test_forget_org_drops_the_setup_mark() {
        INITIALIZED_ORGS.insert("forget_org_triggers".to_string());
        forget_org("forget_org_triggers");
        assert!(!INITIALIZED_ORGS.contains("forget_org_triggers"));
    }
}
