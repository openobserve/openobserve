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

use std::{
    hash::Hash,
    sync::{Arc, LazyLock as Lazy},
};

use arrow_schema::Schema;
use serde::{Deserialize, Serialize};

use crate::metadata::distinct_values::DvItem;

pub mod distinct_values;

static METADATA_MANAGER: Lazy<MetadataManager> = Lazy::new(MetadataManager::new);

#[derive(Debug, Eq, Hash, PartialEq, Clone, Serialize, Deserialize)]
pub enum MetadataItem {
    DistinctValues(DvItem),
}

pub enum MetadataType {
    DistinctValues,
}

pub struct MetadataManager {}

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
        Self {}
    }

    pub async fn close(&self) -> infra::errors::Result<()> {
        if let Err(e) = distinct_values::INSTANCE.stop().await {
            log::error!("[METADATA] error while closing: {e}");
        }

        Ok(())
    }
}

pub async fn write(
    org_id: &str,
    mt: MetadataType,
    data: Vec<MetadataItem>,
) -> infra::errors::Result<()> {
    match mt {
        MetadataType::DistinctValues => distinct_values::INSTANCE.write(org_id, data).await,
    }
}

pub async fn close() -> infra::errors::Result<()> {
    // flush metadata
    METADATA_MANAGER.close().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metadata_manager_new() {
        let _m = MetadataManager::new();
    }

    #[test]
    fn test_metadata_manager_default() {
        let _m = MetadataManager::default();
    }

    #[test]
    fn test_metadata_type_variants() {
        let t = MetadataType::DistinctValues;
        assert!(matches!(t, MetadataType::DistinctValues));
    }
}
