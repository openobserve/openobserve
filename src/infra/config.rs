// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use dashmap::{DashMap, DashSet};
use datafusion::arrow::datatypes::Schema;
use dotenv_config::EnvConfig;
use dotenvy::dotenv;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use reqwest::Client;
use std::{sync::Arc, time::Duration};
use sys_info::hostname;
use vector_enrichment::TableRegistry;

use crate::common::file::get_file_meta;
use crate::meta::alert::{AlertDestination, AlertList, DestinationTemplate, Trigger, TriggerTimer};
use crate::meta::functions::{StreamFunctionsList, Transform};
use crate::meta::prom::ClusterLeader;
use crate::meta::syslog::SyslogRoute;
use crate::meta::user::User;
use crate::service::enrichment::StreamTable;

pub type RwHashMap<K, V> = DashMap<K, V, ahash::RandomState>;
pub type RwHashSet<K> = DashSet<K, ahash::RandomState>;

pub static VERSION: &str = env!("GIT_VERSION");
pub static COMMIT_HASH: &str = env!("GIT_COMMIT_HASH");
pub static BUILD_DATE: &str = env!("GIT_BUILD_DATE");
pub static HAS_FUNCTIONS: bool = true;
pub static FILE_EXT_JSON: &str = ".json";
pub static FILE_EXT_PARQUET: &str = ".parquet";

pub static CONFIG: Lazy<Config> = Lazy::new(init);
pub static INSTANCE_ID: Lazy<RwHashMap<String, String>> = Lazy::new(DashMap::default);

pub static TELEMETRY_CLIENT: Lazy<segment::HttpClient> = Lazy::new(|| {
    segment::HttpClient::new(
        Client::builder()
            .connect_timeout(Duration::new(10, 0))
            .build()
            .unwrap(),
        CONFIG.common.telemetry_url.clone(),
    )
});

// global cache variables
pub static KVS: Lazy<RwHashMap<String, bytes::Bytes>> = Lazy::new(DashMap::default);
pub static STREAM_SCHEMAS: Lazy<RwHashMap<String, Vec<Schema>>> = Lazy::new(DashMap::default);
pub static STREAM_FUNCTIONS: Lazy<RwHashMap<String, StreamFunctionsList>> =
    Lazy::new(DashMap::default);
pub static QUERY_FUNCTIONS: Lazy<RwHashMap<String, Transform>> = Lazy::new(DashMap::default);
pub static USERS: Lazy<RwHashMap<String, User>> = Lazy::new(DashMap::default);
pub static ROOT_USER: Lazy<RwHashMap<String, User>> = Lazy::new(DashMap::default);
pub static PASSWORD_HASH: Lazy<RwHashMap<String, String>> = Lazy::new(DashMap::default);
pub static METRIC_CLUSTER_MAP: Lazy<RwHashMap<String, Vec<String>>> = Lazy::new(DashMap::default);
pub static METRIC_CLUSTER_LEADER: Lazy<RwHashMap<String, ClusterLeader>> =
    Lazy::new(DashMap::default);
pub static STREAM_ALERTS: Lazy<RwHashMap<String, AlertList>> = Lazy::new(DashMap::default);
pub static TRIGGERS: Lazy<RwHashMap<String, Trigger>> = Lazy::new(DashMap::default);
pub static TRIGGERS_IN_PROCESS: Lazy<RwHashMap<String, TriggerTimer>> = Lazy::new(DashMap::default);
pub static ALERTS_TEMPLATES: Lazy<RwHashMap<String, DestinationTemplate>> =
    Lazy::new(DashMap::default);
pub static ALERTS_DESTINATIONS: Lazy<RwHashMap<String, AlertDestination>> =
    Lazy::new(DashMap::default);
pub static SYSLOG_ROUTES: Lazy<RwHashMap<String, SyslogRoute>> = Lazy::new(DashMap::default);
pub static SYSLOG_ENABLED: Lazy<Arc<RwLock<bool>>> = Lazy::new(|| Arc::new(RwLock::new(false)));
pub static ENRICHMENT_TABLES: Lazy<RwHashMap<String, StreamTable>> = Lazy::new(DashMap::default);
pub static ENRICHMENT_REGISTRY: Lazy<Arc<TableRegistry>> =
    Lazy::new(|| Arc::new(TableRegistry::default()));

