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

use config::CONFIG;
use tokio::time;

use crate::{common::infra::cluster::is_compactor, service};

pub async fn run() -> Result<(), anyhow::Error> {
    if !is_compactor(&super::cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }

    if !CONFIG.compact.enabled {
        return Ok(());
    }

    tokio::task::spawn(async move { run_merge().await });
    tokio::task::spawn(async move { run_delete().await });
    tokio::task::spawn(async move { run_delete_files().await });
    tokio::task::spawn(async move { run_sync_to_db().await });

    Ok(())
}

/// Merge small files
async fn run_merge() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(CONFIG.compact.interval));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let locker = service::compact::QUEUE_LOCKER.clone();
        let locker = locker.lock().await;
        let ret = service::compact::run_merge().await;
        if ret.is_err() {
            log::error!("[COMPACTOR] run data merge error: {}", ret.err().unwrap());
        }
        drop(locker);
    }
}

/// Deletion for data retention
async fn run_delete() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(CONFIG.compact.interval + 1));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let locker = service::compact::QUEUE_LOCKER.clone();
        let locker = locker.lock().await;
        let ret = service::compact::run_delete().await;
        if ret.is_err() {
            log::error!("[COMPACTOR] run data delete error: {}", ret.err().unwrap());
        }
        drop(locker);
    }
}

/// Delete files based on the file_file_deleted in the database
async fn run_delete_files() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(CONFIG.compact.interval + 2));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let locker = service::compact::QUEUE_LOCKER.clone();
        let locker = locker.lock().await;
        let ret = service::compact::run_delete_files().await;
        if ret.is_err() {
            log::error!("[COMPACTOR] run files delete error: {}", ret.err().unwrap());
        }
        drop(locker);
    }
}

async fn run_sync_to_db() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(
        CONFIG.compact.sync_to_db_interval,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = service::db::compact::files::sync_cache_to_db().await;
        if ret.is_err() {
            log::error!(
                "[COMPACTOR] run offset sync cache to db error: {}",
                ret.err().unwrap()
            );
        } else {
            log::info!("[COMPACTOR] run offset sync cache to db done");
        }
    }
}
