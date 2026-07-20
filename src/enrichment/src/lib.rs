// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Enrichment-table caching, persistence, ingestion, and refresh processing.

use std::sync::{Arc, OnceLock};

use config::meta::stream::{FileMeta, StreamType};
use infra::errors::Error;

pub mod enrichment;
pub mod enrichment_table;
pub mod repository;

/// Historical internal namespace retained inside the owning crate while callers migrate.
pub mod db {
    pub use crate::repository as enrichment_table;
}

#[async_trait::async_trait]
pub trait Runtime: Send + Sync {
    async fn register_file(&self, account: &str, key: &str, meta: FileMeta) -> Result<(), Error>;
}

static RUNTIME: OnceLock<Arc<dyn Runtime>> = OnceLock::new();

pub fn install_runtime(runtime: Arc<dyn Runtime>) -> Result<(), &'static str> {
    RUNTIME
        .set(runtime)
        .map_err(|_| "enrichment runtime is already installed")
}

pub(crate) async fn register_file(account: &str, key: &str, meta: FileMeta) -> Result<(), Error> {
    let runtime = RUNTIME
        .get()
        .ok_or_else(|| Error::Message("enrichment runtime is not installed".to_string()))?;
    runtime.register_file(account, key, meta).await
}

pub(crate) async fn delete_stream_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> anyhow::Result<()> {
    infra::schema::delete(org_id, stream_type, stream_name, None).await?;

    if stream_type == StreamType::EnrichmentTables {
        if let Err(err) = repository::delete_table_size(org_id, stream_name).await {
            log::error!("Failed to delete enrichment table size: {err}");
        }
        if let Err(err) = repository::delete_meta_table_stats(org_id, stream_name).await {
            log::error!("Failed to delete enrichment table metadata: {err}");
        }
    }

    #[cfg(feature = "enterprise")]
    {
        use infra::{db::NEED_WATCH, errors::Error};
        use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

        if get_o2_config().super_cluster.enabled {
            let key = infra::schema::mk_key(org_id, stream_type, stream_name);
            o2_enterprise::enterprise::super_cluster::queue::delete(&key, false, NEED_WATCH, None)
                .await
                .map_err(|err| Error::Message(err.to_string()))?;
            o2_enterprise::enterprise::super_cluster::queue::stream_delete(&key)
                .await
                .map_err(|err| Error::Message(err.to_string()))?;
        }
    }

    Ok(())
}
