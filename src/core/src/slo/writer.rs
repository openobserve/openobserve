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

//! Writing to the reserved `slo_slices` stream.
//!
//! Goes through `IngestionRequest::Usage`, the same channel self-reporting
//! uses. That is not incidental: the reserved-stream guard rejects any write
//! for which `should_report_usage()` is true, and `Usage` is the variant for
//! which it is false. A write built any other way would be rejected by the
//! guard protecting the stream from users.

use config::{meta::stream::StreamType, utils::json};
use ingestion_common::{self as ingestion, IngestUser, SystemJobType};

/// Publish rows to a reserved internal stream.
pub async fn publish(org: &str, stream: &str, rows: Vec<json::Value>) -> Result<(), anyhow::Error> {
    if rows.is_empty() {
        return Ok(());
    }
    ensure_schema(org, stream).await;

    let bytes = bytes::Bytes::from(json::to_string(&rows)?);
    let req = ingestion::IngestionRequest::Usage(bytes);
    crate::logs::ingest::ingest(
        0,
        org,
        stream,
        req,
        IngestUser::SystemJob(SystemJobType::SelfReporting),
        None,
        false,
    )
    .await
    .map_err(|e| anyhow::anyhow!("failed to write {stream} for {org}: {e}"))?;
    Ok(())
}

/// Create the stream's schema by reflection before the first write, so every
/// field exists from the start rather than appearing as data happens to
/// contain it.
///
/// Failure is logged and ignored: auto-schema evolution will create the
/// fields on first write anyway, and blocking measurement on schema
/// bookkeeping would turn a cosmetic problem into lost data.
async fn ensure_schema(org: &str, stream: &str) {
    use config::meta::slo::stream::SloSliceRow;

    if !SCHEMA_INITIALIZED.insert(format!("{org}/{stream}")) {
        return;
    }
    let sample = SloSliceRow::init_for_reflection();
    let Ok(value) = json::to_value(&sample) else {
        return;
    };
    let Some(map) = value.as_object() else {
        return;
    };
    let expected = match config::utils::schema::infer_json_schema_from_map(
        stream,
        StreamType::Logs,
        std::iter::once(map),
    ) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[SLO] could not infer {stream} schema for {org}: {e}");
            return;
        }
    };
    if let Err(e) = crate::db::schema::merge(org, stream, StreamType::Logs, &expected, None).await {
        log::warn!("[SLO] could not initialize {stream} schema for {org}: {e}");
    }
}

/// Orgs whose reserved-stream schema has been initialized this process.
///
/// Lock-free and bounded by org count. A failed initialization still marks the
/// org done, deliberately: retrying on every write would be a retry storm over
/// something auto-schema evolution fixes anyway.
static SCHEMA_INITIALIZED: std::sync::LazyLock<dashmap::DashSet<String>> =
    std::sync::LazyLock::new(dashmap::DashSet::new);
