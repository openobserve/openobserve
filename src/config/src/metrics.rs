// Copyright 2025 OpenObserve Inc.
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

use once_cell::sync::Lazy;
use prometheus::{
    CounterVec, Encoder, HistogramOpts, HistogramVec, IntCounterVec, IntGauge, IntGaugeVec, Opts,
    Registry, TextEncoder,
};

pub const NAMESPACE: &str = "zo";
const HELP_SUFFIX: &str =
    "Please include 'organization, 'stream type', and 'stream' labels for this metric.";

// http latency
pub static HTTP_INCOMING_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "http_incoming_requests",
            "HTTP incoming requests.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream_type",
            "search_type",
            "search_group",
        ],
    )
    .expect("Metric created")
});
pub static HTTP_RESPONSE_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "http_response_time",
            "HTTP response time.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream_type",
            "search_type",
            "search_group",
        ],
    )
    .expect("Metric created")
});

// grpc latency
pub static GRPC_INCOMING_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "grpc_incoming_requests",
            "gRPC incoming requests.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream_type",
            "search_type",
            "search_group",
        ],
    )
    .expect("Metric created")
});
pub static GRPC_RESPONSE_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "grpc_response_time",
            "gRPC response time.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[
            "endpoint",
            "status",
            "organization",
            "stream_type",
            "search_type",
            "search_group",
        ],
    )
    .expect("Metric created")
});

// ingester stats
pub static INGEST_RECORDS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "ingest_records",
            "Ingested records.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new("ingest_bytes", "Ingested bytes.".to_owned() + HELP_SUFFIX)
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_ERRORS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "ingest_errors",
            "Errors while ingesting records".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "stream", "error_type"],
    )
    .expect("Metric created")
});
pub static INGEST_WAL_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "ingest_wal_used_bytes",
            "Ingestor WAL used bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static INGEST_PARQUET_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "ingest_parquet_files",
            "Number of parquet files in the ingester pending upload to object store.".to_owned()
                + HELP_SUFFIX,
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
            "Ingestor WAL write bytes.".to_owned() + HELP_SUFFIX,
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
            "Ingestor WAL read bytes.".to_owned() + HELP_SUFFIX,
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

pub static INGEST_MEMTABLE_LOCK_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new("ingest_memtable_lock_time", "ingest memtable lock time")
            .namespace(NAMESPACE)
            .buckets(vec![
                0.2, 0.5, 1.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0,
            ])
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static INGEST_WAL_LOCK_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new("ingest_wal_lock_time", "ingest wal lock time")
            .namespace(NAMESPACE)
            .buckets(vec![
                0.2, 0.5, 1.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0,
            ])
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

// pattern extraction timing metrics (enterprise feature)
pub static PATTERN_EXTRACTION_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "pattern_extraction_time_seconds",
            "Pattern extraction time in seconds",
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0,
        ])
        .const_labels(create_const_labels()),
        &["organization", "phase"], // phase: read_parquet, extraction, ingestion, total
    )
    .expect("Metric created")
});

// service discovery metrics (enterprise feature)
pub static SERVICE_STREAMS_SERVICES_DISCOVERED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "service_streams_services_discovered_total",
            "Total number of services discovered",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_PROCESSING_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "service_streams_processing_time_seconds",
            "Service discovery processing time in seconds",
        )
        .namespace(NAMESPACE)
        .buckets(vec![0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0])
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_HIGH_CARDINALITY_BLOCKED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "service_streams_high_cardinality_blocked_total",
            "Total number of high-cardinality dimensions blocked",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "dimension"],
    )
    .expect("Metric created")
});

// NOTE: SERVICE_STREAMS_DIMENSION_CARDINALITY was removed because using dimension_name
// as a label creates unbounded metric cardinality (500+ dimensions × 1000 orgs = OOM).
// Use SERVICE_STREAMS_CACHE_ENTRIES with cache_type="dimensions" for aggregate stats.

pub static SERVICE_STREAMS_HIGH_CARDINALITY_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "service_streams_high_cardinality_total",
            "Count of high cardinality dimension detections (aggregate per org)",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"], // No dimension label - would cause unbounded cardinality
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_RECORDS_DROPPED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "service_streams_records_dropped",
            "Count of records dropped due to backpressure in service streams processing",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
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
            "Querier memory cache used bytes.".to_owned() + HELP_SUFFIX,
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
            "Querier memory cached files.".to_owned() + HELP_SUFFIX,
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
            "Querier diskcache used bytes.".to_owned() + HELP_SUFFIX,
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
            "Querier disk cached files.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

