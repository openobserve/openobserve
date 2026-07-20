// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Application adapters used to compose the standalone search service.

pub use ::search::{bloom_pruner, datafusion, index, inspector, sql, tantivy, utils};
use config::meta::{
    search,
    self_reporting::usage::{RequestStats, UsageType},
    stream::StreamType,
};
use infra::errors::Error;

#[derive(Clone, Copy, Debug, Default)]
pub struct CoreSearchRuntime;

#[async_trait::async_trait]
impl openobserve_search_service::cache::CacheRuntime for CoreSearchRuntime {
    async fn execute_search(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::Request,
    ) -> Result<search::Response, Error> {
        openobserve_search_service::service::search(trace_id, org_id, stream_type, user_id, req)
            .await
    }

    fn report_search_metrics(
        &self,
        start: std::time::Instant,
        org_id: &str,
        stream_type: StreamType,
        search_type: &str,
        search_group: &str,
    ) {
        crate::self_reporting::http_report_metrics(
            start,
            org_id,
            stream_type,
            "200",
            "_search",
            search_type,
            search_group,
        );
    }

    async fn report_search_usage(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        usage_type: UsageType,
        num_functions: u16,
        timestamp: i64,
    ) {
        crate::self_reporting::report_request_usage_stats(
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

#[async_trait::async_trait]
impl openobserve_search_service::streaming::StreamingRuntime for CoreSearchRuntime {
    async fn max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64 {
        openobserve_search_service::stream_utils::get_max_query_range(
            stream_names,
            org_id,
            user_id,
            stream_type,
        )
        .await
    }

    async fn search_partition(
        &self,
        trace_id: &str,
        org_id: &str,
        user_id: Option<&str>,
        stream_type: StreamType,
        req: &search::SearchPartitionRequest,
        skip_max_query_range: bool,
        use_cache: bool,
    ) -> Result<search::SearchPartitionResponse, Error> {
        openobserve_search_service::service::search_partition(
            trace_id,
            org_id,
            user_id,
            stream_type,
            req,
            skip_max_query_range,
            use_cache,
        )
        .await
    }

    #[cfg(feature = "enterprise")]
    fn search_error_status(&self, error: &Error) -> u16 {
        openobserve_search_service::http::map_error_to_http_response(error, None)
            .status()
            .as_u16()
    }

    #[cfg(feature = "enterprise")]
    async fn audit(&self, message: o2_enterprise::enterprise::common::auditor::AuditMessage) {
        crate::self_reporting::audit(message).await;
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::partition::PartitionRuntime for CoreSearchRuntime {
    async fn query_file_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<infra::file_list::FileId>, Error> {
        openobserve_search_service::file_list::query_ids(
            trace_id,
            org_id,
            stream_type,
            stream_name,
            time_range,
        )
        .await
    }

    async fn settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64 {
        openobserve_search_service::stream_utils::get_settings_max_query_range(
            stream_max_query_range,
            org_id,
            user_id,
        )
        .await
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::GrpcRuntime for CoreSearchRuntime {
    async fn enrichment_table_start_time(&self, org_id: &str, stream_name: &str) -> i64 {
        openobserve_enrichment::repository::get_start_time(org_id, stream_name).await
    }

    async fn query_file_keys_by_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
        ids: &[i64],
    ) -> Result<Vec<config::meta::stream::FileKey>, Error> {
        openobserve_search_service::file_list::query_by_ids(
            trace_id,
            org_id,
            stream_type,
            stream_name,
            time_range,
            ids,
        )
        .await
    }

    async fn query_file_keys(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_level: config::meta::stream::PartitionTimeLevel,
        time_min: i64,
        time_max: i64,
    ) -> Result<Vec<config::meta::stream::FileKey>, Error> {
        openobserve_search_service::file_list::query(
            trace_id,
            org_id,
            stream_type,
            stream_name,
            time_level,
            time_min,
            time_max,
        )
        .await
    }

    async fn calculate_files_size(
        &self,
        files: &[config::meta::stream::FileKey],
    ) -> Result<search::ScanStats, Error> {
        openobserve_search_service::file_list::calculate_files_size(files).await
    }

    async fn tantivy_index_updated_at(&self) -> i64 {
        ::common::metadata::tantivy_index::get_ttv_timestamp_updated_at().await
    }

    async fn tantivy_secondary_index_updated_at(&self) -> i64 {
        ::common::metadata::tantivy_index::get_ttv_secondary_index_updated_at().await
    }

    async fn max_promql_series(&self, org_id: &str) -> usize {
        match openobserve_organization::repository::organization::get_org_setting(org_id).await {
            Ok(settings) => settings
                .max_series_per_query
                .unwrap_or_else(|| config::get_config().limit.metrics_max_series_response),
            Err(err) => {
                log::warn!(
                    "Failed to fetch org settings for {org_id}, using default limit: {err:?}"
                );
                config::get_config().limit.metrics_max_series_response
            }
        }
    }

    async fn cached_search(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::Request,
    ) -> Result<search::Response, Error> {
        openobserve_search_service::cache::search(
            *self,
            trace_id,
            org_id,
            stream_type,
            user_id,
            req,
            String::new(),
            false,
            None,
            false,
        )
        .await
    }

    async fn search_multi(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::MultiStreamRequest,
    ) -> Result<search::Response, Error> {
        openobserve_search_service::service::search_multi(
            trace_id,
            org_id,
            stream_type,
            user_id,
            req,
        )
        .await
    }

    async fn cancel_query(
        &self,
        _org_id: &str,
        trace_id: &str,
    ) -> Result<search::CancelQueryResponse, Error> {
        #[cfg(feature = "enterprise")]
        return openobserve_search_service::service::cancel_query(_org_id, trace_id).await;

        #[cfg(not(feature = "enterprise"))]
        Ok(search::CancelQueryResponse {
            trace_id: trace_id.to_string(),
            is_success: false,
        })
    }

    #[cfg(feature = "enterprise")]
    async fn enrich_query_status(&self, status: &mut [proto::cluster_rpc::QueryStatus]) {
        for query_status in status {
            if let Some(ref mut ctx) = query_status.search_event_context
                && matches!(query_status.search_type.as_deref(), Some("dashboards"))
                && let Some(dashboard_id) = &ctx.dashboard_id
                && ctx.dashboard_name.is_none()
                && let Some(org_id) = &query_status.org_id
                && let Ok((folder, dashboard)) =
                    crate::dashboards::get_folder_and_dashboard(org_id, dashboard_id).await
            {
                ctx.dashboard_name = Some(dashboard.title().unwrap_or("").to_string());
                ctx.dashboard_folder_name = Some(folder.name);
                ctx.dashboard_folder_id = Some(folder.folder_id);
            }
        }
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::file_list::DumpReader for CoreSearchRuntime {
    async fn query(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        range: (i64, i64),
        ids: &[i64],
    ) -> Result<Vec<infra::file_list::FileRecord>, Error> {
        openobserve_compactor::file_list_dump::query(
            trace_id,
            org_id,
            stream_type,
            stream_name,
            range,
            ids,
        )
        .await
    }

    async fn query_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        range: (i64, i64),
    ) -> Result<Vec<infra::file_list::FileId>, Error> {
        openobserve_compactor::file_list_dump::query_ids(
            trace_id,
            org_id,
            stream_type,
            stream_name,
            range,
        )
        .await
    }
}

#[async_trait::async_trait]
impl openobserve_search_service::stream_utils::UserResolver for CoreSearchRuntime {
    async fn get_user(&self, org_id: &str, user_id: &str) -> Option<config::meta::user::User> {
        crate::users::get_user(Some(org_id), user_id).await
    }
}
