use actix_web_prometheus::{PrometheusMetrics, PrometheusMetricsBuilder};
use prometheus::{HistogramOpts, HistogramVec, IntGaugeVec, Opts, Registry};
use std::collections::HashMap;

use super::config::CONFIG;

pub const NAMESPACE: &str = "zo";

lazy_static! {
    // http or grpc latency
    pub static ref LOGS_HTTP_INGEST_BULK_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new(
            "logs_http_ingest_bulk_response_time",
            "HTTP bulk ingested logs response time"
        )
        .namespace(NAMESPACE),
        &["organization"],
    )
    .expect("create metric");
    pub static ref LOGS_HTTP_INGEST_JSON_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new(
            "logs_http_ingest_json_response_time",
            "HTTP json ingested logs response time"
        )
        .namespace(NAMESPACE),
        &["organization", "stream"],
    )
    .expect("Failed to create metric");
    pub static ref LOGS_HTTP_INGEST_MULTI_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new(
            "logs_http_ingest_multi_response_time",
            "HTTP multi ingested logs response time"
        )
        .namespace(NAMESPACE),
        &["organization", "stream"],
    )
    .expect("Failed to create metric");
    pub static ref LOGS_HTTP_SEARCH_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new(
            "logs_http_search_response_time",
            "HTTP search logs response time"
        )
        .namespace(NAMESPACE),
        &["organization", "stream"],
    )
    .expect("Failed to create metric");
    pub static ref LOGS_HTTP_SEARCH_AROUND_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new(
            "logs_http_search_around_response_time",
            "HTTP search around logs response time"
        )
        .namespace(NAMESPACE),
        &["organization", "stream"],
    )
    .expect("Failed to create metric");
    pub static ref GRPC_SEARCH_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new("grpc_search_response_time", "gRPC search response time")
            .namespace(NAMESPACE),
        &["organization", "stream", "stream_type"],
    )
    .expect("Failed to create metric");
    pub static ref GRPC_EVENT_RESPONSE_TIME: HistogramVec = HistogramVec::new(
        HistogramOpts::new("grpc_event_response_time", "gRPC event response time")
            .namespace(NAMESPACE),
        &[],
    )
    .expect("Failed to create metric");

    // ingest stream stats
    pub static ref INGEST_RECORDS: IntGaugeVec = IntGaugeVec::new(
        Opts::new("ingest_records", "Ingested records").namespace(NAMESPACE),
        &["organization", "stream", "stream_type"],
    )
    .expect("Failed to create metric");
    pub static ref INGEST_BYTES: IntGaugeVec = IntGaugeVec::new(
        Opts::new("ingest_bytes", "Ingested bytes").namespace(NAMESPACE),
        &["organization", "stream", "stream_type"],
    )
    .expect("Failed to create metric");
}

pub fn create_prometheus_handler() -> PrometheusMetrics {
    let registry = prometheus::Registry::new();
    register_metrics(&registry);

    let mut labels = HashMap::new();
    labels.insert("hostname".to_string(), CONFIG.common.instance_name.clone());
    labels.insert("role".to_string(), CONFIG.common.node_role.clone());
    let prometheus = PrometheusMetricsBuilder::new(NAMESPACE)
        .endpoint(format!("{}/metrics", CONFIG.common.base_uri).as_str())
        .const_labels(labels)
        .registry(registry)
        .build()
        .expect("Failed to build prometheus");
    process_metrics(&prometheus);
    prometheus
}

fn register_metrics(registry: &Registry) {
    registry
        .register(Box::new(LOGS_HTTP_INGEST_BULK_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(LOGS_HTTP_INGEST_JSON_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(LOGS_HTTP_INGEST_MULTI_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(LOGS_HTTP_SEARCH_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(LOGS_HTTP_SEARCH_AROUND_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(GRPC_SEARCH_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(GRPC_EVENT_RESPONSE_TIME.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(INGEST_RECORDS.clone()))
        .expect("Failed to register metric");
    registry
        .register(Box::new(INGEST_BYTES.clone()))
        .expect("Failed to register metric");
}

#[cfg(target_os = "linux")]
fn process_metrics(metrics: &PrometheusMetrics) {
    use prometheus::process_collector::ProcessCollector;
    metrics
        .registry
        .register(Box::new(ProcessCollector::for_self()))
        .expect("metric can be registered");
}

#[cfg(not(target_os = "linux"))]
fn process_metrics(_metrics: &PrometheusMetrics) {}