#[derive(EnvConfig)]
pub struct Config {
    pub auth: Auth,
    pub http: Http,
    pub grpc: Grpc,
    pub route: Route,
    pub common: Common,
    pub limit: Limit,
    pub compact: Compact,
    pub memory_cache: MemoryCache,
    pub log: Log,
    pub etcd: Etcd,
    pub sled: Sled,
    pub s3: S3,
    pub tcp: TCP,
    pub prom: Prometheus,
    pub profiling: Pyroscope,
}

#[derive(EnvConfig)]
pub struct Pyroscope {
    #[env_config(
        name = "ZO_PROF_PYROSCOPE_SERVER_URL",
        default = "http://localhost:4040"
    )]
    pub pyroscope_server_url: String,
    #[env_config(name = "ZO_PROF_PYROSCOPE_PROJECT_NAME", default = "openobserve")]
    pub pyroscope_project_name: String,
}

#[derive(EnvConfig)]
pub struct Auth {
    #[env_config(name = "ZO_ROOT_USER_EMAIL")]
    pub root_user_email: String,
    #[env_config(name = "ZO_ROOT_USER_PASSWORD")]
    pub root_user_password: String,
}

#[derive(EnvConfig)]
pub struct Http {
    #[env_config(name = "ZO_HTTP_PORT", default = 5080)]
    pub port: u16,
}

#[derive(EnvConfig)]
pub struct Grpc {
    #[env_config(name = "ZO_GRPC_PORT", default = 5081)]
    pub port: u16,
    #[env_config(name = "ZO_GRPC_TIMEOUT", default = 600)]
    pub timeout: u64,
    #[env_config(name = "ZO_GRPC_ORG_HEADER_KEY", default = "zinc-org-id")]
    pub org_header_key: String,
    #[env_config(name = "ZO_INTERNAL_GRPC_TOKEN", default = "")]
    pub internal_grpc_token: String,
}

#[derive(EnvConfig)]
pub struct TCP {
    #[env_config(name = "ZO_TCP_PORT", default = 5514)]
    pub tcp_port: u16,
    #[env_config(name = "ZO_UDP_PORT", default = 5514)]
    pub udp_port: u16,
}

#[derive(EnvConfig)]
pub struct Route {
    #[env_config(name = "ZO_ROUTE_TIMEOUT", default = 600)]
    pub timeout: u64,
}

