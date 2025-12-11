// Copyright 2025 OpenObserve Inc.
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

//! Pattern Ingestion API
//!
//! Public API for ingesting extracted log patterns to pattern streams.
//! Called from enterprise pattern extraction code during compaction.

use anyhow::{Result, anyhow};
use config::utils::json;

use crate::common::meta::ingestion::{IngestUser, IngestionRequest};

/// Ingest extracted patterns to a pattern stream
///
/// Patterns are ingested to a stream named `{stream_name}_log_patterns` in the same org.
/// This runs on ingester nodes only, so we use direct ingestion.
///
/// # Arguments
/// * `org_id` - Organization ID
/// * `stream_name` - Original log stream name (without suffix)
/// * `patterns` - Vector of pattern JSON objects to ingest
/// * `user` - User identifier (real user email or system job type)
///
/// # Returns
/// `Ok(())` if ingestion succeeded, `Err` otherwise
pub async fn ingest_patterns(
    org_id: &str,
    stream_name: &str,
    patterns: Vec<json::Map<String, json::Value>>,
    user: IngestUser,
) -> Result<()> {
    if patterns.is_empty() {
        log::debug!(
            "[PatternIngestion] No patterns to ingest for {}/{}",
            org_id,
            stream_name
        );
        return Ok(());
    }

    // Create pattern stream name with suffix
    let pattern_stream_name = format!("{stream_name}_log_patterns");

    log::info!(
        "[PatternIngestion] Ingesting {} patterns to stream: {}/{}",
        patterns.len(),
        org_id,
        pattern_stream_name
    );

    // Convert to JSON array for ingestion
    let json_array: Vec<json::Value> = patterns.into_iter().map(json::Value::Object).collect();
    let json_string = json::to_string(&json_array)?;
    let bytes = bytes::Bytes::from(json_string);

    // Use direct log ingestion (we're on ingester nodes)
    let req = IngestionRequest::JSON(bytes);
    match super::ingest::ingest(0, org_id, &pattern_stream_name, req, user, None, false).await {
        Ok(resp) if resp.code == 200 => {
            log::debug!(
                "[PatternIngestion] Successfully ingested patterns to {}/{}",
                org_id,
                pattern_stream_name
            );
            Ok(())
        }
        error => {
            let err = error.map_or_else(|e| e.to_string(), |resp| resp.error.unwrap_or_default());
            log::error!(
                "[PatternIngestion] Failed to ingest patterns to {}/{}: {}",
                org_id,
                pattern_stream_name,
                err
            );
            Err(anyhow!("{err}"))
        }
    }
}
