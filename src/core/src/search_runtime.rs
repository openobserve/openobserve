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

use std::sync::Arc;

use ::search::service::runtime::SearchRuntime;
use async_trait::async_trait;
use config::meta::{
    self_reporting::usage::{RequestStats, UsageType},
    stream::{FileKey, StreamType},
};
use infra::{errors::Result, file_list::FileId};

struct CoreSearchRuntime;

pub fn install() {
    ::search::service::runtime::install(Arc::new(CoreSearchRuntime));
}

#[async_trait]
impl SearchRuntime for CoreSearchRuntime {
    async fn query_file_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: (i64, i64),
    ) -> Result<Vec<FileId>> {
        crate::file_list::query_ids(trace_id, org_id, stream_type, stream_name, time_range).await
    }

    async fn query_files_by_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
        ids: &[i64],
    ) -> Result<Vec<FileKey>> {
        crate::file_list::query_by_ids(trace_id, org_id, stream_type, stream_name, time_range, ids)
            .await
    }

    async fn filter_pending_delete(&self, files: Vec<String>) -> Vec<String> {
        crate::db::file_list::local::filter_by_pending_delete(files).await
    }

    fn is_deleting_stream(&self, org_id: &str, stream_type: StreamType, stream_name: &str) -> bool {
        crate::db::compact::retention::is_deleting_stream(org_id, stream_type, stream_name, None)
    }

    async fn ttv_timestamp_updated_at(&self) -> i64 {
        crate::db::metas::tantivy_index::get_ttv_timestamp_updated_at().await
    }

    async fn ttv_secondary_index_updated_at(&self) -> i64 {
        crate::db::metas::tantivy_index::get_ttv_secondary_index_updated_at().await
    }

    async fn max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64 {
        crate::stream_utils::get_max_query_range(stream_names, org_id, user_id, stream_type).await
    }

    async fn settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64 {
        crate::stream_utils::get_settings_max_query_range(stream_max_query_range, org_id, user_id)
            .await
    }

    async fn report_request_usage_stats(
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

    #[cfg(feature = "enterprise")]
    async fn audit(&self, message: o2_enterprise::enterprise::common::auditor::AuditMessage) {
        crate::self_reporting::audit(message).await;
    }

    #[cfg(feature = "enterprise")]
    async fn dashboard_context(
        &self,
        org_id: &str,
        dashboard_id: &str,
    ) -> Option<::search::service::runtime::DashboardContext> {
        let (folder, dashboard) = crate::dashboards::get_folder_and_dashboard(org_id, dashboard_id)
            .await
            .ok()?;
        Some(::search::service::runtime::DashboardContext {
            dashboard_name: dashboard.title().unwrap_or("").to_string(),
            folder_name: folder.name,
            folder_id: folder.folder_id,
        })
    }
}
