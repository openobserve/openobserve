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

//! NATS Visibility Metrics Collector
//!
//! Collects metrics from NATS JetStream HTTP monitoring API (/jsz) and converts
//! them to Prometheus format for ingestion.

use chrono::Utc;
use config::get_config;
use prost::Message;
use serde::Deserialize;

use crate::errors::*;

const META_ORG: &str = "_meta";

pub struct NatsVisibilityCollector {
    nats_monitoring_url: String,
}

impl NatsVisibilityCollector {
    pub fn new() -> Self {
        let cfg = get_config();
        let nats_monitoring_url =
            format!("http://127.0.0.1:{}", cfg.nats_visibility.monitoring_port);

        Self {
            nats_monitoring_url,
        }
    }

    /// Main collection and ingestion function
    ///
    /// Steps:
    /// 1. Fetch JetStream data from NATS HTTP API
    /// 2. Extract metrics from JSON
    /// 3. Convert to Prometheus WriteRequest format
    /// 4. Compress with Snappy
    /// 5. POST to Prometheus remote_write endpoint
    pub async fn collect_and_ingest(&self) -> Result<()> {
        log::debug!("[NATS Visibility] Starting collection cycle");

        // Step 1: Fetch data from NATS
        let jsz_data = self.fetch_jsz().await?;

        // Step 2: Extract metrics
        let metrics = self.extract_metrics(&jsz_data)?;

        if metrics.is_empty() {
            log::info!("[NATS Visibility] No metrics to ingest");
            return Ok(());
        }

        log::info!("[NATS Visibility] Extracted {} metrics", metrics.len());

        // Step 3-4: Build and compress Prometheus WriteRequest
        let compressed_bytes = self.build_prometheus_write_request(metrics)?;

        // Step 5: Ingest via Prometheus API
        self.ingest_metrics(compressed_bytes).await?;

        log::info!("[NATS Visibility] Collection cycle completed successfully");
        Ok(())
    }

