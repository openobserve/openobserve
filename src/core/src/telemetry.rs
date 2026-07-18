// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Application composition for outbound telemetry ports.

use async_trait::async_trait;
#[cfg(feature = "enterprise")]
use config::{META_ORG_ID, spawn_pausable_job};
use config::{
    cluster::LOCAL_NODE,
    meta::{
        self_reporting::{error::ErrorData, usage::TriggerData},
        stream::StreamType,
    },
    metrics,
    utils::json,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::auditor;
use proto::cluster_rpc;
pub use telemetry::{
    AuditEvent, AuditProtocol, AuditResponse, AuditSink, CloudEvent, CloudEventSink,
    CloudEventType, ErrorSink, HttpMetricsEvent, HttpMetricsSink, TelemetryWriteError,
    TelemetryWriteRequest, TelemetryWriter, UsageReport, UsageSink,
};

use crate::common::meta::ingestion::{self, IngestUser, SystemJobType};

#[derive(Debug, Default)]
struct SelfReportingUsageSink;

#[async_trait]
impl UsageSink for SelfReportingUsageSink {
    async fn emit(&self, report: UsageReport) {
        crate::self_reporting::report_request_usage_stats(
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

    fn emit_trigger(&self, trigger: TriggerData) {
        crate::self_reporting::publish_triggers_usage(trigger);
    }
}

#[derive(Debug, Default)]
struct SelfReportingErrorSink;

#[async_trait]
impl ErrorSink for SelfReportingErrorSink {
    async fn emit(&self, error: ErrorData) {
        crate::self_reporting::publish_error(error).await;
    }
}

#[derive(Debug, Default)]
struct IngestionTelemetryWriter;

#[async_trait]
impl TelemetryWriter for IngestionTelemetryWriter {
    async fn write(&self, request: TelemetryWriteRequest) -> Result<(), TelemetryWriteError> {
        if request.records.is_empty() {
            return Ok(());
        }

        if LOCAL_NODE.is_ingester() {
            let bytes = bytes::Bytes::from(
                json::to_string(&request.records)
                    .map_err(|error| TelemetryWriteError(error.to_string()))?,
            );
            let ingestion_request = ingestion::IngestionRequest::Usage(bytes);
            match crate::logs::ingest::ingest(
                0,
                &request.org_id,
                &request.stream_name,
                ingestion_request,
                IngestUser::SystemJob(SystemJobType::SelfReporting),
                None,
                false,
            )
            .await
            {
                Ok(response) if response.code == 200 => Ok(()),
                result => Err(TelemetryWriteError(result.map_or_else(
                    |error| error.to_string(),
                    |response| response.error.unwrap_or_default(),
                ))),
            }
        } else {
            write_ingestion_request(cluster_rpc::IngestionRequest {
                org_id: request.org_id,
                stream_name: request.stream_name,
                stream_type: request.stream_type.to_string(),
                data: Some(cluster_rpc::IngestionData::from(request.records)),
                ingestion_type: Some(cluster_rpc::IngestionType::Usage.into()),
                metadata: None,
            })
            .await
            .map(|_| ())
            .map_err(|error| TelemetryWriteError(error.to_string()))
        }
    }
}

async fn write_ingestion_request(
    request: cluster_rpc::IngestionRequest,
) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
    crate::ingestion::ingestion_service::ingest(request)
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}

#[cfg(feature = "enterprise")]
async fn write_audit_request(
    request: cluster_rpc::IngestionRequest,
) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
    let records = request
        .data
        .ok_or_else(|| anyhow::anyhow!("audit ingestion request is missing data"))
        .and_then(|data| {
            json::from_slice::<Vec<json::Value>>(&data.data).map_err(anyhow::Error::from)
        })?;

    TELEMETRY_WRITER
        .write(TelemetryWriteRequest::new(
            request.org_id,
            request.stream_name,
            StreamType::from(request.stream_type),
            records,
        ))
        .await
        .map_err(anyhow::Error::from)?;

    Ok(cluster_rpc::IngestionResponse {
        status_code: 200,
        message: String::new(),
    })
}

#[derive(Debug, Default)]
struct MetricsRecorder;

impl HttpMetricsSink for MetricsRecorder {
    fn record(&self, event: HttpMetricsEvent) {
        let time = event.start.elapsed().as_secs_f64();
        let uri = format!("/api/org/{}", event.uri);
        metrics::HTTP_RESPONSE_TIME
            .with_label_values(&[
                uri.as_str(),
                &event.code,
                &event.org_id,
                event.stream_type.as_str(),
                &event.search_type,
                &event.search_group,
            ])
            .observe(time);
        metrics::HTTP_INCOMING_REQUESTS
            .with_label_values(&[
                uri.as_str(),
                &event.code,
                &event.org_id,
                event.stream_type.as_str(),
                &event.search_type,
                &event.search_group,
            ])
            .inc();
    }
}

#[derive(Debug, Default)]
struct SelfReportingAuditSink;

#[async_trait]
impl AuditSink for SelfReportingAuditSink {
    async fn emit(&self, event: AuditEvent) {
        #[cfg(feature = "enterprise")]
        auditor::audit(META_ORG_ID, audit_message(event), write_audit_request).await;

        #[cfg(not(feature = "enterprise"))]
        let _ = event;
    }
}

#[cfg(feature = "enterprise")]
fn audit_message(event: AuditEvent) -> auditor::AuditMessage {
    auditor::AuditMessage {
        user_email: event.user_email,
        org_id: event.org_id,
        _timestamp: event.timestamp,
        protocol: match event.protocol {
            AuditProtocol::Http => auditor::Protocol::Http,
            AuditProtocol::WebSocket => auditor::Protocol::Ws,
        },
        response_meta: auditor::ResponseMeta {
            http_method: event.response.http_method,
            http_path: event.response.http_path,
            http_query_params: event.response.http_query_params,
            http_body: event.response.http_body,
            http_response_code: event.response.http_response_code,
            error_msg: event.response.error_msg,
            trace_id: event.response.trace_id,
        },
    }
}

#[derive(Debug, Default)]
struct SelfReportingCloudEventSink;

#[async_trait]
impl CloudEventSink for SelfReportingCloudEventSink {
    async fn emit(&self, event: CloudEvent) {
        #[cfg(feature = "cloud")]
        crate::self_reporting::cloud_events::enqueue_cloud_event(event).await;

        #[cfg(not(feature = "cloud"))]
        let _ = event;
    }
}

static USAGE_SINK: SelfReportingUsageSink = SelfReportingUsageSink;
static ERROR_SINK: SelfReportingErrorSink = SelfReportingErrorSink;
static TELEMETRY_WRITER: IngestionTelemetryWriter = IngestionTelemetryWriter;
static HTTP_METRICS_SINK: MetricsRecorder = MetricsRecorder;
static AUDIT_SINK: SelfReportingAuditSink = SelfReportingAuditSink;
static CLOUD_EVENT_SINK: SelfReportingCloudEventSink = SelfReportingCloudEventSink;

pub async fn report_usage(report: UsageReport) {
    report_usage_to(&USAGE_SINK, report).await;
}

#[allow(clippy::too_many_arguments)]
pub async fn report_request_usage(
    stats: config::meta::self_reporting::usage::RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    usage_type: config::meta::self_reporting::usage::UsageType,
    num_functions: u16,
    timestamp: i64,
) {
    report_usage(UsageReport::new(
        stats,
        org_id,
        stream_name,
        stream_type,
        usage_type,
        num_functions,
        timestamp,
    ))
    .await;
}

pub async fn report_usage_to(sink: &dyn UsageSink, report: UsageReport) {
    sink.emit(report).await;
}

pub fn report_trigger(trigger: TriggerData) {
    USAGE_SINK.emit_trigger(trigger);
}

pub async fn publish_error(error: ErrorData) {
    ERROR_SINK.emit(error).await;
}

pub async fn write_internal(request: TelemetryWriteRequest) -> Result<(), TelemetryWriteError> {
    TELEMETRY_WRITER.write(request).await
}

#[allow(clippy::too_many_arguments)]
pub fn record_http_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    code: &str,
    uri: &str,
    search_type: &str,
    search_group: &str,
) {
    HTTP_METRICS_SINK.record(HttpMetricsEvent {
        start,
        org_id: org_id.to_string(),
        stream_type,
        code: code.to_string(),
        uri: uri.to_string(),
        search_type: search_type.to_string(),
        search_group: search_group.to_string(),
    });
}

