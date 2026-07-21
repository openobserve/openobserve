// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use config::meta::{
    self_reporting::usage::{RequestStats, UsageType},
    stream::StreamType,
};

#[async_trait]
pub trait SearchHooks: Send + Sync + 'static {
    async fn report_request_usage(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        usage_type: UsageType,
        num_functions: u16,
        timestamp: i64,
    );

    async fn get_max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64;

    async fn get_settings_max_query_range(
        &self,
        stream_max_query_range: i64,
        org_id: &str,
        user_id: Option<&str>,
    ) -> i64;

    #[cfg(feature = "enterprise")]
    async fn audit(&self, msg: o2_enterprise::enterprise::common::auditor::AuditMessage);
}

static HOOKS: OnceLock<Arc<dyn SearchHooks>> = OnceLock::new();

pub fn set_search_hooks(hooks: Arc<dyn SearchHooks>) {
    let _ = HOOKS.set(hooks);
}

pub async fn report_request_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    usage_type: UsageType,
    num_functions: u16,
    timestamp: i64,
) {
    if let Some(hooks) = HOOKS.get() {
        hooks
            .report_request_usage(
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

pub async fn get_max_query_range(
    stream_names: &[String],
    org_id: &str,
    user_id: &str,
    stream_type: StreamType,
) -> i64 {
    match HOOKS.get() {
        Some(hooks) => {
            hooks
                .get_max_query_range(stream_names, org_id, user_id, stream_type)
                .await
        }
        None => 0,
    }
}

pub async fn get_settings_max_query_range(
    stream_max_query_range: i64,
    org_id: &str,
    user_id: Option<&str>,
) -> i64 {
    match HOOKS.get() {
        Some(hooks) => {
            hooks
                .get_settings_max_query_range(stream_max_query_range, org_id, user_id)
                .await
        }
        None => stream_max_query_range,
    }
}

#[cfg(feature = "enterprise")]
pub async fn audit(msg: o2_enterprise::enterprise::common::auditor::AuditMessage) {
    if let Some(hooks) = HOOKS.get() {
        hooks.audit(msg).await;
    }
}

#[inline]
pub fn http_report_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    code: &str,
    uri: &str,
    search_type: &str,
    search_group: &str,
) {
    let uri = format!("/api/org/{uri}");
    let labels = [
        uri.as_str(),
        code,
        org_id,
        stream_type.as_str(),
        search_type,
        search_group,
    ];
    config::metrics::HTTP_RESPONSE_TIME
        .with_label_values(&labels)
        .observe(start.elapsed().as_secs_f64());
    config::metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&labels)
        .inc();
}
