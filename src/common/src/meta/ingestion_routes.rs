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
//! Rows match axum's `MatchedPath` below the mount prefix, so segment 0 is `{org_id}`.

use axum::http::Method;

/// One segment of a declared route pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Seg {
    /// A fixed path segment that must match exactly (e.g. `_bulk`, `traces`).
    Lit(&'static str),
    /// A single route parameter (`{org_id}`, `{stream_name}`, ...); never a literal segment.
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
/// ingestion blocks of `src/api/http/src/handler/http/router/mod.rs`. Kept in sync by
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
    // `/{org}/v1/profiles` (OTLP)
    IngestionRoute {
        segments: &[Param, Lit("v1"), Lit("profiles")],
        methods: &["POST"],
        kind: IngestionKind::Write,
    },
    // `/{org}/v1development/profiles` (OTLP Profiles development path used by otlp_http)
    IngestionRoute {
        segments: &[Param, Lit("v1development"), Lit("profiles")],
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
    // `/{org}/v1/opamp` (OpAMP); GET is the WS upgrade and must stay a Write (header-only auth).
    IngestionRoute {
        segments: &[Param, Lit("v1"), Lit("opamp")],
        methods: &["GET", "POST"],
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

/// Does this segment pattern list match these route-template segments and their path values?
fn segments_match(patterns: &[Seg], columns: &[&str], values: &[&str]) -> bool {
    if patterns.len() != columns.len() || columns.len() != values.len() {
        return false;
    }
    patterns
        .iter()
        .zip(columns)
        .zip(values)
        .all(|((pat, col), value)| match pat {
            Seg::Lit(lit) => col == lit,
            // matchit lets a param match an empty segment; ingestion needs a value.
            Seg::Param => is_route_param(col) && !value.is_empty(),
        })
}

/// Is this template segment a single-segment axum parameter (`{name}`, not `{*rest}`)?
fn is_route_param(segment: &str) -> bool {
    segment
        .strip_prefix('{')
        .and_then(|s| s.strip_suffix('}'))
        .is_some_and(|name| !name.is_empty() && !name.starts_with('*'))
}

/// The part of the full `MatchedPath` below the mount prefixes `path` (no leading `/`) has lost.
fn route_below_mount<'a>(route: &'a str, path: &str) -> Option<&'a str> {
    let route = route.strip_prefix('/').unwrap_or(route);
    let skip = route
        .split('/')
        .count()
        .checked_sub(path.split('/').count())?;
    let start = match skip {
        0 => 0,
        n => route.match_indices('/').nth(n - 1)?.0 + 1,
    };
    let (mount, below) = route.split_at(start);
    // A mount prefix is literal; a param in it means the segments are misaligned.
    (!mount.contains('{')).then_some(below)
}

/// Classify by the full `MatchedPath`; `path` only aligns its mount. Absent or misaligned: None.
pub fn classify(method: &Method, path: &str, route: Option<&str>) -> Option<IngestionKind> {
    let path = path.strip_prefix('/').unwrap_or(path);
    let route = route_below_mount(route?, path)?;
    let method = method.as_str();
    let columns: Vec<&str> = route.split('/').collect();
    let values: Vec<&str> = path.split('/').collect();

    // The ES root ping is the only ingestion route with a mandatory trailing slash (`/{org_id}/`).
    if let Some(org) = route.strip_suffix('/')
        && is_route_param(org)
        && values.first().is_some_and(|org| !org.is_empty())
        && (method == "GET" || method == "HEAD")
    {
        return Some(IngestionKind::EsHandshakeRead);
    }

    INGESTION_ROUTES
        .iter()
        .find(|route| {
            route.methods.contains(&method) && segments_match(route.segments, &columns, &values)
        })
        .map(|route| route.kind)
}

/// Is this request a data-ingestion **write**? True only for `IngestionKind::Write`.
pub fn is_ingestion_write(method: &Method, path: &str, route: Option<&str>) -> bool {
    matches!(classify(method, path, route), Some(IngestionKind::Write))
}

/// May an org ingestion token be used on this request? True for real writes and
/// the read-only ES handshake stubs — nothing else.
pub fn is_ingestion_allowed(method: &Method, path: &str, route: Option<&str>) -> bool {
    classify(method, path, route).is_some()
}

/// Is this exactly `{org}/v1/opamp`, the OpAMP route whose auth differs from other writes?
pub fn is_opamp(path: &str) -> bool {
    let path = path.strip_prefix('/').unwrap_or(path);
    let mut columns: Vec<&str> = path.split('/').collect();
    if columns.len() > 1 && columns.last() == Some(&"") {
        columns.pop();
    }
    matches!(columns.as_slice(), [org, "v1", "opamp"] if !org.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Classify a route registered under `/api`, requested with every param filled in.
    fn classify_route(method: &Method, template: &str) -> Option<IngestionKind> {
        let path = template
            .split('/')
            .map(|s| if is_route_param(s) { "default" } else { s })
            .collect::<Vec<_>>()
            .join("/");
        classify(method, &path, Some(&format!("/api/{template}")))
    }

    #[test]
    fn writes_are_classified() {
        for route in [
            "{org_id}/_bulk",
            "{org_id}/{stream_name}/_multi",
            "{org_id}/{stream_name}/_json",
            "{org_id}/_hec",
            "{org_id}/loki/api/v1/push",
            "{org_id}/v1/logs",
            "{org_id}/v1/metrics",
            "{org_id}/v1/traces",
            "{org_id}/v1/profiles",
            "{org_id}/v1development/profiles",
            "{org_id}/traces",
            "{org_id}/otel/v1/traces",
            "{org_id}/ingest/metrics/_json",
            "{org_id}/prometheus/api/v1/write",
            "{org_id}/{stream_name}/_kinesis_firehose",
            "{org_id}/{stream_name}/_sub",
            "v1/{org_id}/logs",
        ] {
            assert_eq!(
                classify_route(&Method::POST, route),
                Some(IngestionKind::Write),
                "expected Write for POST /{route}"
            );
        }
    }

    #[test]
    fn es_handshake_reads_are_classified() {
        for (method, route) in [
            (Method::GET, "{org_id}/"),
            (Method::HEAD, "{org_id}/"),
            (Method::GET, "{org_id}/_license"),
            (Method::GET, "{org_id}/_xpack"),
            (Method::GET, "{org_id}/_ilm/policy/{name}"),
            (Method::HEAD, "{org_id}/_index_template/{name}"),
            (Method::GET, "{org_id}/_data_stream/{name}"),
            (Method::GET, "{org_id}/_ingest/pipeline/{name}"),
        ] {
            assert_eq!(
                classify_route(&method, route),
                Some(IngestionKind::EsHandshakeRead),
                "expected EsHandshakeRead for {method} /{route}"
            );
        }
    }

    #[test]
    fn es_template_creates_are_classified() {
        for route in [
            "{org_id}/_index_template/{name}",
            "{org_id}/_data_stream/{name}",
            "{org_id}/_ingest/pipeline/{name}",
        ] {
            assert_eq!(
                classify_route(&Method::POST, route),
                Some(IngestionKind::EsHandshakeRead),
                "expected EsHandshakeRead for POST /{route}"
            );
        }
    }

    #[test]
    fn a_management_route_named_after_an_ingestion_literal_is_not_ingestion() {
        // The path matches a write row; the matched route does not.
        for (route, path) in [
            ("/api/{org_id}/kv/{key}", "default/kv/_json"),
            ("/api/{org_id}/kv/{key}", "default/kv/_multi"),
            (
                "/api/{org_id}/streams/{stream_name}",
                "default/streams/_sub",
            ),
            (
                "/api/{org_id}/enrichment_tables/{table_name}",
                "default/enrichment_tables/_sub",
            ),
            (
                "/api/{org_id}/streams/{stream_name}",
                "default/streams/_kinesis_firehose",
            ),
            ("/api/{org_id}/{module}", "default/_bulk"),
            ("/api/v1/{org_id}/{module}", "v1/default/logs"),
        ] {
            assert_eq!(
                classify(&Method::POST, path, Some(route)),
                None,
                "POST {route} as /{path}"
            );
        }
    }

    #[test]
    fn without_a_matched_route_nothing_is_ingestion() {
        assert_eq!(classify(&Method::POST, "default/_bulk", None), None);
        assert_eq!(classify(&Method::GET, "default/", None), None);
    }

    #[test]
    fn the_mount_prefix_is_lined_up_away() {
        for route in [
            "/{org_id}/_bulk",
            "/api/{org_id}/_bulk",
            "/o2/base/api/{org_id}/_bulk",
            "/aws/{org_id}/_bulk",
        ] {
            assert_eq!(
                classify(&Method::POST, "default/_bulk", Some(route)),
                Some(IngestionKind::Write),
                "{route}"
            );
        }
        assert_eq!(
            classify(&Method::POST, "default/_bulk", Some("/{org_id}/{x}/_bulk")),
            None,
            "a mount prefix holding a param is misaligned"
        );
        assert_eq!(
            classify(&Method::POST, "a/default/_bulk", Some("/{org_id}/_bulk")),
            None,
            "a path deeper than the route is misaligned"
        );
    }

    #[test]
    fn an_empty_param_value_is_not_ingestion() {
        let json = Some("/api/{org_id}/{stream_name}/_json");
        assert_eq!(classify(&Method::POST, "default//_json", json), None);
        assert_eq!(classify(&Method::POST, "//s/_json", json), None);
        assert_eq!(
            classify(&Method::GET, "//", Some("/api/{org_id}/")),
            None,
            "the ES ping needs an org"
        );
    }

    #[test]
    fn a_wildcard_is_not_a_param() {
        assert_eq!(
            classify(&Method::POST, "default/_bulk", Some("/api/{*rest}/_bulk")),
            None
        );
    }

    #[test]
    fn v2_module_routes_are_not_ingestion() {
        for leaf in ["_json", "_multi", "_sub", "_kinesis_firehose"] {
            let path = format!("v2/default/folders/{leaf}");
            assert_eq!(
                classify(
                    &Method::POST,
                    &path,
                    Some("/api/v2/{org_id}/folders/{folder_type}")
                ),
                None,
                "POST /{path}"
            );
        }
    }

    #[test]
    fn an_org_named_v2_ingests_like_any_other_org() {
        assert_eq!(
            classify(
                &Method::POST,
                "v2/mystream/_json",
                Some("/api/{org_id}/{stream_name}/_json")
            ),
            Some(IngestionKind::Write)
        );
    }

    #[test]
    fn data_reads_are_rejected_the_ghsa_bypass() {
        // Data-bearing reads must not classify as ingestion, for any method.
        for route in [
            "{org_id}/{stream_name}/traces/latest",
            "{org_id}/{stream_name}/traces/latest_stream",
            "{org_id}/{stream_name}/traces/session",
            "{org_id}/{stream_name}/traces/user",
            "{org_id}/{stream_name}/_values",
            "{org_id}/{stream_name}/_around",
        ] {
            for method in [Method::GET, Method::HEAD, Method::POST] {
                assert_eq!(
                    classify_route(&method, route),
                    None,
                    "data read must never classify as ingestion: {method} /{route}"
                );
            }
        }
    }

    #[test]
    fn stream_named_after_es_word_cannot_read_data() {
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
                classify(
                    &Method::GET,
                    &path,
                    Some("/api/{org_id}/{stream_name}/traces/latest")
                ),
                None,
                "stream named {stream} must not alias an ES handshake read"
            );
        }
    }

    #[test]
    fn wrong_method_is_rejected() {
        for method in [Method::PUT, Method::DELETE, Method::PATCH] {
            assert_eq!(classify_route(&method, "{org_id}/_bulk"), None);
            assert_eq!(classify_route(&method, "{org_id}/traces"), None);
            assert_eq!(classify_route(&method, "{org_id}/_license"), None);
        }
        assert_eq!(classify_route(&Method::GET, "{org_id}/_bulk"), None);
        assert_eq!(classify_route(&Method::POST, "{org_id}/_license"), None);
        assert_eq!(classify_route(&Method::POST, "{org_id}/_xpack"), None);
    }

    #[test]
    fn non_ingestion_routes_are_rejected() {
        assert_eq!(classify_route(&Method::POST, "{org_id}/dashboards"), None);
        assert_eq!(
            classify_route(&Method::POST, "{org_id}/enrichment_tables/{table_name}"),
            None
        );
        assert_eq!(classify_route(&Method::GET, "{org_id}/streams"), None);
        assert_eq!(classify_route(&Method::DELETE, "{org_id}/users/bulk"), None);
    }

    #[test]
    fn es_root_ping_requires_trailing_slash() {
        assert_eq!(
            classify(&Method::GET, "/default/", Some("/api/{org_id}/")),
            Some(IngestionKind::EsHandshakeRead)
        );
        // Top-level collection routes have no trailing slash and no param.
        for literal in ["organizations", "invites", "healthz", "clusters", "config"] {
            for method in [Method::GET, Method::HEAD] {
                assert_eq!(
                    classify(&method, literal, Some(&format!("/api/{literal}"))),
                    None,
                    "single-segment route /{literal} must not classify as the ES ping"
                );
                assert_eq!(
                    classify(
                        &method,
                        &format!("{literal}/"),
                        Some(&format!("/api/{literal}/"))
                    ),
                    None,
                    "a literal route /{literal}/ is not the ES ping"
                );
            }
        }
        assert_eq!(classify_route(&Method::GET, "{org_id}"), None);
        assert_eq!(classify_route(&Method::POST, "{org_id}/"), None);
    }

    #[test]
    fn opamp_get_and_post_are_ingestion_writes() {
        for method in [Method::GET, Method::POST] {
            assert_eq!(
                classify_route(&method, "{org_id}/v1/opamp"),
                Some(IngestionKind::Write),
                "{method} /{{org_id}}/v1/opamp must be a header-only ingestion write"
            );
        }
        assert_eq!(classify_route(&Method::PUT, "{org_id}/v1/opamp"), None);
    }

    #[test]
    fn is_opamp_matches_only_the_org_opamp_path() {
        assert!(is_opamp("default/v1/opamp"));
        assert!(is_opamp("default/v1/opamp/"));
        for path in ["default/v1/opamp/x", "default/v1/logs", "v1/opamp", ""] {
            assert!(!is_opamp(path), "{path}");
        }
    }
}