// querier disk result cache stats
pub static QUERY_DISK_RESULT_CACHE_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_disk_result_cache_used_bytes",
            "Querier disk result cache used bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "cache_type"],
    )
    .expect("Metric created")
});
pub static QUERY_DISK_METRICS_CACHE_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_disk_metrics_cache_used_bytes",
            "Querier disk metrics result cached bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

// query cache ratio for parquet files
pub static QUERY_PARQUET_CACHE_RATIO: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "query_parquet_cache_ratio",
            "Querier parquet cache ratio.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.01, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0,
        ])
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static QUERY_PARQUET_CACHE_RATIO_NODE: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "query_parquet_cache_ratio_node",
            "Querier parquet cache ratio for local node.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.01, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0,
        ])
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

// query cache ratio for metrics
pub static QUERY_METRICS_CACHE_RATIO: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "query_metrics_cache_ratio",
            "Querier metrics cache ratio.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.01, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0,
        ])
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

// query parquet metadata cache stats
pub static QUERY_PARQUET_METADATA_CACHE_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_parquet_metadata_cache_files",
            "Querier parquet metadata cache files.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static QUERY_PARQUET_METADATA_CACHE_USED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_parquet_metadata_cache_used_bytes",
            "Querier parquet metadata cache used bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// compactor stats
pub static COMPACT_USED_TIME: Lazy<CounterVec> = Lazy::new(|| {
    CounterVec::new(
        Opts::new(
            "compact_used_time",
            "Compactor used time.".to_owned() + HELP_SUFFIX,
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
            "Compactor merged files.".to_owned() + HELP_SUFFIX,
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
            "Compactor merged bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static COMPACT_PENDING_JOBS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "compact_pending_jobs",
            "Compactor pending jobs count. Please include 'organization and 'stream type' labels for this metric.".to_owned(),
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

// stream stats aggregation metrics
pub static STREAM_STATS_SCAN_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "stream_stats_scan_duration_seconds",
            "Stream stats aggregation task duration in seconds.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels())
        .buckets(vec![0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0]),
        &["organization", "stream_type", "scan_type"],
    )
    .expect("Metric created")
});

pub static STREAM_STATS_SCAN_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "stream_stats_scan_total",
            "Total number of stream stats aggregation tasks executed.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "scan_type"],
    )
    .expect("Metric created")
});

pub static STREAM_STATS_SCAN_ERRORS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "stream_stats_scan_errors_total",
            "Total number of stream stats aggregation task failures.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "scan_type"],
    )
    .expect("Metric created")
});

pub static STREAM_STATS_STREAMS_TOTAL: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "stream_stats_streams_total",
            "Total number of streams being tracked.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static STREAM_STATS_LAST_SCAN_TIMESTAMP: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "stream_stats_last_scan_timestamp",
            "Unix timestamp in microseconds of the last completed aggregation scan.".to_owned()
                + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// TODO deletion / archiving stats

// storage stats
pub static STORAGE_ORIGINAL_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "storage_original_bytes",
            "Storage original bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_COMPRESSED_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "storage_compressed_bytes",
            "Storage compressed bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("storage_files", "Storage files.".to_owned() + HELP_SUFFIX)
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_RECORDS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "storage_records",
            "Storage records.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_WRITE_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_write_requests",
            "Storage write requests.".to_owned() + HELP_SUFFIX,
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
            "Storage write bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "storage_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_READ_REQUESTS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_read_requests",
            "Storage read requests.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "method_type", "storage_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_READ_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "storage_read_bytes",
            "Storage read bytes.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "method_type", "storage_type"],
    )
    .expect("Metric created")
});
pub static STORAGE_TIME: Lazy<CounterVec> = Lazy::new(|| {
    CounterVec::new(
        Opts::new(
            "storage_time",
            "Storage response time.".to_owned() + HELP_SUFFIX,
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
            "Metadata function nums.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "function_type"],
    )
    .expect("Metric created")
});
pub static META_NUM_ALERTS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "meta_num_alerts",
            "Metadata alert nums.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type"],
    )
    .expect("Metric created")
});

// Alert deduplication metrics
pub static ALERT_DEDUP_SUPPRESSED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "alert_dedup_suppressed_total",
            "Total number of alerts suppressed by deduplication",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "alert_name", "dedup_type"],
    )
    .expect("Metric created")
});

