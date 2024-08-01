// Copyright 2024 Zinc Labs Inc.
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

use schema::migrate_resource_names;
use version_compare::Version;

pub mod dashboards;
pub mod file_list;
pub mod meta;
pub mod schema;

pub async fn check_upgrade(old_ver: &str, new_ver: &str) -> Result<(), anyhow::Error> {
    let old_ver = Version::from(old_ver).unwrap();
    let new_ver = Version::from(new_ver).unwrap();
    let zero = Version::from("v0.0.0").unwrap();
    if old_ver == zero {
        // new install
        return Ok(());
    }
    if old_ver >= new_ver {
        return Ok(());
    }

    log::info!("Upgrading from {} to {}", old_ver, new_ver);
    let v053 = Version::from("v0.5.3").unwrap();
    if old_ver < v053 && new_ver.to_string().starts_with("v0.6.") {
        upgrade_052_053().await?;
        return Ok(());
    }

    let v093 = Version::from("v0.9.3").unwrap();
    if old_ver < v093 {
        upgrade_092_093().await?;
    }

    let v01010 = Version::from("0.10.9").unwrap();
    if old_ver < v01010 {
        upgrade_0109_01010().await?;
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

async fn upgrade_092_093() -> Result<(), anyhow::Error> {
    // migration schema
    schema::run().await?;

    Ok(())
}

async fn upgrade_0109_01010() -> Result<(), anyhow::Error> {
    migrate_resource_names().await?;

    Ok(())
}
