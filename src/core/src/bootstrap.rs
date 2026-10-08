// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::Arc;

use ::common::infra::wal;
use config::{
    LEGACY_EXT_AUTH_SALT, cache_instance_id, cache_stored_ext_auth_salt, cache_stored_grpc_token,
    get_config, ider,
};
use db::metas;

#[cfg(feature = "enterprise")]
use crate::self_reporting::CoreAuditPublisher;
use crate::self_reporting::persistence::CoreBatchPublisher;

const MIN_EXT_AUTH_SALT_LEN: usize = 16;
// argon2 hashes with a salt of 8 to 48 bytes and get_hash panics outside that
const MIN_ARGON2_SALT_LEN: usize = 8;
const MAX_EXT_AUTH_SALT_LEN: usize = 48;

struct InstanceIdentity {
    instance_id: String,
    grpc_token: Option<String>,
    ext_auth_salt: Option<String>,
}

struct CoreOrganizationProvisioner;

#[async_trait::async_trait]
impl schema::OrganizationProvisioner for CoreOrganizationProvisioner {
    fn should_auto_create_missing_orgs(&self) -> bool {
        let cfg = get_config();

        #[cfg(feature = "enterprise")]
        let usage_enabled = true;
        #[cfg(not(feature = "enterprise"))]
        let usage_enabled = false;

        #[cfg(feature = "enterprise")]
        let audit_enabled = o2_enterprise::enterprise::common::config::get_config()
            .common
            .audit_enabled;
        #[cfg(not(feature = "enterprise"))]
        let audit_enabled = false;

        cfg.common.create_org_through_ingestion || usage_enabled || audit_enabled
    }

    async fn ensure_org_exists(&self, org_id: &str) -> Result<(), anyhow::Error> {
        crate::organization::check_and_create_org(org_id)
            .await
            .map(|_| ())
    }
}

/// The instance id must stay stable for the lifetime of the deployment:
/// generate a new one only when it is genuinely absent, never because the db
/// errored on the read.
async fn get_or_create_instance_identity(
    env_ext_auth_salt: &str,
) -> Result<InstanceIdentity, anyhow::Error> {
    const MAX_RETRIES: usize = 5;
    let mut last_err = None;
    for attempt in 1..=MAX_RETRIES {
        match read_instance_identity().await {
            Ok(Some(identity)) => {
                check_ext_auth_salt(false, env_ext_auth_salt)?;
                return Ok(identity);
            }
            Ok(None) => {
                check_ext_auth_salt(true, env_ext_auth_salt)?;
                return create_instance_identity(env_ext_auth_salt).await;
            }
            Err(e) => {
                log::warn!(
                    "error in getting instance id (attempt {attempt}/{MAX_RETRIES}): {e}, retrying..."
                );
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_secs(attempt as u64 * 2)).await;
            }
        }
    }
    Err(anyhow::anyhow!(
        "failed to get instance id after {MAX_RETRIES} attempts: {}; refusing to generate a new instance id against an unhealthy database",
        last_err.unwrap()
    ))
}

async fn read_instance_identity() -> infra::errors::Result<Option<InstanceIdentity>> {
    let Some(instance_id) = metas::instance::get().await? else {
        return Ok(None);
    };
    let (grpc_token, ext_auth_salt) =
        tokio::try_join!(metas::grpc_token::get(), metas::ext_auth_salt::get())?;
    Ok(Some(InstanceIdentity {
        instance_id,
        grpc_token,
        ext_auth_salt,
    }))
}

