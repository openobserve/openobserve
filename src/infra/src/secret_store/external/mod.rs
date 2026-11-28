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

pub mod cache;
pub mod limits;
pub mod pointer;
pub mod readiness;
pub mod transport;

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
};

use config::meta::secret_store::{
    SecretErrorCode,
    external::{
        AuthMode, BackendKind, DisabledBackend, ExternalSecretBackend, Pointer, VersionSelector,
        validate_region,
    },
};
use parking_lot::RwLock;
pub use pointer::{P1E1_RELEASE, PointerWrite, write_pointer_in};

use crate::table::secret_backends;

static BACKENDS: LazyLock<RwLock<HashMap<BackendKind, Arc<dyn ExternalSecretBackend>>>> =
    LazyLock::new(Default::default);

pub fn register_backend(kind: BackendKind, backend: Arc<dyn ExternalSecretBackend>) {
    assert_eq!(kind, backend.kind(), "provider registry kind mismatch");
    BACKENDS.write().insert(kind, backend);
}

pub fn lookup_backend(kind: BackendKind) -> Arc<dyn ExternalSecretBackend> {
    BACKENDS
        .read()
        .get(&kind)
        .cloned()
        .unwrap_or_else(|| Arc::new(DisabledBackend(kind)))
}

pub fn admit_auth_mode(
    kind: BackendKind,
    mode: AuthMode,
    admitted: &[AuthMode],
    cloud: bool,
) -> Result<(), SecretErrorCode> {
    if !admitted.contains(&mode) {
        return Err(SecretErrorCode::AuthModeNotEnabled);
    }
    match mode {
        AuthMode::Static => Ok(()),
        AuthMode::Mapped if cloud || kind == BackendKind::AwsSm => Ok(()),
        AuthMode::RegionIssuer if cloud => Ok(()),
        AuthMode::Mapped | AuthMode::RegionIssuer => Err(SecretErrorCode::AuthModeNotEnabled),
    }
}

pub fn require_region_for(mode: AuthMode, region: &str) -> Result<(), SecretErrorCode> {
    if mode == AuthMode::Static || validate_region(region) {
        Ok(())
    } else {
        Err(SecretErrorCode::SecretStoreRegionUnset)
    }
}

pub fn check_locator(
    backend: &secret_backends::Model,
    kind: BackendKind,
    pointer: &Pointer,
) -> Result<(), SecretErrorCode> {
    let denied = SecretErrorCode::SecretUseDenied;
    if backend.id != pointer.backend_id || backend.kind != kind.as_str() {
        return Err(denied);
    }
    let settings: serde_json::Value = serde_json::from_str(&backend.config).map_err(|_| denied)?;
    let prefixes: Vec<String> = serde_json::from_str(&backend.path_prefixes).map_err(|_| denied)?;
    let locator = pointer.locator.as_str();
    let selector = &pointer.version_selector;
    let allowed = match kind {
        BackendKind::AwsSm => {
            let name = aws_name(locator, &settings).ok_or(denied)?;
            let version_ok = match selector {
                VersionSelector::Latest => true,
                VersionSelector::Stage(stage) => stage.len() <= 256 && valid_segment(stage),
                VersionSelector::Id(id) => (32..=64).contains(&id.len()) && valid_segment(id),
            };
            version_ok
                && name.split('/').all(valid_segment)
                && prefixes.iter().any(|prefix| {
                    let path = prefix.strip_suffix('/').unwrap_or(prefix);
                    path.split('/').all(valid_segment) && prefix_matches(name, prefix, '/')
                })
        }
        BackendKind::GcpSm => {
            let name = gcp_name(locator, &settings, selector).ok_or(denied)?;
            valid_segment(name)
                && prefixes
                    .iter()
                    .any(|prefix| valid_segment(prefix) && prefix_matches(name, prefix, '-'))
        }
        BackendKind::AzureKv => {
            let version_ok = match selector {
                VersionSelector::Latest => true,
                VersionSelector::Id(version) => version.len() == 32 && valid_segment(version),
                VersionSelector::Stage(_) => false,
            };
            version_ok
                && azure_name(locator)
                && prefixes
                    .iter()
                    .any(|prefix| azure_name(prefix) && prefix_matches(locator, prefix, '-'))
        }
    };
    if allowed { Ok(()) } else { Err(denied) }
}

