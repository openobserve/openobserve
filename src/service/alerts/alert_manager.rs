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

use std::str::FromStr;

use chrono::{Duration, FixedOffset, Utc};
use config::{cluster::LOCAL_NODE_UUID, meta::stream::StreamType, CONFIG};
use cron::Schedule;
use infra::{dist_lock, scheduler};

use crate::{
    common::{
        infra::cluster::get_node_by_uuid,
        meta::{
            alerts::{triggers::Trigger, AlertFrequencyType},
            dashboards::reports::ReportFrequencyType,
        }
    },
    service::db,
};

pub async fn run() -> Result<(), anyhow::Error> {
    // maybe in the future we can support multiple organizations
    let org_id = "default";
    // get the working node for the organization
    let node = db::alerts::alert_manager::get_mark(org_id).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        log::debug!("[ALERT_MANAGER] is processing by {node}");
        return Ok(());
    }

    // before start merging, set current node to lock the organization
    let lock_key = format!("/alert_manager/organization/{org_id}");
    let locker = dist_lock::lock(&lock_key, 0).await?;
    // check the working node for the organization again, maybe other node locked it
    // first
    let node = db::alerts::alert_manager::get_mark(org_id).await;
    if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        log::debug!("[ALERT_MANAGER] is processing by {node}");
        dist_lock::unlock(&locker).await?;
        return Ok(());
    }
    let ret = if node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
        db::alerts::alert_manager::set_mark(org_id, Some(&LOCAL_NODE_UUID.clone())).await
    } else {
        Ok(())
    };
    // already bind to this node, we can unlock now
    dist_lock::unlock(&locker).await?;
    drop(locker);
    ret?;

    // Scheduler pulls only those triggers that match the conditions-
    // - trigger.next_run_at <= now
    // - !(trigger.is_realtime && !trigger.is_silenced)
    // - trigger.status == "Waiting"
    let triggers = scheduler::pull(
        CONFIG.limit.alert_schedule_concurrency,
        CONFIG.limit.alert_schedule_timeout,
    )
    .await?;

    for trigger in triggers {
        tokio::task::spawn(async move {
            if let Err(e) = handle_triggers(trigger).await {
                log::error!("[ALERT_MANAGER] Error handling trigger: {}", e);
            }
        });
    }
    Ok(())
}

pub async fn handle_triggers(trigger: scheduler::Trigger) -> Result<(), anyhow::Error> {
    match trigger.module {
        scheduler::TriggerModule::Report => handle_report_triggers(trigger).await,
        scheduler::TriggerModule::Alert => handle_alert_triggers(trigger).await,
    }
}

async fn handle_alert_triggers(trigger: scheduler::Trigger) -> Result<(), anyhow::Error> {
    let columns = trigger.key.split('/').collect::<Vec<&str>>();
    assert_eq!(columns.len(), 3);
    let org_id = &trigger.org;
    let stream_type: StreamType = columns[0].into();
    let stream_name = columns[1];
    let alert_name = columns[2];
    let is_realtime = trigger.is_realtime;
    let is_silenced = trigger.is_silenced;

    if is_realtime && is_silenced {
        // wakeup the trigger
        let new_trigger = scheduler::Trigger {
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: true,
            is_silenced: false,
            status: scheduler::TriggerStatus::Waiting,
            ..trigger
        };
        scheduler::update_trigger(new_trigger).await?;
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

    let mut new_trigger = scheduler::Trigger {
        next_run_at: Utc::now().timestamp_micros(),
        is_realtime: false,
        is_silenced: false,
        status: scheduler::TriggerStatus::Waiting,
        ..trigger
    };

    if !alert.enabled {
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        new_trigger.is_silenced = true;
        scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }

    // evaluate alert
    let ret = alert.evaluate(None).await?;
    if ret.is_some() && alert.trigger_condition.silence > 0 {
        new_trigger.next_run_at += Duration::try_minutes(alert.trigger_condition.silence)
            .unwrap()
            .num_microseconds()
            .unwrap();
        new_trigger.is_silenced = true;
    } else if alert.trigger_condition.frequency_type == AlertFrequencyType::Cron {
        let schedule = Schedule::from_str(&alert.trigger_condition.cron)?;
        // tz_offset is in minutes
        let tz_offset = FixedOffset::east_opt(alert.tz_offset * 60).unwrap();
        new_trigger.next_run_at = schedule
            .upcoming(tz_offset)
            .next()
            .unwrap()
            .timestamp_micros();
    } else {
        new_trigger.next_run_at += Duration::try_seconds(alert.trigger_condition.frequency)
            .unwrap()
            .num_microseconds()
            .unwrap();
    }

    // send notification
    if let Some(data) = ret {
        alert.send_notification(&data).await?;
    }

    // update trigger
    scheduler::update_trigger(new_trigger).await?;

    Ok(())
}

async fn handle_report_triggers(trigger: scheduler::Trigger) -> Result<(), anyhow::Error> {
    let org_id = &trigger.org;
    // For report, trigger.key is the report name
    let report_name = &trigger.key;

    let mut report = db::dashboards::reports::get(org_id, report_name).await?;
    let mut new_trigger = scheduler::Trigger {
        next_run_at: Utc::now().timestamp_micros(),
        is_realtime: false,
        is_silenced: false,
        status: scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    if !report.enabled {
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::days(7).num_microseconds().unwrap();
        scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }
    let mut run_once = false;

    // Update trigger, set `next_run_at` to the
    // frequency interval of this report
    match report.frequency.frequency_type {
        ReportFrequencyType::Hours => {
            new_trigger.next_run_at += Duration::hours(report.frequency.interval)
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Days => {
            new_trigger.next_run_at += Duration::days(report.frequency.interval)
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Weeks => {
            new_trigger.next_run_at += Duration::weeks(report.frequency.interval)
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Months => {
            // Assumes each month to be of 30 days.
            new_trigger.next_run_at += Duration::days(report.frequency.interval * 30)
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Once => {
            // Check on next week
            new_trigger.next_run_at += Duration::days(7).num_microseconds().unwrap();
            // Disable the report
            report.enabled = false;
            run_once = true;
        }
        ReportFrequencyType::Cron => {
            let schedule = Schedule::from_str(&report.frequency.cron)?;
            // tz_offset is in minutes
            let tz_offset = FixedOffset::east_opt(report.tz_offset * 60).unwrap();
            new_trigger.next_run_at = schedule
                .upcoming(tz_offset)
                .next()
                .unwrap()
                .timestamp_micros();
        }
    }

    match report.send_subscribers().await {
        Ok(_) => {
            // Report generation successful, update the trigger
            if run_once {
                new_trigger.status = scheduler::TriggerStatus::Completed;
                let result = db::dashboards::reports::set(org_id, &report, false).await;
                if result.is_err() {
                    log::error!("Failed to disable report: {report_name} with Once frequency");
                }
            }
            scheduler::update_trigger(new_trigger).await?
        }
        Err(_) => {
            scheduler::update_status(
                &new_trigger.org,
                new_trigger.module,
                &new_trigger.key,
                scheduler::TriggerStatus::Waiting,
                trigger.retries + 1,
            )
            .await?
        }
    }

    Ok(())
}
