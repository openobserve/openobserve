// Copyright 2024 OpenObserve Inc.
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

use config::{meta::destinations::Destination, utils::json};
use infra::table;
use itertools::Itertools;

use crate::{common::infra::config::ALERTS_DESTINATIONS, service::db};

#[derive(Debug, thiserror::Error)]
pub enum DestinationError {
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),
    #[error("Destination must contain either template or pipeline id")]
    UnsupportedType,
    #[error("Destination name cannot be empty")]
    EmptyName,
    #[error(
        "Destination name cannot contain ':', '#', '?', '&', '%', '/', quotes and space characters"
    )]
    InvalidName,
    #[error("HTTP destination must have a url")]
    EmptyUrl,
    #[error("SNS destination must have Topic ARN and Region")]
    InvalidSns,
    #[error("Email destination must have at least one email recipient")]
    EmptyEmail,
    #[error("Email destination recipients must be part of this org")]
    UserNotPermitted,
    #[error("Email destination must have SMTP configured")]
    SMTPUnavailable,
    #[error("Alert destination must have a template")]
    TemplateNotFound,
    #[error("Pipeline destination must have a pipeline id")]
    EmptyPipelineId,
    #[error("Destination with the same name already exists")]
    AlreadyExists,
    #[error("Destination not found")]
    NotFound,
    #[error("Destination is in use for alert# {0}")]
    InUse(String),
}

pub async fn get(org_id: &str, name: &str) -> Result<Destination, DestinationError> {
    let map_key = format!("{org_id}/{name}");
    if let Some(val) = ALERTS_DESTINATIONS.get(&map_key) {
        return Ok(val.value().clone());
    }
    table::destinations::get(org_id, name)
        .await?
        .ok_or(DestinationError::NotFound)
}

pub async fn set(org_id: &str, destination: Destination) -> Result<Destination, DestinationError> {
    let key = format!("{org_id}/{}", destination.name);
    let saved = table::destinations::put(org_id, destination).await?;
    ALERTS_DESTINATIONS.insert(key, saved.clone());
    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), DestinationError> {
    ALERTS_DESTINATIONS.remove(&format!("{org_id}/{name}"));
    if table::destinations::get(org_id, name).await?.is_none() {
        return Err(DestinationError::NotFound);
    }
    Ok(table::destinations::delete(org_id, name).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<Destination>, DestinationError> {
    let cache = ALERTS_DESTINATIONS.clone();
    if !cache.is_empty() {
        return Ok(cache
            .iter()
            .filter_map(|dest| {
                let k = dest.key();
                (k.starts_with(&format!("{org_id}/"))).then(|| dest.value().clone())
            })
            .sorted_by(|a, b| a.name.cmp(&b.name))
            .collect());
    }

    let mut items: Vec<Destination> = table::destinations::list(org_id).await?;
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

pub async fn _watch() -> Result<(), anyhow::Error> {
    let key = "/destinations/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alert destinations");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_destinations: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Destination = if config::get_config().common.meta_store_external {
                    match db::get(&ev.key).await {
                        Ok(val) => match json::from_slice(&val) {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error getting value: {}", e);
                                continue;
                            }
                        },
                        Err(e) => {
                            log::error!("Error getting value: {}", e);
                            continue;
                        }
                    }
                } else {
                    json::from_slice(&ev.value.unwrap()).unwrap()
                };
                ALERTS_DESTINATIONS.insert(item_key.to_owned(), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ALERTS_DESTINATIONS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let all_dest = table::destinations::list_all().await?;
    for dest in all_dest {
        let item_key = format!("{}/{}", dest.org_id, dest.name);
        ALERTS_DESTINATIONS.insert(item_key, dest);
    }
    log::info!("{} destinations Cached", ALERTS_DESTINATIONS.len());
    Ok(())
}