#[derive(EnvConfig)]
pub struct Common {
    #[env_config(name = "ZO_LOCAL_MODE", default = true)]
    pub local_mode: bool,
    // ZO_LOCAL_MODE_STORAGE is ignored when ZO_LOCAL_MODE is set to false
    #[env_config(name = "ZO_LOCAL_MODE_STORAGE", default = "disk")]
    pub local_mode_storage: String,
    #[env_config(name = "ZO_NODE_ROLE", default = "all")]
    pub node_role: String,
    #[env_config(name = "ZO_CLUSTER_NAME", default = "zo1")]
    pub cluster_name: String,
    #[env_config(name = "ZO_INSTANCE_NAME", default = "")]
    pub instance_name: String,
    #[env_config(name = "ZO_DATA_DIR", default = "./data/openobserve/")]
    pub data_dir: String,
    #[env_config(name = "ZO_DATA_WAL_DIR", default = "")] // ./data/openobserve/wal/
    pub data_wal_dir: String,
    #[env_config(name = "ZO_DATA_STREAM_DIR", default = "")] // ./data/openobserve/stream/
    pub data_stream_dir: String,
    #[env_config(name = "ZO_BASE_URI", default = "")]
    pub base_uri: String,
    #[env_config(name = "ZO_WAL_MEMORY_MODE_ENABLED", default = false)]
    pub wal_memory_mode_enabled: bool,
    #[env_config(name = "ZO_WAL_LINE_MODE_ENABLED", default = true)]
    pub wal_line_mode_enabled: bool,
    #[env_config(name = "ZO_PARQUET_COMPRESSION", default = "zstd")]
    pub parquet_compression: String,
    #[env_config(name = "ZO_COLUMN_TIMESTAMP", default = "_timestamp")]
    pub column_timestamp: String,
    #[env_config(name = "ZO_WIDENING_SCHEMA_EVOLUTION", default = false)]
    pub widening_schema_evolution: bool,
    #[env_config(name = "ZO_SKIP_SCHEMA_VALIDATION", default = false)]
    pub skip_schema_validation: bool,
    #[env_config(name = "ZO_FEATURE_PER_THREAD_LOCK", default = false)]
    pub feature_per_thread_lock: bool,
    #[env_config(name = "ZO_FEATURE_FULLTEXT_ON_ALL_FIELDS", default = false)]
    pub feature_fulltext_on_all_fields: bool,
    #[env_config(name = "ZO_UI_ENABLED", default = true)]
    pub ui_enabled: bool,
    #[env_config(name = "ZO_UI_SQL_BASE64_ENABLED", default = false)]
    pub ui_sql_base64_enabled: bool,
    #[env_config(name = "ZO_METRICS_DEDUP_ENABLED", default = true)]
    pub metrics_dedup_enabled: bool,
    #[env_config(name = "ZO_TRACING_ENABLED", default = false)]
    pub tracing_enabled: bool,
    #[env_config(name = "OTEL_OTLP_HTTP_ENDPOINT", default = "")]
    pub otel_otlp_url: String,
    #[env_config(name = "ZO_TRACING_HEADER_KEY", default = "Authorization")]
    pub tracing_header_key: String,
    #[env_config(
        name = "ZO_TRACING_HEADER_VALUE",
        default = "Basic YWRtaW46Q29tcGxleHBhc3MjMTIz"
    )]
    pub tracing_header_value: String,
    #[env_config(name = "ZO_TELEMETRY", default = true)]
    pub telemetry_enabled: bool,
    #[env_config(name = "ZO_TELEMETRY_URL", default = "https://e1.zinclabs.dev")]
    pub telemetry_url: String,
    #[env_config(name = "ZO_PROMETHEUS_ENABLED", default = true)]
    pub prometheus_enabled: bool,
    #[env_config(name = "ZO_PRINT_KEY_CONFIG", default = false)]
    pub print_key_config: bool,
    #[env_config(name = "USAGE_REPORTING_ENABLED", default = false)]
    pub usage_enabled: bool,
    #[env_config(name = "USAGE_ENDPOINT", default = "")]
    pub usage_url: String,
    #[env_config(name = "USAGE_AUTH", default = "")]
    pub usage_auth: String,
    #[env_config(name = "USAGE_BATCH_SIZE", default = 5)]
    pub usage_batch_size: usize,
}

#[derive(EnvConfig)]
pub struct Limit {
    #[env_config(name = "ZO_JSON_LIMIT", default = 209715200)]
    pub req_json_limit: usize,
    #[env_config(name = "ZO_PAYLOAD_LIMIT", default = 209715200)]
    pub req_payload_limit: usize,
    #[env_config(name = "ZO_MAX_FILE_SIZE_ON_DISK", default = 32)] // MB
    pub max_file_size_on_disk: u64,
    #[env_config(name = "ZO_MAX_FILE_RETENTION_TIME", default = 600)] // seconds
    pub max_file_retention_time: u64,
    #[env_config(name = "ZO_FILE_PUSH_INTERVAL", default = 10)] // seconds
    pub file_push_interval: u64,
    #[env_config(name = "ZO_FILE_MOVE_THREAD_NUM", default = 0)]
    pub file_move_thread_num: usize,
    #[env_config(name = "ZO_QUERY_THREAD_NUM", default = 0)]
    pub query_thread_num: usize,
    #[env_config(name = "ZO_INGEST_ALLOWED_UPTO", default = 5)] // in hours - in past
    pub ingest_allowed_upto: i64,
    #[env_config(name = "ZO_METRICS_LEADER_PUSH_INTERVAL", default = 15)]
    pub metrics_leader_push_interval: u64,
    #[env_config(name = "ZO_METRICS_LEADER_ELECTION_INTERVAL", default = 30)]
    pub metrics_leader_election_interval: i64,
    #[env_config(name = "ZO_HEARTBEAT_INTERVAL", default = 30)] // in minutes
    pub hb_interval: i64,
    // no need set by environment
    pub cpu_num: usize,
    #[env_config(name = "ZO_COLS_PER_RECORD_LIMIT")]
    pub req_cols_per_record_limit: usize,
    #[env_config(name = "ZO_HTTP_WORKER_NUM", default = 0)] // equals to cpu_num if 0
    pub http_worker_num: usize,
}

