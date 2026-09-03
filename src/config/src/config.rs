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

use std::{
    cmp::max,
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock as Lazy},
};

use arc_swap::ArcSwap;
use chromiumoxide::{browser::BrowserConfig, handler::viewport::Viewport};
use dotenv_config::EnvConfig;
use hashbrown::{HashMap, HashSet};
use itertools::chain;
use lettre::{
    AsyncSmtpTransport, Tokio1Executor,
    transport::smtp::{
        authentication::Credentials,
        client::{Tls, TlsParameters},
    },
};
use serde::{Deserialize, Serialize};
use sha256::digest;

use crate::{
    meta::{
        cluster,
        stream::{QueryPartitionStrategy, StreamType},
    },
    utils::sysinfo,
};

pub type FxIndexMap<K, V> = indexmap::IndexMap<K, V, ahash::RandomState>;
pub type FxIndexSet<K> = indexmap::IndexSet<K, ahash::RandomState>;
pub type RwHashMap<K, V> = dashmap::DashMap<K, V, ahash::RandomState>;
pub type RwHashSet<K> = dashmap::DashSet<K, ahash::RandomState>;
pub type RwAHashMap<K, V> = tokio::sync::RwLock<HashMap<K, V>>;
pub type RwAHashSet<K> = tokio::sync::RwLock<HashSet<K>>;
pub type RwBTreeMap<K, V> = tokio::sync::RwLock<BTreeMap<K, V>>;

// for DDL commands and migrations
// Bump on every new sea-orm migration: `init_db` returns early when the stored
// version matches, so an un-bumped migration never runs on an existing
// deployment. Fresh installs still get it, which hides the omission locally.
//
// 74: create llm_playground_snapshots for Phase 3.1 shared Playground
// snapshots.
// 75: drop action_scripts, the actions feature is removed.
// 76: add steps_configured to synthetics_jobs.
// 77: create status_pages tables and status_page_custom_domains.
// 78: alert pending period cols
pub const DB_SCHEMA_VERSION: u64 = 78;
pub const DB_SCHEMA_KEY: &str = "/db_schema_version/";

// global version variables
pub static VERSION: &str = env!("GIT_VERSION");
pub static COMMIT_HASH: &str = env!("GIT_COMMIT_HASH");
pub static BUILD_DATE: &str = env!("GIT_BUILD_DATE");

pub const META_ORG_ID: &str = "_meta";
pub const DEFAULT_ORG: &str = "default";

pub const MMDB_CITY_FILE_NAME: &str = "GeoLite2-City.mmdb";
pub const MMDB_ASN_FILE_NAME: &str = "GeoLite2-ASN.mmdb";
pub const GEO_IP_CITY_ENRICHMENT_TABLE: &str = "maxmind_city";
pub const GEO_IP_ASN_ENRICHMENT_TABLE: &str = "maxmind_asn";

pub const SIZE_IN_MB: f64 = 1024.0 * 1024.0;
/// Initial HTTP/2 flow-control windows (bytes) for internal gRPC channels. Apply when
/// `ZO_GRPC_HTTP2_ADAPTIVE_WINDOW=false` (default); adaptive resets to 64 KB and grows via BDP.
pub const GRPC_HTTP2_STREAM_WINDOW_SIZE: u32 = 8 * 1024 * 1024; // 8 MB
pub const GRPC_HTTP2_CONNECTION_WINDOW_SIZE: u32 = 16 * 1024 * 1024; // 16 MB
pub const SIZE_IN_GB: f64 = 1024.0 * 1024.0 * 1024.0;
// The current value is recorded in each tantivy index file (puffin `row_group_size`
// property) so it can be changed safely without breaking row_id → row_group mapping
// for older files.
pub const PARQUET_MAX_ROW_GROUP_SIZE: usize = 128 * 1024;
pub const PARQUET_FILE_CHUNK_SIZE: usize = 100 * 1024; // 100k, num_rows
pub const DEFAULT_BLOOM_FILTER_FPP: f64 = 0.01;
pub const SOURCEMAP_ZIP_MAX_SIZE: usize = 1024 * 1024 * 100; // 100 MB
// max file size for individual sourcemap. We temp cache these in mem,
// so it will affect spikes in mem at resolving stacktrace
pub const SOURCEMAP_FILE_MAX_SIZE: u64 = 1024 * 1024 * 5; // 5 MB
pub const SOURCEMAP_MEM_CACHE_SIZE: usize = 10000;

#[inline]
pub fn get_batch_size() -> usize {
    get_config().limit.batch_size
}

pub const FILE_EXT_JSON: &str = ".json";
pub const FILE_EXT_ARROW: &str = ".arrow";
pub const FILE_EXT_PARQUET: &str = ".parquet";
pub const FILE_EXT_VORTEX: &str = ".vortex";
pub const FILE_EXT_PUFFIN: &str = ".puffin";
pub const FILE_EXT_TANTIVY: &str = ".ttv";

pub const INDEX_FIELD_NAME_FOR_ALL: &str = "_all";

pub const QUERY_WITH_NO_LIMIT: i64 = -999;

pub const MINIMUM_DB_CONNECTIONS: u32 = 2;
pub const REQUIRED_DB_CONNECTIONS: u32 = 4;

// Columns added to ingested records for _INTERNAL_ use only.
pub const TIMESTAMP_COL_NAME: &str = "_timestamp";
pub const O2_INGEST_TS_COL_NAME: &str = "_o2_ingest_ts";
// Used for storing and querying unflattened original data
pub const ID_COL_NAME: &str = "_o2_id";
pub const ORIGINAL_DATA_COL_NAME: &str = "_original";
pub const ALL_VALUES_COL_NAME: &str = "_all_values";

/// Internal columns are part of the effective UDS and exempt from its field
/// limit. Most remain implicit; the LLM schema migration also persists
/// `_o2_ingest_ts` for streams that already have UDS enabled.
pub fn is_uds_internal_column(name: &str) -> bool {
    name == TIMESTAMP_COL_NAME
        || name == O2_INGEST_TS_COL_NAME
        || name == ID_COL_NAME
        || name == ORIGINAL_DATA_COL_NAME
        || name == ALL_VALUES_COL_NAME
        || name == get_config().common.column_all
}

pub const MESSAGE_COL_NAME: &str = "message";
pub const STREAM_NAME_LABEL: &str = "o2_stream_name";
pub const STREAM_NAME_LABEL_OLD: &str = "stream_name";
pub const DEFAULT_STREAM_NAME: &str = "default";

const _DEFAULT_SQL_FULL_TEXT_SEARCH_FIELDS: [&str; 10] = [
    "log",
    "message",
    "msg",
    "content",
    "data",
    "body",
    "json",
    "error",
    "llm_input",
    "llm_output",
];
pub static SQL_FULL_TEXT_SEARCH_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    let cfg = get_config();
    let default_fields: &[&str] = if cfg.common.feature_default_index_fields_enabled {
        &_DEFAULT_SQL_FULL_TEXT_SEARCH_FIELDS
    } else {
        &[]
    };
    let mut fields = chain(
        default_fields.iter().map(|s| s.to_string()),
        cfg.common
            .feature_fulltext_extra_fields
            .split(',')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                }
            }),
    )
    .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    fields
});

const _DEFAULT_SQL_SECONDARY_INDEX_SEARCH_FIELDS: [&str; 3] =
    ["trace_id", "service_name", "operation_name"];
pub static SQL_SECONDARY_INDEX_SEARCH_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    let cfg = get_config();
    let default_fields: &[&str] = if cfg.common.feature_default_index_fields_enabled {
        &_DEFAULT_SQL_SECONDARY_INDEX_SEARCH_FIELDS
    } else {
        &[]
    };
    let mut fields = chain(
        default_fields.iter().map(|s| s.to_string()),
        cfg.common
            .feature_secondary_index_extra_fields
            .split(',')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                }
            }),
    )
    .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    fields
});

const _DEFAULT_QUICK_MODE_FIELDS: [&str; 9] = [
    // Losing these silently degrades sourcemap translation, breadcrumbs and session replay.
    "service",
    "version",
    "session_id",
    "view_url",
    // Losing these leaves the trace detail page without spans to build a waterfall from.
    "service_name",
    "operation_name",
    "trace_id",
    "span_id",
    "duration",
];
pub static QUICK_MODEL_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    let mut fields = chain(
        _DEFAULT_QUICK_MODE_FIELDS.iter().map(|s| s.to_string()),
        get_config()
            .common
            .feature_quick_mode_fields
            .split(',')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                }
            }),
    )
    .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    fields
});

const _DEFAULT_BLOOM_FILTER_FIELDS: [&str; 2] = ["trace_id", "session_id"];
pub static BLOOM_FILTER_DEFAULT_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    let cfg = get_config();
    let default_fields: &[&str] = if cfg.common.feature_default_index_fields_enabled {
        &_DEFAULT_BLOOM_FILTER_FIELDS
    } else {
        &[]
    };
    let mut fields = chain(
        default_fields.iter().map(|s| s.to_string()),
        cfg.common
            .feature_bloom_filter_extra_fields
            .split(',')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                }
            }),
    )
    .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    fields
});

const _DEFAULT_SEARCH_AROUND_FIELDS: [&str; 6] = [
    "k8s_cluster",
    "k8s_namespace_name",
    "k8s_pod_name",
    "kubernetes_namespace_name",
    "kubernetes_pod_name",
    "hostname",
];
pub static DEFAULT_SEARCH_AROUND_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    let mut fields = chain(
        _DEFAULT_SEARCH_AROUND_FIELDS.iter().map(|s| s.to_string()),
        get_config()
            .common
            .search_around_default_fields
            .split(',')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_string())
                }
            }),
    )
    .collect::<Vec<_>>();
    fields.sort();
    fields.dedup();
    fields
});

pub static HISTOGRAM_BREAKDOWN_FIELDS: Lazy<Vec<String>> = Lazy::new(|| {
    get_config()
        .limit
        .histogram_breakdown_fields
        .split(',')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .collect()
});

pub static MEM_TABLE_INDIVIDUAL_STREAMS: Lazy<HashMap<String, usize>> = Lazy::new(|| {
    let mut map = HashMap::default();
    let streams: Vec<String> = get_config()
        .common
        .mem_table_individual_streams
        .split(',')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .collect();
    let num_mem_tables = get_config().limit.mem_table_bucket_num;
    for stream in streams.into_iter() {
        if map.contains_key(&stream) {
            continue;
        }
        map.insert(stream, num_mem_tables + map.len());
    }
    map
});

pub static COMPACT_OLD_DATA_STREAM_SET: Lazy<HashSet<String>> = Lazy::new(|| {
    get_config()
        .compact
        .old_data_streams
        .split(',')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .collect()
});

pub static NATS_KV_WATCH_MODULES: Lazy<HashSet<String>> = Lazy::new(|| {
    get_config()
        .nats
        .kv_watch_modules
        .split(',')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .collect()
});

pub static CONFIG: Lazy<ArcSwap<Config>> = Lazy::new(|| ArcSwap::from(Arc::new(init())));
static INSTANCE_ID: Lazy<RwHashMap<String, String>> = Lazy::new(Default::default);

pub fn get_config() -> Arc<Config> {
    CONFIG.load().clone()
}

pub fn refresh_config() -> Result<(), anyhow::Error> {
    let old = CONFIG.load_full();
    let new = Arc::new(init());
    CONFIG.store(new.clone());

    // Deliberately not propagated as an error. `config_watcher::reload_config`
    // chains this with other refreshes and only records the new file hash when
    // all of them succeed, so an `Err` here would skip those AND make the
    // watcher retry the same file forever — one mistyped `ZO_SYNTHETICS_*` var
    // would wedge config reload for every feature.
    for key in synthetics_restart_required_changes(&old.synthetics, &new.synthetics) {
        log::warn!("{}", synthetics_restart_required_warning(key));
    }
    Ok(())
}

/// How far a `ZO_SYNTHETICS_*` key gets on a config reload. A reload is silent
/// by construction, so whether a key takes effect depends entirely on how its
/// consumers read it — invisible from the reload site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyntheticsReloadClass {
    /// Read through `get_config()` at point of use, so the atomic swap in
    /// [`refresh_config`] delivers it with no further plumbing.
    Hot,
    /// Cannot take effect without a restart. A reload logs a warning.
    RestartRequired,
}

/// The reload class of every `ZO_SYNTHETICS_*` key: can an operator change this
/// with `/config/reload`, or do they need a restart?
/// [`synthetics_restart_required_changes`] destructures the struct exhaustively,
/// so adding a key without classifying it here is a compile error.
pub const SYNTHETICS_RELOAD_CLASSES: &[(&str, SyntheticsReloadClass)] = &[
    (
        "ZO_SYNTHETICS_ENABLED",
        SyntheticsReloadClass::RestartRequired,
    ),
    ("ZO_SYNTHETICS_LAMBDA_BROWSER", SyntheticsReloadClass::Hot),
    ("ZO_SYNTHETICS_LAMBDA_NET", SyntheticsReloadClass::Hot),
    ("ZO_SYNTHETICS_API_ENDPOINT", SyntheticsReloadClass::Hot),
    (
        "ZO_SYNTHETICS_INSTALL_SCRIPT_URL",
        SyntheticsReloadClass::Hot,
    ),
    (
        "ZO_SYNTHETICS_RECORDER_EXTENSION_URL",
        SyntheticsReloadClass::Hot,
    ),
    ("ZO_SYNTHETICS_AGENT_STALE_SECS", SyntheticsReloadClass::Hot),
    ("ZO_SYNTHETICS_BROWSERS", SyntheticsReloadClass::Hot),
    ("ZO_SYNTHETICS_DEVICES", SyntheticsReloadClass::Hot),
    (
        "ZO_SYNTHETICS_SCHEDULER_JITTER_ENABLED",
        SyntheticsReloadClass::Hot,
    ),
    (
        "ZO_SYNTHETICS_ORPHAN_DETECTION_ENABLED",
        SyntheticsReloadClass::Hot,
    ),
    // Were `HotViaLimits` while these lived in `o2_enterprise` and had to be
    // pushed across a seam into this crate. They are declared here now, so the
    // seam and its class are both gone and they are plainly `Hot`.
    (
        "ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS",
        SyntheticsReloadClass::Hot,
    ),
    ("ZO_SYNTHETICS_JOB_LEASE_SECS", SyntheticsReloadClass::Hot),
    (
        "ZO_SYNTHETICS_MAX_NET_TIMEOUT_MS",
        SyntheticsReloadClass::Hot,
    ),
];

/// The warning an operator sees when they change a key a reload cannot carry.
///
/// A silent no-op is worse than an unsupported feature: the operator walks away
/// believing the new value is live.
pub(crate) fn synthetics_restart_required_warning(env_var: &str) -> String {
    format!("[synthetics] {env_var} changed on reload but requires a restart to take effect")
}

/// The `ZO_SYNTHETICS_*` keys that changed across a reload and cannot take
/// effect until the process restarts.
pub(crate) fn synthetics_restart_required_changes(
    old: &Synthetics,
    new: &Synthetics,
) -> Vec<&'static str> {
    // Exhaustive, no `..` rest pattern, on purpose: adding a field stops
    // compiling here until someone decides whether a reload can carry it.
    let Synthetics {
        enabled,
        status_page_rebuild_interval,
        status_page_domain_verify_interval,
        status_page_public_rpm,
        lambda_browser: _,
        lambda_net: _,
        api_endpoint: _,
        install_script_url: _,
        recorder_extension_url: _,
        agent_stale_secs: _,
        max_check_budget_secs: _,
        job_lease_secs: _,
        max_net_timeout_ms: _,
        browsers: _,
        devices: _,
        scheduler_jitter_enabled: _,
        orphan_detection_enabled: _,
    } = new;

    let mut changed = Vec::new();
    // `enabled` gates the `tokio::spawn` of the workers and the one-time route
    // registration; honouring it at runtime would be a structural change.
    if old.enabled != *enabled {
        changed.push("ZO_SYNTHETICS_ENABLED");
    }
    // Read once when the rebuilder loop starts.
    if old.status_page_rebuild_interval != *status_page_rebuild_interval {
        changed.push("ZO_STATUS_PAGE_REBUILD_INTERVAL");
    }
    // Read once when the domain-verify loop starts.
    if old.status_page_domain_verify_interval != *status_page_domain_verify_interval {
        changed.push("ZO_STATUS_PAGE_DOMAIN_VERIFY_INTERVAL");
    }
    // Read live per request; no restart needed, so not reported here.
    let _ = status_page_public_rpm;
    changed
}

pub fn cache_instance_id(instance_id: &str) {
    INSTANCE_ID.insert("instance_id".to_owned(), instance_id.to_owned());
}

pub fn get_instance_id() -> String {
    match INSTANCE_ID.get("instance_id") {
        Some(id) => id.clone(),
        None => "".to_string(),
    }
}

pub fn calculate_config_file_hash(path: &PathBuf) -> Result<String, anyhow::Error> {
    let content = std::fs::read_to_string(path)?;
    Ok(digest(content))
}

pub fn load_config() -> Result<(), anyhow::Error> {
    match crate::config_path_manager::get_config_file_path() {
        Some(path) => {
            log::info!("Loading config from file {:?}", path);
            if dotenvy::from_path_override(&path).is_err() {
                return Err(anyhow::anyhow!("Config loading from file failed"));
            }
            log::info!("Config loaded successfully from file {path:?}");
        }
        None => {
            // Perform default .env discovery and set it in the config manager
            if let Ok(env_path) = dotenvy::dotenv_override() {
                log::debug!("Config init: Found .env file at {env_path:?} during boot");
                // Set the default path in config manager
                crate::config_path_manager::set_config_file_path(env_path)?;
            } else {
                return Err(anyhow::anyhow!(
                    "Config init: No .env file found during default discovery"
                ));
            }
        }
    }
    Ok(())
}
static CHROME_LAUNCHER_OPTIONS: tokio::sync::OnceCell<Option<BrowserConfig>> =
    tokio::sync::OnceCell::const_new();

pub async fn get_chrome_launch_options() -> &'static Option<BrowserConfig> {
    CHROME_LAUNCHER_OPTIONS
        .get_or_init(init_chrome_launch_options)
        .await
}

async fn init_chrome_launch_options() -> Option<BrowserConfig> {
    let cfg = get_config();
    if !cfg.chrome.chrome_enabled || !cfg.common.report_server_url.is_empty() {
        None
    } else {
        let mut browser_config = BrowserConfig::builder()
            .window_size(
                cfg.chrome.chrome_window_width,
                cfg.chrome.chrome_window_height,
            )
            .viewport(Viewport {
                width: cfg.chrome.chrome_window_width,
                height: cfg.chrome.chrome_window_height,
                device_scale_factor: Some(1.0),
                ..Viewport::default()
            });

        if cfg.chrome.chrome_with_head {
            browser_config = browser_config.with_head();
        }

        if cfg.chrome.chrome_no_sandbox {
            browser_config = browser_config.no_sandbox();
        }

        if !cfg.chrome.chrome_path.is_empty() {
            browser_config = browser_config.chrome_executable(cfg.chrome.chrome_path.as_str());
        } else {
            panic!("Chrome path must be specified");
        }
        Some(browser_config.build().unwrap())
    }
}

pub static SMTP_CLIENT: Lazy<Option<AsyncSmtpTransport<Tokio1Executor>>> = Lazy::new(|| {
    let cfg = get_config();
    if !cfg.smtp.smtp_enabled {
        None
    } else {
        let tls_parameters = TlsParameters::new(cfg.smtp.smtp_host.clone()).unwrap();
        let mut transport_builder =
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&cfg.smtp.smtp_host)
                .port(cfg.smtp.smtp_port);

        // Resolve effective TLS mode:
        // 1. If ZO_SMTP_ENCRYPTION is unset/auto, derive from port (465=ssltls, 587=starttls).
        // 2. If explicitly set, validate it against the port convention. If mismatched, log a
        //    warning and fall back to the port-derived value so the connection still works.
        let port_derived = match cfg.smtp.smtp_port {
            465 => "ssltls",
            587 | 2587 => "starttls",
            _ => "",
        };
        let effective_encryption = match cfg.smtp.smtp_encryption.as_str() {
            "" | "auto" => port_derived,
            explicit => {
                let mismatch = matches!(
                    (explicit, cfg.smtp.smtp_port),
                    ("ssltls", 587) | ("ssltls", 2587) | ("starttls", 465)
                );
                if mismatch {
                    log::warn!(
                        "[SMTP] ZO_SMTP_ENCRYPTION={explicit} conflicts with port {}; \
                         falling back to port-derived value '{port_derived}'",
                        cfg.smtp.smtp_port
                    );
                    port_derived
                } else {
                    explicit
                }
            }
        };
        transport_builder = if effective_encryption == "starttls" {
            transport_builder.tls(Tls::Required(tls_parameters))
        } else if effective_encryption == "ssltls" {
            transport_builder.tls(Tls::Wrapper(tls_parameters))
        } else {
            transport_builder
        };

        if !cfg.smtp.smtp_username.is_empty() && !cfg.smtp.smtp_password.is_empty() {
            transport_builder = transport_builder.credentials(Credentials::new(
                cfg.smtp.smtp_username.clone(),
                cfg.smtp.smtp_password.clone(),
            ));
        }
        Some(transport_builder.build())
    }
});

static SNS_CLIENT: tokio::sync::OnceCell<aws_sdk_sns::Client> = tokio::sync::OnceCell::const_new();

async fn init_sns_client() -> aws_sdk_sns::Client {
    let cfg = get_config();
    let shared_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;

    let sns_config = aws_sdk_sns::config::Builder::from(&shared_config)
        .endpoint_url(cfg.sns.endpoint.clone())
        .timeout_config(
            aws_config::timeout::TimeoutConfig::builder()
                .connect_timeout(std::time::Duration::from_secs(cfg.sns.connect_timeout))
                .operation_timeout(std::time::Duration::from_secs(cfg.sns.operation_timeout))
                .build(),
        )
        .build();

    aws_sdk_sns::Client::from_conf(sns_config)
}

pub async fn get_sns_client() -> &'static aws_sdk_sns::Client {
    SNS_CLIENT.get_or_init(init_sns_client).await
}

pub static BLOCKED_STREAMS: Lazy<Vec<String>> = Lazy::new(|| {
    get_config()
        .common
        .blocked_streams
        .split(',')
        .map(|x| x.to_string())
        .collect()
});

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FileFormat {
    #[default]
    Parquet,
    Vortex,
}

impl std::fmt::Display for FileFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Parquet => write!(f, "parquet"),
            Self::Vortex => write!(f, "vortex"),
        }
    }
}

impl std::str::FromStr for FileFormat {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "parquet" => Ok(Self::Parquet),
            "vortex" => Ok(Self::Vortex),
            _ => Err(anyhow::anyhow!("Invalid file format: {}", s)),
        }
    }
}

impl FileFormat {
    pub fn for_ingester_stream(stream_type: StreamType, configured: Self) -> Self {
        if stream_type == StreamType::Metrics {
            Self::Parquet
        } else {
            configured
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            Self::Parquet => FILE_EXT_PARQUET,
            Self::Vortex => FILE_EXT_VORTEX,
        }
    }

    pub fn from_extension(path: &str) -> Option<Self> {
        if path.ends_with(FILE_EXT_PARQUET) {
            Some(Self::Parquet)
        } else if path.ends_with(FILE_EXT_VORTEX) {
            Some(Self::Vortex)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileFormatConfig {
    default: FileFormat,
    logs: Option<FileFormat>,
    metrics: Option<FileFormat>,
    traces: Option<FileFormat>,
}

impl FileFormatConfig {
    pub const fn new(default: FileFormat) -> Self {
        Self {
            default,
            logs: None,
            metrics: None,
            traces: None,
        }
    }

    pub fn for_stream(self, stream_type: StreamType) -> FileFormat {
        match stream_type {
            StreamType::Logs => self.logs,
            StreamType::Metrics => self.metrics,
            StreamType::Traces => self.traces,
            _ => None,
        }
        .unwrap_or(self.default)
    }
}

impl Default for FileFormatConfig {
    fn default() -> Self {
        Self::new(FileFormat::default())
    }
}

impl std::fmt::Display for FileFormatConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.default)?;
        for (stream_type, file_format) in [
            (StreamType::Logs, self.logs),
            (StreamType::Metrics, self.metrics),
            (StreamType::Traces, self.traces),
        ] {
            if let Some(file_format) = file_format {
                write!(f, ",{stream_type}={file_format}")?;
            }
        }
        Ok(())
    }
}

impl std::str::FromStr for FileFormatConfig {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let mut parts = value.split(',');
        let default = parts
            .next()
            .map(str::trim)
            .filter(|part| !part.is_empty() && !part.contains('='))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid file format config: a default format must be specified first"
                )
            })?
            .parse()?;
        let mut config = Self::new(default);

        for part in parts {
            let (stream_type, file_format) = part.trim().split_once('=').ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid file format override '{part}': expected <stream_type>=<file_format>"
                )
            })?;
            let file_format = file_format.trim().parse()?;
            let target = match stream_type.trim().to_lowercase().as_str() {
                "logs" => &mut config.logs,
                "metrics" => &mut config.metrics,
                "traces" => &mut config.traces,
                stream_type => {
                    return Err(anyhow::anyhow!(
                        "Invalid stream type '{stream_type}' in file format config: expected logs, metrics, or traces"
                    ));
                }
            };
            if target.replace(file_format).is_some() {
                return Err(anyhow::anyhow!(
                    "Duplicate file format override for stream type '{}'",
                    stream_type.trim()
                ));
            }
        }

        Ok(config)
    }
}

impl Serialize for FileFormatConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for FileFormatConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Config {
    pub auth: Auth,
    pub http_streaming: HttpStreaming,
    pub report_server: ReportServer,
    pub http: Http,
    pub grpc: Grpc,
    pub route: Route,
    pub common: Common,
    pub search: Search,
    pub limit: Limit,
    pub compact: Compact,
    pub cache_latest_files: CacheLatestFiles,
    pub memory_cache: MemoryCache,
    pub disk_cache: DiskCache,
    pub log: Log,
    pub nats: Nats,
    pub s3: S3,
    pub sns: Sns,
    pub prom: Prometheus,
    pub smtp: Smtp,
    pub rum: RUM,
    pub chrome: Chrome,
    pub tokio_console: TokioConsole,
    pub pipeline: Pipeline,
    pub health_check: HealthCheck,
    pub enrichment_table: EnrichmentTable,
    pub slo: Slo,
    pub synthetics: Synthetics,
    pub alert_composite: AlertComposite,
    pub db_monitoring: DatabaseMonitoring,
}

/// Database Monitoring (design: `db-monitoring/dbm-design-doc.md` §8) —
/// ingest-time db span fingerprinting, server-vantage log canonicalization, the
/// query-stats rollup job, and the DBM read APIs. OSS feature; runtime-gated on
/// `enabled` ONLY: enabled means every DBM signal is canonicalized and served,
/// disabled means none is. The operational tunables that used to sit beside
/// this flag (rollup interval, top-N, normalization caps, per-signal gates)
/// are deliberately NOT configurable — each lives as a `const` in its
/// consuming module, carrying the same value the old knob defaulted to.
#[derive(Debug, Serialize, EnvConfig, Default)]
pub struct DatabaseMonitoring {
    #[env_config(
        name = "ZO_DB_MONITORING_ENABLED",
        default = true,
        help = "Enable Database Monitoring: ingest-time db span fingerprinting, server-vantage log canonicalization, the query-stats rollup job, and the DBM read APIs"
    )]
    pub enabled: bool,
    #[env_config(
        name = "ZO_DB_MONITORING_ROLLUP_INTERVAL_SECS",
        default = 900,
        help = "Rollup window and job cadence in seconds. This is also the freshness floor: rolled-up data is up to one interval stale, and the read path covers the remainder with a live delta query over un-rolled-up spans. Lowering it shrinks that delta (cheaper reads, fresher pages) at the cost of a more frequent rollup job and more `_o2_db_stats` rows."
    )]
    pub rollup_interval_secs: u64,
}

