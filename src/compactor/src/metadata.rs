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

use bytes::Bytes;
use hashbrown::HashMap;
use infra::{db as infra_db, errors::Result};
pub(crate) use infra_db::{Event, NEED_WATCH, NO_NEED_WATCH, get_coordinator};
#[cfg(feature = "enterprise")]
use {
    infra::errors::Error, o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

pub(crate) async fn get(key: &str) -> Result<Bytes> {
    infra_db::get_db().await.get(key).await
}

#[cfg(feature = "enterprise")]
fn should_replicate_compact_delete(key: &str, value: &Bytes) -> bool {
    !key.starts_with("/compact/delete") || String::from_utf8_lossy(value).eq("OK")
}

pub(crate) async fn put(
    key: &str,
    value: Bytes,
    need_watch: bool,
    start_dt: Option<i64>,
) -> Result<()> {
    infra_db::get_db()
        .await
        .put(key, value.clone(), need_watch, start_dt)
        .await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled && should_replicate_compact_delete(key, &value) {
        o2_enterprise::enterprise::super_cluster::queue::put(key, value, need_watch, start_dt)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }
    Ok(())
}

pub(crate) async fn delete_if_exists(key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::queue::delete(key, with_prefix, need_watch, None)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }

    infra_db::get_db()
        .await
        .delete_if_exists(key, with_prefix, need_watch)
        .await
}

pub(crate) async fn list(prefix: &str) -> Result<HashMap<String, Bytes>> {
    infra_db::get_db().await.list(prefix).await
}
