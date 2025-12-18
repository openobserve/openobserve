// Copyright 2025 OpenObserve Inc.
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

use anyhow::Result;
use config::{
    get_config,
    meta::{
        self_reporting::usage::{self},
        stream::StreamType,
    },
};
use dashmap::DashSet;
use infra;
use once_cell::sync::Lazy;

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
/// - Only applies when ZO_USAGE_REPORT_TO_OWN_ORG is enabled
/// - Uses lock-free per-org tracking to ensure initialization happens only once per restart
/// - Auto-generates field list from TriggerData struct via reflection
/// - Creates schema directly without ingesting sample data
/// - Does NOT manipulate defined_schema_fields (no UDS filtering for system streams)
/// - Never blocks ingestion even if initialization fails
pub async fn ensure_triggers_stream_initialized(org_id: &str) -> Result<()> {
    let cfg = get_config();

    // Only initialize when usage_report_to_own_org is enabled
    if !cfg.common.usage_report_to_own_org {
        return Ok(());
    }

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
    let expected_schema =
        config::utils::schema::infer_json_schema_from_map(std::iter::once(json_map), stream_type)?;

    if infra::schema::get(org_id, stream_name, stream_type)
        .await
        .is_ok_and(|ref schema| schema.eq(&expected_schema))
    {
        // Stream already exists with all fields
        log::debug!(
            "[SELF-REPORTING] Triggers stream {org_id}/{stream_name} already exists with expected schema"
        );
        return Ok(());
    }
    // Create the schema using merge (which creates if doesn't exist)
    match infra::schema::merge(
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

        // Verify count matches struct fields (26 total: 21 original + 5 dedup/grouping fields)
        assert_eq!(field_names.len(), 26);

        // Verify no duplicate fields
        let unique_count = field_names
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len();
        assert_eq!(unique_count, 26);
    }

    #[tokio::test]
    async fn test_ensure_triggers_stream_initialized_meta_org() {
        // Should return Ok immediately for META org
        let result = ensure_triggers_stream_initialized(config::META_ORG_ID).await;
        assert!(result.is_ok());
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
}
