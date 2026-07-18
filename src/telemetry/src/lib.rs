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

//! Stable outbound ports for domain telemetry.
//!
//! This crate owns contracts only. Concrete queueing and storage adapters live in application
//! crates and depend on these ports, never the other way around.

use std::{error::Error, fmt, time::Instant};

use async_trait::async_trait;
use config::{
    meta::{
        self_reporting::{
            error::ErrorData,
            usage::{RequestStats, TriggerData, UsageType},
        },
        stream::StreamType,
    },
    utils::json::Value,
};
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub struct UsageReport {
    pub stats: RequestStats,
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: StreamType,
    pub usage_type: UsageType,
    pub num_functions: u16,
    pub timestamp: i64,
}

impl UsageReport {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        stats: RequestStats,
        org_id: impl Into<String>,
        stream_name: impl Into<String>,
        stream_type: StreamType,
        usage_type: UsageType,
        num_functions: u16,
        timestamp: i64,
    ) -> Self {
        Self {
            stats,
            org_id: org_id.into(),
            stream_name: stream_name.into(),
            stream_type,
            usage_type,
            num_functions,
            timestamp,
        }
    }
}

#[async_trait]
pub trait UsageSink: Send + Sync {
    async fn emit(&self, report: UsageReport);

    fn emit_trigger(&self, trigger: TriggerData);
}

#[derive(Debug, Default)]
pub struct NoopUsageSink;

#[async_trait]
impl UsageSink for NoopUsageSink {
    async fn emit(&self, _report: UsageReport) {}

    fn emit_trigger(&self, _trigger: TriggerData) {}
}

#[async_trait]
pub trait ErrorSink: Send + Sync {
    async fn emit(&self, error: ErrorData);
}

#[derive(Debug, Default)]
pub struct NoopErrorSink;

#[async_trait]
impl ErrorSink for NoopErrorSink {
    async fn emit(&self, _error: ErrorData) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuditProtocol {
    Http,
    WebSocket,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuditResponse {
    pub http_method: String,
    pub http_path: String,
    pub http_query_params: String,
    pub http_body: String,
    pub http_response_code: u16,
    pub error_msg: Option<String>,
    pub trace_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AuditEvent {
    pub user_email: String,
    pub org_id: String,
    pub timestamp: i64,
    pub protocol: AuditProtocol,
    pub response: AuditResponse,
}

#[async_trait]
pub trait AuditSink: Send + Sync {
    async fn emit(&self, event: AuditEvent);
}

#[derive(Debug, Default)]
pub struct NoopAuditSink;

#[async_trait]
impl AuditSink for NoopAuditSink {
    async fn emit(&self, _event: AuditEvent) {}
}

#[derive(Debug)]
pub struct HttpMetricsEvent {
    pub start: Instant,
    pub org_id: String,
    pub stream_type: StreamType,
    pub code: String,
    pub uri: String,
    pub search_type: String,
    pub search_group: String,
}

pub trait HttpMetricsSink: Send + Sync {
    fn record(&self, event: HttpMetricsEvent);
}

#[derive(Debug, Default)]
pub struct NoopHttpMetricsSink;

impl HttpMetricsSink for NoopHttpMetricsSink {
    fn record(&self, _event: HttpMetricsEvent) {}
}

#[derive(Debug)]
pub struct TelemetryWriteRequest {
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: StreamType,
    pub records: Vec<Value>,
}

impl TelemetryWriteRequest {
    pub fn new(
        org_id: impl Into<String>,
        stream_name: impl Into<String>,
        stream_type: StreamType,
        records: Vec<Value>,
    ) -> Self {
        Self {
            org_id: org_id.into(),
            stream_name: stream_name.into(),
            stream_type,
            records,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TelemetryWriteError(pub String);

impl fmt::Display for TelemetryWriteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for TelemetryWriteError {}

#[async_trait]
pub trait TelemetryWriter: Send + Sync {
    async fn write(&self, request: TelemetryWriteRequest) -> Result<(), TelemetryWriteError>;
}

#[derive(Debug, Default)]
pub struct NoopTelemetryWriter;

#[async_trait]
impl TelemetryWriter for NoopTelemetryWriter {
    async fn write(&self, _request: TelemetryWriteRequest) -> Result<(), TelemetryWriteError> {
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub enum CloudEventType {
    OrgCreated,
    OrgDeleted,
    OrgCleanupFailed,
    UserJoined,
    CheckoutSessionCreated,
    SubscriptionCreated,
    SubscriptionChanged,
    SubscriptionDeleted,
    StreamCreated,
}

#[derive(Clone, Debug, Deserialize, Hash, Serialize)]
pub struct CloudEvent {
    pub org_id: String,
    pub org_name: String,
    pub org_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    pub event: CloudEventType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,
}

#[async_trait]
pub trait CloudEventSink: Send + Sync {
    async fn emit(&self, event: CloudEvent);
}

#[derive(Debug, Default)]
pub struct NoopCloudEventSink;

#[async_trait]
impl CloudEventSink for NoopCloudEventSink {
    async fn emit(&self, _event: CloudEvent) {}
}

#[cfg(test)]
mod tests {
    use config::meta::{self_reporting::error::ErrorSource, stream::StreamParams};

    use super::*;

    #[tokio::test]
    async fn noop_sink_accepts_usage_reports() {
        NoopUsageSink
            .emit(UsageReport::new(
                RequestStats::default(),
                "org",
                "stream",
                StreamType::Logs,
                UsageType::Search,
                0,
                0,
            ))
            .await;
    }

    #[tokio::test]
    async fn noop_ports_accept_domain_events() {
        NoopErrorSink
            .emit(ErrorData {
                _timestamp: 0,
                stream_params: StreamParams::new("org", "stream", StreamType::Logs),
                error_source: ErrorSource::Other,
            })
            .await;

        NoopAuditSink
            .emit(AuditEvent {
                user_email: "user@example.com".to_string(),
                org_id: "org".to_string(),
                timestamp: 0,
                protocol: AuditProtocol::Http,
                response: AuditResponse {
                    http_method: "GET".to_string(),
                    http_path: "/api/test".to_string(),
                    http_query_params: String::new(),
                    http_body: String::new(),
                    http_response_code: 200,
                    error_msg: None,
                    trace_id: None,
                },
            })
            .await;

        NoopTelemetryWriter
            .write(TelemetryWriteRequest::new(
                "org",
                "stream",
                StreamType::Logs,
                vec![],
            ))
            .await
            .unwrap();

        NoopCloudEventSink
            .emit(CloudEvent {
                org_id: "org".to_string(),
                org_name: "Organization".to_string(),
                org_type: "default".to_string(),
                user: None,
                event: CloudEventType::OrgCreated,
                subscription_type: None,
                stream_name: None,
            })
            .await;

        NoopHttpMetricsSink.record(HttpMetricsEvent {
            start: Instant::now(),
            org_id: "org".to_string(),
            stream_type: StreamType::Logs,
            code: "200".to_string(),
            uri: "/api/test".to_string(),
            search_type: String::new(),
            search_group: String::new(),
        });
    }
}
