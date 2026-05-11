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

use std::net::IpAddr;

/// SSRF (Server-Side Request Forgery) protection utilities
///
/// This module provides utilities to prevent SSRF attacks by validating URLs
/// and blocking requests to private/internal IP ranges.
///
/// This guard can be used anywhere in the codebase to validate URLs before
/// making HTTP requests to prevent SSRF attacks.
///
/// # Example
///
/// ```rust
/// use crate::common::utils::ssrf_guard::SsrfGuard;
///
/// fn fetch_url(url: &str) -> Result<String, String> {
///     // Validate URL is safe before making request
///     SsrfGuard::validate_url(url)?;
///
///     // Now safe to make HTTP request
///     // ... make request ...
/// }
/// ```
pub struct SsrfGuard;

impl SsrfGuard {
    /// Check if a URL is safe to request (not an SSRF attempt), reading the
    /// `ZO_SSRF_ALLOW_LOOPBACK` config flag to decide whether loopback/localhost
    /// destinations are permitted.
    ///
    /// Use this at all alert/destination call sites so that the allow-loopback
    /// escape-hatch is honoured consistently.
    pub fn validate_url_with_config(url: &str) -> Result<(), String> {
        let allow_loopback = config::get_config().common.ssrf_allow_loopback;
        Self::validate_url_inner(url, allow_loopback)
    }

    /// Check if a URL is safe to request (not an SSRF attempt).
    ///
    /// Loopback/localhost is always blocked.  For a config-aware version that
    /// respects `ZO_SSRF_ALLOW_LOOPBACK`, use [`validate_url_with_config`].
    ///
    /// # Arguments
    /// * `url` - The URL to validate
    ///
    /// # Returns
    /// * `Ok(())` if the URL is safe
    /// * `Err(String)` with error message if the URL is potentially dangerous
    pub fn validate_url(url: &str) -> Result<(), String> {
        Self::validate_url_inner(url, false)
    }

    fn validate_url_inner(url: &str, allow_loopback: bool) -> Result<(), String> {
        // Parse the URL
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

        // Only allow HTTP and HTTPS
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err(format!(
                "Unsupported URL scheme: {}. Only HTTP and HTTPS are allowed.",
                parsed.scheme()
            ));
        }

        // Get the hostname
        let host = parsed
            .host_str()
            .ok_or_else(|| "URL must have a valid host".to_string())?;

        // Check if host is an IP address.
        // The url crate (some versions) returns bracketed IPv6 like "[::1]" from host_str().
        // Strip brackets so the IP can be parsed by Rust's IpAddr.
        let unbracketed_host = if host.starts_with('[') && host.ends_with(']') {
            &host[1..host.len() - 1]
        } else {
            host
        };

