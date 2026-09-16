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

/// Service-graph join keys; unlike `infer_service_*` they keep IP literals, to join on.
pub const INFER_PEER_KEY: &str = "infer_peer_key";
pub const INFER_PEER_PORT: &str = "infer_peer_port";
pub const INFER_PEER_IP: &str = "infer_peer_ip";
pub const INFER_SELF_KEY: &str = "infer_self_key";
pub const INFER_SELF_PORT: &str = "infer_self_port";
pub const INFER_SELF_IP: &str = "infer_self_ip";

/// Every column this module derives, for the ingest paths that handle them as one set.
pub const ALL_INFER_FIELDS: [&str; 9] = [
    INFER_SERVICE_NAME,
    INFER_SERVICE_TYPE,
    INFER_SERVICE_SYSTEM,
    INFER_PEER_KEY,
    INFER_PEER_PORT,
    INFER_PEER_IP,
    INFER_SELF_KEY,
    INFER_SELF_PORT,
    INFER_SELF_IP,
];

/// `infer_service_type` values.
pub const INFER_TYPE_DATABASE: &str = "database";
pub const INFER_TYPE_QUEUE: &str = "queue";
pub const INFER_TYPE_RPC: &str = "rpc";
pub const INFER_TYPE_EXTERNAL: &str = "external";

// OTLP proto span kind values as stored in the `span_kind` field.
const SPAN_KIND_SERVER: i32 = 2;
const SPAN_KIND_CLIENT: i32 = 3;
const SPAN_KIND_PRODUCER: i32 = 4;
const SPAN_KIND_CONSUMER: i32 = 5;

const PEER_HOST_KEYS: [&str; 3] = ["server.address", "net.peer.name", "http.host"];
const PEER_ADDR_KEYS: [&str; 4] = [
    "peer.address",
    "net.peer.ip",
    "network.peer.address",
    "net.sock.peer.addr",
];
const PEER_PORT_KEYS: [&str; 2] = ["server.port", "net.peer.port"];
const PEER_IP_KEYS: [&str; 5] = [
    "net.peer.ip",
    "network.peer.address",
    "net.sock.peer.addr",
    "peer.address",
    "server.address",
];
const SELF_HOST_KEYS: [&str; 3] = ["server.address", "net.host.name", "http.host"];
const SELF_PORT_KEYS: [&str; 2] = ["server.port", "net.host.port"];
const SELF_IP_KEYS: [&str; 4] = [
    "k8s.pod.ip",
    "net.host.ip",
    "net.sock.host.addr",
    "network.local.address",
];

/// An uninstrumented dependency inferred from a span's peer attributes.
#[derive(Debug, Clone, PartialEq)]
pub struct InferredService {
    pub name: String,
    pub service_type: &'static str,
    pub system: Option<String>,
}

/// Callee-side join keys of a CLIENT/PRODUCER span; `ip` is a second key, not a fallback of `key`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct PeerKeys {
    pub key: Option<String>,
    pub port: Option<i64>,
    pub ip: Option<String>,
}

/// Own-identity join keys of a SERVER/CONSUMER span: how other services address it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SelfKeys {
    pub key: Option<String>,
    pub port: Option<i64>,
    pub ip: Option<String>,
}

