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

use std::{collections::HashSet, str::FromStr};

use config::{
    meta::{
        alerts::alert::{Alert, ListAlertsParams},
        folder::{DEFAULT_FOLDER, Folder},
        stream::StreamType,
    },
    utils::time::now_micros,
};
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    table::alerts as table,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use svix_ksuid::Ksuid;

use crate::{
    common::infra::config::{ALERTS, STREAM_ALERTS},
    service::{alerts::alert::get_folder_alert_by_id_db, db},
};

/// Gets the alert and its parent folder.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<Option<(Folder, Alert)>, infra::errors::Error> {
    if let Some(alert_folder) = ALERTS
        .read()
        .await
        .get(&cache_alert_key(org_id, &scheduler_key(Some(alert_id))))
    {
        return Ok(Some(alert_folder.to_owned()));
    }
    let folder_and_alert = table::get_by_id(conn, org_id, alert_id).await?;
    Ok(folder_and_alert)
}

pub async fn get_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<Option<Alert>, infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let alert =
        table::get_by_name(client, org_id, "default", stream_type, stream_name, name).await?;
    let value = alert.map(|(_f, a)| a);
    Ok(value)
}

pub async fn set(org_id: &str, alert: Alert, create: bool) -> Result<Alert, infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match table::put(client, org_id, "default", alert).await {
        Ok(alert) => {
            infra::coordinator::alerts::emit_put_event(org_id, &alert, None).await?;
            #[cfg(feature = "enterprise")]
            if create {
                super_cluster::emit_create_event(org_id, "default", alert.clone()).await?;
            } else {
                super_cluster::emit_update_event(org_id, None, alert.clone()).await?;
            }

            let schedule_key = scheduler_key(alert.id);
            // Get the trigger from scheduler
            let mut trigger = db::scheduler::Trigger {
                org: org_id.to_string(),
                module_key: schedule_key.clone(),
                next_run_at: now_micros(),
                is_realtime: alert.is_real_time,
                is_silenced: false,
                ..Default::default()
            };

            if create {
                match db::scheduler::push(trigger).await {
                    Ok(_) => Ok(alert),
                    Err(e) => {
                        log::error!("Failed to save trigger for alert {schedule_key}: {e}");
                        Err(e)
                    }
                }
            } else {
                match db::scheduler::get(org_id, db::scheduler::TriggerModule::Alert, &schedule_key)
                    .await
                {
                    Ok(job) => {
                        trigger.data = job.data;
                        trigger.start_time = job.start_time;
                        match db::scheduler::update_trigger(trigger, false, "").await {
                            Ok(_) => Ok(alert),
                            Err(e) => {
                                log::error!(
                                    "Failed to update trigger for alert {schedule_key}: {e}"
                                );
                                Ok(alert)
                            }
                        }
                    }
                    Err(_) => match db::scheduler::push(trigger).await {
                        Ok(_) => Ok(alert),
                        Err(e) => {
                            log::error!("Failed to save trigger for alert {schedule_key}: {e}");
                            Ok(alert)
                        }
                    },
                }
            }
        }
        Err(e) => Err(e),
    }
}

pub async fn set_without_updating_trigger(org_id: &str, alert: Alert) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(alert_id) = alert.id else {
        return Err(anyhow::anyhow!("Alert ID is required"));
    };
    let (_f, _) = get_folder_alert_by_id_db(org_id, alert_id).await?;
    let alert = table::update(client, org_id, None, alert).await?;
    infra::coordinator::alerts::emit_put_event(org_id, &alert, None).await?;
    #[cfg(feature = "enterprise")]
    if alert.id.is_some() {
        super_cluster::emit_update_event(org_id, None, alert.clone()).await?;
    } else {
        super_cluster::emit_create_event(org_id, &_f.folder_id, alert.clone()).await?;
    }
    Ok(())
}