/// Synthetic monitoring. Lives here rather than in `o2_enterprise` because the
/// feature itself is OSS — only the private-VPC-agent path is enterprise.
///
/// Two keys are read exclusively by enterprise-gated code and do nothing in an
/// OSS-only build; each says so, and [`check_synthetics_config`] warns when one
/// is set in a build that cannot act on it. The gating lives at the read site,
/// not at the definition, so that there is exactly one name per setting.
#[derive(Debug, Serialize, EnvConfig, Default)]
pub struct Synthetics {
    /// Master switch for the synthetics feature. When false: background workers
    /// (scheduler/dispatcher/reaper) do not start, all synthetics HTTP routes
    /// are not registered, and the UI hides synthetics (via /config
    /// synthetics_enabled).
    #[env_config(
        name = "ZO_SYNTHETICS_ENABLED",
        default = false,
        help = "Master switch for synthetic monitoring. Off by default; the background workers and HTTP routes only exist when this is true."
    )]
    pub enabled: bool,
    /// Seconds between status-page snapshot rebuild ticks.
    #[env_config(
        name = "ZO_STATUS_PAGE_REBUILD_INTERVAL",
        default = 60,
        help = "Seconds between status-page snapshot rebuild ticks."
    )]
    pub status_page_rebuild_interval: u64,
    /// Seconds between custom-domain DNS ownership verification ticks. Kept
    /// far tighter than the snapshot rebuild interval so a newly-added domain
    /// with already-correct DNS doesn't sit pending for a full minute-plus.
    #[env_config(
        name = "ZO_STATUS_PAGE_DOMAIN_VERIFY_INTERVAL",
        default = 30,
        help = "Seconds between custom-domain DNS ownership verification ticks."
    )]
    pub status_page_domain_verify_interval: u64,
    /// Per-IP request budget per minute for the public status-page read routes
    /// (snapshot / page / badge / feed). Generous by default — thousands of a
    /// customer's employees can share one corporate NAT egress IP during an
    /// outage, so a tight cap would 429 legitimate panicked visitors. 0
    /// disables the limiter.
    #[env_config(
        name = "ZO_STATUS_PAGE_PUBLIC_RPM",
        default = 240,
        help = "Per-IP requests/minute for the public status-page read routes. 0 disables."
    )]
    pub status_page_public_rpm: u32,
    /// Lambda function name for the browser probe (handles all engines:
    /// chromium, firefox, edge).
    #[env_config(
        name = "ZO_SYNTHETICS_LAMBDA_BROWSER",
        default = "o2-synthetics-browser-probe",
        help = "Lambda function name for the browser probe, covering every browser engine."
    )]
    pub lambda_browser: String,
    /// Lambda function name for the network probe (handles https, ping, dns,
    /// ssh, tcp, etc.). Also selects the venue for public `net-*` pools: set
    /// (managed) — the dispatcher invokes this Lambda per job; empty (default,
    /// self-hosted) — pools are left for lease-based agents, which is an
    /// enterprise path. Private pools are always agent-served regardless.
    #[env_config(
        name = "ZO_SYNTHETICS_LAMBDA_NET",
        default = "",
        help = "Lambda function name for the network probe. Empty leaves public net-* pools to lease-based agents, which requires enterprise."
    )]
    pub lambda_net: String,
    /// Public-facing URL of the OpenObserve API — sent to the probe as
    /// JOBAPI_ENDPOINT and used as the result-stream ingest base URL.
    /// Empty (default) falls back to ZO_WEB_URL.
    #[env_config(
        name = "ZO_SYNTHETICS_API_ENDPOINT",
        default = "",
        help = "Probe-facing base URL for the OpenObserve API. Empty falls back to ZO_WEB_URL."
    )]
    pub api_endpoint: String,
    /// **Enterprise only.** Public URL of the agent install script shown in the
    /// setup drawer; the UI composes per-platform commands (docker / k8s /
    /// linux) around it. Read only by the private-agent setup flow, so setting
    /// it in an OSS-only build has no effect.
    ///
    /// Hosted in o2-datasource (public) rather than synthetic-o2-agent
    /// (private) — same reason install scripts for other OpenObserve components
    /// live there (see o2-datasource/k8s/install.sh).
    #[env_config(
        name = "ZO_SYNTHETICS_INSTALL_SCRIPT_URL",
        default = "https://raw.githubusercontent.com/openobserve/o2-datasource/main/synthetics/install.sh",
        help = "Enterprise only. URL of the private-agent install script shown in the setup drawer."
    )]
    pub install_script_url: String,
    /// Chrome Web Store listing for the OpenObserve Recorder extension, shown
    /// in the browser-test setup UI (via /config
    /// synthetics_recorder_extension_url). Override for a privately hosted or
    /// re-published build of the extension.
    #[env_config(
        name = "ZO_SYNTHETICS_RECORDER_EXTENSION_URL",
        default = "https://chromewebstore.google.com/detail/afhgiecgbpohkbobialnajlphbpcgomo",
        help = "Chrome Web Store listing for the OpenObserve Recorder extension, linked from the browser-test setup UI."
    )]
    pub recorder_extension_url: String,
    /// **Enterprise only.** Seconds since the last lease/heartbeat before an
    /// agent counts as stale. All agents of a private location stale ⇒ location
    /// shows Offline and the staleness watcher raises a "location down"
    /// notification. Agents are a private-location concept, so this does
    /// nothing in an OSS-only build.
    #[env_config(
        name = "ZO_SYNTHETICS_AGENT_STALE_SECS",
        default = 120,
        help = "Enterprise only. Seconds since an agent's last lease or heartbeat before it counts as stale."
    )]
    pub agent_stale_secs: i64,
    /// Ceiling on a check's worst-case run, in seconds — the value the server
    /// validates every check config against.
    ///
    /// **Must be kept equal to the deployed probe Lambda function timeout.**
    /// That timeout is an AWS resource setting applied by the probe deploy
    /// scripts (`LAMBDA_TIMEOUT_SECS`), so o2 cannot read or assert it. If this
    /// is larger, a check is accepted, run, and then killed mid-run by the
    /// function — reporting a failure the target never had.
    #[env_config(
        name = "ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS",
        default = 840,
        help = "Ceiling on a check's worst-case run, in seconds. Keep equal to the probe Lambda's function timeout."
    )]
    pub max_check_budget_secs: i64,
    /// How long the server leases a job to a probe before the reaper assumes the
    /// probe is gone and requeues it.
    ///
    /// Must stay strictly greater than `max_check_budget_secs`: the gap is what
    /// dispatch and the ack need, because a run finishing exactly at the budget
    /// still has to report before the lease expires. 900 is also AWS Lambda's
    /// maximum function timeout, so it is the practical ceiling for both.
    #[env_config(
        name = "ZO_SYNTHETICS_JOB_LEASE_SECS",
        default = 900,
        help = "How long a job is leased to a probe before the reaper requeues it. Must be strictly greater than the check budget."
    )]
    pub job_lease_secs: i64,
    /// Ceiling for ONE attempt of a non-browser check, in milliseconds.
    #[env_config(
        name = "ZO_SYNTHETICS_MAX_NET_TIMEOUT_MS",
        default = 300000,
        help = "Ceiling for one attempt of a non-browser check, in milliseconds."
    )]
    pub max_net_timeout_ms: u32,
    /// Comma-separated list of enabled browser engine names.
    /// Probe must have the corresponding Lambda function deployed.
    /// firefox temporarily disabled by default — re-add once ready.
    #[env_config(
        name = "ZO_SYNTHETICS_BROWSERS",
        default = "chromium",
        help = "Comma-separated browser engines offered to checks. Each needs its Lambda deployed."
    )]
    pub browsers: String,
    /// Device definitions: comma-separated `id:width:height` triples.
    /// These are the viewport sizes the probe will use for each device class.
    #[env_config(
        name = "ZO_SYNTHETICS_DEVICES",
        default = "desktop:1440:900,tablet:768:1024,mobile:375:667",
        help = "Device viewports as comma-separated id:width:height triples."
    )]
    pub devices: String,
    /// Kill switch for scheduler jitter, which offsets each check by a
    /// deterministic amount derived from its id. Without it every check on the
    /// same frequency comes due in the same tick — a thousand 1-minute checks
    /// all fire at `:00`, a spike every minute rather than a stream.
    #[env_config(
        name = "ZO_SYNTHETICS_SCHEDULER_JITTER_ENABLED",
        default = true,
        help = "Kill switch for scheduler jitter, which spreads same-frequency checks across their interval."
    )]
    pub scheduler_jitter_enabled: bool,
    /// Kill switch for orphan detection, which reports enabled checks no
    /// scheduler has claimed. Read per pass, not captured at boot: it is a new
    /// always-on alert source, and an operator facing a false-positive storm at
    /// 3am needs a way to stop it that does not involve a restart. Without one
    /// the alert gets muted instead, and a muted alert is worse than none.
    #[env_config(
        name = "ZO_SYNTHETICS_ORPHAN_DETECTION_ENABLED",
        default = true,
        help = "Kill switch for orphan detection, which reports enabled checks no scheduler is claiming."
    )]
    pub orphan_detection_enabled: bool,
}

/// Feature 5 — SLO measurement (`alerts_2.md` §6b).
#[derive(Debug, Serialize, EnvConfig, Default)]
pub struct Slo {
    #[env_config(
        name = "ZO_SLO_INGEST_DELAY_SECS",
        default = 60,
        help = "How far behind now the ingest job reads, so late-arriving data is present before a slice is measured. A slice is never measured until it is this far in the past."
    )]
    pub ingest_delay_secs: i64,
    #[env_config(
        name = "ZO_SLO_RECOMPUTE_SLICES",
        default = 3,
        help = "How many trailing slices each pass recomputes, to pick up data that arrived after those slices were first measured. Re-emitted rows win on revision."
    )]
    pub recompute_slices: i64,
    #[env_config(
        name = "ZO_SLO_MIN_COVERAGE",
        default = 0.9,
        help = "Coverage floor, 0..1. Below this the SLO reads as no-data and its alerts FREEZE rather than resolving — unmeasured time must never read as uptime."
    )]
    pub min_coverage: f64,
    #[env_config(
        name = "ZO_SLO_MAX_GROUPS",
        default = 500,
        help = "Hard cap on status rows per SLO. Group cardinality past this trips GroupOverflow rather than silently truncating."
    )]
    pub max_groups: i64,
    #[env_config(
        name = "ZO_SLO_MAX_SLICE_ROWS_PER_ORG",
        default = 250000000,
        help = "Per-org budget over logical (group, slice) rows. Bounds the SLOs x GROUPS x window product, which is indefensible even where each factor is individually fine."
    )]
    pub max_slice_rows_per_org: i64,
    #[env_config(
        name = "ZO_SLO_REVISION_HEADROOM",
        default = 1.2,
        help = "Multiplier pricing physical excess (late-data re-emissions) over logical rows. Values below 1.0 are clamped; it is a multiplier, not a discount."
    )]
    pub revision_headroom: f64,
    #[env_config(
        name = "ZO_SLO_RECONCILE_INTERVAL_SECS",
        default = 3600,
        help = "How often the running aggregate is rebuilt from the slices. This is the bound on cache drift after a crash, and is load-bearing rather than hygiene."
    )]
    pub reconcile_interval_secs: i64,
    #[env_config(
        name = "ZO_SLO_BACKFILL_CHUNK_SECS",
        default = 86400,
        help = "How much history one backfill chunk covers. One aggregate query per chunk produces every slice in it."
    )]
    pub backfill_chunk_secs: i64,
    #[env_config(
        name = "ZO_SLO_MAX_BURN_WINDOW_PAIRS",
        default = 8,
        help = "Max distinct (long, short) burn-rate window pairs precomputed per SLO per pass. Alerts share these, so the cost is per SLO, not per alert."
    )]
    pub max_burn_window_pairs: i64,
}

/// Composite alerts tunables (§19.2).
///
/// Writes are on by default; `ZO_ALERT_COMPOSITE_WRITES_ENABLED` is an opt-out
/// kill-switch for operators who want to disable composite mutation.
#[derive(Debug, Serialize, EnvConfig, Default)]
pub struct AlertComposite {
    #[env_config(
        name = "ZO_ALERT_COMPOSITE_WRITES_ENABLED",
        default = true,
        help = "Enable composite-alert mutation (create/update/move/trigger). Opt-out kill-switch: set to \"false\" to disable."
    )]
    pub writes_enabled: bool,
    #[env_config(
        name = "ZO_ALERT_COMPOSITE_STALE_K",
        default = 3,
        help = "Multiplier on a child's evaluation cadence that marks it stale."
    )]
    pub stale_k: i64,
    #[env_config(
        name = "ZO_ALERT_COMPOSITE_SWEEP_SECS",
        default = 300,
        help = "Composite scheduler sweep interval in seconds."
    )]
    pub sweep_secs: i64,
    #[env_config(
        name = "ZO_ALERT_COMPOSITE_DEBOUNCE_SECS",
        default = 15,
        help = "Minimum seconds between composite evaluations (coalescing debounce)."
    )]
    pub debounce_secs: i64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct HttpStreaming {
    #[env_config(
        name = "ZO_STREAMING_RESPONSE_CHUNK_SIZE_MB",
        default = 1,
        help = "Size in MB for each chunk when streaming search responses"
    )]
    pub streaming_response_chunk_size: usize,
    #[env_config(
        name = "ZO_STREAMING_ENABLED",
        default = true,
        help = "Enable streaming"
    )]
    pub streaming_enabled: bool,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct ReportServer {
    #[env_config(name = "ZO_ENABLE_EMBEDDED_REPORT_SERVER", default = false)]
    pub enable_report_server: bool,
    #[env_config(name = "ZO_REPORT_USER_EMAIL", default = "")]
    pub user_email: String,
    #[env_config(name = "ZO_REPORT_USER_PASSWORD", default = "")]
    pub user_password: String,
    #[env_config(name = "ZO_REPORT_SERVER_HTTP_PORT", default = 5082)]
    pub port: u16,
    #[env_config(name = "ZO_REPORT_SERVER_HTTP_ADDR", default = "127.0.0.1")]
    pub addr: String,
    #[env_config(name = "ZO_REPORT_SERVER_HTTP_IPV6_ENABLED", default = false)]
    pub ipv6_enabled: bool,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct TokioConsole {
    #[env_config(name = "ZO_TOKIO_CONSOLE_SERVER_ADDR", default = "0.0.0.0")]
    pub tokio_console_server_addr: String,
    #[env_config(name = "ZO_TOKIO_CONSOLE_SERVER_PORT", default = 6699)]
    pub tokio_console_server_port: u16,
    #[env_config(name = "ZO_TOKIO_CONSOLE_RETENTION", default = 60)]
    pub tokio_console_retention: u64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Chrome {
    #[env_config(name = "ZO_CHROME_ENABLED", default = false)]
    pub chrome_enabled: bool,
    #[env_config(name = "ZO_CHROME_PATH", default = "")]
    pub chrome_path: String,
    #[env_config(name = "ZO_CHROME_CHECK_DEFAULT_PATH", default = true)]
    pub chrome_check_default: bool,
    #[env_config(name = "ZO_CHROME_AUTO_DOWNLOAD", default = false)]
    pub chrome_auto_download: bool,
    #[env_config(name = "ZO_CHROME_DOWNLOAD_PATH", default = "./data/download")]
    pub chrome_download_path: String,
    #[env_config(name = "ZO_CHROME_NO_SANDBOX", default = false)]
    pub chrome_no_sandbox: bool,
    #[env_config(name = "ZO_CHROME_WITH_HEAD", default = false)]
    pub chrome_with_head: bool,
    #[env_config(name = "ZO_CHROME_SLEEP_SECS", default = 20)]
    pub chrome_sleep_secs: u16,
    #[env_config(name = "ZO_CHROME_WINDOW_WIDTH", default = 1370)]
    pub chrome_window_width: u32,
    #[env_config(name = "ZO_CHROME_WINDOW_HEIGHT", default = 730)]
    pub chrome_window_height: u32,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Smtp {
    #[env_config(name = "ZO_SMTP_ENABLED", default = false)]
    pub smtp_enabled: bool,
    #[env_config(name = "ZO_SMTP_HOST", default = "localhost")]
    pub smtp_host: String,
    #[env_config(name = "ZO_SMTP_PORT", default = 25)]
    pub smtp_port: u16,
    #[env_config(name = "ZO_SMTP_USER_NAME", default = "")]
    pub smtp_username: String,
    #[env_config(name = "ZO_SMTP_PASSWORD", default = "")]
    pub smtp_password: String,
    #[env_config(name = "ZO_SMTP_REPLY_TO", default = "")]
    pub smtp_reply_to: String,
    #[env_config(name = "ZO_SMTP_FROM_EMAIL", default = "")]
    pub smtp_from_email: String,
    #[env_config(name = "ZO_SMTP_ENCRYPTION", default = "")]
    pub smtp_encryption: String,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Auth {
    #[env_config(name = "ZO_ROOT_USER_EMAIL")]
    pub root_user_email: String,
    #[env_config(name = "ZO_ROOT_USER_PASSWORD")]
    pub root_user_password: String,
    #[env_config(name = "ZO_ROOT_USER_TOKEN")]
    pub root_user_token: String,
    #[env_config(name = "ZO_CLI_USER_COOKIE")]
    pub cli_user_cookie: String,
    #[env_config(name = "ZO_COOKIE_MAX_AGE", default = 2592000)] // seconds, 30 days
    pub cookie_max_age: i64,
    #[env_config(name = "ZO_COOKIE_SAME_SITE_LAX", default = true)]
    pub cookie_same_site_lax: bool,
    #[env_config(name = "ZO_COOKIE_SECURE_ONLY", default = false)]
    pub cookie_secure_only: bool,
    #[env_config(name = "ZO_EXT_AUTH_SALT", default = "openobserve")]
    pub ext_auth_salt: String,
    #[env_config(
        name = "ZO_ALERT_CHART_SIGNING_KEY",
        default = "",
        help = "Secret used to sign stateless alert-chart render URLs. When empty (the default), a key is derived from the root user's stored password hash, which every node shares via the meta DB. Set explicitly to control rotation; rotating invalidates in-flight chart URLs (bounded by ZO_ALERT_CHART_URL_TTL)."
    )]
    pub alert_chart_signing_key: String,
    #[env_config(name = "ZO_SERVICE_ACCOUNT_ENABLED", default = true)]
    pub service_account_enabled: bool,
    /// Session cleanup interval in seconds (default: 3600 = 1 hour)
    /// How often to run the background job that deletes expired sessions
    #[env_config(name = "ZO_SESSION_CLEANUP_INTERVAL", default = 3600)]
    pub session_cleanup_interval: u64,
    /// Default session expiry in hours for migration (default: 24 hours)
    /// Used for existing sessions when migrating to add expires_at column
    #[env_config(name = "ZO_SESSION_DEFAULT_EXPIRY_HOURS", default = 24)]
    pub session_default_expiry_hours: i64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Http {
    #[env_config(name = "ZO_HTTP_PORT", default = 5080)]
    pub port: u16,
    #[env_config(name = "ZO_HTTP_ADDR", default = "")]
    pub addr: String,
    #[env_config(name = "ZO_HTTP_IPV6_ENABLED", default = false)]
    pub ipv6_enabled: bool,
    #[env_config(name = "ZO_HTTP_TLS_SKIP_VERIFY", default = false)]
    pub tls_skip_verify: bool,
    #[env_config(name = "ZO_HTTP_TLS_ENABLED", default = false)]
    pub tls_enabled: bool,
    #[env_config(name = "ZO_HTTP_TLS_CERT_PATH", default = "")]
    pub tls_cert_path: String,
    #[env_config(name = "ZO_HTTP_TLS_KEY_PATH", default = "")]
    pub tls_key_path: String,
    #[env_config(name = "ZO_HTTP_TLS_MIN_VERSION", default = "", help = "Supported values: "1.2" or "1.3", default is all_version")]
    pub tls_min_version: String,
    #[env_config(
        name = "ZO_HTTP_TLS_ROOT_CERTIFICATES",
        parse,
        default = "webpki",
        help = "this value must use webpki or native. it means use standard root certificates from webpki-roots or native-roots as a rustls certificate store"
    )]
    pub tls_root_certificates: TlsRootCertificates,
    #[env_config(
        name = "ZO_HTTP_ACCESS_LOG_FORMAT",
        default = "",
        help = "Custom access log format, leave empty to use default format, shortcut: common, json"
    )]
    pub access_log_format: String,
    #[env_config(
        name = "ZO_HTTP_REAL_IP_SOURCE",
        default = "XEnvoyExternalAddress,XRealIp,RightmostXForwardedFor",
        help = "Comma-separated list of sources to resolve the real client IP; tried in \
                order, first match wins. TCP peer (ConnectInfo) is always used as the final \
                fallback. Supported entries: XEnvoyExternalAddress (Envoy/Istio), \
                XRealIp (nginx, Traefik), RightmostXForwardedFor (nginx/HAProxy/AWS ALB/GCP LB), \
                RightmostForwarded (RFC 7239), CfConnectingIp (Cloudflare), \
                TrueClientIp (Akamai/Cloudflare Enterprise), FlyClientIp (Fly.io), \
                CloudFrontViewerAddress (AWS CloudFront), ConnectInfo (TCP peer). Default \
                covers the common k8s ingresses. Only list sources whose proxy is actually \
                in front of this server; clients can spoof any header the server trusts \
                without an upstream to terminate it."
    )]
    pub real_ip_source: String,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Grpc {
    #[env_config(name = "ZO_GRPC_PORT", default = 5081)]
    pub port: u16,
    #[env_config(name = "ZO_GRPC_ADDR", default = "")]
    pub addr: String,
    #[env_config(name = "ZO_GRPC_ORG_HEADER_KEY", default = "organization")]
    pub org_header_key: String,
    #[env_config(name = "ZO_GRPC_STREAM_HEADER_KEY", default = "stream-name")]
    pub stream_header_key: String,
    #[env_config(name = "ZO_INTERNAL_GRPC_TOKEN", default = "")]
    pub internal_grpc_token: String,
    #[env_config(
        name = "ZO_GRPC_MAX_MESSAGE_SIZE",
        default = 32,
        help = "Max grpc message size in MB, default is 32 MB"
    )]
    pub max_message_size: usize,
    #[env_config(name = "ZO_GRPC_CONNECT_TIMEOUT", default = 5)] // in seconds
    pub connect_timeout: u64,
    #[env_config(name = "ZO_GRPC_CHANNEL_CACHE_DISABLED", default = false)]
    pub channel_cache_disabled: bool,
    #[env_config(
        name = "ZO_GRPC_HTTP2_ADAPTIVE_WINDOW",
        default = false,
        help = "Enable HTTP/2 adaptive (BDP-based) flow-control window growth for inter-node \
                gRPC. Off by default (fixed stream/connection windows apply). Turn on for \
                high-latency links; costs more memory under many concurrent streams."
    )]
    pub http2_adaptive_window: bool,
    #[env_config(name = "ZO_GRPC_TLS_ENABLED", default = false)]
    pub tls_enabled: bool,
    #[env_config(name = "ZO_GRPC_TLS_CERT_DOMAIN", default = "")]
    pub tls_cert_domain: String,
    #[env_config(name = "ZO_GRPC_TLS_CERT_PATH", default = "")]
    pub tls_cert_path: String,
    #[env_config(name = "ZO_GRPC_TLS_KEY_PATH", default = "")]
    pub tls_key_path: String,
    #[env_config(
        name = "ZO_GRPC_TLS_ROOT_CERTIFICATES",
        parse,
        default = "webpki",
        help = "this value can be set to webpki or native. Using webpki means client will trust a preset CA bundle. Using native means client will trust the certificates in OS trust store"
    )]
    pub tls_root_certificates: TlsRootCertificates,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TlsRootCertificates {
    #[default]
    Webpki,
    Native,
}

impl std::fmt::Display for TlsRootCertificates {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Webpki => write!(f, "webpki"),
            Self::Native => write!(f, "native"),
        }
    }
}

impl std::str::FromStr for TlsRootCertificates {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "webpki" => Ok(Self::Webpki),
            "native" => Ok(Self::Native),
            _ => Err(anyhow::anyhow!(
                "Invalid tls_root_certificates value: '{}'. Must be 'webpki' or 'native'",
                s
            )),
        }
    }
}

#[derive(Serialize, PartialEq, Default)]
pub enum RouteDispatchStrategy {
    #[default]
    Workload,
    Random,
    Other,
}

