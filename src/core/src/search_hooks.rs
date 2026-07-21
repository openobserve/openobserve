// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::Arc;

use async_trait::async_trait;
use config::meta::{
    self_reporting::usage::{RequestStats, UsageType},
    stream::StreamType,
};

struct CoreSearchHooks;

#[async_trait]
impl crate::service::search::hooks::SearchHooks for CoreSearchHooks {
    async fn report_request_usage(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        usage_type: UsageType,
        num_functions: u16,
        timestamp: i64,
    ) {
        crate::service::self_reporting::report_request_usage_stats(
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

    async fn get_max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64 {
        crate::service::stream_utils::get_max_query_range(
            stream_names,
            org_id,
            user_id,
            stream_type,
        )
        .await
    }

    async fn get_settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64 {
        crate::service::stream_utils::get_settings_max_query_range(
            stream_max_query_range,
            org_id,
            user_id,
        )
        .await
    }

    #[cfg(feature = "enterprise")]
    async fn audit(&self, msg: o2_enterprise::enterprise::common::auditor::AuditMessage) {
        crate::service::self_reporting::audit(msg).await;
    }
}

pub fn init() {
    crate::service::search::hooks::set_search_hooks(Arc::new(CoreSearchHooks));
}
