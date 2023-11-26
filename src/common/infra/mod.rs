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

pub mod cache;
pub mod cluster;
pub mod config;
pub mod db;
pub mod dist_lock;
pub mod errors;
pub mod file_list;
pub mod ider;
pub mod metrics;
pub mod storage;
pub mod wal;

pub async fn init() -> Result<(), anyhow::Error> {
    ider::init()?;
    wal::init().await?;
    cache::init().await?;
    // init db
    db::init().await?;
    db::create_table().await?;
    file_list::create_table().await?;
    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    Ok(())
}