#[derive(EnvConfig)]
pub struct Compact {
    #[env_config(name = "ZO_COMPACT_ENABLED", default = true)]
    pub enabled: bool,
    #[env_config(name = "ZO_COMPACT_FAKE_MODE", default = false)]
    // this mode will skip merge file, just print the log
    pub fake_mode: bool,
    #[env_config(name = "ZO_COMPACT_INTERVAL", default = 60)] // seconds
    pub interval: u64,
    #[env_config(name = "ZO_COMPACT_MAX_FILE_SIZE", default = 256)] // MB
    pub max_file_size: u64,
    #[env_config(name = "ZO_COMPACT_DATA_RETENTION_DAYS", default = 3650)] // in days
    pub data_retention_days: i64,
    #[env_config(name = "ZO_COMPACT_BLOCKED_ORGS", default = "")] // use comma to split
    pub blocked_orgs: String,
}

#[derive(EnvConfig)]
pub struct MemoryCache {
    #[env_config(name = "ZO_MEMORY_CACHE_ENABLED", default = true)]
    pub enabled: bool,
    #[env_config(name = "ZO_MEMORY_CACHE_CACHE_LATEST_FILES", default = false)]
    pub cache_latest_files: bool,
    // MB, default is 50% of system memory
    #[env_config(name = "ZO_MEMORY_CACHE_MAX_SIZE", default = 0)]
    pub max_size: usize,
    // MB, will skip the cache when a query need cache great than this value, default is 80% of max_size
    #[env_config(name = "ZO_MEMORY_CACHE_SKIP_SIZE", default = 0)]
    pub skip_size: usize,
    // MB, when cache is full will release how many data once time, default is 1% of max_size
    #[env_config(name = "ZO_MEMORY_CACHE_RELEASE_SIZE", default = 0)]
    pub release_size: usize,
}

#[derive(EnvConfig)]
pub struct Log {
    #[env_config(name = "RUST_LOG", default = "info")]
    pub level: String,
    #[env_config(name = "EVENTS_ENABLED", default = false)]
    pub events_enabled: bool,
    #[env_config(
        name = "EVENTS_AUTH",
        default = "cm9vdEBleGFtcGxlLmNvbTpUZ0ZzZFpzTUZQdzg2SzRK"
    )]
    pub events_auth: String,
    #[env_config(
        name = "EVENTS_EP",
        default = "https://api.openobserve.ai/api/debug/events/_json"
    )]
    pub events_url: String,
    #[env_config(name = "EVENTS_BATCH_SIZE", default = 10)]
    pub events_batch_size: usize,
}

#[derive(Debug, EnvConfig)]
pub struct Etcd {
    #[env_config(name = "ZO_ETCD_ADDR", default = "localhost:2379")]
    pub addr: String,
    #[env_config(name = "ZO_ETCD_PREFIX", default = "/zinc/observe/")]
    pub prefix: String,
    #[env_config(name = "ZO_ETCD_CONNECT_TIMEOUT", default = 2)]
    pub connect_timeout: u64,
    #[env_config(name = "ZO_ETCD_COMMAND_TIMEOUT", default = 5)]
    pub command_timeout: u64,
    #[env_config(name = "ZO_ETCD_LOCK_WAIT_TIMEOUT", default = 3600)]
    pub lock_wait_timeout: u64,
    #[env_config(name = "ZO_ETCD_USER", default = "")]
    pub user: String,
    #[env_config(name = "ZO_ETCD_PASSWORD", default = "")]
    pub password: String,
    #[env_config(name = "ZO_ETCD_CLIENT_CERT_AUTH", default = false)]
    pub cert_auth: bool,
    #[env_config(name = "ZO_ETCD_TRUSTED_CA_FILE", default = "")]
    pub ca_file: String,
    #[env_config(name = "ZO_ETCD_CERT_FILE", default = "")]
    pub cert_file: String,
    #[env_config(name = "ZO_ETCD_KEY_FILE", default = "")]
    pub key_file: String,
    #[env_config(name = "ZO_ETCD_DOMAIN_NAME", default = "")]
    pub domain_name: String,
    #[env_config(name = "ZO_ETCD_LOAD_PAGE_SIZE", default = 10000)]
    pub load_page_size: i64,
}

#[derive(EnvConfig)]
pub struct Sled {
    #[env_config(name = "ZO_SLED_DATA_DIR", default = "")] // ./data/openobserve/db/
    pub data_dir: String,
    #[env_config(name = "ZO_SLED_PREFIX", default = "/zinc/observe/")]
    pub prefix: String,
}