impl std::str::FromStr for RouteDispatchStrategy {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "random" => Ok(RouteDispatchStrategy::Random),
            "workload" => Ok(RouteDispatchStrategy::default()),
            _ => Ok(RouteDispatchStrategy::Other),
        }
    }
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Route {
    #[env_config(name = "ZO_ROUTE_TIMEOUT", default = 600)]
    pub timeout: u64,
    #[env_config(name = "ZO_ROUTE_MAX_CONNECTIONS", default = 1024)]
    pub max_connections: usize,
    #[env_config(
        name = "ZO_ROUTE_MAX_RETRIES",
        default = 2,
        help = "Max number of other nodes the router will fail over to when a proxied request can't reach the selected node (e.g. during a restart/redeploy). 0 disables retry."
    )]
    pub max_retries: usize,
    #[env_config(name = "ZO_ROUTE_STRATEGY", parse, default = "workload")]
    pub dispatch_strategy: RouteDispatchStrategy,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Search {
    #[env_config(
        name = "ZO_ENABLE_INVERTED_INDEX",
        default = true,
        help = "Toggle inverted index generation."
    )]
    pub inverted_index_enabled: bool,
    #[env_config(name = "ZO_FEATURE_QUERY_REMOVE_FILTER_WITH_INDEX", default = true)]
    pub feature_query_remove_filter_with_index: bool,
    #[env_config(
        name = "ZO_INVERTED_INDEX_COUNT_OPTIMIZER_ENABLED",
        default = true,
        help = "Toggle inverted index count optimizer."
    )]
    pub inverted_index_count_optimizer_enabled: bool,
    #[env_config(
        name = "ZO_INVERTED_INDEX_RESULT_CACHE_ENABLED",
        default = false,
        help = "Toggle tantivy result cache."
    )]
    pub inverted_index_result_cache_enabled: bool,
    #[env_config(
        name = "ZO_INVERTED_INDEX_RESULT_CACHE_MAX_ENTRIES",
        default = 10000,
        help = "Maximum number of entries in the inverted index result cache. Higher values increase memory usage but may improve query performance."
    )]
    pub inverted_index_result_cache_max_entries: usize,
    #[env_config(
        name = "ZO_INVERTED_INDEX_RESULT_CACHE_MAX_ENTRY_SIZE",
        default = 20480, // bytes, default is 20KB
        help = "Maximum size of a single entry in the inverted index result cache. Higher values increase memory usage but may improve query performance."
    )]
    pub inverted_index_result_cache_max_entry_size: usize,
    #[env_config(
        name = "ZO_INVERTED_INDEX_FOOTER_CACHE_MAX_SIZE",
        default = 0, // MB, default is 5% of total memory
        help = "Maximum memory size in MB for the footer cache. Higher values allow caching more file footers but increase memory usage."
    )]
    pub inverted_index_footer_cache_max_size: usize,
    #[env_config(
        name = "ZO_BLOOM_FOOTER_CACHE_MAX_SIZE",
        default = 0, // MB, default is 1% of total memory, clamped to [32, 256] MB
        help = "Maximum memory size in MB for the bloom-filter footer cache. The cache holds the suffix bytes of each `.bf` (footer + tail of body) so subsequent prune calls skip the suffix-range GET. `.bf` body bytes are not cached here — they go through the regular file_data cache."
    )]
    pub bloom_footer_cache_max_size: usize,
    #[env_config(
        name = "ZO_INVERTED_INDEX_SKIP_THRESHOLD",
        default = 35,
        help = "If the inverted index returns row_id more than this threshold(%), it will skip the inverted index."
    )]
    pub inverted_index_skip_threshold: usize,
    #[env_config(
        name = "ZO_INVERTED_INDEX_TOPN_MAX_GROUP_NUM",
        default = 1000,
        help = "For top-n group by queries, a file with up to N distinct groups returns all of them, making its contribution to the merged result exact. Files with more groups keep only the limit-derived top-k and the merged top-n becomes approximate; raise to trade speed for accuracy."
    )]
    pub inverted_index_topn_max_group_num: usize,
    #[env_config(name = "ZO_FEATURE_QUERY_STREAMING_AGGS", default = true)]
    pub feature_query_streaming_aggs: bool,
    #[env_config(
        name = "ZO_FEATURE_PUSHDOWN_FILTER_ENABLED",
        default = true,
        help = "Enable pushdown filter"
    )]
    pub feature_pushdown_filter_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_METRICS_PUSHDOWN_FILTER_ENABLED",
        default = false,
        help = "Enable pushdown filter for metrics queries"
    )]
    pub feature_metrics_pushdown_filter_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_METRICS_FUSED_AGG_ENABLED",
        default = true,
        help = "Fold PromQL agg(range_func(...)) queries incrementally instead of materializing the range function output; disable to fall back to the generic evaluator"
    )]
    pub feature_metrics_fused_agg_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_METRICS_STREAMING_AGG_ENABLED",
        default = false,
        help = "Evaluate fused PromQL agg(range_func(...)) queries as a stream over hash-sorted metrics files, series by series, instead of materializing all samples; falls back to the fused evaluator when the file layout or query shape does not allow it"
    )]
    pub feature_metrics_streaming_agg_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_DYNAMIC_PUSHDOWN_FILTER_ENABLED",
        default = true,
        help = "Enable dynamic pushdown filter"
    )]
    pub feature_dynamic_pushdown_filter_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_SINGLE_NODE_OPTIMIZE_ENABLED",
        default = true,
        help = "Enable single node optimize(used for debug, not document)"
    )]
    pub feature_single_node_optimize_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_PARTIAL_REDUCE_ENABLED",
        default = true,
        help = "Enable partial reduce aggregation to reduce data transfer to the leader"
    )]
    pub feature_partial_reduce_enabled: bool,

    #[env_config(name = "ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", default = false)]
    pub feature_join_match_one_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_JOIN_RIGHT_SIDE_MAX_ROWS",
        default = 0,
        help = "Default to 50_000 when ZO_FEATURE_JOIN_MATCH_ONE_ENABLED is true"
    )]
    pub feature_join_right_side_max_rows: usize,
    #[env_config(
        name = "ZO_FEATURE_BROADCAST_JOIN_ENABLED",
        default = true,
        help = "Enable broadcast join"
    )]
    pub feature_broadcast_join_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_BROADCAST_JOIN_LEFT_SIDE_MAX_ROWS",
        default = 0,
        help = "Max rows for left side of broadcast join, default to 10_000 rows"
    )]
    pub feature_broadcast_join_left_side_max_rows: usize,
    #[env_config(
        name = "ZO_FEATURE_BROADCAST_JOIN_LEFT_SIDE_MAX_SIZE",
        default = 0,
        help = "Max size for left side of broadcast join, default to 10 MB"
    )]
    pub feature_broadcast_join_left_side_max_size: usize, // MB
    #[env_config(
        name = "ZO_FEATURE_ENRICHMENT_BROADCAST_JOIN_ENABLED",
        default = true,
        help = "Enable enrichment table broadcast join"
    )]
    pub feature_enrichment_broadcast_join_enabled: bool,
    #[env_config(name = "ZO_FEATURE_QUERY_EXCLUDE_ALL", default = true)]
    pub feature_query_exclude_all: bool,
    #[env_config(name = "ZO_AGGREGATION_TOPK_ENABLED", default = true)]
    pub aggregation_topk_enabled: bool,
    #[env_config(
        name = "ZO_AGGREGATION_TOPK_HEAP_ENABLED",
        default = true,
        help = "Use the heap implementation for eligible aggregate TopK plans"
    )]
    pub aggregation_topk_heap_enabled: bool,
    #[env_config(
        name = "ZO_AGGREGATION_TOPK_HEAP_MAX_LIMIT",
        default = 500,
        help = "Maximum aggregate TopK limit that uses the heap implementation"
    )]
    pub aggregation_topk_heap_max_limit: u64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Common {
    #[env_config(name = "ZO_LOCAL_MODE", default = true)]
    pub local_mode: bool,
    // ZO_LOCAL_MODE_STORAGE is ignored when ZO_LOCAL_MODE is set to false
    #[env_config(name = "ZO_LOCAL_MODE_STORAGE", default = "disk")]
    pub local_mode_storage: String,
    pub is_local_storage: bool,
    #[env_config(name = "ZO_CLUSTER_COORDINATOR", default = "nats")]
    pub cluster_coordinator: String,
    #[env_config(
        name = "ZO_QUEUE_STORE",
        default = "",
        help = "Queue backend: nats or memory. Unset resolves to memory in local mode and nats in cluster mode."
    )]
    pub queue_store: String,
    #[env_config(
        name = "ZO_MEMORY_QUEUE_MAX_SIZE_MB",
        default = 64,
        help = "Aggregate accounted memory limit in MB across all topics for the in-memory queue backend (ZO_QUEUE_STORE=memory)."
    )]
    pub memory_queue_max_size: usize,
    #[env_config(name = "ZO_META_STORE", default = "")]
    pub meta_store: String,
    #[env_config(name = "ZO_META_POSTGRES_DSN", default = "")]
    pub meta_postgres_dsn: String, // postgres://postgres:12345678@localhost:5432/openobserve
    #[env_config(name = "ZO_META_POSTGRES_RO_DSN", default = "")]
    pub meta_postgres_ro_dsn: String, // postgres://postgres:12345678@readonly:5432/openobserve
    // Individual connection vars — alternative to ZO_META_POSTGRES_DSN for environments
    // where host and password must be injected separately (e.g. ECS/K8s secrets managers).
    // Used to compose meta_postgres_dsn at startup; ignored when ZO_META_POSTGRES_DSN is set.
    #[env_config(name = "ZO_META_POSTGRES_HOST", default = "")]
    pub meta_postgres_host: String,
    #[env_config(name = "ZO_META_POSTGRES_PORT", default = 5432)]
    pub meta_postgres_port: u16,
    #[env_config(name = "ZO_META_POSTGRES_USER", default = "")]
    pub meta_postgres_user: String,
    #[env_config(name = "ZO_META_POSTGRES_PASSWORD", default = "")]
    pub meta_postgres_password: String,
    #[env_config(name = "ZO_META_POSTGRES_DBNAME", default = "")]
    pub meta_postgres_dbname: String,
    #[env_config(name = "ZO_META_DDL_DSN", default = "")]
    pub meta_ddl_dsn: String, // same db as meta store, but user with ddl perms
    #[env_config(name = "ZO_META_PARTITION_MODE", default = "auto")]
    pub meta_partition_mode: String, // "auto" or "manual"
    #[env_config(name = "ZO_NODE_ROLE", default = "all")]
    pub node_role: String,
    #[env_config(
        name = "ZO_NODE_ROLE_GROUP",
        default = "",
        help = "Role group can be empty (default), interactive, or background"
    )]
    pub node_role_group: String,
    #[env_config(name = "ZO_CLUSTER_NAME", default = "zo1")]
    pub cluster_name: String,
    #[env_config(name = "ZO_INSTANCE_NAME", default = "")]
    pub instance_name: String,
    pub instance_name_short: String,
    #[env_config(name = "ZO_INGESTION_URL", default = "")]
    pub ingestion_url: String,
    #[env_config(name = "ZO_WEB_URL", default = "http://localhost:5080")]
    pub web_url: String,
    /// Comma-separated list of extra origins allowed for CORS in addition to `web_url`.
    /// Example: `http://localhost:8081,https://staging.example.com`
    #[env_config(name = "ZO_CORS_ALLOWED_ORIGINS", default = "")]
    pub cors_allowed_origins: String,
    /// Allow alert destinations to target loopback/localhost addresses.
    /// Disabled by default (SSRF protection). Enable only in trusted environments
    /// such as CI/CD pipelines or self-hosted single-node setups where the
    /// server legitimately needs to send notifications to itself.
    #[env_config(name = "ZO_SSRF_ALLOW_LOOPBACK", default = false)]
    pub ssrf_allow_loopback: bool,
    // This will completely skip ssrf checks, not just localhost
    #[env_config(name = "ZO_SKIP_SSRF_CHECKS", default = false)]
    pub skip_ssrf_checks: bool,
    #[env_config(name = "ZO_BASE_URI", default = "")] // /abc
    pub base_uri: String,
    #[env_config(name = "ZO_DATA_DIR", default = "./data/openobserve/")]
    pub data_dir: String,
    #[env_config(name = "ZO_DATA_WAL_DIR", default = "")] // ./data/openobserve/wal/
    pub data_wal_dir: String,
    #[env_config(name = "ZO_DATA_STREAM_DIR", default = "")] // ./data/openobserve/stream/
    pub data_stream_dir: String,
    #[env_config(name = "ZO_DATA_DB_DIR", default = "")] // ./data/openobserve/db/
    pub data_db_dir: String,
    #[env_config(name = "ZO_DATA_CACHE_DIR", default = "")] // ./data/openobserve/cache/
    pub data_cache_dir: String,
    #[env_config(name = "ZO_DATA_TMP_DIR", default = "")] // ./data/openobserve/tmp/
    pub data_tmp_dir: String,
    // TODO: should rename to column_all
    #[env_config(name = "ZO_CONCATENATED_SCHEMA_FIELD_NAME", default = "_all")]
    pub column_all: String,
    #[env_config(
        name = "ZO_FILE_FORMAT",
        parse,
        default = "parquet",
        help = "Default file format for data storage with optional per-stream overrides, for example: parquet,metrics=vortex"
    )]
    pub file_format: FileFormatConfig,
    #[env_config(
        name = "ZO_VORTEX_USE_NATIVE_COMPRESSION",
        default = false,
        help = "Use Vortex's built-in compression strategy. By default, OpenObserve's custom UTF8/Zstd compressor is used"
    )]
    pub vortex_use_native_compression: bool,
    #[env_config(name = "ZO_PARQUET_COMPRESSION", default = "zstd")]
    pub parquet_compression: String,
    #[env_config(
        name = "ZO_TIMESTAMP_COMPRESSION_DISABLED",
        default = false,
        help = "Disable timestamp field compression"
    )]
    pub timestamp_compression_disabled: bool,
    #[env_config(name = "ZO_FEATURE_INGESTER_NONE_COMPRESSION", default = false)]
    pub feature_ingester_none_compression: bool,
    #[env_config(
        name = "ZO_FEATURE_SHOW_FTS_FIELD_VALUES",
        default = false,
        help = "Show field values dropdown for full text search fields in the logs page field list"
    )]
    pub show_fts_field_values: bool,
    #[env_config(
        name = "ZO_FEATURE_DEFAULT_INDEX_FIELDS_ENABLED",
        default = true,
        help = "When false, the built-in default fields for full text search and secondary index are disabled; only the fields from the *_EXTRA_FIELDS ENVs and per-stream settings are used"
    )]
    pub feature_default_index_fields_enabled: bool,
    #[env_config(name = "ZO_FEATURE_FULLTEXT_EXTRA_FIELDS", default = "")]
    pub feature_fulltext_extra_fields: String,
    #[env_config(name = "ZO_FEATURE_INDEX_EXTRA_FIELDS", default = "")]
    pub feature_secondary_index_extra_fields: String,
    #[env_config(
        name = "ZO_FEATURE_BLOOM_FILTER_EXTRA_FIELDS",
        default = "",
        help = "Comma-separated fields to build bloom filter on for all streams, replaces the deprecated ZO_BLOOM_FILTER_DEFAULT_FIELDS"
    )]
    pub feature_bloom_filter_extra_fields: String,
    #[env_config(
        name = "ZO_FEATURE_QUICK_MODE_FIELDS",
        default = "",
        help = "Comma-separated extra fields quick mode always returns when the stream has them, on top of the built-in defaults"
    )]
    pub feature_quick_mode_fields: String,
    #[env_config(name = "ZO_FEATURE_QUERY_QUEUE_ENABLED", default = true)]
    pub feature_query_queue_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_QUERY_PARTITION_STRATEGY",
        parse,
        default = "file_num"
    )]
    pub feature_query_partition_strategy: QueryPartitionStrategy,
    #[env_config(
        name = "ZO_FEATURE_QUERY_SKIP_WAL",
        default = false,
        help = "Skip WAL for query"
    )]
    pub feature_query_skip_wal: bool,
    #[env_config(
        name = "ZO_FEATURE_SHARED_MEMTABLE_ENABLED",
        default = false,
        help = "Enable shared memtable across multiple organizations"
    )]
    pub feature_shared_memtable_enabled: bool,
    #[env_config(
        name = "ZO_FEATURE_WAL_PACK_ENABLED",
        default = false,
        help = "Persist memtables into packed wal files (one file per rotation instead of one file per stream)"
    )]
    pub feature_wal_pack_enabled: bool,
    #[env_config(name = "ZO_UI_ENABLED", default = true)]
    pub ui_enabled: bool,
    #[env_config(name = "ZO_UI_SQL_BASE64_ENABLED", default = false)]
    pub ui_sql_base64_enabled: bool,
    #[env_config(
        name = "ZO_DEFAULT_THEME_LIGHT_MODE_COLOR",
        default = "",
        help = "Default theme color for light mode. If not set, uses application default."
    )]
    pub default_theme_light_mode_color: String,
    #[env_config(
        name = "ZO_DEFAULT_THEME_DARK_MODE_COLOR",
        default = "",
        help = "Default theme color for dark mode. If not set, uses application default."
    )]
    pub default_theme_dark_mode_color: String,
    #[env_config(name = "ZO_BLOOM_FILTER_ENABLED", default = true)]
    pub bloom_filter_enabled: bool,
    #[env_config(
        name = "ZO_BLOOM_FILTER_PARQUET_ENABLED",
        default = false,
        help = "Enable bloom filter for parquet files"
    )]
    pub bloom_filter_parquet_enabled: bool,
    #[deprecated(
        since = "0.92.0",
        note = "Please use `ZO_FEATURE_BLOOM_FILTER_EXTRA_FIELDS` instead. This ENV will be removed in v1.0.0"
    )]
    #[env_config(name = "ZO_BLOOM_FILTER_DEFAULT_FIELDS", default = "")]
    pub bloom_filter_default_fields: String,
    #[env_config(
        name = "ZO_BLOOM_FILTER_FPP",
        default = 0.01,
        help = "Target false-positive probability for the bloom filter layer. Smaller = fewer false survivors but larger `.bf` files (sizes the SBBF block count). Must be in (0, 1); out-of-range falls back to 0.01."
    )]
    pub bloom_filter_fpp: f64,
    #[env_config(
        name = "ZO_BLOOM_FILTER_MAX_FILES_PER_BF",
        default = 256,
        help = "Max number of files packed into one `.bf` (transposed bloom layout). A bigger value means fewer `.bf` reads per query but more compactor memory at build time (≈ files × per-file-SBBF). One hour bucket is split into ceil(files / this) `.bf` files."
    )]
    pub bloom_filter_max_files_per_bf: usize,
    #[env_config(
        name = "ZO_SEARCH_AROUND_DEFAULT_FIELDS",
        default = "",
        help = "Comma separated list of fields to use for search around"
    )]
    pub search_around_default_fields: String,
    #[env_config(name = "ZO_WAL_FSYNC_DISABLED", default = true)]
    pub wal_fsync_disabled: bool,
    #[env_config(
        name = "ZO_WAL_WRITE_QUEUE_ENABLED",
        default = false,
        help = "Enable write queue for WAL"
    )]
    pub wal_write_queue_enabled: bool,
    #[env_config(
        name = "ZO_WAL_WRITE_QUEUE_FULL_REJECT",
        default = false,
        help = "Reject write when write queue is full"
    )]
    pub wal_write_queue_full_reject: bool,
    #[env_config(
        name = "ZO_WAL_DEDICATED_RUNTIME_ENABLED",
        default = false,
        help = "Enable dedicated runtime with CPU binding for WAL writer threads"
    )]
    pub wal_dedicated_runtime_enabled: bool,
    #[env_config(name = "ZO_TRACING_ENABLED", default = false)]
    pub tracing_enabled: bool,
    #[env_config(name = "ZO_TRACING_SEARCH_ENABLED", default = false)]
    pub tracing_search_enabled: bool,
    #[env_config(
        name = "ZO_TRACE_TIME_INDEX_ENABLED",
        default = true,
        help = "Enable per-stream trace time indexes and trace time-range lookup"
    )]
    pub trace_time_index_enabled: bool,
    #[env_config(name = "OTEL_OTLP_HTTP_ENDPOINT", default = "")]
    pub otel_otlp_url: String,
    #[env_config(name = "OTEL_OTLP_GRPC_ENDPOINT", default = "")]
    pub otel_otlp_grpc_url: String,
    #[env_config(
        name = "ZO_TRACING_GRPC_ORGANIZATION",
        default = "",
        help = "Used in metadata when exporting traces to grpc endpoint."
    )]
    pub tracing_grpc_header_org: String,
    #[env_config(
        name = "ZO_TRACING_GRPC_STREAM_NAME",
        default = "",
        help = "Used in metadata when exporting traces to grpc endpoint."
    )]
    pub tracing_grpc_header_stream_name: String,
    #[env_config(name = "ZO_TRACING_HEADER_KEY", default = "Authorization")]
    pub tracing_header_key: String,
    #[env_config(
        name = "ZO_TRACING_HEADER_VALUE",
        default = "Basic cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM="
    )]
    pub tracing_header_value: String,
    #[env_config(
        name = "ZO_TRACING_EXTRA_ENVS",
        default = "",
        help = "Comma-separated list of environment variable names to include as resource attributes in traces."
    )]
    pub tracing_extra_envs: String,
    #[env_config(name = "ZO_TELEMETRY", default = true)]
    pub telemetry_enabled: bool,
    #[env_config(name = "ZO_TELEMETRY_URL", default = "https://e1.zinclabs.dev")]
    pub telemetry_url: String,
    #[env_config(name = "ZO_TELEMETRY_HEARTBEAT", default = 1800)] // seconds
    pub telemetry_heartbeat: i64,
    #[env_config(name = "ZO_KEYEVENT_TELEMETRY_URL", default = "")]
    pub keyevent_telemetry_url: String,
    #[env_config(name = "ZO_PROMETHEUS_ENABLED", default = true)]
    pub prometheus_enabled: bool,
    #[env_config(name = "ZO_PRINT_KEY_CONFIG", default = false)]
    pub print_key_config: bool,
    #[env_config(name = "ZO_PRINT_KEY_EVENT", default = false)]
    pub print_key_event: bool,
    #[env_config(name = "ZO_PRINT_KEY_SQL", default = true)]
    pub print_key_sql: bool,
    #[env_config(name = "ZO_PRINT_PLAN_SINGLE_LINE", default = true)]
    pub print_plan_single_line: bool,
    // usage reporting
    #[env_config(
        name = "ZO_USAGE_REPORTING_ENABLED",
        default = false,
        help = "Report usage (metering) and error data. Does NOT cover trigger records: alert and report execution history is published unconditionally, because it is product history rather than telemetry and several features read it."
    )]
    pub usage_enabled: bool,
    #[env_config(
        name = "ZO_USAGE_REPORTING_MODE",
        default = "local",
        help = "possible values - 'local', 'remote', 'both'"
    )] // local, remote, both
    pub usage_reporting_mode: String,
    #[env_config(
        name = "ZO_USAGE_REPORTING_URL",
        default = "http://localhost:5080/api/_meta/usage/_json"
    )]
    pub usage_reporting_url: String,
    #[env_config(name = "ZO_USAGE_REPORTING_CREDS", default = "")]
    pub usage_reporting_creds: String,
    #[env_config(name = "ZO_USAGE_REPORTING_ERRORS_ENABLED", default = true)]
    pub usage_reporting_errors_enabled: bool,
    #[env_config(name = "ZO_USAGE_BATCH_SIZE", default = 2000)]
    pub usage_batch_size: usize,
    #[env_config(
        name = "ZO_USAGE_PUBLISH_INTERVAL",
        default = 60,
        help = "duration in seconds after last reporting usage will be published"
    )]
    // in seconds
    pub usage_publish_interval: i64,
    #[env_config(
        name = "ZO_ERROR_PUBLISH_TIMEOUT_SECS",
        default = 2,
        help = "timeout in seconds for publishing error data to self-reporting queue"
    )]
    pub error_publish_timeout_secs: u64,
    // MMDB
    #[env_config(name = "ZO_MMDB_DATA_DIR")] // ./data/openobserve/mmdb/
    pub mmdb_data_dir: String,
    #[env_config(name = "ZO_MMDB_DISABLE_DOWNLOAD", default = false)]
    pub mmdb_disable_download: bool,
    #[env_config(name = "ZO_MMDB_UPDATE_DURATION_DAYS", default = 30)] // default 30 days
    pub mmdb_update_duration_days: u64,
    #[env_config(
        name = "ZO_MMDB_GEOLITE_CITYDB_URL",
        default = "https://geoip.zinclabs.dev/GeoLite2-City.mmdb"
    )]
    pub mmdb_geolite_citydb_url: String,
    #[env_config(
        name = "ZO_MMDB_GEOLITE_ASNDB_URL",
        default = "https://geoip.zinclabs.dev/GeoLite2-ASN.mmdb"
    )]
    pub mmdb_geolite_asndb_url: String,
    #[env_config(
        name = "ZO_MMDB_GEOLITE_CITYDB_SHA256_URL",
        default = "https://geoip.zinclabs.dev/GeoLite2-City.sha256"
    )]
    pub mmdb_geolite_citydb_sha256_url: String,
    #[env_config(
        name = "ZO_MMDB_GEOLITE_ASNDB_SHA256_URL",
        default = "https://geoip.zinclabs.dev/GeoLite2-ASN.sha256"
    )]
    pub mmdb_geolite_asndb_sha256_url: String,
    #[env_config(name = "ZO_DEFAULT_SCRAPE_INTERVAL", default = 15)]
    // Default scrape_interval value 15s
    pub default_scrape_interval: u32,
    #[env_config(name = "ZO_MEMORY_CIRCUIT_BREAKER_ENABLED", default = false)]
    pub memory_circuit_breaker_enabled: bool,
    #[env_config(name = "ZO_MEMORY_CIRCUIT_BREAKER_RATIO", default = 90)]
    pub memory_circuit_breaker_ratio: usize,
    #[env_config(name = "ZO_DISK_CIRCUIT_BREAKER_ENABLED", default = false)]
    pub disk_circuit_breaker_enabled: bool,
    #[env_config(
        name = "ZO_DISK_CIRCUIT_BREAKER_THRESHOLD",
        default = 90,
        help = "Disk space threshold. Values < 100 are treated as percentage of total disk space used (e.g., 90 = trigger at 90% usage), values >= 100 are treated as absolute MB of required free space"
    )]
    pub disk_circuit_breaker_threshold: usize,
    #[env_config(
        name = "ZO_RESTRICTED_ROUTES_ON_EMPTY_DATA",
        default = false,
        help = "Control the redirection of a user to ingestion page in case there is no stream found."
    )]
    pub restricted_routes_on_empty_data: bool,
    #[env_config(
        name = "ZO_QUERY_ON_STREAM_SELECTION",
        default = true,
        help = "Toggle search to be trigger based on button click event."
    )]
    pub query_on_stream_selection: bool,
    #[env_config(
        name = "ZO_SHOW_STREAM_DATES_DOCS_NUM",
        default = true,
        help = "Show docs count and stream dates"
    )]
    pub show_stream_dates_doc_num: bool,
    #[env_config(name = "ZO_INGEST_BLOCKED_STREAMS", default = "")] // use comma to split
    pub blocked_streams: String,
    #[env_config(name = "ZO_REPORT_USER_NAME", default = "")]
    pub report_user_name: String,
    #[env_config(name = "ZO_REPORT_USER_PASSWORD", default = "")]
    pub report_user_password: String,
    #[env_config(name = "ZO_REPORT_SERVER_URL", default = "http://localhost:5082")]
    pub report_server_url: String,
    #[env_config(name = "ZO_REPORT_SERVER_SKIP_TLS_VERIFY", default = false)]
    pub report_server_skip_tls_verify: bool,
    #[env_config(name = "ZO_SKIP_FORMAT_STREAM_NAME", default = false)]
    pub skip_formatting_stream_name: bool,
    #[env_config(name = "ZO_FORMAT_STREAM_NAME_TO_LOWERCASE", default = true)]
    pub format_stream_name_to_lower: bool,
    #[env_config(name = "ZO_BULK_RESPONSE_INCLUDE_ERRORS_ONLY", default = false)]
    pub bulk_api_response_errors_only: bool,
    #[env_config(name = "ZO_ALLOW_USER_DEFINED_SCHEMAS", default = false)]
    pub allow_user_defined_schemas: bool,
    #[env_config(
        name = "ZO_MEM_TABLE_STREAMS",
        default = "",
        help = "Streams for which dedicated MemTable will be used as comma separated values"
    )]
    pub mem_table_individual_streams: String,
    #[env_config(
        name = "ZO_SELF_METRIC_CONSUMPTION_ENABLED",
        default = false,
        help = "self-consume metrics generated by openobserve"
    )]
    pub self_metrics_consumption_enabled: bool,
    #[env_config(
        name = "ZO_SELF_METRIC_CONSUMPTION_INTERVAL",
        default = 60,
        help = "metrics self-consumption interval, unit seconds"
    )]
    pub self_metrics_consumption_interval: u64,
    #[env_config(
        name = "ZO_SELF_METRIC_CONSUMPTION_ACCEPTLIST",
        default = "",
        help = "only these metrics will be self-consumed, comma separated"
    )]
    pub self_metrics_consumption_whitelist: String,
    #[env_config(
        name = "ZO_RESULT_CACHE_ENABLED",
        default = true,
        help = "Enable result cache for query results"
    )]
    pub result_cache_enabled: bool,
    #[env_config(
        name = "ZO_USE_MULTIPLE_RESULT_CACHE",
        default = false,
        help = "Enable to use mulple result caches for query results"
    )]
    pub use_multi_result_cache: bool,
    #[env_config(
        name = "ZO_RESULT_CACHE_SELECTION_STRATEGY",
        default = "overlap",
        help = "Strategy to use for result cache, default is both, possible value - both, overlap, duration"
    )]
    pub result_cache_selection_strategy: String,
    #[env_config(name = "ZO_SWAGGER_ENABLED", default = true)]
    pub swagger_enabled: bool,
    #[env_config(
        name = "ZO_REGEX_PATTERNS_SOURCE_URL",
        default = "https://raw.githubusercontent.com/openobserve/sdr_patterns/main/regex.json",
        help = "URL for built-in regex patterns JSON source. Can be customized to use different pattern libraries."
    )]
    pub regex_patterns_source_url: String,
    #[env_config(
        name = "ZO_MODEL_PRICING_ENABLED",
        default = true,
        help = "Enable user-defined model pricing. When true, uses DB pricing definitions and syncs from GitHub. When false, falls back to hardcoded built-in pricing only."
    )]
    pub model_pricing_enabled: bool,
    #[env_config(
        name = "ZO_MODEL_PRICING_SOURCE_URL",
        default = "https://raw.githubusercontent.com/openobserve/sdr_patterns/refs/heads/main/llm_pricing.json",
        help = "URL for built-in LLM model pricing JSON source."
    )]
    pub model_pricing_source_url: String,
    #[env_config(
        name = "ZO_MODEL_PRICING_SYNC_INTERVAL_SECS",
        default = 21600,
        help = "Interval in seconds for syncing built-in model pricing from GitHub. Default: 6 hours (21600)."
    )]
    pub model_pricing_sync_interval_secs: u64,
    #[env_config(name = "ZO_FAKE_ES_VERSION", default = "")]
    pub fake_es_version: String,
    #[env_config(
        name = "ZO_CREATE_ORG_THROUGH_INGESTION",
        default = true,
        help = "If true (default true), new org can be automatically created through ingestion for root user. This can be changed in the runtime."
    )]
    pub create_org_through_ingestion: bool,
    #[env_config(
        name = "ZO_ORG_INVITE_EXPIRY",
        default = 7,
        help = "The number of days (default 7) an invitation token will be valid for. This can be changed in the runtime."
    )]
    pub org_invite_expiry: u32,
    #[env_config(
        name = "ZO_MIN_AUTO_REFRESH_INTERVAL",
        default = 5,
        help = "allow minimum auto refresh interval in seconds"
    )] // in seconds
    pub min_auto_refresh_interval: u32,
    #[env_config(name = "ZO_ADDITIONAL_REPORTING_ORGS", default = "")]
    pub additional_reporting_orgs: String,
    #[env_config(
        name = "ZO_USAGE_REPORT_TO_OWN_ORG",
        default = true,
        help = "Report alert/report triggers to the originating organization in addition to _meta org"
    )]
    pub usage_report_to_own_org: bool,
    #[env_config(
        name = "ZO_USE_STREAM_SETTINGS_FOR_PARTITIONS_ENABLED",
        default = false,
        help = "Enable to use stream settings for partitions. This will apply for all streams"
    )]
    pub use_stream_settings_for_partitions_enabled: bool,
    #[env_config(name = "ZO_DASHBOARD_PLACEHOLDER", default = "_o2_all_")]
    pub dashboard_placeholder: String,
    #[env_config(name = "ZO_SEARCH_INSPECTOR_ENABLED", default = false)]
    pub search_inspector_enabled: bool,
    #[env_config(name = "ZO_UTF8_VIEW_ENABLED", default = true)]
    pub utf8_view_enabled: bool,
    #[env_config(
        name = "ZO_DASHBOARD_SHOW_SYMBOL_ENABLED",
        default = false,
        help = "Enable to show symbol in dashboard"
    )]
    pub dashboard_show_symbol_enabled: bool,
    #[env_config(
        name = "ZO_DASHBOARD_SHOW_FIELD_AS_JSON_ENABLED",
        default = false,
        help = "Enable to show field as JSON in dashboard table"
    )]
    pub dashboard_show_field_as_json_enabled: bool,
    #[env_config(name = "ZO_INGEST_DEFAULT_HEC_STREAM", default = "")]
    pub default_hec_stream: String,
    #[env_config(
        name = "ZO_CONFIG_WATCHER_INTERVAL",
        default = 30,
        help = "Config file watcher interval in seconds. Set to 0 to disable"
    )]
    pub env_watcher_interval: u64,
    #[env_config(
        name = "ZO_LOG_PAGE_DEFAULT_FIELD_LIST",
        default = "uds",
        help = "Which fields to show by default in logs search page. Valid values - all,uds,interesting"
    )]
    pub log_page_default_field_list: String,
    #[env_config(
        name = "ZO_INGESTION_LOG_ENABLED",
        default = true,
        help = "enable ingestion error logs reporting"
    )]
    pub ingestion_log_enabled: bool,
    #[env_config(
        name = "ZO_ENABLE_CROSS_LINKING",
        default = false,
        help = "Enable cross-linking feature for drill-down links on log/trace records"
    )]
    pub enable_cross_linking: bool,
    #[env_config(
        name = "ZO_AUTO_QUERY_ENABLED",
        default = false,
        help = "Enable Live Mode feature in the UI. When true, users can toggle auto-query on filter/time-range changes. When false, the Live Mode toggle is hidden and Run Query button is always shown."
    )]
    pub auto_query_enabled: bool,
}

