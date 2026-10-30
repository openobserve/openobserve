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

//! The callback endpoint probes are told to call back on
//! (`config::meta::synthetics::api_endpoint`), as it can safely appear in a
//! log line or a dead-letter message, plus a startup reachability warning for
//! Lambda venues (o2-enterprise#3165).

use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr},
    time::Duration,
};

/// Placeholder for an endpoint that does not parse, so no raw value (which may
/// carry credentials) is ever echoed.
pub const UNPARSEABLE_ENDPOINT: &str = "<unparseable callback endpoint>";

/// `scheme://host[:port]/path` of `raw`: no userinfo, no query, no fragment.
/// `None` when `raw` is not an absolute URL with a host.
pub fn sanitize_callback_url(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let host = url.host_str()?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    let path = url.path().trim_end_matches('/');
    Some(format!("{}://{host}{port}{path}", url.scheme()))
}

/// The endpoint probes are currently told to call back on, sanitized.
pub fn current_callback_endpoint() -> String {
    sanitize_callback_url(&config::meta::synthetics::api_endpoint())
        .unwrap_or_else(|| UNPARSEABLE_ENDPOINT.to_string())
}

/// Address classes a Lambda function outside the deployment's network usually
/// cannot reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddrClass {
    Public,
    Loopback,
    Unspecified,
    LinkLocal,
    Private,
}

pub fn classify_ip(ip: IpAddr) -> AddrClass {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return classify_v4(v4);
            }
            classify_v6(v6)
        }
    }
}

fn classify_v4(ip: Ipv4Addr) -> AddrClass {
    let o = ip.octets();
    if ip.is_loopback() {
        AddrClass::Loopback
    } else if ip.is_unspecified() {
        AddrClass::Unspecified
    } else if ip.is_link_local() {
        AddrClass::LinkLocal
    } else if ip.is_private() || (o[0] == 100 && (o[1] & 0xc0) == 64) {
        // RFC 1918 plus shared address space (100.64.0.0/10, carrier NAT).
        AddrClass::Private
    } else {
        AddrClass::Public
    }
}

fn classify_v6(ip: Ipv6Addr) -> AddrClass {
    let first = ip.segments()[0];
    if ip.is_loopback() {
        AddrClass::Loopback
    } else if ip.is_unspecified() {
        AddrClass::Unspecified
    } else if (first & 0xffc0) == 0xfe80 {
        AddrClass::LinkLocal
    } else if (first & 0xfe00) == 0xfc00 {
        // Unique local addresses, fc00::/7.
        AddrClass::Private
    } else {
        AddrClass::Public
    }
}

/// The host part of a parsed URL as an IP literal, IPv6 brackets stripped.
fn host_ip(host: &str) -> Option<IpAddr> {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok()
}

const DNS_TIMEOUT: Duration = Duration::from_secs(2);

