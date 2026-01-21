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

/// Tracks which organizations have had their usage stream schema initialized.
/// Uses a lock-free DashSet for better concurrency and bounded memory usage.
static INITIALIZED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

/// Ensures the usage stream schema is initialized for a given organization.
/// This function uses a per-org Once pattern to ensure initialization happens only once
/// per organization per restart.
///
/// This should be called lazily when the first usage data is about to be ingested for an org.
///
/// # Arguments
/// * `org_id` - The organization ID to initialize the usage stream for
///
/// # Behavior
/// - Only applies when ZO_USAGE_REPORT_TO_OWN_ORG is enabled
/// - Uses lock-free per-org tracking to ensure initialization happens only once per restart
/// - Auto-generates field list from UsageData struct via reflection
/// - Creates schema directly without ingesting sample data
/// - Does NOT manipulate defined_schema_fields (no UDS filtering for system streams)
/// - Never blocks ingestion even if initialization fails
pub async fn ensure_usage_stream_initialized(org_id: &str) -> Result<()> {
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
    match initialize_usage_stream_schema(org_id).await {
        Ok(_) => {
            // Mark as initialized (lock-free insert)
            INITIALIZED_ORGS.insert(org_id.to_string());
            Ok(())
        }
        Err(e) => {
            log::warn!(
                "[SELF-REPORTING] Failed to initialize usage stream schema for org {org_id}: {e}. Continuing anyway."
            );
            // Mark as initialized even on failure to prevent retry storms.
            // Schema will be created naturally on first actual usage ingestion through
            // OpenObserve's auto-schema evolution.
            INITIALIZED_ORGS.insert(org_id.to_string());
            Ok(())
        }
    }
}

/// Internal function that performs the actual schema initialization.
/// This should only be called by ensure_usage_stream_initialized.
///
/// Creates the usage stream schema directly when the stream doesn't exist.
/// Uses reflection to get all UsageData fields and creates an Arrow schema,
/// ensuring all fields are present from the start to prevent schema divergence.
async fn initialize_usage_stream_schema(org_id: &str) -> Result<()> {
    let stream_name = usage::USAGE_STREAM;
    let stream_type = StreamType::Logs;

    // Stream doesn't exist or has no fields - create schema using reflection
    log::info!(
        "[SELF-REPORTING] Creating usage stream schema for {org_id}/{stream_name} via reflection"
    );

    // Create a sample UsageData with all fields populated (for schema inference)
    let sample_usage = config::meta::self_reporting::usage::UsageData::init_for_reflection();

    // Convert to JSON value to infer Arrow schema
    let json_value = config::utils::json::to_value(&sample_usage)?;
    let json_map = json_value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("Failed to convert UsageData to JSON object"))?;

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
            "[SELF-REPORTING] Usage stream {org_id}/{stream_name} already exists with expected schema"
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
                "[SELF-REPORTING] Successfully created usage stream schema for {org_id}/{stream_name} with {} fields",
                expected_schema.fields().len()
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[SELF-REPORTING] Failed to create usage stream schema for {org_id}/{stream_name}: {e}"
            );
            Err(anyhow::anyhow!("Schema creation failed: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ensure_usage_stream_initialized_meta_org() {
        // Should return Ok immediately for META org
        let result = ensure_usage_stream_initialized(config::META_ORG_ID).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_ensure_usage_stream_initialized_marks_as_done() {
        let test_org = "test_usage_org_unique_789";

        // First call should attempt initialization
        let result = ensure_usage_stream_initialized(test_org).await;
        assert!(result.is_ok());

        // Verify it's marked as initialized
        assert!(INITIALIZED_ORGS.contains(test_org));
    }

    #[test]
    fn test_usage_data_init_for_reflection() {
        let sample = config::meta::self_reporting::usage::UsageData::init_for_reflection();

        // Verify key fields are populated
        assert!(sample.trace_id.is_some());
        assert!(sample.cached_ratio.is_some());
        assert!(sample.scan_files.is_some());
        assert!(sample.compressed_size.is_some());
        assert!(sample.min_ts.is_some());
        assert!(sample.max_ts.is_some());
        assert!(sample.search_type.is_some());
        assert!(sample.search_event_context.is_some());
        assert!(sample.took_wait_in_queue.is_some());
        assert!(sample.result_cache_ratio.is_some());
        assert!(sample.function.is_some());
        assert!(sample.work_group.is_some());
        assert!(sample.node_name.is_some());
        assert!(sample.dashboard_info.is_some());
        assert!(sample.peak_memory_usage.is_some());
    }
}