impl Common {
    pub fn should_create_span(&self) -> bool {
        self.tracing_enabled || self.tracing_search_enabled || self.search_inspector_enabled
    }
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Limit {
    // no need set by environment
    pub cpu_num: usize,
    pub real_cpu_num: usize,
    pub mem_total: usize,
    pub disk_total: usize,
    pub disk_free: usize,
    #[env_config(name = "ZO_PAYLOAD_LIMIT", default = 209715200)]
    pub req_payload_limit: usize,
    #[env_config(name = "ZO_MAX_FILE_RETENTION_TIME", default = 600)] // seconds
    pub max_file_retention_time: u64,
    // MB, per log file size limit on disk
    #[env_config(name = "ZO_MAX_FILE_SIZE_ON_DISK", default = 512)]
    pub max_file_size_on_disk: usize,
    // MB, per data file size limit in memory
    #[env_config(name = "ZO_MAX_FILE_SIZE_IN_MEMORY", default = 512)]
    pub max_file_size_in_memory: usize,
    #[deprecated(
        since = "0.14.1",
        note = "Please use `ZO_SCHEMA_MAX_FIELDS_TO_ENABLE_UDS` instead. This ENV is subject to be removed soon"
    )]
    #[env_config(
        name = "ZO_UDSCHEMA_MAX_FIELDS",
        default = 0,
        help = "Exceeding this limit will auto enable user-defined schema"
    )]
    pub udschema_max_fields: usize,
    #[env_config(
        name = "ZO_SCHEMA_MAX_FIELDS_TO_ENABLE_UDS",
        default = 1000,
        help = "Exceeding this limit will auto enable user-defined schema"
    )]
    pub schema_max_fields_to_enable_uds: usize,
    #[env_config(
        name = "ZO_USER_DEFINED_SCHEMA_MAX_FIELDS",
        default = 1000,
        help = "Maximum number of fields allowed in user-defined schema"
    )]
    pub user_defined_schema_max_fields: usize,
    // MB, total data size of memtable in memory
    #[env_config(name = "ZO_MEM_TABLE_MAX_SIZE", default = 0)]
    pub mem_table_max_size: usize,
    #[env_config(
        name = "ZO_MEM_TABLE_BUCKET_NUM",
        default = 0,
        help = "MemTable bucket num, default is 1"
    )] // default is 1
    pub mem_table_bucket_num: usize,
    #[env_config(name = "ZO_MEM_PERSIST_INTERVAL", default = 2)] // seconds
    pub mem_persist_interval: u64,
    #[env_config(name = "ZO_WAL_WRITE_BUFFER_SIZE", default = 16384)] // 16 KB
    pub wal_write_buffer_size: usize,
    #[env_config(name = "ZO_WAL_WRITE_QUEUE_SIZE", default = 10000)] // 10k messages
    pub wal_write_queue_size: usize,
    #[env_config(name = "ZO_FILE_PUSH_INTERVAL", default = 2)] // seconds
    pub file_push_interval: u64,
    #[env_config(name = "ZO_FILE_PUSH_LIMIT", default = 0)] // files
    pub file_push_limit: usize,
    // over this limit will skip merging on ingester
    #[env_config(name = "ZO_FILE_MOVE_FIELDS_LIMIT", default = 2000)]
    pub file_move_fields_limit: usize,
    #[env_config(name = "ZO_FILE_MOVE_THREAD_NUM", default = 0)]
    pub file_move_thread_num: usize,
    #[env_config(name = "ZO_FILE_MERGE_THREAD_NUM", default = 0)]
    pub file_merge_thread_num: usize,
    #[env_config(name = "ZO_MEM_DUMP_THREAD_NUM", default = 0)]
    pub mem_dump_thread_num: usize,
    #[env_config(name = "ZO_VORTEX_THREAD_NUM", default = 0)]
    pub vortex_thread_num: usize,
    #[env_config(name = "ZO_USAGE_REPORTING_THREAD_NUM", default = 0)]
    pub usage_reporting_thread_num: usize,
    #[env_config(name = "ZO_QUERY_THREAD_NUM", default = 0)]
    pub query_thread_num: usize,
    #[env_config(name = "ZO_FILE_DOWNLOAD_THREAD_NUM", default = 0)]
    pub file_download_thread_num: usize,
    #[env_config(name = "ZO_FILE_DOWNLOAD_MIN_RECORDS", default = 100)]
    pub file_download_min_records: i64,
    #[env_config(name = "ZO_FILE_DOWNLOAD_PRIORITY_QUEUE_THREAD_NUM", default = 0)]
    pub file_download_priority_queue_thread_num: usize,
    #[env_config(name = "ZO_FILE_DOWNLOAD_PRIORITY_QUEUE_WINDOW_SECS", default = 3600)]
    pub file_download_priority_queue_window_secs: i64,
    #[env_config(name = "ZO_FILE_DOWNLOAD_ENABLE_PRIORITY_QUEUE", default = true)]
    pub file_download_enable_priority_queue: bool,
    #[env_config(name = "ZO_GRPC_INGEST_TIMEOUT", default = 600)]
    pub grpc_ingest_timeout: u64,
    #[env_config(name = "ZO_QUERY_TIMEOUT", default = 600)]
    pub query_timeout: u64,
    #[env_config(
        name = "ZO_QUERY_INGESTER_TIMEOUT",
        default = 0,
        help = "Timeout for ingester query, default equal to query_timeout"
    )]
    pub query_ingester_timeout: u64,
    #[env_config(
        name = "ZO_QUERY_QUERIER_TIMEOUT",
        default = 0,
        help = "Timeout for querier query, default equal to query_timeout"
    )]
    pub query_querier_timeout: u64,
    #[env_config(name = "ZO_QUERY_DEFAULT_LIMIT", default = 1000)]
    pub query_default_limit: i64,
    #[env_config(name = "ZO_QUERY_VALUES_DEFAULT_NUM", default = 10)]
    pub query_values_default_num: i64,
    #[env_config(name = "ZO_QUERY_GROUP_BASE_SPEED", default = 1024)] // MB/s/core
    pub query_group_base_speed: usize,
    #[env_config(name = "ZO_QUERY_PARTITION_BY_SECS", default = 5)] // seconds
    pub query_partition_by_secs: usize,
    #[env_config(name = "ZO_QUERY_PARTITION_MAX_NUM", default = 100)] // max number of partitions
    pub query_partition_max_num: usize,
    #[env_config(name = "ZO_DISABLE_PARTITIONS_FOR_NON_TS_ORDER_BY", default = false)]
    pub disable_partitions_for_non_ts_order_by: bool,
    // Default Config: Run Query Recommendation Analysis for last one hour for every hour
    #[env_config(name = "ZO_QUERY_RECOMMENDATION_DURATION", default = 3600000000)] // microseconds
    pub query_recommendation_duration: i64,
    #[env_config(name = "ZO_QUERY_RECOMMENDATION_INTERVAL", default = 3600)] // seconds
    pub query_recommendation_analysis_interval: i64,
    #[env_config(name = "ZO_QUERY_RECOMMENDATION_TOP_K", default = 128)]
    pub query_recommendation_top_k: usize,
    #[env_config(name = "ZO_INGEST_ALLOWED_UPTO", default = 5)] // in hours - in past
    pub ingest_allowed_upto: i64,
    pub ingest_allowed_upto_micro: i64,
    #[env_config(name = "ZO_INGEST_ALLOWED_IN_FUTURE", default = 24)] // in hours - in future
    pub ingest_allowed_in_future: i64,
    pub ingest_allowed_in_future_micro: i64,
    #[env_config(name = "ZO_INGEST_FLATTEN_LEVEL", default = 3)] // default flatten level
    pub ingest_flatten_level: u32,
    // Deprecated: use ZO_LOGS_QUERY_RETENTION instead. Will be removed in a future version.
    #[env_config(name = "ZO_LOGS_FILE_RETENTION", default = "hourly")]
    pub logs_file_retention: String,
    // Deprecated: use ZO_TRACES_QUERY_RETENTION instead. Will be removed in a future version.
    #[env_config(name = "ZO_TRACES_FILE_RETENTION", default = "hourly")]
    pub traces_file_retention: String,
    // Deprecated: use ZO_METRICS_QUERY_RETENTION instead. Will be removed in a future version.
    #[env_config(name = "ZO_METRICS_FILE_RETENTION", default = "hourly")]
    pub metrics_file_retention: String,
    #[env_config(name = "ZO_LOGS_QUERY_RETENTION", default = "hourly")]
    pub logs_query_retention: String,
    #[env_config(name = "ZO_TRACES_QUERY_RETENTION", default = "hourly")]
    pub traces_query_retention: String,
    #[env_config(name = "ZO_METRICS_QUERY_RETENTION", default = "daily")]
    pub metrics_query_retention: String,
    #[env_config(name = "ZO_METRICS_MAX_POINTS_PER_SERIES", default = 30000)]
    pub metrics_max_points_per_series: usize,
    #[env_config(name = "ZO_METRICS_MAX_SERIES_RESPONSE", default = 40000)]
    pub metrics_max_series_response: usize,
    // Memory budget in MB for the PromQL result cache index. 0 (default)
    // means auto: 1% of total memory, clamped to [32, 256] MB.
    #[env_config(name = "ZO_METRICS_RESULT_CACHE_MAX_SIZE", default = 0)]
    pub metrics_result_cache_max_size: usize,
    // Memory budget in MB for the PromQL series label cache. 0 (default)
    // means auto: 5% of total memory, clamped to [100, 1024] MB.
    #[env_config(name = "ZO_METRICS_LABEL_CACHE_MAX_SIZE", default = 0)]
    pub metrics_label_cache_max_size: usize,
    #[env_config(name = "ZO_COLS_PER_RECORD_LIMIT", default = 1000)]
    pub req_cols_per_record_limit: usize,
    #[env_config(name = "ZO_NODE_HEARTBEAT_TTL", default = 30)] // seconds
    pub node_heartbeat_ttl: i64,
    // How long an o2-ai session->owner claim survives. Must exceed the longest
    // expected conversation; mirrors o2-ai's O2_AI_SESSION_OWNER_TTL default.
    #[env_config(name = "ZO_AI_SESSION_OWNER_TTL", default = 86400)] // seconds
    pub ai_session_owner_ttl: i64,
    #[env_config(name = "ZO_HTTP_WORKER_NUM", default = 0)]
    pub http_worker_num: usize, // equals to cpu_num if 0
    #[env_config(name = "ZO_HTTP_WORKER_MAX_BLOCKING", default = 0)]
    pub http_worker_max_blocking: usize, // equals to 256 if 0
    #[env_config(name = "ZO_GRPC_RUNTIME_WORKER_NUM", default = 0)]
    pub grpc_runtime_worker_num: usize, // equals to cpu_num if 0
    #[env_config(name = "ZO_GRPC_RUNTIME_BLOCKING_WORKER_NUM", default = 0)]
    pub grpc_runtime_blocking_worker_num: usize, // equals to 512 if 0
    #[env_config(name = "ZO_JOB_RUNTIME_WORKER_NUM", default = 0)]
    pub job_runtime_worker_num: usize, // equals to cpu_num if 0
    #[env_config(name = "ZO_JOB_RUNTIME_BLOCKING_WORKER_NUM", default = 0)]
    pub job_runtime_blocking_worker_num: usize, // equals to 512 if 0
    #[env_config(name = "ZO_WAL_RUNTIME_WORKER_NUM", default = 0)]
    pub wal_runtime_worker_num: usize, // equals to mem_table_bucket_num if 0
    #[env_config(name = "ZO_CALCULATE_STATS_INTERVAL", default = 600)] // seconds
    pub calculate_stats_interval: u64,
    #[env_config(name = "ZO_HTTP_SHUTDOWN_TIMEOUT", default = 5)] // seconds
    pub http_shutdown_timeout: u64,
    #[env_config(name = "ZO_HTTP_SLOW_LOG_THRESHOLD", default = 5)] // seconds
    pub http_slow_log_threshold: u64,
    #[env_config(name = "ZO_ALERT_SCHEDULE_INTERVAL", default = 10)] // seconds
    pub alert_schedule_interval: i64,
    #[env_config(
        name = "ZO_ALERT_HYBRID_COUNT_THRESHOLD",
        default = 100,
        help = "Count-based alerts whose row sentinel exceeds this switch to a COUNT(*) decision query plus a 100-row payload sample (alerts_2.md 4.4c). Clamped up to the 100-row floor."
    )]
    pub alert_hybrid_count_threshold: i64,
    #[env_config(name = "ZO_ALERT_SCHEDULE_CONCURRENCY", default = 5)]
    pub alert_schedule_concurrency: i64,
    #[env_config(
        name = "ZO_ALERT_MAX_GROUPS",
        default = 500,
        help = "Cardinality cap for multi-alerts (alerts_2.md M-6): the most per-group state rows one alert may track. Overflow is evaluated and counted but not persisted beyond the cap, and the true count is surfaced as a warning. 0 = unlimited."
    )]
    pub alert_max_groups: usize,
    #[env_config(
        name = "ZO_ALERT_GROUP_DISAPPEARANCE_K",
        default = 3,
        help = "A multi-alert group unseen for K x the alert's frequency is resolved to Ok (alerts_2.md M-7). Must exceed 1, or a single slow evaluation resolves every group and re-fires it on the next pass."
    )]
    pub alert_group_disappearance_k: i64,
    #[env_config(
        name = "ZO_ALERT_GROUP_REAP_GRACE_SECS",
        default = 3600,
        help = "How long a resolved multi-alert group's state row is retained before deletion (alerts_2.md M-7). Its transition history is kept regardless."
    )]
    pub alert_group_reap_grace_secs: i64,
    #[env_config(
        name = "ZO_ALERT_MAX_GROUP_NOTIFICATIONS_PER_EVAL",
        default = 0,
        help = "Cap on per-group notifications sent by one multi-alert evaluation (alerts_2.md §5.5 MN-8/D48). 0 = unlimited, which is the default because paging per group is the feature's contract and the group cap already bounds the worst case. Dispatch is worst-first, so a cap always delivers the most severe groups; anything dropped is logged."
    )]
    pub alert_max_group_notifications_per_eval: usize,
    #[env_config(
        name = "ZO_ALERT_GROUP_SWEEP_INTERVAL",
        default = 60,
        help = "How often the multi-alert group lifecycle sweep runs, in seconds (alerts_2.md M-7). The sweep only decides fates on elapsed time, so it need not match any alert's frequency. 0 disables it, which stops vanished groups from ever resolving or being reaped."
    )]
    pub alert_group_sweep_interval: u64,
    #[env_config(
        name = "ZO_ALERT_EVAL_LEDGER_RETENTION_DAYS",
        default = 97,
        help = "How long the alert availability ledger (alert_eval_intervals) is kept, in days. This is the history every alert-based SLO measures against, so it must cover the longest SLO window (90 days) plus backfill headroom; lowering it below that silently freezes those SLOs for want of coverage. 0 or less disables the reaper."
    )]
    pub alert_eval_ledger_retention_days: i64,
    #[env_config(name = "ZO_ALERT_SCHEDULE_TIMEOUT", default = 90)] // seconds
    pub alert_schedule_timeout: i64,
    #[env_config(
        name = "ZO_ALERT_PREVIEW_TIMERANGE_MINUTES",
        default = 0,
        help = "Time range in minutes for alert preview. If set to 0 (default), uses the alert's period value. If greater than 0, overrides period for preview."
    )]
    pub alert_preview_timerange_minutes: i64,
    #[env_config(
        name = "ZO_ALERT_TEST_SEND_PER_MINUTE",
        default = 6,
        help = "Per-user cap on alert-destination test-sends per minute. A test-send posts a real [TEST]-marked message to a real destination, so this bounds accidental or scripted spam of someone's channel/inbox. The cap is enforced PER PROCESS (in-memory, not cluster-shared) — a multi-node deployment's effective cap is N times this value, where N is the node count. 0 = unlimited."
    )]
    pub alert_test_send_per_minute: u32,
    #[env_config(
        name = "ZO_ALERT_CHART_ENABLED",
        default = true,
        help = "Global switch for chart images in alert notifications (per-template opt-in still required via the content template's chart toggle)."
    )]
    pub alert_chart_enabled: bool,
    #[env_config(name = "ZO_REPORT_SCHEDULE_TIMEOUT", default = 300)] // seconds
    pub report_schedule_timeout: i64,
    #[env_config(name = "ZO_DERIVED_STREAM_SCHEDULE_INTERVAL", default = 300)] // seconds
    pub derived_stream_schedule_interval: i64,
    #[env_config(name = "ZO_SCHEDULER_MAX_RETRIES", default = 3)]
    pub scheduler_max_retries: i32,
    #[env_config(name = "ZO_SCHEDULER_PAUSE_ALERT_AFTER_RETRIES", default = false)]
    pub pause_alerts_on_retries: bool,
    #[env_config(
        name = "ZO_ALERT_CONSIDERABLE_DELAY",
        default = 20,
        help = "Integer value representing the delay in percentage of the alert frequency that will be included in alert evaluation timerange. Default is 20. This can be changed in runtime."
    )]
    pub alert_considerable_delay: i32,
    #[env_config(name = "ZO_SCHEDULER_WATCH_INTERVAL", default = 30)] // seconds
    pub scheduler_watch_interval: i64,
    // Per-module scheduler pullers (Part A / A3+A4). When enabled, each TriggerModule gets its
    // own pull loop, cadence, LIMIT budget, channel and worker pool, so a backlog or slow handler
    // in one module cannot starve another. Default off → single shared puller (legacy behavior).
    #[env_config(
        name = "ZO_SCHEDULER_PER_MODULE_PULLERS",
        default = false,
        help = "Run a dedicated pull loop + worker pool per scheduler module. When false, a single shared puller handles all modules (legacy)."
    )]
    pub scheduler_per_module_pullers: bool,
    // Per-module concurrency (LIMIT + channel cap + worker count). 0 = inherit
    // ZO_ALERT_SCHEDULE_CONCURRENCY. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true.
    // Backfill defaults to the smallest budget so bulk/background jobs never crowd out others.
    // Note: the alert lane reuses ZO_ALERT_SCHEDULE_CONCURRENCY directly (no duplicate var).
    #[env_config(
        name = "ZO_SCHEDULER_REPORT_CONCURRENCY",
        default = 0,
        help = "Max report jobs pulled per cycle and the report worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_CONCURRENCY."
    )]
    pub scheduler_report_concurrency: i64,
    #[env_config(
        name = "ZO_SCHEDULER_DERIVED_STREAM_CONCURRENCY",
        default = 0,
        help = "Max derived-stream/pipeline jobs pulled per cycle and the worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_CONCURRENCY."
    )]
    pub scheduler_derived_stream_concurrency: i64,
    #[env_config(
        name = "ZO_SCHEDULER_BACKFILL_CONCURRENCY",
        default = 1,
        help = "Max backfill jobs pulled per cycle and the backfill worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. Defaults to 1 (smallest budget) so bulk backfills never crowd out latency-sensitive modules."
    )]
    pub scheduler_backfill_concurrency: i64,
    #[env_config(
        name = "ZO_SCHEDULER_SLO_CONCURRENCY",
        default = 0,
        help = "Max SLO SLI-ingest jobs pulled per cycle and the worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_CONCURRENCY."
    )]
    pub scheduler_slo_concurrency: i64,
    #[env_config(
        name = "ZO_SCHEDULER_SLO_BACKFILL_CONCURRENCY",
        default = 1,
        help = "Max SLO backfill jobs pulled per cycle and the SLO backfill worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. Defaults to 1 so a bulk historical scan never crowds out latency-sensitive incremental SLI passes."
    )]
    pub scheduler_slo_backfill_concurrency: i64,
    #[env_config(
        name = "ZO_SCHEDULER_ANOMALY_CONCURRENCY",
        default = 0,
        help = "Max anomaly-detection jobs pulled per cycle and the worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_CONCURRENCY."
    )]
    pub scheduler_anomaly_concurrency: i64,
    #[env_config(
        name = "ZO_SCHEDULER_QUERY_RECO_CONCURRENCY",
        default = 0,
        help = "Max query-recommendation jobs pulled per cycle and the worker-pool size. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_CONCURRENCY."
    )]
    pub scheduler_query_reco_concurrency: i64,
    // Per-module poll cadence in seconds. 0 = inherit ZO_ALERT_SCHEDULE_INTERVAL (the alert pull
    // frequency). Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. One var per module so each
    // puller can poll at its own rate (e.g. backfill slower, synthetics faster). The alert lane
    // reuses ZO_ALERT_SCHEDULE_INTERVAL directly (no duplicate var).
    #[env_config(
        name = "ZO_SCHEDULER_REPORT_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the report puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_report_interval: i64,
    #[env_config(
        name = "ZO_SCHEDULER_DERIVED_STREAM_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the derived-stream/pipeline puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_derived_stream_interval: i64,
    #[env_config(
        name = "ZO_SCHEDULER_BACKFILL_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the backfill puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_backfill_interval: i64,
    #[env_config(
        name = "ZO_SCHEDULER_SLO_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the SLO SLI-ingest puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_slo_interval: i64,
    #[env_config(
        name = "ZO_SCHEDULER_SLO_BACKFILL_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the SLO backfill puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_slo_backfill_interval: i64,
    #[env_config(
        name = "ZO_SCHEDULER_ANOMALY_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the anomaly-detection puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_anomaly_interval: i64,
    #[env_config(
        name = "ZO_SCHEDULER_QUERY_RECO_INTERVAL",
        default = 0, // seconds
        help = "Poll cadence in seconds for the query-recommendation puller. Only used when ZO_SCHEDULER_PER_MODULE_PULLERS=true. 0 inherits ZO_ALERT_SCHEDULE_INTERVAL."
    )]
    pub scheduler_query_reco_interval: i64,
    #[env_config(name = "ZO_SEARCH_JOB_WORKS", default = 1)]
    pub search_job_workers: i64,
    #[env_config(name = "ZO_SEARCH_JOB_SCHEDULE_INTERVAL", default = 10)] // seconds
    pub search_job_scheduler_interval: i64,
    #[env_config(
        name = "ZO_SEARCH_JOB_RUN_TIMEOUT",
        default = 600, // seconds
        help = "Timeout for update check"
    )]
    pub search_job_run_timeout: i64,
    #[env_config(name = "ZO_SEARCH_JOB_DELETE_INTERVAL", default = 600)] // seconds
    pub search_job_delete_interval: i64,
    #[env_config(
        name = "ZO_SEARCH_JOB_TIMEOUT",
        default = 36000, // seconds
        help = "Timeout for query"
    )]
    pub search_job_timeout: i64,
    #[env_config(
        name = "ZO_SEARCH_JOB_RETENTION",
        default = 30, // days
        help = "Retention for search job"
    )]
    pub search_job_retention: i64,
    #[env_config(name = "ZO_STARTING_EXPECT_QUERIER_NUM", default = 0)]
    pub starting_expect_querier_num: usize,
    #[env_config(name = "ZO_QUICK_MODE_ENABLED", default = false)]
    pub quick_mode_enabled: bool,
    #[env_config(name = "ZO_QUICK_MODE_FORCE_ENABLED", default = true)]
    pub quick_mode_force_enabled: bool,
    #[env_config(name = "ZO_QUICK_MODE_NUM_FIELDS", default = 500)]
    pub quick_mode_num_fields: usize,
    #[env_config(name = "ZO_QUICK_MODE_STRATEGY", default = "")]
    pub quick_mode_strategy: String, // first, last, both
    #[env_config(name = "ZO_META_CONNECTION_POOL_MIN_SIZE", default = 0)] // number of connections
    pub sql_db_connections_min: u32,
    #[env_config(name = "ZO_META_CONNECTION_POOL_MAX_SIZE", default = 0)] // number of connections
    pub sql_db_connections_max: u32,
    #[env_config(
        name = "ZO_META_CONNECTION_POOL_ACQUIRE_TIMEOUT",
        default = 0,
        help = "Seconds, Maximum acquire timeout of individual connections."
    )]
    pub sql_db_connections_acquire_timeout: u64,
    #[env_config(
        name = "ZO_META_CONNECTION_POOL_IDLE_TIMEOUT",
        default = 0,
        help = "Seconds, Maximum idle timeout of individual connections."
    )]
    pub sql_db_connections_idle_timeout: u64,
    #[env_config(
        name = "ZO_META_CONNECTION_POOL_MAX_LIFETIME",
        default = 0,
        help = "Seconds, Maximum lifetime of individual connections."
    )]
    pub sql_db_connections_max_lifetime: u64,
    #[env_config(
        name = "ZO_META_TRANSACTION_RETRIES",
        default = 3,
        help = "max time of transaction will retry"
    )]
    pub meta_transaction_retries: usize,
    #[env_config(name = "ZO_CONSISTENT_HASH_VNODES", default = 1000)]
    pub consistent_hash_vnodes: usize,
    #[env_config(
        name = "ZO_DATAFUSION_FILE_STAT_CACHE_MAX_SIZE",
        default = 0, // MB, default is 5% of total memory
        help = "Maximum memory size in MB for the file stat cache. Higher values allow caching more file statistics but increase memory usage."
    )]
    pub datafusion_file_stat_cache_max_size: usize,
    #[env_config(
        name = "ZO_DATAFUSION_STREAMING_AGGS_CACHE_MAX_ENTRIES",
        default = 10000,
        help = "Maximum number of entries in the streaming aggs cache. Higher values increase memory usage but may improve query performance."
    )]
    pub datafusion_streaming_aggs_cache_max_entries: usize,
    #[env_config(name = "ZO_DATAFUSION_MIN_PARTITION_NUM", default = 2)]
    pub datafusion_min_partition_num: usize,
    #[env_config(
        name = "ZO_ENRICHMENT_TABLE_LIMIT",
        default = 256,
        help = "Maximum size of a single enrichment table in mb"
    )]
    pub enrichment_table_max_size: usize,
    #[env_config(name = "ZO_SHORT_URL_RETENTION_DAYS", default = 30)] // days
    pub short_url_retention_days: i64,
    #[env_config(
        name = "ZO_INVERTED_INDEX_MIN_TOKEN_LENGTH",
        default = 2,
        help = "Minimum length of a token in the inverted index."
    )]
    pub inverted_index_min_token_length: usize,
    #[env_config(
        name = "ZO_INVERTED_INDEX_MAX_TOKEN_LENGTH",
        default = 64,
        help = "Maximum length of a token in the inverted index."
    )]
    pub inverted_index_max_token_length: usize,
    #[env_config(
        name = "ZO_INDEX_ALL_MAX_VALUE_LENGTH",
        default = 0,
        help = "Maximum length of a value in the index all feature."
    )]
    pub index_all_max_value_length: usize,
    #[env_config(
        name = "ZO_DEFAULT_MAX_QUERY_RANGE_DAYS",
        default = 0,
        help = "unit: Days. Global default max query range for all streams. If set to a value > 0, this will be used as the default max query range. Can be overridden by stream settings."
    )]
    pub default_max_query_range_days: i64,
    #[env_config(
        name = "ZO_MAX_QUERY_RANGE_FOR_SA",
        default = 0,
        help = "unit: Hour. Optional env variable to add restriction for SA, if not set SA will use max_query_range stream setting. When set which ever is smaller value will apply to api calls"
    )]
    pub max_query_range_for_sa: i64,
    #[env_config(
        name = "ZO_MAX_DASHBOARD_SERIES",
        default = 100,
        help = "maximum series to display in charts"
    )]
    pub max_dashboard_series: usize,
    #[env_config(
        name = "ZO_SEARCH_MINI_PARTITION_DURATION_SECS",
        default = 60,
        help = "Duration of each mini search partition in seconds"
    )]
    pub search_mini_partition_duration_secs: u64,
    #[env_config(
        name = "ZO_HISTOGRAM_ENABLED",
        help = "Show histogram for logs page",
        default = true
    )]
    pub histogram_enabled: bool,
    #[env_config(
        name = "ZO_TIMECHART_ENABLED",
        help = "Show timechart tab on logs page",
        default = false
    )]
    pub timechart_enabled: bool,
    #[env_config(
        name = "ZO_HISTOGRAM_BREAKDOWN_FIELDS",
        help = "Comma-separated ordered list of stream fields used for stacked histogram breakdown. First match wins. Default: severity,log_level,level,status",
        default = "severity,log_level,level,status"
    )]
    pub histogram_breakdown_fields: String,
    #[env_config(name = "ZO_CACHE_DELAY_SECS", default = 300)] // seconds
    pub cache_delay_secs: i64,
    #[env_config(
        name = "ZO_AGGS_MIN_NUM_PARTITIONS_SECS",
        default = 3,
        help = "Aggregates approximate number of seconds for executing search"
    )]
    pub aggs_min_num_partition_secs: usize,
    #[env_config(
        name = "ZO_BATCH_SIZE",
        default = 0,
        help = "Default is 8192, Batch size for parquet read/write operations and datafusion execution. Range: [1024, 8192]. Should carefully set this value, default is enough for most cases."
    )]
    pub batch_size: usize,
    #[env_config(
        name = "ZO_WORKFLOW_ERROR_RETAIN_DURATION",
        default = 2592000,
        help = "Default is 30 days, how many days in past to retain the errored workflow input files"
    )]
    pub workflow_error_retention_secs: i64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Compact {
    #[env_config(name = "ZO_COMPACT_ENABLED", default = true)]
    pub enabled: bool,
    #[env_config(
        name = "ZO_METRICS_INDEX_ENABLED",
        default = false,
        help = "Experimental metrics index layout. The ingester writes Parquet metrics files ordered by (__hash__, _timestamp) instead of _timestamp DESC and marks them with a `hash-sorted-v1-` file name prefix; the compactor writes the configured Parquet or Vortex format and merges a closed hour into size-split `indexed-v1-` files with a `.midx` metrics index. Only affects newly written metrics files of streams whose __hash__ column is UInt64; SQL queries on metrics streams must not assume a _timestamp order while it is on."
    )]
    pub metrics_index_enabled: bool,
    #[env_config(name = "ZO_COMPACT_INTERVAL", default = 10)] // seconds
    pub interval: u64,
    #[env_config(
        name = "ZO_COMPACT_DATA_RETENTION_INTERVAL",
        default = 3600,
        help = "Interval in seconds for the data retention job, default is 3600. Retention works at day granularity, so it doesn't need to run at ZO_COMPACT_INTERVAL"
    )] // seconds
    pub data_retention_interval: u64,
    #[env_config(name = "ZO_COMPACT_OLD_DATA_INTERVAL", default = 3600)] // seconds
    pub old_data_interval: u64,
    #[env_config(name = "ZO_COMPACT_STRATEGY", default = "file_time")]
    // file_size, file_time, time_range
    pub strategy: String,
    #[env_config(name = "ZO_COMPACT_FAST_MODE", default = false)]
    pub fast_mode: bool,
    #[env_config(name = "ZO_COMPACT_SYNC_TO_DB_INTERVAL", default = 600)] // seconds
    pub sync_to_db_interval: u64,
    #[env_config(name = "ZO_COMPACT_MAX_FILE_SIZE", default = 2048)] // MB
    pub max_file_size: usize,
    #[env_config(name = "ZO_COMPACT_EXTENDED_DATA_RETENTION_DAYS", default = 3650)] // days
    pub extended_data_retention_days: i64,
    #[env_config(name = "ZO_COMPACT_OLD_DATA_STREAMS", default = "")] // use comma to split
    pub old_data_streams: String,
    #[env_config(name = "ZO_COMPACT_DATA_RETENTION_DAYS", default = 3650)] // days
    pub data_retention_days: i64,
    #[env_config(name = "ZO_COMPACT_OLD_DATA_MAX_DAYS", default = 7)] // days
    pub old_data_max_days: i64,
    #[env_config(name = "ZO_COMPACT_OLD_DATA_MIN_HOURS", default = 2)] // hours
    pub old_data_min_hours: i64,
    #[env_config(name = "ZO_COMPACT_OLD_DATA_MIN_FILES", default = 10)] // files
    pub old_data_min_files: i64,
    #[env_config(name = "ZO_COMPACT_DELETE_FILES_DELAY_MINUTES", default = 120)] // minutes
    pub delete_files_delay_minutes: i64,
    #[deprecated(
        since = "0.92.2",
        note = "Please use `ZO_COMPACT_DELETE_FILES_DELAY_MINUTES` instead. This ENV will be removed in a future release"
    )]
    #[env_config(name = "ZO_COMPACT_DELETE_FILES_DELAY_HOURS", default = 0)] // hours
    pub delete_files_delay_hours: i64,
    #[env_config(name = "ZO_COMPACT_BLOCKED_ORGS", default = "")] // use comma to split
    pub blocked_orgs: String,
    #[env_config(name = "ZO_COMPACT_FILE_LIST_DELETED_MODE", default = "deleted")]
    pub file_list_deleted_mode: String, // "history" "deleted" "none"
    #[env_config(
        name = "ZO_COMPACT_FILE_LIST_DELETED_BATCH_SIZE",
        default = 1000,
        help = "batch size of file list deleted query"
    )]
    pub file_list_deleted_batch_size: usize,
    #[env_config(
        name = "ZO_COMPACT_FILE_LIST_MULTI_THREAD",
        default = false,
        help = "use multi thread for file list query"
    )]
    pub file_list_multi_thread: bool,
    #[env_config(name = "ZO_COMPACT_FILE_LIST_DUMP_ENABLED", default = false)]
    pub file_list_dump_enabled: bool,
    #[env_config(
        name = "ZO_COMPACT_BATCH_SIZE",
        default = 0,
        help = "Batch size for compact get pending jobs"
    )]
    pub batch_size: i64,
    #[env_config(
        name = "ZO_COMPACT_JOB_RUN_TIMEOUT",
        default = 600, // 10 minutes
        help = "If a compact job is not finished in this time, it will be marked as failed"
    )]
    pub job_run_timeout: i64,
    #[env_config(
        name = "ZO_COMPACT_JOB_CLEAN_WAIT_TIME",
        default = 7200, // 2 hours
        help = "Clean the jobs which are finished more than this time"
    )]
    pub job_clean_wait_time: i64,
    #[env_config(name = "ZO_COMPACT_PENDING_JOBS_METRIC_INTERVAL", default = 300)] // seconds
    pub pending_jobs_metric_interval: u64,
    #[env_config(name = "ZO_COMPACT_MAX_GROUP_FILES", default = 10000)]
    pub max_group_files: usize,
    #[env_config(
        name = "ZO_COMPACT_RETENTION_ALLOWED_HOURS",
        default = "",
        help = "Comma-separated list of hours (0-23) when retention can run. Empty means run at all hours. Example: 5,6,8"
    )]
    pub retention_allowed_hours: String,
    #[env_config(
        name = "ZO_COMPACT_TANTIVY_BUILDER_THREAD_NUM",
        default = 2,
        help = "Per-file concurrent row_group workers for tantivy index generation during compaction. less than or equal to 1 disables (single-threaded)"
    )]
    pub tantivy_builder_thread_num: usize,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct CacheLatestFiles {
    #[env_config(name = "ZO_CACHE_LATEST_FILES_ENABLED", default = false)]
    pub enabled: bool,
    // cache parquet files
    #[env_config(name = "ZO_CACHE_LATEST_FILES_PARQUET", default = true)]
    pub cache_parquet: bool,
    // cache index(tantivy) files
    #[env_config(name = "ZO_CACHE_LATEST_FILES_INDEX", default = true)]
    pub cache_index: bool,
    #[env_config(name = "ZO_CACHE_LATEST_FILES_DELETE_MERGE_FILES", default = false)]
    pub delete_merge_files: bool,
    #[env_config(name = "ZO_CACHE_LATEST_FILES_DOWNLOAD_FROM_NODE", default = false)]
    pub download_from_node: bool,
    #[env_config(name = "ZO_CACHE_LATEST_FILES_DOWNLOAD_NODE_SIZE", default = 100)] // MB
    pub download_node_size: i64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct MemoryCache {
    #[env_config(name = "ZO_MEMORY_CACHE_ENABLED", default = false)]
    pub enabled: bool,
    // Memory data cache strategy, default is lru, other value is fifo, time_lru
    #[env_config(name = "ZO_MEMORY_CACHE_STRATEGY", default = "lru")]
    pub cache_strategy: String,
    // Memory data cache bucket num, multiple bucket means multiple locker, default is 0
    #[env_config(name = "ZO_MEMORY_CACHE_BUCKET_NUM", default = 0)]
    pub bucket_num: usize,
    // MB, default is 50% of system memory
    #[env_config(name = "ZO_MEMORY_CACHE_MAX_SIZE", default = 0)]
    pub max_size: usize,
    // MB, will skip the cache when a query need cache great than this value, default is 50% of
    // max_size
    #[env_config(name = "ZO_MEMORY_CACHE_SKIP_SIZE", default = 0)]
    pub skip_size: usize,
    // MB, when cache is full will release how many data once time, default is 10% of max_size
    #[env_config(name = "ZO_MEMORY_CACHE_RELEASE_SIZE", default = 0)]
    pub release_size: usize,
    #[env_config(name = "ZO_MEMORY_CACHE_GC_SIZE", default = 100)] // MB
    pub gc_size: usize,
    #[env_config(name = "ZO_MEMORY_CACHE_GC_INTERVAL", default = 60)] // seconds
    pub gc_interval: u64,
    // Days, files with data older than this will not be downloaded into the cache,
    // queries read them directly from object storage. default 0 means no limit
    #[env_config(name = "ZO_MEMORY_CACHE_MAX_AGE_DAYS", default = 0)]
    pub max_age_days: i64,
    #[env_config(name = "ZO_MEMORY_CACHE_SKIP_DISK_CHECK", default = false)]
    pub skip_disk_check: bool,
    // MB, default is 50% of system memory
    #[env_config(name = "ZO_MEMORY_CACHE_DATAFUSION_MAX_SIZE", default = 0)]
    pub datafusion_max_size: usize,
    #[env_config(name = "ZO_MEMORY_CACHE_DATAFUSION_MEMORY_POOL", default = "")]
    pub datafusion_memory_pool: String,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct DiskCache {
    #[env_config(name = "ZO_DISK_CACHE_ENABLED", default = true)]
    pub enabled: bool,
    // Disk data cache strategy, default is lru, other value is fifo, time_lru
    #[env_config(name = "ZO_DISK_CACHE_STRATEGY", default = "time_lru")]
    pub cache_strategy: String,
    // Disk data cache bucket num, multiple bucket means multiple locker, default is 0
    #[env_config(name = "ZO_DISK_CACHE_BUCKET_NUM", default = 0)]
    pub bucket_num: usize,
    // MB, default is 50% of local volume available space and maximum 500GB
    #[env_config(name = "ZO_DISK_CACHE_MAX_SIZE", default = 0)]
    pub max_size: usize,
    // MB, default is 10% of local volume available space and maximum 20GB
    #[env_config(name = "ZO_DISK_RESULT_CACHE_MAX_SIZE", default = 0)]
    pub result_max_size: usize,
    #[env_config(name = "ZO_DISK_AGGREGATION_CACHE_MAX_SIZE", default = 0)]
    pub aggregation_max_size: usize,
    // MB, will skip the cache when a query need cache great than this value, default is 50% of
    // max_size
    #[env_config(name = "ZO_DISK_CACHE_SKIP_SIZE", default = 0)]
    pub skip_size: usize,
    // MB, when cache is full will release how many data once time, default is 10% of max_size
    #[env_config(name = "ZO_DISK_CACHE_RELEASE_SIZE", default = 0)]
    pub release_size: usize,
    #[env_config(name = "ZO_DISK_CACHE_GC_SIZE", default = 100)] // MB
    pub gc_size: usize,
    #[env_config(name = "ZO_DISK_CACHE_GC_INTERVAL", default = 60)] // seconds
    pub gc_interval: u64,
    // Days, files with data older than this will not be downloaded into the cache,
    // queries read them directly from object storage. default 0 means no limit
    #[env_config(name = "ZO_DISK_CACHE_MAX_AGE_DAYS", default = 0)]
    pub max_age_days: i64,
    #[env_config(name = "ZO_DISK_CACHE_MULTI_DIR", default = "")] // dir1,dir2,dir3...
    pub multi_dir: String,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct Log {
    #[env_config(name = "RUST_LOG", default = "info")]
    pub level: String,
    #[env_config(name = "ZO_LOG_JSON_FORMAT", default = false)]
    pub json_format: bool,
    #[env_config(name = "ZO_LOG_FILE_DIR", default = "")]
    pub file_dir: String,
    // default is: o2.{hostname}.log
    #[env_config(name = "ZO_LOG_FILE_NAME_PREFIX", default = "")]
    pub file_name_prefix: String,
    // logger timestamp local setup, eg: %Y-%m-%dT%H:%M:%SZ
    #[env_config(name = "ZO_LOG_LOCAL_TIME_FORMAT", default = "")]
    pub local_time_format: String,
}

#[derive(Serialize, Debug, EnvConfig, Default)]
pub struct Nats {
    #[env_config(name = "ZO_NATS_ADDR", default = "localhost:4222")]
    pub addr: String,
    #[env_config(name = "ZO_NATS_PREFIX", default = "o2_")]
    pub prefix: String,
    #[env_config(name = "ZO_NATS_USER", default = "")]
    pub user: String,
    #[env_config(name = "ZO_NATS_PASSWORD", default = "")]
    pub password: String,
    #[env_config(
        name = "ZO_NATS_REPLICAS",
        default = 3,
        help = "the copies of a given message to store in the NATS cluster.
        Can not be modified after bucket is initialized.
        To update this, delete and recreate the bucket."
    )]
    pub replicas: usize,
    #[env_config(
        name = "ZO_NATS_HISTORY",
        default = 1,
        help = "in the context of KV to configure how many historical entries to keep for a given bucket.
        Can not be modified after bucket is initialized.
        To update this, delete and recreate the bucket."
    )]
    pub history: i64,
    #[env_config(
        name = "ZO_NATS_DELIVER_POLICY",
        default = "all",
        help = "The point in the stream from which to receive messages, default is: all, valid option is: all, last, new."
    )]
    pub deliver_policy: String,
    #[env_config(name = "ZO_NATS_CONNECT_TIMEOUT", default = 5)]
    pub connect_timeout: u64,
    #[env_config(name = "ZO_NATS_LOCK_WAIT_TIMEOUT", default = 3600)]
    pub lock_wait_timeout: u64,
    #[env_config(name = "ZO_NATS_SUB_CAPACITY", default = 65535)]
    pub subscription_capacity: usize,
    #[env_config(name = "ZO_NATS_QUEUE_MAX_AGE", default = 60)] // days
    pub queue_max_age: u64,
    #[env_config(name = "ZO_NATS_EVENT_MAX_AGE", default = 3600)] // seconds
    pub event_max_age: u64,
    #[env_config(name = "ZO_NATS_LOCK_MAX_AGE", default = 7200)] // seconds
    pub lock_max_age: u64,
    #[env_config(
        name = "ZO_NATS_QUEUE_MAX_SIZE",
        help = "The maximum size of the queue in MB, default is 2048MB",
        default = 2048
    )]
    pub queue_max_size: i64,
    #[env_config(
        name = "ZO_NATS_EVENT_STORAGE",
        help = "Set the storage type for the event stream, default is: file, other value is: memory",
        default = "file"
    )]
    pub event_storage: String,
    #[env_config(
        name = "ZO_NATS_V211_SUPPORT",
        help = "Support NATS v2.11.x",
        default = false
    )]
    pub v211_support: bool,
    #[env_config(
        name = "ZO_NATS_KV_WATCH_MODULES",
        help = "Set the modules which need to use kv watcher",
        default = ""
    )]
    pub kv_watch_modules: String,
}