#[derive(Debug, EnvConfig)]
pub struct S3 {
    #[env_config(name = "ZO_S3_PROVIDER", default = "")]
    pub provider: String,
    #[env_config(name = "ZO_S3_SERVER_URL", default = "")]
    pub server_url: String,
    #[env_config(name = "ZO_S3_REGION_NAME", default = "")]
    pub region_name: String,
    #[env_config(name = "ZO_S3_ACCESS_KEY", default = "")]
    pub access_key: String,
    #[env_config(name = "ZO_S3_SECRET_KEY", default = "")]
    pub secret_key: String,
    #[env_config(name = "ZO_S3_BUCKET_NAME", default = "")]
    pub bucket_name: String,
    #[env_config(name = "ZO_S3_BUCKET_PREFIX", default = "")]
    pub bucket_prefix: String,
    #[env_config(name = "ZO_S3_CONNECT_TIMEOUT", default = 10)] // seconds
    pub connect_timeout: u64,
    #[env_config(name = "ZO_S3_REQUEST_TIMEOUT", default = 3600)] // seconds
    pub request_timeout: u64,
    #[env_config(name = "ZO_S3_FEATURE_FORCE_PATH_STYLE", default = false)]
    pub feature_force_path_style: bool,
    #[env_config(name = "ZO_S3_ALLOW_INVALID_CERTIFICATES", default = false)]
    pub allow_invalid_certificates: bool,
}

#[derive(Debug, EnvConfig)]
pub struct Prometheus {
    #[env_config(name = "ZO_PROMETHEUS_HA_CLUSTER", default = "cluster")]
    pub ha_cluster_label: String,
    #[env_config(name = "ZO_PROMETHEUS_HA_REPLICA", default = "__replica__")]
    pub ha_replica_label: String,
}

pub fn init() -> Config {
    dotenv().ok();
    let mut cfg = Config::init().unwrap();
    // set cpu num
    let cpu_num = sys_info::cpu_num().unwrap() as usize;
    cfg.limit.cpu_num = cpu_num;
    if cfg.limit.http_worker_num == 0 {
        cfg.limit.http_worker_num = cpu_num;
    }
    // HACK for thread_num equal to CPU core * 4
    if cfg.limit.query_thread_num == 0 {
        cfg.limit.query_thread_num = cpu_num * 4;
    }
    // HACK for move_file_thread_num equal to CPU core
    if cfg.limit.file_move_thread_num == 0 {
        cfg.limit.file_move_thread_num = cpu_num;
    }

    // check common config
    if let Err(e) = check_common_config(&mut cfg) {
        panic!("common config error: {e}");
    }

    // check data path config
    if let Err(e) = check_path_config(&mut cfg) {
        panic!("data path config error: {e}");
    }

    // check memeory cache
    if let Err(e) = check_memory_cache_config(&mut cfg) {
        panic!("memory cache config error: {e}");
    }

    // check etcd config
    if let Err(e) = check_etcd_config(&mut cfg) {
        panic!("etcd config error: {e}");
    }

    // check s3 config
    if let Err(e) = check_s3_config(&mut cfg) {
        panic!("s3 config error: {e}");
    }
    cfg
}

fn check_common_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.limit.file_push_interval == 0 {
        cfg.limit.file_push_interval = 10;
    }
    // check max_file_size_on_disk to MB
    cfg.limit.max_file_size_on_disk *= 1024 * 1024;
    if cfg.limit.req_cols_per_record_limit == 0 {
        cfg.limit.req_cols_per_record_limit = 1000;
    }

    // HACK instance_name
    if cfg.common.instance_name.is_empty() {
        cfg.common.instance_name = hostname().unwrap();
    }

    // HACK for tracing, always disable tracing except ingester and querier
    let local_node_role: Vec<super::cluster::Role> = cfg
        .common
        .node_role
        .clone()
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    if !local_node_role.contains(&super::cluster::Role::All)
        && !local_node_role.contains(&super::cluster::Role::Ingester)
        && !local_node_role.contains(&super::cluster::Role::Querier)
    {
        cfg.common.tracing_enabled = false;
    }

    // format local_mode_storage
    cfg.common.local_mode_storage = cfg.common.local_mode_storage.to_lowercase();

    // check compact_max_file_size to MB
    cfg.compact.max_file_size *= 1024 * 1024;
    if cfg.compact.interval == 0 {
        cfg.compact.interval = 600;
    }
    if cfg.compact.data_retention_days > 0 && cfg.compact.data_retention_days < 3 {
        return Err(anyhow::anyhow!(
            "Data retention is not allowed to be less than 3 days."
        ));
    }

    Ok(())
}

