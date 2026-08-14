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

//! Database Monitoring ingest enrichment (design: `docs/___databsepages/dbm-design-doc.md` §3;
//! test approach:
//! `docs/___databsepages/plans-and-specs/2026-08-07-dbm-phase1-test-approach-design.md` §2).
//!
//! For CLIENT/PRODUCER spans carrying OTel `db.*` attributes, [`enrich`] derives a canonical,
//! dual-semconv-resolved identity plus a stable query fingerprint and returns the flattened
//! `o2_db_*` record to be written onto the span — the same technique `inferred.rs` uses for
//! `infer_service_*`. Old and new semconv attribute names resolve to the SAME identity and the
//! SAME fingerprint: mixed fleets mid-migration must not split one query across two rows.
//!
//! The RED-phase golden corpus lives in `corpus/*.json`, driven by `tests.rs`.

pub mod api;
pub mod chains;
pub mod normalizer;
pub mod rollup;
pub mod server_vantage;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_equivalence;
#[cfg(test)]
mod tests_server_vantage;

use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
    num::NonZeroUsize,
    sync::{Arc, LazyLock, Mutex},
};

pub use normalizer::{
    Dialect, NormalizeError, NormalizedStatement, StmtClass, normalize, normalize_with_opts,
};
use serde_json::{Map, Value};

/// Derived field names, already in flattened (underscore) form. All of them must be listed in
/// `RESERVED_SPAN_FIELDS` so user attributes cannot spoof them (design D1 condition 1).
pub const O2_DB_FINGERPRINT: &str = "o2_db_fingerprint";
pub const O2_DB_QUERY_NORM: &str = "o2_db_query_norm";
pub const O2_DB_SYSTEM: &str = "o2_db_system";
pub const O2_DB_NAMESPACE: &str = "o2_db_namespace";
pub const O2_DB_INSTANCE: &str = "o2_db_instance";
pub const O2_DB_OPERATION: &str = "o2_db_operation";
pub const O2_DB_STATUS_CODE: &str = "o2_db_status_code";
pub const O2_DB_USER: &str = "o2_db_user";
pub const O2_DB_ENV: &str = "o2_db_env";
pub const O2_DB_STMT_CLASS: &str = "o2_db_stmt_class";
/// The one non-Utf8 (Int64) column — written only when a batch collapse occurred.
pub const O2_DB_BATCH_MULTIPLIER: &str = "o2_db_batch_multiplier";

/// All 11 derived columns (design §3.1). Order: identity, then dimensions, then class/batch.
pub const ALL_DB_FIELDS: [&str; 11] = [
    O2_DB_FINGERPRINT,
    O2_DB_QUERY_NORM,
    O2_DB_SYSTEM,
    O2_DB_NAMESPACE,
    O2_DB_INSTANCE,
    O2_DB_OPERATION,
    O2_DB_STATUS_CODE,
    O2_DB_USER,
    O2_DB_ENV,
    O2_DB_STMT_CLASS,
    O2_DB_BATCH_MULTIPLIER,
];

/// Normalizer/fingerprint algorithm version (`o2_db_fp_version`). Bump ONLY with a release
/// note: a bump is a trend discontinuity for every stored fingerprint.
///
/// * **v1** — initial lexer-based normalizer.
/// * **v2** — the hash stream stopped reproducing the author's whitespace. Space is now emitted
///   only between two adjacent word/quoted/placeholder tokens; space adjacent to punctuation is
///   dropped. Reason: the SERVER vantage never sees driver text. `pg_stat_statements` and MySQL's
///   `performance_schema` hand us statements their own jumbler already re-spaced, padding every
///   paren and comma, so every INSERT and every aggregate SELECT hashed differently from the client
///   span for the same statement, and the captured plan was invisible under the client's
///   fingerprint. Display text (`o2_db_query_norm`) is unaffected — only the hash changed.
pub const FP_VERSION: u32 = 2;

/// Cap on the stored `o2_db_query_norm` text (bytes).
pub const MAX_NORM_STORED: usize = 4096;

