use std::{hash::Hash, sync::Arc};

use arrow_schema::Schema;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::service::metadata::trace_list_index::{TraceListIndex, TraceListItem};

pub mod distinct_values;
pub mod trace_list_index;

static METADATA_MANAGER: Lazy<MetadataManager> = Lazy::new(MetadataManager::new);

#[derive(Debug, Eq, Hash, PartialEq, Clone, Serialize, Deserialize)]
pub enum MetadataItem {
    TraceListIndexer(TraceListItem),
}

pub enum MetadataType {
    TraceListIndexer,
    DistinctValues,
}

pub struct MetadataManager {
    trace_list_indexer: TraceListIndex,
}

pub trait Metadata {
    fn generate_schema(&self) -> Arc<Schema>;
    fn write(
        &self,
        org_id: &str,
        data: Vec<MetadataItem>,
    ) -> impl std::future::Future<Output = infra::errors::Result<()>> + Send;
    fn flush(&self) -> impl std::future::Future<Output = infra::errors::Result<()>> + Send;
    fn stop(&self) -> impl std::future::Future<Output = infra::errors::Result<()>> + Send;
}

impl Default for MetadataManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MetadataManager {
    pub fn new() -> Self {
        Self {
            trace_list_indexer: TraceListIndex::new(),
        }
    }

    pub async fn close(&self) -> infra::errors::Result<()> {
        self.trace_list_indexer.stop().await
    }
}

pub async fn write(
    org_id: &str,
    mt: MetadataType,
    data: Vec<MetadataItem>,
) -> infra::errors::Result<()> {
    match mt {
        MetadataType::TraceListIndexer => Ok(METADATA_MANAGER
            .trace_list_indexer
            .write(org_id, data)
            .await?),
        MetadataType::DistinctValues => {
            // todo distinct write move here
            todo!()
        }
    }
}

pub async fn close() -> infra::errors::Result<()> {
    // flush distinct values, todo it will be close in MetadataManager
    _ = distinct_values::close().await;
    // flush metadata
    METADATA_MANAGER.close().await
}
