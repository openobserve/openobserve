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

use config::utils::json;
use infra::{
    db::put_into_db_coordinator,
    errors::{self, Error},
    table::organizations,
};

// #[cfg(feature = "cloud")]
// use o2_enterprise::enterprise::cloud::org_usage::{self, OrgUsageRecord};
use crate::{
    common::{
        infra::config::{ORGANIZATION_SETTING, ORGANIZATIONS},
        meta::organization::{Organization, OrganizationSetting},
    },
    service::db,
};

// DBKey to set settings for an org
pub const ORG_SETTINGS_KEY_PREFIX: &str = "/organization/setting";

pub const ORG_KEY_PREFIX: &str = "/organization/org/";

pub async fn set_org_setting(org_name: &str, setting: &OrganizationSetting) -> errors::Result<()> {
    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_name}");
    db::put(
        &key,
        json::to_vec(&setting).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await?;

    // cache the org setting
    ORGANIZATION_SETTING
        .clone()
        .write()
        .await
        .insert(key.to_string(), setting.clone());
    Ok(())
}

pub async fn get_org_setting(org_id: &str) -> Result<OrganizationSetting, Error> {
    #[cfg(not(feature = "cloud"))]
    let trial_period_expiry = None;
    #[cfg(feature = "cloud")]
    let trial_period_expiry = {
        use o2_enterprise::enterprise::{
            cloud::billings, common::config::get_config as get_o2_config,
        };
        let o2_config = get_o2_config();

        // if trial period check is disabled, everything is free trial period
        if !o2_config.cloud.trial_period_enabled || org_id == "_meta" {
            None
        } else {
            // first check if the org is
            let subscription = billings::get_billing_by_org_id(org_id).await.ok();
            match subscription {
                None | Some(None) => match infra::table::organizations::get(org_id).await {
                    Ok(org) => Some(org.trial_ends_at),
                    Err(_) => None,
                },
                Some(Some(s)) if s.subscription_type.is_free_sub() => {
                    match infra::table::organizations::get(org_id).await {
                        Ok(org) => Some(org.trial_ends_at),
                        Err(_) => None,
                    }
                }
                _ => None,
            }
        }
    };

    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
    if let Some(v) = ORGANIZATION_SETTING.read().await.get(&key) {
        let mut ret = v.clone();
        ret.free_trial_expiry = trial_period_expiry;
        return Ok(ret);
    }

    // Try to get settings from DB, but use default if not found
    let mut settings: OrganizationSetting = match db::get(&key).await {
        Ok(settings) => json::from_slice(&settings)?,
        Err(Error::DbError(infra::errors::DbError::KeyNotExists(_))) => {
            OrganizationSetting::default()
        }
        Err(e) => return Err(e),
    };

    // Cache the org setting (even if it's default)
    ORGANIZATION_SETTING
        .write()
        .await
        .insert(key.to_string(), settings.clone());
    settings.free_trial_expiry = trial_period_expiry;
    Ok(settings)
}

/// Get the toggle ingestion logs setting for an org
/// If the setting is not found, return false
/// we add a separate function for avoid clone the setting
pub async fn get_org_setting_toggle_ingestion_logs(org_id: &str) -> Result<bool, Error> {
    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
    if let Some(v) = ORGANIZATION_SETTING.read().await.get(&key) {
        return Ok(v.toggle_ingestion_logs);
    }

    // Try to get settings from DB, but use default if not found
    let settings: OrganizationSetting = match db::get(&key).await {
        Ok(settings) => json::from_slice(&settings)?,
        Err(Error::DbError(infra::errors::DbError::KeyNotExists(_))) => {
            OrganizationSetting::default()
        }
        Err(e) => return Err(e),
    };
    let toggle_ingestion_logs = settings.toggle_ingestion_logs;

    // Cache the org setting (even if it's default)
    ORGANIZATION_SETTING
        .write()
        .await
        .insert(key.to_string(), settings);
    Ok(toggle_ingestion_logs)
}

/// Cache the existing org settings in the beginning
pub async fn org_settings_cache() -> Result<(), anyhow::Error> {
    let prefix = ORG_SETTINGS_KEY_PREFIX;
    let ret = db::list(prefix).await?;
    for (key, item_value) in ret {
        let json_val: OrganizationSetting = json::from_slice(&item_value).unwrap();
        ORGANIZATION_SETTING
            .clone()
            .write()
            .await
            .insert(key, json_val);
    }
    log::info!("Organization settings Cached");
    Ok(())
}

pub async fn org_settings_watch() -> Result<(), anyhow::Error> {
    let key = ORG_SETTINGS_KEY_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching organization settings");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_settings: event channel closed");
                return Ok(());
            }
        };

        if let db::Event::Put(ev) = ev {
            let item_key = ev.key;
            let json_val: OrganizationSetting = match db::get(&item_key).await {
                Ok(val) => match json::from_slice(&val) {
                    Ok(val) => val,
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                },
                Err(e) => {
                    log::error!("Error getting value: {e}");
                    continue;
                }
            };
            ORGANIZATION_SETTING
                .clone()
                .write()
                .await
                .insert(item_key, json_val);
        }
    }
}

