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

use std::{collections::HashSet, future::Future};

use config::meta::stream::{SecuritySourceSetting, StreamType};
use o2_enterprise::enterprise::security::{
    audit, intel::is_intel_list, streams::admits_security_read,
};

use crate::authz::{
    Denial, StreamAccessChecker, StreamAccessDenied,
    list::{AuthzUnavailable, OrgWideCheck},
};

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

pub async fn admit_security_sources_once(
    checker: &dyn StreamAccessChecker,
    org_id: &str,
    user_id: &str,
    denied: Vec<String>,
) -> Result<HashSet<String>, AuthzUnavailable> {
    admit_security_sources_once_with(
        checker,
        org_id,
        user_id,
        denied,
        security_licensed(),
        |name| async move {
            infra::schema::get_settings(org_id, &name, StreamType::Logs)
                .await
                .and_then(|settings| settings.security.clone())
        },
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

async fn admit_security_sources_once_with<F: Future<Output = Option<SecuritySourceSetting>>>(
    checker: &dyn StreamAccessChecker,
    org_id: &str,
    user_id: &str,
    denied: Vec<String>,
    licensed: bool,
    mut settings: impl FnMut(String) -> F,
) -> Result<HashSet<String>, AuthzUnavailable> {
    let mut admitted = HashSet::new();
    if !licensed {
        return Ok(admitted);
    }
    for name in denied {
        let setting = settings(name.clone()).await;
        if source_admitted(licensed, setting.as_ref()) {
            admitted.insert(name);
        }
    }
    if admitted.is_empty() {
        return Ok(admitted);
    }
    let check = OrgWideCheck {
        resource: "security",
        permission: "GET",
        use_all_org: true,
        use_self_context: false,
        use_self_parent: false,
    };
    if !checker.org_wide_check(user_id, org_id, &check).await? {
        admitted.clear();
    }
    Ok(admitted)
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
    use crate::authz::{
        FakeStreamChecker,
        list::{ListMode, SITE_SECURITY_SOURCES, StreamSet, UnavailableReason, stream_answers},
        within_budget,
    };

    #[tokio::test]
    async fn test_two_thousand_security_sources_need_one_security_get() {
        let checker = FakeStreamChecker::default();
        checker.grant_org_wide_check("analyst", "org", "security");
        let names: Vec<_> = (0..2_000).map(|i| format!("source_{i}")).collect();
        let admitted = within_budget(
            1,
            admit_security_sources_once_with(
                &checker,
                "org",
                "analyst",
                names.clone(),
                true,
                |_| async {
                    Some(SecuritySourceSetting {
                        included: Some(true),
                        ..Default::default()
                    })
                },
            ),
        )
        .await
        .unwrap();
        assert_eq!(admitted, names.into_iter().collect());
        assert_eq!(checker.calls("analyst").org_wide_checks, 1);
        assert_eq!(checker.calls("analyst").object_checks, 0);
    }

    #[tokio::test]
    async fn test_unlicensed_sources_skip_settings_and_security_get() {
        let checker = FakeStreamChecker::default();
        checker.grant_org_wide_check("analyst", "org", "security");
        let admitted = admit_security_sources_once_with(
            &checker,
            "org",
            "analyst",
            vec!["source".to_string()],
            false,
            |_| async { panic!("an unlicensed request must not read settings") },
        )
        .await
        .unwrap();
        assert!(admitted.is_empty());
        assert_eq!(checker.calls("analyst").org_wide_checks, 0);
    }

    #[tokio::test]
    async fn test_unconfigured_sources_skip_security_get() {
        let checker = FakeStreamChecker::default();
        checker.grant_org_wide_check("analyst", "org", "security");
        let admitted = admit_security_sources_once_with(
            &checker,
            "org",
            "analyst",
            vec!["missing".to_string(), "classifier_only".to_string()],
            true,
            |name| async move { (name == "classifier_only").then(SecuritySourceSetting::default) },
        )
        .await
        .unwrap();
        assert!(admitted.is_empty());
        assert_eq!(checker.calls("analyst").org_wide_checks, 0);
    }

    #[tokio::test]
    async fn test_security_get_error_propagates() {
        let checker = FakeStreamChecker::default();
        checker.fail_org_wide_check_once("analyst", UnavailableReason::Transport);
        let admitted = admit_security_sources_once_with(
            &checker,
            "org",
            "analyst",
            vec!["source".to_string()],
            true,
            |_| async {
                Some(SecuritySourceSetting {
                    included: Some(true),
                    ..Default::default()
                })
            },
        )
        .await;
        assert_eq!(admitted, Err(UnavailableReason::Transport.into()));
        assert_eq!(checker.calls("analyst").org_wide_checks, 1);
    }

    #[tokio::test]
    async fn test_security_get_denial_admits_no_sources() {
        let checker = FakeStreamChecker::default();
        let admitted = admit_security_sources_once_with(
            &checker,
            "org",
            "analyst",
            vec!["source".to_string()],
            true,
            |_| async {
                Some(SecuritySourceSetting {
                    included: Some(true),
                    ..Default::default()
                })
            },
        )
        .await
        .unwrap();
        assert!(admitted.is_empty());
        assert_eq!(checker.calls("analyst").org_wide_checks, 1);
    }

    #[tokio::test]
    async fn test_security_sources_new_path_within_five_calls() {
        let checker = FakeStreamChecker::default();
        checker.set_list_mode("analyst", ListMode::On);
        checker.grant_org_wide_check("analyst", "org", "security");
        let requested: StreamSet = (0..2_000)
            .map(|i| (StreamType::Logs, format!("source_{i}")))
            .collect();
        let readable = within_budget(5, async {
            let (readable, _) = stream_answers(
                &checker,
                SITE_SECURITY_SOURCES,
                "analyst",
                "org",
                &requested,
                &[StreamType::Logs],
            )
            .await
            .unwrap();
            let mut readable = readable.unwrap();
            let denied = requested
                .difference(&readable)
                .map(|(_, name)| name.clone())
                .collect();
            let admitted = admit_security_sources_once_with(
                &checker,
                "org",
                "analyst",
                denied,
                true,
                |_| async {
                    Some(SecuritySourceSetting {
                        included: Some(true),
                        ..Default::default()
                    })
                },
            )
            .await
            .unwrap();
            readable.extend(admitted.into_iter().map(|name| (StreamType::Logs, name)));
            readable
        })
        .await;
        assert_eq!(readable, requested);
        assert_eq!(checker.calls("analyst").total(), 5);
        assert_eq!(checker.calls("analyst").org_wide_checks, 1);
        assert_eq!(checker.calls("analyst").object_checks, 0);
    }

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