pub static ALERT_DEDUP_PASSED_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "alert_dedup_passed_total",
            "Total number of alerts that passed deduplication",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "alert_name"],
    )
    .expect("Metric created")
});

pub static ALERT_DEDUP_ERRORS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "alert_dedup_errors_total",
            "Total deduplication processing errors",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "error_type"],
    )
    .expect("Metric created")
});

// Alert grouping/batching metrics
pub static ALERT_GROUPING_BATCHES_PENDING: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "alert_grouping_batches_pending",
            "Current number of pending alert batches",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static ALERT_GROUPING_NOTIFICATIONS_SENT_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "alert_grouping_notifications_sent_total",
            "Total number of grouped notifications sent",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "send_strategy", "reason"],
    )
    .expect("Metric created")
});

pub static ALERT_GROUPING_BATCH_SIZE: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "alert_grouping_batch_size",
            "Number of alerts per grouped notification",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels())
        .buckets(vec![1.0, 2.0, 3.0, 5.0, 10.0, 25.0, 50.0, 100.0]),
        &["organization", "send_strategy"],
    )
    .expect("Metric created")
});

pub static ALERT_GROUPING_WAIT_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "alert_grouping_wait_time_seconds",
            "Time batches waited before sending (seconds)",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels())
        .buckets(vec![5.0, 10.0, 15.0, 20.0, 30.0, 45.0, 60.0, 90.0, 120.0]),
        &["organization"],
    )
    .expect("Metric created")
});

pub static ALERT_GROUPING_SEND_ERRORS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "alert_grouping_send_errors_total",
            "Total grouped notification send failures",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "error_type"],
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

// metrics for query manager
pub static QUERY_RUNNING_NUMS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("query_running_nums", "Running query numbers")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});
pub static QUERY_PENDING_NUMS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("query_pending_nums", "Pending query numbers")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});
pub static QUERY_TIMEOUT_NUMS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new("query_timeout_nums", "Timeout query numbers")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});
pub static QUERY_CANCELED_NUMS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new("query_canceled_nums", "Cancel query numbers")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

// This corresponds to mysql or pgsql queries, not sqlite as that is local and can be ignored
pub static DB_QUERY_NUMS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new("db_query_nums", "db query number")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["operation", "table"],
    )
    .expect("Metric created")
});

pub static DB_QUERY_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new("db_query_time", "db query time.".to_owned())
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["operation", "table"],
    )
    .expect("Metric created")
});

pub static FILE_LIST_ID_SELECT_COUNT: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "file_list_id_select_count",
            "total number of ids returned by file list query",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static FILE_LIST_CACHE_HIT_COUNT: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "file_list_cache_hit_count",
            "number of ids returned from file list cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// Node status metrics
pub static NODE_UP: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_up", "Node is up")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["version"],
    )
    .expect("Metric created")
});
pub static NODE_CPU_TOTAL: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_cpu_total", "Total CPU usage")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static NODE_CPU_USAGE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_cpu_usage", "CPU usage")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static NODE_MEMORY_TOTAL: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_memory_total", "Total memory usage")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static NODE_MEMORY_USAGE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_memory_usage", "Memory usage")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static NODE_DISK_TOTAL: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_disk_total", "Total disk space")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static NODE_DISK_USAGE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_disk_usage", "Disk usage")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});
pub static NODE_TCP_CONNECTIONS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_tcp_connections", "TCP connections")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["state"],
    )
    .expect("Metric created")
});
pub static NODE_CONSISTENT_HASH: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("node_consistent_hash", "Consistent hash")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["type"],
    )
    .expect("Metric created")
});

// query disk cache metrics
pub static QUERY_DISK_CACHE_HIT_COUNT: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "query_disk_cache_hit_count",
            "query disk cache hit count".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "file_type"],
    )
    .expect("Metric created")
});
pub static QUERY_DISK_CACHE_MISS_COUNT: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "query_disk_cache_miss_count",
            "query disk cache miss count".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "stream_type", "file_type"],
    )
    .expect("Metric created")
});

// file downloader metrics
pub static FILE_DOWNLOADER_NORMAL_QUEUE_SIZE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "file_downloader_normal_queue_size",
            "file downloader normal queue size",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "file_downloader_priority_queue_size",
            "file downloader priority queue size",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// File access time bucket histogram