    /// Fetch JetStream data from NATS HTTP monitoring API
    async fn fetch_jsz(&self) -> Result<JszResponse> {
        let url = format!(
            "{}/jsz?acc=$G&streams=true&consumers=true",
            self.nats_monitoring_url
        );

        log::debug!("[NATS Visibility] Fetching from: {}", url);

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| Error::Message(format!("Failed to create HTTP client: {}", e)))?;

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| Error::Message(format!("Failed to fetch /jsz: {}", e)))?;

        if !response.status().is_success() {
            return Err(Error::Message(format!(
                "NATS monitoring API returned error: {}",
                response.status()
            )));
        }

        let data: JszResponse = response
            .json()
            .await
            .map_err(|e| Error::Message(format!("Failed to parse /jsz JSON: {}", e)))?;

        log::debug!(
            "[NATS Visibility] Fetched {} account(s)",
            data.account_details.len()
        );

        Ok(data)
    }

    /// Extract Prometheus metrics from JetStream JSON response
    fn extract_metrics(&self, jsz_data: &JszResponse) -> Result<Vec<PrometheusMetric>> {
        let mut metrics = Vec::new();
        let now = Utc::now().timestamp_millis();
        let cfg = get_config();

        // Process first account (typically $G)
        if let Some(account) = jsz_data.account_details.first() {
            for stream in &account.stream_detail {
                let org = extract_org_from_stream_name(&stream.name);
                let stream_type = if stream.name.starts_with("KV_") {
                    "kv"
                } else {
                    "stream"
                };

                // Base labels for stream metrics
                let stream_labels = vec![
                    ("stream".to_string(), stream.name.clone()),
                    ("org".to_string(), org.clone()),
                    ("cluster".to_string(), cfg.common.cluster_name.clone()),
                    ("stream_type".to_string(), stream_type.to_string()),
                ];

                // Metric 1: nats_stream_messages
                metrics.push(PrometheusMetric {
                    name: "nats_stream_messages".to_string(),
                    labels: stream_labels.clone(),
                    value: stream.state.messages as f64,
                    timestamp: now,
                });

                // Metric 2: nats_stream_bytes
                metrics.push(PrometheusMetric {
                    name: "nats_stream_bytes".to_string(),
                    labels: stream_labels.clone(),
                    value: stream.state.bytes as f64,
                    timestamp: now,
                });

                // Metric 3: nats_stream_consumer_count
                metrics.push(PrometheusMetric {
                    name: "nats_stream_consumer_count".to_string(),
                    labels: stream_labels.clone(),
                    value: stream.state.consumer_count as f64,
                    timestamp: now,
                });

                // Metric 4: nats_stream_capacity_usage_percent
                if let Some(max_bytes) = stream.config.max_bytes {
                    if max_bytes > 0 {
                        let usage_percent = (stream.state.bytes as f64 / max_bytes as f64) * 100.0;
                        metrics.push(PrometheusMetric {
                            name: "nats_stream_capacity_usage_percent".to_string(),
                            labels: stream_labels.clone(),
                            value: usage_percent,
                            timestamp: now,
                        });
                    }
                }

                // Process consumers
                for consumer in &stream.consumer_detail {
                    let node_id = extract_node_from_consumer_name(&consumer.name);

                    let consumer_labels = vec![
                        ("stream".to_string(), stream.name.clone()),
                        ("consumer".to_string(), consumer.name.clone()),
                        ("org".to_string(), org.clone()),
                        ("node".to_string(), node_id.clone()),
                        ("cluster".to_string(), cfg.common.cluster_name.clone()),
                    ];

                    // Metric 5: nats_consumer_lag (MOST IMPORTANT)
                    let lag = stream
                        .state
                        .last_seq
                        .saturating_sub(consumer.delivered.stream_seq);
                    metrics.push(PrometheusMetric {
                        name: "nats_consumer_lag".to_string(),
                        labels: consumer_labels.clone(),
                        value: lag as f64,
                        timestamp: now,
                    });

                    // Metric 6: nats_consumer_ack_pending
                    metrics.push(PrometheusMetric {
                        name: "nats_consumer_ack_pending".to_string(),
                        labels: consumer_labels.clone(),
                        value: consumer.num_ack_pending as f64,
                        timestamp: now,
                    });

                    // Metric 7: nats_consumer_redelivered
                    metrics.push(PrometheusMetric {
                        name: "nats_consumer_redelivered".to_string(),
                        labels: consumer_labels.clone(),
                        value: consumer.num_redelivered as f64,
                        timestamp: now,
                    });

                    // Metric 8: nats_consumer_idle_seconds
                    if let Ok(last_active) =
                        chrono::DateTime::parse_from_rfc3339(&consumer.delivered.last_active)
                    {
                        let last_active_utc = last_active.with_timezone(&Utc);
                        let idle_seconds = (Utc::now() - last_active_utc).num_seconds();
                        metrics.push(PrometheusMetric {
                            name: "nats_consumer_idle_seconds".to_string(),
                            labels: consumer_labels.clone(),
                            value: idle_seconds.max(0) as f64,
                            timestamp: now,
                        });
                    }

                    // Metric 9: nats_consumer_num_pending
                    metrics.push(PrometheusMetric {
                        name: "nats_consumer_num_pending".to_string(),
                        labels: consumer_labels.clone(),
                        value: consumer.num_pending as f64,
                        timestamp: now,
                    });
                }
            }
        }

        Ok(metrics)
    }

    /// Build Prometheus WriteRequest protobuf and compress with Snappy
    fn build_prometheus_write_request(&self, metrics: Vec<PrometheusMetric>) -> Result<Vec<u8>> {
        use proto::prometheus_rpc::{Label, Sample, TimeSeries, WriteRequest};

        let mut timeseries_vec = Vec::new();

        for metric in metrics {
            // Build labels (add __name__ as first label)
            let mut labels = vec![Label {
                name: "__name__".to_string(),
                value: metric.name.clone(),
            }];

            for (key, value) in metric.labels {
                labels.push(Label { name: key, value });
            }

            // Build sample
            let sample = Sample {
                value: metric.value,
                timestamp: metric.timestamp,
            };

            timeseries_vec.push(TimeSeries {
                labels,
                samples: vec![sample],
                exemplars: vec![],
                histograms: vec![],
            });
        }

        let write_request = WriteRequest {
            timeseries: timeseries_vec,
            metadata: vec![],
        };

        // Encode to protobuf
        let mut buf = Vec::new();
        write_request
            .encode(&mut buf)
            .map_err(|e| Error::Message(format!("Failed to encode protobuf: {}", e)))?;

        log::debug!("[NATS Visibility] Encoded {} bytes of protobuf", buf.len());

        // Compress with snappy
        let mut encoder = snap::raw::Encoder::new();
        let compressed = encoder
            .compress_vec(&buf)
            .map_err(|e| Error::Message(format!("Failed to compress with snappy: {}", e)))?;

        log::debug!(
            "[NATS Visibility] Compressed to {} bytes ({}% reduction)",
            compressed.len(),
            100 - (compressed.len() * 100 / buf.len().max(1))
        );

        Ok(compressed)
    }

    /// Ingest metrics via Prometheus remote_write API
    async fn ingest_metrics(&self, compressed_bytes: Vec<u8>) -> Result<()> {
        let cfg = get_config();

        // Use Prometheus remote_write endpoint
        let url = format!(
            "http://127.0.0.1:{}/api/{}/prometheus/api/v1/write",
            cfg.http.port, META_ORG
        );

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| Error::Message(format!("Failed to create HTTP client: {}", e)))?;

        let auth_user = cfg.auth.root_user_email.clone();
        let auth_password = cfg.auth.root_user_password.clone();

        log::debug!("[NATS Visibility] Posting to {}", url);

        let response = client
            .post(&url)
            .basic_auth(&auth_user, Some(&auth_password))
            .header("Content-Type", "application/x-protobuf")
            .header("Content-Encoding", "snappy")
            .header("X-Prometheus-Remote-Write-Version", "0.1.0")
            .body(compressed_bytes)
            .send()
            .await
            .map_err(|e| Error::Message(format!("Failed to POST to Prometheus API: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "<unable to read body>".to_string());
            return Err(Error::Message(format!(
                "Prometheus write failed: {} - {}",
                status, body
            )));
        }

        log::info!("[NATS Visibility] Metrics ingested successfully via Prometheus API");
        Ok(())
    }
}

