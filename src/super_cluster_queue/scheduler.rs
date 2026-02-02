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

use std::str::FromStr;

use config::{
    meta::triggers::{Trigger, TriggerModule},
    utils::json,
};
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{Error, Result},
    scheduler,
};
use o2_enterprise::enterprise::{
    scheduled_jobs::StatusUpdateTuple,
    super_cluster::queue::{Message, MessageType},
};

use crate::service::db;
pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SchedulerPush => {
            push(msg).await?;
        }
        MessageType::SchedulerUpdate => {
            update(msg).await?;
        }
        MessageType::SchedulerUpdateStatus => {
            update_status(msg).await?;
        }
        MessageType::SchedulerDelete => {
            delete(msg).await?;
        }
        MessageType::BulkSchedulerUpdate => {
            bulk_update(msg).await?;
        }
        MessageType::BulkSchedulerStatusUpdate => {
            bulk_update_status(msg).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

async fn push(msg: Message) -> Result<()> {
    let mut trigger: Trigger = json::from_slice(&msg.value.unwrap())?;
    if trigger.module == TriggerModule::Alert {
        trigger_modify_module_key(&mut trigger).await?;
    }
    if let Err(e) = scheduler::push(trigger.clone()).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to push scheduler: {}/{:?}/{}, error: {}",
            trigger.org,
            trigger.module,
            trigger.module_key,
            e
        );
        return Err(e);
    }
    Ok(())
}

async fn update(msg: Message) -> Result<()> {
    let mut trigger: Trigger = json::from_slice(&msg.value.unwrap())?;
    if trigger.module == TriggerModule::Alert {
        trigger_modify_module_key(&mut trigger).await?;
    }
    // check if the scheduled job exists
    if scheduler::get(&trigger.org, trigger.module.clone(), &trigger.module_key)
        .await
        .is_ok()
    {
        // Update trigger in super cluster with clone = true, so that it copies everything
        scheduler::update_trigger(trigger.clone(), true)
            .await
            .map_err(|e| {
                let error_msg = format!(
                    "[SUPER_CLUSTER:sync] Failed to update scheduler: {}/{:?}/{}, error: {}",
                    trigger.org, trigger.module, trigger.module_key, e
                );
                log::error!("{error_msg}");
                anyhow::anyhow!(error_msg)
            })?;
        return Ok(());
    }
    // First check if the module record exists in this region, to verify that the module record
    // is not deleted.
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match trigger.module {
        TriggerModule::Alert => {
            let Ok(alert_id) = svix_ksuid::Ksuid::from_str(&trigger.module_key) else {
                log::error!(
                    "[SUPER_CLUSTER:sync] Invalid module_key format for alert: {}. No need to sync this trigger",
                    trigger.module_key
                );
                return Ok(());
            };
            if let Ok(Some(_)) = db::alerts::alert::get_by_id(conn, &trigger.org, alert_id).await {
                // We need to add this trigger to the db in this region
                scheduler::push(trigger.clone()).await.map_err(|e| {
                    let error_msg = format!(
                        "[SUPER_CLUSTER:sync] Failed to push scheduler: {}/{:?}/{}, error: {}",
                        trigger.org, trigger.module, trigger.module_key, e
                    );
                    log::error!("{error_msg}");
                    anyhow::anyhow!(error_msg)
                })?;
            } else {
                log::warn!(
                    "[SUPER_CLUSTER:sync] Alert not found for module_key: {}. No need to sync this trigger",
                    trigger.module_key
                );
            }
        }
        TriggerModule::Report => {
            if db::dashboards::reports::get_by_id(conn, &trigger.module_key)
                .await
                .is_ok()
            {
                // We need to add this trigger to the db in this region
                scheduler::push(trigger.clone()).await.map_err(|e| {
                    let error_msg = format!(
                        "[SUPER_CLUSTER:sync] Failed to push scheduler: {}/{:?}/{}, error: {}",
                        trigger.org, trigger.module, trigger.module_key, e
                    );
                    log::error!("{error_msg}");
                    anyhow::anyhow!(error_msg)
                })?;
            } else {
                log::warn!(
                    "[SUPER_CLUSTER:sync] Report not found for module_key: {}. No need to sync this trigger",
                    trigger.module_key
                );
            }
        }
        TriggerModule::DerivedStream => {
            let Ok((_, _, _, pipeline_id)) =
                crate::service::alerts::scheduler::handlers::get_pipeline_info_from_module_key(
                    &trigger.module_key,
                )
            else {
                log::error!(
                    "[SUPER_CLUSTER:sync] Invalid module_key format for derived stream: {}. No need to sync this trigger",
                    trigger.module_key
                );
                return Ok(());
            };
            if db::pipeline::get_by_id(&pipeline_id).await.is_ok() {
                // We need to add this trigger to the db in this region
                scheduler::push(trigger.clone()).await.map_err(|e| {
                    let error_msg = format!(
                        "[SUPER_CLUSTER:sync] Failed to push scheduler: {}/{:?}/{}, error: {}",
                        trigger.org, trigger.module, trigger.module_key, e
                    );
                    log::error!("{error_msg}");
                    anyhow::anyhow!(error_msg)
                })?;
            } else {
                log::warn!(
                    "[SUPER_CLUSTER:sync] Derived stream not found for module_key: {}. No need to sync this trigger",
                    trigger.module_key
                );
            }
        }
        TriggerModule::Backfill => {
            // For backfill jobs, check if the backfill job exists in the backfill_jobs table
            let job_id = &trigger.module_key;
            if infra::table::backfill_jobs::get(&trigger.org, job_id)
                .await
                .is_ok()
            {
                // We need to add this trigger to the db in this region
                scheduler::push(trigger.clone()).await.map_err(|e| {
                    let error_msg = format!(
                        "[SUPER_CLUSTER:sync] Failed to push scheduler: {}/{:?}/{}, error: {}",
                        trigger.org, trigger.module, trigger.module_key, e
                    );
                    log::error!("{error_msg}");
                    anyhow::anyhow!(error_msg)
                })?;
            } else {
                log::warn!(
                    "[SUPER_CLUSTER:sync] Backfill job not found for module_key: {}. No need to sync this trigger",
                    trigger.module_key
                );
            }
        }
        TriggerModule::QueryRecommendations => {
            todo!("We will get here eventually")
        }
    }
    Ok(())
}