/// Cap on normalizer input (bytes): truncate at 16 KB, then lex; if truncation produces a lexer
/// error the standard failure rule applies (no `query_norm`, operation+collection fallback
/// fingerprint) so a mid-token cut can never leak a literal.
pub const MAX_NORM_INPUT: usize = 16 * 1024;

/// Bounded entries in the per-node raw-text → normalized-result LRU (design §3.2 overhead
/// guard). Real workloads repeat a small set of raw texts constantly, so the lexer amortizes to
/// near-zero, which is what keeps normalization off the ingest critical path.
const NORMALIZE_CACHE_ENTRIES: usize = 4096;

/// Raw texts longer than this are normalized without caching — they are rare, and caching them
/// would let a burst of huge one-off statements evict the whole hot set while pinning up to
/// `NORMALIZE_CACHE_ENTRIES × 16 KB` of memory.
const NORMALIZE_CACHE_MAX_TEXT: usize = 8 * 1024;

/// Cache shards: every trace-ingest thread hits this cache per DB span, so a single global
/// mutex would serialize them all — the key hash picks the shard, each with its own LRU slice.
const NORMALIZE_CACHE_SHARDS: usize = 16;

/// 64-bit hash of `(dialect, fold_identifiers, text)`, computed without copying the up-to-8 KB
/// raw text. A key collision maps two texts onto one cached result — the risk is of the same
/// order as the fingerprint hash's own collision risk and accepted on the same grounds.
type NormalizeCacheKey = u64;
/// `None` caches a lexer failure — failing texts repeat exactly like succeeding ones.
/// `Arc` so a cache hit is a refcount bump, never a deep clone of the normalized statement.
type NormalizeCache = lru::LruCache<NormalizeCacheKey, Option<Arc<NormalizedStatement>>>;

static NORMALIZE_CACHE: LazyLock<Vec<Mutex<NormalizeCache>>> = LazyLock::new(|| {
    (0..NORMALIZE_CACHE_SHARDS)
        .map(|_| {
            Mutex::new(lru::LruCache::new(
                NonZeroUsize::new(NORMALIZE_CACHE_ENTRIES / NORMALIZE_CACHE_SHARDS).unwrap(),
            ))
        })
        .collect()
});

fn normalize_cache_key(text: &str, dialect: Dialect, fold_identifiers: bool) -> NormalizeCacheKey {
    // Workspace default hasher (gxhash; DefaultHasher on archs without AES).
    let mut h = config::utils::hash::gxhash::new_hasher();
    dialect.hash(&mut h);
    fold_identifiers.hash(&mut h);
    text.hash(&mut h);
    h.finish()
}

/// [`normalize_with_opts`] behind the per-node sharded LRU. Returns `None` on lexer failure (the
/// caller's standard failure rule applies — no query_norm, operation+collection fallback
/// fingerprint).
pub(crate) fn normalize_cached(
    text: &str,
    dialect: Dialect,
    fold_identifiers: bool,
) -> Option<Arc<NormalizedStatement>> {
    if text.len() > NORMALIZE_CACHE_MAX_TEXT {
        return normalize_with_opts(text, dialect, fold_identifiers)
            .ok()
            .map(Arc::new);
    }
    let key = normalize_cache_key(text, dialect, fold_identifiers);
    let shard = &NORMALIZE_CACHE[key as usize % NORMALIZE_CACHE_SHARDS];
    if let Ok(mut cache) = shard.lock()
        && let Some(cached) = cache.get(&key)
    {
        return cached.clone();
    }
    let result = normalize_with_opts(text, dialect, fold_identifiers)
        .ok()
        .map(Arc::new);
    if let Ok(mut cache) = shard.lock() {
        cache.put(key, result.clone());
    }
    result
}

/// Attribute source for [`enrich`]: both the OTLP call site's `HashMap` and the JSON call site's
/// `serde_json::Map` (also the corpus tests') feed the same enrichment.
pub trait SpanAttrs {
    fn get_attr(&self, key: &str) -> Option<&Value>;
    /// Attr-presence early exit (design §3.2 overhead guard): any `db.*`/`db_*` key present.
    fn has_db_attr(&self) -> bool;
}

