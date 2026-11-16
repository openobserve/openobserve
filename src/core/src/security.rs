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

use o2_enterprise::enterprise::security::{
    audit, intel::is_intel_list, streams::admits_security_read,
};

use crate::authz::{Denial, StreamAccessDenied};

/// Why writing or deleting a threat-intel list was refused.
pub const INTEL_LIST_REFUSED: &str = "Threat-intel lists need the Security write permission";

/// True when the user holds `method` on the org's `security` module; always true without RBAC.
pub async fn security_allowed(org_id: &str, user_id: &str, method: &str) -> bool {
    crate::auth::check_permissions(
        org_id, org_id, user_id, "security", method, None, true, false, false,
    )
    .await
}

/// True when the license grants Security, so its scoped reads stop with the feature.
pub fn security_licensed() -> bool {
    o2_enterprise::enterprise::license::check_features(&[config::meta::feature::Feature::Security])
}

/// Security read covers a logs stream someone chose as a Security source, without a stream grant.
pub async fn security_source_readable(org_id: &str, user_id: &str, stream_name: &str) -> bool {
    let licensed = security_licensed();
    if !licensed {
        return false;
    }
    let settings =
        infra::schema::get_settings(org_id, stream_name, config::meta::stream::StreamType::Logs)
            .await;
    if !source_admitted(
        licensed,
        settings.as_ref().and_then(|s| s.security.as_ref()),
    ) {
        return false;
    }
    security_allowed(org_id, user_id, "GET").await
}

/// Drops the stream denials Security read covers, so only streams outside the sources remain.
pub async fn admit_security_sources(
    user_id: &str,
    denied: StreamAccessDenied,
) -> Result<(), StreamAccessDenied> {
    let mut left = Vec::with_capacity(denied.denials.len());
    for denial in denied.denials {
        let covered = match &denial {
            Denial::Stream(s) => {
                s.stream_type == config::meta::stream::StreamType::Logs
                    && security_source_readable(&s.org_id, user_id, &s.name).await
            }
            _ => false,
        };
        if !covered {
            left.push(denial);
        }
    }
    if left.is_empty() {
        Ok(())
    } else {
        Err(StreamAccessDenied { denials: left })
    }
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

fn source_admitted(
    licensed: bool,
    setting: Option<&config::meta::stream::SecuritySourceSetting>,
) -> bool {
    licensed && admits_security_read(setting)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_an_unlicensed_or_classifier_only_source_admits_no_reader() {
        use config::meta::stream::{SecuritySourceSetting, SecurityVerdict};

        let auto = SecuritySourceSetting {
            verdict: Some(SecurityVerdict::Auto),
            ..Default::default()
        };
        let included = SecuritySourceSetting {
            included: Some(true),
            ..Default::default()
        };
        assert!(!source_admitted(true, Some(&auto)));
        assert!(source_admitted(true, Some(&included)));
        assert!(!source_admitted(false, Some(&included)));
        assert!(!source_admitted(true, None));
    }

    #[tokio::test]
    async fn test_only_intel_lists_need_the_security_grant() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        assert!(intel_list_write_allowed("org", &stranger, "geo_lookup", "POST").await);
        assert!(!intel_list_write_allowed("org", &stranger, "ioc_bad_ips", "POST").await);
    }
}
