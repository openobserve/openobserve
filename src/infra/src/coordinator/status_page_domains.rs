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

//! The cluster event of custom domain certificates: one key per hostname. A node that receives it
//! reloads that hostname from the primary and drops the entry when no certificate or holder
//! remains.

use crate::errors::Error;

pub const CERT_KEY_PREFIX: &str = "/status_page_domains/cert/";

/// A certificate row for `hostname` was written or deleted, or its holder changed.
pub async fn emit_cert_changed(hostname: &str) -> Result<(), Error> {
    super::emit_put(&cert_key(hostname)).await
}

/// The hostname an event key names, or `None` for a key outside the prefix.
pub fn hostname_of(key: &str) -> Option<&str> {
    key.strip_prefix(CERT_KEY_PREFIX)
        .filter(|hostname| !hostname.is_empty())
}

fn cert_key(hostname: &str) -> String {
    format!("{CERT_KEY_PREFIX}{hostname}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_carries_the_hostname_and_only_this_prefix_names_one() {
        let key = cert_key("status.example.com");

        assert_eq!(key, "/status_page_domains/cert/status.example.com");
        assert_eq!(hostname_of(&key), Some("status.example.com"));
        assert_eq!(hostname_of("/status_page_domains/cert/"), None);
        assert_eq!(hostname_of("/synthetics/check/a/b"), None);
    }
}
