// Copyright 2023 Zinc Labs Inc.
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

use std::collections::HashMap;

use actix_web_prometheus::{PrometheusMetrics, PrometheusMetricsBuilder};
use once_cell::sync::Lazy;
use prometheus::{
    CounterVec, HistogramOpts, HistogramVec, IntCounterVec, IntGaugeVec, Opts, Registry,
};

use crate::CONFIG;

pub const NAMESPACE: &str = "zo";
const HELP_SUFFIX: &str =
    "Please include 'organization, 'stream type', and 'stream' labels for this metric.";

// http latency
pub static HTTP_INCOMING_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "http_incoming_requests",
            "HTTP incoming requests. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream",
            "stream_type",
        ],
    )
    .expect("Metric created")
});
pub static HTTP_RESPONSE_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "http_response_time",
            "HTTP response time. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream",
            "stream_type",
        ],
    )
    .expect("Metric created")
});

// grpc latency
pub static GRPC_INCOMING_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "grpc_incoming_requests",
            "gRPC incoming requests. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream",
            "stream_type",
        ],
    )
    .expect("Metric created")
});
pub static GRPC_RESPONSE_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "grpc_response_time",
            "gRPC response time. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream",
            "stream_type",
        ],
    )
    .expect("Metric created")
});

// ingester stats
pub static INGEST_RECORDS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "ingest_records",
            "Ingested records. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new("ingest_bytes", "Ingested bytes. ".to_owned() + HELP_SUFFIX)
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_WAL_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "ingest_wal_used_bytes",
            "Ingestor WAL used bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_WAL_WRITE_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "ingest_wal_write_bytes",
            "Ingestor WAL write bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_WAL_READ_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "ingest_wal_read_bytes",
            "Ingestor WAL read bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_MEMTABLE_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "ingest_memtable_bytes",
            "Ingestor in memory bytes.".to_owned(),
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static INGEST_MEMTABLE_ARROW_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "ingest_memtable_arrow_bytes",
            "Ingestor arrow format in memory bytes.".to_owned(),
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static INGEST_MEMTABLE_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "ingest_memtable_files",
            "Ingestor in memory files.".to_owned(),
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// querier memory cache stats
pub static QUERY_MEMORY_CACHE_LIMIT_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_memory_cache_limit_bytes",
            "Querier memory cache limit bytes",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static QUERY_MEMORY_CACHE_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_memory_cache_used_bytes",
            "Querier memory cache used bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static QUERY_MEMORY_CACHE_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_memory_cache_files",
            "Querier memory cached files. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

// querier disk cache stats
pub static QUERY_DISK_CACHE_LIMIT_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_disk_cache_limit_bytes",
            "Querier disk cache limit bytes",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static QUERY_DISK_CACHE_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_disk_cache_used_bytes",
            "Querier diskcache used bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static QUERY_DISK_CACHE_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_disk_cache_files",
            "Querier disk cached files. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

