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

//! SSRF (Server-Side Request Forgery) protection utilities.
//!
//! Lives in the `config` crate so both OSS and o2-enterprise can use it
//! without crossing the layering rules (enterprise depends on `config`,
//! not on the top-level `openobserve` crate).

use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

pub struct SsrfGuard;

impl SsrfGuard {
    pub fn validate_url_with_config(url: &str) -> Result<(), String> {
        let allow_loopback = crate::get_config().common.ssrf_allow_loopback;
        Self::validate_url_inner(url, allow_loopback)
    }

    pub fn validate_url(url: &str) -> Result<(), String> {
        Self::validate_url_inner(url, false)
    }

    fn validate_url_inner(url: &str, allow_loopback: bool) -> Result<(), String> {
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(format!(
                "Unsupported URL scheme: {}. Only HTTP and HTTPS are allowed.",
                parsed.scheme()
            ));
        }

        let host = parsed
            .host_str()
            .ok_or_else(|| "URL must have a valid host".to_string())?;

        // Strip IPv6 brackets so IpAddr can parse the literal.
        let unbracketed_host = if host.starts_with('[') && host.ends_with(']') {
            &host[1..host.len() - 1]
        } else {
            host
        };

        if let Ok(ip_addr) = unbracketed_host.parse::<IpAddr>() {
            if Self::is_private_ip_inner(&ip_addr, allow_loopback) {
                return Err(format!(
                    "Access to private IP address {} is not allowed for security reasons. \
                     This prevents Server-Side Request Forgery (SSRF) attacks.",
                    ip_addr
                ));
            }
        } else {
            let lower_host = host.to_lowercase();

            if !allow_loopback
                && (lower_host == "localhost"
                    || lower_host.starts_with("localhost.")
                    || lower_host == "127.0.0.1")
            {
                return Err("Access to localhost is not allowed for security reasons".to_string());
            }

            if lower_host.ends_with(".internal")
                || lower_host.ends_with(".local")
                || lower_host.ends_with(".localdomain")
                || lower_host.ends_with(".lan")
                || lower_host.contains(".local.")
            {
                return Err(format!(
                    "Access to internal domain {} is not allowed for security reasons",
                    host
                ));
            }

            if lower_host == "169.254.169.254"
                || lower_host == "metadata.google.internal"
                || lower_host == "metadata"
                || lower_host.ends_with(".metadata.google.internal")
                || lower_host.ends_with("metadata.")
            {
                return Err(format!(
                    "Access to cloud metadata endpoint {} is not allowed for security reasons",
                    host
                ));
            }
        }

        Ok(())
    }

    #[cfg(test)]
    fn is_private_ip(ip: &IpAddr) -> bool {
        Self::is_private_ip_inner(ip, false)
    }

    /// Validate a single resolved IP against the SSRF policy, honoring
    /// `ZO_SSRF_ALLOW_LOOPBACK`. Used by the custom DNS resolver so that
    /// hostname → private-IP bypasses are blocked even when the literal
    /// hostname string passed the pre-flight check.
    pub fn check_ip_with_config(ip: &IpAddr) -> Result<(), String> {
        let allow_loopback = crate::get_config().common.ssrf_allow_loopback;
        Self::check_ip_inner(ip, allow_loopback)
    }

    fn check_ip_inner(ip: &IpAddr, allow_loopback: bool) -> Result<(), String> {
        if Self::is_private_ip_inner(ip, allow_loopback) {
            return Err(format!(
                "Access to private IP address {} is not allowed for security reasons. \
                 This prevents Server-Side Request Forgery (SSRF) attacks.",
                ip
            ));
        }
        Ok(())
    }

    /// Async validator: runs the string checks, then resolves the hostname via
    /// DNS and validates every returned IP. Closes the hostname-points-at-private
    /// bypass that the sync validator can't see.
    pub async fn validate_url_with_config_async(url: &str) -> Result<(), String> {
        let allow_loopback = crate::get_config().common.ssrf_allow_loopback;
        Self::validate_url_inner(url, allow_loopback)?;

        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;
        let Some(host) = parsed.host_str() else {
            return Err("URL must have a valid host".to_string());
        };

        let unbracketed = if host.starts_with('[') && host.ends_with(']') {
            &host[1..host.len() - 1]
        } else {
            host
        };
        if unbracketed.parse::<IpAddr>().is_ok() {
            return Ok(());
        }

        let port = parsed.port_or_known_default().unwrap_or(80);
        let addrs = tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| format!("Failed to resolve host {}: {}", host, e))?;

        let mut saw_any = false;
        for sa in addrs {
            saw_any = true;
            Self::check_ip_inner(&sa.ip(), allow_loopback)?;
        }

        if !saw_any {
            return Err(format!("Host {} resolved to no addresses", host));
        }

        Ok(())
    }

    fn is_private_ip_inner(ip: &IpAddr, allow_loopback: bool) -> bool {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();

                (!allow_loopback && octets[0] == 127)
                    || (octets[0] == 10)
                    || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                    || (octets[0] == 192 && octets[1] == 168)
                    || (octets[0] == 169 && octets[1] == 254)
                    || (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127)
                    || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                    || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                    || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                    || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                    || (octets[0] >= 240
                        && !(octets[0] == 255
                            && octets[1] == 255
                            && octets[2] == 255
                            && octets[3] == 255))
            }
            IpAddr::V6(ipv6) => {
                if let Some(v4) = ipv6.to_ipv4_mapped() {
                    return Self::is_private_ip_inner(&IpAddr::V4(v4), allow_loopback);
                }

                let segments = ipv6.segments();

                (!allow_loopback && ipv6.is_loopback())
                    || (segments[0] & 0xffc0) == 0xfe80
                    || (segments[0] & 0xfe00) == 0xfc00
                    || (segments[0] == 0x2001 && segments[1] == 0xdb8)
            }
        }
    }
}

