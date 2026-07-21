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

use arrow_schema::{Field, Schema};
use async_trait::async_trait;
use common::meta::stream::StreamSchema;
use config::meta::{
    pipeline::PipelineKind,
    self_reporting::usage::{RequestStats, TriggerData, UsageType},
    stream::{StreamParams, StreamType},
};
use serde_json::{Map, Value};

pub struct DistinctValue {
    pub stream_type: StreamType,
    pub stream_name: String,
    pub value: Map<String, Value>,
}

pub struct TraceListValue {
    pub timestamp: i64,
    pub stream_name: String,
    pub service_name: String,
    pub trace_id: String,
}

pub type PipelineBatchOutput = HashMap<StreamParams, Vec<(usize, Value)>>;
pub type ExecutablePipeline = Arc<dyn PipelineExecutor>;

#[async_trait]
pub trait PipelineExecutor: std::fmt::Debug + Send + Sync + 'static {
    fn kind(&self) -> PipelineKind;

    fn contains_llm_evaluation_node(&self) -> bool;

    fn destination_streams(&self) -> Vec<StreamParams>;

    fn name(&self) -> &str;

    fn num_functions(&self) -> usize;

    async fn process_batch(
        &self,
        org_id: &str,
        records: Vec<Value>,
        stream_name: Option<String>,
    ) -> anyhow::Result<PipelineBatchOutput>;
}

#[async_trait]
pub trait PipelineProvider: Send + Sync + 'static {
    async fn executable_pipelines(&self, stream: &StreamParams) -> Vec<ExecutablePipeline>;
}

#[async_trait]
pub trait RuntimeServices: Send + Sync + 'static {
    fn publish_trigger_usage(&self, trigger: TriggerData);

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

    async fn ingestion_log_enabled(&self) -> bool;

    async fn ensure_gen_ai_fields_in_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
    ) -> anyhow::Result<()>;

    async fn set_stream_is_llm(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        is_llm_stream: bool,
    ) -> anyhow::Result<()>;

    async fn merge_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        schema: &Schema,
        min_ts: Option<i64>,
    ) -> anyhow::Result<Option<(Schema, Vec<Field>)>>;

    async fn update_schema_setting(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        metadata: HashMap<String, String>,
    ) -> anyhow::Result<()>;

    async fn save_stream_settings(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        settings: config::meta::stream::StreamSettings,
    ) -> anyhow::Result<()>;

    async fn stream_retention(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Option<i64>;

    #[cfg(feature = "enterprise")]
    async fn set_stream_ownership_if_not_exists(&self, org_id: &str, object: &str);

    async fn list_stream_schemas(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        fetch_schema: bool,
    ) -> anyhow::Result<Vec<StreamSchema>>;

    #[cfg(feature = "enterprise")]
    async fn search_service_graph_usage(
        &self,
        sql: String,
        start_time: i64,
        end_time: i64,
    ) -> anyhow::Result<Vec<Value>>;

    #[cfg(feature = "enterprise")]
    async fn list_organization_ids(&self) -> anyhow::Result<Vec<String>>;

    #[cfg(feature = "cloud")]
    async fn report_stream_created_if_new(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        user_email: Option<&str>,
    ) -> infra::errors::Result<()>;

    #[cfg(feature = "cloud")]
    async fn is_org_in_free_trial_period(&self, org_id: &str) -> infra::errors::Result<bool>;
}

static RUNTIME_SERVICES: OnceLock<Arc<dyn RuntimeServices>> = OnceLock::new();
static PIPELINE_PROVIDER: OnceLock<Arc<dyn PipelineProvider>> = OnceLock::new();

pub fn install_runtime_services(
    services: Arc<dyn RuntimeServices>,
) -> Result<(), Arc<dyn RuntimeServices>> {
    RUNTIME_SERVICES.set(services)
}

pub fn install_pipeline_provider(
    provider: Arc<dyn PipelineProvider>,
) -> Result<(), Arc<dyn PipelineProvider>> {
    PIPELINE_PROVIDER.set(provider)
}