pub async fn create<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: &str,
    alert: Alert,
    overwrite: bool,
) -> Result<Alert, infra::errors::Error> {
    let alert = table::create(conn, org_id, folder_id, alert, overwrite).await?;
    let schedule_key = scheduler_key(alert.id);

    infra::coordinator::alerts::emit_put_event(org_id, &alert, Some(folder_id.to_string())).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_create_event(org_id, folder_id, alert.clone()).await?;

    let trigger = db::scheduler::Trigger {
        org: org_id.to_string(),
        module_key: schedule_key.clone(),
        next_run_at: now_micros(),
        is_realtime: alert.is_real_time,
        is_silenced: false,
        ..Default::default()
    };

    let _ = db::scheduler::push(trigger).await.map_err(|e| {
        log::error!("Failed to save trigger for alert {schedule_key}: {e}");
        e
    });

    Ok(alert)
}

pub async fn update<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_id: Option<&str>,
    alert: Alert,
) -> Result<Alert, infra::errors::Error> {
    let alert = table::update(conn, org_id, folder_id, alert).await?;
    let schedule_key = scheduler_key(alert.id);

    infra::coordinator::alerts::emit_put_event(org_id, &alert, folder_id.map(|id| id.to_string()))
        .await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_update_event(org_id, folder_id, alert.clone()).await?;

    let mut trigger = db::scheduler::Trigger {
        org: org_id.to_string(),
        module_key: schedule_key.clone(),
        next_run_at: now_micros(),
        is_realtime: alert.is_real_time,
        is_silenced: false,
        ..Default::default()
    };

    if let Ok(job) =
        db::scheduler::get(org_id, db::scheduler::TriggerModule::Alert, &schedule_key).await
    {
        trigger.data = job.data;
        trigger.start_time = job.start_time;
        let _ = db::scheduler::update_trigger(trigger, false, "")
            .await
            .map_err(|e| {
                log::error!("Failed to update trigger for alert {schedule_key}: {e}");
            });
    } else {
        let _ = db::scheduler::push(trigger).await.map_err(|e| {
            log::error!("Failed to save trigger for alert {schedule_key}: {e}");
            e
        });
    }

    Ok(alert)
}

pub async fn delete_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Ksuid,
) -> Result<(), infra::errors::Error> {
    let Some((_folder, _alert)) = table::get_by_id(conn, org_id, alert_id).await? else {
        return Ok(());
    };
    let alert_id_str = alert_id.to_string();

    table::delete_by_id(conn, org_id, alert_id).await?;
    infra::coordinator::alerts::emit_delete_event(org_id, &alert_id_str).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_delete_event(
        org_id,
        _alert.stream_type,
        &_alert.stream_name,
        &_alert.name,
        alert_id,
    )
    .await?;

    if let Err(e) =
        db::scheduler::delete(org_id, db::scheduler::TriggerModule::Alert, &alert_id_str).await
    {
        log::error!("Failed to delete trigger: {e}");
    };
    Ok(())
}

pub async fn delete_by_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let Some(alert_id) =
        table::get_by_name(client, org_id, "default", stream_type, stream_name, name)
            .await?
            .and_then(|(_, a)| a.id)
    else {
        return Ok(());
    };
    let alert_id_str = alert_id.to_string();

    table::delete_by_name(client, org_id, "default", stream_type, stream_name, name).await?;
    infra::coordinator::alerts::emit_delete_event(org_id, &alert_id_str).await?;

    #[cfg(feature = "enterprise")]
    super_cluster::emit_delete_event(org_id, stream_type, stream_name, name, alert_id).await?;

    if let Err(e) =
        db::scheduler::delete(org_id, db::scheduler::TriggerModule::Alert, &alert_id_str).await
    {
        log::error!("Failed to delete trigger: {e}");
    };
    Ok(())
}

pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
) -> Result<Vec<Alert>, infra::errors::Error> {
    let params = ListAlertsParams::new(org_id).in_folder("default");
    let params = if let Some(stream_name) = stream_name {
        params.for_stream(stream_type.unwrap_or_default(), Some(stream_name))
    } else {
        params
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let alerts = table::list(client, params)
        .await?
        .into_iter()
        .map(|(_f, a)| a)
        .collect();
    Ok(alerts)
}

pub async fn list_with_folders<C: ConnectionTrait>(
    conn: &C,
    params: ListAlertsParams,
) -> Result<Vec<(Folder, Alert)>, infra::errors::Error> {
    table::list(conn, params).await
}

pub async fn watch() -> Result<(), anyhow::Error> {
    infra::coordinator::alerts::watch_events(put_into_cache, delete_from_cache).await
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut alerts: Vec<(Folder, Alert)> = Vec::new();
    let r = infra::schema::STREAM_SCHEMAS.read().await;
    let mut orgs = HashSet::new();
    for key in r.keys() {
        if !key.contains('/') {
            continue;
        }
        let split_key = key.split('/').collect::<Vec<&str>>();
        let org_name = split_key[0];
        orgs.insert(org_name);
    }
    for org_name in orgs {
        let alerts_in_orgs = table::list(client, ListAlertsParams::new(org_name)).await?;
        alerts.extend(alerts_in_orgs);
    }

    for alert in alerts {
        let alert_id = alert.1.id.map_or("".to_string(), |id| id.to_string());
        if alert.1.is_real_time {
            let mut cacher = STREAM_ALERTS.write().await;
            let stream_key =
                cache_stream_key(&alert.1.org_id, alert.1.stream_type, &alert.1.stream_name);
            let group = cacher.entry(stream_key.to_string()).or_default();
            group.push(alert_id.clone());
        }

        let mut cacher = ALERTS.write().await;
        let alert_cache_key = cache_alert_key(&alert.1.org_id, &alert_id);
        cacher.insert(alert_cache_key, alert);
    }
    log::info!("Alerts Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/alerts/";
    Ok(db::delete(key, true, db::NO_NEED_WATCH, None).await?)
}

async fn put_into_cache(
    org: String,
    alert_id: String,
    _folder_id: Option<String>,
) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Ok(alert_id_ksuid) = svix_ksuid::Ksuid::from_str(&alert_id) else {
        log::error!("Error parsing alert id into Ksuid while putting the alert into cache");
        return Ok(());
    };
    let item_value = match table::get_by_id(client, &org, alert_id_ksuid).await {
        Ok(Some(val)) => val,
        Ok(None) => {
            log::error!("Tried to get alert that does not exist in DB");
            return Ok(());
        }
        Err(e) => {
            log::error!("Error getting value: {e}");
            return Ok(());
        }
    };
    // Put into the Stream Alerts cache if the alert is a realtime alert
    // For realtime alerts, while processing ingestion requests, we need
    // alerts by the stream-type and stream name, hence we are using two
    // different caches - 1. STREAM_ALERTS to store alert ids grouped by
    // stream name, and 2. ALERTS to store the whole alert body with key
    // of `org/alert_id`
    if item_value.1.is_real_time {
        let mut stream_alerts_id_cacher = STREAM_ALERTS.write().await;
        let stream_key =
            cache_stream_key(&org, item_value.1.stream_type, &item_value.1.stream_name);
        let group = stream_alerts_id_cacher
            .entry(stream_key.to_string())
            .or_default();
        if !group.contains(&alert_id) {
            group.push(alert_id.clone());
        }
    }
    // Store the alert in the ALERTS cache as well with the  alert body
    let mut alerts_cacher = ALERTS.write().await;
    let alert_cache_key = cache_alert_key(&org, &alert_id);
    alerts_cacher.insert(alert_cache_key, item_value);
    Ok(())
}

async fn delete_from_cache(org: String, alert_id: String) -> Result<(), anyhow::Error> {
    // First delete from the alerts cache and then from stream_alerts cache if required
    let mut alerts_cacher = ALERTS.write().await;
    let alert_cache_key = cache_alert_key(&org, &alert_id);
    let removed_item = alerts_cacher.remove(&alert_cache_key);
    if let Some(removed_alert) = removed_item {
        // Remove the alert from STREAM_ALERTS cache if it is required
        let mut cacher = STREAM_ALERTS.write().await;
        let stream_key = cache_stream_key(
            &org,
            removed_alert.1.stream_type,
            &removed_alert.1.stream_name,
        );
        let group = match cacher.get_mut(&stream_key) {
            Some(v) => v,
            None => return Ok(()),
        };
        group.retain(|v| v.ne(&alert_id));
    }

    Ok(())
}

pub async fn get_alert_from_cache(org_id: &str, alert_id: &str) -> Option<(Folder, Alert)> {
    let alerts_cacher = ALERTS.read().await;
    alerts_cacher
        .get(&cache_alert_key(org_id, alert_id))
        .cloned()
}

/// Returns the key used to store stream (real-time) alerts in the in-memory cache, grouped by
/// stream.
pub fn cache_stream_key(org: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("{org}/{stream_type}/{stream_name}")
}

/// Returns key used to store all the alerts in the in-memory cache
pub fn cache_alert_key(org: &str, alert_id: &str) -> String {
    format!("{org}/{alert_id}")
}

/// Returns the key used to schedule a trigger for the alert.
pub fn scheduler_key(alert_id: Option<Ksuid>) -> String {
    alert_id.map_or(DEFAULT_FOLDER.to_string(), |id| id.to_string())
}

/// Helper functions for sending events to the super cluster queue.
#[cfg(feature = "enterprise")]
mod super_cluster {
    use config::{
        get_config,
        meta::{alerts::alert::Alert, stream::StreamType},
    };
    use infra::errors::Error;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    use svix_ksuid::Ksuid;

    /// Sends event to the super cluster queue indicating that an alert has been
    /// created in the database.
    pub async fn emit_create_event(
        org: &str,
        folder_id: &str,
        alert: Alert,
    ) -> Result<(), infra::errors::Error> {
        let o2_config = get_o2_config();
        let oss_config = get_config();
        if o2_config.super_cluster.enabled && !oss_config.common.local_mode {
            // let key = alert_key(org, alert.stream_type, &alert.stream_name, &alert.name);
            // let value = json::to_vec(&alert)?.into();
            log::debug!("Sending super cluster alert creation event: {alert:?}");
            // o2_enterprise::enterprise::super_cluster::queue::put(&key, value, true, None)
            //     .await
            //     .map_err(|e| Error::Message(e.to_string()))?;
            o2_enterprise::enterprise::super_cluster::queue::alerts_create(org, folder_id, alert)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to the super cluster queue indicating that an alert has been
    /// updated in the database.
    pub async fn emit_update_event(
        org: &str,
        folder_id: Option<&str>,
        alert: Alert,
    ) -> Result<(), infra::errors::Error> {
        let o2_config = get_o2_config();
        let oss_config = get_config();
        if o2_config.super_cluster.enabled && !oss_config.common.local_mode {
            // let key = alert_key(org, alert.stream_type, &alert.stream_name, &alert.name);
            // let value = json::to_vec(&alert)?.into();
            log::debug!("Sending super cluster alert update event: {alert:?}");
            // o2_enterprise::enterprise::super_cluster::queue::put(&key, value, true, None)
            //     .await
            //     .map_err(|e| Error::Message(e.to_string()))?;
            o2_enterprise::enterprise::super_cluster::queue::alerts_update(org, folder_id, alert)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to the super cluster queue indicating that an alert has been
    /// deleted from the database.
    pub async fn emit_delete_event(
        org: &str,
        stream_type: StreamType,
        stream_name: &str,
        alert_name: &str,
        alert_id: Ksuid,
    ) -> Result<(), infra::errors::Error> {
        let o2_config = get_o2_config();
        let oss_config = get_config();
        if o2_config.super_cluster.enabled && !oss_config.common.local_mode {
            let key = alert_key(org, stream_type, stream_name, alert_name);
            log::debug!("Sending super cluster alert delete event: {key:?}");
            // o2_enterprise::enterprise::super_cluster::queue::delete(&key, false, true, None)
            //     .await
            //     .map_err(|e| Error::Message(e.to_string()))?;
            o2_enterprise::enterprise::super_cluster::queue::alerts_delete(org, alert_id)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to the super cluster queue indicating that all alert have
    /// been deleted from the database.
    pub async fn _emit_delete_all_event() -> Result<(), infra::errors::Error> {
        let o2_config = get_o2_config();
        let oss_config = get_config();
        if o2_config.super_cluster.enabled && !oss_config.common.local_mode {
            o2_enterprise::enterprise::super_cluster::queue::delete("/alerts/", true, false, None)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Returns the key used to identify an individual alert in events sent to
    /// the super cluster queue.
    fn alert_key(
        org: &str,
        stream_type: StreamType,
        stream_name: &str,
        alert_name: &str,
    ) -> String {
        format!("/alerts/{org}/{stream_type}/{stream_name}/{alert_name}")
    }
}