/// Existing installs only warn on a weak usable salt: rotating it breaks logins derived from it.
fn check_ext_auth_salt(fresh_install: bool, salt: &str) -> anyhow::Result<()> {
    // unset: a new install generates and stores one, an existing one keeps the legacy salt
    if salt.is_empty() {
        return Ok(());
    }
    if salt.len() > MAX_EXT_AUTH_SALT_LEN {
        return Err(anyhow::anyhow!(
            "ZO_EXT_AUTH_SALT is {} bytes, but argon2 accepts at most {MAX_EXT_AUTH_SALT_LEN}; set it to a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} bytes (for example `openssl rand -hex 24`)",
            salt.len()
        ));
    }
    if salt != LEGACY_EXT_AUTH_SALT && salt.len() >= MIN_EXT_AUTH_SALT_LEN {
        return Ok(());
    }
    if fresh_install {
        return Err(anyhow::anyhow!(
            "ZO_EXT_AUTH_SALT is the public legacy salt or shorter than {MIN_EXT_AUTH_SALT_LEN} bytes; on a new install set a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} bytes (for example `openssl rand -hex 24`) kept the same on every node and restart, or leave it unset to have one generated and stored in the meta db"
        ));
    }
    if salt.len() < MIN_ARGON2_SALT_LEN {
        return Err(anyhow::anyhow!(
            "ZO_EXT_AUTH_SALT is {} bytes, but argon2 needs at least {MIN_ARGON2_SALT_LEN}; set it to a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} bytes (for example `openssl rand -hex 24`)",
            salt.len()
        ));
    }
    log::warn!(
        "ZO_EXT_AUTH_SALT is the public legacy salt or shorter than {MIN_EXT_AUTH_SALT_LEN} bytes; set a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} bytes before the first presigned or ext-token login"
    );
    Ok(())
}

/// With `ZO_EXT_AUTH_SALT` set the operator keeps the salt out of the meta db: nothing is stored.
async fn create_instance_identity(
    env_ext_auth_salt: &str,
) -> Result<InstanceIdentity, anyhow::Error> {
    log::info!("Generating new instance id");
    // stored before the instance id, so a node that reads the id also reads the secrets
    let ext_auth_salt = if env_ext_auth_salt.is_empty() {
        let candidate = config::utils::rand::random_hex(24);
        Some(metas::ext_auth_salt::get_or_create(&candidate).await?)
    } else {
        None
    };
    let candidate = config::utils::rand::random_hex(32);
    let grpc_token = metas::grpc_token::get_or_create(&candidate).await?;
    let instance_id = ider::generate();
    metas::instance::set(&instance_id).await?;
    Ok(InstanceIdentity {
        instance_id,
        grpc_token: Some(grpc_token),
        ext_auth_salt,
    })
}

