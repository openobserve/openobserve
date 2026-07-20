// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Application capabilities injected into the standalone self-reporting service.

use arrow_schema::Schema;
use config::{
    cluster::LOCAL_NODE,
    meta::stream::{StreamParams, StreamType},
    utils::json,
};
use openobserve_ingestion::types::{IngestUser, IngestionRequest, SystemJobType};
use proto::cluster_rpc;

struct CoreSelfReportingRuntime;

#[async_trait::async_trait]
impl openobserve_self_reporting::Runtime for CoreSelfReportingRuntime {
    async fn ingest_values(
        &self,
        values: Vec<json::Value>,
        stream: StreamParams,
    ) -> anyhow::Result<()> {
        let (org_id, stream_name): (String, String) =
            (stream.org_id.into(), stream.stream_name.into());

        if LOCAL_NODE.is_ingester() {
            let request = IngestionRequest::Usage(bytes::Bytes::from(json::to_string(&values)?));
            let response = openobserve_ingestion::logs::ingest::ingest(
                0,
                &org_id,
                &stream_name,
                request,
                IngestUser::SystemJob(SystemJobType::SelfReporting),
                None,
                false,
            )
            .await?;
            if response.code == 200 {
                return Ok(());
            }
            return Err(anyhow::anyhow!(response.error.unwrap_or_default()));
        }

        let request = cluster_rpc::IngestionRequest {
            org_id,
            stream_name,
            stream_type: stream.stream_type.to_string(),
            data: Some(cluster_rpc::IngestionData::from(values)),
            ingestion_type: Some(cluster_rpc::IngestionType::Usage.into()),
            metadata: None,
        };
        let response = openobserve_ingestion::internal::ingest(request).await?;
        if response.status_code == 200 {
            Ok(())
        } else {
            Err(anyhow::anyhow!(response.message))
        }
    }

    #[cfg(feature = "enterprise")]
    async fn ingest_request(
        &self,
        request: cluster_rpc::IngestionRequest,
    ) -> infra::errors::Result<cluster_rpc::IngestionResponse> {
        openobserve_ingestion::internal::ingest(request).await
    }

    async fn dashboard_context(
        &self,
        org_id: &str,
        dashboard_id: &str,
    ) -> Option<(String, String, String)> {
        let (folder, dashboard) = crate::dashboards::get_folder_and_dashboard(org_id, dashboard_id)
            .await
            .ok()?;
        Some((
            dashboard.title().unwrap_or_default().to_string(),
            folder.name,
            folder.folder_id,
        ))
    }

    async fn usage_stream_enabled(&self, org_id: &str) -> infra::errors::Result<bool> {
        crate::db::organization::get_org_setting_usage_stream_enabled(org_id).await
    }

    async fn merge_schema(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: StreamType,
        schema: &Schema,
        min_ts: Option<i64>,
    ) -> anyhow::Result<()> {
        crate::db::schema::merge(org_id, stream_name, stream_type, schema, min_ts)
            .await
            .map(|_| ())
    }

    async fn batch_upsert_pipeline_errors(
        &self,
        errors: openobserve_self_reporting::PipelineErrors,
    ) -> infra::errors::Result<()> {
        openobserve_pipeline::repository::pipeline_errors::batch_upsert(errors).await
    }

    #[cfg(feature = "cloud")]
    async fn org_in_free_trial(&self, org_id: &str) -> anyhow::Result<bool> {
        crate::organization::is_org_in_free_trial_period(org_id).await
    }
}

pub(crate) fn install_runtime() {
    let _ =
        openobserve_self_reporting::install_runtime(std::sync::Arc::new(CoreSelfReportingRuntime));
}
