// Copyright 2025 OpenObserve Inc.
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

#![feature(btree_extract_if)]

pub mod cache;
pub mod cluster_coordinator;
pub mod db;
pub mod dist_lock;
pub mod errors;
pub mod file_list;
pub mod local_lock;
pub mod pipeline;
pub mod queue;
pub mod scheduler;
pub mod schema;
pub mod storage;
pub mod table;

pub async fn get_db_schema_version() -> Result<u64, anyhow::Error> {
    let db = db::get_db().await;
    let b = db.get(config::DB_SCHEMA_KEY).await?;
    let s = String::from_utf8_lossy(&b);
    let k = match s.parse::<u64>() {
        Ok(v) => v,
        Err(e) => {
            return Err(anyhow::anyhow!(
                "invalid DB_SCHEMA_VERSION found in db : {e}"
            ));
        }
    };

    Ok(k)
}

pub async fn set_db_schema_version() -> Result<(), anyhow::Error> {
    let db = db::get_db().await;
    let s = config::DB_SCHEMA_VERSION.to_string();
    let b = bytes::Bytes::from_owner(s);
    db.put(config::DB_SCHEMA_KEY, b, false, None).await?;
    Ok(())
}

pub async fn db_init() -> Result<(), anyhow::Error> {
    // check db dir
    std::fs::create_dir_all(&config::get_config().common.data_db_dir)?;
    db::init().await?;
    file_list::create_table().await?;
    pipeline::init().await?;
    queue::init().await?;
    scheduler::init().await?;
    schema::init().await?;
    table::init().await?;
    Ok(())
}

pub async fn init() -> Result<(), anyhow::Error> {
    cache::init().await?;
    file_list::LOCAL_CACHE.create_table().await?;
    file_list::local_cache_gc().await?;
    if !config::is_local_disk_storage() {
        storage::remote::test_config().await?;
    }
    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    Ok(())
}
