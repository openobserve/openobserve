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
    net::{IpAddr, SocketAddr},
    str::FromStr,
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Extension, FromRequestParts},
    http::Request,
    middleware::Next,
    response::Response,
};
use axum_client_ip::{ClientIp, ClientIpSource};

/// The real client IP resolved by [`extract_real_ip`] and attached to the
/// request extensions. Consumers should read this instead of parsing
/// `X-Forwarded-For` / `Forwarded` headers directly.
#[derive(Clone, Copy, Debug)]
pub struct RealIp(pub IpAddr);

/// Ordered list of IP sources to try, injected as a request extension by the
/// router. The middleware tries each in turn and uses the first one that
/// resolves; if none do, it implicitly falls back to [`ClientIpSource::ConnectInfo`]
/// (the TCP peer).
#[derive(Clone)]
pub struct ClientIpSources(pub Arc<Vec<ClientIpSource>>);

/// Parse a comma-separated list of source names (e.g.
/// `"XEnvoyExternalAddress,XRealIp"`) into a [`ClientIpSources`] chain.
/// Empty / all-invalid input resolves to an empty chain; the middleware
/// will still fall back to `ConnectInfo` at request time.
pub fn resolve_client_ip_sources(configured: &str) -> ClientIpSources {
    let sources: Vec<ClientIpSource> = configured
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| match ClientIpSource::from_str(s) {
            Ok(src) => Some(src),
            Err(_) => {
                log::warn!(
                    "invalid ZO_HTTP_REAL_IP_SOURCE entry {s:?}, skipping; \
                     valid values: ConnectInfo, RightmostXForwardedFor, \
                     RightmostForwarded, XRealIp, CfConnectingIp, TrueClientIp, \
                     FlyClientIp, XEnvoyExternalAddress, CloudFrontViewerAddress"
                );
                None
            }
        })
        .collect();
    ClientIpSources(Arc::new(sources))
}

/// Middleware that resolves the real client IP by trying each configured
/// [`ClientIpSource`] in order, with an implicit [`ClientIpSource::ConnectInfo`]
/// fallback. The first source that yields an IP wins; the result is stored
/// as a [`RealIp`] request extension.
///
/// Extraction failures are silent — logging middlewares will render `-`
/// for the IP if nothing resolved (not even the TCP peer, which only
/// happens if the server was started without `ConnectInfo` support).
pub async fn extract_real_ip(
    Extension(sources): Extension<ClientIpSources>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let (mut parts, body) = req.into_parts();

    let mut resolved: Option<IpAddr> = None;
    for source in sources.0.iter() {
        // `ClientIp` reads the `ClientIpSource` extension to decide which
        // header (or ConnectInfo) to use; swap it in for each attempt.
        parts.extensions.insert(source.clone());
        if let Ok(ClientIp(ip)) = ClientIp::from_request_parts(&mut parts, &()).await {
            resolved = Some(ip);
            break;
        }
    }

    // Implicit fallback: TCP peer. Useful for local dev / health checks that
    // skip the ingress, and harmless when an ingress is present (yields the
    // ingress pod IP, which is at least a real cluster address).
    if resolved.is_none() {
        resolved = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip());
    }

    let mut req = Request::from_parts(parts, body);
    if let Some(ip) = resolved {
        req.extensions_mut().insert(RealIp(ip));
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_empty_string_returns_no_sources() {
        let sources = resolve_client_ip_sources("");
        assert!(sources.0.is_empty());
    }

    #[test]
    fn test_resolve_whitespace_only_returns_no_sources() {
        let sources = resolve_client_ip_sources("  ,  ");
        assert!(sources.0.is_empty());
    }

    #[test]
    fn test_resolve_single_valid_source() {
        let sources = resolve_client_ip_sources("XRealIp");
        assert_eq!(sources.0.len(), 1);
    }

    #[test]
    fn test_resolve_multiple_valid_sources() {
        let sources = resolve_client_ip_sources("XRealIp,CfConnectingIp");
        assert_eq!(sources.0.len(), 2);
    }

    #[test]
    fn test_resolve_invalid_source_filtered_out() {
        let sources = resolve_client_ip_sources("NotARealSource");
        assert!(sources.0.is_empty());
    }

    #[test]
    fn test_resolve_mix_valid_and_invalid() {
        let sources = resolve_client_ip_sources("XRealIp,BadSource,CfConnectingIp");
        assert_eq!(sources.0.len(), 2);
    }
}