const SERVICE_PREFIX: &str = "service_";

/// Run `f` with `service_{key}` built in a stack buffer — attr probes run ~20–40 times per DB
/// span, so the prefixed lookup key must not heap-allocate. All resolver candidate names fit;
/// the heap fallback exists only for defensive completeness.
#[inline]
fn with_service_key<R>(key: &str, f: impl FnOnce(&str) -> R) -> R {
    let mut buf = [0u8; 64];
    let total = SERVICE_PREFIX.len() + key.len();
    if total <= buf.len() {
        buf[..SERVICE_PREFIX.len()].copy_from_slice(SERVICE_PREFIX.as_bytes());
        buf[SERVICE_PREFIX.len()..total].copy_from_slice(key.as_bytes());
        // Both halves are valid UTF-8 and the join is at an ASCII boundary.
        f(std::str::from_utf8(&buf[..total]).expect("ascii prefix + utf8 key"))
    } else {
        f(&format!("{SERVICE_PREFIX}{key}"))
    }
}

/// `Map` and `HashMap` need byte-identical impls — one macro body keeps them from drifting.
macro_rules! impl_span_attrs_for_map {
    ($ty:ty) => {
        impl SpanAttrs for $ty {
            fn get_attr(&self, key: &str) -> Option<&Value> {
                // Flat JSON-path records carry resource attributes under the
                // `service_` prefix (the stored-span shape) — fall back to that form
                // so resource-level dimensions (o2_db_env, design §3.1) resolve.
                self.get(key)
                    .or_else(|| with_service_key(key, |sk| self.get(sk)))
            }
            fn has_db_attr(&self) -> bool {
                self.keys()
                    .any(|k| k.starts_with("db.") || k.starts_with("db_"))
            }
        }
    };
}

impl_span_attrs_for_map!(Map<String, Value>);
impl_span_attrs_for_map!(std::collections::HashMap<String, Value>);

/// Attribute view for the OTLP call site, where span attributes and resource
/// attributes live in two separate maps (`span_att_map` / `service_att_map`).
/// Resource attributes are stored under `service_`-prefixed keys
/// (`resource_attribute_key`), so lookups try: span key → resource key →
/// resource `service_`-prefixed key. Span attributes win on conflict.
///
/// `has_db_attr` deliberately checks the SPAN map only: negative stamping
/// (design §3.1) keys off span-level db attributes — a resource-level `db.*`
/// key must not turn every span of that resource into a DB span.
pub struct SpanWithResource<'a> {
    pub span: &'a std::collections::HashMap<String, Value>,
    pub resource: &'a std::collections::HashMap<String, Value>,
}

impl SpanAttrs for SpanWithResource<'_> {
    fn get_attr(&self, key: &str) -> Option<&Value> {
        self.span
            .get(key)
            .or_else(|| self.resource.get(key))
            .or_else(|| with_service_key(key, |sk| self.resource.get(sk)))
    }
    fn has_db_attr(&self) -> bool {
        self.span
            .keys()
            .any(|k| k.starts_with("db.") || k.starts_with("db_"))
    }
}

/// Runtime knobs for [`enrich_with_opts`], mirroring the `ZO_DB_MONITORING_*` config block
/// (design §8). [`Default`] matches the config defaults.
#[derive(Debug, Clone)]
pub struct EnrichOptions {
    /// `ZO_DB_MONITORING_STORE_NORM_TEXT`: false stores the fingerprint only — no
    /// `o2_db_query_norm` on the span (including the degraded-row fallback text).
    pub store_norm_text: bool,
    /// `ZO_DB_MONITORING_MAX_NORM_LEN`: cap (bytes) on the stored `o2_db_query_norm`. The
    /// fingerprint is always computed over the full normalized text.
    pub max_norm_len: usize,
    /// `ZO_DB_MONITORING_NORMALIZE_IDENTIFIERS`: digit/UUID/hex folding inside identifiers.
    pub normalize_identifiers: bool,
}

