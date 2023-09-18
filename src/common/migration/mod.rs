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

use crate::common::infra::config::CONFIG;

pub mod file_list;
pub mod meta;

pub async fn check_upgrade(old_ver: &str, new_ver: &str) -> Result<(), anyhow::Error> {
    if !CONFIG.common.local_mode || old_ver >= new_ver {
        return Ok(());
    }
    if old_ver >= "v0.5.3" {
        return Ok(());
    }
    log::info!("Upgrading from {} to {}", old_ver, new_ver);
    match (old_ver, new_ver) {
        (_, "v0.6.0") | (_, "v0.6.1") => upgrade_052_053().await,
        _ => Ok(()),
    }
}

async fn upgrade_052_053() -> Result<(), anyhow::Error> {
    // migration for metadata
    meta::run().await?;

    // migration for file_list
    file_list::run("").await?;

    Ok(())
}