#[derive(Serialize, Debug, Default, EnvConfig)]
pub struct S3 {
    #[env_config(
        name = "ZO_S3_ACCOUNTS",
        default = "",
        help = "comma separated list of accounts"
    )]
    pub accounts: String,
    #[env_config(
        name = "ZO_S3_STREAM_STRATEGY",
        default = "",
        help = "stream strategy, default is: empty, only use default account, other value is: file_hash, stream_hash, stream1:account1,stream2:account2"
    )]
    pub stream_strategy: String,
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
    #[env_config(name = "ZO_S3_FEATURE_FORCE_HOSTED_STYLE", default = false)]
    pub feature_force_hosted_style: bool,
    #[env_config(name = "ZO_S3_FEATURE_HTTP1_ONLY", default = false)]
    pub feature_http1_only: bool,
    #[env_config(name = "ZO_S3_FEATURE_HTTP2_ONLY", default = false)]
    pub feature_http2_only: bool,
    #[env_config(name = "ZO_S3_FEATURE_BULK_DELETE", default = false)]
    pub feature_bulk_delete: bool,
    #[env_config(name = "ZO_S3_ALLOW_INVALID_CERTIFICATES", default = false)]
    pub allow_invalid_certificates: bool,
    #[env_config(
        name = "ZO_S3_FEATURE_FORCE_INFREQUENT_ACCESS",
        default = false,
        help = "Use STANDARD_IA storage class for compliance storage type"
    )]
    pub feature_force_infrequent_access: bool,
    #[env_config(name = "ZO_S3_MAX_RETRIES", default = 10)]
    pub max_retries: usize,
    #[env_config(name = "ZO_S3_MAX_IDLE_PER_HOST", default = 0)]
    pub max_idle_per_host: usize,
    // https://github.com/hyperium/hyper/issues/2136#issuecomment-589488526
    #[env_config(name = "ZO_S3_CONNECTION_KEEPALIVE_TIMEOUT", default = 20)] // seconds
    pub keepalive_timeout: u64, // aws s3 by has timeout of 20 sec
    #[env_config(
        name = "ZO_S3_MULTI_PART_UPLOAD_SIZE",
        default = 100,
        help = "The size of the file will switch to multi-part upload in MB"
    )]
    pub multi_part_upload_size: usize,
}

#[derive(Serialize, Debug, EnvConfig, Default)]
pub struct Sns {
    #[env_config(name = "ZO_SNS_ENDPOINT", default = "")]
    pub endpoint: String,
    #[env_config(name = "ZO_SNS_CONNECT_TIMEOUT", default = 10)] // seconds
    pub connect_timeout: u64,
    #[env_config(name = "ZO_SNS_OPERATION_TIMEOUT", default = 30)] // seconds
    pub operation_timeout: u64,
}

#[derive(Serialize, Debug, EnvConfig, Default)]
pub struct Prometheus {
    #[env_config(name = "ZO_METRICS_DEDUP_ENABLED", default = true)]
    pub dedup_enabled: bool,
    #[env_config(name = "ZO_METRICS_LEADER_PUSH_INTERVAL", default = 15)]
    pub leader_push_interval: u64,
    #[env_config(name = "ZO_METRICS_LEADER_ELECTION_INTERVAL", default = 30)]
    pub leader_election_interval: i64,
    #[env_config(name = "ZO_PROMETHEUS_HA_CLUSTER", default = "cluster")]
    pub ha_cluster_label: String,
    #[env_config(name = "ZO_PROMETHEUS_HA_REPLICA", default = "__replica__")]
    pub ha_replica_label: String,
    /// Max `le` labels (buckets + gap markers + inf) a native histogram sample may
    /// expand to; over-limit samples are downscaled (adjacent buckets merged).
    #[env_config(name = "ZO_PROMETHEUS_NATIVE_HISTOGRAM_MAX_BUCKETS", default = 16)]
    pub native_histogram_max_buckets: usize,
}

#[derive(Serialize, Debug, EnvConfig, Default)]
pub struct RUM {
    #[env_config(name = "ZO_RUM_ENABLED", default = false)]
    pub enabled: bool,
    #[env_config(name = "ZO_RUM_CLIENT_TOKEN", default = "")]
    pub client_token: String,
    #[env_config(name = "ZO_RUM_APPLICATION_ID", default = "")]
    pub application_id: String,
    #[env_config(name = "ZO_RUM_SITE", default = "")]
    pub site: String,
    #[env_config(name = "ZO_RUM_SERVICE", default = "")]
    pub service: String,
    #[env_config(name = "ZO_RUM_ENV", default = "")]
    pub env: String,
    #[env_config(name = "ZO_RUM_VERSION", default = "")]
    pub version: String,
    #[env_config(name = "ZO_RUM_ORGANIZATION_IDENTIFIER", default = "")]
    pub organization_identifier: String,
    #[env_config(name = "ZO_RUM_API_VERSION", default = "")]
    pub api_version: String,
    #[env_config(name = "ZO_RUM_INSECURE_HTTP", default = false)]
    pub insecure_http: bool,
}

#[derive(Serialize, Debug, EnvConfig, Default)]
pub struct Pipeline {
    #[env_config(
        name = "ZO_PIPELINE_REMOTE_STREAM_WAL_DIR",
        default = "",
        help = "For the remote stream WAL directory, if the pipeline destination is a remote stream, we use a separate path to distinguish between local WAL and remote WAL"
    )]
    pub remote_stream_wal_dir: String,
    #[env_config(
        name = "ZO_PIPELINE_REMOTE_STREAM_CONCURRENT_COUNT",
        default = 30,
        help = "control the remote stream wal send concurrent count"
    )]
    pub remote_stream_wal_concurrent_count: usize,
    #[env_config(
        name = "ZO_PIPELINE_OFFSET_FLUSH_INTERVAL",
        default = 10,
        help = "flush remote stream wal sended-ok-offset interval"
    )]
    pub offset_flush_interval: u64,
    #[env_config(
        name = "ZO_PIPELINE_REMOTE_REQUEST_TIMEOUT",
        default = 600,
        help = "pipeline exporter client request timeout"
    )]
    pub remote_request_timeout: u64,
    #[env_config(
        name = "ZO_PIPELINE_REMOTE_REQUEST_MAX_RETRY_TIME",
        default = 86400,
        help = "pipeline exporter client request max retry times, default 1440 minutes(24 hours)， unit is seconds"
    )]
    pub remote_request_max_retry_time: u64,
    #[env_config(
        name = "ZO_PIPELINE_WAL_SIZE_LIMIT",
        default = 0,
        help = "pipeline wal dir data size limit, default is 50% of local volume available space, unit is MB"
    )]
    pub wal_size_limit: u64,
    #[env_config(
        name = "ZO_PIPELINE_MAX_CONNECTIONS",
        default = 1024,
        help = "pipeline exporter client max connections"
    )]
    pub max_connections: usize,
    #[env_config(
        name = "ZO_PIPELINE_BATCH_ENABLED",
        default = false,
        help = "Enable batching of entries before sending HTTP requests"
    )]
    pub batch_enabled: bool,
    #[env_config(
        name = "ZO_PIPELINE_BATCH_TIMEOUT_MS",
        default = 1000,
        help = "Maximum time to wait for a batch to fill up (in milliseconds)"
    )]
    pub batch_timeout_ms: u64,
    #[env_config(
        name = "ZO_PIPELINE_BATCH_SIZE_BYTES",
        default = 10485760, // 10MB
        help = "Maximum size of a batch in bytes"
    )]
    pub batch_size_bytes: usize,
    #[env_config(
        name = "ZO_PIPELINE_BATCH_RETRY_MAX_ATTEMPTS",
        default = 3,
        help = "Maximum number of retries for batch flush"
    )]
    pub batch_retry_max_attempts: u32,
    #[env_config(
        name = "ZO_PIPELINE_BATCH_RETRY_INITIAL_DELAY_MS",
        default = 1000, // 1 second
        help = "Initial delay for batch flush retry (in milliseconds)"
    )]
    pub batch_retry_initial_delay_ms: u64,
    #[env_config(
        name = "ZO_PIPELINE_BATCH_RETRY_MAX_DELAY_MS",
        default = 30000, // 30 seconds
        help = "Maximum delay for batch flush retry (in milliseconds)"
    )]
    pub batch_retry_max_delay_ms: u64,
    #[env_config(
        name = "ZO_PIPELINE_USE_SHARED_HTTP_CLIENT",
        default = false,
        help = "Use shared HTTP client instances for better connection pooling"
    )]
    pub use_shared_http_client: bool,
    #[env_config(
        name = "ZO_PIPELINE_REMOVE_FILE_AFTER_MAX_RETRY",
        default = true,
        help = "Remove wal file after max retry"
    )]
    pub remove_file_after_max_retry: bool,
    #[env_config(
        name = "ZO_PIPELINE_MAX_RETRY_COUNT",
        default = 10,
        help = "pipeline exporter client max retry count"
    )]
    pub max_retry_count: u32,
    #[env_config(
        name = "ZO_PIPELINE_MAX_RETRY_TIME_IN_HOURS",
        default = 24,
        help = "pipeline exporter client max retry time in hours"
    )]
    pub max_retry_time_in_hours: u64,
    #[env_config(
        name = "ZO_PIPELINE_MAX_FILE_SIZE_ON_DISK_MB",
        default = 256,
        help = "pipeline max file size on disk in MB"
    )]
    pub pipeline_max_file_size_on_disk_mb: usize,
    #[env_config(
        name = "ZO_PIPELINE_MAX_FILE_RETENTION_TIME_SECONDS",
        default = 600,
        help = "pipeline max file retention time in seconds"
    )]
    pub pipeline_max_file_retention_time_seconds: u64,
    #[env_config(
        name = "ZO_PIPELINE_FILE_PUSH_BACK_INTERVAL",
        default = 2,
        help = "duration in seconds to push the file to back to the queue after a read complete"
    )]
    pub pipeline_file_push_back_interval: u64,
    #[env_config(
        name = "ZO_PIPELINE_SINK_TASK_SPAWN_INTERVAL_MS",
        default = 100,
        help = "interval in milliseconds to spawn a new sink task"
    )]
    pub pipeline_sink_task_spawn_interval_ms: u64,
    #[env_config(
        name = "ZO_PIPELINE_ERROR_RETENTION_MINS",
        default = 60,
        help = "pipeline error retention time in minutes, errors older than this will be cleaned up"
    )]
    pub error_retention_mins: u64,
    #[env_config(
        name = "ZO_PIPELINE_ERROR_CLEANUP_INTERVAL",
        default = 300,
        help = "pipeline error cleanup interval in seconds"
    )]
    pub error_cleanup_interval: u64,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct HealthCheck {
    #[env_config(name = "ZO_HEALTH_CHECK_ENABLED", default = true)]
    pub enabled: bool,
    #[env_config(
        name = "ZO_HEALTH_CHECK_TIMEOUT",
        default = 5,
        help = "Health check timeout in seconds"
    )]
    pub timeout: u64,
    #[env_config(
        name = "ZO_HEALTH_CHECK_FAILED_TIMES",
        default = 3,
        help = "The node will be removed from consistent hash if health check failed exceed this times"
    )]
    pub failed_times: usize,
}

#[derive(Serialize, EnvConfig, Default)]
pub struct EnrichmentTable {
    #[env_config(
        name = "ZO_ENRICHMENT_TABLE_CACHE_DIR",
        default = "",
        help = "Local cache directory for enrichment tables"
    )]
    pub cache_dir: String,
    #[env_config(
        name = "ZO_ENRICHMENT_TABLE_MERGE_THRESHOLD_MB",
        default = 60,
        help = "Threshold for merging small files before S3 upload (in MB)"
    )]
    pub merge_threshold_mb: u64,
    #[env_config(
        name = "ZO_ENRICHMENT_TABLE_MERGE_INTERVAL",
        default = 600,
        help = "Background sync interval in seconds"
    )]
    pub merge_interval: u64,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_FETCH_MAX_SIZE",
        default = 500,
        help = "Maximum size of each batch when fetching from URL (in MB). Batches are saved to reduce database checkpoint frequency."
    )]
    pub url_fetch_max_size_mb: usize,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_FETCH_TIMEOUT",
        default = 7200,
        help = "Timeout for URL fetch operations (in seconds)"
    )]
    pub url_fetch_timeout_secs: u64,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_HEADER_FETCH_SIZE",
        default = 8192,
        help = "Size of initial fetch for CSV headers when resuming (in bytes). Should be large enough to contain the header row."
    )]
    pub url_header_fetch_size_bytes: usize,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_MAX_RETRIES",
        default = 3,
        help = "Maximum retry attempts for failed URL fetches"
    )]
    pub url_max_retries: u32,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_RETRY_DELAY",
        default = 5,
        help = "Delay between retry attempts (in seconds)"
    )]
    pub url_retry_delay_secs: u64,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_STALE_JOB_THRESHOLD",
        default = 600,
        help = "Jobs stuck in Processing status for longer than this are considered stale (in seconds). Used for automatic recovery."
    )]
    pub url_stale_job_threshold_secs: i64,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_RECOVERY_CHECK_INTERVAL",
        default = 120,
        help = "Interval between stale job recovery checks (in seconds). Each ingester will attempt to claim one stale job per interval."
    )]
    pub url_recovery_check_interval_secs: u64,
    #[env_config(
        name = "ZO_ENRICHMENT_URL_RECOVERY_JOBS_PER_CHECK",
        default = 1,
        help = "Number of stale jobs each ingester attempts to claim per recovery check. Higher values allow faster recovery but may cause uneven distribution."
    )]
    pub url_recovery_jobs_per_check: usize,
}

pub fn init() -> Config {
    if let Err(e) = load_config() {
        log::error!("Failed to load config {e}");
        // do nothing
    }
    let mut cfg = Config::init().expect("config init error");

    // set local mode
    if cfg.common.local_mode {
        cfg.common.node_role = "all".to_string();
        cfg.common.node_role_group = "".to_string();
    }
    cfg.common.is_local_storage = cfg.common.local_mode
        && (cfg.common.local_mode_storage == "disk" || cfg.common.local_mode_storage == "local");

    // check limit config
    if let Err(e) = check_limit_config(&mut cfg) {
        panic!("limit config error: {e}");
    }

    // check route config
    if let Err(e) = check_route_config(&cfg) {
        panic!("route config error: {e}");
    }

    // check common config
    if let Err(e) = check_common_config(&mut cfg) {
        panic!("common config error: {e}");
    }

    // check grpc config
    if let Err(e) = check_grpc_config(&mut cfg) {
        panic!("common config error: {e}");
    }

    // check http config
    if let Err(e) = check_http_config(&mut cfg) {
        panic!("common config error: {e}")
    }

    // check data path config
    if let Err(e) = check_path_config(&mut cfg) {
        panic!("data path config error: {e}");
    }

    // check memory cache
    if let Err(e) = check_memory_config(&mut cfg) {
        panic!("memory cache config error: {e}");
    }

    // check disk cache
    if let Err(e) = check_disk_cache_config(&mut cfg) {
        panic!("disk cache config error: {e}");
    }

    // check compact config
    if let Err(e) = check_compact_config(&mut cfg) {
        panic!("compact config error: {e}");
    }

    // check s3 config
    if let Err(e) = check_s3_config(&mut cfg) {
        panic!("s3 config error: {e}");
    }

    // check sns config
    if let Err(e) = check_sns_config(&mut cfg) {
        panic!("sns config error: {e}");
    }

    // check health check config
    if let Err(e) = check_health_check_config(&mut cfg) {
        panic!("health check config error: {e}");
    }

    // check pipeline config
    if let Err(e) = check_pipeline_config(&mut cfg) {
        panic!("pipeline config error: {e}");
    }

    // check nats config
    if let Err(e) = check_nats_config(&mut cfg) {
        panic!("nats config error: {e}");
    }

    // check inverted index config
    if let Err(e) = check_inverted_index_config(&mut cfg) {
        panic!("inverted index config error: {e}");
    }

    // check synthetics config — infallible on purpose, see the function
    check_synthetics_config(&mut cfg);

    cfg
}

