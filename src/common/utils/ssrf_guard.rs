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
    /// Check if a URL is safe to request (not an SSRF attempt)
    ///
    /// # Arguments
    /// * `url` - The URL to validate
    ///
    /// # Returns
    /// * `Ok(())` if the URL is safe
    /// * `Err(String)` with error message if the URL is potentially dangerous
    pub fn validate_url(url: &str) -> Result<(), String> {
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

        // Check if host is an IP address
        if let Ok(ip_addr) = host.parse::<IpAddr>() {
            // Block private IP ranges to prevent SSRF
            if Self::is_private_ip(&ip_addr) {
                return Err(format!(
                    "Access to private IP address {} is not allowed for security reasons. \
                     This prevents Server-Side Request Forgery (SSRF) attacks.",
                    ip_addr
                ));
            }
        } else {
            // It's a hostname - check for localhost and internal domains
            let lower_host = host.to_lowercase();

            // Block localhost variations
            if lower_host == "localhost"
                || lower_host.starts_with("localhost.")
                || lower_host == "127.0.0.1"
                || lower_host == "[::1]"
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

    /// Check if an IP address is in a private/reserved range
    fn is_private_ip(ip: &IpAddr) -> bool {
        match ip {
            IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();

                // Private networks (RFC 1918)
                // 10.0.0.0/8
                (octets[0] == 10) ||
                // 172.16.0.0/12
                (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
                // 192.168.0.0/16
                (octets[0] == 192 && octets[1] == 168) ||

                // Loopback (127.0.0.0/8) - already covered but explicit is better
                (octets[0] == 127) ||

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
                let segments = ipv6.segments();

                // Loopback (::1)
                (ipv6.is_loopback()) ||

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

        // Public IPs should not be private
        assert!(!SsrfGuard::is_private_ip(&"8.8.8.8".parse().unwrap()));
        assert!(!SsrfGuard::is_private_ip(&"1.1.1.1".parse().unwrap()));
    }
}