pub async fn executable_pipelines(stream: &StreamParams) -> Vec<ExecutablePipeline> {
    match PIPELINE_PROVIDER.get() {
        Some(provider) => provider.executable_pipelines(stream).await,
        None => {
            log::error!("ingestion pipeline provider is not installed");
            Vec::new()
        }
    }
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
    use crate::metadata::{MetadataItem, MetadataType, distinct_values::DvItem};

    let values = values
        .into_iter()
        .map(|value| {
            MetadataItem::DistinctValues(DvItem {
                stream_type: value.stream_type,
                stream_name: value.stream_name,
                value: value.value,
            })
        })
        .collect();
    crate::metadata::write(org_id, MetadataType::DistinctValues, values).await
}

pub async fn ingestion_log_enabled() -> bool {
    match RUNTIME_SERVICES.get() {
        Some(runtime) => runtime.ingestion_log_enabled().await,
        None => false,
    }
}

pub async fn write_trace_list(
    org_id: &str,
    values: Vec<TraceListValue>,
) -> infra::errors::Result<()> {
    use crate::metadata::{MetadataItem, MetadataType, trace_list_index::TraceListItem};

    let values = values
        .into_iter()
        .map(|value| {
            MetadataItem::TraceListIndexer(TraceListItem {
                _timestamp: value.timestamp,
                stream_name: value.stream_name,
                service_name: value.service_name,
                trace_id: value.trace_id,
            })
        })
        .collect();
    crate::metadata::write(org_id, MetadataType::TraceListIndexer, values).await
}

pub async fn ensure_gen_ai_fields_in_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> anyhow::Result<()> {
    runtime_services()?
        .ensure_gen_ai_fields_in_schema(org_id, stream_name, stream_type)
        .await
}

pub async fn set_stream_is_llm(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_llm_stream: bool,
) -> anyhow::Result<()> {
    runtime_services()?
        .set_stream_is_llm(org_id, stream_name, stream_type, is_llm_stream)
        .await
}

pub async fn merge_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
) -> anyhow::Result<Option<(Schema, Vec<Field>)>> {
    runtime_services()?
        .merge_schema(org_id, stream_name, stream_type, schema, min_ts)
        .await
}

pub async fn update_schema_setting(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    metadata: HashMap<String, String>,
) -> anyhow::Result<()> {
    runtime_services()?
        .update_schema_setting(org_id, stream_name, stream_type, metadata)
        .await
}

pub async fn save_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    settings: config::meta::stream::StreamSettings,
) -> anyhow::Result<()> {
    runtime_services()?
        .save_stream_settings(org_id, stream_name, stream_type, settings)
        .await
}

pub async fn stream_retention(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Option<i64> {
    match RUNTIME_SERVICES.get() {
        Some(runtime) => {
            runtime
                .stream_retention(org_id, stream_type, stream_name)
                .await
        }
        None => None,
    }
}

#[cfg(feature = "enterprise")]
pub async fn set_stream_ownership_if_not_exists(org_id: &str, object: &str) {
    if let Some(runtime) = RUNTIME_SERVICES.get() {
        runtime
            .set_stream_ownership_if_not_exists(org_id, object)
            .await;
    }
}

pub async fn list_stream_schemas(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> anyhow::Result<Vec<StreamSchema>> {
    runtime_services()?
        .list_stream_schemas(org_id, stream_type, fetch_schema)
        .await
}

#[cfg(feature = "enterprise")]
pub async fn search_service_graph_usage(
    sql: String,
    start_time: i64,
    end_time: i64,
) -> anyhow::Result<Vec<Value>> {
    runtime_services()?
        .search_service_graph_usage(sql, start_time, end_time)
        .await
}

#[cfg(feature = "enterprise")]
pub async fn list_organization_ids() -> anyhow::Result<Vec<String>> {
    runtime_services()?.list_organization_ids().await
}

#[cfg(feature = "cloud")]
pub async fn report_stream_created_if_new(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    user_email: Option<&str>,
) -> infra::errors::Result<()> {
    runtime_services()?
        .report_stream_created_if_new(org_id, stream_name, stream_type, user_email)
        .await
}

#[cfg(feature = "cloud")]
pub async fn is_org_in_free_trial_period(org_id: &str) -> infra::errors::Result<bool> {
    runtime_services()?
        .is_org_in_free_trial_period(org_id)
        .await
}
