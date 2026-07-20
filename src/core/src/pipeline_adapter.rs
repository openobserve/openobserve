// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Application capabilities injected into the standalone pipeline service.

use std::sync::Arc;

struct CoreRecordSink;
struct CoreRuntimeServices;

#[async_trait::async_trait]
impl openobserve_pipeline::ports::RecordSink for CoreRecordSink {
    async fn ingest(
        &self,
        request: proto::cluster_rpc::IngestionRequest,
    ) -> anyhow::Result<proto::cluster_rpc::IngestionResponse> {
        openobserve_ingestion::internal::ingest(request)
            .await
            .map_err(Into::into)
    }
}

#[async_trait::async_trait]
impl openobserve_pipeline::ports::RuntimeServices for CoreRuntimeServices {
    async fn get_transform(
        &self,
        org_id: &str,
        name: &str,
    ) -> anyhow::Result<config::meta::function::Transform> {
        openobserve_transform::repository::get(org_id, name).await
    }

    async fn wait_for_geoip(&self) {
        std::sync::LazyLock::force(
            &openobserve_enrichment::enrichment_table::geoip::MMDB_INIT_NOTIFIER,
        )
        .notified()
        .await;
    }

    async fn publish_error(&self, error: config::meta::self_reporting::error::ErrorData) {
        openobserve_self_reporting::publish_error(error).await;
    }

    async fn report_usage(&self, report: openobserve_pipeline::ports::UsageReport) {
        openobserve_self_reporting::report_request_usage_stats(
            report.stats,
            &report.org_id,
            &report.stream_name,
            report.stream_type,
            report.usage_type,
            report.num_functions,
            report.timestamp,
        )
        .await;
    }
}

pub fn install_record_sink() {
    let _ = openobserve_pipeline::ports::install_record_sink(Arc::new(CoreRecordSink));
    let _ = openobserve_pipeline::ports::install_runtime_services(Arc::new(CoreRuntimeServices));
}