fn cache_instance_identity(identity: &InstanceIdentity, env_ext_auth_salt: &str) {
    cache_instance_id(&identity.instance_id);
    cache_stored_grpc_token(identity.grpc_token.as_deref().unwrap_or_default());
    cache_stored_ext_auth_salt(identity.ext_auth_salt.as_deref().unwrap_or_default());
    if identity.grpc_token.is_none() && get_config().grpc.internal_grpc_token.is_empty() {
        log::warn!(
            "ZO_INTERNAL_GRPC_TOKEN is not set and this install has no stored internal gRPC token, so the instance id is used as the token; set ZO_INTERNAL_GRPC_TOKEN to the same secret on every node"
        );
    }
    match identity.ext_auth_salt.as_deref() {
        None if env_ext_auth_salt.is_empty() => log::warn!(
            "ZO_EXT_AUTH_SALT is not set and this install has no stored ext auth salt, so the public legacy salt is used; set ZO_EXT_AUTH_SALT to the same random secret of 16 to 48 bytes on every node"
        ),
        Some(stored) if !env_ext_auth_salt.is_empty() && stored != env_ext_auth_salt => log::warn!(
            "ZO_EXT_AUTH_SALT differs from the ext auth salt stored in the meta db; the env value is used, and presigned or ext-token logins derived from the stored salt will fail"
        ),
        _ => {}
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    schema::set_organization_provisioner(Arc::new(CoreOrganizationProvisioner))
        .map_err(|_| anyhow::anyhow!("organization provisioner is already initialized"))?;
    usage_reporting::set_batch_publisher(Arc::new(CoreBatchPublisher))
        .map_err(|_| anyhow::anyhow!("usage batch publisher is already initialized"))?;
    #[cfg(feature = "enterprise")]
    audit::set_audit_publisher(Arc::new(CoreAuditPublisher))
        .map_err(|_| anyhow::anyhow!("audit publisher is already initialized"))?;

    let env_ext_auth_salt = get_config().auth.ext_auth_salt.clone();
    cache_instance_identity(
        &get_or_create_instance_identity(&env_ext_auth_salt).await?,
        &env_ext_auth_salt,
    );

    // _meta used to appear only once self-reporting wrote its first stream into it,
    // so a deployment that reports nothing never had the org its history pages read.
    crate::organization::check_and_create_org(config::META_ORG_ID).await?;

    wal::init()?;
    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use tokio::sync::Mutex;

    use super::*;

    // every test here rewrites the same instance keys in the shared meta db
    static META_KEYS: Mutex<()> = Mutex::const_new(());

    async fn reset_identity() {
        infra::db::create_table().await.unwrap();
        let db = infra::db::get_db().await;
        for key in ["/instance/", "/internal_grpc_token/", "/ext_auth_salt/"] {
            db.delete_if_exists(key, false, false).await.unwrap();
        }
    }

    #[tokio::test]
    async fn test_fresh_install_gets_a_random_grpc_token() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let identity = get_or_create_instance_identity("").await.unwrap();
        let token = identity.grpc_token.expect("a fresh install stores a token");
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(token, identity.instance_id);
        assert_eq!(
            metas::grpc_token::get().await.unwrap().as_deref(),
            Some(token.as_str())
        );

        reset_identity().await;
        let other = get_or_create_instance_identity("").await.unwrap();
        assert_ne!(other.grpc_token, Some(token));
    }

    #[tokio::test]
    async fn test_grpc_token_is_stable_across_restarts() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let first = get_or_create_instance_identity("").await.unwrap();
        let second = get_or_create_instance_identity("").await.unwrap();
        assert!(first.grpc_token.is_some());
        assert!(first.ext_auth_salt.is_some());
        assert_eq!(first.instance_id, second.instance_id);
        assert_eq!(first.grpc_token, second.grpc_token);
        assert_eq!(first.ext_auth_salt, second.ext_auth_salt);
    }

    #[tokio::test]
    async fn test_existing_install_keeps_the_instance_id_token() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        metas::instance::set("existing-instance").await.unwrap();
        let identity = get_or_create_instance_identity("").await.unwrap();
        assert_eq!(identity.instance_id, "existing-instance");
        assert_eq!(identity.grpc_token, None);
        assert_eq!(metas::grpc_token::get().await.unwrap(), None);

        cache_stored_grpc_token("left-over");
        cache_stored_ext_auth_salt("left-over");
        cache_instance_identity(&identity, "");
        assert_eq!(config::get_stored_grpc_token(), "");
        assert_eq!(config::get_stored_ext_auth_salt(), "");
        assert_eq!(config::get_instance_id(), "existing-instance");
    }

    #[tokio::test]
    async fn test_fresh_install_without_env_salt_stores_a_random_one() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let identity = get_or_create_instance_identity("").await.unwrap();
        let salt = identity
            .ext_auth_salt
            .expect("a fresh install stores a salt");
        assert_eq!(salt.len(), 48);
        assert!(salt.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(
            ::config::utils::hash::try_get_passcode_hash("p", &salt).is_some(),
            "argon2 must accept the generated salt"
        );
        assert_eq!(
            metas::ext_auth_salt::get().await.unwrap().as_deref(),
            Some(salt.as_str())
        );
    }

    #[tokio::test]
    async fn test_fresh_install_with_env_salt_stores_none() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let identity = get_or_create_instance_identity("env-salt-0123456789abcdef")
            .await
            .unwrap();
        assert_eq!(identity.ext_auth_salt, None);
        assert_eq!(metas::ext_auth_salt::get().await.unwrap(), None);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_concurrent_first_boots_agree_on_the_stored_secrets() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let boots = (0..4)
            .map(|_| tokio::spawn(get_or_create_instance_identity("")))
            .collect::<Vec<_>>();
        let mut secrets = Vec::new();
        for boot in boots {
            let identity = boot.await.unwrap().unwrap();
            secrets.push((identity.grpc_token, identity.ext_auth_salt));
        }
        let stored = (
            metas::grpc_token::get().await.unwrap(),
            metas::ext_auth_salt::get().await.unwrap(),
        );
        assert!(stored.0.is_some() && stored.1.is_some());
        assert!(
            secrets.iter().all(|s| *s == stored),
            "{secrets:?} vs {stored:?}"
        );
    }

    #[test]
    fn a_new_install_refuses_the_legacy_or_a_short_ext_auth_salt() {
        for salt in [LEGACY_EXT_AUTH_SALT, "short-secret"] {
            let err = check_ext_auth_salt(true, salt).unwrap_err().to_string();
            assert!(err.contains("ZO_EXT_AUTH_SALT"), "{salt}: {err}");
        }
    }

    #[test]
    fn an_unset_ext_auth_salt_is_accepted_on_any_install() {
        for fresh_install in [true, false] {
            assert!(check_ext_auth_salt(fresh_install, "").is_ok());
        }
    }

    #[test]
    fn a_new_install_accepts_a_random_ext_auth_salt() {
        assert!(check_ext_auth_salt(true, "3f9c2a7e5b1d8c4f6a0e2b9d7c5a3f1e").is_ok());
    }

    #[test]
    fn an_accepted_ext_auth_salt_is_one_argon2_can_hash_with() {
        // 0 is "unset": the install hashes with a generated or legacy salt instead
        for len in 1..=96 {
            let salt = "a".repeat(len);
            let hashable =
                ::config::utils::hash::try_get_passcode_hash("Complexpass#123", &salt).is_some();
            for fresh_install in [true, false] {
                let accepted = check_ext_auth_salt(fresh_install, &salt).is_ok();
                assert!(
                    !accepted || hashable,
                    "len {len}, fresh {fresh_install}: accepted but argon2 refuses it"
                );
            }
        }
    }

    #[test]
    fn the_recommended_ext_auth_salt_is_accepted_and_a_hex_32_one_is_refused() {
        let hex_24 = "9f2c4e6a8b0d1f3e5c7a9b1d3f5e7c9a0b2d4f6e8a1c3e5f";
        assert_eq!(hex_24.len(), 48);
        assert!(check_ext_auth_salt(true, hex_24).is_ok());
        assert!(::config::utils::hash::try_get_passcode_hash("p", hex_24).is_some());
        let hex_32 = "9f2c4e6a8b0d1f3e5c7a9b1d3f5e7c9a0b2d4f6e8a1c3e5f7a9b0c1d2e3f4a5b";
        assert_eq!(hex_32.len(), 64);
        for fresh_install in [true, false] {
            let err = check_ext_auth_salt(fresh_install, hex_32)
                .unwrap_err()
                .to_string();
            assert!(err.contains("ZO_EXT_AUTH_SALT"), "{err}");
            assert!(err.contains("openssl rand -hex 24"), "{err}");
        }
    }

    #[test]
    fn the_new_install_refusal_recommends_a_salt_that_fits() {
        let err = check_ext_auth_salt(true, LEGACY_EXT_AUTH_SALT)
            .unwrap_err()
            .to_string();
        assert!(err.contains("openssl rand -hex 24"), "{err}");
    }

    #[test]
    fn the_shipped_examples_leave_the_ext_auth_salt_unset() {
        let env_example = include_str!("../../../.env.example")
            .lines()
            .find_map(|line| line.trim().strip_prefix("ZO_EXT_AUTH_SALT"))
            .and_then(|rest| rest.trim().strip_prefix('='))
            .map(|value| value.trim().trim_matches('"').to_string())
            .expect(".env.example sets ZO_EXT_AUTH_SALT");
        let k8s = include_str!("../../../deploy/k8s/statefulset.yaml");
        let k8s = k8s
            .lines()
            .skip_while(|line| !line.contains("name: ZO_EXT_AUTH_SALT"))
            .find_map(|line| line.trim().strip_prefix("value:"))
            .map(|value| value.trim().trim_matches('"').to_string())
            .expect("statefulset.yaml sets ZO_EXT_AUTH_SALT");
        for salt in [env_example, k8s] {
            assert!(salt.is_empty(), "{salt:?}");
        }
    }

    #[test]
    fn an_existing_install_keeps_starting_with_the_default_or_a_short_usable_ext_auth_salt() {
        for salt in [LEGACY_EXT_AUTH_SALT, "eight888", "short-secret"] {
            assert!(check_ext_auth_salt(false, salt).is_ok(), "{salt:?}");
        }
    }

    #[test]
    fn an_existing_install_refuses_an_ext_auth_salt_argon2_cannot_use() {
        let too_long = "a".repeat(MAX_EXT_AUTH_SALT_LEN + 1);
        for salt in ["a", "abc", "seven77", too_long.as_str()] {
            assert!(
                ::config::utils::hash::try_get_passcode_hash("p", salt).is_none(),
                "{salt:?} is usable"
            );
            let err = check_ext_auth_salt(false, salt)
                .expect_err(salt)
                .to_string();
            assert!(err.contains("ZO_EXT_AUTH_SALT"), "{salt:?}: {err}");
            assert!(err.contains("openssl rand -hex 24"), "{salt:?}: {err}");
        }
    }
}
