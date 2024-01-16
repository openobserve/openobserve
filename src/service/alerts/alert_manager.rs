// Copyright 2023 Zinc Labs Inc.
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

use chrono::{Duration, Utc};
use config::{meta::stream::StreamType, CONFIG};

use crate::{
    common::{
        infra::{
            cluster::{get_node_by_uuid, LOCAL_NODE_UUID},
            config::TRIGGERS,
            dist_lock,
        },
        meta::alerts::triggers::Trigger,
    },
    service::db,
};

pub async fn run() -> Result<(), anyhow::Error> {
    // maybe in the future we can support multiple organizations
    let org_id = "default";
    // get the working node for the organization
    let node = db::alerts::alert_manager::get_mark(org_id).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::debug!("[ALERT_MANAGER] is processing by {node}");
        return Ok(());
    }

    // before start merging, set current node to lock the organization
    let lock_key = format!("alert_manager/organization/{org_id}");
    let locker = dist_lock::lock(&lock_key, CONFIG.etcd.command_timeout).await?;
    // check the working node for the organization again, maybe other node locked it
    // first
    let node = db::alerts::alert_manager::get_mark(org_id).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
        log::debug!("[ALERT_MANAGER] is processing by {node}");
        dist_lock::unlock(&locker).await?;
        return Ok(());
    }
    if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
        db::alerts::alert_manager::set_mark(org_id, Some(&LOCAL_NODE_UUID.clone())).await?;
    }
    // already bind to this node, we can unlock now
    dist_lock::unlock(&locker).await?;
    drop(locker);

    let now = Utc::now().timestamp_micros();
    let cacher = TRIGGERS.read().await;

    for (key, trigger) in cacher.iter() {
        if trigger.next_run_at > now {
            continue;
        }
        let is_realtime = trigger.is_realtime;
        let is_silenced = trigger.is_silenced;
        if is_realtime && !is_silenced {
            continue; // realtime trigger and not silenced, no need to schedule
        }
        let key = key.to_string();
        tokio::task::spawn(async move {
            if let Err(e) = handle_triggers(&key, is_realtime, is_silenced).await {
                log::error!("[ALERT_MANAGER] Error handling trigger: {}", e);
            }
        });
    }
    Ok(())
}

pub async fn handle_triggers(
    key: &str,
    is_realtime: bool,
    is_silenced: bool,
) -> Result<(), anyhow::Error> {
    let columns = key.split('/').collect::<Vec<&str>>();
    assert_eq!(columns.len(), 4);
    let org_id = columns[0];
    let stream_type: StreamType = columns[1].into();
    let stream_name = columns[2];
    let alert_name = columns[3];

    if is_realtime && is_silenced {
        // wakeup the trigger
        let new_trigger = Trigger {
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: true,
            is_silenced: false,
        };
        super::triggers::save(org_id, stream_type, stream_name, alert_name, &new_trigger).await?;
        return Ok(());
    }

    let alert = match super::get(org_id, stream_type, stream_name, alert_name).await? {
        Some(alert) => alert,
        None => {
            return Err(anyhow::anyhow!(
                "alert not found: {}/{}/{}/{}",
                org_id,
                stream_name,
                stream_type,
                alert_name
            ));
        }
    };

    let mut new_trigger = Trigger {
        next_run_at: Utc::now().timestamp_micros(),
        is_realtime: false,
        is_silenced: false,
    };

    if !alert.enabled {
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::days(7).num_microseconds().unwrap();
        new_trigger.is_silenced = true;
        super::triggers::save(org_id, stream_type, stream_name, alert_name, &new_trigger).await?;
        return Ok(());
    }

    // evaluate alert
    let ret = alert.evaluate(None).await?;
    if ret.is_some() && alert.trigger_condition.silence > 0 {
        new_trigger.next_run_at += Duration::minutes(alert.trigger_condition.silence)
            .num_microseconds()
            .unwrap();
        new_trigger.is_silenced = true;
    } else {
        new_trigger.next_run_at += Duration::minutes(alert.trigger_condition.frequency)
            .num_microseconds()
            .unwrap();
    }

    // send notification
    if let Some(data) = ret {
        alert.send_notification(&data).await?;
    }

    // update trigger
    super::triggers::save(org_id, stream_type, stream_name, alert_name, &new_trigger).await?;

    Ok(())
}
