// Copyright 2024 Zinc Labs Inc.
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

use config::{meta::triggers::Trigger, utils::json};
use infra::{
    errors::{Error, Result},
    scheduler,
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

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
    trigger_modify_module_key(&mut trigger).await?;
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
    trigger_modify_module_key(&mut trigger).await?;
    // Update trigger in super cluster with clone = true, so that it copies everything
    if let Err(e) = scheduler::update_trigger(trigger.clone(), true).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to update scheduler: {}/{:?}/{}, error: {}",
            trigger.org,
            trigger.module,
            trigger.module_key,
            e
        );
        return Err(e);
    }
    Ok(())
}

async fn update_status(msg: Message) -> Result<()> {
    let mut trigger: Trigger = json::from_slice(&msg.value.unwrap())?;
    trigger_modify_module_key(&mut trigger).await?;
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

async fn delete(msg: Message) -> Result<()> {
    let mut trigger: Trigger = json::from_slice(&msg.value.unwrap())?;
    trigger_modify_module_key(&mut trigger).await?;
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
    let module_key = trigger.module_key.clone();
    let parts = module_key.split("/").collect::<Vec<&str>>();
    let org = parts[1];
    let stream_type = parts[2];
    let stream_name = parts[3];
    let alert_name = parts[4];

    // get alert id from alert name
    let alert_id = db::alerts::alert::get_by_name(org, stream_type, stream_name, alert_name).await?;
    trigger.module_key = format!("{}", alert_id);
    Ok(())
}