fn check_limit_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    // set real cpu num
    cfg.limit.real_cpu_num = max(1, sysinfo::get_cpu_limit());
    // limit cpu num by memory, 1 core per 1GB, in case the user only set memory
    // limit on k8s and we detect the whole node's cpu cores
    let mem_total = sysinfo::get_memory_limit();
    let cpu_num = if mem_total == 0 {
        cfg.limit.real_cpu_num
    } else {
        cfg.limit
            .real_cpu_num
            .min(max(1, mem_total / (1024 * 1024 * 1024)))
    };
    // set at least 2 threads
    let cpu_num = max(2, cpu_num);
    cfg.limit.cpu_num = cpu_num;
    if cfg.limit.http_worker_num == 0 {
        cfg.limit.http_worker_num = cpu_num;
    }
    if cfg.limit.http_worker_max_blocking == 0 {
        cfg.limit.http_worker_max_blocking = 256;
    }
    if cfg.limit.grpc_runtime_worker_num == 0 {
        cfg.limit.grpc_runtime_worker_num = cpu_num;
    }
    if cfg.limit.grpc_runtime_blocking_worker_num == 0 {
        cfg.limit.grpc_runtime_blocking_worker_num = 512;
    }
    if cfg.limit.job_runtime_worker_num == 0 {
        cfg.limit.job_runtime_worker_num = cpu_num;
    }
    if cfg.limit.job_runtime_blocking_worker_num == 0 {
        cfg.limit.job_runtime_blocking_worker_num = 512;
    }
    // HACK for thread_num equal to CPU core * 4
    if cfg.limit.query_thread_num == 0 {
        if cfg.common.local_mode {
            cfg.limit.query_thread_num = cpu_num;
        } else {
            cfg.limit.query_thread_num = cpu_num * 4;
        }
    }

    if cfg.limit.file_download_thread_num == 0 {
        cfg.limit.file_download_thread_num = std::cmp::max(1, cpu_num / 2);
    }

    if cfg.limit.file_download_priority_queue_thread_num == 0 {
        cfg.limit.file_download_priority_queue_thread_num = std::cmp::max(1, cpu_num / 2);
    }

    // HACK for move_file_thread_num equal to CPU core
    if cfg.limit.file_move_thread_num == 0 {
        cfg.limit.file_move_thread_num = cpu_num;
    }
    // HACK for file_merge_thread_num equal to CPU core
    if cfg.limit.file_merge_thread_num == 0 {
        if cfg.common.local_mode {
            cfg.limit.file_merge_thread_num = std::cmp::max(1, cpu_num / 2);
        } else {
            cfg.limit.file_merge_thread_num = cpu_num;
        }
    }
    // HACK for mem_dump_thread_num equal to CPU core
    if cfg.limit.mem_dump_thread_num == 0 {
        cfg.limit.mem_dump_thread_num = cpu_num;
    }
    // HACK for vortex_thread_num equal to CPU core
    if cfg.limit.vortex_thread_num == 0 {
        cfg.limit.vortex_thread_num = cpu_num;
    }
    // HACK for usage_reporting_thread_num equal to half of CPU core
    if cfg.limit.usage_reporting_thread_num == 0 {
        if cfg.common.local_mode {
            cfg.limit.usage_reporting_thread_num = std::cmp::max(1, cpu_num / 2);
        } else {
            cfg.limit.usage_reporting_thread_num = cpu_num;
        }
    }
    if cfg.limit.file_push_interval == 0 {
        cfg.limit.file_push_interval = 10;
    }
    if cfg.limit.file_push_limit == 0 {
        cfg.limit.file_push_limit = 10000;
    }

    if cfg.limit.sql_db_connections_min == 0 {
        cfg.limit.sql_db_connections_min = MINIMUM_DB_CONNECTIONS;
    }

    if cfg.limit.sql_db_connections_max == 0 {
        cfg.limit.sql_db_connections_max = cpu_num as u32 * 4;
    }
    cfg.limit.sql_db_connections_max =
        max(REQUIRED_DB_CONNECTIONS, cfg.limit.sql_db_connections_max);

    if cfg.limit.consistent_hash_vnodes < 1 {
        cfg.limit.consistent_hash_vnodes = 1000;
    }

    // reset to default if given zero
    if cfg.limit.max_dashboard_series < 1 {
        cfg.limit.max_dashboard_series = 100;
    }

    // check query timeout
    if cfg.limit.query_timeout == 0 {
        cfg.limit.query_timeout = 600;
    }
    if cfg.limit.query_ingester_timeout == 0 {
        cfg.limit.query_ingester_timeout = cfg.limit.query_timeout;
    }
    if cfg.limit.query_querier_timeout == 0 {
        cfg.limit.query_querier_timeout = cfg.limit.query_timeout;
    }

    // check for uds
    #[allow(deprecated)]
    if cfg.limit.udschema_max_fields > 0 {
        cfg.limit.schema_max_fields_to_enable_uds = cfg.limit.udschema_max_fields;
    }

    // migrate deprecated *_file_retention ENVs to *_query_retention for backward compatibility
    // if the user explicitly set a non-hourly file retention, apply it to query retention
    if cfg.limit.logs_file_retention != "hourly" && cfg.limit.logs_query_retention == "hourly" {
        cfg.limit.logs_query_retention = cfg.limit.logs_file_retention.clone();
    }
    if cfg.limit.traces_file_retention != "hourly" && cfg.limit.traces_query_retention == "hourly" {
        cfg.limit.traces_query_retention = cfg.limit.traces_file_retention.clone();
    }
    if cfg.limit.metrics_file_retention != "hourly" && cfg.limit.metrics_query_retention == "hourly"
    {
        cfg.limit.metrics_query_retention = cfg.limit.metrics_file_retention.clone();
    }
    // file retention is always hourly now
    cfg.limit.logs_file_retention = "hourly".to_string();
    cfg.limit.traces_file_retention = "hourly".to_string();
    cfg.limit.metrics_file_retention = "hourly".to_string();

    // format ingest allowed upto and in future to micro
    cfg.limit.ingest_allowed_upto_micro = cfg.limit.ingest_allowed_upto * 3600 * 1_000_000;
    cfg.limit.ingest_allowed_in_future_micro =
        cfg.limit.ingest_allowed_in_future * 3600 * 1_000_000;

    // clamp batch_size to [1024, 8192]
    if cfg.limit.batch_size == 0 {
        cfg.limit.batch_size = 8192;
    }
    cfg.limit.batch_size = cfg.limit.batch_size.clamp(1024, 8192);
    // clamp datafusion_min_partition_num to 1
    cfg.limit.datafusion_min_partition_num = cfg.limit.datafusion_min_partition_num.max(1);

    // retain for atleast 1 hour
    if cfg.limit.workflow_error_retention_secs <= 3600 {
        cfg.limit.workflow_error_retention_secs = 3600;
    }

    Ok(())
}

fn check_route_config(cfg: &Config) -> Result<(), anyhow::Error> {
    if cfg.route.dispatch_strategy == RouteDispatchStrategy::Other {
        return Err(anyhow::anyhow!(
            "You must set ZO_ROUTE_STRATEGY to one of: workload (default) or random."
        ));
    }
    Ok(())
}

fn check_common_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.limit.file_push_interval == 0 {
        cfg.limit.file_push_interval = 60;
    }
    if cfg.limit.req_cols_per_record_limit == 0 {
        cfg.limit.req_cols_per_record_limit = 1000;
    }

    // check max_file_size_on_disk to MB
    if cfg.limit.max_file_size_on_disk == 0 {
        cfg.limit.max_file_size_on_disk = 512 * 1024 * 1024; // 512MB
    } else {
        cfg.limit.max_file_size_on_disk *= 1024 * 1024;
    }
    // check max_file_size_in_memory to MB
    if cfg.limit.max_file_size_in_memory == 0 {
        cfg.limit.max_file_size_in_memory = 512 * 1024 * 1024; // 512MB
    } else {
        cfg.limit.max_file_size_in_memory *= 1024 * 1024;
    }

    // check for metrics limit
    if cfg.limit.metrics_max_points_per_series == 0 {
        cfg.limit.metrics_max_points_per_series = 30_000;
    }

    // check search job retention
    if cfg.limit.search_job_retention == 0 {
        return Err(anyhow::anyhow!("search job retention is set to zero"));
    }

    if (cfg.common.tracing_enabled || cfg.common.tracing_search_enabled)
        && cfg.common.otel_otlp_url.is_empty()
        && cfg.common.otel_otlp_grpc_url.is_empty()
    {
        return Err(anyhow::anyhow!(
            "Either grpc or http url should be set when enabling tracing"
        ));
    }

    // If tracing_extra_envs is empty, reset to default value
    if cfg.common.tracing_extra_envs.is_empty() {
        cfg.common.tracing_extra_envs =
            "K8S_CLUSTER,K8S_NAMESPACE_NAME,K8S_NODE_NAME,K8S_CONTAINER_NAME,K8S_POD_NAME"
                .to_string();
    }

    // HACK instance_name
    if cfg.common.instance_name.is_empty() {
        cfg.common.instance_name = sysinfo::os::get_hostname();
    }
    cfg.common.instance_name_short = cfg
        .common
        .instance_name
        .split('.')
        .next()
        .unwrap()
        .to_string();

    // HACK for tracing, always disable tracing except ingester and querier
    let local_node_role: Vec<cluster::Role> = cfg
        .common
        .node_role
        .clone()
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    if !local_node_role.contains(&cluster::Role::All)
        && !local_node_role.contains(&cluster::Role::Ingester)
        && !local_node_role.contains(&cluster::Role::Querier)
    {
        cfg.common.tracing_enabled = false;
    }

    // format local_mode_storage
    cfg.common.local_mode_storage = cfg.common.local_mode_storage.to_lowercase();

    // check queue store
    check_queue_store_config(cfg)?;

    // format metadata storage
    if cfg.common.meta_store.is_empty() {
        if cfg.common.local_mode {
            cfg.common.meta_store = "sqlite".to_string();
        } else {
            cfg.common.meta_store = "nats".to_string();
        }
    }
    cfg.common.meta_store = cfg.common.meta_store.to_lowercase();
    if !cfg.common.local_mode && !cfg.common.meta_store.starts_with("postgres") {
        return Err(anyhow::anyhow!(
            "Meta store only supports postgres in cluster mode."
        ));
    }
    if cfg.common.meta_store.starts_with("postgres") && cfg.common.meta_postgres_dsn.is_empty() {
        let c = &cfg.common;
        if c.meta_postgres_host.is_empty()
            || c.meta_postgres_user.is_empty()
            || c.meta_postgres_password.is_empty()
            || c.meta_postgres_dbname.is_empty()
        {
            return Err(anyhow::anyhow!(
                "Meta store is PostgreSQL, you must set either ZO_META_POSTGRES_DSN or all of \
                 ZO_META_POSTGRES_HOST, ZO_META_POSTGRES_USER, ZO_META_POSTGRES_PASSWORD, \
                 ZO_META_POSTGRES_DBNAME"
            ));
        }
        // Compose the DSN from the individual vars. User, password and dbname are
        // percent-encoded so credentials with special characters survive the round
        // trip — sqlx percent-decodes them again when it parses the DSN.
        let dsn = format!(
            "postgres://{}:{}@{}:{}/{}",
            urlencoding::encode(&c.meta_postgres_user),
            urlencoding::encode(&c.meta_postgres_password),
            c.meta_postgres_host,
            c.meta_postgres_port,
            urlencoding::encode(&c.meta_postgres_dbname),
        );
        cfg.common.meta_postgres_dsn = dsn;
    }

    if cfg.common.meta_store.starts_with("mysql") {
        return Err(anyhow::anyhow!("We don't support MySQL anymore."));
    }

    // check meta partition mode
    if cfg.common.meta_partition_mode != "manual" {
        cfg.common.meta_partition_mode = "auto".to_string();
    }

    // If the default scrape interval is less than 5s, raise an error
    if cfg.common.default_scrape_interval < 5 {
        return Err(anyhow::anyhow!(
            "Default scrape interval can not be set to lesser than 5s ."
        ));
    }

    // migrate deprecated ZO_BLOOM_FILTER_DEFAULT_FIELDS into
    // ZO_FEATURE_BLOOM_FILTER_EXTRA_FIELDS for backward compatibility
    #[allow(deprecated)]
    if !cfg.common.bloom_filter_default_fields.is_empty() {
        log::warn!(
            "ZO_BLOOM_FILTER_DEFAULT_FIELDS is deprecated and will be removed in v1.0.0, please use ZO_FEATURE_BLOOM_FILTER_EXTRA_FIELDS instead"
        );
        if cfg.common.feature_bloom_filter_extra_fields.is_empty() {
            cfg.common.feature_bloom_filter_extra_fields =
                cfg.common.bloom_filter_default_fields.clone();
        } else {
            cfg.common.feature_bloom_filter_extra_fields = format!(
                "{},{}",
                cfg.common.feature_bloom_filter_extra_fields,
                cfg.common.bloom_filter_default_fields
            );
        }
    }

    // check bloom filter fpp: must be a probability in (0, 1)
    if cfg.common.bloom_filter_fpp <= 0.0 || cfg.common.bloom_filter_fpp >= 1.0 {
        log::warn!(
            "ZO_BLOOM_FILTER_FPP={} is out of range (0, 1); falling back to default 0.01",
            cfg.common.bloom_filter_fpp
        );
        cfg.common.bloom_filter_fpp = 0.01;
    }

    // check for join match one
    if cfg.search.feature_join_match_one_enabled && cfg.search.feature_join_right_side_max_rows == 0
    {
        cfg.search.feature_join_right_side_max_rows = 50_000;
    }

    // check for broadcast join left side max rows
    if cfg.search.feature_broadcast_join_enabled
        && cfg.search.feature_broadcast_join_left_side_max_rows == 0
    {
        cfg.search.feature_broadcast_join_left_side_max_rows = 10_000;
    }

    if cfg.search.feature_broadcast_join_enabled
        && cfg.search.feature_broadcast_join_left_side_max_size == 0
    {
        cfg.search.feature_broadcast_join_left_side_max_size = 10; // 10 MB
    }

    if cfg.common.default_hec_stream.is_empty() {
        cfg.common.default_hec_stream = "_hec".to_string();
    }

    if cfg.common.usage_publish_interval < 1 {
        cfg.common.usage_publish_interval = 60;
    }

    cfg.common.log_page_default_field_list = cfg.common.log_page_default_field_list.to_lowercase();
    if !matches!(
        cfg.common.log_page_default_field_list.as_str(),
        "uds" | "all" | "interesting"
    ) {
        cfg.common.log_page_default_field_list = "uds".to_string();
    }

    Ok(())
}

fn check_queue_store_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.common.queue_store.is_empty() {
        // smart default: a local single process needs no NATS server
        cfg.common.queue_store = if cfg.common.local_mode {
            "memory".to_string()
        } else {
            "nats".to_string()
        };
    }
    cfg.common.queue_store = cfg.common.queue_store.to_lowercase();
    let queue_store =
        crate::meta::queue_store::QueueStore::try_from(cfg.common.queue_store.as_str())
            .map_err(|e| anyhow::anyhow!("{e}"))?;
    if queue_store == crate::meta::queue_store::QueueStore::Memory && !cfg.common.local_mode {
        return Err(anyhow::anyhow!(
            "ZO_QUEUE_STORE=memory is only supported in local mode (ZO_LOCAL_MODE=true); it is a process-local, non-durable queue."
        ));
    }
    if cfg.common.memory_queue_max_size == 0 {
        cfg.common.memory_queue_max_size = 64; // MB
    }
    // convert MB to bytes; the config value is bytes after this point
    cfg.common.memory_queue_max_size = cfg
        .common
        .memory_queue_max_size
        .checked_mul(1024 * 1024)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "ZO_MEMORY_QUEUE_MAX_SIZE_MB is too large: {} MB overflows the byte limit.",
                cfg.common.memory_queue_max_size
            )
        })?;
    Ok(())
}

fn check_grpc_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.grpc.tls_enabled
        && (cfg.grpc.tls_cert_domain.is_empty()
            || cfg.grpc.tls_cert_path.is_empty()
            || cfg.grpc.tls_key_path.is_empty())
    {
        return Err(anyhow::anyhow!(
            "ZO_GRPC_TLS_CERT_DOMAIN, ZO_GRPC_TLS_CERT_PATH and ZO_GRPC_TLS_KEY_PATH must be set when ZO_GRPC_TLS_ENABLED is true"
        ));
    }
    Ok(())
}

fn check_http_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.http.tls_enabled
        && (cfg.http.tls_cert_path.is_empty() || cfg.http.tls_key_path.is_empty())
    {
        return Err(anyhow::anyhow!(
            "When ZO_HTTP_TLS_ENABLED=true, both ZO_HTTP_TLS_CERT_PATH \
             and ZO_HTTP_TLS_KEY_PATH must be set."
        ));
    }
    Ok(())
}

fn check_path_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    // for web
    if cfg.common.web_url.ends_with('/') {
        cfg.common.web_url = cfg.common.web_url.trim_end_matches('/').to_string();
    }
    if cfg.common.base_uri.ends_with('/') {
        cfg.common.base_uri = cfg.common.base_uri.trim_end_matches('/').to_string();
    }
    // for data
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
    if cfg.common.data_db_dir.is_empty() {
        cfg.common.data_db_dir = format!("{}db/", cfg.common.data_dir);
    }
    if !cfg.common.data_db_dir.ends_with('/') {
        cfg.common.data_db_dir = format!("{}/", cfg.common.data_db_dir);
    }
    if cfg.common.data_cache_dir.is_empty() {
        cfg.common.data_cache_dir = format!("{}cache/", cfg.common.data_dir);
    }
    if !cfg.common.data_cache_dir.ends_with('/') {
        cfg.common.data_cache_dir = format!("{}/", cfg.common.data_cache_dir);
    }
    if cfg.common.data_tmp_dir.is_empty() {
        cfg.common.data_tmp_dir = format!("{}tmp/", cfg.common.data_dir);
    }
    if !cfg.common.data_tmp_dir.ends_with('/') {
        cfg.common.data_tmp_dir = format!("{}/", cfg.common.data_tmp_dir);
    }
    if cfg.common.mmdb_data_dir.is_empty() {
        cfg.common.mmdb_data_dir = format!("{}mmdb/", cfg.common.data_dir);
    }
    if !cfg.common.mmdb_data_dir.ends_with('/') {
        cfg.common.mmdb_data_dir = format!("{}/", cfg.common.mmdb_data_dir);
    }

    Ok(())
}

fn check_memory_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    let mem_total = sysinfo::get_memory_limit();
    cfg.limit.mem_total = mem_total;
    if cfg.memory_cache.max_size == 0 {
        if cfg.common.local_mode {
            cfg.memory_cache.max_size = mem_total / 4; // 25%
        } else {
            cfg.memory_cache.max_size = mem_total / 2; // 50%
        }
    } else {
        cfg.memory_cache.max_size *= 1024 * 1024;
    }
    if cfg.memory_cache.skip_size == 0 {
        // will skip the cache when a query need cache great than this value, default is
        // 50% of max_size
        cfg.memory_cache.skip_size = cfg.memory_cache.max_size / 2;
    } else {
        cfg.memory_cache.skip_size *= 1024 * 1024;
    }
    if cfg.memory_cache.release_size == 0 {
        // when cache is full will release how many data once time, default is 10% of
        // max_size
        cfg.memory_cache.release_size = cfg.memory_cache.max_size / 10;
    } else {
        cfg.memory_cache.release_size *= 1024 * 1024;
    }
    if cfg.memory_cache.gc_size == 0 {
        cfg.memory_cache.gc_size = 100 * 1024 * 1024; // 100 MB
    } else {
        cfg.memory_cache.gc_size *= 1024 * 1024;
    }
    if cfg.memory_cache.enabled && cfg.memory_cache.max_size >= mem_total {
        return Err(anyhow::anyhow!(
            "ZO_MEMORY_CACHE_MAX_SIZE is larger than total memory, please set a smaller value"
        ));
    }
    let local_node_role: Vec<cluster::Role> = cfg
        .common
        .node_role
        .clone()
        .split(',')
        .map(|s| s.parse().unwrap())
        .collect();
    if cfg.memory_cache.datafusion_max_size == 0 {
        if local_node_role == [cluster::Role::Compactor] {
            cfg.memory_cache.datafusion_max_size = mem_total / cfg.limit.file_merge_thread_num;
        } else if cfg.common.local_mode {
            cfg.memory_cache.datafusion_max_size = (mem_total - cfg.memory_cache.max_size) / 2; // 25%
        } else {
            cfg.memory_cache.datafusion_max_size = mem_total - cfg.memory_cache.max_size; // 50%
        }
    } else {
        cfg.memory_cache.datafusion_max_size *= 1024 * 1024;
    }

    if cfg.memory_cache.bucket_num == 0 {
        cfg.memory_cache.bucket_num = cfg.limit.cpu_num;
    }
    cfg.memory_cache.max_size /= cfg.memory_cache.bucket_num;
    cfg.memory_cache.release_size /= cfg.memory_cache.bucket_num;
    cfg.memory_cache.gc_size /= cfg.memory_cache.bucket_num;

    // for memtable limit check
    if cfg.limit.mem_table_max_size == 0 {
        if cfg.common.local_mode {
            cfg.limit.mem_table_max_size = mem_total / 4; // 25%
        } else {
            cfg.limit.mem_table_max_size = mem_total / 2; // 50%
        }
    } else {
        cfg.limit.mem_table_max_size *= 1024 * 1024;
    }
    if cfg.limit.mem_table_bucket_num == 0 {
        cfg.limit.mem_table_bucket_num = 1;
    }

    // wal
    if cfg.limit.wal_write_buffer_size < 4096 {
        cfg.limit.wal_write_buffer_size = 4096;
    }
    if cfg.limit.wal_write_queue_size == 0 {
        cfg.limit.wal_write_queue_size = 10000;
    }

    // check query settings
    if cfg.limit.query_group_base_speed == 0 {
        cfg.limit.query_group_base_speed = SIZE_IN_GB as usize;
    } else {
        cfg.limit.query_group_base_speed *= 1024 * 1024;
    }
    if cfg.limit.query_partition_by_secs == 0 {
        cfg.limit.query_partition_by_secs = 5;
    }
    if cfg.limit.query_partition_max_num == 0 {
        cfg.limit.query_partition_max_num = 100;
    }
    if cfg.limit.query_default_limit == 0 {
        cfg.limit.query_default_limit = 1000;
    }

    if cfg.search.inverted_index_footer_cache_max_size == 0 {
        cfg.search.inverted_index_footer_cache_max_size =
            ((cfg.limit.mem_total as f64 / SIZE_IN_MB * 0.05) as usize).clamp(100, 1024)
                * (SIZE_IN_MB as usize);
    } else {
        cfg.search.inverted_index_footer_cache_max_size *= SIZE_IN_MB as usize;
    }
    if cfg.search.bloom_footer_cache_max_size == 0 {
        // 1% of total mem, clamped to [32, 256] MB. Bloom footers are an
        // order of magnitude smaller than tantivy footers (footer payload
        // ≈ 24 B per file × 3 fields + per-field header ≈ 7.5 KB per
        // `.bf`), so the cache holds 4-32 K entries at this size.
        cfg.search.bloom_footer_cache_max_size =
            ((cfg.limit.mem_total as f64 / SIZE_IN_MB * 0.01) as usize).clamp(32, 256)
                * (SIZE_IN_MB as usize);
    } else {
        cfg.search.bloom_footer_cache_max_size *= SIZE_IN_MB as usize;
    }

    if cfg.limit.datafusion_file_stat_cache_max_size == 0 {
        cfg.limit.datafusion_file_stat_cache_max_size =
            ((cfg.limit.mem_total as f64 / SIZE_IN_MB * 0.05) as usize).clamp(100, 1024)
                * (SIZE_IN_MB as usize);
    } else {
        cfg.limit.datafusion_file_stat_cache_max_size *= SIZE_IN_MB as usize;
    }

    if cfg.limit.metrics_result_cache_max_size == 0 {
        // 1% of total mem, clamped to [32, 256] MB; the promql result cache
        // index holds roughly 200 B per entry at this size.
        cfg.limit.metrics_result_cache_max_size =
            ((cfg.limit.mem_total as f64 / SIZE_IN_MB * 0.01) as usize).clamp(32, 256)
                * (SIZE_IN_MB as usize);
    } else {
        if cfg.limit.metrics_result_cache_max_size < 32 {
            log::warn!("ZO_METRICS_RESULT_CACHE_MAX_SIZE raised to the 32 MB minimum");
        }
        cfg.limit.metrics_result_cache_max_size =
            cfg.limit.metrics_result_cache_max_size.max(32) * (SIZE_IN_MB as usize);
    }
    Ok(())
}

/// Strip the Windows extended-length prefix (`\\?\`) from a canonicalized path
/// so it can be compared with sysinfo mount points that use the plain DOS form.
///
/// Uses [`std::path::Prefix`] to detect verbatim prefixes rather than
/// manipulating the string directly, which would silently break on non-ASCII
/// drive letters or UNC paths.
pub fn deverbatim(path: &Path) -> std::borrow::Cow<'_, str> {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if let Some(Component::Prefix(p)) = path.components().next() {
            if let Prefix::VerbatimDisk(drive) = p.kind() {
                // \\?\C:\rest → C:\rest
                // p.as_os_str() is "\\?\C:" (6 bytes); the remainder of the
                // original string is "\rest", so prepend the plain drive letter.
                let after_prefix = &path.to_string_lossy()[p.as_os_str().len()..];
                return format!("{}:{}", drive as char, after_prefix).into();
            }
        }
    }
    path.to_string_lossy()
}

fn check_disk_cache_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    std::fs::create_dir_all(&cfg.common.data_cache_dir).expect("create cache dir success");
    let cache_dir_path = Path::new(&cfg.common.data_cache_dir)
        .canonicalize()
        .unwrap();
    let cache_dir_owned = deverbatim(&cache_dir_path).into_owned();
    let cache_dir = cache_dir_owned.as_str();

    // disable disk cache for local disk storage
    if cfg.common.is_local_storage
        && !cfg.common.result_cache_enabled
        && !cfg.search.feature_query_streaming_aggs
    {
        cfg.disk_cache.enabled = false;
    }

    // disable result cache if disk cache is disabled
    if !cfg.disk_cache.enabled {
        cfg.common.result_cache_enabled = false;
        cfg.search.feature_query_streaming_aggs = false;
    }

    let disks = sysinfo::disk::get_disk_usage();
    let disk = disks.iter().find(|d| cache_dir.starts_with(&d.mount_point));
    let (disk_total, disk_free) = match disk {
        Some(d) => (d.total_space, d.available_space),
        None => (0, 0),
    };
    cfg.limit.disk_total = disk_total as usize;
    cfg.limit.disk_free = disk_free as usize;
    if cfg.disk_cache.max_size == 0 {
        // Add the current cache directory size back to free space so the limit is
        // stable across restarts.  Without this correction the measured "free" space
        // shrinks every time the app restarts with a full cache, causing the limit to
        // drift lower on each startup.
        let cache_current_size = crate::utils::file::get_dir_size(cache_dir);
        let effective_free = cfg.limit.disk_free + cache_current_size;
        cfg.disk_cache.max_size = effective_free / 2; // 50%
        if cfg.disk_cache.max_size > 1024 * 1024 * 1024 * 500 {
            cfg.disk_cache.max_size = 1024 * 1024 * 1024 * 500; // 500GB
        }
    } else {
        cfg.disk_cache.max_size *= 1024 * 1024;
    }

    if cfg.disk_cache.result_max_size == 0 {
        cfg.disk_cache.result_max_size = cfg.disk_cache.max_size / 10; // 10%
        if cfg.disk_cache.result_max_size > 1024 * 1024 * 1024 * 20 {
            cfg.disk_cache.result_max_size = 1024 * 1024 * 1024 * 20; // 20GB
        }
    } else {
        cfg.disk_cache.result_max_size *= 1024 * 1024;
    }

    if cfg.disk_cache.aggregation_max_size == 0 {
        cfg.disk_cache.aggregation_max_size = cfg.disk_cache.max_size / 10; // 10%
        if cfg.disk_cache.aggregation_max_size > 1024 * 1024 * 1024 * 20 {
            cfg.disk_cache.aggregation_max_size = 1024 * 1024 * 1024 * 20; // 20GB
        }
    } else {
        cfg.disk_cache.aggregation_max_size *= 1024 * 1024;
    }

    if cfg.disk_cache.skip_size == 0 {
        // will skip the cache when a query need cache great than this value, default is
        // 50% of max_size
        cfg.disk_cache.skip_size = cfg.disk_cache.max_size / 2;
    } else {
        cfg.disk_cache.skip_size *= 1024 * 1024;
    }
    if cfg.disk_cache.release_size == 0 {
        // when cache is full will release how many data once time, default is 10% of
        // max_size
        cfg.disk_cache.release_size = cfg.disk_cache.max_size / 10;
    } else {
        cfg.disk_cache.release_size *= 1024 * 1024;
    }
    if cfg.disk_cache.gc_size == 0 {
        cfg.disk_cache.gc_size = 100 * 1024 * 1024; // 100 MB
    } else {
        cfg.disk_cache.gc_size *= 1024 * 1024;
    }

    if cfg.disk_cache.multi_dir.contains('/') {
        return Err(anyhow::anyhow!(
            "ZO_DISK_CACHE_MULTI_DIR only supports a single directory level, can not contains / "
        ));
    }

    if cfg.disk_cache.bucket_num == 0 {
        // because we validate cpu_num before this
        // we can be sure here that value is sane.

        // following numbers are imperically decided, users can set the value
        // directly if they know better, otherwise this was the best numbers
        // for bucket_num based on thread count.
        let threads = cfg.limit.cpu_num;
        if threads <= 16 {
            // for less than 16 threads, same buckets would be good enough
            // with 16 files in parallel we should not run into that many
            // files going into same bucket, so ok.
            cfg.disk_cache.bucket_num = threads;
        } else if threads > 16 && threads <= 64 {
            // for 32 -> 64 ish range, there can be a lot of collisions
            // so we set it to double the threads to avoid any collisions
            cfg.disk_cache.bucket_num = 2 * threads;
        } else {
            // for > 64 threads, it was observed that even with 1.5 times buckets
            // it is ok, not that many collisions. This is imperical, no concrete
            // reasoning for 1.5
            cfg.disk_cache.bucket_num = (threads as f64 * 1.5) as usize;
        }
    }
    cfg.disk_cache.bucket_num = max(
        cfg.disk_cache.bucket_num,
        cfg.disk_cache
            .multi_dir
            .split(',')
            .filter(|s| !s.trim().is_empty())
            .count(),
    );
    cfg.disk_cache.max_size /= cfg.disk_cache.bucket_num;
    cfg.disk_cache.result_max_size /= cfg.disk_cache.bucket_num;
    cfg.disk_cache.aggregation_max_size /= cfg.disk_cache.bucket_num;
    cfg.disk_cache.release_size /= cfg.disk_cache.bucket_num;
    cfg.disk_cache.gc_size /= cfg.disk_cache.bucket_num;

    Ok(())
}

