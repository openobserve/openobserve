// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{collections::HashMap, sync::Arc};

use arrow_schema::{Field, Schema};
use async_trait::async_trait;
use common::meta::stream::StreamSchema;
use config::{
    META_ORG_ID, get_config,
    meta::{
        self_reporting::usage::{RequestStats, TriggerData, UsageType},
        stream::StreamType,
    },
};

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

    async fn ingestion_log_enabled(&self) -> bool {
        if !get_config().common.ingestion_log_enabled {
            return false;
        }
        crate::db::organization::get_org_setting_toggle_ingestion_logs(META_ORG_ID)
            .await
            .unwrap_or(false)
    }

    async fn ensure_gen_ai_fields_in_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
    ) -> anyhow::Result<()> {
        crate::db::schema::ensure_gen_ai_fields_in_schema(org_id, stream_name, stream_type).await
    }

    async fn set_stream_is_llm(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        is_llm_stream: bool,
    ) -> anyhow::Result<()> {
        crate::db::schema::set_stream_is_llm(org_id, stream_name, stream_type, is_llm_stream).await
    }

    async fn merge_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        schema: &Schema,
        min_ts: Option<i64>,
    ) -> anyhow::Result<Option<(Schema, Vec<Field>)>> {
        crate::db::schema::merge(org_id, stream_name, stream_type, schema, min_ts).await
    }

    async fn update_schema_setting(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        metadata: HashMap<String, String>,
    ) -> anyhow::Result<()> {
        crate::db::schema::update_setting(org_id, stream_name, stream_type, metadata).await
    }

    async fn save_stream_settings(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        settings: config::meta::stream::StreamSettings,
    ) -> anyhow::Result<()> {
        crate::stream::save_stream_settings(org_id, stream_name, stream_type, settings)
            .await
            .map(|_| ())
            .map_err(Into::into)
    }

    async fn stream_retention(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Option<i64> {
        crate::stream::get_stream_retention(org_id, stream_type, stream_name).await
    }

    #[cfg(feature = "enterprise")]
    async fn set_stream_ownership_if_not_exists(&self, org_id: &str, object: &str) {
        if o2_openfga::config::get_config().enabled {
            o2_openfga::authorizer::authz::set_ownership_if_not_exists(org_id, object).await;
        }
    }

    async fn list_stream_schemas(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        fetch_schema: bool,
    ) -> anyhow::Result<Vec<StreamSchema>> {
        crate::db::schema::list(org_id, stream_type, fetch_schema).await
    }

    async fn set_prom_cluster_info(
        &self,
        cluster_name: &str,
        members: &[String],
    ) -> anyhow::Result<()> {
        crate::db::metrics::set_prom_cluster_info(cluster_name, members).await
    }

    #[cfg(feature = "cloud")]
    async fn report_stream_created_if_new(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        user_email: Option<&str>,
    ) -> infra::errors::Result<()> {
        if crate::stream::get_stream(org_id, stream_name, stream_type)
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
                user: user_email.map(str::to_string),
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
