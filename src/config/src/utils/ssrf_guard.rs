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
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, LazyLock},
};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

const METADATA_IPS: [IpAddr; 2] = [
    IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254)),
    IpAddr::V6(Ipv6Addr::new(0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254)),
];

static ALLOWLIST: LazyLock<SsrfAllowlist> = LazyLock::new(|| {
    let cfg = crate::get_config();
    SsrfAllowlist::parse(
        &cfg.common.ssrf_allowed_cidrs,
        &cfg.common.ssrf_allowed_hosts,
    )
});

pub struct SsrfGuard;

impl SsrfGuard {
    pub fn validate_url_with_config(url: &str) -> Result<(), String> {
        let allow_loopback = crate::get_config().common.ssrf_allow_loopback;
        let skip_ssrf = crate::get_config().common.skip_ssrf_checks;
        Self::validate_url_inner(url, allow_loopback, skip_ssrf, &ALLOWLIST)
    }

    fn validate_url_inner(
        url: &str,
        allow_loopback: bool,
        skip_ssrf: bool,
        allowlist: &SsrfAllowlist,
    ) -> Result<(), String> {
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

        if skip_ssrf {
            return Ok(());
        }

        // Strip IPv6 brackets so IpAddr can parse the literal.
        let unbracketed_host = if host.starts_with('[') && host.ends_with(']') {
            &host[1..host.len() - 1]
        } else {
            host
        };

        if let Ok(ip_addr) = unbracketed_host.parse::<IpAddr>() {
            if Self::is_private_ip_inner(&ip_addr, allow_loopback) && !allowlist.allows_ip(&ip_addr)
            {
                return Err(format!(
                    "Access to private IP address {} is not allowed for security reasons. \
                     This prevents Server-Side Request Forgery (SSRF) attacks.",
                    ip_addr
                ));
            }
        } else {
            let lower_host = host.to_lowercase();
            let host_allowed = allowlist.allows_host(host);

            if !allow_loopback
                && !host_allowed
                && (lower_host == "localhost"
                    || lower_host.starts_with("localhost.")
                    || lower_host == "127.0.0.1")
            {
                return Err("Access to localhost is not allowed for security reasons".to_string());
            }

            if !host_allowed
                && (lower_host.ends_with(".internal")
                    || lower_host.ends_with(".local")
                    || lower_host.ends_with(".localdomain")
                    || lower_host.ends_with(".lan")
                    || lower_host.contains(".local."))
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

    /// Validate one IP against the SSRF policy, with no hostname allowlist entry to lift it.
    pub fn check_ip_with_config(ip: &IpAddr) -> Result<(), String> {
        let allow_loopback = crate::get_config().common.ssrf_allow_loopback;
        let skip_ssrf = crate::get_config().common.skip_ssrf_checks;
        if skip_ssrf {
            return Ok(());
        }
        Self::check_ip_inner(ip, allow_loopback, false, &ALLOWLIST)
    }

    /// `host_allowed` lifts the private-address check but never the metadata block.
    fn check_ip_inner(
        ip: &IpAddr,
        allow_loopback: bool,
        host_allowed: bool,
        allowlist: &SsrfAllowlist,
    ) -> Result<(), String> {
        if allowlist.allows_ip(ip) {
            return Ok(());
        }
        let blocked = if host_allowed {
            is_metadata_ip(ip)
        } else {
            Self::is_private_ip_inner(ip, allow_loopback)
        };
        if blocked {
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
        let skip_ssrf = crate::get_config().common.skip_ssrf_checks;
        Self::validate_url_async_inner(url, allow_loopback, skip_ssrf, &ALLOWLIST).await
    }

    async fn validate_url_async_inner(
        url: &str,
        allow_loopback: bool,
        skip_ssrf: bool,
        allowlist: &SsrfAllowlist,
    ) -> Result<(), String> {
        if skip_ssrf {
            return Ok(());
        }
        Self::validate_url_inner(url, allow_loopback, skip_ssrf, allowlist)?;

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
        let addrs = match tokio::net::lookup_host((host, port)).await {
            Ok(addrs) => addrs,
            // SsrfDnsResolver still checks every address at connect time.
            Err(_) if allow_loopback => return Ok(()),
            Err(e) => return Err(format!("Failed to resolve host {}: {}", host, e)),
        };

        let host_allowed = allowlist.allows_host(host);
        let mut saw_any = false;
        for sa in addrs {
            saw_any = true;
            Self::check_ip_inner(&sa.ip(), allow_loopback, host_allowed, allowlist)?;
        }

        if !saw_any && !allow_loopback {
            return Err(format!("Host {} resolved to no addresses", host));
        }

        Ok(())
    }

    fn is_private_ip_inner(ip: &IpAddr, allow_loopback: bool) -> bool {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();

                // 0.0.0.0/8 — "this network" (RFC 1122); OS routes to loopback on connect
                (octets[0] == 0)
                    || (!allow_loopback && octets[0] == 127)
                    || (octets[0] == 10)
                    || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                    || (octets[0] == 192 && octets[1] == 168)
                    || (octets[0] == 169 && octets[1] == 254)
                    || (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127)
                    || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
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
                if let Some(v4) = ipv6.to_ipv4_mapped().or_else(|| Self::embedded_ipv4(ipv6)) {
                    return Self::is_private_ip_inner(&IpAddr::V4(v4), allow_loopback);
                }

                let segments = ipv6.segments();

                // :: (IPv6 unspecified) — not loopback, not v4-mapped, still routes to loopback
                ipv6.is_unspecified()
                    || (!allow_loopback && ipv6.is_loopback())
                    || (segments[0] & 0xffc0) == 0xfe80
                    || (segments[0] & 0xfe00) == 0xfc00
                    || (segments[0] == 0x2001 && segments[1] == 0xdb8)
            }
        }
    }

    /// IPv4 destination carried by a NAT64, 6to4 or IPv4-compatible IPv6 address.
    fn embedded_ipv4(ip: &Ipv6Addr) -> Option<Ipv4Addr> {
        let v4 = |hi: u16, lo: u16| Ipv4Addr::from((u32::from(hi) << 16) | u32::from(lo));
        match ip.segments() {
            [0x64, 0xff9b, 0, 0, 0, 0, hi, lo] => Some(v4(hi, lo)),
            [0x2002, hi, lo, ..] => Some(v4(hi, lo)),
            [0, 0, 0, 0, 0, 0, hi, lo] if !ip.is_unspecified() && !ip.is_loopback() => {
                Some(v4(hi, lo))
            }
            _ => None,
        }
    }
}

/// Operator exceptions to the SSRF checks, parsed once from the two allowlist env vars.
#[derive(Debug, Default)]
struct SsrfAllowlist {
    cidrs: Vec<Cidr>,
    hosts: Vec<String>,
}

impl SsrfAllowlist {
    fn parse(cidrs: &str, hosts: &str) -> Self {
        let cidrs = split_list(cidrs)
            .filter_map(|entry| {
                let cidr = Cidr::parse(entry);
                if cidr.is_none() {
                    log::warn!("ZO_SSRF_ALLOWED_CIDRS: ignoring invalid CIDR '{entry}'");
                }
                cidr
            })
            .collect();
        let hosts = split_list(hosts)
            .filter_map(|entry| {
                if entry.contains(['*', '/', ':']) || entry.contains(char::is_whitespace) {
                    log::warn!("ZO_SSRF_ALLOWED_HOSTS: ignoring invalid hostname '{entry}'");
                    return None;
                }
                Some(entry.to_ascii_lowercase())
            })
            .collect();
        Self { cidrs, hosts }
    }

