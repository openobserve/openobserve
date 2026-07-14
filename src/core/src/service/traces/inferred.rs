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

//! Inferred service derivation
//!
//! Derives the identity of *uninstrumented* dependencies (databases, message
//! queues, external APIs, RPC backends) from the peer attributes of
//! CLIENT/PRODUCER spans at ingestion time, following OpenTelemetry semantic
//! conventions (both current and legacy attribute names).
//!
//! Three derived fields are written to each qualifying span:
//! - `infer_service_name`   — entity identity, e.g. `orders-db`, `api.stripe.com`
//! - `infer_service_type`   — coarse category: `database` / `queue` / `rpc` / `external`
//! - `infer_service_system` — concrete system, e.g. `postgresql`, `kafka`, `grpc`, `http`
//!
//! The query side renders these as dotted "inferred service" nodes via
//! `COALESCE(infer_service_name, service_name)`, gated on schema presence so
//! streams without the fields keep working unchanged.

use std::net::IpAddr;

/// Derived field names. Already in flattened (underscore) form so they pass
/// through `flatten::flatten` unchanged. Listed in `BLOCK_FIELDS` so user
/// attributes with the same names get an `attr_` prefix instead of colliding.
pub const INFER_SERVICE_NAME: &str = "infer_service_name";
pub const INFER_SERVICE_TYPE: &str = "infer_service_type";
pub const INFER_SERVICE_SYSTEM: &str = "infer_service_system";

/// `infer_service_type` values.
pub const INFER_TYPE_DATABASE: &str = "database";
pub const INFER_TYPE_QUEUE: &str = "queue";
pub const INFER_TYPE_RPC: &str = "rpc";
pub const INFER_TYPE_EXTERNAL: &str = "external";

// OTLP proto span kind values as stored in the `span_kind` field.
const SPAN_KIND_CLIENT: i32 = 3;
const SPAN_KIND_PRODUCER: i32 = 4;

/// An uninstrumented dependency inferred from a span's peer attributes.
#[derive(Debug, Clone, PartialEq)]
pub struct InferredService {
    pub name: String,
    pub service_type: &'static str,
    pub system: Option<String>,
}

/// Parse a stored `span_kind` value ("3" or "SPAN_KIND_CLIENT") to the OTLP
/// proto numeric value. Returns 0 (unspecified) for unknown input.
pub fn span_kind_to_i32(value: &str) -> i32 {
    match value {
        "1" | "SPAN_KIND_INTERNAL" => 1,
        "2" | "SPAN_KIND_SERVER" => 2,
        "3" | "SPAN_KIND_CLIENT" => 3,
        "4" | "SPAN_KIND_PRODUCER" => 4,
        "5" | "SPAN_KIND_CONSUMER" => 5,
        _ => 0,
    }
}

