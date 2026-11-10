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

//! Security (SIEM) permission checks shared by the API crates.

use o2_enterprise::enterprise::security::{audit, intel::is_intel_list};

/// Why writing or deleting a threat-intel list was refused.
pub const INTEL_LIST_REFUSED: &str = "Threat-intel lists need the Security write permission";

/// True when the user holds `method` on the org's `security` module; always true without RBAC.
pub async fn security_allowed(org_id: &str, user_id: &str, method: &str) -> bool {
    crate::auth::check_permissions(
        org_id, org_id, user_id, "security", method, None, true, false, false,
    )
    .await
}

/// A threat-intel list write (`POST`) or delete (`DELETE`) also needs that Security grant.
pub async fn intel_list_write_allowed(
    org_id: &str,
    user_id: &str,
    table: &str,
    method: &str,
) -> bool {
    if !is_intel_list(table) {
        return true;
    }
    if !security_allowed(org_id, user_id, method).await {
        return false;
    }
    audit::mark();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_only_intel_lists_need_the_security_grant() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        assert!(intel_list_write_allowed("org", &stranger, "geo_lookup", "POST").await);
        assert!(!intel_list_write_allowed("org", &stranger, "ioc_bad_ips", "POST").await);
    }
}