fn aws_name<'a>(locator: &'a str, settings: &serde_json::Value) -> Option<&'a str> {
    let mut parts = locator.splitn(7, ':');
    let [
        arn,
        partition,
        service,
        region,
        account,
        resource,
        full_name,
    ] = std::array::from_fn(|_| parts.next().unwrap_or(""));
    let (name, suffix) = full_name.rsplit_once('-')?;
    (arn == "arn"
        && service == "secretsmanager"
        && resource == "secret"
        && matches!(partition, "aws" | "aws-cn")
        && Some(partition) == settings.get("partition")?.as_str()
        && valid_segment(region)
        && Some(region) == settings.get("region")?.as_str()
        && account.len() == 12
        && account.bytes().all(|c| c.is_ascii_digit())
        && Some(account) == settings.get("account")?.as_str()
        && suffix.len() == 6
        && suffix.bytes().all(|c| c.is_ascii_alphanumeric()))
    .then_some(name)
}

fn gcp_name<'a>(
    locator: &'a str,
    settings: &serde_json::Value,
    selector: &VersionSelector,
) -> Option<&'a str> {
    let mut parts = locator.split('/');
    let [projects, project, secrets, name, versions, version] =
        std::array::from_fn(|_| parts.next().unwrap_or(""));
    let version_ok = match selector {
        VersionSelector::Latest => version == "latest",
        VersionSelector::Id(id) => {
            id == version
                && !version.is_empty()
                && !version.starts_with('0')
                && version.bytes().all(|c| c.is_ascii_digit())
        }
        VersionSelector::Stage(_) => false,
    };
    (parts.next().is_none()
        && projects == "projects"
        && secrets == "secrets"
        && versions == "versions"
        && valid_segment(project)
        && Some(project) == settings.get("project_id")?.as_str()
        && version_ok)
        .then_some(name)
}

