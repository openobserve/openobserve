// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Application capabilities injected into organization management.

struct CoreOrganizationRuntime;

#[async_trait::async_trait]
impl openobserve_organization::Runtime for CoreOrganizationRuntime {
    async fn streams(
        &self,
        org_id: &str,
        stream_type: Option<config::meta::stream::StreamType>,
        fetch_schema: bool,
        permitted_streams: Option<Vec<String>>,
    ) -> Vec<common::meta::stream::Stream> {
        openobserve_catalog::stream::get_streams(
            org_id,
            stream_type,
            fetch_schema,
            permitted_streams,
        )
        .await
    }

    async fn transforms(
        &self,
        org_id: &str,
    ) -> anyhow::Result<Vec<config::meta::function::Transform>> {
        openobserve_transform::repository::list(org_id).await
    }

    async fn stream_schemas(
        &self,
        org_id: &str,
    ) -> anyhow::Result<Vec<common::meta::stream::StreamSchema>> {
        openobserve_catalog::schema::list(org_id, None, false).await
    }

    async fn delete_stream_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
    ) -> anyhow::Result<()> {
        openobserve_catalog::schema::delete(org_id, stream_name, Some(stream_type)).await
    }
}

#[async_trait::async_trait]
impl openobserve_organization::ReportingRuntime for CoreOrganizationRuntime {
    async fn search_usage(
        &self,
        sql: String,
        start_time: i64,
        end_time: i64,
        local: bool,
    ) -> anyhow::Result<Vec<config::utils::json::Value>> {
        openobserve_self_reporting::search::get_usage(sql, start_time, end_time, local)
            .await
            .map_err(Into::into)
    }

    #[cfg(feature = "cloud")]
    async fn enqueue_event(&self, event: openobserve_organization::ReportingEvent) {
        use openobserve_organization::ReportingEventType;
        use openobserve_self_reporting::cloud_events::{CloudEvent, EventType};

        let event_type = match event.event {
            ReportingEventType::OrgCreated => EventType::OrgCreated,
            ReportingEventType::OrgDeleted => EventType::OrgDeleted,
            ReportingEventType::OrgCleanupFailed => EventType::OrgCleanupFailed,
            ReportingEventType::UserJoined => EventType::UserJoined,
        };
        openobserve_self_reporting::cloud_events::enqueue_cloud_event(CloudEvent {
            org_id: event.org_id,
            org_name: event.org_name,
            org_type: event.org_type,
            user: event.user,
            event: event_type,
            subscription_type: None,
            stream_name: None,
        })
        .await;
    }

    #[cfg(feature = "cloud")]
    fn report_usage(&self, usages: Vec<config::meta::self_reporting::usage::UsageData>) {
        openobserve_self_reporting::report_usage(usages);
    }

    #[cfg(feature = "enterprise")]
    async fn audit_status_transition(&self, org_id: &str, actor: &str, from: &str, to: &str) {
        use openobserve_self_reporting::{audit, auditor};

        audit(auditor::AuditMessage {
            user_email: actor.to_string(),
            org_id: org_id.to_string(),
            _timestamp: config::utils::time::now_micros(),
            protocol: auditor::Protocol::Http,
            response_meta: auditor::ResponseMeta {
                http_method: "SYSTEM".to_string(),
                http_path: format!("/system/org_cleanup/{from}_to_{to}"),
                http_query_params: String::new(),
                http_body: String::new(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
        })
        .await;
    }
}

pub(crate) fn install_runtime() {
    let runtime = std::sync::Arc::new(CoreOrganizationRuntime);
    let _ = openobserve_organization::install_runtime(runtime.clone());
    let _ = openobserve_organization::install_reporting_runtime(runtime);
}