/// Custom DNS resolver for reqwest that runs every resolved address through
/// `SsrfGuard::check_ip_with_config`. Blocks hostname-points-at-private bypasses
/// and DNS-rebind on redirect hops where the sync redirect callback can't DNS.
#[derive(Debug, Default, Clone)]
pub struct SsrfDnsResolver;

impl Resolve for SsrfDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?
                .collect();

            for sa in &addrs {
                if let Err(e) = SsrfGuard::check_ip_with_config(&sa.ip()) {
                    return Err(Box::<dyn std::error::Error + Send + Sync>::from(e));
                }
            }

            let iter: Addrs = Box::new(addrs.into_iter());
            Ok(iter)
        })
    }
}

/// Build a reqwest client that is hardened against SSRF on redirect chains
/// and on DNS resolution. Use this anywhere the URL is derived from user input.
///
/// Two layers of defense:
/// 1. Custom redirect policy (max 5 hops), revalidates each redirect target.
/// 2. Custom DNS resolver, revalidates every resolved IP.
///
/// Honors `ZO_SSRF_ALLOW_LOOPBACK` consistently across both layers.
pub fn build_safe_client(builder: reqwest::ClientBuilder) -> reqwest::Result<reqwest::Client> {
    builder
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many redirects");
            }
            match SsrfGuard::validate_url_with_config(attempt.url().as_str()) {
                Ok(()) => attempt.follow(),
                Err(e) => attempt.error(e),
            }
        }))
        .dns_resolver(Arc::new(SsrfDnsResolver))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_private_ip() {
        assert!(SsrfGuard::is_private_ip(&"10.0.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"192.168.1.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"172.16.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"127.0.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"169.254.1.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"::1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(
            &"::ffff:127.0.0.1".parse().unwrap()
        ));
        assert!(SsrfGuard::is_private_ip(
            &"::ffff:10.0.0.1".parse().unwrap()
        ));
        assert!(SsrfGuard::is_private_ip(&"fe80::1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"fc00::1".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"8.8.8.8".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"2606:4700::1".parse().unwrap()));
    }

    #[test]
    fn test_check_ip_with_config_rejects_private() {
        assert!(SsrfGuard::check_ip_with_config(&"10.0.0.1".parse().unwrap()).is_err());
        assert!(SsrfGuard::check_ip_with_config(&"169.254.169.254".parse().unwrap()).is_err());
        assert!(SsrfGuard::check_ip_with_config(&"8.8.8.8".parse().unwrap()).is_ok());
    }

    #[tokio::test]
    async fn test_async_validator_rejects_literal_private() {
        assert!(
            SsrfGuard::validate_url_with_config_async("http://10.0.0.1/")
                .await
                .is_err()
        );
        assert!(
            SsrfGuard::validate_url_with_config_async("http://169.254.169.254/")
                .await
                .is_err()
        );
        assert!(
            SsrfGuard::validate_url_with_config_async("http://[::1]/")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn test_async_validator_resolves_hostname_to_private() {
        // localhost resolves to 127.0.0.1 — must be rejected by the DNS-aware path.
        let res = SsrfGuard::validate_url_with_config_async("http://localhost/").await;
        assert!(res.is_err(), "localhost must be rejected, got {:?}", res);
    }

    #[test]
    fn test_172_boundary() {
        assert!(!SsrfGuard::is_private_ip(
            &"172.15.255.255".parse().unwrap()
        ));
        assert!(SsrfGuard::is_private_ip(&"172.16.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"172.31.255.255".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"172.32.0.1".parse().unwrap()));
    }

    #[test]
    fn test_carrier_grade_nat() {
        assert!(SsrfGuard::is_private_ip(&"100.64.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(
            &"100.127.255.255".parse().unwrap()
        ));
        assert!(!SsrfGuard::is_private_ip(&"100.128.0.1".parse().unwrap()));
    }
}