/// Derive the inferred service identity for a span, if any.
///
/// Only CLIENT and PRODUCER spans are considered: their duration is time spent
/// *waiting on* the dependency, so attributing it to the inferred entity is
/// correct. (CONSUMER spans are deliberately excluded — their duration is
/// processing time inside the instrumented service, not time in the queue.)
///
/// `get_attr` looks up a span attribute by exact key and returns its string
/// value. The function itself tries both the semconv (dotted) and flattened
/// (underscore) key forms, so it works for raw OTLP attributes as well as
/// already-flattened records.
///
/// Naming precedence per entity type (explicit `peer.service` always wins —
/// it is the user's declared intent and is taken verbatim):
/// - database:  `peer.service` > `db.namespace`/`db.name` > host > `db.system`
/// - queue: `peer.service` > `messaging.destination.name`/`messaging.destination` > host >
///   `messaging.system`
/// - rpc:       `peer.service` > `rpc.service` > host > `rpc.system`
/// - external:  `peer.service` > host
///
/// where "host" is `server.address` > `net.peer.name` > `http.host` > host of
/// `url.full`/`http.url`, with ports stripped and bare IP addresses redacted
/// (falling through to the next candidate) to avoid one graph node per
/// pod/instance IP.
pub fn derive_inferred_service<F>(span_kind: i32, get_attr: F) -> Option<InferredService>
where
    F: Fn(&str) -> Option<String>,
{
    if span_kind != SPAN_KIND_CLIENT && span_kind != SPAN_KIND_PRODUCER {
        return None;
    }

    // Look up by semconv (dotted) name, falling back to the flattened
    // (underscore) form; blank values are treated as absent.
    let attr = |key: &str| -> Option<String> {
        get_attr(key)
            .or_else(|| get_attr(&key.replace('.', "_")))
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };

    // Host-like attributes may carry ports and IPs; strip the port and drop
    // bare IPs so they never become entity names.
    let host_attr = |key: &str| -> Option<String> {
        attr(key)
            .map(|v| strip_port(&v).to_string())
            .filter(|host| !host.is_empty() && !is_ip_address(host))
    };

    let fallback_host = host_attr("server.address")
        .or_else(|| host_attr("net.peer.name"))
        .or_else(|| host_attr("http.host"))
        .or_else(|| {
            attr("url.full")
                .or_else(|| attr("http.url"))
                .and_then(|u| url::Url::parse(&u).ok())
                .and_then(|u| match u.host() {
                    Some(url::Host::Domain(d)) => Some(d.to_string()),
                    _ => None, // IP hosts are redacted, same as host_attr
                })
        });

    // Explicit peer.service overrides every naming rule.
    let peer_service = attr("peer.service");

    // database
    let db_system = attr("db.system.name").or_else(|| attr("db.system"));
    let db_name = attr("db.namespace").or_else(|| attr("db.name"));
    if db_system.is_some() || db_name.is_some() {
        let name = peer_service
            .or(db_name)
            .or(fallback_host)
            .or_else(|| db_system.clone())?;
        return Some(InferredService {
            name,
            service_type: INFER_TYPE_DATABASE,
            system: db_system,
        });
    }

    // queue
    let messaging_system = attr("messaging.system");
    let destination = attr("messaging.destination.name").or_else(|| attr("messaging.destination"));
    if messaging_system.is_some() || destination.is_some() {
        let name = peer_service
            .or(destination)
            .or(fallback_host)
            .or_else(|| messaging_system.clone())?;
        return Some(InferredService {
            name,
            service_type: INFER_TYPE_QUEUE,
            system: messaging_system,
        });
    }

    // rpc
    let rpc_system = attr("rpc.system");
    let rpc_service = attr("rpc.service");
    if rpc_system.is_some() || rpc_service.is_some() {
        let name = peer_service
            .or(rpc_service)
            .or(fallback_host)
            .or_else(|| rpc_system.clone())?;
        return Some(InferredService {
            name,
            service_type: INFER_TYPE_RPC,
            system: rpc_system,
        });
    }

    // external (http or generic network peer)
    let name = peer_service.or(fallback_host)?;
    let is_http = attr("http.request.method")
        .or_else(|| attr("http.method"))
        .or_else(|| attr("url.full"))
        .or_else(|| attr("http.url"))
        .is_some();
    Some(InferredService {
        name,
        service_type: INFER_TYPE_EXTERNAL,
        system: is_http.then(|| "http".to_string()),
    })
}

/// Strip a trailing `:port` from a host value. Handles bracketed IPv6
/// (`[::1]:6379` → `::1`) and leaves bare IPv6 addresses untouched.
fn strip_port(host: &str) -> &str {
    if let Some(rest) = host.strip_prefix('[')
        && let Some(end) = rest.find(']')
    {
        return &rest[..end];
    }
    if let Some(idx) = host.rfind(':')
        && !host[..idx].contains(':')
        && !host[idx + 1..].is_empty()
        && host[idx + 1..].bytes().all(|b| b.is_ascii_digit())
    {
        return &host[..idx];
    }
    host
}

