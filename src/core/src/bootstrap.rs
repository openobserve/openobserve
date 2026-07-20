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

use ::common::{infra::wal, metadata};
use config::{cache_instance_id, ider};

struct CoreEnrichmentRuntime;
struct CoreCatalogRuntime;
struct CoreStreamRuntime;

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

#[async_trait::async_trait]
impl openobserve_catalog::stream::StreamRuntime for CoreStreamRuntime {
    async fn add_distinct_value(
        &self,
        record: infra::table::distinct_values::DistinctFieldRecord,
    ) -> Result<(), infra::errors::Error> {
        openobserve_dashboards::distinct_values::add(record).await
    }

    async fn delete_enrichment_url_job_if_exists(
        &self,
        org_id: &str,
        stream_name: &str,
    ) -> anyhow::Result<bool> {
        if openobserve_enrichment::repository::get_url_job(org_id, stream_name)
            .await?
            .is_none()
        {
            return Ok(false);
        }
        openobserve_enrichment::repository::delete_url_job(org_id, stream_name).await?;
        Ok(true)
    }

    async fn delete_related_feature_resources(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
    ) -> anyhow::Result<()> {
        let stream = config::meta::stream::StreamParams::new(org_id, stream_name, stream_type);
        for pipeline in openobserve_pipeline::service::get_by_stream(&stream).await {
            openobserve_pipeline::service::delete(&pipeline.id)
                .await
                .map_err(|e| {
                    anyhow::anyhow!(
                        "Error: failed to delete the associated pipeline \"{}\": {e}",
                        pipeline.name
                    )
                })?;
        }

        if let Ok(alerts) = openobserve_alerts::repository::alert::list(
            org_id,
            Some(stream_type),
            Some(stream_name),
        )
        .await
        {
            for alert in alerts {
                openobserve_alerts::repository::alert::delete_by_name(
                    org_id,
                    stream_type,
                    stream_name,
                    &alert.name,
                )
                .await
                .map_err(|e| {
                    anyhow::anyhow!(
                        "Error: failed to delete the associated alert \"{}\": {e}",
                        alert.name
                    )
                })?;
            }
        }
        Ok(())
    }

    async fn schedule_stream_deletion(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
    ) -> anyhow::Result<()> {
        openobserve_compactor::repository::retention::delete_stream(
            org_id,
            stream_type,
            stream_name,
            None,
        )
        .await?;
        Ok(())
    }

    async fn cleanup_enrichment_resources(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
    ) -> anyhow::Result<()> {
        openobserve_enrichment::enrichment_table::cleanup_enrichment_table_resources(
            org_id,
            stream_name,
            stream_type,
        )
        .await;
        Ok(())
    }

    async fn delete_compaction_offset(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
    ) -> anyhow::Result<()> {
        openobserve_compactor::repository::files::del_offset(org_id, stream_type, stream_name)
            .await
            .map_err(Into::into)
    }

    async fn schedule_data_deletion(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
        start_time: &str,
        end_time: &str,
    ) -> Result<String, infra::errors::Error> {
        let (key, _) = openobserve_compactor::repository::retention::delete_stream(
            org_id,
            stream_type,
            stream_name,
            Some((start_time, end_time)),
        )
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        let job = infra::table::compactor_manual_jobs::CompactorManualJob {
            id: config::ider::uuid(),
            key,
            status: infra::table::compactor_manual_jobs::Status::Pending,
            created_at: chrono::Utc::now().timestamp_micros(),
            ended_at: 0,
        };
        openobserve_compactor::repository::compactor_manual_jobs::add_job(job).await
    }

    async fn enrichment_table_stats(
        &self,
        org_id: &str,
        stream_name: &str,
    ) -> Option<config::meta::stream::EnrichmentTableMetaStreamStats> {
        openobserve_enrichment::repository::get_meta_table_stats(org_id, stream_name).await
    }

    async fn update_field_types(
        &self,
        org_id: &str,
        stream_name: &str,
        stream_type: config::meta::stream::StreamType,
        schema: &arrow_schema::Schema,
        min_ts: i64,
    ) -> anyhow::Result<()> {
        let mut schema_map = std::collections::HashMap::new();
        openobserve_ingestion::schema::handle_diff_schema(
            org_id,
            stream_name,
            stream_type,
            false,
            schema,
            min_ts,
            &mut schema_map,
            false,
        )
        .await?;
        Ok(())
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    let _ = openobserve_catalog::schema::install_schema_runtime(std::sync::Arc::new(
        CoreCatalogRuntime,
    ));
    let _ =
        openobserve_catalog::stream::install_stream_runtime(std::sync::Arc::new(CoreStreamRuntime));
    crate::alerts::install_runtime_services();
    crate::dashboards::install_runtime_services();
    crate::ingestion::install_runtime_services();
    crate::self_reporting_adapter::install_runtime();
    crate::organization_adapter::install_runtime();
    crate::transform_adapter::install_runtime();
    let _ = openobserve_enrichment::install_runtime(std::sync::Arc::new(CoreEnrichmentRuntime));

    let instance_id = match metadata::instance::get().await {
        Ok(Some(instance)) => instance,
        Ok(None) | Err(_) => {
            log::info!("Generating new instance id");
            let id = ider::generate();
            let _ = metadata::instance::set(&id).await;
            id
        }
    };
    cache_instance_id(&instance_id);

    wal::init()?;
    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    Ok(())
}
