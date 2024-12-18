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

use bytes::Bytes;
use config::meta::destinations::Destination;
use infra::table;
use itertools::Itertools;

use crate::{common::infra::config::ALERTS_DESTINATIONS, service::db};

// db cache watcher prefix
const DESTINATION_WATCHER_PREFIX: &str = "/destinations/";

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
    let saved = table::destinations::put(org_id, destination).await?;

    // trigger watch event by putting empty value to cluster coordinator
    let cluster_coordinator = db::get_coordinator().await;
    cluster_coordinator
        .put(
            &format!("{DESTINATION_WATCHER_PREFIX}{}/{}", org_id, saved.name),
            Bytes::new(),
            db::NEED_WATCH,
            None,
        )
        .await?;

    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), DestinationError> {
    if table::destinations::get(org_id, name).await?.is_none() {
        return Err(DestinationError::NotFound);
    }
    table::destinations::delete(org_id, name).await?;

    // trigger watch event to delete from cache
    let cluster_coordinator = db::get_coordinator().await;
    cluster_coordinator
        .delete(
            &format!("{DESTINATION_WATCHER_PREFIX}{}/{}", org_id, name),
            false,
            db::NEED_WATCH,
            None,
        )
        .await?;

    Ok(())
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

    Ok(table::destinations::list(org_id).await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator
        .watch(DESTINATION_WATCHER_PREFIX)
        .await?;
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
                let (org_id, name) = match parse_event_key(DESTINATION_WATCHER_PREFIX, &ev.key) {
                    Ok(parsed) => parsed,
                    Err(e) => {
                        log::error!("{e}");
                        continue;
                    }
                };
                let item_value: Destination = match table::destinations::get(org_id, name).await {
                    Ok(Some(dest)) => dest,
                    Ok(None) => {
                        log::error!("Destination not found in db");
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting from db: {}", e);
                        continue;
                    }
                };
                ALERTS_DESTINATIONS.insert(format!("{org_id}/{name}"), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(DESTINATION_WATCHER_PREFIX).unwrap();
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

pub(super) fn parse_event_key<'a>(
    prefix: &'static str,
    event_key: &'a str,
) -> Result<(&'a str, &'a str), anyhow::Error> {
    let item_key = event_key
        .strip_prefix(prefix)
        .ok_or(anyhow::anyhow!("event key missing prefix"))?;
    let mut keys = item_key.split('/');
    let org_id = keys
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing org_id in event key"))?;
    let name = keys
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing name in event key"))?;

    if keys.next().is_some() {
        return Err(anyhow::anyhow!(
            "Error: event key not formatted correctly. Should be org_id/name, but got {}",
            item_key
        ));
    }

    Ok((org_id, name))
}
