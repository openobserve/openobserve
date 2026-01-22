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

use std::sync::Arc;

use infra::{
    coordinator::get_coordinator,
    db::Event,
    errors::{self, DbError},
    table::source_maps::SourceMap,
};

use crate::service::db;

// DBKey to set cipher keys
pub const SOURCEMAP_PREFIX: &str = "/sourcemaps/";

pub async fn add_many(entries: Vec<SourceMap>) -> Result<(), anyhow::Error> {
    match infra::table::source_maps::add_many(entries.clone()).await {
        Ok(_) => {}
        Err(errors::Error::DbError(DbError::UniqueViolation)) => {
            return Err(anyhow::anyhow!("One of the sourcemaps already exists"));
        }
        Err(e) => {
            log::info!("error while saving sourcemap to db : {e}");
            return Err(anyhow::anyhow!(e));
        }
    }

    for entry in entries {
        // trigger watch event by putting value to cluster coordinator
        let cluster_coordinator = get_coordinator().await;
        cluster_coordinator
            .put(
                SOURCEMAP_PREFIX,
                serde_json::to_vec(&entry)?.into(),
                true,
                None,
            )
            .await?;

        // TODO: handle SC
        #[cfg(feature = "enterprise")]
        {
            let config = o2_enterprise::enterprise::common::config::get_config();
            if config.super_cluster.enabled {
                match o2_enterprise::enterprise::super_cluster::queue::keys_put(entry.clone()).await
                {
                    Ok(_) => {
                        log::info!(
                            "successfully sent key add notification to super cluster queue for {}/{}",
                            entry.org,
                            entry.name
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "error in sending cipher key add notification to super cluster queue for {}/{} : {e}",
                            entry.org,
                            entry.name
                        );
                    }
                }
            }
        }
    }

    Ok(())
}

pub async fn get_sourcemap_file(
    org: &str,
    source_file: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Option<String>, anyhow::Error> {
    let ret =
        infra::table::source_maps::get_sourcemap_file_name(org, source_file, service, env, version)
            .await?;
    Ok(ret)
}

pub async fn list_files(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Vec<SourceMap>, errors::Error> {
    let ret = infra::table::source_maps::list_files(org, service, env, version).await?;
    Ok(ret)
}

pub async fn delete_group(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<(), errors::Error> {
    infra::table::source_maps::delete_group(org, service.clone(), env.clone(), version.clone())
        .await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .delete(
            &format!(
                "{SOURCEMAP_PREFIX}{org}/{}/{}/{}",
                service.unwrap_or_default(),
                env.unwrap_or_default(),
                version.unwrap_or_default()
            ),
            false,
            true,
            None,
        )
        .await?;

    // TODO: handle SC
    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::keys_delete(org, name).await {
                Ok(_) => {
                    log::info!(
                        "successfully sent cipher key delete notification to super cluster queue for {org}/{name}"
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending cipher key delete notification to super cluster queue for {org}/{name} : {e}"
                    );
                }
            }
        }
    }

    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let prefix = SOURCEMAP_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching sourcemaps keys");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_sourcemaps: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                // TODO: handle after cache is setup
                // let item_key = ev.key.strip_prefix(prefix).unwrap();
                // let (org, name) = item_key.split_once("/").unwrap();
            }
            Event::Delete(ev) => {
                // TODO: handle after cache is setup
                // let item_key = ev.key.strip_prefix(prefix).unwrap();
                // let (org, name) = item_key.split_once("/").unwrap();
            }
            Event::Empty => {}
        }
    }
}
