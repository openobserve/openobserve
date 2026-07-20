// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use config::{
    meta::{
        alerts::{AlertConditionParams, QueryCondition, TriggerEvalResults, alert::Alert},
        folder::Folder,
        stream::StreamType,
    },
    utils::json::{Map, Value},
};

#[cfg(feature = "enterprise")]
pub struct IncidentRoute {
    pub incident_id: String,
    pub service_name: String,
}

#[cfg(feature = "enterprise")]
#[derive(Debug)]
pub enum PermissionError {
    MissingUser,
    UserNotFound,
    Other(String),
}

#[async_trait]
pub trait RuntimeServices: Send + Sync + 'static {
    async fn create_default_folder(&self, org_id: &str, folder: Folder) -> anyhow::Result<Folder>;

    async fn evaluate_alert(
        &self,
        alert: &Alert,
        row: Option<&Map<String, Value>>,
        time_range: (Option<i64>, i64),
        trace_id: Option<String>,
    ) -> anyhow::Result<TriggerEvalResults>;

    async fn build_sql(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        query_condition: &QueryCondition,
        conditions: &AlertConditionParams,
    ) -> anyhow::Result<String>;

    async fn promql_search(
        &self,
        trace_id: &str,
        org_id: &str,
        query: String,
        start: i64,
        end: i64,
        step: i64,
        is_super_cluster: bool,
    ) -> anyhow::Result<config::meta::promql::value::Value>;

    async fn setup_tracing_with_trace_id(
        &self,
        trace_id: &str,
        span: tracing::Span,
    ) -> tracing::Span;

    fn report_search_metrics(
        &self,
        start: std::time::Instant,
        org_id: &str,
        stream_type: StreamType,
        search_type: &str,
    );

    #[cfg(feature = "enterprise")]
    async fn route_incident(
        &self,
        alert: &Alert,
        row: &Map<String, Value>,
        notify_rows: &[Map<String, Value>],
        timestamp: i64,
    ) -> anyhow::Result<Option<IncidentRoute>>;

    #[cfg(feature = "enterprise")]
    async fn permitted_alerts(
        &self,
        org_id: &str,
        user_id: Option<&str>,
        folder_id: Option<&str>,
    ) -> Result<Option<Vec<String>>, PermissionError>;

    #[cfg(feature = "enterprise")]
    async fn report_incident_created(&self, org_id: &str, incident_id: &str, timestamp: i64);

    #[cfg(feature = "enterprise")]
    async fn service_graph_edges(&self, org_id: &str) -> anyhow::Result<Vec<Value>>;

    #[cfg(feature = "enterprise")]
    async fn sre_agent_credentials(&self, org_id: &str) -> anyhow::Result<(String, String)>;

    #[cfg(feature = "cloud")]
    async fn record_new_incident_ai_usage(&self, org_id: &str, incident_id: &str);

    #[cfg(feature = "cloud")]
    async fn allow_incident_reanalysis(
        &self,
        org_id: &str,
        user_email: &str,
        incident_id: &str,
    ) -> bool;
}

static RUNTIME_SERVICES: OnceLock<Arc<dyn RuntimeServices>> = OnceLock::new();

pub fn install_runtime_services(
    services: Arc<dyn RuntimeServices>,
) -> Result<(), Arc<dyn RuntimeServices>> {
    RUNTIME_SERVICES.set(services)
}

fn runtime_services() -> anyhow::Result<&'static dyn RuntimeServices> {
    RUNTIME_SERVICES
        .get()
        .map(Arc::as_ref)
        .ok_or_else(|| anyhow::anyhow!("alert runtime services are not installed"))
}

pub async fn create_default_folder(org_id: &str, folder: Folder) -> anyhow::Result<Folder> {
    runtime_services()?
        .create_default_folder(org_id, folder)
        .await
}

pub async fn evaluate_alert(
    alert: &Alert,
    row: Option<&Map<String, Value>>,
    time_range: (Option<i64>, i64),
    trace_id: Option<String>,
) -> anyhow::Result<TriggerEvalResults> {
    runtime_services()?
        .evaluate_alert(alert, row, time_range, trace_id)
        .await
}

pub async fn build_sql(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    query_condition: &QueryCondition,
    conditions: &AlertConditionParams,
) -> anyhow::Result<String> {
    runtime_services()?
        .build_sql(
            org_id,
            stream_name,
            stream_type,
            query_condition,
            conditions,
        )
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn promql_search(
    trace_id: &str,
    org_id: &str,
    query: String,
    start: i64,
    end: i64,
    step: i64,
    is_super_cluster: bool,
) -> anyhow::Result<config::meta::promql::value::Value> {
    runtime_services()?
        .promql_search(trace_id, org_id, query, start, end, step, is_super_cluster)
        .await
}

pub async fn setup_tracing_with_trace_id(trace_id: &str, span: tracing::Span) -> tracing::Span {
    match runtime_services() {
        Ok(runtime) => runtime.setup_tracing_with_trace_id(trace_id, span).await,
        Err(_) => span,
    }
}

pub fn report_search_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    search_type: &str,
) {
    if let Ok(runtime) = runtime_services() {
        runtime.report_search_metrics(start, org_id, stream_type, search_type);
    }
}

#[cfg(feature = "enterprise")]
pub async fn route_incident(
    alert: &Alert,
    row: &Map<String, Value>,
    notify_rows: &[Map<String, Value>],
    timestamp: i64,
) -> anyhow::Result<Option<IncidentRoute>> {
    runtime_services()?
        .route_incident(alert, row, notify_rows, timestamp)
        .await
}

#[cfg(feature = "enterprise")]
pub async fn permitted_alerts(
    org_id: &str,
    user_id: Option<&str>,
    folder_id: Option<&str>,
) -> Result<Option<Vec<String>>, PermissionError> {
    match RUNTIME_SERVICES.get() {
        Some(services) => services.permitted_alerts(org_id, user_id, folder_id).await,
        None => Err(PermissionError::Other(
            "alert runtime services are not installed".to_string(),
        )),
    }
}

#[cfg(feature = "enterprise")]
pub async fn report_incident_created(org_id: &str, incident_id: &str, timestamp: i64) {
    if let Ok(runtime) = runtime_services() {
        runtime
            .report_incident_created(org_id, incident_id, timestamp)
            .await;
    }
}

#[cfg(feature = "enterprise")]
pub async fn service_graph_edges(org_id: &str) -> anyhow::Result<Vec<Value>> {
    runtime_services()?.service_graph_edges(org_id).await
}

#[cfg(feature = "enterprise")]
pub async fn sre_agent_credentials(org_id: &str) -> anyhow::Result<(String, String)> {
    runtime_services()?.sre_agent_credentials(org_id).await
}

#[cfg(feature = "cloud")]
pub async fn record_new_incident_ai_usage(org_id: &str, incident_id: &str) {
    if let Ok(runtime) = runtime_services() {
        runtime
            .record_new_incident_ai_usage(org_id, incident_id)
            .await;
    }
}

#[cfg(feature = "cloud")]
pub async fn allow_incident_reanalysis(org_id: &str, user_email: &str, incident_id: &str) -> bool {
    match runtime_services() {
        Ok(runtime) => {
            runtime
                .allow_incident_reanalysis(org_id, user_email, incident_id)
                .await
        }
        Err(error) => {
            log::error!("incident runtime unavailable: {error}");
            false
        }
    }
}