    fn allows_host(&self, host: &str) -> bool {
        self.hosts.iter().any(|h| h.eq_ignore_ascii_case(host))
    }

    /// A metadata address is admitted only by a CIDR naming exactly that address.
    fn allows_ip(&self, ip: &IpAddr) -> bool {
        let ip = canonical_ip(ip);
        if is_metadata_ip(&ip) {
            return self.cidrs.iter().any(|c| c.is_single(&ip));
        }
        self.cidrs.iter().any(|c| c.contains(&ip))
    }
}

#[derive(Debug)]
struct Cidr {
    network: IpAddr,
    prefix: u8,
}

impl Cidr {
    /// A bare address is a single-address CIDR.
    fn parse(entry: &str) -> Option<Self> {
        let (addr, prefix) = match entry.split_once('/') {
            Some((addr, prefix)) => (addr, Some(prefix.parse::<u8>().ok()?)),
            None => (entry, None),
        };
        let network = canonical_ip(&addr.parse::<IpAddr>().ok()?);
        let max = if network.is_ipv4() { 32 } else { 128 };
        let prefix = prefix.unwrap_or(max);
        (prefix <= max).then_some(Self { network, prefix })
    }

    fn contains(&self, ip: &IpAddr) -> bool {
        match (self.network, ip) {
            (IpAddr::V4(net), IpAddr::V4(ip)) => prefix_eq(
                u128::from(u32::from(net)),
                u128::from(u32::from(*ip)),
                self.prefix,
                32,
            ),
            (IpAddr::V6(net), IpAddr::V6(ip)) => {
                prefix_eq(u128::from(net), u128::from(*ip), self.prefix, 128)
            }
            _ => false,
        }
    }

