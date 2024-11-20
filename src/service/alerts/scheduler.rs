// Copyright 2024 OpenObserve Inc.
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

use std::{collections::HashMap, str::FromStr, time::Instant};

use chrono::{Duration, FixedOffset, Utc};
use config::{
    get_config,
    meta::{
        alerts::FrequencyType,
        self_reporting::usage::{TriggerData, TriggerDataStatus, TriggerDataType},
        stream::{StreamParams, StreamType},
    },
    utils::{
        json,
        rand::get_rand_num_within,
        time::{hour_micros, second_micros},
    },
};
use cron::Schedule;
use futures::future::try_join_all;
use infra::scheduler::get_scheduler_max_retries;
use proto::cluster_rpc;

use crate::{
    common::meta::dashboards::reports::ReportFrequencyType,
    service::{
        alerts::{
            alert::{get_alert_start_end_time, get_row_column_map, AlertExt},
            derived_streams::DerivedStreamExt,
        },
        db::{self, scheduler::ScheduledTriggerData},
        ingestion::ingestion_service,
        pipeline::batch_execution::ExecutablePipeline,
        self_reporting::publish_triggers_usage,
    },
};

pub async fn run() -> Result<(), anyhow::Error> {
    log::debug!("Pulling jobs from scheduler");
    let cfg = get_config();
    // Scheduler pulls only those triggers that match the conditions-
    // - trigger.next_run_at <= now
    // - !(trigger.is_realtime && !trigger.is_silenced)
    // - trigger.status == "Waiting"
    let triggers = db::scheduler::pull(
        cfg.limit.alert_schedule_concurrency,
        cfg.limit.alert_schedule_timeout,
        cfg.limit.report_schedule_timeout,
    )
    .await?;

    log::info!("Pulled {} jobs from scheduler", triggers.len());

    let mut tasks = Vec::new();
    for trigger in triggers {
        let task = tokio::task::spawn(async move {
            if let Err(e) = handle_triggers(trigger).await {
                log::error!("[SCHEDULER] Error handling trigger: {}", e);
            }
        });
        tasks.push(task);
    }
    if let Err(e) = try_join_all(tasks).await {
        log::error!("[SCHEDULER] Error handling triggers: {}", e);
    }
    Ok(())
}

pub async fn handle_triggers(trigger: db::scheduler::Trigger) -> Result<(), anyhow::Error> {
    match trigger.module {
        db::scheduler::TriggerModule::Report => handle_report_triggers(trigger).await,
        db::scheduler::TriggerModule::Alert => handle_alert_triggers(trigger).await,
        db::scheduler::TriggerModule::DerivedStream => {
            handle_derived_stream_triggers(trigger).await
        }
    }
}

/// Returns maximum considerable delay in microseconds - minimum of 1 hour or 20% of the frequency.
fn get_max_considerable_delay(frequency: i64) -> i64 {
    // Calculate the maximum delay that can be considered for the alert evaluation.
    // If the delay is more than this, the alert will be skipped.
    // The maximum delay is the lowest of 1 hour or 20% of the frequency.
    // E.g. if the frequency is 5 mins, the maximum delay is 1 min.
    let frequency = second_micros(frequency);
    let max_delay = hour_micros(1);
    // limit.alert_considerable_delay is in percentage, convert into float
    let considerable_delay = get_config().limit.alert_considerable_delay as f64 * 0.01;
    let max_considerable_delay = (frequency as f64 * considerable_delay) as i64;
    std::cmp::min(max_delay, max_considerable_delay)
}

