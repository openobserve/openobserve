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

#[inline]
pub(crate) async fn get(key: &str) -> Result<Bytes> {
    let db = infra_db::get_db().await;
    db.get(key).await
}

#[inline]
pub(crate) async fn put(
    key: &str,
    value: Bytes,
    need_watch: bool,
    start_dt: Option<i64>,
) -> Result<()> {
    let db = infra_db::get_db().await;
    db.put(key, value, need_watch, start_dt).await
}

#[inline]
pub(crate) async fn get_for_update(
    key: &str,
    need_watch: bool,
    start_dt: Option<i64>,
    update_fn: Box<infra_db::UpdateFn>,
) -> Result<()> {
    let db = infra_db::get_db().await;
    db.get_for_update(key, need_watch, start_dt, update_fn)
        .await
}

#[inline]
pub(crate) async fn delete(
    key: &str,
    with_prefix: bool,
    need_watch: bool,
    start_dt: Option<i64>,
) -> Result<()> {
    let db = infra_db::get_db().await;
    db.delete(key, with_prefix, need_watch, start_dt).await?;
    Ok(())
}

#[inline]
pub(crate) async fn delete_if_exists(key: &str, with_prefix: bool, need_watch: bool) -> Result<()> {
    let db = infra_db::get_db().await;
    db.delete_if_exists(key, with_prefix, need_watch).await
}

#[inline]
pub(crate) async fn list(prefix: &str) -> Result<HashMap<String, Bytes>> {
    let db = infra_db::get_db().await;
    db.list(prefix).await
}

#[inline]
pub(crate) async fn list_keys(prefix: &str) -> Result<Vec<String>> {
    let db = infra_db::get_db().await;
    db.list_keys(prefix).await
}

#[inline]
pub(crate) async fn list_values(prefix: &str) -> Result<Vec<Bytes>> {
    let db = infra_db::get_db().await;
    db.list_values(prefix).await
}
