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
struct CoreCatalogRuntime;

#[async_trait::async_trait]
impl openobserve_catalog::schema::SchemaRuntime for CoreCatalogRuntime {
    async fn check_and_create_org(&self, org_id: &str) -> anyhow::Result<()> {
        crate::organization::check_and_create_org(org_id)
            .await
            .map(|_| ())
    }

    async fn delete_compaction_offset(
        &self,
        org_id: &str,
        stream_type: config::meta::stream::StreamType,
        stream_name: &str,
    ) -> anyhow::Result<()> {
        openobserve_compactor::repository::files::del_offset(org_id, stream_type, stream_name)
            .await
            .map_err(Into::into)
    }

    async fn delete_enrichment_metadata(
        &self,
        org_id: &str,
        stream_name: &str,
    ) -> anyhow::Result<()> {
        let size_result =
            openobserve_enrichment::repository::delete_table_size(org_id, stream_name).await;
        let stats_result =
            openobserve_enrichment::repository::delete_meta_table_stats(org_id, stream_name).await;
        size_result?;
        stats_result?;
        Ok(())
    }

    async fn list_enrichment_url_jobs(
        &self,
        org_id: &str,
    ) -> anyhow::Result<Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>> {
        openobserve_enrichment::repository::list_url_jobs(org_id)
            .await
            .map_err(Into::into)
    }

    async fn cache_enrichment_table(
        &self,
        cache_key: &str,
        org_id: &str,
        stream_name: &str,
    ) -> anyhow::Result<usize> {
        let data =
            openobserve_enrichment::enrichment::get_enrichment_table(org_id, stream_name, true)
                .await?;
        let len = data.len();
        openobserve_transform::enrichment::ENRICHMENT_TABLES.insert(
            cache_key.to_string(),
            openobserve_transform::enrichment::StreamTable {
                org_id: org_id.to_string(),
                stream_name: stream_name.to_string(),
                data,
            },
        );
        Ok(len)
    }
}

#[async_trait::async_trait]
impl openobserve_enrichment::Runtime for CoreEnrichmentRuntime {
    async fn register_file(
        &self,
        account: &str,
        key: &str,
        meta: config::meta::stream::FileMeta,
    ) -> Result<(), infra::errors::Error> {
        openobserve_catalog::file_list::set(account, key, Some(meta), false).await
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    let _ = openobserve_catalog::schema::install_schema_runtime(std::sync::Arc::new(
        CoreCatalogRuntime,
    ));
    crate::alerts::install_runtime_services();
    crate::dashboards::install_runtime_services();
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
