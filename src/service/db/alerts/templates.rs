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

use config::{
    meta::destinations::{Module, Template},
    utils::json,
};
use infra::table;
use itertools::Itertools;

use crate::{
    common::{
        infra::config::{ALERTS_DESTINATIONS, ALERTS_TEMPLATES},
        meta::organization::DEFAULT_ORG,
    },
    service::db,
};

#[derive(Debug, thiserror::Error)]
pub enum TemplateError {
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),
    #[error("Template name cannot be empty")]
    EmptyName,
    #[error(
        "Template name cannot contain ':', '#', '?', '&', '%', '/', quotes and space characters"
    )]
    InvalidName,
    #[error("Email Template cannot have empty title")]
    EmptyTitle,
    #[error("Template body cannot be empty")]
    EmptyBody,
    #[error("Template with the same name already exists")]
    AlreadyExists,
    #[error("Template is in use for destination# {0}")]
    DeleteWithDestination(String),
    #[error("Template not found")]
    NotFound,
}

pub async fn get(org_id: &str, name: &str) -> Result<Template, TemplateError> {
    let map_key = format!("{org_id}/{name}");
    if let Some(v) = ALERTS_TEMPLATES.get(&map_key) {
        return Ok(v.value().clone());
    }
    let default_org_key = format!("{DEFAULT_ORG}/{name}");
    if let Some(v) = ALERTS_TEMPLATES.get(&default_org_key) {
        return Ok(v.value().clone());
    }

    if let Some(template) = table::templates::get(org_id, name).await? {
        return Ok(template);
    }
    table::templates::get(DEFAULT_ORG, name)
        .await?
        .ok_or(TemplateError::NotFound)
}

pub async fn set(org_id: &str, template: Template) -> Result<Template, TemplateError> {
    let saved = table::templates::put(org_id, template).await?;
    let key = format!("{}/{}", org_id, saved.name);
    ALERTS_TEMPLATES.insert(key, saved.clone());
    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), TemplateError> {
    for dest in ALERTS_DESTINATIONS.iter() {
        let d = dest.value();
        if dest.key().starts_with(org_id)
            && matches!(&d.module, Module::Alert { template, .. } if template.eq(name))
        {
            return Err(TemplateError::DeleteWithDestination(dest.name.to_string()));
        }
    }
    if table::templates::get(org_id, name).await?.is_none() {
        return Err(TemplateError::NotFound);
    };
    ALERTS_TEMPLATES.remove(&format!("{org_id}/{name}"));
    Ok(table::templates::delete(org_id, name).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<Template>, TemplateError> {
    let cache = ALERTS_TEMPLATES.clone();
    if !cache.is_empty() {
        return Ok(cache
            .into_iter()
            .filter_map(|(k, template)| {
                (k.starts_with(&format!("{org_id}/")) || k.starts_with(&format!("{DEFAULT_ORG}/")))
                    .then_some(template)
            })
            .sorted_by(|a, b| a.name.cmp(&b.name))
            .collect());
    }

    let mut items = table::templates::list(org_id).await?;
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

pub async fn _watch() -> Result<(), anyhow::Error> {
    let key = "/templates/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alert templates");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_templates: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: Template = if config::get_config().common.meta_store_external {
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
                ALERTS_TEMPLATES.insert(item_key.to_owned(), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ALERTS_TEMPLATES.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let all_temps = table::templates::list_all().await?;
    for (org, temp) in all_temps {
        let cache_key = format!("{}/{}", org, temp.name);
        ALERTS_TEMPLATES.insert(cache_key, temp);
    }
    log::info!("{} Templates Cached", ALERTS_TEMPLATES.len());
    Ok(())
}
