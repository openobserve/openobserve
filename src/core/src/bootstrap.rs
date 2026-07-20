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

use ::common::infra::wal;
use config::{cache_instance_id, ider};

use crate::db::metas;

struct CoreEnrichmentRuntime;

#[async_trait::async_trait]
impl openobserve_enrichment::Runtime for CoreEnrichmentRuntime {
    async fn register_file(
        &self,
        account: &str,
        key: &str,
        meta: config::meta::stream::FileMeta,
    ) -> Result<(), infra::errors::Error> {
        crate::db::file_list::set(account, key, Some(meta), false).await
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    crate::alerts::install_runtime_services();
    crate::ingestion::install_runtime_services();
    crate::self_reporting_adapter::install_runtime();
    crate::organization_adapter::install_runtime();
    crate::transform_adapter::install_runtime();
    let _ = openobserve_enrichment::install_runtime(std::sync::Arc::new(CoreEnrichmentRuntime));

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
