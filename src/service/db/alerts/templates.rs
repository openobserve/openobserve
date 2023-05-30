use std::sync::Arc;

use crate::common::json;
use crate::infra::config::ALERTS_TEMPLATES;
use crate::infra::db::Event;
use crate::meta::alert::DestinationTemplate;
use crate::meta::organization::DEFAULT_ORG;

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
        let db = &crate::infra::db::DEFAULT;
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
    let db = &crate::infra::db::DEFAULT;
    template.is_default = Some(org_id == DEFAULT_ORG);
    let key = format!("/templates/{org_id}/{name}");
    Ok(db
        .put(&key, json::to_vec(&template).unwrap().into())
        .await?)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/templates/{org_id}/{name}");
    Ok(db.delete(&key, false).await?)
}

pub async fn list(org_id: &str) -> Result<Vec<DestinationTemplate>, anyhow::Error> {
    Ok(ALERTS_TEMPLATES
        .iter()
        .filter_map(|template| {
            let k = template.key();
            (k.starts_with(&format!("{org_id}/")) || k.starts_with(&format!("{DEFAULT_ORG}/")))
                .then(|| template.value().clone())
        })
        .collect())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
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
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
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
