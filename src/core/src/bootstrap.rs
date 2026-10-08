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
use config::{cache_instance_id, cache_stored_grpc_token, get_config, ider};
use db::metas;

#[cfg(feature = "enterprise")]
use crate::self_reporting::CoreAuditPublisher;
use crate::self_reporting::persistence::CoreBatchPublisher;

struct InstanceIdentity {
    instance_id: String,
    grpc_token: Option<String>,
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
async fn get_or_create_instance_identity() -> Result<InstanceIdentity, anyhow::Error> {
    const MAX_RETRIES: usize = 5;
    let mut last_err = None;
    for attempt in 1..=MAX_RETRIES {
        match read_instance_identity().await {
            Ok(Some(identity)) => return Ok(identity),
            Ok(None) => return create_instance_identity().await,
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
    Ok(Some(InstanceIdentity {
        instance_id,
        grpc_token: metas::grpc_token::get().await?,
    }))
}

async fn create_instance_identity() -> Result<InstanceIdentity, anyhow::Error> {
    log::info!("Generating new instance id");
    let candidate = config::utils::rand::random_hex(32);
    // stored before the instance id, so a node that reads the id also reads the token
    let grpc_token = metas::grpc_token::get_or_create(&candidate).await?;
    let instance_id = ider::generate();
    metas::instance::set(&instance_id).await?;
    Ok(InstanceIdentity {
        instance_id,
        grpc_token: Some(grpc_token),
    })
}

fn cache_instance_identity(identity: &InstanceIdentity) {
    cache_instance_id(&identity.instance_id);
    cache_stored_grpc_token(identity.grpc_token.as_deref().unwrap_or_default());
    if identity.grpc_token.is_none() && get_config().grpc.internal_grpc_token.is_empty() {
        log::warn!(
            "ZO_INTERNAL_GRPC_TOKEN is not set and this install has no stored internal gRPC token, so the instance id is used as the token; set ZO_INTERNAL_GRPC_TOKEN to the same secret on every node"
        );
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

    cache_instance_identity(&get_or_create_instance_identity().await?);

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
        for key in ["/instance/", "/internal_grpc_token/"] {
            db.delete_if_exists(key, false, false).await.unwrap();
        }
    }

    #[tokio::test]
    async fn test_fresh_install_gets_a_random_grpc_token() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let identity = get_or_create_instance_identity().await.unwrap();
        let token = identity.grpc_token.expect("a fresh install stores a token");
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(token, identity.instance_id);
        assert_eq!(
            metas::grpc_token::get().await.unwrap().as_deref(),
            Some(token.as_str())
        );

        reset_identity().await;
        let other = get_or_create_instance_identity().await.unwrap();
        assert_ne!(other.grpc_token, Some(token));
    }

    #[tokio::test]
    async fn test_grpc_token_is_stable_across_restarts() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let first = get_or_create_instance_identity().await.unwrap();
        let second = get_or_create_instance_identity().await.unwrap();
        assert!(first.grpc_token.is_some());
        assert_eq!(first.instance_id, second.instance_id);
        assert_eq!(first.grpc_token, second.grpc_token);
    }

    #[tokio::test]
    async fn test_existing_install_keeps_the_instance_id_token() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        metas::instance::set("existing-instance").await.unwrap();
        let identity = get_or_create_instance_identity().await.unwrap();
        assert_eq!(identity.instance_id, "existing-instance");
        assert_eq!(identity.grpc_token, None);
        assert_eq!(metas::grpc_token::get().await.unwrap(), None);

        cache_stored_grpc_token("left-over");
        cache_instance_identity(&identity);
        assert_eq!(config::get_stored_grpc_token(), "");
        assert_eq!(config::get_instance_id(), "existing-instance");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_concurrent_first_boots_agree_on_the_grpc_token() {
        let _guard = META_KEYS.lock().await;
        reset_identity().await;
        let boots = (0..4)
            .map(|_| tokio::spawn(get_or_create_instance_identity()))
            .collect::<Vec<_>>();
        let mut tokens = Vec::new();
        for boot in boots {
            tokens.push(boot.await.unwrap().unwrap().grpc_token);
        }
        let stored = metas::grpc_token::get().await.unwrap();
        assert!(stored.is_some());
        assert!(
            tokens.iter().all(|t| *t == stored),
            "{tokens:?} vs {stored:?}"
        );
    }
}
