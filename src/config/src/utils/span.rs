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
    pin::Pin,
    sync::{LazyLock, OnceLock},
    task::{Context, Poll},
};

use futures::Stream;

/// CLIENT span for an outgoing gRPC call; `$addr` is the callee's gRPC address.
#[macro_export]
macro_rules! grpc_client_span {
    ($name:expr, $addr:expr, $service:expr, $method:expr $(, $($field:tt)*)?) => {{
        let (host, port) = $crate::utils::span::split_host_port($addr);
        ::tracing::info_span!(
            $name,
            otel.kind = "client",
            rpc.system = "grpc",
            rpc.service = $service,
            rpc.method = $method,
            server.address = host.as_str(),
            server.port = port,
            $($($field)*)?
        )
    }};
}

/// SERVER span for an incoming gRPC call, addressed by this node's own gRPC address.
#[macro_export]
macro_rules! grpc_server_span {
    ($name:expr, $service:expr, $method:expr $(, $($field:tt)*)?) => {
        ::tracing::info_span!(
            $name,
            otel.kind = "server",
            rpc.system = "grpc",
            rpc.service = $service,
            rpc.method = $method,
            server.address = $crate::utils::span::local_grpc_host(),
            server.port = $crate::utils::span::local_grpc_port(),
            $($($field)*)?
        )
    };
}

/// Attribute names shared with the ingest-side inference; keep them in one place.
pub const ATTR_OTEL_KIND: &str = "otel.kind";
pub const ATTR_RPC_SYSTEM: &str = "rpc.system";
pub const ATTR_RPC_SERVICE: &str = "rpc.service";
pub const ATTR_RPC_METHOD: &str = "rpc.method";
pub const ATTR_SERVER_ADDRESS: &str = "server.address";
pub const ATTR_SERVER_PORT: &str = "server.port";
pub const ATTR_HTTP_REQUEST_METHOD: &str = "http.request.method";
pub const ATTR_URL_PATH: &str = "url.path";
pub const ATTR_HTTP_ROUTE: &str = "http.route";

/// Header/metadata carrying this cluster's self-telemetry tag on OpenObserve's own OTLP exports.
pub const SELF_TELEMETRY_HEADER: &str = "x-o2-self-telemetry";

pub const KIND_CLIENT: &str = "client";
pub const KIND_SERVER: &str = "server";
pub const RPC_SYSTEM_GRPC: &str = "grpc";

// listen addresses come from env and never change while the process runs
static LOCAL_GRPC_ENDPOINT: LazyLock<(String, u16)> =
    LazyLock::new(|| split_host_port(&crate::cluster::get_local_grpc_addr()));

static LOCAL_HTTP_ENDPOINT: LazyLock<(String, u16)> =
    LazyLock::new(|| split_host_port(&crate::cluster::get_local_http_addr()));

// set on first use once the cluster secret exists; tracing starts before bootstrap caches it
static SELF_TELEMETRY_TAG: OnceLock<String> = OnceLock::new();

/// Stream that holds a span open until the body ends, fails, or the consumer drops it.
pub struct SpanBoundStream<S> {
    inner: Pin<Box<S>>,
    span: Option<tracing::Span>,
}

impl<S> SpanBoundStream<S> {
    /// An RPC's edge latency has to cover the response body, not only the response headers.
    pub fn new(inner: S, span: tracing::Span) -> Self {
        Self {
            inner: Box::pin(inner),
            span: Some(span),
        }
    }
}

impl<S: Stream> Stream for SpanBoundStream<S> {
    type Item = S::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        let polled = {
            let _entered = this.span.as_ref().map(tracing::Span::enter);
            this.inner.as_mut().poll_next(cx)
        };
        if let Poll::Ready(None) = &polled {
            this.span = None;
        }
        polled
    }
}

/// This cluster's self-telemetry tag, or `None` until the cluster secret is known.
pub fn self_telemetry_tag() -> Option<&'static str> {
    if let Some(tag) = SELF_TELEMETRY_TAG.get() {
        return Some(tag.as_str());
    }
    let tag = derive_self_telemetry_tag(
        &crate::get_config().grpc.internal_grpc_token,
        &crate::get_instance_id(),
    )?;
    Some(SELF_TELEMETRY_TAG.get_or_init(|| tag).as_str())
}

/// Whether a request is one of OpenObserve's own telemetry exports, which must not be traced.
pub fn is_self_telemetry(tag: Option<&str>) -> bool {
    tag_matches(tag, self_telemetry_tag())
}

pub fn local_grpc_host() -> &'static str {
    LOCAL_GRPC_ENDPOINT.0.as_str()
}

pub fn local_grpc_port() -> u16 {
    LOCAL_GRPC_ENDPOINT.1
}

pub fn local_http_host() -> &'static str {
    LOCAL_HTTP_ENDPOINT.0.as_str()
}

pub fn local_http_port() -> u16 {
    LOCAL_HTTP_ENDPOINT.1
}