impl Default for EnrichOptions {
    fn default() -> Self {
        Self {
            store_norm_text: true,
            max_norm_len: MAX_NORM_STORED,
            normalize_identifiers: true,
        }
    }
}

/// Derive the full `o2_db_*` record for one span, or `None` if the span does not qualify.
///
/// * `attrs` — the span's merged attribute map (span + resource), with keys in dotted and/or
///   flattened underscore form; values as flattened JSON.
/// * `span_kind` — OTLP proto span kind as an `i32`, the same representation
///   `inferred::derive_inferred_service` receives (CLIENT = 3, PRODUCER = 4).
///
/// Qualifying spans: CLIENT/PRODUCER with at least one DB attribute. SERVER/INTERNAL spans and
/// DB-attr-free CLIENT spans return `None` — no `o2_db_*` keys at all (the negative-stamping
/// invariant that lets the rollup drop its span_kind predicate). Unlisted `db.system` values
/// route to the operation+collection fallback hash with no `query_norm`.
///
/// Returned map: `o2_db_*` keys → `Value::String`, except [`O2_DB_BATCH_MULTIPLIER`] which is a
/// `Value::Number` (i64) present only when a batch collapse occurred. Absent dimensions are
/// absent keys, never nulls.
pub fn enrich<A: SpanAttrs>(attrs: &A, span_kind: i32) -> Option<BTreeMap<String, Value>> {
    enrich_with_opts(attrs, span_kind, &EnrichOptions::default())
}