fn azure_name(name: &str) -> bool {
    (1..=127).contains(&name.len()) && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn prefix_matches(name: &str, prefix: &str, separator: char) -> bool {
    name.strip_prefix(prefix).is_some_and(|rest| {
        rest.is_empty() || prefix.ends_with(separator) || rest.starts_with(separator)
    })
}

fn valid_segment(segment: &str) -> bool {
    !matches!(segment, "" | "." | "..")
        && segment
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn backend(kind: BackendKind, settings: Value, prefix: &str) -> secret_backends::Model {
        secret_backends::Model {
            id: "backend".into(),
            org_id: "org".into(),
            kind: kind.as_str().into(),
            name: "primary".into(),
            description: String::new(),
            config: settings.to_string(),
            path_prefixes: json!([prefix]).to_string(),
            auth_mode: "static".into(),
            cred_ref: None,
            credential_rev: String::new(),
            state: "active".into(),
            backend_rev: "revision".into(),
            ttl_secs: 60,
            stale_max_secs: 120,
            created_by: "actor".into(),
            updated_by: "actor".into(),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn permitted(
        backend: &secret_backends::Model,
        locator: &str,
        selector: VersionSelector,
    ) -> bool {
        let pointer = Pointer {
            backend_id: backend.id.clone(),
            locator: locator.into(),
            version_selector: selector,
            json_key: None,
        };
        check_locator(backend, backend.kind.parse().unwrap(), &pointer).is_ok()
    }

    #[test]
    fn aws_requires_full_arn_in_the_backend_account_region_partition_and_prefix() {
        use VersionSelector::{Id, Latest, Stage};

        let backend = backend(
            BackendKind::AwsSm,
            json!({
                "region":"us-east-1", "account":"123456789012", "partition":"aws"
            }),
            "team/",
        );
        let arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:team/ops/x-Ab12Cd";
        for selector in [
            Latest,
            Stage("AWSCURRENT".into()),
            Id("7e46c60f7f744c3b913664879537a66f".into()),
        ] {
            assert!(permitted(&backend, arn, selector));
        }
        for locator in [
            arn.replace("aws:", "aws-cn:"),
            arn.replace("us-east-1", "us-west-1"),
            arn.replace("123456789012", "123456789013"),
            arn.replace("team/ops", "team/../ops"),
            arn.replace("team/ops", "team%2F..%2Fops"),
            arn.replace("team/ops", "teamx/ops"),
            arn.replace("team/ops", "team//ops"),
            arn.replace("team/ops", "team/ ops"),
            arn.replace("team/ops", r"team\ops"),
            arn.replace("-Ab12Cd", ""),
            arn.replace("team/ops/x", "team"),
        ] {
            assert!(!permitted(&backend, &locator, Latest));
        }
        for selector in [
            Stage(String::new()),
            Stage("s".repeat(257)),
            Id("short".into()),
            Id("s".repeat(65)),
        ] {
            assert!(!permitted(&backend, arn, selector));
        }
    }

    #[test]
    fn gcp_project_name_prefix_and_resource_version_must_agree() {
        use VersionSelector::{Id, Latest, Stage};

        let backend = backend(BackendKind::GcpSm, json!({"project_id":"prod"}), "o2-");
        let locator = "projects/prod/secrets/o2-pd/versions/latest";
        assert!(permitted(&backend, locator, Latest));
        let pinned = locator.replace("latest", "3");
        assert!(permitted(&backend, &pinned, Id("3".into())));
        for foreign in [
            locator.replace("prod", "other"),
            locator.replace("o2-pd", "o2x-pd"),
            locator.replace("o2-pd", "o2%2Fpd"),
            locator.replace("o2-pd", "o2-/../pd"),
        ] {
            assert!(!permitted(&backend, &foreign, Latest));
        }
        for selector in [Latest, Id("2".into()), Stage("3".into())] {
            assert!(!permitted(&backend, &pinned, selector));
        }
        assert!(!permitted(&backend, locator, Id("3".into())));
    }

    #[test]
    fn azure_restricts_secret_names_and_pinned_versions_to_one_segment() {
        use VersionSelector::{Id, Latest, Stage};

        let backend = backend(
            BackendKind::AzureKv,
            json!({"vault_url":"https://demo.vault.azure.net"}),
            "team",
        );
        assert!(permitted(&backend, "team", Latest));
        assert!(permitted(
            &backend,
            "team-pd",
            Id("b2d799135a554914aec70b115f52184d".into())
        ));
        for locator in [
            "teamx",
            "team.x",
            "team_pd",
            "team/pd",
            "team%2Fpd",
            "team\0pd",
        ] {
            assert!(!permitted(&backend, locator, Latest));
        }
        for selector in [
            Stage("current".into()),
            Id("..".into()),
            Id("1/x".into()),
            Id("%31".into()),
        ] {
            assert!(!permitted(&backend, "team", selector));
        }
    }

    #[test]
    fn auth_mode_requires_admission_in_every_deployment() {
        use AuthMode::*;
        use BackendKind::*;

        for kind in [AwsSm, GcpSm, AzureKv] {
            for cloud in [false, true] {
                assert_eq!(admit_auth_mode(kind, Static, &[Static], cloud), Ok(()));
                for mode in [Mapped, RegionIssuer] {
                    assert_eq!(
                        admit_auth_mode(kind, mode, &[Static], cloud),
                        Err(SecretErrorCode::AuthModeNotEnabled)
                    );
                }
            }
        }
    }

    #[test]
    fn self_hosted_restricts_admitted_modes_by_kind() {
        use AuthMode::*;
        use BackendKind::*;

        let denied = Err(SecretErrorCode::AuthModeNotEnabled);
        for (kind, mapped) in [(AwsSm, Ok(())), (GcpSm, denied), (AzureKv, denied)] {
            assert_eq!(
                admit_auth_mode(kind, Mapped, &[Static, Mapped], false),
                mapped
            );
            assert_eq!(
                admit_auth_mode(kind, RegionIssuer, &[RegionIssuer], false),
                denied
            );
        }
    }

    #[test]
    fn cloud_supports_all_admitted_modes() {
        let modes = [AuthMode::Static, AuthMode::Mapped, AuthMode::RegionIssuer];
        for kind in [BackendKind::AwsSm, BackendKind::GcpSm, BackendKind::AzureKv] {
            for mode in modes {
                assert_eq!(admit_auth_mode(kind, mode, &modes, true), Ok(()));
            }
        }
    }

    #[test]
    fn regional_modes_require_valid_region() {
        for region in ["", "Bad_Name", "eu-west-1"] {
            assert_eq!(require_region_for(AuthMode::Static, region), Ok(()));
        }
        for mode in [AuthMode::Mapped, AuthMode::RegionIssuer] {
            assert_eq!(require_region_for(mode, "eu-west-1"), Ok(()));
            for region in ["", "Bad_Name"] {
                assert_eq!(
                    require_region_for(mode, region),
                    Err(SecretErrorCode::SecretStoreRegionUnset)
                );
            }
        }
    }
}