/// Cache the existing orgs in the beginning
pub async fn cache() -> Result<(), anyhow::Error> {
    let orgs = list(None).await?;
    for org in orgs {
        ORGANIZATIONS
            .clone()
            .write()
            .await
            .insert(org.identifier.clone(), org);
    }
    log::info!("Organizations Cached");
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = ORG_KEY_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching organizations");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_orgs: event channel closed");
                return Ok(());
            }
        };

        if let db::Event::Put(ev) = ev {
            let item_key = ev.key.strip_prefix(key).unwrap();
            let item_value = ev.value.unwrap();
            let json_val: Organization = if !config::get_config().common.local_mode {
                match get_org_from_db(item_key).await {
                    Ok(val) => val,
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                }
            } else {
                json::from_slice(&item_value).unwrap()
            };
            organizations::invalidate_cache(Some(item_key)).await;
            ORGANIZATIONS
                .clone()
                .write()
                .await
                .insert(item_key.to_string(), json_val);
        }
    }
}

pub async fn save_org(entry: &Organization) -> Result<(), anyhow::Error> {
    let org_name = entry.name.trim();
    if org_name.is_empty() {
        return Err(anyhow::anyhow!("Organization name cannot be empty"));
    }
    if let Err(e) = organizations::add(
        &entry.identifier,
        org_name,
        entry.org_type.as_str().parse().unwrap(),
    )
    .await
    {
        log::error!("Error saving org: {e}");
        return Err(anyhow::anyhow!("Error saving org: {}", e));
    }
    organizations::invalidate_cache(Some(&entry.identifier)).await;

    let key = format!("{}{}", ORG_KEY_PREFIX, entry.identifier);
    let _ = put_into_db_coordinator(&key, json::to_vec(entry).unwrap().into(), true, None).await;

    #[cfg(feature = "enterprise")]
    super_cluster::organization_add(&key, entry).await?;
    Ok(())
}

pub async fn rename_org(org_id: &str, new_name: &str) -> Result<Organization, anyhow::Error> {
    if new_name.trim().is_empty() {
        return Err(anyhow::anyhow!("Organization name cannot be empty"));
    }
    if let Err(e) = organizations::rename(org_id, new_name).await {
        log::error!("Error updating org: {e}");
        return Err(anyhow::anyhow!("Error updating org: {}", e));
    }
    organizations::invalidate_cache(Some(org_id)).await;
    let org = get_org(org_id).await?;
    let key = format!("{ORG_KEY_PREFIX}{org_id}");
    let _ = put_into_db_coordinator(&key, json::to_vec(&org).unwrap().into(), true, None).await;

    #[cfg(feature = "enterprise")]
    super_cluster::organization_rename(&key, &org).await?;
    Ok(org)
}

pub async fn get_org_from_db(org_id: &str) -> Result<Organization, anyhow::Error> {
    let org = organizations::get(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("Error getting org: {}", e))?;
    Ok(Organization {
        identifier: org.identifier,
        name: org.org_name,
        org_type: org.org_type.to_string(),
        service_account: None,
    })
}

pub async fn get_org(org_id: &str) -> Result<Organization, anyhow::Error> {
    if let Some(org) = ORGANIZATIONS.read().await.get(org_id) {
        return Ok(org.clone());
    }
    let org = organizations::get(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("Error getting org: {}", e))?;
    Ok(Organization {
        identifier: org.identifier,
        name: org.org_name,
        org_type: org.org_type.to_string(),
        service_account: None,
    })
}

pub async fn delete_org(org_id: &str) -> Result<(), anyhow::Error> {
    if let Err(e) = organizations::remove(org_id).await {
        log::error!("Error deleting org: {e}");
        return Err(anyhow::anyhow!("Error deleting org: {}", e));
    }
    organizations::invalidate_cache(Some(org_id)).await;
    #[cfg(feature = "enterprise")]
    super_cluster::organization_delete(&format!("{ORG_KEY_PREFIX}{org_id}")).await?;
    Ok(())
}

pub(crate) async fn list(limit: Option<i64>) -> Result<Vec<Organization>, anyhow::Error> {
    let filter = organizations::ListFilter::with_limit(limit);
    let orgs = organizations::list(filter)
        .await
        .map_err(|e| anyhow::anyhow!("Error listing orgs: {}", e))?;
    Ok(orgs
        .into_iter()
        .map(|org| Organization {
            identifier: org.identifier,
            name: org.org_name,
            org_type: org.org_type.to_string(),
            service_account: None,
        })
        .collect())
}

#[cfg(feature = "enterprise")]
mod super_cluster {
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    use crate::common::meta::organization::Organization;

    pub async fn organization_add(
        key: &str,
        org: &Organization,
    ) -> Result<(), infra::errors::Error> {
        let value = config::utils::json::to_vec(org)?.into();
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::organization_add(
                key,
                value,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn organization_rename(
        key: &str,
        org: &Organization,
    ) -> Result<(), infra::errors::Error> {
        let value = config::utils::json::to_vec(org)?.into();
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::organization_rename(
                key,
                value,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn organization_delete(key: &str) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::organization_delete(
                key,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }
}
