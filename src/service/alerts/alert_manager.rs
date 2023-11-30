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

use chrono::Utc;

use crate::common::{
    infra::config::TRIGGERS,
    meta::{alerts::triggers::Trigger, StreamType},
};

pub async fn run() -> Result<(), anyhow::Error> {
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
        let local_trigger = Trigger {
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: true,
            is_silenced: false,
        };
        super::triggers::save(org_id, stream_type, stream_name, alert_name, &local_trigger).await?;
        return Ok(());
    }

    log::warn!(
        "[ALERT_MANAGER] handle_triggers: {}/{}/{}/{}",
        org_id,
        stream_name,
        stream_type,
        alert_name
    );

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
    if let Some(ret) = alert.evaluate(None).await? {
        if ret.is_empty() {
            return Ok(());
        }
        alert.send_notification(&ret).await?;
    }

    Ok(())
}