fn is_ip_address(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::utils::json;

    use super::*;

    fn derive(span_kind: i32, attrs: &[(&str, &str)]) -> Option<InferredService> {
        let map: HashMap<String, json::Value> = attrs
            .iter()
            .map(|(k, v)| (k.to_string(), json::json!(v)))
            .collect();
        derive_inferred_service(span_kind, |key| {
            map.get(key).and_then(|v| v.as_str()).map(String::from)
        })
    }

    #[test]
    fn test_database_with_db_name() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[
                ("db.system", "postgresql"),
                ("db.name", "orders"),
                ("net.peer.name", "pg-primary.prod.svc"),
            ],
        )
        .unwrap();
        assert_eq!(result.name, "orders");
        assert_eq!(result.service_type, INFER_TYPE_DATABASE);
        assert_eq!(result.system.as_deref(), Some("postgresql"));
    }

    #[test]
    fn test_database_new_semconv() {
        // db.system.name / db.namespace are the stabilized names
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("db.system.name", "mysql"), ("db.namespace", "billing")],
        )
        .unwrap();
        assert_eq!(result.name, "billing");
        assert_eq!(result.system.as_deref(), Some("mysql"));
    }

    #[test]
    fn test_redis_falls_back_to_host_with_port_stripped() {
        // redis usually has no db.name; name falls back to the peer host
        let result = derive(
            SPAN_KIND_CLIENT,
            &[
                ("db.system", "redis"),
                ("net.peer.name", "redis-master.prod:6379"),
            ],
        )
        .unwrap();
        assert_eq!(result.name, "redis-master.prod");
        assert_eq!(result.service_type, INFER_TYPE_DATABASE);
        assert_eq!(result.system.as_deref(), Some("redis"));
    }

    #[test]
    fn test_redis_with_only_db_system() {
        let result = derive(SPAN_KIND_CLIENT, &[("db.system", "redis")]).unwrap();
        assert_eq!(result.name, "redis");
        assert_eq!(result.service_type, INFER_TYPE_DATABASE);
    }

    #[test]
    fn test_database_ip_host_redacted() {
        // host is an IP → fall through to db.system as the name
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("db.system", "mysql"), ("net.peer.name", "10.0.0.5:3306")],
        )
        .unwrap();
        assert_eq!(result.name, "mysql");
    }

    #[test]
    fn test_messaging_producer() {
        let result = derive(
            SPAN_KIND_PRODUCER,
            &[
                ("messaging.system", "kafka"),
                ("messaging.destination.name", "checkout-events"),
            ],
        )
        .unwrap();
        assert_eq!(result.name, "checkout-events");
        assert_eq!(result.service_type, INFER_TYPE_QUEUE);
        assert_eq!(result.system.as_deref(), Some("kafka"));
    }

    #[test]
    fn test_messaging_legacy_destination() {
        let result = derive(
            SPAN_KIND_PRODUCER,
            &[
                ("messaging.system", "rabbitmq"),
                ("messaging.destination", "task-queue"),
            ],
        )
        .unwrap();
        assert_eq!(result.name, "task-queue");
        assert_eq!(result.system.as_deref(), Some("rabbitmq"));
    }

    #[test]
    fn test_rpc() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("rpc.system", "grpc"), ("rpc.service", "com.foo.Bar")],
        )
        .unwrap();
        assert_eq!(result.name, "com.foo.Bar");
        assert_eq!(result.service_type, INFER_TYPE_RPC);
        assert_eq!(result.system.as_deref(), Some("grpc"));
    }

    #[test]
    fn test_aws_api_via_rpc() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("rpc.system", "aws-api"), ("rpc.service", "S3")],
        )
        .unwrap();
        assert_eq!(result.name, "S3");
        assert_eq!(result.system.as_deref(), Some("aws-api"));
    }

    #[test]
    fn test_external_http() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[
                ("server.address", "api.stripe.com"),
                ("http.request.method", "POST"),
            ],
        )
        .unwrap();
        assert_eq!(result.name, "api.stripe.com");
        assert_eq!(result.service_type, INFER_TYPE_EXTERNAL);
        assert_eq!(result.system.as_deref(), Some("http"));
    }

    #[test]
    fn test_external_host_from_url() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("http.url", "https://api.github.com/repos?page=2")],
        )
        .unwrap();
        assert_eq!(result.name, "api.github.com");
        assert_eq!(result.system.as_deref(), Some("http"));
    }

    #[test]
    fn test_external_non_http_peer() {
        let result = derive(SPAN_KIND_CLIENT, &[("net.peer.name", "thrift.internal")]).unwrap();
        assert_eq!(result.name, "thrift.internal");
        assert_eq!(result.service_type, INFER_TYPE_EXTERNAL);
        assert_eq!(result.system, None);
    }

    #[test]
    fn test_peer_service_overrides_all() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[
                ("peer.service", "payments-db"),
                ("db.system", "postgresql"),
                ("db.name", "orders"),
            ],
        )
        .unwrap();
        assert_eq!(result.name, "payments-db");
        assert_eq!(result.service_type, INFER_TYPE_DATABASE);
        assert_eq!(result.system.as_deref(), Some("postgresql"));
    }

    #[test]
    fn test_flattened_underscore_keys() {
        // already-flattened records (ingest_json path) use underscore keys
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("db_system", "postgresql"), ("db_name", "orders")],
        )
        .unwrap();
        assert_eq!(result.name, "orders");
        assert_eq!(result.system.as_deref(), Some("postgresql"));
    }

    #[test]
    fn test_external_ip_only_skipped() {
        assert_eq!(
            derive(SPAN_KIND_CLIENT, &[("net.peer.name", "10.0.0.5")]),
            None
        );
        assert_eq!(
            derive(SPAN_KIND_CLIENT, &[("net.peer.name", "2001:db8::1")]),
            None
        );
        assert_eq!(
            derive(SPAN_KIND_CLIENT, &[("http.host", "[2001:db8::1]:8080")]),
            None
        );
    }

    #[test]
    fn test_non_client_span_kinds_skipped() {
        let attrs = [("db.system", "postgresql"), ("db.name", "orders")];
        for kind in [0, 1, 2, 5] {
            assert_eq!(derive(kind, &attrs), None, "span_kind {kind}");
        }
    }

    #[test]
    fn test_plain_internal_call_no_peer_attrs() {
        assert_eq!(derive(SPAN_KIND_CLIENT, &[("http.method", "GET")]), None);
        assert_eq!(derive(SPAN_KIND_CLIENT, &[]), None);
    }

    #[test]
    fn test_empty_values_treated_as_absent() {
        let result = derive(
            SPAN_KIND_CLIENT,
            &[("db.system", "postgresql"), ("db.name", "  ")],
        )
        .unwrap();
        assert_eq!(result.name, "postgresql");
    }

    #[test]
    fn test_strip_port() {
        assert_eq!(strip_port("example.com:8080"), "example.com");
        assert_eq!(strip_port("example.com"), "example.com");
        assert_eq!(strip_port("[::1]:6379"), "::1");
        assert_eq!(strip_port("::1"), "::1"); // bare ipv6 untouched
        assert_eq!(strip_port("10.0.0.5:3306"), "10.0.0.5");
        assert_eq!(strip_port("example.com:"), "example.com:"); // no digits
    }

    #[test]
    fn test_span_kind_to_i32() {
        assert_eq!(span_kind_to_i32("3"), 3);
        assert_eq!(span_kind_to_i32("SPAN_KIND_CLIENT"), 3);
        assert_eq!(span_kind_to_i32("4"), 4);
        assert_eq!(span_kind_to_i32("unknown"), 0);
    }
}
