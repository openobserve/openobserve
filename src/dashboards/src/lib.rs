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

//! Dashboard CRUD, catalog, panel, and annotation services.

use std::sync::{Arc, LazyLock, OnceLock};

use config::RwAHashMap;

/// Dashboard ID to organization catalog used for tenant-boundary checks.
pub static DASHBOARD_ID_TO_ORG: LazyLock<RwAHashMap<String, String>> =
    LazyLock::new(Default::default);

pub mod distinct_values;
pub mod folders;
pub mod repository;
mod service;
pub mod timed_annotations;

pub use service::*;

#[async_trait::async_trait]
pub trait FolderRuntime: Send + Sync {
    async fn permitted_objects(
        &self,
        org_id: &str,
        user_id: &str,
        permission: &str,
        object_type: &str,
    ) -> anyhow::Result<Option<Vec<String>>>;
}

static FOLDER_RUNTIME: OnceLock<Arc<dyn FolderRuntime>> = OnceLock::new();

pub fn install_folder_runtime(runtime: Arc<dyn FolderRuntime>) -> Result<(), &'static str> {
    FOLDER_RUNTIME
        .set(runtime)
        .map_err(|_| "dashboard folder runtime is already installed")
}

#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
pub(crate) async fn permitted_folder_objects(
    org_id: &str,
    user_id: &str,
    permission: &str,
    object_type: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    let runtime = FOLDER_RUNTIME
        .get()
        .ok_or_else(|| anyhow::anyhow!("dashboard folder runtime is not installed"))?;
    runtime
        .permitted_objects(org_id, user_id, permission, object_type)
        .await
}