pub async fn audit(event: AuditEvent) {
    AUDIT_SINK.emit(event).await;
}

pub async fn report_cloud_event(event: CloudEvent) {
    CLOUD_EVENT_SINK.emit(event).await;
}

#[cfg(feature = "enterprise")]
pub fn run_audit_publish() -> Option<tokio::task::JoinHandle<()>> {
    let o2cfg = o2_enterprise::enterprise::common::config::get_config();
    if !o2cfg.common.audit_enabled {
        return None;
    }

    Some(spawn_pausable_job!(
        "audit_publish",
        o2cfg.common.audit_publish_interval,
        {
            log::debug!("Audit ingestion loop running");
            auditor::publish_existing_audits(META_ORG_ID, write_audit_request).await;
        },
        pause_if: o2cfg.common.audit_publish_interval == 0 || !o2_enterprise::enterprise::common::config::get_config().common.audit_enabled
    ))
}

#[cfg(feature = "enterprise")]
pub async fn flush_audit() {
    auditor::flush_audit(META_ORG_ID, write_audit_request).await;
}

#[cfg(feature = "cloud")]
pub async fn flush_cloud_events() {
    crate::self_reporting::cloud_events::flush_cloud_events().await;
}

#[cfg(test)]
mod tests {
    use config::meta::{
        self_reporting::usage::{RequestStats, UsageType},
        stream::StreamType,
    };
    use telemetry::NoopUsageSink;

    use super::*;

    #[tokio::test]
    async fn usage_port_supports_noop_injection() {
        report_usage_to(
            &NoopUsageSink,
            UsageReport::new(
                RequestStats::default(),
                "org",
                "stream",
                StreamType::Logs,
                UsageType::Search,
                0,
                0,
            ),
        )
        .await;
    }
}