async fn update_status(msg: Message) -> Result<()> {
    let mut trigger: Trigger = json::from_slice(&msg.value.unwrap())?;
    if trigger.module == TriggerModule::Alert {
        trigger_modify_module_key(&mut trigger).await?;
    }
    if let Err(e) = scheduler::update_status(
        &trigger.org,
        trigger.module.clone(),
        &trigger.module_key,
        trigger.status,
        trigger.retries,
        // Only update trigger data if it is not empty
        if trigger.data.is_empty() {
            None
        } else {
            Some(&trigger.data)
        },
    )
    .await
    {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to update status for scheduler: {}/{:?}/{}, error: {}",
            trigger.org,
            trigger.module,
            trigger.module_key,
            e
        );
        return Err(e);
    }
    Ok(())
}

async fn bulk_update(msg: Message) -> Result<()> {
    let triggers: Vec<Trigger> = json::from_slice(&msg.value.unwrap())?;
    if let Err(e) = scheduler::bulk_update_triggers(triggers).await {
        log::error!("[SUPER_CLUSTER:sync] Failed to bulk update triggers error: {e}");
        return Err(e);
    }
    Ok(())
}

async fn bulk_update_status(msg: Message) -> Result<()> {
    let updates: Vec<StatusUpdateTuple> = json::from_slice(&msg.value.unwrap())?;
    if let Err(e) = scheduler::bulk_update_status(updates).await {
        log::error!("[SUPER_CLUSTER:sync] Failed to bulk update triggers error: {e}");
        return Err(e);
    }
    Ok(())
}

async fn delete(msg: Message) -> Result<()> {
    let mut trigger: Trigger = json::from_slice(&msg.value.unwrap())?;
    if trigger.module == TriggerModule::Alert {
        trigger_modify_module_key(&mut trigger).await?;
    }
    if let Err(e) =
        scheduler::delete(&trigger.org, trigger.module.clone(), &trigger.module_key).await
    {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to delete scheduler: {}/{:?}/{}, error: {}",
            trigger.org,
            trigger.module,
            trigger.module_key,
            e
        );
        return Err(e);
    }
    Ok(())
}

async fn trigger_modify_module_key(trigger: &mut Trigger) -> Result<()> {
    // Return if the module_key is in new format (alert_id only)
    if !trigger.module_key.contains("/") || trigger.module != TriggerModule::Alert {
        return Ok(());
    }
    let parts = trigger.module_key.split("/").collect::<Vec<&str>>();

    if parts.len() != 3 {
        return Err(Error::Message(format!(
            "Invalid module_key format: {}",
            trigger.module_key
        )));
    }
    let stream_type = parts[0];
    let stream_name = parts[1];
    let alert_name = parts[2];

    // get alert id from alert name
    if let Some(alert) =
        db::alerts::alert::get_by_name(&trigger.org, stream_type.into(), stream_name, alert_name)
            .await?
    {
        trigger.module_key = alert.get_unique_key();
    }
    Ok(())
}