/// [`enrich`] with the runtime `ZO_DB_MONITORING_*` knobs applied (design §8) — the ingest call
/// sites use this form with options built from live config.
pub fn enrich_with_opts<A: SpanAttrs>(
    attrs: &A,
    span_kind: i32,
    opts: &EnrichOptions,
) -> Option<BTreeMap<String, Value>> {
    const SPAN_KIND_CLIENT: i32 = 3;
    const SPAN_KIND_PRODUCER: i32 = 4;
    if span_kind != SPAN_KIND_CLIENT && span_kind != SPAN_KIND_PRODUCER {
        return None;
    }
    // Attr-presence early exit (design §3.2 overhead guard): only spans carrying a DB attribute
    // qualify — the negative-stamping invariant.
    if !attrs.has_db_attr() {
        return None;
    }

    let system_raw = resolve(
        attrs,
        &[
            ("db.system.name", "db_system_name"),
            ("db.system", "db_system"),
        ],
    );
    let system = system_raw.as_deref().map(canonical_system);
    let dialect = system.as_deref().and_then(route_dialect);
    let text = resolve(
        attrs,
        &[
            ("db.query.text", "db_query_text"),
            ("db.statement", "db_statement"),
        ],
    );
    let op_attr = resolve(
        attrs,
        &[
            ("db.operation.name", "db_operation_name"),
            ("db.operation", "db_operation"),
        ],
    );
    let collection = resolve(
        attrs,
        &[
            ("db.collection.name", "db_collection_name"),
            ("db.sql.table", "db_sql_table"),
            ("db.mongodb.collection", "db_mongodb_collection"),
            ("db.cassandra.table", "db_cassandra_table"),
        ],
    );

    // Elasticsearch template sources (design §3.2 routing table, explicit): method from
    // `http.request.method` (fallback `db.operation[.name]`), path from the URL path component of
    // `url.full` (fallback: first line of statement text, which ES clients populate with
    // method+endpoint). The request body is never normalized into the template.
    // `text` is moved in (not cloned) — nothing below reads it; the later checks use
    // `effective_text`.
    let effective_text: Option<String> = if dialect == Some(Dialect::Elasticsearch) {
        let method = resolve(attrs, &[("http.request.method", "http_request_method")])
            .or_else(|| op_attr.clone());
        match (
            method,
            resolve(attrs, &[("url.full", "url_full")]).and_then(|u| url_path_of(&u)),
        ) {
            (Some(m), Some(p)) => Some(format!("{m} {p}")),
            (None, Some(p)) => Some(p),
            (_, None) => text,
        }
    } else {
        text
    };

    // Failure rule (design §3.2): on lexer error (or an unlisted `db.system` route) the raw text
    // is NEVER used — no query_norm, operation+collection fallback fingerprint. The per-node LRU
    // (design §3.2 overhead guard) amortizes the lexer on repeating raw texts.
    let ns = match (dialect, effective_text.as_deref()) {
        (Some(d), Some(t)) => normalize_cached(t, d, opts.normalize_identifiers),
        _ => None,
    };

    // Resolution order (design §3.1): `db.operation.name` → `db.operation` → first token of
    // normalized text (skipping leading TCL statements — handled by the normalizer).
    let operation = op_attr.or_else(|| ns.as_ref().and_then(|n| n.operation.clone()));

    let query_norm: Option<String> = if !opts.store_norm_text {
        // `ZO_DB_MONITORING_STORE_NORM_TEXT=false`: fingerprint-only on spans (§3.2 storage
        // trade-off) — also drops the degraded-row fallback text below.
        None
    } else if let Some(n) = &ns {
        n.query_norm
            .as_deref()
            .map(|s| normalizer::truncate_at_boundary(s, opts.max_norm_len).to_string())
    } else if effective_text.is_none() {
        // No-text spans store the literal-free fallback string "{operation} {collection}" so two
        // degraded rows with different collections don't display identically (design §3.1).
        let joined = [operation.as_deref(), collection.as_deref()]
            .iter()
            .flatten()
            .copied()
            .collect::<Vec<_>>()
            .join(" ");
        (!joined.is_empty()).then_some(joined)
    } else {
        None
    };

    // Fingerprint resolution (design §3.1): hash of normalized text; else hash of
    // `db.query.summary`; else hash of `{operation} {collection}`. Fallback inputs are
    // domain-prefixed so a degraded-row hash can never collide with a text hash.
    let fingerprint = if let Some(n) = &ns {
        n.fingerprint.clone()
    } else if let Some(summary) = effective_text
        .is_none()
        .then(|| resolve(attrs, &[("db.query.summary", "db_query_summary")]))
        .flatten()
    {
        normalizer::fingerprint_hex(&format!("summary:{}", summary.to_lowercase()))
    } else {
        normalizer::fingerprint_hex(&format!(
            "op+coll:{} {}",
            operation.as_deref().unwrap_or("").to_lowercase(),
            collection.as_deref().unwrap_or("").to_lowercase()
        ))
    };

    let stmt_class = ns
        .as_ref()
        .map(|n| n.stmt_class)
        .unwrap_or_else(|| classify_operation(operation.as_deref()));

    let mut out: BTreeMap<String, Value> = BTreeMap::new();
    out.insert(O2_DB_FINGERPRINT.to_string(), Value::String(fingerprint));
    out.insert(
        O2_DB_STMT_CLASS.to_string(),
        Value::String(stmt_class.as_str().to_string()),
    );
    let mut put = |key: &str, val: Option<String>| {
        if let Some(v) = val {
            out.insert(key.to_string(), Value::String(v));
        }
    };
    put(O2_DB_QUERY_NORM, query_norm);
    put(O2_DB_SYSTEM, system);
    put(
        O2_DB_NAMESPACE,
        resolve(
            attrs,
            &[("db.namespace", "db_namespace"), ("db.name", "db_name")],
        ),
    );
    put(
        O2_DB_INSTANCE,
        resolve(
            attrs,
            &[
                ("server.address", "server_address"),
                ("net.peer.name", "net_peer_name"),
            ],
        )
        .as_deref()
        .map(strip_port),
    );
    put(O2_DB_OPERATION, operation);
    put(
        O2_DB_STATUS_CODE,
        resolve(
            attrs,
            &[("db.response.status_code", "db_response_status_code")],
        ),
    );
    put(O2_DB_USER, resolve(attrs, &[("db.user", "db_user")]));
    put(
        O2_DB_ENV,
        resolve(
            attrs,
            &[
                ("deployment.environment.name", "deployment_environment_name"),
                ("deployment.environment", "deployment_environment"),
            ],
        ),
    );
    if let Some(n) = &ns
        && n.batch_multiplier > 1
    {
        out.insert(
            O2_DB_BATCH_MULTIPLIER.to_string(),
            Value::Number(n.batch_multiplier.into()),
        );
    }
    Some(out)
}