async fn handle_alert_triggers(trigger: db::scheduler::Trigger) -> Result<(), anyhow::Error> {
    let (_, max_retries) = get_scheduler_max_retries();
    log::debug!(
        "Inside handle_alert_triggers: processing trigger: {}",
        &trigger.module_key
    );
    let columns = trigger.module_key.split('/').collect::<Vec<&str>>();
    assert_eq!(columns.len(), 3);
    let org_id = trigger.org.clone();
    let stream_type: StreamType = columns[0].into();
    let stream_name = columns[1];
    let alert_name = columns[2];
    let is_realtime = trigger.is_realtime;
    let is_silenced = trigger.is_silenced;
    let triggered_at = trigger.start_time.unwrap_or_default();

    if is_realtime && is_silenced {
        log::debug!(
            "Realtime alert need wakeup, {}/{}",
            org_id,
            &trigger.module_key
        );
        // wakeup the trigger
        let new_trigger = db::scheduler::Trigger {
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: true,
            is_silenced: false,
            status: db::scheduler::TriggerStatus::Waiting,
            ..trigger.clone()
        };
        db::scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }

    let alert = match super::alert::get(&org_id, stream_type, stream_name, alert_name).await? {
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
    let now = Utc::now().timestamp_micros();

    let mut new_trigger = db::scheduler::Trigger {
        next_run_at: now,
        is_realtime: alert.is_real_time,
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    if !alert.enabled {
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        new_trigger.is_silenced = true;
        db::scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }

    if trigger.retries >= max_retries {
        // It has been tried the maximum time, just update the
        // next_run_at to the next expected trigger time
        log::info!(
            "This alert trigger: {}/{} has passed maximum retries, skipping to next run",
            &new_trigger.org,
            &new_trigger.module_key
        );
        if alert.trigger_condition.frequency_type == FrequencyType::Cron {
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
        new_trigger.data = "".to_string();
        db::scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }

    // The delay in processing the trigger from the time it was supposed to run
    let (processing_delay, use_period) = if trigger.next_run_at == 0 {
        (0, true)
    } else {
        let delay = now - trigger.next_run_at;

        // Skip Alerts: Say for some reason, this alert trigger (period: 10mins, frequency 5mins)
        // which was supposed to run at 10am is now processed after a delay of 5 mins (may be alert
        // manager was stuck or something). In that case, only use the period strictly to evaluate
        // the alert. If the delay is within the max considerable delay, consider the delay with
        // period, otherwise strictly use the period only. Also, since we are skipping this alert
        // (9:50am to 10am timerange), we need to report this event to the `triggers` usage stream.
        if delay > get_max_considerable_delay(alert.trigger_condition.frequency) {
            publish_triggers_usage(TriggerData {
                _timestamp: triggered_at - 1,
                org: org_id.clone(),
                module: TriggerDataType::Alert,
                key: trigger.module_key.clone(),
                next_run_at: triggered_at,
                is_realtime: trigger.is_realtime,
                is_silenced: trigger.is_silenced,
                status: TriggerDataStatus::Skipped,
                start_time: trigger.next_run_at
                    - Duration::try_minutes(alert.trigger_condition.period)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                end_time: trigger.next_run_at,
                retries: trigger.retries,
                delay_in_secs: Some(Duration::microseconds(delay).num_seconds()),
                error: None,
                success_response: None,
                is_partial: None,
                evaluation_took_in_secs: None,
            })
            .await;
            (0, true)
        } else {
            (delay, false)
        }
    };

    let trigger_data: Result<ScheduledTriggerData, json::Error> = json::from_str(&trigger.data);
    let mut trigger_data = if let Ok(trigger_data) = trigger_data {
        trigger_data
    } else {
        ScheduledTriggerData {
            period_end_time: None,
            tolerance: 0,
        }
    };

    // This is the end time of the last trigger timerange  + 1.
    // This will be used in alert evaluation as the start time.
    // If this is None, alert will use the period to evaluate alert
    let start_time = if trigger_data.period_end_time.is_none() || use_period {
        // approximate the start time involving the alert manager delay
        Some(
            now - Duration::try_minutes(alert.trigger_condition.period)
                .unwrap()
                .num_microseconds()
                .unwrap()
                - trigger_data.tolerance
                - processing_delay,
        )
    } else {
        Some(trigger_data.period_end_time.unwrap() + 1)
    };

    let mut should_store_last_end_time =
        alert.trigger_condition.frequency == (alert.trigger_condition.period * 60);
    let mut trigger_data_stream: TriggerData = TriggerData {
        _timestamp: triggered_at,
        org: trigger.org,
        module: TriggerDataType::Alert,
        key: trigger.module_key.clone(),
        next_run_at: new_trigger.next_run_at,
        is_realtime: trigger.is_realtime,
        is_silenced: trigger.is_silenced,
        status: TriggerDataStatus::Completed,
        start_time: now
            - Duration::try_minutes(alert.trigger_condition.period)
                .unwrap()
                .num_microseconds()
                .unwrap(),
        end_time: now,
        retries: trigger.retries,
        error: None,
        success_response: None,
        is_partial: None,
        delay_in_secs: Some(Duration::microseconds(processing_delay).num_seconds()),
        evaluation_took_in_secs: None,
    };

    let evaluation_took = Instant::now();
    // evaluate alert
    let result = alert.evaluate(None, (start_time, now)).await;
    let evaluation_took = evaluation_took.elapsed().as_secs_f64();
    trigger_data_stream.evaluation_took_in_secs = Some(evaluation_took);
    if result.is_err() {
        let err = result.err().unwrap();
        trigger_data_stream.status = TriggerDataStatus::Failed;
        let err_string = err.to_string();
        if err_string.starts_with("Partial") {
            trigger_data_stream.is_partial = Some(true);
        }
        trigger_data_stream.error = Some(err_string);
        // update its status and retries
        if trigger.retries + 1 >= max_retries {
            if get_config().limit.pause_alerts_on_retries {
                // It has been tried the maximum time, just disable the alert
                // and show the error.
                if let Some(mut alert) =
                    super::alert::get(&org_id, stream_type, stream_name, alert_name).await?
                {
                    alert.enabled = false;
                    if let Err(e) = db::alerts::alert::set_without_updating_trigger(
                        &org_id,
                        stream_type,
                        stream_name,
                        &alert,
                    )
                    .await
                    {
                        log::error!("Failed to update alert: {alert_name} after trigger: {e}",);
                    }
                }
            }
            // This didn't work, update the next_run_at to the next expected trigger time
            if alert.trigger_condition.frequency_type == FrequencyType::Cron {
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
            new_trigger.data = "".to_string();
            trigger_data_stream.next_run_at = new_trigger.next_run_at;
            db::scheduler::update_trigger(new_trigger).await?;
        } else {
            // update its status and retries
            db::scheduler::update_status(
                &new_trigger.org,
                new_trigger.module,
                &new_trigger.module_key,
                db::scheduler::TriggerStatus::Waiting,
                trigger.retries + 1,
            )
            .await?;
        }
        publish_triggers_usage(trigger_data_stream).await;
        return Err(err);
    }

    let (ret, end_time) = result.unwrap();
    if ret.is_some() {
        log::info!(
            "Alert conditions satisfied, org: {}, module_key: {}",
            &new_trigger.org,
            &new_trigger.module_key
        );
    }
    let tolerance = match alert.trigger_condition.tolerance_in_secs {
        Some(tolerance) if tolerance > 0 => {
            let tolerance = Duration::seconds(get_rand_num_within(0, tolerance as u64) as i64)
                .num_microseconds()
                .unwrap();
            if tolerance > 0 {
                trigger_data.tolerance = tolerance;
            }
            tolerance
        }
        _ => 0,
    };
    if ret.is_some() && alert.trigger_condition.silence > 0 {
        if alert.trigger_condition.frequency_type == FrequencyType::Cron {
            let schedule = Schedule::from_str(&alert.trigger_condition.cron)?;
            let silence =
                Utc::now() + Duration::try_minutes(alert.trigger_condition.silence).unwrap();
            let silence = silence.with_timezone(
                FixedOffset::east_opt(alert.tz_offset * 60)
                    .as_ref()
                    .unwrap(),
            );
            // Check for the cron timestamp after the silence period
            new_trigger.next_run_at =
                schedule.after(&silence).next().unwrap().timestamp_micros() + tolerance;
        } else {
            // When the silence period is less than the frequency, the alert runs after the silence
            // period completely ignoring the frequency. So, if frequency is 60 mins and
            // silence is 10 mins, the condition is satisfied, in that case, the alert
            // will run after 10 mins of silence period. To avoid this scenario, we
            // should use the max of (frequency, silence) as the next_run_at.
            // Silence period is in minutes, and the frequency is in seconds.
            let next_run_in_seconds = std::cmp::max(
                alert.trigger_condition.silence * 60,
                alert.trigger_condition.frequency,
            );
            new_trigger.next_run_at += Duration::try_seconds(next_run_in_seconds)
                .unwrap()
                .num_microseconds()
                .unwrap()
                + tolerance;
        }
        new_trigger.is_silenced = true;
        // For silence period, no need to store last end time
        should_store_last_end_time = false;
    } else if alert.trigger_condition.frequency_type == FrequencyType::Cron {
        let schedule = Schedule::from_str(&alert.trigger_condition.cron)?;
        // tz_offset is in minutes
        let tz_offset = FixedOffset::east_opt(alert.tz_offset * 60).unwrap();
        new_trigger.next_run_at = schedule
            .upcoming(tz_offset)
            .next()
            .unwrap()
            .timestamp_micros()
            + tolerance;
    } else {
        new_trigger.next_run_at += Duration::try_seconds(alert.trigger_condition.frequency)
            .unwrap()
            .num_microseconds()
            .unwrap()
            + tolerance;
    }
    trigger_data_stream.next_run_at = new_trigger.next_run_at;

    let last_satisfied_at = if ret.is_some() {
        Some(triggered_at)
    } else {
        None
    };
    // send notification
    if let Some(data) = ret {
        let vars = get_row_column_map(&data);
        // Multi-time range alerts can have multiple time ranges, hence only
        // use the main start_time (now - period) and end_time (now) for the alert evaluation.
        let use_given_time = alert.query_condition.multi_time_range.is_some()
            && !alert
                .query_condition
                .multi_time_range
                .as_ref()
                .unwrap()
                .is_empty();
        let (alert_start_time, alert_end_time) = get_alert_start_end_time(
            &vars,
            alert.trigger_condition.period,
            end_time,
            start_time,
            use_given_time,
        );
        trigger_data_stream.start_time = alert_start_time;
        trigger_data_stream.end_time = alert_end_time;
        match alert.send_notification(&data, end_time, start_time).await {
            Ok((success_msg, err_msg)) => {
                let success_msg = success_msg.trim().to_owned();
                let err_msg = err_msg.trim().to_owned();
                if !err_msg.is_empty() {
                    log::error!(
                        "Some notifications for alert {}/{} could not be sent: {err_msg}",
                        &new_trigger.org,
                        &new_trigger.module_key
                    );
                    trigger_data_stream.error = Some(err_msg);
                } else {
                    log::info!(
                        "Alert notification sent, org: {}, module_key: {}",
                        &new_trigger.org,
                        &new_trigger.module_key
                    );
                }
                trigger_data_stream.success_response = Some(success_msg);
                // Notification was sent successfully, store the last used end_time in the triggers
                trigger_data.period_end_time = if should_store_last_end_time {
                    Some(end_time)
                } else {
                    None
                };
                new_trigger.data = json::to_string(&trigger_data).unwrap();
                // Notification is already sent to some destinations,
                // hence in case of partial errors, no need to retry
                db::scheduler::update_trigger(new_trigger).await?;
            }
            Err(e) => {
                log::error!(
                    "Error sending alert notification: org: {}, module_key: {}",
                    &new_trigger.org,
                    &new_trigger.module_key
                );
                if trigger.retries + 1 >= max_retries {
                    // It has been tried the maximum time, just update the
                    // next_run_at to the next expected trigger time
                    log::debug!(
                        "This alert trigger: {}/{} has reached maximum retries",
                        &new_trigger.org,
                        &new_trigger.module_key
                    );
                    // Alert could not be sent for multiple times, in the next run
                    // if the same start time used for alert evaluation, the extended
                    // timerange may contain huge amount of data, which may cause issues.
                    // E.g. the alert was supposed to run at 11:00am with period of 30min,
                    // but it could not be sent for multiple times, in the next run at
                    // 11:31am (say), the alert will be checked from 10:30am (as start time
                    // still not changed) to 11:31am. This may create issues if the data is huge.
                    // To avoid that, we need to empty the data. So, in the next run, the period
                    // will be used to evaluate the alert.
                    trigger_data.period_end_time = None;
                    new_trigger.data = json::to_string(&trigger_data).unwrap();
                    trigger_data_stream.next_run_at = new_trigger.next_run_at;
                    db::scheduler::update_trigger(new_trigger).await?;
                } else {
                    // Otherwise update its status only
                    db::scheduler::update_status(
                        &new_trigger.org,
                        new_trigger.module,
                        &new_trigger.module_key,
                        db::scheduler::TriggerStatus::Waiting,
                        trigger.retries + 1,
                    )
                    .await?;
                    trigger_data_stream.next_run_at = now;
                }
                trigger_data_stream.status = TriggerDataStatus::Failed;
                trigger_data_stream.error =
                    Some(format!("error sending notification for alert: {e}"));
            }
        }
    } else {
        log::info!(
            "Alert conditions not satisfied, org: {}, module_key: {}",
            &new_trigger.org,
            &new_trigger.module_key
        );
        // Condition did not match, store the last used end_time in the triggers
        // In the next run, the alert will be checked from the last end_time
        trigger_data.period_end_time = if should_store_last_end_time {
            Some(end_time)
        } else {
            None
        };
        new_trigger.data = json::to_string(&trigger_data).unwrap();
        db::scheduler::update_trigger(new_trigger).await?;
        trigger_data_stream.start_time = match start_time {
            Some(start_time) => start_time,
            None => {
                end_time
                    - Duration::try_minutes(alert.trigger_condition.period)
                        .unwrap()
                        .num_microseconds()
                        .unwrap()
            }
        };
        trigger_data_stream.end_time = end_time;
        trigger_data_stream.status = TriggerDataStatus::ConditionNotSatisfied;
    }

    // Check if the alert has been disabled in the mean time
    let mut old_alert =
        match super::alert::get(&org_id, stream_type, stream_name, alert_name).await? {
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
    old_alert.last_triggered_at = Some(triggered_at);
    if let Some(last_satisfied_at) = last_satisfied_at {
        old_alert.last_satisfied_at = Some(last_satisfied_at);
    }
    if let Err(e) = db::alerts::alert::set_without_updating_trigger(
        &org_id,
        stream_type,
        stream_name,
        &old_alert,
    )
    .await
    {
        log::error!("Failed to update alert: {alert_name} after trigger: {e}");
    }
    // publish the triggers as stream
    publish_triggers_usage(trigger_data_stream).await;

    Ok(())
}

async fn handle_report_triggers(trigger: db::scheduler::Trigger) -> Result<(), anyhow::Error> {
    let (_, max_retries) = get_scheduler_max_retries();
    log::debug!(
        "Inside handle_report_trigger,org: {}, module_key: {}",
        &trigger.org,
        &trigger.module_key
    );
    let org_id = &trigger.org;
    // For report, trigger.module_key is the report name
    let report_name = &trigger.module_key;

    let mut report = db::dashboards::reports::get(org_id, report_name).await?;
    let mut new_trigger = db::scheduler::Trigger {
        next_run_at: Utc::now().timestamp_micros(),
        is_realtime: false,
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    if !report.enabled {
        log::debug!(
            "Report not enabled: org: {}, report: {}",
            org_id,
            report_name
        );
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        db::scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }
    let mut run_once = false;

    // Update trigger, set `next_run_at` to the
    // frequency interval of this report
    match report.frequency.frequency_type {
        ReportFrequencyType::Hours => {
            new_trigger.next_run_at += Duration::try_hours(report.frequency.interval)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Days => {
            new_trigger.next_run_at += Duration::try_days(report.frequency.interval)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Weeks => {
            new_trigger.next_run_at += Duration::try_weeks(report.frequency.interval)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Months => {
            // Assumes each month to be of 30 days.
            new_trigger.next_run_at += Duration::try_days(report.frequency.interval * 30)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Once => {
            // Check on next week
            new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
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

    let triggered_at = trigger.start_time.unwrap_or_default();
    let processing_delay = triggered_at - trigger.next_run_at;

    let mut trigger_data_stream = TriggerData {
        _timestamp: triggered_at,
        org: trigger.org.clone(),
        module: if report.destinations.is_empty() {
            TriggerDataType::CachedReport
        } else {
            TriggerDataType::Report
        },
        key: trigger.module_key.clone(),
        next_run_at: new_trigger.next_run_at,
        is_realtime: trigger.is_realtime,
        is_silenced: trigger.is_silenced,
        status: TriggerDataStatus::Completed,
        start_time: trigger.start_time.unwrap_or_default(),
        end_time: trigger.end_time.unwrap_or_default(),
        retries: trigger.retries,
        error: None,
        success_response: None,
        is_partial: None,
        delay_in_secs: Some(Duration::microseconds(processing_delay).num_seconds()),
        evaluation_took_in_secs: None,
    };

    if trigger.retries >= max_retries {
        // It has been tried the maximum time, just update the
        // next_run_at to the next expected trigger time
        log::info!(
            "This report trigger: {org_id}/{report_name} has passed maximum retries, skipping to next run",
            org_id = &new_trigger.org,
            report_name = report_name
        );
        db::scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }
    match report.send_subscribers().await {
        Ok(_) => {
            log::info!("Report {} sent to destination", report_name);
            // Report generation successful, update the trigger
            if run_once {
                new_trigger.status = db::scheduler::TriggerStatus::Completed;
            }
            db::scheduler::update_trigger(new_trigger).await?;
            log::debug!("Update trigger for report: {}", report_name);
            trigger_data_stream.end_time = Utc::now().timestamp_micros();
        }
        Err(e) => {
            log::error!("Error sending report to subscribers: {e}");
            if trigger.retries + 1 >= max_retries && !run_once {
                // It has been tried the maximum time, just update the
                // next_run_at to the next expected trigger time
                log::debug!(
                    "This report trigger: {org_id}/{report_name} has reached maximum possible retries"
                );
                trigger_data_stream.next_run_at = new_trigger.next_run_at;
                db::scheduler::update_trigger(new_trigger).await?;
            } else {
                if run_once {
                    report.enabled = true;
                }
                // Otherwise update its status only
                db::scheduler::update_status(
                    &new_trigger.org,
                    new_trigger.module,
                    &new_trigger.module_key,
                    db::scheduler::TriggerStatus::Waiting,
                    trigger.retries + 1,
                )
                .await?;
            }
            trigger_data_stream.end_time = Utc::now().timestamp_micros();
            trigger_data_stream.status = TriggerDataStatus::Failed;
            trigger_data_stream.error = Some(format!("error processing report: {e}"));
        }
    }

    // Check if the report has been disabled in the mean time
    let mut old_report = db::dashboards::reports::get(org_id, report_name).await?;
    if old_report.enabled {
        old_report.enabled = report.enabled;
    }
    old_report.last_triggered_at = Some(triggered_at);
    let result = db::dashboards::reports::set_without_updating_trigger(org_id, &old_report).await;
    if result.is_err() {
        log::error!(
            "Failed to update report: {report_name} after trigger: {}",
            result.err().unwrap()
        );
    }
    publish_triggers_usage(trigger_data_stream).await;

    Ok(())
}

async fn handle_derived_stream_triggers(
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    log::debug!(
        "Inside handle_derived_stream_triggers processing trigger: {}",
        trigger.module_key
    );
    let (_, max_retries) = get_scheduler_max_retries();

    // module_key format: stream_type/org_id/pipeline_name/pipeline_id
    let columns = trigger.module_key.split('/').collect::<Vec<_>>();
    assert_eq!(columns.len(), 4);
    let stream_type: StreamType = columns[0].into();
    let org_id = columns[1];
    let pipeline_name = columns[2];
    let pipeline_id = columns[3];

    let mut new_trigger = db::scheduler::Trigger {
        next_run_at: Utc::now().timestamp_micros(),
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    let Ok(pipeline) = db::pipeline::get_by_id(pipeline_id).await else {
        log::warn!(
            "Pipeline associated with trigger not found: {}/{}/{}/{}. Deleting this trigger",
            org_id,
            stream_type,
            pipeline_name,
            pipeline_id
        );
        db::scheduler::delete(&trigger.org, trigger.module, &trigger.module_key).await?;
        return Err(anyhow::anyhow!(
            "Pipeline associated with trigger not found: {}/{}/{}/{}",
            org_id,
            stream_type,
            pipeline_name,
            pipeline_id
        ));
    };

    if !pipeline.enabled {
        // remove the trigger from scheduler. Trigger will be added back when the pipeline is
        // enabled again
        log::info!("Pipeline associated with trigger not enabled. Removing trigger from Scheduler");
        db::scheduler::delete(&trigger.org, trigger.module, &trigger.module_key).await?;
        return Ok(());
    }

    let Some(derived_stream) = pipeline.get_derived_stream() else {
        db::scheduler::delete(&trigger.org, trigger.module, &trigger.module_key).await?;
        return Err(anyhow::anyhow!(
            "DerivedStream associated with the trigger not found in pipeline: {}/{}/{}",
            org_id,
            pipeline_name,
            pipeline_id,
        ));
    };
    let start_time = if trigger.data.is_empty() {
        None
    } else {
        let trigger_data: Option<ScheduledTriggerData> = json::from_str(&trigger.data).ok();
        if let Some(trigger_data) = trigger_data {
            trigger_data
                .period_end_time
                .map(|period_end_time| period_end_time + 1)
        } else {
            None
        }
    };

    if trigger.retries >= max_retries {
        // It has been tried the maximum time, just update the
        // next_run_at to the next expected trigger time
        log::info!(
            "This DerivedStream trigger: {}/{} has passed maximum retries, skipping to next run",
            &new_trigger.org,
            &new_trigger.module_key
        );
        if derived_stream.trigger_condition.frequency_type == FrequencyType::Cron {
            let schedule = Schedule::from_str(&derived_stream.trigger_condition.cron)?;
            // tz_offset is in minutes
            let tz_offset = FixedOffset::east_opt(derived_stream.tz_offset * 60).unwrap();
            new_trigger.next_run_at = schedule
                .upcoming(tz_offset)
                .next()
                .unwrap()
                .timestamp_micros();
        } else {
            new_trigger.next_run_at +=
                Duration::try_minutes(derived_stream.trigger_condition.frequency)
                    .unwrap()
                    .num_microseconds()
                    .unwrap();
        }
        new_trigger.data = "".to_string();
        db::scheduler::update_trigger(new_trigger).await?;
        return Ok(());
    }

    // in case the range [start_time, end_time] is greater than querying period, it needs to
    // evaluate and ingest 1 period at a time.
    let now = Utc::now().timestamp_micros();
    let period_num_microseconds = Duration::try_minutes(derived_stream.trigger_condition.period)
        .unwrap()
        .num_microseconds()
        .unwrap();
    let (mut start, mut end) = if let Some(t0) = start_time {
        (Some(t0), std::cmp::min(now, t0 + period_num_microseconds))
    } else {
        (None, now)
    };

    while end <= now {
        log::debug!(
            "DerivedStream: querying for time range: start_time {}, end_time {}. Final end_time is {}",
            start.unwrap_or_default(),
            end,
            now
        );

        // evaluate trigger and configure trigger next run time
        let (ret, next) = derived_stream
            .evaluate((start, end), &trigger.module_key)
            .await?;
        let is_satisfied = ret.as_ref().map_or(false, |ret| !ret.is_empty());

        let mut trigger_data_stream = TriggerData {
            _timestamp: trigger.start_time.unwrap_or_default(),
            org: trigger.org.clone(),
            module: TriggerDataType::DerivedStream,
            key: trigger.module_key.clone(),
            next_run_at: new_trigger.next_run_at,
            is_realtime: trigger.is_realtime,
            is_silenced: trigger.is_silenced,
            status: TriggerDataStatus::Completed,
            start_time: if let Some(start) = start {
                start
            } else {
                next - period_num_microseconds
            },
            end_time: next,
            retries: trigger.retries,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
        };

        // ingest evaluation result into destination
        if is_satisfied {
            log::info!(
                "DerivedStream(org: {}/module_key: {}): query conditions satisfied. Result to be processed and ingested",
                new_trigger.org,
                new_trigger.module_key
            );

            let local_val = ret // checked is some
                .unwrap()
                .into_iter()
                .map(json::Value::Object)
                .collect::<Vec<_>>();

            // pass search results to pipeline to get modified results before ingesting
            let mut json_data_by_stream: HashMap<StreamParams, Vec<json::Value>> = HashMap::new();
            let mut ingestion_error_msg = None;

            match ExecutablePipeline::new(&pipeline).await {
                Err(e) => {
                    let err_msg = format!(
                        "Pipeline: {}/{} associated with the DerivedStream failed to initialize ExecutablePipeline. Caused by: {}",
                        org_id, pipeline_name, e
                    );
                    log::error!("{err_msg}");
                    ingestion_error_msg = Some(err_msg);
                }
                Ok(exec_pl) => match exec_pl.process_batch(org_id, local_val).await {
                    Err(e) => {
                        let err_msg = format!(
                            "DerivedStream query results failed to pass through the associated pipeline: {}/{}. Caused by: {}",
                            org_id, pipeline_name, e
                        );
                        log::error!("{err_msg}");
                        ingestion_error_msg = Some(err_msg);
                        end = now;
                    }
                    Ok(pl_results) => {
                        for (stream_params, stream_pl_results) in pl_results {
                            if matches!(
                                stream_params.stream_type,
                                StreamType::Logs
                                    | StreamType::EnrichmentTables
                                    | StreamType::Metrics
                            ) {
                                let (_, results): (Vec<_>, Vec<_>) =
                                    stream_pl_results.into_iter().unzip();
                                json_data_by_stream
                                    .entry(stream_params)
                                    .or_default()
                                    .extend(results);
                            }
                        }
                    }
                },
            };

            // Ingest result into destination stream
            if ingestion_error_msg.is_none() {
                for (dest_stream, records) in json_data_by_stream {
                    let (org_id, stream_name, stream_type): (String, String, i32) = {
                        (
                            dest_stream.org_id.into(),
                            dest_stream.stream_name.into(),
                            cluster_rpc::StreamType::from(dest_stream.stream_type).into(),
                        )
                    };
                    let req = cluster_rpc::IngestionRequest {
                        org_id: org_id.clone(),
                        stream_name: stream_name.clone(),
                        stream_type,
                        data: Some(cluster_rpc::IngestionData::from(records)),
                        ingestion_type: Some(cluster_rpc::IngestionType::Json.into()),
                    };
                    match ingestion_service::ingest(req).await {
                        Ok(resp) if resp.status_code == 200 => {
                            log::info!(
                                "DerivedStream result ingested to destination {org_id}/{stream_name}/{stream_type}",
                            );
                        }
                        error => {
                            let err = error.map_or_else(|e| e.to_string(), |resp| resp.message);
                            log::error!(
                                "Error in ingesting DerivedStream result to destination {:?}, org: {}, module_key: {}",
                                err,
                                new_trigger.org,
                                new_trigger.module_key
                            );
                            ingestion_error_msg = Some(err);
                            break;
                        }
                    };
                }
            }

            if let Some(err) = ingestion_error_msg {
                if trigger.retries + 1 >= max_retries {
                    // It has been tried the maximum time, just update the next_run_at to the
                    // next expected trigger time
                    log::debug!(
                        "This DerivedStream trigger: {}/{} has reached maximum retires",
                        &new_trigger.org,
                        &new_trigger.module_key
                    );
                    trigger_data_stream.next_run_at = new_trigger.next_run_at;
                } else {
                    // Otherwise, update its status only
                    db::scheduler::update_status(
                        &new_trigger.org,
                        new_trigger.module.clone(),
                        &new_trigger.module_key,
                        db::scheduler::TriggerStatus::Waiting,
                        trigger.retries + 1,
                    )
                    .await?;
                    trigger_data_stream.status = TriggerDataStatus::Failed;
                    trigger_data_stream.error = Some(err);
                }
                // set end to now to exit the loop
                end = now;
            }
        } else {
            log::info!(
                "DerivedStream condition does not match any data for the period, org: {}, module_key: {}",
                &new_trigger.org,
                &new_trigger.module_key
            );
            trigger_data_stream.status = TriggerDataStatus::ConditionNotSatisfied;
        }

        // publish the triggers as stream
        publish_triggers_usage(trigger_data_stream).await;

        // move the time range forward by frequency
        start = Some(next);
        end += period_num_microseconds + 1;

        // configure next run time before exiting the loop
        if end > now {
            // Store the last used derived stream period end time
            new_trigger.data = json::to_string(&ScheduledTriggerData {
                period_end_time: Some(start.unwrap()), // updated start_time as end_time
                tolerance: 0,
            })
            .unwrap();

            if is_satisfied && derived_stream.trigger_condition.silence > 0 {
                if derived_stream.trigger_condition.frequency_type == FrequencyType::Cron {
                    let schedule = Schedule::from_str(&derived_stream.trigger_condition.cron)?;
                    let silence = Utc::now()
                        + Duration::try_minutes(derived_stream.trigger_condition.silence).unwrap();
                    let silence = silence.with_timezone(
                        FixedOffset::east_opt(derived_stream.tz_offset * 60)
                            .as_ref()
                            .unwrap(),
                    );
                    // Check for the cron timestamp after the silence period
                    new_trigger.next_run_at =
                        schedule.after(&silence).next().unwrap().timestamp_micros();
                } else {
                    new_trigger.next_run_at +=
                        Duration::try_minutes(derived_stream.trigger_condition.silence)
                            .unwrap()
                            .num_microseconds()
                            .unwrap();
                }
                new_trigger.is_silenced = true;
            } else if derived_stream.trigger_condition.frequency_type == FrequencyType::Cron {
                let schedule = Schedule::from_str(&derived_stream.trigger_condition.cron)?;
                // tz_offset is in minutes
                let tz_offset = FixedOffset::east_opt(derived_stream.tz_offset * 60).unwrap();
                new_trigger.next_run_at = schedule
                    .upcoming(tz_offset)
                    .next()
                    .unwrap()
                    .timestamp_micros();
            } else {
                new_trigger.next_run_at +=
                    Duration::try_minutes(derived_stream.trigger_condition.frequency)
                        .unwrap()
                        .num_microseconds()
                        .unwrap();
            }
        }
    }

    // save the new trigger
    db::scheduler::update_trigger(new_trigger).await?;

    Ok(())
}
