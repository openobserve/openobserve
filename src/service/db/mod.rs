// Copyright 2023 Zinc Labs Inc.
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

use bytes::Bytes;
use hashbrown::HashMap;
use infra::{db as infra_db, errors::Result};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::O2_CONFIG;

pub mod alerts;
pub mod compact;
pub mod dashboards;
pub mod enrichment_table;
pub mod file_list;
pub mod functions;
pub mod instance;
pub mod kv;
pub mod metrics;
pub mod ofga;
pub mod organization;
pub mod saved_view;
pub mod schema;
pub mod syslog;
pub mod user;
pub mod version;

pub(crate) use infra_db::{get_coordinator, Event, NEED_WATCH, NO_NEED_WATCH};

pub(crate) async fn get(key: &str) -> Result<Bytes> {
    let db = infra_db::get_db().await;
    db.get(key).await
}

pub(crate) async fn put(key: &str, value: Bytes, need_watch: bool) -> Result<()> {
    // super cluster
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.common.super_cluster_enabled {
        o2_enterprise::enterprise::super_cluster::put(key, value.clone())
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }

    let db = infra_db::get_db().await;
    db.put(key, value, need_watch).await
}

pub(crate) async fn delete(key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
    let db = infra_db::get_db().await;
    db.delete(key, with_prefix, need_watch).await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.common.super_cluster_enabled {
        o2_enterprise::enterprise::super_cluster::delete(key, with_prefix)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

pub(crate) async fn delete_if_exists(key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
    let db = infra_db::get_db().await;
    db.delete_if_exists(key, with_prefix, need_watch).await
}

pub(crate) async fn list(prefix: &str) -> Result<HashMap<String, Bytes>> {
    let db = infra_db::get_db().await;
    db.list(prefix).await
}

pub(crate) async fn list_keys(prefix: &str) -> Result<Vec<String>> {
    let db = infra_db::get_db().await;
    db.list_keys(prefix).await
}

pub(crate) async fn list_values(prefix: &str) -> Result<Vec<Bytes>> {
    let db = infra_db::get_db().await;
    db.list_values(prefix).await
}
