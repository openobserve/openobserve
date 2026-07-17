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

//! Declarative allowlist of ingestion-facing HTTP routes.
//!
//! Historically the auth layer decided "is this an ingestion request?" by
//! substring-matching the flat [`INGESTION_EP`](super::ingestion::INGESTION_EP)
//! word list against path segments, ignoring HTTP method and segment position.
//! That is what let an org ingestion token read protected data on
//! `GET /{org}/{stream}/traces/latest` (the `traces` segment merely *appeared*
//! in the path) — GHSA-wffq-g8qf-ccmv.
//!
//! This module replaces that guesswork with a single source of truth, in the
//! spirit of the RBAC permission tables: every ingestion-facing route is
//! declared once as a `(path shape, allowed methods, kind)` row, and all auth
//! call sites classify a request by matching it against the table. Adding or
//! changing an ingestion endpoint means editing [`INGESTION_ROUTES`] and nothing
//! else.
//!
//! Paths are matched against the request path with the `/api/` (and base-uri)
//! prefix already stripped, so segment 0 is `{org_id}`. The optional `/v2/`
//! prefix is normalised away by [`classify`] before matching.

use axum::http::Method;

/// One segment of a declared route pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Seg {
    /// A fixed path segment that must match exactly (e.g. `_bulk`, `traces`).
    Lit(&'static str),
    /// A single path parameter — matches any one non-empty segment
    /// (`{org_id}`, `{stream_name}`, `{name}`, ...). It deliberately does NOT
    /// match an ingestion keyword by accident because matching is positional:
    /// a stream literally named `traces` only ever lands in a `Param` slot.
    Param,
}

/// What an ingestion-facing route is, for authorization purposes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestionKind {
    /// A data-ingestion write endpoint (logs/metrics/traces/bulk/otlp/...).
    /// These accept an org ingestion token and, at the permission layer, are
    /// authorized at the stream level.
    Write,
    /// A read-only Elasticsearch-compatibility stub (version ping, `_license`,
    /// `_xpack`, ILM/template/data-stream/ingest-pipeline metadata). These
    /// return only static, canned data — no user data — and exist so ES
    /// ingestion clients (Beats, Logstash, ...) can complete their handshake and
    /// load templates before bulk-ingesting.
    EsHandshakeRead,
}

/// A single declared ingestion route: a path shape, the methods allowed on it,
/// and how it is classified.
struct IngestionRoute {
    /// Segment patterns, starting at `{org_id}` (index 0).
    segments: &'static [Seg],
    /// HTTP methods (as `Method::as_str()` values) this row applies to.
    methods: &'static [&'static str],
    kind: IngestionKind,
}

use Seg::{Lit, Param};

