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

//! The org's items a downtime can cover, with identities read from their definitions.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant},
};

use config::meta::{
    alerts::alert::Alert,
    correlation::FieldAlias,
    folder::Folder,
    slo::{SliConfig, Slo},
    synthetics::ListSyntheticsParams,
};
use o2_enterprise::enterprise::{
    downtimes::scope::{anomaly_dimensions, slo_dimensions},
    oncall::routing::dimensions_for_alert,
};

use super::matching::{Inventory, Item};

/// Counts and banners read the inventory at most this stale.
const INVENTORY_TTL: Duration = Duration::from_secs(60);

/// `org -> (loaded at, inventory)`.
type InventoryCache = RwLock<HashMap<String, (Instant, Arc<Inventory>)>>;

static INVENTORIES: LazyLock<InventoryCache> = LazyLock::new(Default::default);

/// The inventory of an org, reloaded when older than a minute.
pub async fn cached(org: &str) -> Result<Arc<Inventory>, anyhow::Error> {
    let fresh = INVENTORIES
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(org)
        .filter(|(at, _)| at.elapsed() < INVENTORY_TTL)
        .map(|(_, inventory)| inventory.clone());
    if let Some(inventory) = fresh {
        return Ok(inventory);
    }
    let inventory = Arc::new(load(org).await?);
    INVENTORIES
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .insert(org.to_string(), (Instant::now(), inventory.clone()));
    Ok(inventory)
}

pub async fn load(org: &str) -> Result<Inventory, anyhow::Error> {
    let groups = db::system_settings::get_semantic_field_groups(org).await;
    let alerts = cached_alerts(org).await;
    let slos = infra::table::slos::list(infra::db::get_orm_client_ro().await, org, None).await?;
    Ok(Inventory {
        alerts: alert_items(&alerts, &slos, &groups),
        anomalies: anomaly_items(org, &groups).await?,
        synthetics: synthetic_items(org).await?,
        slos: slos
            .iter()
            .map(|slo| slo_item(slo, &groups, &alerts))
            .collect(),
    })
}

async fn cached_alerts(org: &str) -> Vec<(Folder, Alert)> {
    let prefix = format!("{org}/");
    common::infra::config::ALERTS
        .read()
        .await
        .iter()
        .filter(|(key, _)| key.starts_with(&prefix))
        .map(|(_, value)| value.clone())
        .collect()
}

/// An SLO alert runs no query, so it takes the identity of its SLO (WP4 item 3a).
fn alert_items(alerts: &[(Folder, Alert)], slos: &[Slo], groups: &[FieldAlias]) -> Vec<Item> {
    alerts
        .iter()
        .filter_map(|(folder, alert)| {
            let id = alert.id?.to_string();
            let dims = match &alert.query_condition.slo_condition {
                Some(condition) => slos
                    .iter()
                    .find(|slo| slo.id == condition.slo_id)
                    .map(|slo| slo_item(slo, groups, alerts).dims)
                    .unwrap_or_default(),
                None => dimensions_for_alert(groups, &alert.query_condition, &Default::default()),
            };
            Some(Item {
                id,
                name: alert.name.clone(),
                folder_id: folder.folder_id.clone(),
                dims,
                tags: alert.tags.clone(),
                ..Default::default()
            })
        })
        .collect()
}

fn slo_item(slo: &Slo, groups: &[FieldAlias], alerts: &[(Folder, Alert)]) -> Item {
    let source = match &slo.definition.sli_config {
        SliConfig::Alert { alert_id } => alerts
            .iter()
            .find(|(_, alert)| alert.id.is_some_and(|id| id.to_string() == *alert_id))
            .map(|(_, alert)| &alert.query_condition),
        _ => None,
    };
    let untagged = Slo {
        tags: vec![],
        ..slo.clone()
    };
    Item {
        id: slo.id.clone(),
        name: slo.name.clone(),
        folder_id: slo.folder_id.clone(),
        dims: slo_dimensions(slo, groups, source),
        tags: slo.tags.clone(),
        measured: slo_dimensions(&untagged, groups, source),
        measured_by: if matches!(slo.definition.sli_config, SliConfig::Alert { .. }) {
            "source_alert"
        } else {
            "query"
        },
    }
}

async fn anomaly_items(org: &str, groups: &[FieldAlias]) -> Result<Vec<Item>, anyhow::Error> {
    let conn = infra::db::get_orm_client_ro().await;
    let configs = infra::table::anomaly_detection::config::list_by_org(conn, org).await?;
    let mut slugs: HashMap<String, String> = HashMap::new();
    let mut items = Vec::with_capacity(configs.len());
    for config in configs {
        let folder_id = match slugs.get(&config.folder_id) {
            Some(slug) => slug.clone(),
            None => {
                let slug = infra::table::folders::get_name_by_pk(&config.folder_id)
                    .await?
                    .unwrap_or_else(|| config.folder_id.clone());
                slugs.insert(config.folder_id.clone(), slug.clone());
                slug
            }
        };
        let tags: Vec<String> = config
            .tags
            .and_then(|t| serde_json::from_value(t).ok())
            .unwrap_or_default();
        items.push(Item {
            dims: anomaly_dimensions(config.custom_sql.as_deref(), &tags, groups),
            id: config.anomaly_id,
            name: config.name,
            folder_id,
            tags,
            ..Default::default()
        });
    }
    Ok(items)
}

async fn synthetic_items(org: &str) -> Result<Vec<Item>, anyhow::Error> {
    let checks =
        openobserve_synthetics::service::list_synthetics(org, &ListSyntheticsParams::default())
            .await?
            .checks;
    Ok(checks
        .into_iter()
        .map(|check| Item {
            id: check.id,
            name: check.name,
            folder_id: check.folder_id,
            tags: check.tags,
            ..Default::default()
        })
        .collect())
}