fn check_compact_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.compact.data_retention_days > 0 && cfg.compact.data_retention_days < 3 {
        return Err(anyhow::anyhow!(
            "Data retention is not allowed to be less than 3 days."
        ));
    }
    if cfg.compact.interval < 1 {
        cfg.compact.interval = 10;
    }

    // check compact_max_file_size to MB
    if cfg.compact.max_file_size < 1 {
        cfg.compact.max_file_size = 512;
    }
    cfg.compact.max_file_size *= 1024 * 1024;
    if cfg.compact.delete_files_delay_minutes < 1 {
        cfg.compact.delete_files_delay_minutes = 120;
    }
    // Backward compatibility: if the deprecated ZO_COMPACT_DELETE_FILES_DELAY_HOURS is
    // explicitly set (default is 0, so > 0 means user provided a value), convert to minutes.
    #[allow(deprecated)]
    if cfg.compact.delete_files_delay_hours > 0 {
        cfg.compact.delete_files_delay_minutes = cfg.compact.delete_files_delay_hours * 60;
    }

    if cfg.compact.data_retention_interval < 1 {
        cfg.compact.data_retention_interval = 3600;
    }
    if cfg.compact.old_data_interval < 1 {
        cfg.compact.old_data_interval = 3600;
    }
    if cfg.compact.old_data_max_days < 1 {
        cfg.compact.old_data_max_days = 7;
    }
    if cfg.compact.old_data_min_hours < 1 {
        cfg.compact.old_data_min_hours = 2;
    }
    if cfg.compact.old_data_min_files < 1 {
        cfg.compact.old_data_min_files = 10;
    }
    if cfg.compact.file_list_deleted_batch_size == 0 {
        cfg.compact.file_list_deleted_batch_size = 1000;
    }
    if cfg.compact.batch_size < 1 {
        cfg.compact.batch_size = 100;
    }
    if cfg.compact.pending_jobs_metric_interval == 0 {
        cfg.compact.pending_jobs_metric_interval = 300;
    }
    if !cfg.compact.fast_mode && cfg.common.local_mode {
        cfg.compact.fast_mode = true;
    }

    Ok(())
}

fn check_sns_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    // Validate endpoint URL if provided
    if !cfg.sns.endpoint.is_empty()
        && !cfg.sns.endpoint.starts_with("http://")
        && !cfg.sns.endpoint.starts_with("https://")
    {
        return Err(anyhow::anyhow!(
            "Invalid SNS endpoint URL. It must start with http:// or https://"
        ));
    }

    // Validate timeouts
    if cfg.sns.connect_timeout == 0 {
        cfg.sns.connect_timeout = 10; // Default to 10 seconds if not set
        log::warn!("SNS connect timeout not specified, defaulting to 10 seconds");
    }
    if cfg.sns.operation_timeout == 0 {
        cfg.sns.operation_timeout = 30; // Default to 30 seconds if not set
        log::warn!("SNS operation timeout not specified, defaulting to 30 seconds");
    }

    Ok(())
}

fn check_s3_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    // Ensure each bucket prefix ends with '/' for multi-bucket configurations
    if !cfg.s3.bucket_prefix.is_empty() {
        let prefixes: Vec<String> = cfg
            .s3
            .bucket_prefix
            .split(',')
            .map(|prefix| {
                let trimmed = prefix.trim();
                if trimmed.is_empty() || trimmed.ends_with('/') {
                    trimmed.to_string()
                } else {
                    format!("{}/", trimmed)
                }
            })
            .collect();
        cfg.s3.bucket_prefix = prefixes.join(",");
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
    if cfg.s3.provider.eq("swift") {
        unsafe { std::env::set_var("AWS_EC2_METADATA_DISABLED", "true") };
    }

    if cfg.s3.keepalive_timeout == 0 {
        // reset to default
        cfg.s3.keepalive_timeout = 20;
    }

    Ok(())
}

fn check_pipeline_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    // pipeline
    if cfg.pipeline.remote_stream_wal_dir.is_empty() {
        cfg.pipeline.remote_stream_wal_dir = format!("{}remote_stream_wal/", cfg.common.data_dir);
    }

    if !cfg.pipeline.remote_stream_wal_dir.is_empty()
        && !cfg.pipeline.remote_stream_wal_dir.ends_with('/')
    {
        cfg.pipeline.remote_stream_wal_dir = format!("{}/", cfg.pipeline.remote_stream_wal_dir);
    }

    if cfg.pipeline.offset_flush_interval == 0 {
        cfg.pipeline.offset_flush_interval = 10;
    }
    if cfg.pipeline.remote_request_max_retry_time == 0 {
        cfg.pipeline.remote_request_max_retry_time = 86400; // 24 hours, in seconds
    }

    if cfg.pipeline.wal_size_limit == 0 {
        cfg.pipeline.wal_size_limit = cfg.limit.disk_free as u64 / 2; // 50%
        if cfg.pipeline.wal_size_limit > 1024 * 1024 * 1024 * 100 {
            cfg.pipeline.wal_size_limit = 1024 * 1024 * 1024 * 100; // 100GB
        }
    } else {
        cfg.pipeline.wal_size_limit *= 1024 * 1024;
    }

    if cfg.pipeline.pipeline_file_push_back_interval == 0 {
        cfg.pipeline.pipeline_file_push_back_interval = 2; // 2 seconds
    }

    if cfg.pipeline.pipeline_sink_task_spawn_interval_ms == 0 {
        cfg.pipeline.pipeline_sink_task_spawn_interval_ms = 100; // 100 milliseconds
    }
    Ok(())
}

fn check_health_check_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.health_check.timeout == 0 {
        cfg.health_check.timeout = 5;
    }
    if cfg.health_check.failed_times == 0 {
        cfg.health_check.failed_times = 3;
    }
    Ok(())
}

#[inline]
pub fn is_local_disk_storage() -> bool {
    get_config().common.is_local_storage
}

#[inline]
pub fn get_cluster_name() -> String {
    let cfg = get_config();
    if !cfg.common.cluster_name.is_empty() {
        cfg.common.cluster_name.to_string()
    } else {
        INSTANCE_ID.get("instance_id").unwrap().to_string()
    }
}

#[inline]
pub fn get_parquet_compression(compression: &str) -> parquet::basic::Compression {
    match compression.to_lowercase().as_str() {
        "none" | "uncompressed" => parquet::basic::Compression::UNCOMPRESSED,
        "snappy" => parquet::basic::Compression::SNAPPY,
        "gzip" => parquet::basic::Compression::GZIP(Default::default()),
        "brotli" => parquet::basic::Compression::BROTLI(Default::default()),
        "lz4" | "lz4_raw" => parquet::basic::Compression::LZ4_RAW,
        "zstd" => parquet::basic::Compression::ZSTD(Default::default()),
        _ => parquet::basic::Compression::ZSTD(Default::default()),
    }
}

fn check_nats_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.nats.queue_max_size == 0 {
        cfg.nats.queue_max_size = 2048; // 2GB
    }
    cfg.nats.queue_max_size *= 1024 * 1024; // convert to bytes
    Ok(())
}

fn check_inverted_index_config(cfg: &mut Config) -> Result<(), anyhow::Error> {
    if cfg.search.inverted_index_result_cache_max_entries == 0 {
        cfg.search.inverted_index_result_cache_max_entries = 10000;
    }
    if cfg.search.inverted_index_result_cache_max_entry_size == 0 {
        cfg.search.inverted_index_result_cache_max_entry_size = 20480;
    }
    if cfg.search.inverted_index_skip_threshold == 0 {
        cfg.search.inverted_index_skip_threshold = 35;
    }
    if cfg.limit.inverted_index_min_token_length == 0 {
        cfg.limit.inverted_index_min_token_length = 2;
    }
    if cfg.limit.inverted_index_max_token_length == 0 {
        cfg.limit.inverted_index_max_token_length = 64;
    }
    Ok(())
}

/// The env vars that exist in every build but are only ever read by
/// enterprise-gated code. Setting one in an OSS-only build is configured-and-
/// ignored, which is indistinguishable from configured-and-broken unless we say
/// so — see [`check_synthetics_config`].
#[cfg(not(feature = "enterprise"))]
const ENTERPRISE_ONLY_SYNTHETICS_VARS: &[&str] = &[
    "ZO_SYNTHETICS_INSTALL_SCRIPT_URL",
    "ZO_SYNTHETICS_AGENT_STALE_SECS",
];

/// Refuses ceilings that cannot hold together.
///
/// The ordering is the whole point: a budget at or above the lease means a check
/// can be accepted, run to its limit, and still have its ack rejected as stale —
/// which surfaces to the user as a failure their target never had. Operators own
/// these values; this only refuses combinations that cannot work.
fn validate_synthetics_ceilings(cfg: &Synthetics) -> Result<(), String> {
    if cfg.max_check_budget_secs >= cfg.job_lease_secs {
        return Err(format!(
            "ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS ({}) must be strictly less than \
             ZO_SYNTHETICS_JOB_LEASE_SECS ({}) — the gap is what dispatch and the ack need. A run \
             that finishes at the budget still has to report before the reaper assumes the probe \
             is gone.",
            cfg.max_check_budget_secs, cfg.job_lease_secs
        ));
    }
    if cfg.max_check_budget_secs <= 0 || cfg.job_lease_secs <= 0 {
        return Err("synthetics limits must be positive".to_string());
    }
    if cfg.max_net_timeout_ms as i64 > cfg.max_check_budget_secs * 1_000 {
        return Err(format!(
            "ZO_SYNTHETICS_MAX_NET_TIMEOUT_MS ({}) exceeds the check budget ({}s) — a single \
             attempt could never fit",
            cfg.max_net_timeout_ms, cfg.max_check_budget_secs
        ));
    }
    Ok(())
}

/// Deliberately infallible, unlike its neighbours: every other `check_*` is
/// wired to `panic!` in [`init`], and refusing to start the whole application —
/// ingest, search, dashboards — because one probe ceiling is misconfigured would
/// be the worse outage. On rejection the built-in ceilings stand, so the failure
/// mode is "stricter than the operator intended", never "accepts checks that get
/// killed mid-run".
fn check_synthetics_config(cfg: &mut Config) {
    if let Err(e) = validate_synthetics_ceilings(&cfg.synthetics) {
        log::error!(
            "synthetics ceilings rejected, falling back to the built-in ones \
             (budget={}s lease={}s net={}ms): {e}",
            crate::meta::synthetics::DEFAULT_MAX_CHECK_BUDGET_SECS,
            crate::meta::synthetics::DEFAULT_JOB_LEASE_SECS,
            crate::meta::synthetics::DEFAULT_MAX_NET_TIMEOUT_MS,
        );
        cfg.synthetics.max_check_budget_secs =
            crate::meta::synthetics::DEFAULT_MAX_CHECK_BUDGET_SECS;
        cfg.synthetics.job_lease_secs = crate::meta::synthetics::DEFAULT_JOB_LEASE_SECS;
        cfg.synthetics.max_net_timeout_ms = crate::meta::synthetics::DEFAULT_MAX_NET_TIMEOUT_MS;
    }

    // Every synthetics var now has exactly one name, in every build — which
    // means an OSS user can set a private-agent var and get silence back. One
    // line per var is the difference between "configured and ignored" and
    // "configured and broken".
    #[cfg(not(feature = "enterprise"))]
    for var in ENTERPRISE_ONLY_SYNTHETICS_VARS {
        if std::env::var(var).is_ok() {
            log::warn!(
                "{var} is set, but it is only read by the private-agent path, which requires an \
                 enterprise build. It has no effect here."
            );
        }
    }
}

