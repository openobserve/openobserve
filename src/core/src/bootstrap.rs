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
use config::{cache_instance_id, get_config, ider};
use db::metas;

#[cfg(feature = "enterprise")]
use crate::self_reporting::CoreAuditPublisher;
use crate::self_reporting::persistence::CoreBatchPublisher;

struct CoreOrganizationProvisioner;

#[async_trait::async_trait]
impl schema::OrganizationProvisioner for CoreOrganizationProvisioner {
    fn should_auto_create_missing_orgs(&self) -> bool {
        let cfg = get_config();

        #[cfg(feature = "enterprise")]
        let usage_enabled = true;
        #[cfg(not(feature = "enterprise"))]
        let usage_enabled = cfg.common.usage_enabled;

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

pub async fn init() -> Result<(), anyhow::Error> {
    schema::set_organization_provisioner(Arc::new(CoreOrganizationProvisioner))
        .map_err(|_| anyhow::anyhow!("organization provisioner is already initialized"))?;
    usage_reporting::set_batch_publisher(Arc::new(CoreBatchPublisher))
        .map_err(|_| anyhow::anyhow!("usage batch publisher is already initialized"))?;
    #[cfg(feature = "enterprise")]
    audit::set_audit_publisher(Arc::new(CoreAuditPublisher))
        .map_err(|_| anyhow::anyhow!("audit publisher is already initialized"))?;

    let instance_id = match metas::instance::get().await {
        Ok(Some(instance)) => instance,
        Ok(None) | Err(_) => {
            log::info!("Generating new instance id");
            let id = ider::generate();
            let _ = metas::instance::set(&id).await;
            id
        }
    };
    cache_instance_id(&instance_id);

    wal::init()?;
    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    Ok(())
}