fn check_path_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.common.data_dir.is_empty() {
        cfg.common.data_dir = "./data/openobserve/".to_string();
    }
    if !cfg.common.data_dir.ends_with('/') {
        cfg.common.data_dir = format!("{}/", cfg.common.data_dir);
    }
    if cfg.common.data_wal_dir.is_empty() {
        cfg.common.data_wal_dir = format!("{}wal/", cfg.common.data_dir);
    }
    if !cfg.common.data_wal_dir.ends_with('/') {
        cfg.common.data_wal_dir = format!("{}/", cfg.common.data_wal_dir);
    }
    if cfg.common.data_stream_dir.is_empty() {
        cfg.common.data_stream_dir = format!("{}stream/", cfg.common.data_dir);
    }
    if !cfg.common.data_stream_dir.ends_with('/') {
        cfg.common.data_stream_dir = format!("{}/", cfg.common.data_stream_dir);
    }
    if cfg.common.base_uri.ends_with('/') {
        cfg.common.base_uri = cfg.common.base_uri.trim_end_matches('/').to_string();
    }
    if cfg.sled.data_dir.is_empty() {
        cfg.sled.data_dir = format!("{}db/", cfg.common.data_dir);
    }
    if !cfg.sled.data_dir.ends_with('/') {
        cfg.sled.data_dir = format!("{}/", cfg.sled.data_dir);
    }
    Ok(())
}

fn check_etcd_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if !cfg.etcd.cert_auth {
        return Ok(());
    }
    if let Err(e) = get_file_meta(&cfg.etcd.ca_file) {
        return Err(anyhow::anyhow!("ZO_ETCD_TRUSTED_CA_FILE check err: {}", e));
    }
    if let Err(e) = get_file_meta(&cfg.etcd.cert_file) {
        return Err(anyhow::anyhow!("ZO_ETCD_TRUSTED_CA_FILE check err: {}", e));
    }
    if let Err(e) = get_file_meta(&cfg.etcd.key_file) {
        return Err(anyhow::anyhow!("ZO_ETCD_TRUSTED_CA_FILE check err: {}", e));
    }

    // check domain name
    if cfg.etcd.domain_name.is_empty() {
        let mut name = cfg.etcd.addr.clone();
        if name.contains("//") {
            name = name.split("//").collect::<Vec<&str>>()[1].to_string();
        }
        if name.contains(':') {
            name = name.split(':').collect::<Vec<&str>>()[0].to_string();
        }
        cfg.etcd.domain_name = name;
    }

    Ok(())
}

fn check_memory_cache_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.memory_cache.max_size == 0 {
        // meminfo unit is KB
        let meminfo = sys_info::mem_info()?;
        cfg.memory_cache.max_size = meminfo.total as usize * 1024 / 2; // 50%
    } else {
        cfg.memory_cache.max_size *= 1024 * 1024;
    }
    if cfg.memory_cache.skip_size == 0 {
        // will skip the cache when a query need cache great than this value, default is 80% of max_size
        cfg.memory_cache.skip_size = cfg.memory_cache.max_size / 10 * 8;
    } else {
        cfg.memory_cache.skip_size *= 1024 * 1024;
    }
    if cfg.memory_cache.release_size == 0 {
        // when cache is full will release how many data once time, default is 1% of max_size
        cfg.memory_cache.release_size = cfg.memory_cache.max_size / 100;
    } else {
        cfg.memory_cache.release_size *= 1024 * 1024;
    }
    Ok(())
}

