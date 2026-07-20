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

//! Runtime ports required by the search application service.
//!
//! The search crate owns query behavior. The frontend/core crate installs an
//! adapter for capabilities that still belong to other application services,
//! keeping this crate independent from `openobserve-core`.

use std::{sync::Arc, time::Instant};

use async_trait::async_trait;
use bytes::Bytes;
use config::{
    meta::{
        search::ScanStats,
        self_reporting::usage::{RequestStats, UsageType},
        stream::{FileKey, StreamType},
    },
    metrics,
    utils::time::BASE_TIME,
};
use infra::{errors::Result, file_list::FileId};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::auditor::AuditMessage;
use parking_lot::RwLock;
use tokio::sync::OnceCell;

#[cfg(feature = "enterprise")]
#[derive(Clone, Debug)]
pub struct DashboardContext {
    pub dashboard_name: String,
    pub folder_name: String,
    pub folder_id: String,
}

#[async_trait]
pub trait SearchRuntime: Send + Sync + 'static {
    async fn query_file_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<FileId>>;

    async fn query_files_by_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
        ids: &[i64],
    ) -> Result<Vec<FileKey>>;

    async fn filter_pending_delete(&self, files: Vec<String>) -> Vec<String>;

    fn is_deleting_stream(&self, org_id: &str, stream_type: StreamType, stream_name: &str) -> bool;

    async fn ttv_timestamp_updated_at(&self) -> i64;

    async fn ttv_secondary_index_updated_at(&self) -> i64;

    async fn max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64;

    async fn settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64;

    #[allow(clippy::too_many_arguments)]
    async fn report_request_usage_stats(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        usage_type: UsageType,
        num_functions: u16,
        timestamp: i64,
    );

    #[cfg(feature = "enterprise")]
    async fn audit(&self, message: AuditMessage);

    #[cfg(feature = "enterprise")]
    async fn dashboard_context(&self, org_id: &str, dashboard_id: &str)
    -> Option<DashboardContext>;
}

static RUNTIME: RwLock<Option<Arc<dyn SearchRuntime>>> = RwLock::new(None);

pub fn install(runtime: Arc<dyn SearchRuntime>) {
    *RUNTIME.write() = Some(runtime);
}

fn get() -> Option<Arc<dyn SearchRuntime>> {
    RUNTIME.read().clone()
}

fn missing_runtime() -> infra::errors::Error {
    infra::errors::Error::Message(
        "search runtime adapter is not installed; install a SearchRuntime before running host-backed search operations"
            .to_string(),
    )
}

pub async fn query_file_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: (i64, i64),
) -> Result<Vec<FileId>> {
    let runtime = get().ok_or_else(missing_runtime)?;
    runtime
        .query_file_ids(trace_id, org_id, stream_type, stream_name, time_range)
        .await
}

pub async fn query_files_by_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    ids: &[i64],
) -> Result<Vec<FileKey>> {
    let runtime = get().ok_or_else(missing_runtime)?;
    runtime
        .query_files_by_ids(trace_id, org_id, stream_type, stream_name, time_range, ids)
        .await
}

pub async fn filter_pending_delete(files: Vec<String>) -> Vec<String> {
    match get() {
        Some(runtime) => runtime.filter_pending_delete(files).await,
        None => files,
    }
}

pub fn is_deleting_stream(org_id: &str, stream_type: StreamType, stream_name: &str) -> bool {
    get()
        .map(|runtime| runtime.is_deleting_stream(org_id, stream_type, stream_name))
        .unwrap_or(false)
}

pub async fn max_query_range(
    stream_names: &[String],
    org_id: &str,
    user_id: &str,
    stream_type: StreamType,
) -> i64 {
    match get() {
        Some(runtime) => {
            runtime
                .max_query_range(stream_names, org_id, user_id, stream_type)
                .await
        }
        None => 0,
    }
}

