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

use std::sync::Arc;

use crate::common::infra::config::{ALERTS_TEMPLATES, CONFIG};
use crate::common::infra::db::Event;
use crate::common::meta::alert::DestinationTemplate;
use crate::common::meta::meta_store::MetaStore;
use crate::common::meta::organization::DEFAULT_ORG;
use crate::common::utils::json;

pub async fn get(org_id: &str, name: &str) -> Result<Option<DestinationTemplate>, anyhow::Error> {
    let map_key = format!("{org_id}/{name}");
    let default_org_key = format!("{DEFAULT_ORG}/{name}");
    let value: Option<DestinationTemplate> = if ALERTS_TEMPLATES.contains_key(&map_key)
        || ALERTS_TEMPLATES.contains_key(&default_org_key)
    {
        match ALERTS_TEMPLATES.get(&map_key) {
            Some(template) => Some(template.clone()),
            None => Some(ALERTS_TEMPLATES.get(&default_org_key).unwrap().clone()),
        }
    } else {
        let db = &crate::common::infra::db::DEFAULT;
        let key = format!("/templates/{org_id}/{name}");
        match db.get(&key).await {
            Ok(val) => json::from_slice(&val).unwrap(),
            Err(_) => {
                let key = format!("/templates/{DEFAULT_ORG}/{name}");
                match db.get(&key).await {
                    Ok(val) => json::from_slice(&val).unwrap(),
                    Err(_) => None,
                }
            }
        }
    };
    Ok(value)
}

pub async fn set(
    org_id: &str,
    name: &str,
    mut template: DestinationTemplate,
) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    template.is_default = Some(org_id == DEFAULT_ORG);
    let key = format!("/templates/{org_id}/{name}");
    Ok(db
        .put(&key, json::to_vec(&template).unwrap().into())
        .await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = format!("/templates/{org_id}/{name}");
    Ok(db.delete(&key, false).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<DestinationTemplate>, anyhow::Error> {
    if !CONFIG
        .common
        .meta_store
        .eq(&MetaStore::DynamoDB.to_string())
    {
        Ok(ALERTS_TEMPLATES
            .clone()
            .iter()
            .filter_map(|template| {
                let k = template.key();
                (k.starts_with(&format!("{org_id}/")) || k.starts_with(&format!("{DEFAULT_ORG}/")))
                    .then(|| template.value().clone())
            })
            .collect())
    } else {
        let db = &crate::common::infra::db::DEFAULT;
        let key = format!("/templates/{org_id}/", org_id = org_id);
        let ret = db.list(key.as_str()).await?;
        let mut templates = Vec::new();
        for (_, item_value) in ret {
            let json_val: DestinationTemplate = json::from_slice(&item_value).unwrap();
            templates.push(json_val);
        }
        Ok(templates)
    }
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/templates/";
    let mut events = db.watch(key).await?;
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
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: DestinationTemplate = json::from_slice(&ev.value.unwrap()).unwrap();
                ALERTS_TEMPLATES.insert(item_key.to_owned(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ALERTS_TEMPLATES.remove(item_key);
            }
            Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/templates/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: DestinationTemplate = json::from_slice(&item_value).unwrap();
        ALERTS_TEMPLATES.insert(item_key.to_owned(), json_val);
    }
    log::info!("Alert templates Cached");
    Ok(())
}
