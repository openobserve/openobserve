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