pub async fn settings_max_query_range(
    stream_max_query_range: i64,
    org_id: &str,
    user_id: Option<&str>,
) -> i64 {
    match get() {
        Some(runtime) => {
            runtime
                .settings_max_query_range(stream_max_query_range, org_id, user_id)
                .await
        }
        None => {
            if stream_max_query_range > 0 {
                stream_max_query_range
            } else {
                config::get_config().limit.default_max_query_range_days * 24
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn report_request_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    usage_type: UsageType,
    num_functions: u16,
    timestamp: i64,
) {
    if let Some(runtime) = get() {
        runtime
            .report_request_usage_stats(
                stats,
                org_id,
                stream_name,
                stream_type,
                usage_type,
                num_functions,
                timestamp,
            )
            .await;
    }
}

#[cfg(feature = "enterprise")]
pub async fn audit(message: AuditMessage) {
    if let Some(runtime) = get() {
        runtime.audit(message).await;
    }
}

#[cfg(feature = "enterprise")]
pub async fn dashboard_context(org_id: &str, dashboard_id: &str) -> Option<DashboardContext> {
    let runtime = get()?;
    runtime.dashboard_context(org_id, dashboard_id).await
}

pub fn calculate_files_size(files: &[FileKey]) -> Result<ScanStats> {
    let mut stats = ScanStats::new();
    stats.files = files.len() as i64;
    for file in files {
        stats.records += file.meta.records;
        stats.original_size += file.meta.original_size;
        stats.compressed_size += file.meta.compressed_size;
        stats.idx_scan_size += file.meta.index_size;
    }
    Ok(stats)
}

pub async fn enrichment_table_start_time(org_id: &str, name: &str) -> i64 {
    match infra::table::enrichment_tables::get_meta_stats(org_id, name).await {
        Some(meta_stats) => meta_stats.start_time,
        None => {
            let stats =
                infra::cache::stats::get_stream_stats(org_id, name, StreamType::EnrichmentTables);
            if stats.doc_time_min > 0 {
                stats.doc_time_min
            } else {
                BASE_TIME.timestamp_micros()
            }
        }
    }
}

static TTV_TIMESTAMP_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();
static TTV_SECONDARY_INDEX_UPDATED_AT: OnceCell<i64> = OnceCell::const_new();

pub async fn ttv_timestamp_updated_at() -> i64 {
    if let Some(runtime) = get() {
        return runtime.ttv_timestamp_updated_at().await;
    }
    *TTV_TIMESTAMP_UPDATED_AT
        .get_or_init(|| get_or_create_index_updated_at("/tantivy/_timestamp/updated_at"))
        .await
}

pub async fn ttv_secondary_index_updated_at() -> i64 {
    if let Some(runtime) = get() {
        return runtime.ttv_secondary_index_updated_at().await;
    }
    *TTV_SECONDARY_INDEX_UPDATED_AT
        .get_or_init(|| get_or_create_index_updated_at("/tantivy/secondary_index/updated_at"))
        .await
}

async fn get_or_create_index_updated_at(key: &str) -> i64 {
    let db = infra::db::get_db().await;
    match db.get(key).await {
        Ok(value) if !value.is_empty() => String::from_utf8_lossy(&value)
            .parse::<i64>()
            .unwrap_or_else(|_| BASE_TIME.timestamp_micros()),
        _ => {
            let timestamp = BASE_TIME.timestamp_micros();
            if let Err(err) = db
                .put(key, Bytes::from(timestamp.to_string()), false, None)
                .await
            {
                log::warn!("failed to store search index updated_at for {key}: {err}");
            }
            timestamp
        }
    }
}

#[inline]
#[allow(clippy::too_many_arguments)]
pub fn http_report_metrics(
    start: Instant,
    org_id: &str,
    stream_type: StreamType,
    code: &str,
    uri: &str,
    search_type: &str,
    search_group: &str,
) {
    let elapsed = start.elapsed().as_secs_f64();
    let uri = format!("/api/org/{uri}");
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            uri.as_str(),
            code,
            org_id,
            stream_type.as_str(),
            search_type,
            search_group,
        ])
        .observe(elapsed);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            uri.as_str(),
            code,
            org_id,
            stream_type.as_str(),
            search_type,
            search_group,
        ])
        .inc();
}

pub fn error_status(error: &infra::errors::Error) -> http::StatusCode {
    use http::StatusCode;
    use infra::errors::{Error, ErrorCodes};

    match error {
        Error::ErrorCode(code) => match code {
            ErrorCodes::SearchCancelQuery(_) | ErrorCodes::RatelimitExceeded(_) => {
                StatusCode::TOO_MANY_REQUESTS
            }
            ErrorCodes::SearchTimeout(_) => StatusCode::REQUEST_TIMEOUT,
            ErrorCodes::ServerInternalError(_) | ErrorCodes::SearchParquetFileNotFound => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            _ => StatusCode::BAD_REQUEST,
        },
        Error::ResourceError(_) => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::BAD_REQUEST,
    }
}