pub static FILE_ACCESS_TIME: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "file_access_time",
            "Histogram showing query counts within time windows from 1h to 1week (1h, 2h, 3h, 6h, 12h, 24h, 48h, 96h, 168h)"
        )
        .namespace(NAMESPACE)
        .buckets(vec![1.0, 2.0, 3.0, 6.0, 12.0, 24.0, 48.0, 96.0, 168.0])
        .const_labels(create_const_labels()),
        &["stream_type"],
    )
    .expect("Metric created")
});

// Metrics for pipeline wal writer
pub static PIPELINE_WAL_WRITER_DESTINATIONS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "pipeline_wal_writer_destinations",
            "Total number of pipeline wal writer destinations",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static PIPELINE_WAL_WRITERS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "pipeline_wal_writers",
            "Total number of wal writer across all pipelines",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static PIPELINE_WAL_FILES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "pipeline_wal_files",
            "Total number of wal files across all pipelines",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static PIPELINE_WAL_INGESTION_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "pipeline_wal_ingestion_bytes",
            "Bytes ingested per pipeline",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["pipeline_id"],
    )
    .expect("Metric created")
});

pub static PIPELINE_EXPORTED_BYTES: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "pipeline_http_exported_bytes",
            "Bytes exported per destination",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["destination"],
    )
    .expect("Metric created")
});

pub static QUERY_AGGREGATION_CACHE_ITEMS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_aggregation_cache_items",
            "Total number of aggregation cache items",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// metrics for tantivy result cache
pub static TANTIVY_RESULT_CACHE_MEMORY_USAGE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "tantivy_result_cache_memory_usage",
            "Total memory usage (bytes) of tantivy result cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static TANTIVY_RESULT_CACHE_GC_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "tantivy_result_cache_gc_total",
            "Total number of GC of tantivy result cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static TANTIVY_RESULT_CACHE_REQUESTS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "tantivy_result_cache_requests_total",
            "Total number of search of tantivy result cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static TANTIVY_RESULT_CACHE_HITS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "tantivy_result_cache_hits_total",
            "Total number of hit of tantivy result cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static QUERY_AGGREGATION_CACHE_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "query_aggregation_cache_bytes",
            "Total number of aggregation cache bytes",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

// Tokio runtime metrics - consolidated into fewer metrics with different labels
pub static TOKIO_RUNTIME_TASKS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new("tokio_runtime_tasks", "Tokio runtime task statistics")
            .namespace(NAMESPACE)
            .const_labels(create_const_labels()),
        &["runtime", "metric_type"],
    )
    .expect("Metric created")
});

pub static TOKIO_RUNTIME_TASKS_TOTAL: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "tokio_runtime_tasks_total",
            "Total tokio runtime task counters",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["runtime", "metric_type"],
    )
    .expect("Metric created")
});

pub static TOKIO_RUNTIME_WORKER_METRICS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "tokio_runtime_worker_metrics_total",
            "Tokio runtime worker metrics",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["runtime", "worker", "metric_type"],
    )
    .expect("Metric created")
});

pub static TOKIO_RUNTIME_WORKER_DURATION_SECONDS: Lazy<CounterVec> = Lazy::new(|| {
    CounterVec::new(
        Opts::new(
            "tokio_runtime_worker_duration_seconds_total",
            "Tokio runtime worker duration metrics in seconds",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["runtime", "worker"],
    )
    .expect("Metric created")
});

pub static TOKIO_RUNTIME_WORKER_POLL_TIME_SECONDS: Lazy<HistogramVec> = Lazy::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "tokio_runtime_worker_poll_time_seconds",
            "Tokio runtime worker poll time distribution in seconds",
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.000001, 0.000005, 0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1,
            0.5, 1.0,
        ])
        .const_labels(create_const_labels()),
        &["runtime", "worker"],
    )
    .expect("Metric created")
});

// self-reporting metrics
pub static SELF_REPORTING_DROPPED_TRIGGERS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "self_reporting_dropped_triggers_total",
            "Total number of trigger usage events dropped due to full queue",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static SELF_REPORTING_TIMEOUT_ERRORS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "self_reporting_timeout_errors_total",
            "Total number of error data publish timeouts",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static SELF_REPORTING_QUEUE_DEPTH: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "self_reporting_queue_depth",
            "Current depth of self-reporting queues (pending items waiting to be processed)",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["queue_type"], // "usage" or "error"
    )
    .expect("Metric created")
});

// service streams cache stats
pub static SERVICE_STREAMS_CACHE_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "service_streams_cache_bytes",
            "Service streams cache memory usage in bytes by organization",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "cache_type"], // cache_type: "services" or "dimensions"
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_CACHE_ENTRIES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "service_streams_cache_entries",
            "Number of entries in service streams cache by organization",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "cache_type"], // cache_type: "services" or "dimensions"
    )
    .expect("Metric created")
});

