// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{collections::HashMap, sync::Arc};

use arrow_schema::Schema;
use async_trait::async_trait;
use common::meta::stream::SchemaEvolution;
use config::{
    META_ORG_ID, get_config,
    meta::{
        self_reporting::usage::{RequestStats, TriggerData, UsageType},
        stream::StreamType,
    },
};
use infra::schema::SchemaCache;
use openobserve_ingestion::{ports::DistinctValue, types::StreamSchemaChk};
use serde_json::{Map, Value};

pub mod grpc {
    pub use openobserve_ingestion::grpc::*;
}
pub mod ingestion_service;

pub use openobserve_ingestion::service::*;
pub use openobserve_transform::{
    JSRuntimeConfig, apply_js_fn, apply_vrl_fn, compile_js_function, compile_vrl_function,
    init_vrl_runtime as init_functions_runtime,
};

struct CoreIngestionRuntime;

#[async_trait]
impl openobserve_ingestion::ports::RuntimeServices for CoreIngestionRuntime {
    fn publish_trigger_usage(&self, trigger: TriggerData) {
        crate::self_reporting::publish_triggers_usage(trigger);
    }

    async fn check_for_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        stream_schema_map: &mut HashMap<String, SchemaCache>,
        record_vals: Vec<&Map<String, Value>>,
        record_ts: i64,
        is_derived: bool,
    ) -> anyhow::Result<(SchemaEvolution, Option<Schema>)> {
        crate::schema::check_for_schema(
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

    async fn stream_schema_exists(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        stream_schema_map: &mut HashMap<String, SchemaCache>,
    ) -> anyhow::Result<StreamSchemaChk> {
        Ok(
            crate::schema::stream_schema_exists(
                org_id,
                stream_name,
                stream_type,
                stream_schema_map,
            )
            .await,
        )
    }

    async fn report_request_usage_stats(
        &self,
        stats: RequestStats,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        usage_type: UsageType,
        functions: u16,
        started_at: i64,
    ) {
        crate::self_reporting::report_request_usage_stats(
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

    async fn write_distinct_values(
        &self,
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

    async fn ingestion_log_enabled(&self) -> bool {
        if !get_config().common.ingestion_log_enabled {
            return false;
        }
        crate::db::organization::get_org_setting_toggle_ingestion_logs(META_ORG_ID)
            .await
            .unwrap_or(false)
    }

    #[cfg(feature = "cloud")]
    async fn report_stream_created_if_new(
        &self,
        org_id: &str,
        stream_name: &str,
        user_email: &str,
    ) -> infra::errors::Result<()> {
        if crate::stream::get_stream(org_id, stream_name, StreamType::Logs)
            .await
            .is_some()
        {
            return Ok(());
        }

        let Some(org) = crate::organization::get_org(org_id).await else {
            return Err(infra::errors::Error::Message(format!(
                "org with id {org_id} not found in db"
            )));
        };
        crate::self_reporting::cloud_events::enqueue_cloud_event(
            crate::self_reporting::cloud_events::CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: Some(user_email.to_string()),
                event: crate::self_reporting::cloud_events::EventType::StreamCreated,
                subscription_type: None,
                stream_name: Some(stream_name.to_string()),
            },
        )
        .await;
        Ok(())
    }

    #[cfg(feature = "cloud")]
    async fn is_org_in_free_trial_period(&self, org_id: &str) -> infra::errors::Result<bool> {
        crate::organization::is_org_in_free_trial_period(org_id).await
    }
}

pub fn install_runtime_services() {
    let _ = openobserve_ingestion::ports::install_runtime_services(Arc::new(CoreIngestionRuntime));
}
