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

use config::meta::destinations::{Module, Template};
use infra::table;
use itertools::Itertools;

use crate::{
    common::{
        infra::config::{ALERTS, ALERTS_TEMPLATES, DESTINATIONS},
        meta::organization::DEFAULT_ORG,
    },
    service::db,
};

// db cache watcher prefix
const TEMPLATE_WATCHER_PREFIX: &str = "/templates/";

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
    #[error("Template is in use for destination {0}")]
    DeleteWithDestination(String),
    #[error("Template is in use for alert {0}")]
    DeleteWithAlert(String),
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

pub async fn set(template: Template) -> Result<Template, TemplateError> {
    let saved = table::templates::put(template).await?;

    // trigger watch event to update in-memory cache
    let event_key = format!("{TEMPLATE_WATCHER_PREFIX}{}/{}", saved.org_id, saved.name);
    // in-cluster
    infra::coordinator::destinations::emit_put_event(&event_key).await?;
    // super cluster
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::templates_put(
            &event_key,
            saved.clone(),
        )
        .await
    {
        log::error!(
            "[Template] error triggering super cluster event to add template to cache: {e}"
        );
    }

    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), TemplateError> {
    // Check if template is used by any destination
    for dest in DESTINATIONS.iter() {
        let d = dest.value();
        if (dest.key().starts_with(org_id) || dest.key().starts_with(DEFAULT_ORG))
            && matches!(&d.module, Module::Alert { template: Some(t), .. } if t.eq(name))
        {
            return Err(TemplateError::DeleteWithDestination(dest.name.to_string()));
        }
    }

    // Check if template is used by any alert directly
    let alerts_cache = ALERTS.read().await;
    for (key, (_folder, alert)) in alerts_cache.iter() {
        if (key.starts_with(org_id) || key.starts_with(DEFAULT_ORG))
            && alert.template.as_ref().is_some_and(|t| t.eq(name))
        {
            return Err(TemplateError::DeleteWithAlert(alert.name.to_string()));
        }
    }
    drop(alerts_cache);

    let event_key = match table::templates::get(org_id, name).await? {
        None => return Err(TemplateError::NotFound),
        Some(temp) => format!("{TEMPLATE_WATCHER_PREFIX}{}/{}", temp.org_id, temp.name),
    };

    table::templates::delete(org_id, name).await?;

    // trigger watch event to update in-memory cache
    // in-cluster
    infra::coordinator::destinations::emit_delete_event(&event_key).await?;
    // super cluster
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::templates_delete(
            &event_key, org_id, name,
        )
        .await
    {
        log::error!(
            "[Template] error triggering super cluster event to remove template from cache: {e}"
        );
    }

    Ok(())
}

pub async fn list(org_id: &str) -> Result<Vec<Template>, TemplateError> {
    let cache = ALERTS_TEMPLATES.clone();
    if !cache.is_empty() {
        return Ok(cache
            .into_iter()
            .filter_map(|(k, template)| {
                let is_org_template = k.starts_with(&format!("{org_id}/"));
                // do not return default org's template for cloud version
                let is_default_template =
                    !cfg!(feature = "cloud") && k.starts_with(&format!("{DEFAULT_ORG}/"));
                (is_org_template || is_default_template).then_some(template)
            })
            .sorted_by(|a, b| a.name.cmp(&b.name))
            .collect());
    }

    Ok(table::templates::list(org_id).await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(TEMPLATE_WATCHER_PREFIX).await?;
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
                let (org_id, name) =
                    match super::destinations::parse_event_key(TEMPLATE_WATCHER_PREFIX, &ev.key) {
                        Ok(parsed) => parsed,
                        Err(e) => {
                            log::error!("{e}");
                            continue;
                        }
                    };
                let item_value: Template = match table::templates::get(org_id, name).await {
                    Ok(Some(val)) => val,
                    Ok(None) => {
                        log::error!("Template not found in db");
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting from db: {e}");
                        continue;
                    }
                };
                ALERTS_TEMPLATES.insert(format!("{org_id}/{name}"), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(TEMPLATE_WATCHER_PREFIX).unwrap();
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