    fn is_single(&self, ip: &IpAddr) -> bool {
        self.network == *ip && self.prefix == if ip.is_ipv4() { 32 } else { 128 }
    }
}

/// Rejects resolved addresses at connect time, where the sync redirect callback cannot resolve DNS.
#[derive(Debug, Default, Clone)]
pub struct SsrfDnsResolver;

impl SsrfDnsResolver {
    async fn resolve_checked(
        host: &str,
        allowlist: &SsrfAllowlist,
    ) -> Result<Vec<SocketAddr>, Box<dyn std::error::Error + Send + Sync>> {
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, 0)).await?.collect();
        let cfg = crate::get_config();
        if cfg.common.skip_ssrf_checks {
            return Ok(addrs);
        }
        let host_allowed = allowlist.allows_host(host);
        for sa in &addrs {
            SsrfGuard::check_ip_inner(
                &sa.ip(),
                cfg.common.ssrf_allow_loopback,
                host_allowed,
                allowlist,
            )?;
        }
        Ok(addrs)
    }
}

impl Resolve for SsrfDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addrs = Self::resolve_checked(name.as_str(), &ALLOWLIST).await?;
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

/// Parses the allowlist now so invalid entries are reported at startup, not on first request.
pub fn init_allowlist() {
    LazyLock::force(&ALLOWLIST);
}

fn split_list(list: &str) -> impl Iterator<Item = &str> {
    list.split(',').map(str::trim).filter(|s| !s.is_empty())
}

/// An IPv4-mapped IPv6 address is matched as the IPv4 address it carries.
fn canonical_ip(ip: &IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(*ip, IpAddr::V4),
        IpAddr::V4(_) => *ip,
    }
}

fn is_metadata_ip(ip: &IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => v6
            .to_ipv4_mapped()
            .or_else(|| SsrfGuard::embedded_ipv4(v6))
            .map_or(*ip, IpAddr::V4),
        IpAddr::V4(_) => *ip,
    };
    METADATA_IPS.contains(&ip)
}

