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

mod cache;
mod watch;

pub use cache::cache;
use infra::{
    coordinator::get_coordinator,
    errors::{self, DbError},
    table::cipher::{CipherEntry, EntryKind},
};
pub use watch::watch;

pub const CIPHER_KEY_PREFIX: &str = "/cipher_keys/";

pub async fn add(entry: CipherEntry) -> Result<(), anyhow::Error> {
    match infra::table::cipher::add(entry.clone()).await {
        Ok(_) => {}
        Err(errors::Error::DbError(DbError::UniqueViolation)) => {
            return Err(anyhow::anyhow!("Key with given name already exists"));
        }
        Err(e) => {
            log::info!("error while saving cipher key to db : {e}");
            return Err(anyhow::anyhow!(e));
        }
    }

    if entry.kind == EntryKind::CipherKey {
        get_coordinator()
            .await
            .put(
                &format!("{CIPHER_KEY_PREFIX}{}/{}", entry.org, entry.name),
                bytes::Bytes::new(),
                true,
                None,
            )
            .await?;

        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::keys_put(entry.clone()).await {
                Ok(_) => log::info!(
                    "successfully sent key add notification to super cluster queue for {}/{}",
                    entry.org,
                    entry.name
                ),
                Err(e) => log::error!(
                    "error in sending cipher key add notification to super cluster queue for {}/{} : {e}",
                    entry.org,
                    entry.name
                ),
            }
        }
    }

    Ok(())
}

pub async fn update(entry: CipherEntry) -> Result<(), errors::Error> {
    infra::table::cipher::update(entry.clone()).await?;

    if entry.kind == EntryKind::CipherKey {
        get_coordinator()
            .await
            .put(
                &format!("{CIPHER_KEY_PREFIX}{}/{}", entry.org, entry.name),
                bytes::Bytes::new(),
                true,
                None,
            )
            .await?;

        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::keys_update(entry.clone()).await
            {
                Ok(_) => log::info!(
                    "successfully sent cipher key update notification to super cluster queue for {}/{}",
                    entry.org,
                    entry.name
                ),
                Err(e) => log::error!(
                    "error in sending cipher key update notification to super cluster queue for {}/{} : {e}",
                    entry.org,
                    entry.name
                ),
            }
        }
    }

    Ok(())
}

pub async fn remove(org: &str, kind: EntryKind, name: &str) -> Result<(), errors::Error> {
    infra::table::cipher::remove(org, kind, name).await?;

    if kind == EntryKind::CipherKey {
        get_coordinator()
            .await
            .delete(
                &format!("{CIPHER_KEY_PREFIX}{org}/{name}"),
                false,
                true,
                None,
            )
            .await?;

        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::keys_delete(org, name).await {
                Ok(_) => log::info!(
                    "successfully sent cipher key delete notification to super cluster queue for {org}/{name}"
                ),
                Err(e) => log::error!(
                    "error in sending cipher key delete notification to super cluster queue for {org}/{name} : {e}"
                ),
            }
        }
    }

    Ok(())
}
