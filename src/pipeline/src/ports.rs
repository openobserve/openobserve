// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use config::meta::{
    function::Transform,
    self_reporting::{
        error::ErrorData,
        usage::{RequestStats, UsageType},
    },
    stream::StreamType,
};
use proto::cluster_rpc::{IngestionRequest, IngestionResponse};

#[async_trait]
pub trait RecordSink: Send + Sync + 'static {
    async fn ingest(&self, request: IngestionRequest) -> anyhow::Result<IngestionResponse>;
}

static RECORD_SINK: OnceLock<Arc<dyn RecordSink>> = OnceLock::new();

pub struct UsageReport {
    pub stats: RequestStats,
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: StreamType,
    pub usage_type: UsageType,
    pub num_functions: u16,
    pub timestamp: i64,
}

#[async_trait]
pub trait RuntimeServices: Send + Sync + 'static {
    async fn get_transform(&self, org_id: &str, name: &str) -> anyhow::Result<Transform>;

    async fn publish_error(&self, error: ErrorData);

    async fn report_usage(&self, report: UsageReport);
}

static RUNTIME_SERVICES: OnceLock<Arc<dyn RuntimeServices>> = OnceLock::new();

pub fn install_record_sink(sink: Arc<dyn RecordSink>) -> Result<(), Arc<dyn RecordSink>> {
    RECORD_SINK.set(sink)
}

pub fn install_runtime_services(
    services: Arc<dyn RuntimeServices>,
) -> Result<(), Arc<dyn RuntimeServices>> {
    RUNTIME_SERVICES.set(services)
}

pub async fn ingest(request: IngestionRequest) -> anyhow::Result<IngestionResponse> {
    let sink = RECORD_SINK
        .get()
        .ok_or_else(|| anyhow::anyhow!("pipeline record sink is not installed"))?;
    sink.ingest(request).await
}

pub async fn get_transform(org_id: &str, name: &str) -> anyhow::Result<Transform> {
    let services = RUNTIME_SERVICES
        .get()
        .ok_or_else(|| anyhow::anyhow!("pipeline runtime services are not installed"))?;
    services.get_transform(org_id, name).await
}

pub async fn publish_error(error: ErrorData) {
    if let Some(services) = RUNTIME_SERVICES.get() {
        services.publish_error(error).await;
    }
}

pub async fn report_usage(report: UsageReport) {
    if let Some(services) = RUNTIME_SERVICES.get() {
        services.report_usage(report).await;
    }
}