/// The authoritative ingestion-route table. Mirrors the "ES compatibility" and
/// ingestion blocks of `src/api/src/handler/http/router/mod.rs`. Kept in sync by
/// hand — every ingestion/ES-compat route registered there has exactly one row
/// here. Data-read routes (e.g. `.../traces/latest`, `.../_values`) are
/// deliberately absent, which is the whole point: an ingestion token classified
/// against this table can never match them.
static INGESTION_ROUTES: &[IngestionRoute] = &[
    // ---- Native + OTLP + third-party ingestion writes (POST) ----
    // `/{org}/_bulk`
    IngestionRoute {
        segments: &[Param, Lit("_bulk")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/{stream}/_multi`
    IngestionRoute {
        segments: &[Param, Param, Lit("_multi")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/{stream}/_json`
    IngestionRoute {
        segments: &[Param, Param, Lit("_json")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/_hec`
    IngestionRoute {
        segments: &[Param, Lit("_hec")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/loki/api/v1/push`
    IngestionRoute {
        segments: &[Param, Lit("loki"), Lit("api"), Lit("v1"), Lit("push")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/v1/logs` (OTLP)
    IngestionRoute {
        segments: &[Param, Lit("v1"), Lit("logs")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/v1/metrics` (OTLP)
    IngestionRoute {
        segments: &[Param, Lit("v1"), Lit("metrics")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/v1/traces` (OTLP)
    IngestionRoute {
        segments: &[Param, Lit("v1"), Lit("traces")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/traces` (native)
    IngestionRoute {
        segments: &[Param, Lit("traces")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/otel/v1/traces`
    IngestionRoute {
        segments: &[Param, Lit("otel"), Lit("v1"), Lit("traces")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/ingest/metrics/_json`
    IngestionRoute {
        segments: &[Param, Lit("ingest"), Lit("metrics"), Lit("_json")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/prometheus/api/v1/write`
    IngestionRoute {
        segments: &[
            Param,
            Lit("prometheus"),
            Lit("api"),
            Lit("v1"),
            Lit("write"),
        ],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/{stream}/_kinesis_firehose` (AWS)
    IngestionRoute {
        segments: &[Param, Param, Lit("_kinesis_firehose")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/{stream}/_sub` (GCP Pub/Sub push)
    IngestionRoute {
        segments: &[Param, Param, Lit("_sub")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/v1/{org}/logs` (RUM) — note: `v1` is segment 0 here, org is segment 1.
    IngestionRoute {
        segments: &[Lit("v1"), Param, Lit("logs")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // ---- Elasticsearch-compatibility handshake / template stubs ----
    // NOTE: the ES root version ping `GET /{org}/` is matched directly in
    // `classify` (on its mandatory trailing slash) rather than as a table row,
    // so it does not collide with unrelated single-segment routes.
    // `/{org}/_license`
    IngestionRoute {
        segments: &[Param, Lit("_license")],
        methods: &["GET", "HEAD"],
        kind: IngestionKind::EsHandshakeRead,
    },
    // `/{org}/_xpack`
    IngestionRoute {
        segments: &[Param, Lit("_xpack")],
        methods: &["GET", "HEAD"],
        kind: IngestionKind::EsHandshakeRead,
    },
    // `/{org}/_ilm/policy/{name}`
    IngestionRoute {
        segments: &[Param, Lit("_ilm"), Lit("policy"), Param],
        methods: &["GET", "HEAD"],
        kind: IngestionKind::EsHandshakeRead,
    },
    // `/{org}/_index_template/{name}` — GET/HEAD read, POST create (all static stubs).
    IngestionRoute {
        segments: &[Param, Lit("_index_template"), Param],
        methods: &["GET", "HEAD", "POST"],
        kind: IngestionKind::EsHandshakeRead,
    },
    // `/{org}/_data_stream/{name}`
    IngestionRoute {
        segments: &[Param, Lit("_data_stream"), Param],
        methods: &["GET", "HEAD", "POST"],
        kind: IngestionKind::EsHandshakeRead,
    },
    // `/{org}/_ingest/pipeline/{name}`
    IngestionRoute {
        segments: &[Param, Lit("_ingest"), Lit("pipeline"), Param],
        methods: &["GET", "HEAD", "POST"],
        kind: IngestionKind::EsHandshakeRead,
    },
];

/// The `/v2/...` API prefix, stripped before matching so `/v2/{org}/_bulk`
/// classifies identically to `/{org}/_bulk`.
const V2_API_PREFIX: &str = "v2";

/// Does this segment pattern list match these path segments?
fn segments_match(patterns: &[Seg], columns: &[&str]) -> bool {
    if patterns.len() != columns.len() {
        return false;
    }
    patterns.iter().zip(columns).all(|(pat, col)| match pat {
        Seg::Lit(lit) => col == lit,
        // A param matches any single non-empty segment.
        Seg::Param => !col.is_empty(),
    })
}

/// Classify a request against the ingestion-route table.
///
/// `path` is the request path with the `/api/` and base-uri prefix already
/// stripped, so it starts at `{org_id}` (a leading `/` and an optional `/v2/`
/// prefix are tolerated). It is taken as a `&str` — rather than pre-split
/// columns — specifically so the Elasticsearch root-ping route `GET /{org}/`
/// can be told apart from a top-level single-segment collection route such as
/// `GET /organizations`: the former has a trailing slash, the latter does not.
///
/// `method` is the HTTP method. Returns `Some(kind)` only when the request
/// matches a declared ingestion route on both shape and method; `None` for
/// everything else — including data-read routes such as `.../traces/latest`,
/// which are intentionally not in the table.
pub fn classify(method: &Method, path: &str) -> Option<IngestionKind> {
    let path = path.strip_prefix('/').unwrap_or(path);
    // Normalise the optional `/v2/{org}/...` prefix to `/{org}/...`.
    let path = path
        .strip_prefix(V2_API_PREFIX)
        .and_then(|rest| rest.strip_prefix('/'))
        .unwrap_or(path);

    let method = method.as_str();

    // The ES root version ping is the sole ingestion route registered with a
    // mandatory trailing slash (`GET /{org}/`). Match it explicitly on the
    // trailing slash so it does not collide with unrelated single-segment
    // routes (`/organizations`, `/invites`, `/healthz`, ...).
    if let Some(org) = path.strip_suffix('/')
        && !org.is_empty()
        && !org.contains('/')
        && (method == "GET" || method == "HEAD")
    {
        return Some(IngestionKind::EsHandshakeRead);
    }

    // Everything else matches on exact segment shape. A single trailing empty
    // segment (trailing slash) is dropped so `.../_bulk/` == `.../_bulk`.
    let mut columns: Vec<&str> = path.split('/').collect();
    if columns.len() > 1 && columns.last() == Some(&"") {
        columns.pop();
    }

    INGESTION_ROUTES
        .iter()
        .find(|route| route.methods.contains(&method) && segments_match(route.segments, &columns))
        .map(|route| route.kind)
}

/// Is this request a data-ingestion **write**? True only for `IngestionKind::Write`.
pub fn is_ingestion_write(method: &Method, path: &str) -> bool {
    matches!(classify(method, path), Some(IngestionKind::Write))
}

/// May an org ingestion token be used on this request? True for real writes and
/// the read-only ES handshake stubs — nothing else.
pub fn is_ingestion_allowed(method: &Method, path: &str) -> bool {
    classify(method, path).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify_path(method: &Method, path: &str) -> Option<IngestionKind> {
        classify(method, path)
    }

    #[test]
    fn writes_are_classified() {
        for path in [
            "default/_bulk",
            "default/mystream/_multi",
            "default/mystream/_json",
            "default/_hec",
            "default/loki/api/v1/push",
            "default/v1/logs",
            "default/v1/metrics",
            "default/v1/traces",
            "default/traces",
            "default/otel/v1/traces",
            "default/ingest/metrics/_json",
            "default/prometheus/api/v1/write",
            "default/mystream/_kinesis_firehose",
            "default/mystream/_sub",
            "v1/default/logs",
        ] {
            assert_eq!(
                classify_path(&Method::POST, path),
                Some(IngestionKind::Write),
                "expected Write for POST /{path}"
            );
        }
    }

    #[test]
    fn es_handshake_reads_are_classified() {
        for (method, path) in [
            (Method::GET, "default/"),
            (Method::HEAD, "default/"),
            (Method::GET, "default/_license"),
            (Method::GET, "default/_xpack"),
            (Method::GET, "default/_ilm/policy/logs"),
            (Method::HEAD, "default/_index_template/filebeat-7"),
            (Method::GET, "default/_data_stream/filebeat-7"),
            (Method::GET, "default/_ingest/pipeline/filebeat-7"),
        ] {
            assert_eq!(
                classify_path(&method, path),
                Some(IngestionKind::EsHandshakeRead),
                "expected EsHandshakeRead for {method} /{path}"
            );
        }
    }

    #[test]
    fn es_template_creates_are_classified() {
        // POST creates on template/data-stream/pipeline are static stubs, with
        // arbitrary `{name}` (not necessarily an ingestion word).
        for path in [
            "default/_index_template/filebeat-7.17.1",
            "default/_data_stream/filebeat-7.17.1",
            "default/_ingest/pipeline/filebeat-7.17.1",
        ] {
            assert_eq!(
                classify_path(&Method::POST, path),
                Some(IngestionKind::EsHandshakeRead),
                "expected EsHandshakeRead for POST /{path}"
            );
        }
    }

    #[test]
    fn v2_prefix_is_normalised() {
        assert_eq!(
            classify_path(&Method::POST, "v2/default/_bulk"),
            Some(IngestionKind::Write)
        );
        assert_eq!(
            classify_path(&Method::GET, "v2/default/_license"),
            Some(IngestionKind::EsHandshakeRead)
        );
    }

    #[test]
    fn data_reads_are_rejected_the_ghsa_bypass() {
        // The reported bypass and its blast radius: data-bearing reads must not
        // classify as ingestion, for any method.
        for path in [
            "default/mystream/traces/latest",
            "default/mystream/traces/latest_stream",
            "default/mystream/traces/session",
            "default/mystream/traces/user",
            "default/mystream/_values",
            "default/mystream/_around",
        ] {
            for method in [Method::GET, Method::HEAD, Method::POST] {
                assert_eq!(
                    classify_path(&method, path),
                    None,
                    "data read must never classify as ingestion: {method} /{path}"
                );
            }
        }
    }

    #[test]
    fn stream_named_after_es_word_cannot_read_data() {
        // A stream literally named `_ingest`/`_ilm`/etc must not let a data read
        // slip through as an ES handshake (positional matching prevents it).
        for stream in [
            "_ingest",
            "_ilm",
            "_data_stream",
            "_index_template",
            "_license",
            "_xpack",
        ] {
            let path = format!("default/{stream}/traces/latest");
            assert_eq!(
                classify(&Method::GET, &path),
                None,
                "stream named {stream} must not alias an ES handshake read"
            );
        }
    }

    #[test]
    fn wrong_method_is_rejected() {
        // Writes are POST-only; ES stubs are GET/HEAD (+POST only for the create
        // stubs). PUT/DELETE/PATCH never classify.
        for method in [Method::PUT, Method::DELETE, Method::PATCH] {
            assert_eq!(classify_path(&method, "default/_bulk"), None);
            assert_eq!(classify_path(&method, "default/traces"), None);
            assert_eq!(classify_path(&method, "default/_license"), None);
        }
        // A GET to a write endpoint does not classify as a write.
        assert_eq!(classify_path(&Method::GET, "default/_bulk"), None);
        // A POST to `_license`/`_xpack` (read-only stubs) does not classify.
        assert_eq!(classify_path(&Method::POST, "default/_license"), None);
        assert_eq!(classify_path(&Method::POST, "default/_xpack"), None);
    }

    #[test]
    fn non_ingestion_paths_are_rejected() {
        assert_eq!(classify_path(&Method::POST, "default/dashboards"), None);
        assert_eq!(
            classify_path(&Method::POST, "default/enrichment_tables/mytable"),
            None
        );
        assert_eq!(classify_path(&Method::GET, "default/streams"), None);
        assert_eq!(classify_path(&Method::DELETE, "default/users/bulk"), None);
    }

    #[test]
    fn es_root_ping_requires_trailing_slash() {
        // `GET /{org}/` (trailing slash) is the ES version ping — accepted.
        assert_eq!(
            classify_path(&Method::GET, "default/"),
            Some(IngestionKind::EsHandshakeRead)
        );
        assert_eq!(
            classify_path(&Method::HEAD, "default/"),
            Some(IngestionKind::EsHandshakeRead)
        );
        // Also with the leading slash the call sites may pass.
        assert_eq!(
            classify_path(&Method::GET, "/default/"),
            Some(IngestionKind::EsHandshakeRead)
        );

        // Single-segment top-level collection routes have NO trailing slash and
        // must NOT be mistaken for the org ping — otherwise an ingestion-only
        // credential would authenticate on them (the over-match the route audit
        // caught). These are real routes: `/organizations`, `/invites`,
        // `/healthz`, `/clusters`, `/config`.
        for literal in ["organizations", "invites", "healthz", "clusters", "config"] {
            for method in [Method::GET, Method::HEAD] {
                assert_eq!(
                    classify(&method, literal),
                    None,
                    "single-segment route /{literal} must not classify as the ES ping"
                );
            }
        }
        // A non-GET/HEAD to `/{org}/` is not the ping either.
        assert_eq!(classify_path(&Method::POST, "default/"), None);
    }
}