fn prefix_eq(a: u128, b: u128, prefix: u8, bits: u32) -> bool {
    let shift = bits - u32::from(prefix);
    shift >= bits || (a >> shift) == (b >> shift)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> SsrfAllowlist {
        SsrfAllowlist::default()
    }

    #[tokio::test]
    async fn test_allowed_cidr_admits_only_its_range() {
        let allow = SsrfAllowlist::parse("10.1.2.0/24", "");
        assert!(SsrfGuard::validate_url_inner("http://10.1.2.3/", false, false, &allow).is_ok());
        assert!(SsrfGuard::validate_url_inner("http://10.9.9.9/", false, false, &allow).is_err());
        let res =
            SsrfGuard::validate_url_async_inner("http://10.1.2.3/", false, false, &allow).await;
        assert!(res.is_ok(), "{res:?}");
        let res =
            SsrfGuard::validate_url_async_inner("http://10.9.9.9/", false, false, &allow).await;
        assert!(res.is_err());
        assert!(
            SsrfGuard::check_ip_inner(&"10.1.2.3".parse().unwrap(), false, false, &allow).is_ok()
        );
        assert!(
            SsrfGuard::check_ip_inner(&"::ffff:10.1.2.3".parse().unwrap(), false, false, &allow)
                .is_ok()
        );
        assert!(
            SsrfGuard::check_ip_inner(&"10.9.9.9".parse().unwrap(), false, false, &allow).is_err()
        );
    }

    #[tokio::test]
    async fn test_allowed_ipv6_cidr_admits_only_its_range() {
        let allow = SsrfAllowlist::parse("fd12:3456::/32", "");
        let res =
            SsrfGuard::validate_url_async_inner("http://[fd12:3456::1]/", false, false, &allow)
                .await;
        assert!(res.is_ok(), "{res:?}");
        let res =
            SsrfGuard::validate_url_async_inner("http://[fd99::1]/", false, false, &allow).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_resolver_honours_allowed_cidr() {
        let allow = SsrfAllowlist::parse("10.1.2.0/24", "");
        let res = SsrfDnsResolver::resolve_checked("10.1.2.3", &allow).await;
        assert_eq!(
            res.map_err(|e| e.to_string()).unwrap(),
            vec!["10.1.2.3:0".parse::<SocketAddr>().unwrap()]
        );
        assert!(
            SsrfDnsResolver::resolve_checked("10.9.9.9", &allow)
                .await
                .is_err()
        );
        assert!(
            SsrfDnsResolver::resolve_checked("10.1.2.3", &none())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn test_allowed_host_admits_its_private_resolution() {
        let allow = SsrfAllowlist::parse("", "LocalHost");
        let res =
            SsrfGuard::validate_url_async_inner("http://localhost/", false, false, &allow).await;
        assert!(res.is_ok(), "{res:?}");
        let res = SsrfDnsResolver::resolve_checked("localhost", &allow).await;
        assert!(res.is_ok(), "{:?}", res.map_err(|e| e.to_string()));
        let res =
            SsrfGuard::validate_url_async_inner("http://localhost/", false, false, &none()).await;
        assert!(res.is_err());
        assert!(
            SsrfDnsResolver::resolve_checked("localhost", &none())
                .await
                .is_err()
        );
    }

    #[test]
    fn test_allowed_host_still_blocks_metadata() {
        let allow = SsrfAllowlist::parse("169.254.0.0/16,fd00::/8", "metadata-proxy.example.com");
        for ip in [
            "169.254.169.254",
            "::ffff:169.254.169.254",
            "64:ff9b::a9fe:a9fe",
            "fd00:ec2::254",
        ] {
            let res = SsrfGuard::check_ip_inner(&ip.parse().unwrap(), false, true, &allow);
            assert!(res.is_err(), "{ip}");
        }
        assert!(
            SsrfGuard::check_ip_inner(&"10.0.0.1".parse().unwrap(), false, true, &allow).is_ok()
        );
        let exact = SsrfAllowlist::parse("169.254.169.254/32", "");
        assert!(
            SsrfGuard::check_ip_inner(&"169.254.169.254".parse().unwrap(), false, false, &exact)
                .is_ok()
        );
    }

    #[test]
    fn test_allowlist_skips_invalid_entries() {
        let allow = SsrfAllowlist::parse(
            " 10.0.0.0/33 ,not-a-cidr, fd00::/8 ,10.0.0.0/x,,192.168.1.7",
            "*.example.com, ok.example.com ,bad host,a/b",
        );
        assert_eq!(allow.cidrs.len(), 2, "{allow:?}");
        assert_eq!(allow.hosts, vec!["ok.example.com".to_string()]);
        assert!(allow.allows_ip(&"192.168.1.7".parse().unwrap()));
        assert!(!allow.allows_ip(&"192.168.1.8".parse().unwrap()));
        assert!(allow.allows_host("OK.example.com"));
        assert!(!allow.allows_host("sub.ok.example.com"));
    }

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
    fn test_embedded_ipv4_is_checked() {
        for ip in [
            "64:ff9b::a9fe:a9fe",
            "64:ff9b::7f00:1",
            "64:ff9b::a00:1",
            "2002:a9fe:a9fe::",
            "2002:7f00:1::1",
            "2002:c0a8:101::",
            "::a9fe:a9fe",
            "::10.0.0.1",
            "::127.0.0.1",
        ] {
            assert!(SsrfGuard::is_private_ip(&ip.parse().unwrap()), "{ip}");
        }
        for ip in ["64:ff9b::808:808", "2002:808:808::", "::8.8.8.8"] {
            assert!(!SsrfGuard::is_private_ip(&ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn test_ietf_protocol_assignments_block() {
        assert!(SsrfGuard::is_private_ip(&"192.0.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"192.0.0.170".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"192.0.1.1".parse().unwrap()));
    }

    #[tokio::test]
    async fn test_async_allow_loopback_still_blocks_private_and_metadata() {
        for url in [
            "http://127.0.0.1:5080/",
            "http://localhost/",
            "http://[::1]/",
        ] {
            let res = SsrfGuard::validate_url_async_inner(url, true, false, &none()).await;
            assert!(res.is_ok(), "{url}: {res:?}");
        }
        for url in [
            "http://10.0.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://metadata.google.internal/",
            "http://[fd00::1]/",
        ] {
            let res = SsrfGuard::validate_url_async_inner(url, true, false, &none()).await;
            assert!(res.is_err(), "{url} must be rejected");
        }
    }

    #[tokio::test]
    async fn test_async_allow_loopback_passes_unresolvable_host() {
        let unresolvable = "http://no-such-host.invalid/";
        let res = SsrfGuard::validate_url_async_inner(unresolvable, true, false, &none()).await;
        assert!(res.is_ok(), "{res:?}");
        let res =
            SsrfGuard::validate_url_async_inner("http://10.0.0.1/", true, false, &none()).await;
        assert!(res.is_err());
        let res =
            SsrfGuard::validate_url_async_inner("http://127.0.0.1/", true, false, &none()).await;
        assert!(res.is_ok(), "{res:?}");
        let res = SsrfGuard::validate_url_async_inner(unresolvable, false, false, &none()).await;
        assert!(
            res.is_err(),
            "the default path must still reject an unresolvable host"
        );
    }

    #[tokio::test]
    async fn test_async_skip_ssrf_allows_everything() {
        let res =
            SsrfGuard::validate_url_async_inner("http://169.254.169.254/", false, true, &none())
                .await;
        assert!(res.is_ok(), "{res:?}");
    }

    #[tokio::test]
    async fn test_safe_client_refuses_redirect_to_metadata() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = sock.read(&mut buf).await;
            let _ = sock
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data/\r\n\
                      Content-Length: 0\r\n\r\n",
                )
                .await;
        });
        let client = build_safe_client(
            reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)),
        )
        .unwrap();
        let err = client
            .get(format!("http://127.0.0.1:{port}/"))
            .send()
            .await
            .expect_err("redirect to the metadata address must be refused");
        assert!(err.is_redirect(), "{err:?}");
        let mut chain = String::new();
        let mut source: Option<&dyn std::error::Error> = Some(&err);
        while let Some(e) = source {
            chain.push_str(&e.to_string());
            source = e.source();
        }
        assert!(
            chain.contains("169.254.169.254") && chain.contains("not allowed"),
            "{chain}"
        );
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