struct HostKey {
    key: String,
    port: Option<i64>,
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

/// Peer join keys of a CLIENT/PRODUCER span: host chain, url host, then `PEER_ADDR_KEYS`.
pub fn derive_peer_keys<F>(span_kind: i32, get_attr: F) -> Option<PeerKeys>
where
    F: Fn(&str) -> Option<String>,
{
    if span_kind != SPAN_KIND_CLIENT && span_kind != SPAN_KIND_PRODUCER {
        return None;
    }

    let host = first_host_key(&get_attr, &PEER_HOST_KEYS)
        .or_else(|| url_host_key(&get_attr))
        .or_else(|| first_host_key(&get_attr, &PEER_ADDR_KEYS));
    let port = resolve_port(&get_attr, &PEER_PORT_KEYS, host.as_ref());
    let key = host.map(|host| host.key);
    // the rollup tries the host key before the ip key, so storing the same value twice buys nothing
    let ip = first_ip_key(&get_attr, &PEER_IP_KEYS).filter(|ip| Some(ip) != key.as_ref());

    (key.is_some() || port.is_some() || ip.is_some()).then_some(PeerKeys { key, port, ip })
}

/// Self join keys of a SERVER/CONSUMER span; `get_attr` must also resolve resource attributes.
pub fn derive_self_keys<F>(span_kind: i32, get_attr: F) -> Option<SelfKeys>
where
    F: Fn(&str) -> Option<String>,
{
    if span_kind != SPAN_KIND_SERVER && span_kind != SPAN_KIND_CONSUMER {
        return None;
    }

    let host = first_host_key(&get_attr, &SELF_HOST_KEYS);
    let port = resolve_port(&get_attr, &SELF_PORT_KEYS, host.as_ref());
    let key = host.map(|host| host.key);
    let ip = first_ip_key(&get_attr, &SELF_IP_KEYS);

    (key.is_some() || port.is_some() || ip.is_some()).then_some(SelfKeys { key, port, ip })
}

fn lookup<F>(get_attr: &F, key: &str) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    get_attr(key)
        .or_else(|| get_attr(&key.replace('.', "_")))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn first_host_key<F>(get_attr: &F, keys: &[&str]) -> Option<HostKey>
where
    F: Fn(&str) -> Option<String>,
{
    keys.iter()
        .find_map(|key| lookup(get_attr, key).and_then(|value| normalize_host(&value)))
}

// IP hosts are kept here, unlike in the display-name chain
fn url_host_key<F>(get_attr: &F) -> Option<HostKey>
where
    F: Fn(&str) -> Option<String>,
{
    let raw = lookup(get_attr, "url.full").or_else(|| lookup(get_attr, "http.url"))?;
    let parsed = url::Url::parse(&raw).ok()?;
    let host = match parsed.host()? {
        url::Host::Domain(domain) => domain.to_string(),
        url::Host::Ipv4(addr) => addr.to_string(),
        url::Host::Ipv6(addr) => addr.to_string(),
    };
    let mut host_key = normalize_host(&host)?;
    // `Url::port` hides a port equal to the scheme default, so take it from the raw authority
    host_key.port = url_authority(&raw)
        .and_then(normalize_host)
        .and_then(|authority| authority.port);
    Some(host_key)
}

fn url_authority(raw: &str) -> Option<&str> {
    let rest = raw.split_once("://")?.1;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    Some(
        authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host),
    )
}

fn first_ip_key<F>(get_attr: &F, keys: &[&str]) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    keys.iter().find_map(|key| {
        lookup(get_attr, key)
            .and_then(|value| normalize_host(&value))
            .map(|host| host.key)
            .filter(|host| is_ip_address(host))
    })
}

// a present explicit attribute wins even when invalid, so a bad port omits the column
fn resolve_port<F>(get_attr: &F, keys: &[&str], host: Option<&HostKey>) -> Option<i64>
where
    F: Fn(&str) -> Option<String>,
{
    match keys.iter().find_map(|key| lookup(get_attr, key)) {
        Some(explicit) => parse_port(&explicit),
        None => host.and_then(|host| host.port),
    }
}

fn normalize_host(value: &str) -> Option<HostKey> {
    let lowered = value.trim().to_ascii_lowercase();
    let host = strip_port(&lowered);
    let port = (host.len() < lowered.len())
        .then(|| lowered.rsplit(':').next().and_then(parse_port))
        .flatten();
    // the FQDN root dot goes after the port, so `host.:8080` and `host` end up on the same key
    let key = host.trim_end_matches('.').to_string();
    (!key.is_empty()).then_some(HostKey { key, port })
}