/// Split an endpoint into host and port: `http://10.1.4.66:5081` -> `("10.1.4.66", 5081)`; 0 = none.
pub fn split_host_port(addr: &str) -> (String, u16) {
    let rest = addr.split_once("://").map_or(addr, |(_, rest)| rest);
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim();
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    if let Some(inner) = authority.strip_prefix('[') {
        let Some((host, tail)) = inner.split_once(']') else {
            return (inner.to_string(), 0);
        };
        let port = tail
            .strip_prefix(':')
            .and_then(|port| port.parse().ok())
            .unwrap_or(0);
        return (host.to_string(), port);
    }
    match authority.rsplit_once(':') {
        Some((host, port))
            if !host.contains(':')
                && !port.is_empty()
                && port.bytes().all(|b| b.is_ascii_digit()) =>
        {
            (host.to_string(), port.parse().unwrap_or(0))
        }
        _ => (authority.to_string(), 0),
    }
}

// the secret get_internal_grpc_token uses; no secret yet means no tag, never a random one
fn derive_self_telemetry_tag(token: &str, instance_id: &str) -> Option<String> {
    let secret = if token.is_empty() { instance_id } else { token };
    (!secret.is_empty()).then(|| sha256::digest(secret))
}

// before the cluster secret is known nothing matches, so nothing is suppressed
fn tag_matches(tag: Option<&str>, own: Option<&str>) -> bool {
    matches!((tag, own), (Some(tag), Some(own)) if tag == own)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use futures::StreamExt;
    use tracing::field::{Field, Visit};
    use tracing_subscriber::{Layer, Registry, layer::SubscriberExt};

    use super::*;

    #[derive(Default)]
    struct CapturedFields(Arc<Mutex<HashMap<String, String>>>);

    impl<S: tracing::Subscriber> Layer<S> for CapturedFields {
        fn on_new_span(
            &self,
            attrs: &tracing::span::Attributes<'_>,
            _id: &tracing::Id,
            _ctx: tracing_subscriber::layer::Context<'_, S>,
        ) {
            let mut visitor = FieldVisitor(self.0.lock().unwrap());
            attrs.record(&mut visitor);
        }
    }

    struct FieldVisitor<'a>(std::sync::MutexGuard<'a, HashMap<String, String>>);

    impl Visit for FieldVisitor<'_> {
        fn record_str(&mut self, field: &Field, value: &str) {
            self.0.insert(field.name().to_string(), value.to_string());
        }

        fn record_u64(&mut self, field: &Field, value: u64) {
            self.0.insert(field.name().to_string(), value.to_string());
        }

        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            self.0
                .insert(field.name().to_string(), format!("{value:?}"));
        }
    }

    struct CloseClock {
        start: Instant,
        closed_after: Arc<Mutex<Option<Duration>>>,
    }

    impl<S: tracing::Subscriber> Layer<S> for CloseClock {
        fn on_close(&self, _id: tracing::Id, _ctx: tracing_subscriber::layer::Context<'_, S>) {
            *self.closed_after.lock().unwrap() = Some(self.start.elapsed());
        }
    }

    fn capture<F: FnOnce()>(f: F) -> HashMap<String, String> {
        let captured = Arc::new(Mutex::new(HashMap::new()));
        let subscriber = Registry::default().with(CapturedFields(captured.clone()));
        tracing::subscriber::with_default(subscriber, f);
        let guard = captured.lock().unwrap();
        guard.clone()
    }

    fn close_clock() -> (
        Arc<Mutex<Option<Duration>>>,
        tracing::subscriber::DefaultGuard,
    ) {
        let closed_after = Arc::new(Mutex::new(None));
        let subscriber = Registry::default().with(CloseClock {
            start: Instant::now(),
            closed_after: closed_after.clone(),
        });
        (closed_after, tracing::subscriber::set_default(subscriber))
    }

    #[test]
    fn test_grpc_client_span_carries_the_peer_attributes() {
        let fields = capture(|| {
            let _span = crate::grpc_client_span!(
                "test:client",
                "http://10.1.4.66:5081",
                "cluster.Search",
                "Search"
            );
        });
        assert_eq!(
            fields.get(ATTR_OTEL_KIND).map(String::as_str),
            Some(KIND_CLIENT)
        );
        assert_eq!(
            fields.get(ATTR_RPC_SYSTEM).map(String::as_str),
            Some(RPC_SYSTEM_GRPC)
        );
        assert_eq!(
            fields.get(ATTR_RPC_SERVICE).map(String::as_str),
            Some("cluster.Search")
        );
        assert_eq!(
            fields.get(ATTR_RPC_METHOD).map(String::as_str),
            Some("Search")
        );
        assert_eq!(
            fields.get(ATTR_SERVER_ADDRESS).map(String::as_str),
            Some("10.1.4.66")
        );
        assert_eq!(
            fields.get(ATTR_SERVER_PORT).map(String::as_str),
            Some("5081")
        );
    }

    #[test]
    fn test_grpc_server_span_carries_the_self_attributes() {
        let fields = capture(|| {
            let _span = crate::grpc_server_span!("test:server", "cluster.Search", "Search");
        });
        assert_eq!(
            fields.get(ATTR_OTEL_KIND).map(String::as_str),
            Some(KIND_SERVER)
        );
        assert_eq!(
            fields.get(ATTR_SERVER_ADDRESS).map(String::as_str),
            Some(local_grpc_host())
        );
        assert_eq!(
            fields.get(ATTR_SERVER_PORT).map(String::as_str),
            Some(local_grpc_port().to_string().as_str())
        );
    }

    #[test]
    fn test_client_span_accepts_extra_fields() {
        let fields = capture(|| {
            let _span = crate::grpc_client_span!(
                "test:client",
                "10.1.4.66:5081",
                "cluster.Search",
                "Search",
                node_id = 7,
            );
        });
        assert_eq!(fields.get("node_id").map(String::as_str), Some("7"));
    }

    #[test]
    fn test_split_host_port_http_scheme() {
        assert_eq!(
            split_host_port("http://10.1.4.66:5081"),
            ("10.1.4.66".to_string(), 5081)
        );
    }

    #[test]
    fn test_split_host_port_https_scheme() {
        assert_eq!(
            split_host_port("https://host:443"),
            ("host".to_string(), 443)
        );
    }

    #[test]
    fn test_split_host_port_bare_host_port() {
        assert_eq!(
            split_host_port("10.1.4.66:5081"),
            ("10.1.4.66".to_string(), 5081)
        );
    }

    #[test]
    fn test_split_host_port_without_port() {
        assert_eq!(split_host_port("http://host"), ("host".to_string(), 0));
        assert_eq!(split_host_port("host"), ("host".to_string(), 0));
    }

    #[test]
    fn test_split_host_port_ipv6() {
        assert_eq!(
            split_host_port("http://[::1]:5081"),
            ("::1".to_string(), 5081)
        );
        assert_eq!(split_host_port("[::1]"), ("::1".to_string(), 0));
        assert_eq!(split_host_port("::1"), ("::1".to_string(), 0));
    }

    #[test]
    fn test_split_host_port_garbage() {
        assert_eq!(split_host_port(""), (String::new(), 0));
        assert_eq!(split_host_port("://"), (String::new(), 0));
        assert_eq!(
            split_host_port("host:notaport"),
            ("host:notaport".to_string(), 0)
        );
        assert_eq!(split_host_port("host:99999"), ("host".to_string(), 0));
    }

    #[test]
    fn test_split_host_port_strips_path_and_userinfo() {
        assert_eq!(
            split_host_port("http://user:pass@host:5081/path?q=1"),
            ("host".to_string(), 5081)
        );
    }

    #[test]
    fn test_self_telemetry_tag_needs_a_cluster_secret() {
        assert_eq!(derive_self_telemetry_tag("", ""), None);
        let tag = derive_self_telemetry_tag("", "instance-a").unwrap();
        // every node of a cluster reads the same instance id, so each must derive the same tag
        assert_eq!(
            derive_self_telemetry_tag("", "instance-a"),
            Some(tag.clone())
        );
        assert_ne!(
            derive_self_telemetry_tag("", "instance-b"),
            Some(tag.clone())
        );
        assert_eq!(
            derive_self_telemetry_tag("token", "instance-a"),
            derive_self_telemetry_tag("token", "instance-b")
        );
        assert_eq!(tag.len(), 64);
        assert!(tag.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_tag_matches_only_the_own_tag() {
        assert!(tag_matches(Some("abc"), Some("abc")));
        assert!(!tag_matches(Some("1"), Some("abc")));
        assert!(!tag_matches(None, Some("abc")));
        assert!(!tag_matches(Some("abc"), None));
        assert!(!tag_matches(None, None));
    }

    #[tokio::test]
    async fn test_span_bound_stream_closes_after_a_delayed_body() {
        let (closed_after, _guard) = close_clock();
        let body = futures::stream::once(async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            1u8
        });
        let mut stream = SpanBoundStream::new(body, tracing::info_span!("test:stream"));

        assert_eq!(stream.next().await, Some(1));
        assert!(
            closed_after.lock().unwrap().is_none(),
            "the span must still be open while the body is flowing"
        );

        assert_eq!(stream.next().await, None);
        let elapsed = closed_after
            .lock()
            .unwrap()
            .expect("the span closes when the body ends");
        assert!(elapsed >= Duration::from_millis(50), "{elapsed:?}");
    }

    #[tokio::test]
    async fn test_span_bound_stream_closes_when_the_consumer_drops_it() {
        let (closed_after, _guard) = close_clock();
        let mut stream = SpanBoundStream::new(
            futures::stream::iter([1u8, 2u8]),
            tracing::info_span!("test:stream"),
        );

        assert_eq!(stream.next().await, Some(1));
        assert!(closed_after.lock().unwrap().is_none());

        drop(stream);
        assert!(
            closed_after.lock().unwrap().is_some(),
            "a cancelled stream must close its span"
        );
    }
}
