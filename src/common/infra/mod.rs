// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
    wal::init()?;
    cache::init()?;
    // init db
    db::create_table().await?;
    file_list::create_table().await?;
    Ok(())
}
