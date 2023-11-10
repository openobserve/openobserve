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

use crate::common::{
    infra::{config::ALERTS_TEMPLATES, db as infra_db},
    meta::{alert::DestinationTemplate, organization::DEFAULT_ORG},
    utils::json,
};

pub async fn get(org_id: &str, name: &str) -> Result<DestinationTemplate, anyhow::Error> {
    let map_key = format!("{org_id}/{name}");
    if let Some(v) = ALERTS_TEMPLATES.get(&map_key) {
        return Ok(v.value().clone());
    }
    let default_org_key = format!("{DEFAULT_ORG}/{name}");
    if let Some(v) = ALERTS_TEMPLATES.get(&default_org_key) {
        return Ok(v.value().clone());
    }

    let db = &infra_db::DEFAULT;
    let key = format!("/templates/{org_id}/{name}");
    if let Ok(val) = db.get(&key).await {
        return Ok(json::from_slice(&val).unwrap());
    }
    let key = format!("/templates/{DEFAULT_ORG}/{name}");
    Ok(json::from_slice(&db.get(&key).await?).unwrap())
}

pub async fn set(
    org_id: &str,
    name: &str,
    mut template: DestinationTemplate,
) -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    template.is_default = Some(org_id == DEFAULT_ORG);
    let key = format!("/templates/{org_id}/{name}");
    Ok(db
        .put(
            &key,
            json::to_vec(&template).unwrap().into(),
            infra_db::NEED_WATCH,
        )
        .await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = format!("/templates/{org_id}/{name}");
    Ok(db.delete(&key, false, infra_db::NEED_WATCH).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<DestinationTemplate>, anyhow::Error> {
    let cache = ALERTS_TEMPLATES.clone();
    if !cache.is_empty() {
        Ok(cache
            .iter()
            .filter_map(|template| {
                let k = template.key();
                (k.starts_with(&format!("{org_id}/")) || k.starts_with(&format!("{DEFAULT_ORG}/")))
                    .then(|| template.value().clone())
            })
            .collect())
    } else {
        let db = &infra_db::DEFAULT;
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
    let key = "/templates/";
    let db = &infra_db::CLUSTER_COORDINATOR;
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
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: DestinationTemplate = json::from_slice(&ev.value.unwrap()).unwrap();
                ALERTS_TEMPLATES.insert(item_key.to_owned(), item_value);
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                ALERTS_TEMPLATES.remove(item_key);
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
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
