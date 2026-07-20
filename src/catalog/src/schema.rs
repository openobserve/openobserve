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

//! Narrow write operations for stream metadata owned by the catalog boundary.

use config::{
    meta::stream::{StreamSettings, StreamType},
    utils::{json, time::now_micros},
};

/// Persists the dashboard-maintained distinct-value field list without pulling
/// the dashboard domain into the HTTP-facing stream service.
pub async fn save_distinct_value_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    settings: StreamSettings,
) -> Result<(), anyhow::Error> {
    // Match the stream service's behavior: dashboard updates remain successful
    // while a stream is being deleted, but its metadata is not rewritten.
    if crate::retention::is_deleting_stream(org_id, stream_type, stream_name, None) {
        return Ok(());
    }

    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let mut metadata = schema.metadata.clone();
    metadata.insert("settings".to_string(), json::to_string(&settings)?);
    metadata
        .entry("created_at".to_string())
        .or_insert_with(|| now_micros().to_string());
    infra::schema::update_setting(org_id, stream_name, stream_type, metadata).await?;
    Ok(())
}