fn parse_port(value: &str) -> Option<i64> {
    value
        .trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .map(i64::from)
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

    fn peer_keys(span_kind: i32, attrs: &[(&str, &str)]) -> Option<PeerKeys> {
        let map: HashMap<String, String> = attrs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        derive_peer_keys(span_kind, |key| map.get(key).cloned())
    }

    fn self_keys(span_kind: i32, attrs: &[(&str, &str)]) -> Option<SelfKeys> {
        let map: HashMap<String, String> = attrs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        derive_self_keys(span_kind, |key| map.get(key).cloned())
    }

    fn peer_key(attrs: &[(&str, &str)]) -> Option<String> {
        peer_keys(SPAN_KIND_CLIENT, attrs).and_then(|keys| keys.key)
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
    fn test_peer_key_chain_order() {
        // the four address keys are reached only after every host-shaped candidate
        let chain = [
            ("server.address", "a.svc"),
            ("net.peer.name", "b.svc"),
            ("http.host", "c.svc"),
            ("url.full", "http://d.svc/path"),
            ("peer.address", "10.0.0.1:8080"),
            ("net.peer.ip", "10.0.0.2"),
            ("network.peer.address", "10.0.0.3"),
            ("net.sock.peer.addr", "10.0.0.4"),
        ];
        let expected = [
            "a.svc", "b.svc", "c.svc", "d.svc", "10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4",
        ];
        for (idx, want) in expected.iter().enumerate() {
            assert_eq!(
                peer_key(&chain[idx..]).as_deref(),
                Some(*want),
                "candidate {idx} must win"
            );
        }
    }

    #[test]
    fn test_peer_key_keeps_ip_that_the_display_name_redacts() {
        let attrs = [("db.system", "redis"), ("server.address", "10.0.0.5:6379")];
        let keys = peer_keys(SPAN_KIND_CLIENT, &attrs).unwrap();
        assert_eq!(keys.key.as_deref(), Some("10.0.0.5"));
        assert_eq!(keys.port, Some(6379));
        // same attributes, display name still falls through to db.system
        assert_eq!(derive(SPAN_KIND_CLIENT, &attrs).unwrap().name, "redis");
    }

    #[test]
    fn test_peer_key_from_url_host() {
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[("url.full", "https://API.github.com/repos?page=2")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("api.github.com"));
        assert_eq!(keys.port, None); // the default port is not in the data

        let keys = peer_keys(SPAN_KIND_CLIENT, &[("http.url", "http://10.0.0.9:8080/v1")]).unwrap();
        assert_eq!(keys.key.as_deref(), Some("10.0.0.9"));
        assert_eq!(keys.port, Some(8080));

        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[("http.url", "http://[2001:db8::1]:8080/v1")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("2001:db8::1"));
        assert_eq!(keys.port, Some(8080));
    }

    #[test]
    fn test_key_normalization() {
        assert_eq!(
            peer_key(&[("server.address", "  API.Example.COM  ")]).as_deref(),
            Some("api.example.com")
        );
        assert_eq!(
            peer_key(&[("server.address", "api.example.com.")]).as_deref(),
            Some("api.example.com")
        );
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[("server.address", "Api.Example.com.:8080")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("api.example.com"));
        assert_eq!(keys.port, Some(8080));
        let keys = peer_keys(SPAN_KIND_CLIENT, &[("net.peer.name", "[::1]:6379")]).unwrap();
        assert_eq!(keys.key.as_deref(), Some("::1"));
        assert_eq!(keys.port, Some(6379));
        assert_eq!(
            peer_keys(SPAN_KIND_CLIENT, &[("server.address", "   ")]),
            None
        );
    }

    #[test]
    fn test_peer_port_resolution() {
        // explicit attribute beats the port inside the host value
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[("server.address", "db.prod:5432"), ("server.port", "6432")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("db.prod"));
        assert_eq!(keys.port, Some(6432));

        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[("net.peer.name", "db.prod"), ("net.peer.port", "5432")],
        )
        .unwrap();
        assert_eq!(keys.port, Some(5432));

        // no explicit attribute: the port split off the chosen host value
        let keys = peer_keys(SPAN_KIND_CLIENT, &[("server.address", "db.prod:5432")]).unwrap();
        assert_eq!(keys.port, Some(5432));

        for bad in ["70000", "0", "-1", "not-a-port"] {
            let keys = peer_keys(
                SPAN_KIND_CLIENT,
                &[("net.peer.name", "db.prod"), ("server.port", bad)],
            )
            .unwrap();
            assert_eq!(keys.port, None, "port {bad} must be omitted");
        }
    }

    #[test]
    fn test_port_attribute_present_but_invalid_omits_the_column() {
        // a present explicit attribute is the answer even when its value is unusable
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[("server.address", "db.prod:5432"), ("server.port", "70000")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("db.prod"));
        assert_eq!(keys.port, None);

        // a lower-priority attribute does not rescue an invalid server.port
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[
                ("net.peer.name", "db.prod"),
                ("server.port", "70000"),
                ("net.peer.port", "5432"),
            ],
        )
        .unwrap();
        assert_eq!(keys.port, None);

        // a valid lower-priority attribute still beats the embedded port
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[
                ("server.address", "db.prod:5432"),
                ("net.peer.port", "6432"),
            ],
        )
        .unwrap();
        assert_eq!(keys.port, Some(6432));

        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[("server.address", "cart.svc:8080"), ("server.port", "0")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("cart.svc"));
        assert_eq!(keys.port, None);

        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[
                ("net.host.name", "cart.svc:8080"),
                ("net.host.port", "9090"),
            ],
        )
        .unwrap();
        assert_eq!(keys.port, Some(9090));
    }

    #[test]
    fn test_blank_port_attribute_is_treated_as_absent() {
        // same rule as test_empty_values_treated_as_absent, applied to the port chains
        for blank in ["", "   "] {
            let keys = peer_keys(
                SPAN_KIND_CLIENT,
                &[("server.address", "db.prod:5432"), ("server.port", blank)],
            )
            .unwrap();
            assert_eq!(keys.port, Some(5432));

            let keys = peer_keys(
                SPAN_KIND_CLIENT,
                &[
                    ("server.address", "db.prod:5432"),
                    ("server.port", blank),
                    ("net.peer.port", "6432"),
                ],
            )
            .unwrap();
            assert_eq!(keys.port, Some(6432));

            let keys = self_keys(
                SPAN_KIND_SERVER,
                &[("server.address", "cart.svc:8080"), ("server.port", blank)],
            )
            .unwrap();
            assert_eq!(keys.port, Some(8080));

            // and on the key chain, where §1.1 spells the same rule out
            let keys = peer_keys(
                SPAN_KIND_CLIENT,
                &[("server.address", blank), ("net.peer.name", "db.prod")],
            )
            .unwrap();
            assert_eq!(keys.key.as_deref(), Some("db.prod"));
        }
    }

    #[test]
    fn test_url_port_equal_to_the_scheme_default_is_kept() {
        for (url, want) in [
            ("https://api.example.com:443/path", Some(443)),
            ("http://api.example.com:80/path", Some(80)),
            ("http://user:pw@api.example.com:80/path", Some(80)),
            ("https://api.example.com/path", None),
            ("https://api.example.com:8443/path", Some(8443)),
        ] {
            let keys = peer_keys(SPAN_KIND_CLIENT, &[("url.full", url)]).unwrap();
            assert_eq!(keys.key.as_deref(), Some("api.example.com"), "{url}");
            assert_eq!(keys.port, want, "{url}");
        }

        // an explicit port attribute still outranks the one inside the url
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[
                ("url.full", "https://api.example.com:443/path"),
                ("server.port", "8443"),
            ],
        )
        .unwrap();
        assert_eq!(keys.port, Some(8443));
    }

    #[test]
    fn test_peer_ip_is_an_independent_key() {
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[
                ("server.address", "opaque-alias"),
                ("net.peer.ip", "10.0.0.8"),
            ],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("opaque-alias"));
        assert_eq!(keys.ip.as_deref(), Some("10.0.0.8"));

        // ip chain order, with a host key so the equality rule does not apply
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[
                ("server.address", "alias.svc"),
                ("network.peer.address", "10.0.0.3"),
                ("net.peer.ip", "10.0.0.2"),
                ("peer.address", "10.0.0.1"),
            ],
        )
        .unwrap();
        assert_eq!(keys.ip.as_deref(), Some("10.0.0.2"));

        // no candidate is an IP
        let keys = peer_keys(
            SPAN_KIND_CLIENT,
            &[
                ("server.address", "db.prod"),
                ("peer.address", "db-alias:5432"),
            ],
        )
        .unwrap();
        assert_eq!(keys.ip, None);

        // identical to the host key
        let keys = peer_keys(SPAN_KIND_CLIENT, &[("server.address", "10.0.0.8:8080")]).unwrap();
        assert_eq!(keys.key.as_deref(), Some("10.0.0.8"));
        assert_eq!(keys.ip, None);
    }

    #[test]
    fn test_self_key_chain_and_port() {
        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[
                ("server.address", "cart.svc:8080"),
                ("net.host.name", "pod-7"),
                ("http.host", "cart"),
            ],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("cart.svc"));
        assert_eq!(keys.port, Some(8080));

        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[("net.host.name", "pod-7"), ("http.host", "cart")],
        )
        .unwrap();
        assert_eq!(keys.key.as_deref(), Some("pod-7"));

        let keys = self_keys(SPAN_KIND_CONSUMER, &[("http.host", "cart")]).unwrap();
        assert_eq!(keys.key.as_deref(), Some("cart"));

        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[("net.host.name", "pod-7"), ("net.host.port", "9090")],
        )
        .unwrap();
        assert_eq!(keys.port, Some(9090));
    }

    #[test]
    fn test_self_ip_chain() {
        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[
                ("net.host.ip", "10.1.2.3"),
                ("net.sock.host.addr", "10.1.2.4"),
            ],
        )
        .unwrap();
        assert_eq!(keys.ip.as_deref(), Some("10.1.2.3"));

        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[("network.local.address", "10.1.2.9:8080")],
        )
        .unwrap();
        assert_eq!(keys.ip.as_deref(), Some("10.1.2.9"));

        // a non-IP candidate is skipped, not returned
        let keys = self_keys(
            SPAN_KIND_SERVER,
            &[("net.host.ip", "pod-7"), ("net.sock.host.addr", "10.1.2.4")],
        )
        .unwrap();
        assert_eq!(keys.ip.as_deref(), Some("10.1.2.4"));

        assert_eq!(
            self_keys(SPAN_KIND_SERVER, &[("net.host.name", "pod-7")])
                .unwrap()
                .ip,
            None
        );
    }

    #[test]
    fn test_self_ip_from_resource_k8s_pod_ip() {
        // k8s.pod.ip is a resource attribute: the call site widens the lookup
        for resource_key in ["service_k8s.pod.ip", "service_k8s_pod_ip"] {
            let span: HashMap<String, String> =
                HashMap::from([("net.host.name".to_string(), "pod-7".to_string())]);
            let resource: HashMap<String, String> =
                HashMap::from([(resource_key.to_string(), "10.42.0.7".to_string())]);
            let keys = derive_self_keys(SPAN_KIND_SERVER, |key| {
                span.get(key)
                    .or_else(|| resource.get(key))
                    .or_else(|| resource.get(&format!("service_{key}")))
                    .cloned()
            })
            .unwrap();
            assert_eq!(keys.key.as_deref(), Some("pod-7"));
            assert_eq!(keys.ip.as_deref(), Some("10.42.0.7"), "via {resource_key}");
        }
    }

    #[test]
    fn test_span_kind_gating_for_graph_keys() {
        let attrs = [
            ("server.address", "host.svc:8080"),
            ("net.peer.ip", "10.0.0.2"),
            ("k8s.pod.ip", "10.42.0.7"),
        ];
        for kind in [SPAN_KIND_CLIENT, SPAN_KIND_PRODUCER] {
            assert!(peer_keys(kind, &attrs).is_some(), "span_kind {kind}");
            assert_eq!(self_keys(kind, &attrs), None, "span_kind {kind}");
        }
        for kind in [SPAN_KIND_SERVER, SPAN_KIND_CONSUMER] {
            assert!(self_keys(kind, &attrs).is_some(), "span_kind {kind}");
            assert_eq!(peer_keys(kind, &attrs), None, "span_kind {kind}");
        }
        for kind in [0, 1] {
            assert_eq!(peer_keys(kind, &attrs), None, "span_kind {kind}");
            assert_eq!(self_keys(kind, &attrs), None, "span_kind {kind}");
        }
    }

    #[test]
    fn test_graph_keys_from_flattened_spellings() {
        let dotted = [
            ("server.address", "cart.svc"),
            ("server.port", "8080"),
            ("net.peer.ip", "10.0.0.8"),
        ];
        let flattened = [
            ("server_address", "cart.svc"),
            ("server_port", "8080"),
            ("net_peer_ip", "10.0.0.8"),
        ];
        let expected = PeerKeys {
            key: Some("cart.svc".to_string()),
            port: Some(8080),
            ip: Some("10.0.0.8".to_string()),
        };
        assert_eq!(peer_keys(SPAN_KIND_CLIENT, &dotted), Some(expected.clone()));
        assert_eq!(peer_keys(SPAN_KIND_CLIENT, &flattened), Some(expected));

        assert_eq!(
            self_keys(SPAN_KIND_SERVER, &[("net.host.name", "cart.svc")]),
            self_keys(SPAN_KIND_SERVER, &[("net_host_name", "cart.svc")])
        );
    }

    #[test]
    fn test_span_kind_to_i32() {
        assert_eq!(span_kind_to_i32("3"), 3);
        assert_eq!(span_kind_to_i32("SPAN_KIND_CLIENT"), 3);
        assert_eq!(span_kind_to_i32("4"), 4);
        assert_eq!(span_kind_to_i32("unknown"), 0);
    }
}