/// Dual-semconv attribute lookup: first non-empty value among `names`, each tried in dotted and
/// flattened (underscore) form. Both forms are precomputed const pairs — `resolve` runs ~10
/// times per DB span, and a runtime `replace('.', "_")` per candidate would allocate a String
/// for every probe.
fn resolve<A: SpanAttrs>(attrs: &A, names: &[(&str, &str)]) -> Option<String> {
    for (dotted, underscored) in names {
        debug_assert_eq!(
            *underscored,
            dotted.replace('.', "_"),
            "const underscore form out of sync with its dotted name"
        );
        let val = attrs
            .get_attr(dotted)
            .or_else(|| attrs.get_attr(underscored));
        if let Some(v) = val {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

/// Normalize `db.system.name`/`db.system` values to the stable enum vocabulary (design §3.1):
/// new-semconv aliases fold onto the canonical short names; unknown systems pass through
/// lowercased (they route to the operation+collection fallback).
fn canonical_system(raw: &str) -> String {
    let lower = raw.to_lowercase();
    match lower.as_str() {
        "microsoft.sql_server" => "mssql".to_string(),
        "oracle.db" => "oracle".to_string(),
        _ => lower,
    }
}

/// Engine → normalizer routing (design §3.2). Unlisted systems return `None` → the
/// operation+collection fallback hash with no query_norm.
fn route_dialect(system: &str) -> Option<Dialect> {
    Some(match system {
        "postgresql" => Dialect::Postgresql,
        "mysql" => Dialect::Mysql,
        "mariadb" => Dialect::Mariadb,
        "mssql" => Dialect::Mssql,
        "oracle" => Dialect::Oracle,
        "cockroachdb" => Dialect::Cockroachdb,
        "cassandra" => Dialect::Cassandra,
        "clickhouse" => Dialect::Clickhouse,
        "redis" | "valkey" => Dialect::Redis,
        "mongodb" => Dialect::Mongodb,
        "elasticsearch" | "opensearch" => Dialect::Elasticsearch,
        _ => return None,
    })
}

/// Statement class when the normalizer did not run (no-text / lexer-failure / unlisted-system
/// spans): derived from the resolved operation keyword.
fn classify_operation(op: Option<&str>) -> StmtClass {
    match op.map(|o| o.to_ascii_uppercase()).as_deref() {
        Some("BEGIN" | "START" | "COMMIT" | "ROLLBACK" | "SAVEPOINT" | "RELEASE" | "ABORT") => {
            StmtClass::TransactionControl
        }
        Some("SET" | "RESET") => StmtClass::SessionControl,
        Some("PING") => StmtClass::Ping,
        _ => StmtClass::Query,
    }
}

/// Strip a trailing `:port` from `server.address`/`net.peer.name`. Bare IPs are deliberately
/// KEPT (deviation from `inferred.rs` — databases are commonly addressed by IP).
fn strip_port(addr: &str) -> String {
    if let Some(rest) = addr.strip_prefix('[') {
        // [IPv6]:port
        if let Some(end) = rest.find(']') {
            return rest[..end].to_string();
        }
    }
    match addr.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => {
            host.to_string()
        }
        _ => addr.to_string(),
    }
}

/// The URL path component of `url.full` (query string and fragment excluded).
fn url_path_of(full: &str) -> Option<String> {
    let after_scheme = full.find("://").map(|p| &full[p + 3..]).unwrap_or(full);
    let path_start = after_scheme.find('/')?;
    let path = &after_scheme[path_start..];
    Some(path.split(['?', '#']).next().unwrap_or(path).to_string())
}
