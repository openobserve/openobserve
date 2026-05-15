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

//! Re-export of the SSRF guard from the `config` crate so OSS call sites that
//! already import from `crate::common::utils::ssrf_guard` keep compiling. The
//! canonical implementation lives in `config::utils::ssrf_guard` so that
//! `o2-enterprise` (which depends on `config`, not on the top-level
//! `openobserve` crate) can use the same primitives.

pub use config::utils::ssrf_guard::{SsrfDnsResolver, SsrfGuard, build_safe_client};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_safe_urls() {
        assert!(SsrfGuard::validate_url("https://hooks.slack.com/services/xyz").is_ok());
        assert!(SsrfGuard::validate_url("https://example.com/webhook").is_ok());
        assert!(SsrfGuard::validate_url("http://example.com/webhook").is_ok());
    }

    #[test]
    fn test_block_private_ipv4() {
        assert!(SsrfGuard::validate_url("http://10.0.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://10.255.255.255/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://172.16.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://172.31.255.255/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://192.168.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://192.168.255.255/webhook").is_err());
    }

    #[test]
    fn test_block_localhost() {
        assert!(SsrfGuard::validate_url("http://localhost/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://localhost:8080/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://127.0.0.1/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::1]/webhook").is_err());
    }

    #[test]
    fn test_block_metadata_endpoints() {
        assert!(SsrfGuard::validate_url("http://169.254.169.254/latest/meta-data/").is_err());
        assert!(
            SsrfGuard::validate_url("http://metadata.google.internal/computeMetadata/v1/").is_err()
        );
        assert!(SsrfGuard::validate_url("http://metadata/computeMetadata/v1/").is_err());
    }

    #[test]
    fn test_block_unsupported_protocols() {
        assert!(SsrfGuard::validate_url("ftp://example.com/webhook").is_err());
        assert!(SsrfGuard::validate_url("file:///etc/passwd").is_err());
        assert!(SsrfGuard::validate_url("gopher://example.com").is_err());
    }

    #[test]
    fn test_block_ipv6_special_ranges() {
        assert!(SsrfGuard::validate_url("http://[fe80::1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[fc00::1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[fd00::1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[2001:db8::1]/webhook").is_err());
    }

    #[test]
    fn test_block_ipv4_mapped_ipv6() {
        assert!(SsrfGuard::validate_url("http://[::ffff:127.0.0.1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::ffff:10.0.0.1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::ffff:192.168.1.1]/webhook").is_err());
        assert!(SsrfGuard::validate_url("http://[::ffff:169.254.169.254]/webhook").is_err());
    }
}