// Pattern learner metrics (for OOM debugging)
pub static SERVICE_STREAMS_PATTERN_LEARNER_ORGS: Lazy<IntGauge> = Lazy::new(|| {
    IntGauge::with_opts(
        Opts::new(
            "service_streams_pattern_learner_orgs",
            "Number of organizations with active pattern learners",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_PATTERN_LEARNER_FIELDS: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "service_streams_pattern_learner_fields",
            "Number of fields tracked by pattern learner",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_PATTERN_LEARNER_VALUES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "service_streams_pattern_learner_values",
            "Total unique values tracked by pattern learner",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_PATTERN_LEARNER_BYTES: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "service_streams_pattern_learner_bytes",
            "Estimated memory usage of pattern learner in bytes",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

// Service queue metrics
pub static SERVICE_STREAMS_QUEUE_SIZE: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "service_streams_queue_size",
            "Number of services queued for batch processing",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_QUEUE_ORGS: Lazy<IntGauge> = Lazy::new(|| {
    IntGauge::with_opts(
        Opts::new(
            "service_streams_queue_orgs",
            "Number of organizations with queued services",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_QUEUE_TOTAL: Lazy<IntGauge> = Lazy::new(|| {
    IntGauge::with_opts(
        Opts::new(
            "service_streams_queue_total",
            "Total number of services queued across all organizations",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_QUEUE_DROPPED: Lazy<IntGauge> = Lazy::new(|| {
    IntGauge::with_opts(
        Opts::new(
            "service_streams_queue_dropped",
            "Total services dropped due to queue limits",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
    )
    .expect("Metric created")
});

// Cleanup metrics
pub static SERVICE_STREAMS_CLEANUP_RUNS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "service_streams_cleanup_runs_total",
            "Number of cleanup runs by type",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["cleanup_type"], // "cache", "pattern_learner", "dimension_tracker"
    )
    .expect("Metric created")
});

pub static SERVICE_STREAMS_CLEANUP_REMOVED: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "service_streams_cleanup_removed_total",
            "Number of items removed during cleanup",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["cleanup_type"],
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
        .register(Box::new(INGEST_ERRORS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_WAL_USED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_PARQUET_FILES.clone()))
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
    registry
        .register(Box::new(INGEST_MEMTABLE_LOCK_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INGEST_WAL_LOCK_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(PATTERN_EXTRACTION_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_SERVICES_DISCOVERED.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_PROCESSING_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_HIGH_CARDINALITY_BLOCKED.clone()))
        .expect("Metric registered");
    // SERVICE_STREAMS_DIMENSION_CARDINALITY removed - unbounded labels cause OOM
    registry
        .register(Box::new(SERVICE_STREAMS_HIGH_CARDINALITY_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_RECORDS_DROPPED.clone()))
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
    registry
        .register(Box::new(QUERY_DISK_RESULT_CACHE_USED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_DISK_METRICS_CACHE_USED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_PARQUET_CACHE_RATIO.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_PARQUET_CACHE_RATIO_NODE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_METRICS_CACHE_RATIO.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_PARQUET_METADATA_CACHE_FILES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_PARQUET_METADATA_CACHE_USED_BYTES.clone()))
        .expect("Metric registered");

    // query manager
    registry
        .register(Box::new(QUERY_RUNNING_NUMS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_PENDING_NUMS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_TIMEOUT_NUMS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_CANCELED_NUMS.clone()))
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
        .register(Box::new(COMPACT_PENDING_JOBS.clone()))
        .expect("Metric registered");

    // stream stats aggregation metrics
    registry
        .register(Box::new(STREAM_STATS_SCAN_DURATION.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STREAM_STATS_SCAN_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STREAM_STATS_SCAN_ERRORS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STREAM_STATS_STREAMS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(STREAM_STATS_LAST_SCAN_TIMESTAMP.clone()))
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

    // alert deduplication metrics
    registry
        .register(Box::new(ALERT_DEDUP_SUPPRESSED_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ALERT_DEDUP_PASSED_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ALERT_DEDUP_ERRORS_TOTAL.clone()))
        .expect("Metric registered");

    // alert grouping metrics
    registry
        .register(Box::new(ALERT_GROUPING_BATCHES_PENDING.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ALERT_GROUPING_NOTIFICATIONS_SENT_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ALERT_GROUPING_BATCH_SIZE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ALERT_GROUPING_WAIT_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(ALERT_GROUPING_SEND_ERRORS_TOTAL.clone()))
        .expect("Metric registered");

    // db stats
    registry
        .register(Box::new(DB_QUERY_NUMS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(DB_QUERY_TIME.clone()))
        .expect("Metric registered");

    // file list specific metrics
    registry
        .register(Box::new(FILE_LIST_ID_SELECT_COUNT.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(FILE_LIST_CACHE_HIT_COUNT.clone()))
        .expect("Metric registered");

    // node status metrics
    registry
        .register(Box::new(NODE_UP.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_CPU_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_CPU_USAGE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_MEMORY_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_MEMORY_USAGE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_DISK_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_DISK_USAGE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_TCP_CONNECTIONS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(NODE_CONSISTENT_HASH.clone()))
        .expect("Metric registered");

    // query disk cache metrics
    registry
        .register(Box::new(QUERY_DISK_CACHE_HIT_COUNT.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_DISK_CACHE_MISS_COUNT.clone()))
        .expect("Metric registered");
    // file downloader metrics
    registry
        .register(Box::new(FILE_DOWNLOADER_NORMAL_QUEUE_SIZE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(FILE_ACCESS_TIME.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(PIPELINE_WAL_WRITER_DESTINATIONS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(PIPELINE_WAL_WRITERS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(PIPELINE_WAL_FILES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(PIPELINE_WAL_INGESTION_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(PIPELINE_EXPORTED_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_AGGREGATION_CACHE_ITEMS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(QUERY_AGGREGATION_CACHE_BYTES.clone()))
        .expect("Metric registered");

    // metrics for tantivy result cache
    registry
        .register(Box::new(TANTIVY_RESULT_CACHE_MEMORY_USAGE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TANTIVY_RESULT_CACHE_GC_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TANTIVY_RESULT_CACHE_REQUESTS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TANTIVY_RESULT_CACHE_HITS_TOTAL.clone()))
        .expect("Metric registered");

    // tokio runtime metrics
    registry
        .register(Box::new(TOKIO_RUNTIME_TASKS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TOKIO_RUNTIME_TASKS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TOKIO_RUNTIME_WORKER_METRICS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TOKIO_RUNTIME_WORKER_DURATION_SECONDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(TOKIO_RUNTIME_WORKER_POLL_TIME_SECONDS.clone()))
        .expect("Metric registered");

    // self-reporting metrics
    registry
        .register(Box::new(SELF_REPORTING_DROPPED_TRIGGERS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SELF_REPORTING_TIMEOUT_ERRORS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SELF_REPORTING_QUEUE_DEPTH.clone()))
        .expect("Metric registered");

    // service streams cache
    registry
        .register(Box::new(SERVICE_STREAMS_CACHE_BYTES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_CACHE_ENTRIES.clone()))
        .expect("Metric registered");

    // service streams pattern learner (OOM debugging)
    registry
        .register(Box::new(SERVICE_STREAMS_PATTERN_LEARNER_ORGS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_PATTERN_LEARNER_FIELDS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_PATTERN_LEARNER_VALUES.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_PATTERN_LEARNER_BYTES.clone()))
        .expect("Metric registered");

    // service streams queue
    registry
        .register(Box::new(SERVICE_STREAMS_QUEUE_SIZE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_QUEUE_ORGS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_QUEUE_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_QUEUE_DROPPED.clone()))
        .expect("Metric registered");

    // service streams cleanup
    registry
        .register(Box::new(SERVICE_STREAMS_CLEANUP_RUNS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(SERVICE_STREAMS_CLEANUP_REMOVED.clone()))
        .expect("Metric registered");
}

pub fn create_const_labels() -> HashMap<String, String> {
    let cfg = crate::config::get_config();
    let mut labels = HashMap::new();
    labels.insert("cluster".to_string(), cfg.common.cluster_name.clone());
    labels.insert("instance".to_string(), cfg.common.instance_name.clone());
    labels.insert("role".to_string(), cfg.common.node_role.clone());
    labels
}

pub fn gather() -> String {
    let registry = prometheus::default_registry();
    let mut buffer = vec![];
    TextEncoder::new()
        .encode(&registry.gather(), &mut buffer)
        .unwrap();
    String::from_utf8(buffer).unwrap()
}

pub fn init() {
    register_metrics(prometheus::default_registry());
}