/// Log-only check run when a Lambda venue is enabled: a Lambda function can
/// call back only on an endpoint reachable from its own network. Never rejects
/// anything, because a VPC-connected Lambda can legitimately reach private
/// addresses. Logs only the sanitized endpoint.
pub async fn warn_if_lambda_callback_may_be_unreachable() {
    let raw = config::meta::synthetics::api_endpoint();
    let Some(shown) = sanitize_callback_url(&raw) else {
        tracing::warn!(
            "[synthetics] Lambda venue enabled but the callback endpoint \
             (ZO_SYNTHETICS_API_ENDPOINT, else ZO_WEB_URL) is empty or not an absolute URL; \
             Lambda probes may be unable to report results"
        );
        return;
    };
    let Ok(url) = reqwest::Url::parse(raw.trim()) else {
        return;
    };
    let Some(host) = url.host_str() else { return };
    let advice = "a Lambda probe can report only if this endpoint is reachable from the \
                  Lambda function's network (a VPC-connected function can reach private \
                  addresses; otherwise use a public endpoint)";

    if let Some(ip) = host_ip(host) {
        let class = classify_ip(ip);
        if class != AddrClass::Public {
            tracing::warn!(
                endpoint = %shown,
                address_class = ?class,
                "[synthetics] callback endpoint is a {class:?} address; {advice}"
            );
        }
        return;
    }
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost") {
        tracing::warn!(
            endpoint = %shown,
            "[synthetics] callback endpoint is localhost; {advice}"
        );
        return;
    }

    let port = url.port_or_known_default().unwrap_or(443);
    let lookup = tokio::time::timeout(
        DNS_TIMEOUT,
        tokio::net::lookup_host((host.to_string(), port)),
    )
    .await;
    let addrs: Vec<IpAddr> = match lookup {
        Ok(Ok(it)) => it.map(|sa| sa.ip()).collect(),
        Ok(Err(e)) => {
            tracing::warn!(
                endpoint = %shown,
                "[synthetics] could not resolve the callback endpoint host from this node ({e}); \
                 Lambda probes may be unable to report results if it does not resolve for them \
                 either"
            );
            return;
        }
        Err(_) => {
            tracing::warn!(
                endpoint = %shown,
                "[synthetics] resolving the callback endpoint host timed out after {}s; \
                 Lambda probes may be unable to report results if it does not resolve for them \
                 either",
                DNS_TIMEOUT.as_secs()
            );
            return;
        }
    };
    let non_public = addrs
        .iter()
        .filter(|ip| classify_ip(**ip) != AddrClass::Public)
        .count();
    if non_public == 0 {
        return;
    }
    let kind = if non_public == addrs.len() {
        "only private, loopback or link-local addresses"
    } else {
        "a mix of public and private addresses"
    };
    tracing::warn!(
        endpoint = %shown,
        "[synthetics] callback endpoint host resolves to {kind}; {advice}"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_userinfo_query_and_fragment() {
        assert_eq!(
            sanitize_callback_url("https://user:secret@o2.example.com:8443/api/?token=abc#x"),
            Some("https://o2.example.com:8443/api".to_string())
        );
        assert_eq!(
            sanitize_callback_url("http://o2.example.com"),
            Some("http://o2.example.com".to_string())
        );
    }

    #[test]
    fn sanitize_keeps_ipv6_brackets() {
        assert_eq!(
            sanitize_callback_url("http://[fd00::1]:5080/base?sig=1"),
            Some("http://[fd00::1]:5080/base".to_string())
        );
    }

    #[test]
    fn sanitize_rejects_bad_urls() {
        assert_eq!(sanitize_callback_url(""), None);
        assert_eq!(sanitize_callback_url("not a url"), None);
        assert_eq!(sanitize_callback_url("o2.example.com/api"), None);
        assert_eq!(sanitize_callback_url("mailto:a@b.c"), None);
    }

    #[test]
    fn classify_ipv4() {
        let c = |s: &str| classify_ip(s.parse().unwrap());
        assert_eq!(c("127.0.0.1"), AddrClass::Loopback);
        assert_eq!(c("0.0.0.0"), AddrClass::Unspecified);
        assert_eq!(c("169.254.169.254"), AddrClass::LinkLocal);
        assert_eq!(c("10.1.2.3"), AddrClass::Private);
        assert_eq!(c("172.16.0.1"), AddrClass::Private);
        assert_eq!(c("192.168.1.1"), AddrClass::Private);
        assert_eq!(c("100.64.0.1"), AddrClass::Private);
        assert_eq!(c("8.8.8.8"), AddrClass::Public);
        assert_eq!(c("172.32.0.1"), AddrClass::Public);
    }

    #[test]
    fn classify_ipv6() {
        let c = |s: &str| classify_ip(s.parse().unwrap());
        assert_eq!(c("::1"), AddrClass::Loopback);
        assert_eq!(c("::"), AddrClass::Unspecified);
        assert_eq!(c("fe80::1"), AddrClass::LinkLocal);
        assert_eq!(c("fd12:3456::1"), AddrClass::Private);
        assert_eq!(c("::ffff:10.0.0.1"), AddrClass::Private);
        assert_eq!(c("2606:4700::1111"), AddrClass::Public);
    }

    #[test]
    fn host_ip_parses_bracketed_ipv6() {
        assert_eq!(host_ip("[::1]"), Some("::1".parse().unwrap()));
        assert_eq!(host_ip("o2.example.com"), None);
    }
}