fn check_s3_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if !cfg.s3.bucket_prefix.is_empty() && !cfg.s3.bucket_prefix.ends_with('/') {
        cfg.s3.bucket_prefix = format!("{}/", cfg.s3.bucket_prefix);
    }
    if cfg.s3.provider.is_empty() {
        if cfg.s3.server_url.contains(".googleapis.com") {
            cfg.s3.provider = "gcs".to_string();
        } else if cfg.s3.server_url.contains(".aliyuncs.com") {
            cfg.s3.provider = "oss".to_string();
            if !cfg
                .s3
                .server_url
                .contains(&format!("://{}.", cfg.s3.bucket_name))
            {
                cfg.s3.server_url = cfg
                    .s3
                    .server_url
                    .replace("://", &format!("://{}.", cfg.s3.bucket_name));
            }
        } else {
            cfg.s3.provider = "aws".to_string();
        }
    }
    cfg.s3.provider = cfg.s3.provider.to_lowercase();
    match cfg.s3.provider.as_str() {
        "oss" => {
            cfg.s3.feature_force_path_style = true;
        }
        "minio" => {
            cfg.s3.feature_force_path_style = true;
        }
        "swift" => {
            cfg.s3.feature_force_path_style = true;
            std::env::set_var("AWS_EC2_METADATA_DISABLED", "true");
        }
        _ => {}
    }
    Ok(())
}

#[inline]
pub fn get_parquet_compression() -> parquet::basic::Compression {
    match CONFIG.common.parquet_compression.to_lowercase().as_str() {
        "snappy" => parquet::basic::Compression::SNAPPY,
        "gzip" => parquet::basic::Compression::GZIP(parquet::basic::GzipLevel::default()),
        "brotli" => parquet::basic::Compression::BROTLI(parquet::basic::BrotliLevel::default()),
        "lz4" => parquet::basic::Compression::LZ4_RAW,
        "zstd" => parquet::basic::Compression::ZSTD(parquet::basic::ZstdLevel::try_new(3).unwrap()),
        _ => parquet::basic::Compression::ZSTD(parquet::basic::ZstdLevel::try_new(3).unwrap()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_config() {
        let mut cfg = Config::init().unwrap();
        cfg.s3.server_url = "https://storage.googleapis.com".to_string();
        cfg.s3.provider = "".to_string();
        check_s3_config(&mut cfg).unwrap();
        assert_eq!(cfg.s3.provider, "gcs");
        cfg.s3.server_url = "https://oss-cn-beijing.aliyuncs.com".to_string();
        cfg.s3.provider = "".to_string();
        check_s3_config(&mut cfg).unwrap();
        assert_eq!(cfg.s3.provider, "oss");
        cfg.s3.server_url = "".to_string();
        cfg.s3.provider = "".to_string();
        check_s3_config(&mut cfg).unwrap();
        assert_eq!(cfg.s3.provider, "aws");

        cfg.memory_cache.max_size = 1024;
        cfg.memory_cache.release_size = 1024;
        check_memory_cache_config(&mut cfg).unwrap();
        assert_eq!(cfg.memory_cache.max_size, 1024 * 1024 * 1024);
        assert_eq!(cfg.memory_cache.release_size, 1024 * 1024 * 1024);

        cfg.common.parquet_compression = "zstd".to_string();
        assert_eq!(
            get_parquet_compression(),
            parquet::basic::Compression::ZSTD(parquet::basic::ZstdLevel::try_new(3).unwrap())
        );

        cfg.limit.file_push_interval = 0;
        cfg.limit.req_cols_per_record_limit = 0;
        cfg.compact.interval = 0;
        cfg.compact.data_retention_days = 10;
        let ret = check_common_config(&mut cfg);
        assert!(ret.is_ok());
        assert_eq!(cfg.compact.data_retention_days, 10);
        assert_eq!(cfg.limit.req_cols_per_record_limit, 1000);

        cfg.compact.data_retention_days = 2;
        let ret = check_common_config(&mut cfg);
        assert!(ret.is_err());

        cfg.common.data_dir = "".to_string();
        let ret = check_path_config(&mut cfg);
        assert!(ret.is_ok());

        cfg.common.data_dir = "/abc".to_string();
        cfg.common.data_wal_dir = "/abc".to_string();
        cfg.common.data_stream_dir = "/abc".to_string();
        cfg.sled.data_dir = "/abc/".to_string();
        cfg.common.base_uri = "/abc/".to_string();
        let ret = check_path_config(&mut cfg);
        assert!(ret.is_ok());
        assert_eq!(cfg.common.data_dir, "/abc/".to_string());
        assert_eq!(cfg.common.data_wal_dir, "/abc/".to_string());
        assert_eq!(cfg.common.data_stream_dir, "/abc/".to_string());
        assert_eq!(cfg.common.data_dir, "/abc/".to_string());
        assert_eq!(cfg.common.base_uri, "/abc".to_string());
    }
}
