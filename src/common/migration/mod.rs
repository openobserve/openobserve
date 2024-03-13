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

pub mod dashboards;
pub mod file_list;
pub mod meta;
pub mod schema;

pub async fn check_upgrade(old_ver: &str, new_ver: &str) -> Result<(), anyhow::Error> {
    if !CONFIG.common.local_mode || old_ver >= new_ver {
        return Ok(());
    }
    if old_ver >= "v0.5.3" {
        return Ok(());
    }
    log::info!("Upgrading from {} to {}", old_ver, new_ver);
    if new_ver.starts_with("v0.6.") {
        upgrade_052_053().await?;
    }
    Ok(())
}

async fn upgrade_052_053() -> Result<(), anyhow::Error> {
    // migration for metadata
    meta::run("sled", "sqlite").await?;

    // migration for file_list
    file_list::run("", "sled", "sqlite").await?;

    Ok(())
}