        if let Ok(ip_addr) = unbracketed_host.parse::<IpAddr>() {
            // Block private IP ranges to prevent SSRF
            if Self::is_private_ip_inner(&ip_addr, allow_loopback) {
                return Err(format!(
                    "Access to private IP address {} is not allowed for security reasons. \
                     This prevents Server-Side Request Forgery (SSRF) attacks.",
                    ip_addr
                ));
            }
        } else {
            // It's a hostname - check for localhost and internal domains
            let lower_host = host.to_lowercase();

            // Block localhost variations (unless loopback is explicitly allowed)
            if !allow_loopback
                && (lower_host == "localhost"
                    || lower_host.starts_with("localhost.")
                    || lower_host == "127.0.0.1")
            {
                return Err("Access to localhost is not allowed for security reasons".to_string());
            }

            // Block internal domains
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

            // Block cloud metadata endpoints
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

    /// Check if an IP address is in a private/reserved range (loopback always blocked).
    /// Used by unit tests; production call sites use `is_private_ip_inner`.
    #[cfg(test)]
    fn is_private_ip(ip: &IpAddr) -> bool {
        Self::is_private_ip_inner(ip, false)
    }

    /// Core private-IP check.  When `allow_loopback` is true, the 127.0.0.0/8
    /// and ::1 ranges are not treated as blocked so that single-node/test
    /// deployments can use loopback destinations.
    fn is_private_ip_inner(ip: &IpAddr, allow_loopback: bool) -> bool {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();

                // Loopback (127.0.0.0/8) — skip when explicitly allowed
                (!allow_loopback && octets[0] == 127) ||

                // Private networks (RFC 1918)
                // 10.0.0.0/8
                (octets[0] == 10) ||
                // 172.16.0.0/12
                (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
                // 192.168.0.0/16
                (octets[0] == 192 && octets[1] == 168) ||

                // Link-local (169.254.0.0/16)
                (octets[0] == 169 && octets[1] == 254) ||

                // Carrier-grade NAT (100.64.0.0/10)
                (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127) ||

                // Documentation/test networks
                // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
                (octets[0] == 192 && octets[1] == 0 && octets[2] == 2) ||
                (octets[0] == 198 && octets[1] == 51 && octets[2] == 100) ||
                (octets[0] == 203 && octets[1] == 0 && octets[2] == 113) ||

                // Benchmark/tests
                // 198.18.0.0/15
                (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)) ||

                // Reserved for future use
                // 240.0.0.0/4 (except 255.255.255.255)
                (octets[0] >= 240 && !(octets[0] == 255 && octets[1] == 255 && octets[2] == 255 && octets[3] == 255))
            }
            IpAddr::V6(ipv6) => {
                // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — re-check as IPv4
                if let Some(v4) = ipv6.to_ipv4_mapped() {
                    return Self::is_private_ip_inner(&IpAddr::V4(v4), allow_loopback);
                }

                let segments = ipv6.segments();

                // Loopback (::1) — skip when explicitly allowed
                (!allow_loopback && ipv6.is_loopback()) ||

                // Link-local (fe80::/10)
                (segments[0] & 0xffc0) == 0xfe80 ||

                // Unique local addresses (fc00::/7)
                (segments[0] & 0xfe00) == 0xfc00 ||

                // Documentation (2001:db8::/32)
                (segments[0] == 0x2001 && segments[1] == 0xdb8)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_safe_urls() {
        // Safe external URLs should pass
        assert!(SsrfGuard::validate_url("https://hooks.slack.com/services/xyz").is_ok());
        assert!(SsrfGuard::validate_url("https://example.com/webhook").is_ok());
        assert!(SsrfGuard::validate_url("http://example.com/webhook").is_ok());
    }

    #[test]
    fn test_block_private_ipv4() {
        // Private IP ranges should be blocked
        assert!(SsrfGuard::validate_url("http://10.0.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://10.255.255.255/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://172.16.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://172.31.255.255/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://192.168.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://192.168.255.255/webhook").is_err());
    }

    #[test]
    fn test_block_localhost() {
        // Localhost should be blocked
        assert!(SsrfGuard::validate_url("http://localhost/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://localhost:8080/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://127.0.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::1]/webhook").is_err());
    }

    #[test]
    fn test_block_metadata_endpoints() {
        // Cloud metadata endpoints should be blocked
        assert!(SsrfGuard::validate_url("http://169.254.169.254/latest/meta-data/").is_err());
        assert!(
            SsrfGuard::validate_url("http://metadata.google.internal/computeMetadata/v1/").is_err()
        );
        assert!(SsrfGuard::validate_url("http://metadata/computeMetadata/v1/").is_err());
    }

    #[test]
    fn test_block_internal_domains() {
        // Internal domains should be blocked
        assert!(SsrfGuard::validate_url("http://service.internal/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://service.local/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://service.localdomain/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://service.lan/webhook").is_err());
    }

    #[test]
    fn test_block_unsupported_protocols() {
        // Non-HTTP protocols should be blocked
        assert!(SsrfGuard::validate_url("ftp://example.com/webhook").is_err());
        assert!(SsrfGuard::validate_url("file:///etc/passwd").is_err());
        assert!(SsrfGuard::validate_url("gopher://example.com").is_err());
    }

    #[test]
    fn test_is_private_ip() {
        // Test private IP detection
        assert!(SsrfGuard::is_private_ip(&"10.0.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"192.168.1.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"172.16.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"127.0.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"169.254.1.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"::1".parse().unwrap()));

        // IPv4-mapped IPv6 addresses must also be blocked (SSRF bypass vector)
        assert!(SsrfGuard::is_private_ip(
            &"::ffff:127.0.0.1".parse().unwrap()
        ));
        assert!(SsrfGuard::is_private_ip(
            &"::ffff:10.0.0.1".parse().unwrap()
        ));
        assert!(SsrfGuard::is_private_ip(
            &"::ffff:192.168.1.1".parse().unwrap()
        ));

        // Public IPs should not be private
        assert!(!SsrfGuard::is_private_ip(&"8.8.8.8".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn test_invalid_url_returns_err() {
        assert!(SsrfGuard::validate_url("not a url").is_err());
        assert!(SsrfGuard::validate_url("").is_err());
    }

    #[test]
    fn test_block_carrier_grade_nat() {
        assert!(SsrfGuard::validate_url("http://100.64.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://100.127.255.255/webhook").is_err());
    }

    #[test]
    fn test_carrier_grade_nat_is_private_ip() {
        assert!(SsrfGuard::is_private_ip(&"100.64.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(
            &"100.127.255.255".parse().unwrap()
        ));
        // 100.128.0.1 is not in carrier-grade NAT range
        assert!(!SsrfGuard::is_private_ip(&"100.128.0.1".parse().unwrap()));
    }

    #[test]
    fn test_block_documentation_ips() {
        assert!(SsrfGuard::validate_url("http://192.0.2.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://198.51.100.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://203.0.113.1/webhook").is_err());
    }

    #[test]
    fn test_documentation_ips_are_private() {
        assert!(SsrfGuard::is_private_ip(&"192.0.2.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"198.51.100.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"203.0.113.1".parse().unwrap()));
    }

    #[test]
    fn test_block_benchmark_ips() {
        assert!(SsrfGuard::validate_url("http://198.18.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://198.19.255.255/webhook").is_err());
    }

    #[test]
    fn test_benchmark_ips_are_private() {
        assert!(SsrfGuard::is_private_ip(&"198.18.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"198.19.0.1".parse().unwrap()));
    }

    #[test]
    fn test_validate_url_with_config_safe_url() {
        // validate_url_with_config reads ssrf_allow_loopback from config (default false)
        // A safe external URL should pass
        let result = SsrfGuard::validate_url_with_config("https://example.com/webhook");
        assert!(result.is_ok());
    }

    #[test]
    fn test_block_host_containing_local_in_middle() {
        // .contains(".local.") branch — subdomain with .local. in the middle
        assert!(SsrfGuard::validate_url("http://svc.local.cluster.example.com/webhook").is_err());
    }

    #[test]
    fn test_ipv6_loopback_is_private() {
        // ::1 is loopback; is_private_ip uses allow_loopback=false so it IS private
        assert!(SsrfGuard::is_private_ip(
            &"::1".parse::<std::net::IpAddr>().unwrap()
        ));
    }

    #[test]
    fn test_block_reserved_ips() {
        assert!(SsrfGuard::validate_url("http://240.0.0.1/webhook").is_err());
        // 255.255.255.255 is broadcast, not blocked by this implementation
        assert!(SsrfGuard::validate_url("http://255.255.255.255/webhook").is_ok());
    }

    #[test]
    fn test_reserved_ips_are_private() {
        assert!(SsrfGuard::is_private_ip(&"240.0.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"254.0.0.1".parse().unwrap()));
        // 255.255.255.255 (broadcast) is not considered private per this impl
        assert!(!SsrfGuard::is_private_ip(
            &"255.255.255.255".parse().unwrap()
        ));
    }

    #[test]
    fn test_172_boundary() {
        // 172.15.x is public, 172.16.x is private, 172.31.x is private, 172.32.x is public
        assert!(!SsrfGuard::is_private_ip(
            &"172.15.255.255".parse().unwrap()
        ));
        assert!(SsrfGuard::is_private_ip(&"172.16.0.1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"172.31.255.255".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"172.32.0.1".parse().unwrap()));
    }

    #[test]
    fn test_block_ipv6_special_ranges() {
        // IPv6 link-local (fe80::/10)
        assert!(SsrfGuard::validate_url("http://[fe80::1]/webhook").is_err());
        // IPv6 unique local (fc00::/7)
        assert!(SsrfGuard::validate_url("http://[fc00::1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[fd00::1]/webhook").is_err());
        // IPv6 documentation (2001:db8::/32)
        assert!(SsrfGuard::validate_url("http://[2001:db8::1]/webhook").is_err());
    }

    #[test]
    fn test_ipv6_special_ranges_are_private() {
        assert!(SsrfGuard::is_private_ip(&"fe80::1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"fc00::1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"fd00::1".parse().unwrap()));
        assert!(SsrfGuard::is_private_ip(&"2001:db8::1".parse().unwrap()));
        // Regular public IPv6 should not be private
        assert!(!SsrfGuard::is_private_ip(&"2606:4700::1".parse().unwrap()));
    }

    #[test]
    fn test_localhost_subdomain_blocked() {
        assert!(SsrfGuard::validate_url("http://localhost.internal/webhook").is_err());
    }

    #[test]
    fn test_block_ipv4_mapped_ipv6() {
        // IPv4-mapped IPv6 must be blocked to prevent SSRF bypass (NEW-001)
        assert!(SsrfGuard::validate_url("http://[::ffff:127.0.0.1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::ffff:10.0.0.1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::ffff:192.168.1.1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::ffff:169.254.169.254]/webhook").is_err());
    }
}
