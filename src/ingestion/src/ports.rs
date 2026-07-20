// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
};

use arrow_schema::Schema;
use async_trait::async_trait;
use common::meta::stream::SchemaEvolution;
use config::meta::{
    self_reporting::usage::{RequestStats, TriggerData, UsageType},
    stream::StreamType,
};
use infra::schema::SchemaCache;
use serde_json::{Map, Value};

use crate::types::StreamSchemaChk;

pub struct DistinctValue {
    pub stream_type: StreamType,
    pub stream_name: String,
    pub value: Map<String, Value>,
}

#[async_trait]
pub trait RuntimeServices: Send + Sync + 'static {
    fn publish_trigger_usage(&self, trigger: TriggerData);

    async fn check_for_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        stream_schema_map: &mut HashMap<String, SchemaCache>,
        record_vals: Vec<&Map<String, Value>>,
        record_ts: i64,
        is_derived: bool,
    ) -> anyhow::Result<(SchemaEvolution, Option<Schema>)>;

    async fn stream_schema_exists(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        stream_schema_map: &mut HashMap<String, SchemaCache>,
    ) -> anyhow::Result<StreamSchemaChk>;

    async fn report_request_usage_stats(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        usage_type: UsageType,
        functions: u16,
        started_at: i64,
    );

    async fn write_distinct_values(
        &self,
        org_id: &str,
        values: Vec<DistinctValue>,
    ) -> infra::errors::Result<()>;

    async fn ingestion_log_enabled(&self) -> bool;

    #[cfg(feature = "cloud")]
    async fn report_stream_created_if_new(
        &self,
        org_id: &str,
        stream_name: &str,
        user_email: &str,
    ) -> infra::errors::Result<()>;

    #[cfg(feature = "cloud")]
    async fn is_org_in_free_trial_period(&self, org_id: &str) -> infra::errors::Result<bool>;
}

static RUNTIME_SERVICES: OnceLock<Arc<dyn RuntimeServices>> = OnceLock::new();

pub fn install_runtime_services(
    services: Arc<dyn RuntimeServices>,
) -> Result<(), Arc<dyn RuntimeServices>> {
    RUNTIME_SERVICES.set(services)
}

pub fn runtime_services_installed() -> bool {
    RUNTIME_SERVICES.get().is_some()
}

pub fn publish_trigger_usage(trigger: TriggerData) {
    if let Some(runtime) = RUNTIME_SERVICES.get() {
        runtime.publish_trigger_usage(trigger);
    } else {
        log::error!("ingestion runtime services are not installed");
    }
}

fn runtime_services() -> infra::errors::Result<&'static Arc<dyn RuntimeServices>> {
    RUNTIME_SERVICES.get().ok_or_else(|| {
        infra::errors::Error::Message("ingestion runtime services are not installed".to_string())
    })
}

pub async fn check_for_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    record_vals: Vec<&Map<String, Value>>,
    record_ts: i64,
    is_derived: bool,
) -> anyhow::Result<(SchemaEvolution, Option<Schema>)> {
    runtime_services()?
        .check_for_schema(
            org_id,
            stream_name,
            stream_type,
            stream_schema_map,
            record_vals,
            record_ts,
            is_derived,
        )
        .await
}

pub async fn stream_schema_exists(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
) -> anyhow::Result<StreamSchemaChk> {
    runtime_services()?
        .stream_schema_exists(org_id, stream_name, stream_type, stream_schema_map)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn report_request_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    usage_type: UsageType,
    functions: u16,
    started_at: i64,
) {
    if let Some(runtime) = RUNTIME_SERVICES.get() {
        runtime
            .report_request_usage_stats(
                stats,
                org_id,
                stream_name,
                stream_type,
                usage_type,
                functions,
                started_at,
            )
            .await;
    }
}

pub async fn write_distinct_values(
    org_id: &str,
    values: Vec<DistinctValue>,
) -> infra::errors::Result<()> {
    runtime_services()?
        .write_distinct_values(org_id, values)
        .await
}

pub async fn ingestion_log_enabled() -> bool {
    match RUNTIME_SERVICES.get() {
        Some(runtime) => runtime.ingestion_log_enabled().await,
        None => false,
    }
}

#[cfg(feature = "cloud")]
pub async fn report_stream_created_if_new(
    org_id: &str,
    stream_name: &str,
    user_email: &str,
) -> infra::errors::Result<()> {
    runtime_services()?
        .report_stream_created_if_new(org_id, stream_name, user_email)
        .await
}

#[cfg(feature = "cloud")]
pub async fn is_org_in_free_trial_period(org_id: &str) -> infra::errors::Result<bool> {
    runtime_services()?
        .is_org_in_free_trial_period(org_id)
        .await
}