impl Default for NatsVisibilityCollector {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(Debug)]
struct PrometheusMetric {
    name: String,
    labels: Vec<(String, String)>,
    value: f64,
    timestamp: i64,
}

// JSON response structures for parsing NATS /jsz

#[derive(Debug, Deserialize)]
struct JszResponse {
    #[serde(default)]
    account_details: Vec<AccountDetail>,
}

#[derive(Debug, Deserialize)]
struct AccountDetail {
    #[serde(default)]
    stream_detail: Vec<StreamDetail>,
}

#[derive(Debug, Deserialize)]
struct StreamDetail {
    name: String,
    config: StreamConfig,
    state: StreamState,
    #[serde(default)]
    consumer_detail: Vec<ConsumerDetail>,
}

#[derive(Debug, Deserialize)]
struct StreamConfig {
    max_bytes: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct StreamState {
    messages: u64,
    bytes: u64,
    first_seq: u64,
    last_seq: u64,
    consumer_count: i32,
}

#[derive(Debug, Deserialize)]
struct ConsumerDetail {
    name: String,
    delivered: DeliveryInfo,
    num_ack_pending: i32,
    num_redelivered: i32,
    num_pending: i32,
}

#[derive(Debug, Deserialize)]
struct DeliveryInfo {
    stream_seq: u64,
    last_active: String, // RFC3339 timestamp
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Extract organization name from stream name
///
/// Examples:
/// - "alert_manager_pending_dev3" -> "dev3"
/// - "KV_o2_schema" -> "default"
/// - "o2_coordinator_events" -> "default"
fn extract_org_from_stream_name(stream_name: &str) -> String {
    if stream_name.starts_with("KV_o2_") || stream_name.starts_with("o2_") {
        return "default".to_string();
    }

    // Try to extract last segment after underscore
    stream_name
        .rsplit('_')
        .next()
        .unwrap_or("default")
        .to_string()
}

/// Extract node ID from consumer name
///
/// Examples:
/// - "node1_alertmanager" -> "node1"
/// - "lino2_local" -> "lino2"
/// - "consumer123" -> "consumer123"
fn extract_node_from_consumer_name(consumer_name: &str) -> String {
    consumer_name
        .split('_')
        .next()
        .unwrap_or(consumer_name)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_org_from_stream_name() {
        assert_eq!(
            extract_org_from_stream_name("alert_manager_pending_dev3"),
            "dev3"
        );
        assert_eq!(extract_org_from_stream_name("KV_o2_schema"), "default");
        assert_eq!(
            extract_org_from_stream_name("o2_coordinator_events"),
            "default"
        );
        assert_eq!(extract_org_from_stream_name("custom_stream_org5"), "org5");
    }

    #[test]
    fn test_extract_node_from_consumer_name() {
        assert_eq!(
            extract_node_from_consumer_name("node1_alertmanager"),
            "node1"
        );
        assert_eq!(extract_node_from_consumer_name("lino2_local"), "lino2");
        assert_eq!(
            extract_node_from_consumer_name("consumer123"),
            "consumer123"
        );
    }
}