// compactor stats
pub static COMPACT_USED_TIME: Lazy<CounterVec> = Lazy::new(|| {
    CounterVec::new(
        Opts::new(
            "compact_used_time",
            "Compactor used time. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static COMPACT_MERGED_FILES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "compact_merged_files",
            "Compactor merged files. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static COMPACT_MERGED_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "compact_merged_bytes",
            "Compactor merged bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static COMPACT_DELAY_HOURS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "compact_delay_hours",
            "Compactor delay hours. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
// TODO deletion / archiving stats

// storage stats
pub static STORAGE_ORIGINAL_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "storage_original_bytes",
            "Storage original bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_COMPRESSED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "storage_compressed_bytes",
            "Storage compressed bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("storage_files", "Storage files. ".to_owned() + HELP_SUFFIX)
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_RECORDS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "storage_records",
            "Storage records. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_WRITE_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_write_requests",
            "Storage write requests. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_READ_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_read_requests",
            "Storage read requests. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "storage_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_WRITE_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_write_bytes",
            "Storage write bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_READ_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_read_bytes",
            "Storage read bytes. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "storage_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_TIME: Lazy<CounterVec> = Lazy::new(|| {
    CounterVec::new(
        Opts::new(
            "storage_time",
            "Storage response time. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "method_type", "storage_type"],
    )
    .expect("Metric created")
});

// metadata stats
pub static META_STORAGE_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_storage_bytes", "Metadata storage used bytes")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static META_STORAGE_KEYS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_storage_keys", "Metadata storage item keys")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static META_NUM_NODES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_num_nodes", "Metadata node nums")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["node_role"],
    )
    .expect("Metric created")
});
pub static META_NUM_ORGANIZATIONS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_num_organizations", "Metadata organization nums")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static META_NUM_STREAMS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_num_streams", "Metadata stream nums")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static META_NUM_USERS_TOTAL: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_num_users_total", "Metadata user total")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static META_NUM_USERS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_num_users", "Metadata user nums")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});
pub static META_NUM_FUNCTIONS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "meta_num_functions",
            "Metadata function nums. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type", "function_type"],
    )
    .expect("Metric created")
});
pub static META_NUM_ALERTS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "meta_num_alerts",
            "Metadata alert nums. ".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream", "stream_type"],
    )
    .expect("Metric created")
});
pub static META_NUM_DASHBOARDS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("meta_num_dashboards", "Metadata dashboard nums")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static MEMORY_USAGE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("memory_usage", "Process memory usage")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

fn register_metrics(registry: &Registry) {
    // http latency
    registry
        .register(Box::new(HTTP_INCOMING_REQUESTS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(HTTP_RESPONSE_TIME.clone()))
        .expect("Metric registered");

    // grpc latency
    registry
        .register(Box::new(GRPC_INCOMING_REQUESTS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(GRPC_RESPONSE_TIME.clone()))
        .expect("Metric registered");

    // ingester stats
    registry
        .register(Box::new(INGEST_RECORDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_WAL_USED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_WAL_WRITE_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_WAL_READ_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_MEMTABLE_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_MEMTABLE_ARROW_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_MEMTABLE_FILES.clone()))
        .expect("Metric registered");

    // querier stats
    registry
        .register(Box::new(QUERY_MEMORY_CACHE_LIMIT_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_MEMORY_CACHE_USED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_MEMORY_CACHE_FILES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_DISK_CACHE_LIMIT_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_DISK_CACHE_USED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_DISK_CACHE_FILES.clone()))
        .expect("Metric registered");

    // compactor stats
    registry
        .register(Box::new(COMPACT_USED_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(COMPACT_MERGED_FILES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(COMPACT_MERGED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(COMPACT_DELAY_HOURS.clone()))
        .expect("Metric registered");

    // storage stats
    registry
        .register(Box::new(STORAGE_ORIGINAL_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_COMPRESSED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_FILES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_RECORDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_WRITE_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_READ_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_READ_REQUESTS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STORAGE_WRITE_REQUESTS.clone()))
        .expect("Metric registered");
    // metadata stats
    registry
        .register(Box::new(META_STORAGE_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_STORAGE_KEYS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_NODES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_ORGANIZATIONS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_STREAMS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_USERS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_USERS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_FUNCTIONS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_ALERTS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(META_NUM_DASHBOARDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(MEMORY_USAGE.clone()))
        .expect("Metric registered");
}

fn create_const_labels() -> HashMap<String, String> {
    let mut labels = HashMap::new();
    labels.insert("cluster".to_string(), CONFIG.common.cluster_name.clone());
    labels.insert("instance".to_string(), CONFIG.common.instance_name.clone());
    labels.insert("role".to_string(), CONFIG.common.node_role.clone());
    labels
}

pub fn create_prometheus_handler() -> PrometheusMetrics {
    let registry = prometheus::Registry::new();
    register_metrics(&registry);

    PrometheusMetricsBuilder::new(NAMESPACE)
        .endpoint(format!("{}/metrics", CONFIG.common.base_uri).as_str())
        .const_labels(create_const_labels())
        .registry(registry)
        .build()
        .expect("Prometheus build failed")
}