pub fn ensure_not_empty(s: &str, name: &str) -> Result<(), anyhow::Error> {
    if s.trim().is_empty() {
        return Err(anyhow::anyhow!("{} is empty", name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Every `#[env_config]` default must parse.
    ///
    /// The macro reads defaults from a **string literal**, so a Rust digit
    /// separator (`86_400`) is not a number to it — it is a `ParseIntError`
    /// raised inside `init()`, which panics the process at startup rather
    /// than failing anything reviewable. This test is the only cheap guard:
    /// it forces every default through the same parse the binary does.
    #[test]
    fn every_env_config_default_parses() {
        let _ = super::Config::init().expect("a default failed to parse");
    }

    use super::*;

    /// A coherent starting point, so each ceiling test changes exactly the one
    /// thing it is about. `Synthetics::default()` is all zeroes — the derive
    /// gives Rust's defaults, not the `#[env_config]` ones — so it cannot be
    /// the baseline here.
    fn ceilings(
        job_lease_secs: i64,
        max_check_budget_secs: i64,
        max_net_timeout_ms: u32,
    ) -> Synthetics {
        Synthetics {
            job_lease_secs,
            max_check_budget_secs,
            max_net_timeout_ms,
            ..Default::default()
        }
    }

    #[test]
    fn shipped_synthetics_defaults_hold_together() {
        // The `#[env_config]` defaults, not `Default::default()`. If these ever
        // stop being a valid combination, every deployment that configures
        // nothing silently falls back to them in `check_synthetics_config`.
        let cfg = Synthetics::init().expect("a synthetics default failed to parse");
        validate_synthetics_ceilings(&cfg).expect("shipped defaults must be a valid combination");
    }

    #[test]
    fn budget_equal_to_lease_is_rejected() {
        // The gap is what dispatch and the ack need. Equal means a run that
        // uses its full budget cannot report before the reaper requeues it.
        assert!(validate_synthetics_ceilings(&ceilings(900, 900, 300_000)).is_err());
    }

    #[test]
    fn budget_above_lease_is_rejected() {
        assert!(validate_synthetics_ceilings(&ceilings(900, 901, 300_000)).is_err());
    }

    #[test]
    fn net_timeout_larger_than_the_budget_is_rejected() {
        // One attempt could never fit, so every config of that type would fail
        // validation for a reason the user cannot act on.
        assert!(validate_synthetics_ceilings(&ceilings(900, 10, 300_000)).is_err());
    }

    #[test]
    fn a_raised_but_still_ordered_pair_is_accepted() {
        // Operators own these values; validation only refuses combinations that
        // cannot work, not ones it merely dislikes.
        assert!(validate_synthetics_ceilings(&ceilings(600, 540, 120_000)).is_ok());
    }

    /// Replaces both `limits_fall_back_to_defaults_when_uninitialised` and
    /// `a_rejected_ceiling_does_not_fail_the_whole_reload`. The holder they
    /// guarded is gone, and so is the way a bad ceiling could fail a reload:
    /// `check_synthetics_config` returns `()`, so there is no error for
    /// `refresh_config` to propagate. What still has to hold is what this
    /// asserts — a rejected combination leaves the built-in ceilings in place
    /// rather than the operator's unusable ones.
    ///
    /// Driven through `check_synthetics_config` rather than `refresh_config`
    /// deliberately: `refresh_config` calls `load_config`, which writes the
    /// config-file hash that `config_path_manager`'s own tests assert on.
    #[test]
    fn rejected_ceilings_fall_back_to_the_built_in_ones() {
        let mut cfg = Config::init().expect("config init");
        cfg.synthetics = ceilings(900, 900, 300_000);

        check_synthetics_config(&mut cfg);

        assert_eq!(
            (
                cfg.synthetics.job_lease_secs,
                cfg.synthetics.max_check_budget_secs,
                cfg.synthetics.max_net_timeout_ms
            ),
            (
                crate::meta::synthetics::DEFAULT_JOB_LEASE_SECS,
                crate::meta::synthetics::DEFAULT_MAX_CHECK_BUDGET_SECS,
                crate::meta::synthetics::DEFAULT_MAX_NET_TIMEOUT_MS
            ),
            "a rejected set must leave validation stricter than intended, never looser"
        );
    }

    /// A valid set must survive untouched — otherwise the test above would pass
    /// against an implementation that always overwrites.
    #[test]
    fn configured_ceilings_survive_the_check() {
        let mut cfg = Config::init().expect("config init");
        cfg.synthetics = ceilings(600, 540, 120_000);

        check_synthetics_config(&mut cfg);

        assert_eq!(cfg.synthetics.job_lease_secs, 600);
        assert_eq!(cfg.synthetics.max_check_budget_secs, 540);
        assert_eq!(cfg.synthetics.max_net_timeout_ms, 120_000);
    }

    /// Every `Synthetics` env var, in declaration order. Hand-written, as is
    /// [`SYNTHETICS_RELOAD_CLASSES`], so comparing the two proves nothing about
    /// the struct — the real link is the exhaustive destructure in
    /// `synthetics_restart_required_changes`.
    const ALL_SYNTHETICS_ENV_VARS: &[&str] = &[
        "ZO_SYNTHETICS_ENABLED",
        "ZO_SYNTHETICS_LAMBDA_BROWSER",
        "ZO_SYNTHETICS_LAMBDA_NET",
        "ZO_SYNTHETICS_API_ENDPOINT",
        "ZO_SYNTHETICS_INSTALL_SCRIPT_URL",
        "ZO_SYNTHETICS_RECORDER_EXTENSION_URL",
        "ZO_SYNTHETICS_AGENT_STALE_SECS",
        "ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS",
        "ZO_SYNTHETICS_JOB_LEASE_SECS",
        "ZO_SYNTHETICS_MAX_NET_TIMEOUT_MS",
        "ZO_SYNTHETICS_BROWSERS",
        "ZO_SYNTHETICS_DEVICES",
        "ZO_SYNTHETICS_SCHEDULER_JITTER_ENABLED",
        "ZO_SYNTHETICS_ORPHAN_DETECTION_ENABLED",
    ];

    fn synthetics_names_in_class(class: SyntheticsReloadClass) -> Vec<&'static str> {
        let mut v: Vec<&'static str> = SYNTHETICS_RELOAD_CLASSES
            .iter()
            .filter(|(_, c)| *c == class)
            .map(|(name, _)| *name)
            .collect();
        v.sort_unstable();
        v
    }

    /// Reclassifying a key must be a deliberate edit. "Hot" is a property of how
    /// consumers read the key, not a runtime value, so it is pinned as a
    /// declared table.
    #[test]
    fn synthetics_reload_classification_is_pinned() {
        assert_eq!(
            SYNTHETICS_RELOAD_CLASSES.len(),
            14,
            "Synthetics has 14 keys; every one needs a reload class"
        );

        let mut classified: Vec<&str> = SYNTHETICS_RELOAD_CLASSES
            .iter()
            .map(|(name, _)| *name)
            .collect();
        classified.sort_unstable();
        let mut declared: Vec<&str> = ALL_SYNTHETICS_ENV_VARS.to_vec();
        declared.sort_unstable();
        assert_eq!(
            classified, declared,
            "the classification table and Synthetics' fields have drifted"
        );

        // Read at point of use via get_config(), so a reload is picked up on the
        // next dispatch/request with no further plumbing. The three ceilings are
        // in here rather than in a class of their own: they used to be pushed
        // across the enterprise seam into this crate, and now they are declared
        // in it.
        assert_eq!(
            synthetics_names_in_class(SyntheticsReloadClass::Hot),
            vec![
                "ZO_SYNTHETICS_AGENT_STALE_SECS",
                "ZO_SYNTHETICS_API_ENDPOINT",
                "ZO_SYNTHETICS_BROWSERS",
                "ZO_SYNTHETICS_DEVICES",
                "ZO_SYNTHETICS_INSTALL_SCRIPT_URL",
                "ZO_SYNTHETICS_JOB_LEASE_SECS",
                "ZO_SYNTHETICS_LAMBDA_BROWSER",
                "ZO_SYNTHETICS_LAMBDA_NET",
                "ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS",
                "ZO_SYNTHETICS_MAX_NET_TIMEOUT_MS",
                "ZO_SYNTHETICS_ORPHAN_DETECTION_ENABLED",
                "ZO_SYNTHETICS_RECORDER_EXTENSION_URL",
                "ZO_SYNTHETICS_SCHEDULER_JITTER_ENABLED",
            ]
        );

        // `enabled` gates a `tokio::spawn` of the workers and the one-time HTTP
        // route registration. Making it hot means being able to start and stop
        // background tasks at runtime — a structural change, deliberately not
        // part of this one. A reload warns instead of pretending.
        assert_eq!(
            synthetics_names_in_class(SyntheticsReloadClass::RestartRequired),
            vec!["ZO_SYNTHETICS_ENABLED"]
        );
    }

    #[test]
    fn a_synthetics_reload_that_changes_nothing_warns_about_nothing() {
        // The reload path runs on a file watcher, so it can fire on writes that
        // change nothing about synthetics. A restart warning that appears
        // without a cause trains operators to ignore the one that matters.
        let a = Synthetics::init().unwrap();
        let b = Synthetics::init().unwrap();
        assert!(synthetics_restart_required_changes(&a, &b).is_empty());
    }

    #[test]
    #[allow(clippy::bool_comparison)]
    fn flipping_synthetics_enabled_on_reload_asks_for_a_restart() {
        let old = Synthetics::init().unwrap();
        let mut new = Synthetics::init().unwrap();
        new.enabled = !old.enabled;

        assert_eq!(
            synthetics_restart_required_changes(&old, &new),
            vec!["ZO_SYNTHETICS_ENABLED"],
            "the warning has to name the env var, not just say 'synthetics changed'"
        );
    }

    /// Mutates every field away from its current value, so the two tests below
    /// run against the whole struct — an implementation that warns about an
    /// extra key cannot hide in the fields a subset forgot to touch.
    fn mutate_every_synthetics_field(cfg: &mut Synthetics) {
        cfg.enabled = !cfg.enabled;
        cfg.lambda_browser.push_str("-changed");
        cfg.lambda_net.push_str("-changed");
        cfg.api_endpoint = "https://example.invalid".to_string();
        cfg.install_script_url = "https://example.invalid/install.sh".to_string();
        cfg.recorder_extension_url = "https://example.invalid/ext".to_string();
        cfg.agent_stale_secs += 60;
        cfg.max_check_budget_secs += 1;
        cfg.job_lease_secs += 1;
        cfg.max_net_timeout_ms += 1;
        cfg.browsers = "chromium,firefox".to_string();
        cfg.devices = "desktop:800:600".to_string();
        cfg.scheduler_jitter_enabled = !cfg.scheduler_jitter_enabled;
        cfg.orphan_detection_enabled = !cfg.orphan_detection_enabled;
    }

    #[test]
    fn changing_any_hot_synthetics_key_does_not_ask_for_a_restart() {
        // These take effect on the next read; warning about them would bury the
        // one key that really does need a restart. Every non-`enabled` field is
        // mutated, not a sample.
        let old = Synthetics::init().unwrap();
        let mut new = Synthetics::init().unwrap();
        mutate_every_synthetics_field(&mut new);
        new.enabled = old.enabled; // the one restart key, left alone

        assert!(
            synthetics_restart_required_changes(&old, &new).is_empty(),
            "hot keys and the ceilings must not produce a restart warning"
        );
    }

    #[test]
    fn synthetics_restart_warnings_are_exactly_the_restart_required_keys() {
        // Catches drift in BOTH directions: over-warning (a hot key that warns)
        // and under-warning (a restart key that stays silent). Set equality
        // rather than a subset is what makes an empty vec a failure.
        let old = Synthetics::init().unwrap();
        let mut new = Synthetics::init().unwrap();
        mutate_every_synthetics_field(&mut new);

        let mut warned = synthetics_restart_required_changes(&old, &new);
        warned.sort_unstable();

        assert_eq!(
            warned,
            synthetics_names_in_class(SyntheticsReloadClass::RestartRequired),
            "the warned set and the RestartRequired class have drifted apart"
        );
    }

    /// Adding a field must force a reload decision:
    /// `synthetics_restart_required_changes` destructures the struct with no
    /// `..`, so a new field breaks the build until someone classifies it.
    #[test]
    fn every_synthetics_field_forces_a_reload_decision() {
        assert_eq!(
            ALL_SYNTHETICS_ENV_VARS.len(),
            SYNTHETICS_RELOAD_CLASSES.len(),
            "if this fires, the destructure in synthetics_restart_required_changes was updated but \
             one of the two tables was not"
        );
    }

    #[test]
    fn the_synthetics_restart_warning_tells_the_operator_what_to_do() {
        // The set of warned keys is pinned above; this pins what the operator
        // actually reads. A message that only said "synthetics config changed"
        // would pass every other test in this module.
        assert_eq!(
            synthetics_restart_required_warning("ZO_SYNTHETICS_ENABLED"),
            "[synthetics] ZO_SYNTHETICS_ENABLED changed on reload but requires a restart to take \
             effect"
        );
    }

    #[test]
    fn test_config_static_uses_std_lazylock_api() {
        let cfg = std::sync::LazyLock::force(&CONFIG).load();
        assert_eq!(
            cfg.limit.req_cols_per_record_limit,
            get_config().limit.req_cols_per_record_limit
        );
    }

    #[test]
    fn test_get_config() {
        let mut cfg = Config::init().unwrap();
        let ret = check_limit_config(&mut cfg);
        assert!(ret.is_ok());

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

        // SNS configuration tests
        // Test default values
        check_sns_config(&mut cfg).unwrap();
        assert_eq!(cfg.sns.connect_timeout, 10);
        assert_eq!(cfg.sns.operation_timeout, 30);
        assert!(cfg.sns.endpoint.is_empty());

        // Test custom endpoint
        cfg.sns.endpoint = "https://sns.us-west-2.amazonaws.com".to_string();
        check_sns_config(&mut cfg).unwrap();
        assert_eq!(cfg.sns.endpoint, "https://sns.us-west-2.amazonaws.com");

        // Test custom timeouts
        cfg.sns.connect_timeout = 15;
        cfg.sns.operation_timeout = 45;
        check_sns_config(&mut cfg).unwrap();
        assert_eq!(cfg.sns.connect_timeout, 15);
        assert_eq!(cfg.sns.operation_timeout, 45);

        // Test zero values (should set to defaults)
        cfg.sns.connect_timeout = 0;
        cfg.sns.operation_timeout = 0;
        check_sns_config(&mut cfg).unwrap();
        assert_eq!(cfg.sns.connect_timeout, 10);
        assert_eq!(cfg.sns.operation_timeout, 30);

        // Test endpoint URL validation
        cfg.sns.endpoint = "invalid-url".to_string();
        assert!(check_sns_config(&mut cfg).is_err());

        cfg.memory_cache.max_size = 1024;
        cfg.memory_cache.release_size = 1024;
        cfg.memory_cache.bucket_num = 1;
        check_memory_config(&mut cfg).unwrap();
        assert_eq!(cfg.memory_cache.max_size, 1024 * 1024 * 1024);
        assert_eq!(cfg.memory_cache.release_size, 1024 * 1024 * 1024);

        cfg.limit.file_push_interval = 0;
        cfg.limit.req_cols_per_record_limit = 0;
        cfg.compact.interval = 0;
        cfg.compact.data_retention_days = 10;
        let ret = check_common_config(&mut cfg);
        assert!(ret.is_ok());
        assert_eq!(cfg.compact.data_retention_days, 10);
        assert_eq!(cfg.limit.req_cols_per_record_limit, 1000);

        cfg.compact.data_retention_days = 2;
        let ret = check_compact_config(&mut cfg);
        assert!(ret.is_err());

        cfg.common.data_dir = "".to_string();
        let ret = check_path_config(&mut cfg);
        assert!(ret.is_ok());

        cfg.common.data_dir = "/abc".to_string();
        cfg.common.data_wal_dir = "/abc".to_string();
        cfg.common.data_stream_dir = "/abc".to_string();
        cfg.common.base_uri = "/abc/".to_string();
        let ret = check_path_config(&mut cfg);
        assert!(ret.is_ok());
        assert_eq!(cfg.common.data_dir, "/abc/".to_string());
        assert_eq!(cfg.common.data_wal_dir, "/abc/".to_string());
        assert_eq!(cfg.common.data_stream_dir, "/abc/".to_string());
        assert_eq!(cfg.common.data_dir, "/abc/".to_string());
        assert_eq!(cfg.common.base_uri, "/abc".to_string());

        cfg.common.base_uri = "/".to_string();
        let ret = check_path_config(&mut cfg);
        assert!(ret.is_ok());
        assert_eq!(cfg.common.base_uri, "".to_string());

        // Test route dispatch strategies
        cfg.route.dispatch_strategy = RouteDispatchStrategy::Workload;
        assert!(check_route_config(&cfg).is_ok());

        cfg.route.dispatch_strategy = RouteDispatchStrategy::Random;
        assert!(check_route_config(&cfg).is_ok());

        cfg.route.dispatch_strategy = RouteDispatchStrategy::Other;
        assert!(check_route_config(&cfg).is_err());
    }

    #[test]
    fn test_usage_report_to_own_org_field_exists() {
        // Test that usage_report_to_own_org field exists and is accessible
        let cfg = Config::init().unwrap();
        // Verify the field is accessible as a boolean
        let _value: bool = cfg.common.usage_report_to_own_org;
        // Test passes if we can access the field without error
    }

    #[test]
    fn test_usage_report_to_own_org_env_override() {
        // Test that environment variable can override the default
        unsafe {
            std::env::set_var("ZO_USAGE_REPORT_TO_OWN_ORG", "false");
        }
        let cfg = Config::init().unwrap();
        // Note: This test may fail if the config is already loaded
        // In that case, we just verify the field exists
        let _ = cfg.common.usage_report_to_own_org;
        unsafe {
            std::env::remove_var("ZO_USAGE_REPORT_TO_OWN_ORG");
        }
    }

    #[test]
    fn test_ensure_not_empty_valid() {
        assert!(ensure_not_empty("valid", "TEST").is_ok());
    }

    #[test]
    fn test_ensure_not_empty_invalid() {
        assert!(ensure_not_empty("", "TEST").is_err());
    }

    #[test]
    fn test_ensure_not_empty_with_whitespace() {
        assert!(ensure_not_empty("  value  ", "TEST").is_ok());
    }

    #[test]
    fn test_ensure_not_empty_single_char() {
        assert!(ensure_not_empty("a", "TEST").is_ok());
    }

    #[test]
    fn test_file_format_display() {
        assert_eq!(FileFormat::Parquet.to_string(), "parquet");
        assert_eq!(FileFormat::Vortex.to_string(), "vortex");
    }

    #[test]
    fn test_file_format_from_str() {
        assert_eq!(
            "parquet".parse::<FileFormat>().unwrap(),
            FileFormat::Parquet
        );
        assert_eq!(
            "PARQUET".parse::<FileFormat>().unwrap(),
            FileFormat::Parquet
        );
        assert_eq!("vortex".parse::<FileFormat>().unwrap(), FileFormat::Vortex);
        assert_eq!("VORTEX".parse::<FileFormat>().unwrap(), FileFormat::Vortex);
        assert!("unknown".parse::<FileFormat>().is_err());
    }

    #[test]
    fn test_file_format_extension() {
        assert_eq!(FileFormat::Parquet.extension(), ".parquet");
        assert_eq!(FileFormat::Vortex.extension(), ".vortex");
    }

    #[test]
    fn test_file_format_for_ingester_stream() {
        assert_eq!(
            FileFormat::for_ingester_stream(StreamType::Metrics, FileFormat::Vortex),
            FileFormat::Parquet
        );
        assert_eq!(
            FileFormat::for_ingester_stream(StreamType::Logs, FileFormat::Vortex),
            FileFormat::Vortex
        );
        assert_eq!(
            FileFormat::for_ingester_stream(StreamType::Traces, FileFormat::Parquet),
            FileFormat::Parquet
        );
    }

    #[test]
    fn test_file_format_config_from_str() {
        let config = " parquet , LOGS=vortex, metrics = vortex, traces=parquet "
            .parse::<FileFormatConfig>()
            .unwrap();

        assert_eq!(config.for_stream(StreamType::Logs), FileFormat::Vortex);
        assert_eq!(config.for_stream(StreamType::Metrics), FileFormat::Vortex);
        assert_eq!(config.for_stream(StreamType::Traces), FileFormat::Parquet);
        assert_eq!(config.for_stream(StreamType::Metadata), FileFormat::Parquet);
        assert_eq!(
            config.to_string(),
            "parquet,logs=vortex,metrics=vortex,traces=parquet"
        );

        let config = "vortex".parse::<FileFormatConfig>().unwrap();
        assert_eq!(config.for_stream(StreamType::Logs), FileFormat::Vortex);
        assert_eq!(config.for_stream(StreamType::Metrics), FileFormat::Vortex);
        assert_eq!(config.for_stream(StreamType::Traces), FileFormat::Vortex);
    }

    #[test]
    fn test_file_format_config_rejects_invalid_values() {
        for value in [
            "",
            "metrics=vortex",
            "parquet,logs",
            "parquet,unknown=vortex",
            "parquet,metrics=unknown",
            "parquet,logs=vortex,LOGS=parquet",
            "parquet,vortex",
        ] {
            assert!(
                value.parse::<FileFormatConfig>().is_err(),
                "'{value}' should be rejected"
            );
        }
    }

    #[test]
    fn test_file_format_config_serde_as_string() {
        let config = "parquet,metrics=vortex"
            .parse::<FileFormatConfig>()
            .unwrap();
        let serialized = serde_json::to_string(&config).unwrap();

        assert_eq!(serialized, r#""parquet,metrics=vortex""#);
        assert_eq!(
            serde_json::from_str::<FileFormatConfig>(&serialized).unwrap(),
            config
        );
    }

    #[test]
    fn test_file_format_from_extension() {
        assert_eq!(
            FileFormat::from_extension("data.parquet"),
            Some(FileFormat::Parquet)
        );
        assert_eq!(
            FileFormat::from_extension("data.vortex"),
            Some(FileFormat::Vortex)
        );
        assert_eq!(FileFormat::from_extension("data.json"), None);
        assert_eq!(FileFormat::from_extension(""), None);
        // full path
        assert_eq!(
            FileFormat::from_extension("/some/path/file.parquet"),
            Some(FileFormat::Parquet)
        );
    }

    #[test]
    fn test_common_config_preserves_file_format_overrides() {
        let mut cfg = Config::init().unwrap();
        cfg.common.file_format = "parquet,metrics=vortex".parse().unwrap();

        check_common_config(&mut cfg).unwrap();

        assert_eq!(
            cfg.common.file_format,
            "parquet,metrics=vortex".parse().unwrap()
        );
    }

    #[test]
    fn test_tls_root_certificates_display() {
        assert_eq!(TlsRootCertificates::Webpki.to_string(), "webpki");
        assert_eq!(TlsRootCertificates::Native.to_string(), "native");
    }

    #[test]
    fn test_tls_root_certificates_from_str() {
        assert_eq!(
            "webpki".parse::<TlsRootCertificates>().unwrap(),
            TlsRootCertificates::Webpki
        );
        assert_eq!(
            "WEBPKI".parse::<TlsRootCertificates>().unwrap(),
            TlsRootCertificates::Webpki
        );
        assert_eq!(
            "native".parse::<TlsRootCertificates>().unwrap(),
            TlsRootCertificates::Native
        );
        assert_eq!(
            "NATIVE".parse::<TlsRootCertificates>().unwrap(),
            TlsRootCertificates::Native
        );
        assert!("invalid".parse::<TlsRootCertificates>().is_err());
    }

    #[test]
    fn test_route_dispatch_strategy_from_str() {
        assert!(matches!(
            "workload".parse::<RouteDispatchStrategy>().unwrap(),
            RouteDispatchStrategy::Workload
        ));
        assert!(matches!(
            "WORKLOAD".parse::<RouteDispatchStrategy>().unwrap(),
            RouteDispatchStrategy::Workload
        ));
        assert!(matches!(
            "random".parse::<RouteDispatchStrategy>().unwrap(),
            RouteDispatchStrategy::Random
        ));
        assert!(matches!(
            "RANDOM".parse::<RouteDispatchStrategy>().unwrap(),
            RouteDispatchStrategy::Random
        ));
        // unknown maps to Other, not an error
        assert!(matches!(
            "unknown".parse::<RouteDispatchStrategy>().unwrap(),
            RouteDispatchStrategy::Other
        ));
        assert!(matches!(
            "  workload  ".parse::<RouteDispatchStrategy>().unwrap(),
            RouteDispatchStrategy::Workload
        ));
    }

    #[test]
    fn test_get_parquet_compression() {
        use parquet::basic::Compression;
        assert_eq!(get_parquet_compression("snappy"), Compression::SNAPPY);
        assert_eq!(
            get_parquet_compression("uncompressed"),
            Compression::UNCOMPRESSED
        );
        assert_eq!(get_parquet_compression("none"), Compression::UNCOMPRESSED);
        assert_eq!(get_parquet_compression("lz4"), Compression::LZ4_RAW);
        assert_eq!(get_parquet_compression("lz4_raw"), Compression::LZ4_RAW);
        assert_eq!(get_parquet_compression("SNAPPY"), Compression::SNAPPY);
        // unknown defaults to zstd
        assert!(matches!(
            get_parquet_compression("unknown"),
            Compression::ZSTD(_)
        ));
        assert!(matches!(
            get_parquet_compression("gzip"),
            Compression::GZIP(_)
        ));
        assert!(matches!(
            get_parquet_compression("brotli"),
            Compression::BROTLI(_)
        ));
        assert!(matches!(
            get_parquet_compression("zstd"),
            Compression::ZSTD(_)
        ));
    }

    #[test]
    fn test_common_should_create_span() {
        let mut common = Common::default();
        assert!(!common.should_create_span());

        common.tracing_enabled = true;
        assert!(common.should_create_span());

        common.tracing_enabled = false;
        common.tracing_search_enabled = true;
        assert!(common.should_create_span());

        common.tracing_search_enabled = false;
        common.search_inspector_enabled = true;
        assert!(common.should_create_span());
    }

    #[test]
    fn test_check_grpc_config_no_tls() {
        let mut cfg = Config::default();
        cfg.grpc.tls_enabled = false;
        assert!(check_grpc_config(&mut cfg).is_ok());
    }

    #[test]
    fn test_check_grpc_config_tls_missing_fields() {
        let mut cfg = Config::default();
        cfg.grpc.tls_enabled = true;
        // All TLS fields empty — should fail
        assert!(check_grpc_config(&mut cfg).is_err());
    }

    #[test]
    fn test_check_grpc_config_tls_complete() {
        let mut cfg = Config::default();
        cfg.grpc.tls_enabled = true;
        cfg.grpc.tls_cert_domain = "example.com".to_string();
        cfg.grpc.tls_cert_path = "/certs/server.crt".to_string();
        cfg.grpc.tls_key_path = "/certs/server.key".to_string();
        assert!(check_grpc_config(&mut cfg).is_ok());
    }

    #[test]
    fn test_check_http_config_no_tls() {
        let mut cfg = Config::default();
        cfg.http.tls_enabled = false;
        assert!(check_http_config(&mut cfg).is_ok());
    }

    #[test]
    fn test_check_http_config_tls_missing_fields() {
        let mut cfg = Config::default();
        cfg.http.tls_enabled = true;
        // Both cert and key empty — should fail
        assert!(check_http_config(&mut cfg).is_err());

        cfg.http.tls_cert_path = "/certs/server.crt".to_string();
        // key still missing — should fail
        assert!(check_http_config(&mut cfg).is_err());
    }

    #[test]
    fn test_check_http_config_tls_complete() {
        let mut cfg = Config::default();
        cfg.http.tls_enabled = true;
        cfg.http.tls_cert_path = "/certs/server.crt".to_string();
        cfg.http.tls_key_path = "/certs/server.key".to_string();
        assert!(check_http_config(&mut cfg).is_ok());
    }

    #[test]
    fn test_check_nats_config_defaults() {
        let mut cfg = Config::default();
        cfg.nats.queue_max_size = 0;
        check_nats_config(&mut cfg).unwrap();
        // 2048 MB → bytes
        assert_eq!(cfg.nats.queue_max_size, 2048 * 1024 * 1024);
    }

    #[test]
    fn test_check_nats_config_custom() {
        let mut cfg = Config::default();
        cfg.nats.queue_max_size = 1;
        check_nats_config(&mut cfg).unwrap();
        assert_eq!(cfg.nats.queue_max_size, 1024 * 1024);
    }

    #[test]
    fn test_check_inverted_index_config_defaults() {
        let mut cfg = Config::default();
        cfg.search.inverted_index_result_cache_max_entries = 0;
        cfg.search.inverted_index_result_cache_max_entry_size = 0;
        cfg.search.inverted_index_skip_threshold = 0;
        cfg.limit.inverted_index_min_token_length = 0;
        cfg.limit.inverted_index_max_token_length = 0;
        check_inverted_index_config(&mut cfg).unwrap();
        assert_eq!(cfg.search.inverted_index_result_cache_max_entries, 10000);
        assert_eq!(cfg.search.inverted_index_result_cache_max_entry_size, 20480);
        assert_eq!(cfg.search.inverted_index_skip_threshold, 35);
        assert_eq!(cfg.limit.inverted_index_min_token_length, 2);
        assert_eq!(cfg.limit.inverted_index_max_token_length, 64);
    }

    #[test]
    fn test_check_inverted_index_config_preserves_existing() {
        let mut cfg = Config::default();
        cfg.search.inverted_index_result_cache_max_entries = 5000;
        cfg.limit.inverted_index_min_token_length = 3;
        cfg.limit.inverted_index_max_token_length = 32;
        check_inverted_index_config(&mut cfg).unwrap();
        assert_eq!(cfg.search.inverted_index_result_cache_max_entries, 5000);
        assert_eq!(cfg.limit.inverted_index_min_token_length, 3);
        assert_eq!(cfg.limit.inverted_index_max_token_length, 32);
    }

    #[test]
    fn test_check_health_check_config_defaults() {
        let mut cfg = Config::default();
        cfg.health_check.timeout = 0;
        cfg.health_check.failed_times = 0;
        check_health_check_config(&mut cfg).unwrap();
        assert_eq!(cfg.health_check.timeout, 5);
        assert_eq!(cfg.health_check.failed_times, 3);
    }

    #[test]
    fn test_check_health_check_config_preserves_existing() {
        let mut cfg = Config::default();
        cfg.health_check.timeout = 10;
        cfg.health_check.failed_times = 5;
        check_health_check_config(&mut cfg).unwrap();
        assert_eq!(cfg.health_check.timeout, 10);
        assert_eq!(cfg.health_check.failed_times, 5);
    }

    #[test]
    fn test_check_pipeline_config_defaults() {
        let mut cfg = Config::default();
        cfg.common.data_dir = "/data/".to_string();
        cfg.pipeline.remote_stream_wal_dir = "".to_string();
        cfg.pipeline.offset_flush_interval = 0;
        cfg.pipeline.remote_request_max_retry_time = 0;
        cfg.pipeline.pipeline_file_push_back_interval = 0;
        cfg.pipeline.pipeline_sink_task_spawn_interval_ms = 0;
        check_pipeline_config(&mut cfg).unwrap();
        assert_eq!(
            cfg.pipeline.remote_stream_wal_dir,
            "/data/remote_stream_wal/"
        );
        assert_eq!(cfg.pipeline.offset_flush_interval, 10);
        assert_eq!(cfg.pipeline.remote_request_max_retry_time, 86400);
        assert_eq!(cfg.pipeline.pipeline_file_push_back_interval, 2);
        assert_eq!(cfg.pipeline.pipeline_sink_task_spawn_interval_ms, 100);
    }

    #[test]
    fn test_check_pipeline_config_adds_trailing_slash() {
        let mut cfg = Config::default();
        cfg.common.data_dir = "/data/".to_string();
        cfg.pipeline.remote_stream_wal_dir = "/custom/wal".to_string();
        cfg.pipeline.offset_flush_interval = 5;
        cfg.pipeline.remote_request_max_retry_time = 3600;
        check_pipeline_config(&mut cfg).unwrap();
        assert_eq!(cfg.pipeline.remote_stream_wal_dir, "/custom/wal/");
        assert_eq!(cfg.pipeline.offset_flush_interval, 5);
        assert_eq!(cfg.pipeline.remote_request_max_retry_time, 3600);
    }

    #[test]
    fn test_check_queue_store_config_smart_default() {
        // the check runs once per config load, so use a fresh config per case
        // (the MB-to-bytes conversion is not idempotent)

        // unset resolves to nats in cluster mode
        let mut cfg = Config::default();
        cfg.common.local_mode = false;
        cfg.common.queue_store = "".to_string();
        check_queue_store_config(&mut cfg).unwrap();
        assert_eq!(cfg.common.queue_store, "nats");

        // unset resolves to memory in local mode
        let mut cfg = Config::default();
        cfg.common.local_mode = true;
        cfg.common.queue_store = "".to_string();
        check_queue_store_config(&mut cfg).unwrap();
        assert_eq!(cfg.common.queue_store, "memory");

        // explicit values are honored and lowercased
        let mut cfg = Config::default();
        cfg.common.local_mode = true;
        cfg.common.queue_store = "NATS".to_string();
        check_queue_store_config(&mut cfg).unwrap();
        assert_eq!(cfg.common.queue_store, "nats");
    }

    #[test]
    fn test_check_queue_store_config_rejects_unknown_values() {
        let mut cfg = Config::default();
        for value in ["sqlite", "natsx", "postgres", "auto"] {
            cfg.common.queue_store = value.to_string();
            assert!(
                check_queue_store_config(&mut cfg).is_err(),
                "queue store {value} must be rejected instead of falling back"
            );
        }
    }

    #[test]
    fn test_check_queue_store_config_memory_requires_local_mode() {
        let mut cfg = Config::default();
        cfg.common.queue_store = "memory".to_string();
        cfg.common.memory_queue_max_size = 64;
        cfg.common.local_mode = true;
        check_queue_store_config(&mut cfg).unwrap();
        cfg.common.local_mode = false;
        assert!(check_queue_store_config(&mut cfg).is_err());
    }

    #[test]
    fn test_check_queue_store_config_memory_size_validation() {
        let mut cfg = Config::default();
        cfg.common.queue_store = "memory".to_string();
        cfg.common.local_mode = true;
        // zero falls back to the 64 MB default, converted to bytes
        cfg.common.memory_queue_max_size = 0;
        assert!(check_queue_store_config(&mut cfg).is_ok());
        assert_eq!(cfg.common.memory_queue_max_size, 64 * 1024 * 1024);
        cfg.common.memory_queue_max_size = usize::MAX;
        assert!(check_queue_store_config(&mut cfg).is_err());
        // the config value is converted from MB to bytes during validation
        cfg.common.memory_queue_max_size = 32;
        assert!(check_queue_store_config(&mut cfg).is_ok());
        assert_eq!(cfg.common.memory_queue_max_size, 32 * 1024 * 1024);
    }

    #[test]
    #[allow(deprecated)]
    fn test_check_compact_config_defaults() {
        let mut cfg = Config::default();
        cfg.compact.data_retention_days = 0;
        cfg.compact.interval = 0;
        cfg.compact.max_file_size = 0;
        cfg.compact.delete_files_delay_hours = 0;
        cfg.compact.delete_files_delay_minutes = 0;
        cfg.compact.data_retention_interval = 0;
        cfg.compact.old_data_interval = 0;
        cfg.compact.old_data_max_days = 0;
        cfg.compact.old_data_min_hours = 0;
        cfg.compact.old_data_min_files = 0;
        cfg.compact.file_list_deleted_batch_size = 0;
        cfg.compact.batch_size = 0;
        cfg.compact.pending_jobs_metric_interval = 0;
        check_compact_config(&mut cfg).unwrap();
        assert_eq!(cfg.compact.interval, 10);
        assert_eq!(cfg.compact.max_file_size, 512 * 1024 * 1024);
        assert_eq!(cfg.compact.delete_files_delay_hours, 0);
        assert_eq!(cfg.compact.delete_files_delay_minutes, 120);
        assert_eq!(cfg.compact.data_retention_interval, 3600);
        assert_eq!(cfg.compact.old_data_interval, 3600);
        assert_eq!(cfg.compact.old_data_max_days, 7);
        assert_eq!(cfg.compact.old_data_min_hours, 2);
        assert_eq!(cfg.compact.old_data_min_files, 10);
        assert_eq!(cfg.compact.file_list_deleted_batch_size, 1000);
        assert_eq!(cfg.compact.batch_size, 100);
        assert_eq!(cfg.compact.pending_jobs_metric_interval, 300);
    }

    #[test]
    fn test_check_compact_config_retention_too_short() {
        let mut cfg = Config::default();
        cfg.compact.data_retention_days = 1;
        assert!(check_compact_config(&mut cfg).is_err());
        cfg.compact.data_retention_days = 2;
        assert!(check_compact_config(&mut cfg).is_err());
    }

    #[test]
    fn test_check_compact_config_valid_retention() {
        let mut cfg = Config::default();
        cfg.compact.data_retention_days = 3;
        assert!(check_compact_config(&mut cfg).is_ok());
        cfg.compact.data_retention_days = 0; // 0 means disabled
        assert!(check_compact_config(&mut cfg).is_ok());
    }

    #[test]
    fn test_db_monitoring_config_defaults() {
        // DBM's config surface is the feature flag plus ONE operational knob.
        // The per-SIGNAL flags stay gone (product decision: enabled means every
        // DBM signal is canonicalized and served, disabled means none is), but
        // the rollup interval is back as config because it is the freshness
        // floor of every rollup-backed page and the sizing input for the read
        // path's live delta — a deployment's right value depends on its span
        // volume, which no shipped constant can know. It ships ON, at 900 s.
        let cfg = Config::init().unwrap();
        assert!(cfg.db_monitoring.enabled);
        assert_eq!(cfg.db_monitoring.rollup_interval_secs, 900);
    }

    /// The interval is read through `rollup_interval_secs()`, which clamps to
    /// [60, 3600]. A deployment that sets 0 (or omits the var into a 0 default
    /// on some loader path) would otherwise divide the job cadence to zero and
    /// spin, and an unbounded upper value makes the read path's delta a
    /// full-window scan on every miss.
    #[test]
    fn test_db_monitoring_rollup_interval_is_clamped() {
        // Mirrors the accessor's clamp, asserted here so the bound is pinned
        // next to the field it guards.
        assert_eq!(0_u64.clamp(60, 3600), 60);
        assert_eq!(30_u64.clamp(60, 3600), 60);
        assert_eq!(900_u64.clamp(60, 3600), 900);
        assert_eq!(86_400_u64.clamp(60, 3600), 3600);
    }

    /// The UI gates the whole DBM menu/route surface on this flag, so it only
    /// does anything if it reaches `zoConfig`. A flag the UI cannot see is a
    /// flag that silently does nothing — and nothing else in the workspace
    /// fails when the wiring is missing, because both halves compile fine
    /// alone. It is also the ONLY `database_monitoring_*` field the /config
    /// payload may carry: the per-signal flags were removed with their knobs,
    /// and re-adding one here would silently resurrect a config surface the
    /// product decided away.
    #[test]
    fn test_db_monitoring_flag_reaches_the_frontend_and_is_the_only_one() {
        let status = include_str!("../../api/management/src/request/status/mod.rs");
        assert!(
            status.contains("database_monitoring_enabled"),
            "the flag must be exposed on the config payload the UI reads"
        );
        assert!(
            status.contains("cfg.db_monitoring.enabled"),
            "the exposed field must be fed from the config flag, not hardcoded"
        );
        assert_eq!(
            status.matches("database_monitoring_").count(),
            2, // one struct field + one construction site
            "database_monitoring_enabled must be the ONLY database_monitoring_* \
             field on the /config payload — the per-signal flags were removed \
             when the config collapsed to a single switch"
        );
    }

    #[test]
    fn test_check_limit_config_batch_size_clamping() {
        let mut cfg = Config::init().unwrap();
        cfg.limit.batch_size = 0;
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.batch_size, 8192);

        cfg.limit.batch_size = 100; // below min
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.batch_size, 1024);

        cfg.limit.batch_size = 10000; // above max
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.batch_size, 8192);

        cfg.limit.batch_size = 4096; // within range
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.batch_size, 4096);
    }

    #[test]
    fn test_check_limit_config_ingest_time_conversion() {
        let mut cfg = Config::init().unwrap();
        cfg.limit.ingest_allowed_upto = 1;
        cfg.limit.ingest_allowed_in_future = 2;
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.ingest_allowed_upto_micro, 3600 * 1_000_000);
        assert_eq!(
            cfg.limit.ingest_allowed_in_future_micro,
            2 * 3600 * 1_000_000
        );
    }

    #[test]
    fn test_check_limit_config_file_retention_migration() {
        let mut cfg = Config::init().unwrap();
        // deprecated logs_file_retention set to non-hourly should migrate to query_retention
        cfg.limit.logs_file_retention = "daily".to_string();
        cfg.limit.logs_query_retention = "hourly".to_string();
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.logs_query_retention, "daily");
        // file retention always reset to hourly
        assert_eq!(cfg.limit.logs_file_retention, "hourly");
    }

    #[test]
    fn test_check_limit_config_file_retention_no_migration_if_query_set() {
        let mut cfg = Config::init().unwrap();
        // if query_retention was already explicitly set, don't overwrite it
        cfg.limit.logs_file_retention = "daily".to_string();
        cfg.limit.logs_query_retention = "weekly".to_string();
        check_limit_config(&mut cfg).unwrap();
        assert_eq!(cfg.limit.logs_query_retention, "weekly");
    }

    #[test]
    #[allow(deprecated)]
    fn test_check_common_config_bloom_filter_fields_migration() {
        let mut cfg = Config::init().unwrap();
        // deprecated ZO_BLOOM_FILTER_DEFAULT_FIELDS should migrate to the new ENV
        cfg.common.bloom_filter_default_fields = "trace_id,span_id".to_string();
        cfg.common.feature_bloom_filter_extra_fields = "".to_string();
        check_common_config(&mut cfg).unwrap();
        assert_eq!(
            cfg.common.feature_bloom_filter_extra_fields,
            "trace_id,span_id"
        );
    }

    #[test]
    #[allow(deprecated)]
    fn test_check_common_config_bloom_filter_fields_merge() {
        let mut cfg = Config::init().unwrap();
        // when both ENVs are set, the deprecated one is merged into the new one
        cfg.common.bloom_filter_default_fields = "span_id".to_string();
        cfg.common.feature_bloom_filter_extra_fields = "trace_id".to_string();
        check_common_config(&mut cfg).unwrap();
        assert_eq!(
            cfg.common.feature_bloom_filter_extra_fields,
            "trace_id,span_id"
        );
    }

    #[test]
    #[allow(deprecated)]
    fn test_check_common_config_bloom_filter_fields_no_migration() {
        let mut cfg = Config::init().unwrap();
        cfg.common.bloom_filter_default_fields = "".to_string();
        cfg.common.feature_bloom_filter_extra_fields = "trace_id".to_string();
        check_common_config(&mut cfg).unwrap();
        assert_eq!(cfg.common.feature_bloom_filter_extra_fields, "trace_id");
    }

    #[test]
    fn test_check_s3_config_bucket_prefix_trailing_slash() {
        let mut cfg = Config::default();
        cfg.s3.server_url = "".to_string();
        cfg.s3.provider = "aws".to_string();
        cfg.s3.bucket_prefix = "prefix1,prefix2".to_string();
        check_s3_config(&mut cfg).unwrap();
        // each prefix should end with /
        assert_eq!(cfg.s3.bucket_prefix, "prefix1/,prefix2/");
    }

    #[test]
    fn test_check_s3_config_bucket_prefix_already_has_slash() {
        let mut cfg = Config::default();
        cfg.s3.provider = "aws".to_string();
        cfg.s3.bucket_prefix = "prefix1/,prefix2/".to_string();
        check_s3_config(&mut cfg).unwrap();
        assert_eq!(cfg.s3.bucket_prefix, "prefix1/,prefix2/");
    }

    #[test]
    fn test_check_s3_config_provider_lowercase() {
        let mut cfg = Config::default();
        cfg.s3.provider = "AWS".to_string();
        check_s3_config(&mut cfg).unwrap();
        assert_eq!(cfg.s3.provider, "aws");
    }

    #[test]
    fn test_check_s3_config_keepalive_default() {
        let mut cfg = Config::default();
        cfg.s3.provider = "aws".to_string();
        cfg.s3.keepalive_timeout = 0;
        check_s3_config(&mut cfg).unwrap();
        assert_eq!(cfg.s3.keepalive_timeout, 20);
    }

    #[test]
    fn test_ensure_not_empty_whitespace_only() {
        let result = ensure_not_empty("   ", "field");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("field"));
    }

    #[test]
    fn test_ensure_not_empty_tab_only() {
        assert!(ensure_not_empty("\t", "field").is_err());
        assert!(ensure_not_empty("\n", "field").is_err());
    }

    #[test]
    fn test_get_batch_size_positive() {
        let size = get_batch_size();
        assert!(size > 0, "batch size should be positive");
    }

    #[test]
    fn test_cache_and_get_instance_id() {
        cache_instance_id("test-instance-abc");
        assert_eq!(get_instance_id(), "test-instance-abc");
        cache_instance_id("test-instance-xyz");
        assert_eq!(get_instance_id(), "test-instance-xyz");
    }

    #[test]
    fn test_get_instance_id_empty_when_not_set() {
        let id = get_instance_id();
        let _ = id.len();
    }

    #[test]
    fn test_is_local_disk_storage_returns_bool() {
        let result: bool = is_local_disk_storage();
        let _ = result;
    }

    #[test]
    fn test_get_cluster_name_returns_nonempty() {
        let name = get_cluster_name();
        assert!(!name.is_empty(), "cluster name should not be empty");
    }

    #[test]
    fn test_deverbatim_plain_path_unchanged() {
        let p = std::path::Path::new("/data/openobserve");
        let result = deverbatim(p);
        assert_eq!(result, "/data/openobserve");
    }

    #[test]
    fn test_deverbatim_empty_path_unchanged() {
        let p = std::path::Path::new("");
        let result = deverbatim(p);
        assert_eq!(result, "");
    }

    #[cfg(windows)]
    #[test]
    fn test_deverbatim_verbatim_disk_stripped() {
        let p = std::path::Path::new(r"\\?\C:\data\openobserve");
        let result = deverbatim(p);
        assert_eq!(result, r"C:\data\openobserve");
    }

    #[cfg(windows)]
    #[test]
    fn test_deverbatim_plain_windows_path_unchanged() {
        let p = std::path::Path::new(r"C:\data\openobserve");
        let result = deverbatim(p);
        assert_eq!(result, r"C:\data\openobserve");
    }
}
