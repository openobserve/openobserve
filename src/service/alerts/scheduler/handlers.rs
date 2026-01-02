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

use std::{collections::HashMap, str::FromStr, time::Instant};

use chrono::{DateTime, Duration, FixedOffset, Utc};
use config::{
    cluster::LOCAL_NODE,
    get_config, ider,
    meta::{
        alerts::TriggerCondition,
        dashboards::reports::ReportFrequencyType,
        pipeline::components::NodeData,
        self_reporting::{
            error::{ErrorData, ErrorSource, PipelineError},
            usage::{TriggerData, TriggerDataStatus, TriggerDataType},
        },
        stream::{StreamParams, StreamType},
        triggers::ScheduledTriggerData,
    },
    utils::{
        json,
        rand::get_rand_num_within,
        time::{hour_micros, now_micros, second_micros},
    },
};
use cron::Schedule;
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    scheduler::get_scheduler_max_retries,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::recommendations::service::QueryRecommendationService;
use proto::cluster_rpc;

#[cfg(feature = "enterprise")]
use crate::service::alerts::scheduler::query_optimization_recommendation::QueryOptimizerContext;
#[cfg(feature = "cloud")]
use crate::service::organization::is_org_in_free_trial_period;
use crate::service::{
    alerts::{
        alert::{AlertExt, get_alert_start_end_time, get_by_id_db, get_row_column_map},
        derived_streams::DerivedStreamExt,
    },
    dashboards::reports::SendReport,
    db::{self, alerts::alert::set_without_updating_trigger},
    ingestion::ingestion_service,
    pipeline::batch_execution::ExecutablePipeline,
    self_reporting::publish_triggers_usage,
};

pub async fn handle_triggers(
    trace_id: &str,
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    match trigger.module {
        db::scheduler::TriggerModule::Report => handle_report_triggers(trace_id, trigger).await,
        db::scheduler::TriggerModule::Alert => handle_alert_triggers(trace_id, trigger).await,
        db::scheduler::TriggerModule::DerivedStream => {
            handle_derived_stream_triggers(trace_id, trigger).await
        }
        db::scheduler::TriggerModule::QueryRecommendations => {
            handle_query_recommendations_triggers(trace_id, trigger).await
        }
        db::scheduler::TriggerModule::Backfill => handle_backfill_triggers(trace_id, trigger).await,
    }
}

/// Returns the skipped timestamps and the final timestamp to evaluate the alert.
/// `tz_offset` is in minutes
/// Frequency is in seconds
#[allow(clippy::too_many_arguments)]
fn get_skipped_timestamps(
    supposed_to_run_at: i64,
    cron: &str,
    tz_offset: i32,
    frequency: i64,
    delay: i64,
    align_time: bool,
    now: i64,
    timezone_str: Option<&str>,
) -> (Vec<i64>, i64) {
    let mut skipped_timestamps = Vec::new();
    let mut next_run_at;
    if !cron.is_empty() {
        let cron = Schedule::from_str(cron).unwrap();
        let suppposed_to_run_at_dt = DateTime::from_timestamp_micros(supposed_to_run_at).unwrap();
        let suppposed_to_run_at_dt =
            suppposed_to_run_at_dt.with_timezone(&FixedOffset::east_opt(tz_offset * 60).unwrap());
        next_run_at = cron
            .after(&suppposed_to_run_at_dt)
            .next()
            .unwrap()
            .timestamp_micros();
        while next_run_at <= supposed_to_run_at + delay {
            skipped_timestamps.push(next_run_at);
            let suppposed_to_run_at_dt = DateTime::from_timestamp_micros(next_run_at).unwrap();
            let suppposed_to_run_at_dt = suppposed_to_run_at_dt
                .with_timezone(&FixedOffset::east_opt(tz_offset * 60).unwrap());
            next_run_at = cron
                .after(&suppposed_to_run_at_dt)
                .next()
                .unwrap()
                .timestamp_micros();
        }
    } else {
        next_run_at = if align_time {
            TriggerCondition::align_time(
                supposed_to_run_at + second_micros(frequency),
                tz_offset,
                Some(frequency),
                timezone_str,
            )
        } else {
            supposed_to_run_at + second_micros(frequency)
        };

        while next_run_at <= supposed_to_run_at + delay {
            skipped_timestamps.push(next_run_at);
            next_run_at += second_micros(frequency);
        }
    }
    // Final timestamp is what we should use to evaluate the alert
    let final_timestamp = if !align_time {
        now
    } else if skipped_timestamps.is_empty() {
        supposed_to_run_at
    } else {
        // Pop the last timestamp if it is greater than the supposed to run at
        if skipped_timestamps.last().unwrap() > &supposed_to_run_at {
            skipped_timestamps.pop().unwrap()
        } else {
            next_run_at
        }
    };
    (skipped_timestamps, final_timestamp)
}

/// Returns maximum considerable delay in microseconds - minimum of 1 hour or 20% of the frequency.
fn _get_max_considerable_delay(frequency: i64) -> i64 {
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

async fn handle_alert_triggers(
    trace_id: &str,
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    let query_trace_id = ider::generate_trace_id();
    let scheduler_trace_id = format!("{trace_id}/{query_trace_id}");
    let (_, max_retries) = get_scheduler_max_retries();
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Inside handle_alert_triggers: processing trigger: {}",
        &trigger.module_key
    );
    let now = Utc::now().timestamp_micros();
    let triggered_at = trigger.start_time.unwrap_or_default();
    let time_in_queue = Duration::microseconds(now - triggered_at).num_milliseconds();
    let source_node = LOCAL_NODE.name.clone();
    let mut new_trigger = db::scheduler::Trigger {
        next_run_at: now,
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    // here it can be alert id or alert name
    let alert = if let Ok(alert_id) = svix_ksuid::Ksuid::from_str(&trigger.module_key) {
        let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
        match db::alerts::alert::get_by_id(client, &trigger.org, alert_id).await {
            Ok(Some((_, alert))) => alert,
            Ok(None) => {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Alert not found for module_key: {}, deleting this trigger job",
                    trigger.module_key
                );
                if let Err(e) = db::scheduler::delete(
                    &trigger.org,
                    db::scheduler::TriggerModule::Alert,
                    &trigger.module_key,
                )
                .await
                {
                    log::error!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Error deleting trigger job: {e}"
                    );
                }
                publish_triggers_usage(TriggerData {
                    _timestamp: now,
                    org: trigger.org.clone(),
                    module: TriggerDataType::Alert,
                    key: format!("/{}", trigger.module_key),
                    status: TriggerDataStatus::Failed,
                    scheduler_trace_id: Some(scheduler_trace_id.clone()),
                    error: Some("Alert not found. Deleting trigger job.".to_string()),
                    time_in_queue_ms: Some(time_in_queue),
                    source_node: Some(source_node.clone()),
                    retries: trigger.retries,
                    is_realtime: trigger.is_realtime,
                    is_silenced: trigger.is_silenced,
                    start_time: now,
                    end_time: now,
                    next_run_at: now,
                    ..Default::default()
                });
                return Err(anyhow::anyhow!("Alert not found"));
            }
            Err(e) => {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Error getting alert by id: {e}"
                );
                // if trigger max retries is reached, update the next run at
                if trigger.retries + 1 >= max_retries {
                    // next run at is after 5mins
                    let next_run_at = now + Duration::minutes(5).num_microseconds().unwrap();
                    new_trigger.next_run_at = next_run_at;
                    db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
                } else {
                    // Mark the trigger as failed
                    db::scheduler::update_status(
                        &trigger.org,
                        db::scheduler::TriggerModule::Alert,
                        &trigger.module_key,
                        db::scheduler::TriggerStatus::Waiting,
                        trigger.retries + 1,
                        None,
                        true,
                        &query_trace_id,
                    )
                    .await?;
                }
                publish_triggers_usage(TriggerData {
                    _timestamp: now,
                    org: trigger.org.clone(),
                    module: TriggerDataType::Alert,
                    key: format!("/{}", trigger.module_key),
                    status: TriggerDataStatus::Failed,
                    scheduler_trace_id: Some(scheduler_trace_id.clone()),
                    error: Some(format!("Error getting alert by id: {e}")),
                    time_in_queue_ms: Some(time_in_queue),
                    source_node: Some(source_node.clone()),
                    retries: trigger.retries,
                    is_realtime: trigger.is_realtime,
                    is_silenced: trigger.is_silenced,
                    start_time: now,
                    end_time: now,
                    next_run_at: now,
                    ..Default::default()
                });
                return Err(anyhow::anyhow!("Error getting alert by id: {}", e));
            }
        }
    } else {
        log::error!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Alert id is not a valid ksuid: {}, deleting this trigger job",
            trigger.module_key
        );
        // Module key is not a valid ksuid, delete the trigger job
        if let Err(e) = db::scheduler::delete(
            &trigger.org,
            db::scheduler::TriggerModule::Alert,
            &trigger.module_key,
        )
        .await
        {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Error deleting trigger job: {e}"
            );
        }
        return Err(anyhow::anyhow!(
            "Alert id is not a valid ksuid: {}",
            trigger.module_key
        ));
    };
    // Set the is_realtime field according to the alert
    new_trigger.is_realtime = alert.is_real_time;

    // [ENTERPRISE] Initialize RCA batch tracking for this scheduler run
    // #[cfg(feature = "enterprise")]
    // let rca_enabled =
    //     o2_enterprise::enterprise::ai::rca::integration::is_rca_enabled_for_org(&new_trigger.
    // org); #[cfg(not(feature = "enterprise"))]
    let _rca_enabled = false;

    // Helper closure to mark alert completion and process batch if needed
    // #[cfg(feature = "enterprise")]
    // let mark_rca_completion = || async {
    //     if rca_enabled {
    //         let is_batch_complete =
    //             o2_enterprise::enterprise::ai::rca::mark_alert_completed(trace_id);
    //         if is_batch_complete {
    //             log::info!(
    //                 "[SCHEDULER trace_id {scheduler_trace_id}] Batch {} complete, processing
    // incidents",                 trace_id
    //             );
    //             if let Err(e) =
    // o2_enterprise::enterprise::ai::rca::integration::process_batch_and_create_incidents(
    //                 trace_id
    //             ).await {
    //                 log::error!(
    //                     "[SCHEDULER trace_id {scheduler_trace_id}] Error creating incidents from
    // batch {}: {}",                     trace_id, e
    //                 );
    //             }
    //         }
    //     }
    // };

    #[cfg(feature = "cloud")]
    {
        if !is_org_in_free_trial_period(&trigger.org).await? {
            let mut alert = alert;
            log::info!(
                "pausing alert {} id {} in org {} because free trial expiry",
                alert.name,
                trigger.module_key,
                trigger.org
            );
            alert.enabled = false;
            // Update the trigger job to the next expected trigger time to check again
            if let Err(e) = set_without_updating_trigger(&trigger.org, alert).await {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Failed to pause alert due to trial expiry: {}/{} : {e}",
                    &trigger.org,
                    &trigger.module_key
                );
            }
            return Ok(());
        }
    }

    let is_realtime = new_trigger.is_realtime;
    let is_silenced = trigger.is_silenced;
    let mut final_end_time = trigger.next_run_at;

    if is_realtime && is_silenced {
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Realtime alert need wakeup, {}/{}",
            &trigger.org,
            &trigger.module_key
        );
        // wakeup the trigger
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        return Ok(());
    }

    if !alert.enabled {
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        new_trigger.is_silenced = true;
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        return Ok(());
    }

    let trigger_data: Result<ScheduledTriggerData, json::Error> = json::from_str(&trigger.data);
    let mut trigger_data = if let Ok(trigger_data) = trigger_data {
        trigger_data
    } else {
        ScheduledTriggerData {
            period_end_time: None,
            tolerance: 0,
            last_satisfied_at: None,
            backfill_job: None,
        }
    };

    if trigger.retries >= max_retries {
        // It has been tried the maximum time, just update the
        // next_run_at to the next expected trigger time
        log::info!(
            "[SCHEDULER trace_id {scheduler_trace_id}] This alert trigger: {}/{} has passed maximum retries, skipping to next run",
            &new_trigger.org,
            &new_trigger.module_key
        );

        new_trigger.next_run_at =
            alert
                .trigger_condition
                .get_next_trigger_time(true, alert.tz_offset, false, None)?;

        // Keep the last_satisfied_at field
        trigger_data.reset();
        new_trigger.data = json::to_string(&trigger_data).unwrap();
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        return Ok(());
    }

    // The delay in processing the trigger from the time it was supposed to run
    let (processing_delay, _use_period) = if trigger.next_run_at == 0 {
        (0, true)
    } else {
        let delay = now - trigger.next_run_at;

        let skipped_timestamps_end_timestamp = get_skipped_timestamps(
            trigger.next_run_at,
            if alert
                .trigger_condition
                .frequency_type
                .eq(&config::meta::alerts::FrequencyType::Cron)
            {
                alert.trigger_condition.cron.as_str()
            } else {
                ""
            },
            alert.tz_offset,
            alert.trigger_condition.frequency,
            delay,
            alert.trigger_condition.align_time,
            now,
            alert.trigger_condition.timezone.as_deref(),
        );
        final_end_time = skipped_timestamps_end_timestamp.1;
        let skipped_timestamps = skipped_timestamps_end_timestamp.0;
        // Skip Alerts: Say for some reason, this alert trigger (period: 10mins, frequency 5mins)
        // which was supposed to run at 10am is now processed after a delay of 5 mins (may be alert
        // manager was stuck or something). In that case, only use the period strictly to evaluate
        // the alert. If the delay is within the max considerable delay, consider the delay with
        // period, otherwise strictly use the period only. Also, since we are skipping this alert
        // (9:50am to 10am timerange), we need to report this event to the `triggers` usage stream.
        if !skipped_timestamps.is_empty() {
            let skipped_first_timestamp = skipped_timestamps.first().unwrap();
            let skipped_last_timestamp = skipped_timestamps.last().unwrap();
            let start_time = skipped_first_timestamp
                - Duration::try_minutes(alert.trigger_condition.period)
                    .unwrap()
                    .num_microseconds()
                    .unwrap();
            let skipped_alerts_count = skipped_timestamps.len();
            // If delay is greater than the alert frequency, skip them and report the event
            // to the `triggers` usage stream.
            publish_triggers_usage(TriggerData {
                _timestamp: now - 1,
                org: trigger.org.clone(),
                module: TriggerDataType::Alert,
                key: format!("{}/{}", alert.name, trigger.module_key),
                next_run_at: triggered_at,
                is_realtime: trigger.is_realtime,
                is_silenced: trigger.is_silenced,
                status: TriggerDataStatus::Skipped,
                start_time,
                end_time: *skipped_last_timestamp,
                retries: trigger.retries,
                delay_in_secs: Some(Duration::microseconds(delay).num_seconds()),
                source_node: Some(source_node.clone()),
                scheduler_trace_id: Some(scheduler_trace_id.clone()),
                time_in_queue_ms: Some(time_in_queue),
                skipped_alerts_count: Some(skipped_alerts_count as i64),
                ..Default::default()
            });
        }
        log::info!(
            "[SCHEDULER trace_id {scheduler_trace_id}] alert {} skipped due to delay: {}",
            &trigger.module_key,
            delay
        );
        (now - final_end_time, true)
    };

    // This is the end time of the last trigger timerange  + 1.
    // This will be used in alert evaluation as the start time.
    // If this is None, alert will use the period to evaluate alert
    let start_time =
        // approximate the start time involving the alert manager delay
            final_end_time - Duration::try_minutes(alert.trigger_condition.period)
                .unwrap()
                .num_microseconds()
                .unwrap();

    let mut should_store_last_end_time =
        alert.trigger_condition.frequency == (alert.trigger_condition.period * 60);
    let mut trigger_data_stream: TriggerData = TriggerData {
        _timestamp: now,
        org: trigger.org.clone(),
        module: TriggerDataType::Alert,
        key: format!("{}/{}", alert.name, trigger.module_key),
        next_run_at: new_trigger.next_run_at,
        is_realtime: trigger.is_realtime,
        is_silenced: trigger.is_silenced,
        status: TriggerDataStatus::Completed,
        start_time,
        end_time: final_end_time,
        retries: trigger.retries,
        error: None,
        success_response: None,
        is_partial: None,
        delay_in_secs: Some(Duration::microseconds(processing_delay).num_seconds()),
        evaluation_took_in_secs: None,
        source_node: Some(source_node),
        query_took: None,
        scheduler_trace_id: Some(scheduler_trace_id.clone()),
        time_in_queue_ms: Some(time_in_queue),
        ..Default::default()
    };

    let evaluation_took = Instant::now();
    // evaluate alert
    let result = alert
        .evaluate(
            None,
            (Some(start_time), final_end_time),
            Some(query_trace_id.clone()),
        )
        .await;
    let evaluation_took = evaluation_took.elapsed().as_secs_f64();
    trigger_data_stream.evaluation_took_in_secs = Some(evaluation_took);
    if result.is_err() {
        let err = result.err().unwrap();
        trigger_data_stream.status = TriggerDataStatus::Failed;
        let err_string = err.to_string();
        log::error!(
            "[SCHEDULER trace_id {scheduler_trace_id}] alert {} evaluation failed: {}",
            &new_trigger.module_key,
            err_string
        );
        if err_string.starts_with("Partial") {
            trigger_data_stream.is_partial = Some(true);
        }
        trigger_data_stream.error = Some(err_string);
        // update its status and retries
        if trigger.retries + 1 >= max_retries {
            if get_config().limit.pause_alerts_on_retries {
                // It has been tried the maximum time, just disable the alert
                // and show the error.
                let mut alert_curr = get_by_id_db(&trigger.org, alert.id.unwrap()).await?;
                alert_curr.enabled = false;
                if let Err(e) = set_without_updating_trigger(&trigger.org, alert_curr).await {
                    log::error!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Failed to update alert: {}/{} after trigger: {e}",
                        &trigger.org,
                        &trigger.module_key
                    );
                }
            }
            // This didn't work, update the next_run_at to the next expected trigger time
            new_trigger.next_run_at = alert.trigger_condition.get_next_trigger_time(
                true,
                alert.tz_offset,
                false,
                None,
            )?;
            trigger_data.reset();
            new_trigger.data = json::to_string(&trigger_data).unwrap();
            trigger_data_stream.next_run_at = new_trigger.next_run_at;
            db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        } else {
            // update its status and retries
            db::scheduler::update_status(
                &new_trigger.org,
                new_trigger.module,
                &new_trigger.module_key,
                db::scheduler::TriggerStatus::Waiting,
                trigger.retries + 1,
                None,
                true,
                &query_trace_id,
            )
            .await?;
        }
        publish_triggers_usage(trigger_data_stream);

        // [ENTERPRISE] Mark completion even on failure
        // #[cfg(feature = "enterprise")]
        // mark_rca_completion().await;

        return Err(err);
    }

    let trigger_results = result.unwrap();
    trigger_data_stream.query_took = trigger_results.query_took;
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] result of alert {} evaluation matched condition: {}",
        &new_trigger.module_key,
        trigger_results.data.is_some(),
    );
    if trigger_results.data.is_some() {
        log::info!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Alert conditions satisfied, org: {}, module_key: {}",
            &new_trigger.org,
            &new_trigger.module_key
        );
    }
    if let Some(tolerance) = alert.trigger_condition.tolerance_in_secs
        && tolerance > 0
    {
        let tolerance = Duration::seconds(get_rand_num_within(0, tolerance as u64) as i64)
            .num_microseconds()
            .unwrap();
        if tolerance > 0 {
            trigger_data.tolerance = tolerance;
        }
    }
    if trigger_results.data.is_some() && alert.trigger_condition.silence > 0 {
        new_trigger.next_run_at =
            alert
                .trigger_condition
                .get_next_trigger_time(true, alert.tz_offset, true, None)?;
        new_trigger.is_silenced = true;
        // For silence period, no need to store last end time
        should_store_last_end_time = false;
    } else {
        new_trigger.next_run_at =
            alert
                .trigger_condition
                .get_next_trigger_time(true, alert.tz_offset, false, None)?;
    }
    trigger_data_stream.next_run_at = new_trigger.next_run_at;

    if trigger_results.data.is_some() {
        trigger_data.last_satisfied_at = Some(triggered_at);
    }

    // send notification
    if let Some(data) = trigger_results.data {
        // Check if grouping is enabled BEFORE deduplication (enterprise-only feature)
        #[cfg(feature = "enterprise")]
        let grouping_enabled = alert
            .deduplication
            .as_ref()
            .and_then(|d| d.grouping.as_ref())
            .map(|g| g.enabled)
            .unwrap_or(false);

        #[cfg(not(feature = "enterprise"))]
        let grouping_enabled = false;

        if grouping_enabled {
            #[cfg(feature = "enterprise")]
            {
                let grouping_config = alert
                    .deduplication
                    .as_ref()
                    .and_then(|d| d.grouping.as_ref())
                    .unwrap();

                // Calculate fingerprint for grouping
                let fingerprint = if let Some(dedup_config) = alert.deduplication.as_ref() {
                    let org_config =
                        match crate::service::alerts::org_config::get_deduplication_config(
                            &new_trigger.org,
                        )
                        .await
                        {
                            Ok(Some(config)) => Some(config),
                            _ => None,
                        };

                    if let Some(first_row) = data.first() {
                        crate::service::alerts::deduplication::calculate_fingerprint(
                            &alert,
                            first_row,
                            dedup_config,
                            org_config.as_ref(),
                        )
                    } else {
                        alert.get_unique_key()
                    }
                } else {
                    alert.get_unique_key()
                };

                log::debug!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Adding alert to batch, org: {}, alert: {}, fingerprint: {}, rows: {}",
                    &new_trigger.org,
                    &alert.name,
                    fingerprint,
                    data.len()
                );

                // Add to batch
                let batch_ready = crate::service::alerts::grouping::add_to_batch(
                    fingerprint.clone(),
                    new_trigger.org.clone(),
                    alert.clone(),
                    data.clone(),
                    grouping_config.group_wait_seconds,
                    grouping_config.max_group_size,
                );

                if batch_ready {
                    log::info!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Batch {} reached max size, sending immediately",
                        fingerprint
                    );
                    if let Some(batch) =
                        crate::service::alerts::grouping::get_ready_batch(&fingerprint)
                        && let Err(e) =
                            crate::job::alert_grouping::send_grouped_notification_sync(batch).await
                    {
                        log::error!(
                            "[SCHEDULER trace_id {scheduler_trace_id}] Failed to send grouped notification: {}",
                            e
                        );
                    }
                } else {
                    log::debug!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Alert added to batch, waiting for more alerts or timeout, fingerprint: {}",
                        fingerprint
                    );
                }

                // Mark as grouped for history tracking
                trigger_data_stream.dedup_enabled = Some(true);
                trigger_data_stream.grouped = Some(true);
                trigger_data_stream.group_size = Some(if batch_ready {
                    grouping_config.max_group_size as i32
                } else {
                    1
                });

                // Alert added to batch, don't send individual notification
                trigger_data.period_end_time = if should_store_last_end_time {
                    Some(trigger_results.end_time)
                } else {
                    None
                };
                new_trigger.data = json::to_string(&trigger_data).unwrap();
                db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
                publish_triggers_usage(trigger_data_stream);
                return Ok(());
            }
        }

        // Apply deduplication if enabled (enterprise-only feature)
        #[cfg(feature = "enterprise")]
        let data = if let Some(db) = ORM_CLIENT.get() {
            match crate::service::alerts::deduplication::apply_deduplication(
                db,
                &alert,
                data.clone(),
            )
            .await
            {
                Ok(deduplicated_data) => {
                    if deduplicated_data.is_empty() {
                        log::debug!(
                            "[SCHEDULER trace_id {scheduler_trace_id}] All alert results deduplicated for org: {}, module_key: {}",
                            &new_trigger.org,
                            &new_trigger.module_key
                        );

                        // Mark as suppressed for history tracking
                        trigger_data_stream.dedup_enabled = Some(true);
                        trigger_data_stream.dedup_suppressed = Some(true);

                        // All results were deduplicated, skip notification
                        // Still update the trigger timing
                        trigger_data.period_end_time = if should_store_last_end_time {
                            Some(trigger_results.end_time)
                        } else {
                            None
                        };
                        new_trigger.data = json::to_string(&trigger_data).unwrap();
                        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
                        publish_triggers_usage(trigger_data_stream);
                        return Ok(());
                    }
                    deduplicated_data
                }
                Err(e) => {
                    log::error!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Error applying deduplication for org: {}, module_key: {}: {}",
                        &new_trigger.org,
                        &new_trigger.module_key,
                        e
                    );
                    // On error, continue with original data to avoid missing alerts
                    data
                }
            }
        } else {
            log::warn!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Could not connect to ORM for deduplication, continuing without it"
            );
            data
        };

        // [ENTERPRISE] Collect alert events for batched incident creation
        // #[cfg(feature = "enterprise")]
        // if rca_enabled && !data.is_empty() {
        //     // Collect each deduplicated result row as an alert event
        //     // Use parent trace_id for cross-alert correlation (not scheduler_trace_id)
        //     for row in &data {
        //         if let Err(e) =
        // o2_enterprise::enterprise::ai::rca::integration::collect_alert_event(
        // trace_id, // Use parent trace_id for cross-alert batch             &alert,
        //             row,
        //             triggered_at,
        //         ) {
        //             log::error!(
        //                 "[SCHEDULER trace_id {scheduler_trace_id}] Error collecting alert event
        // for RCA: {}",                 e
        //             );
        //             // Don't fail alert evaluation if RCA collection fails
        //         }
        //     }
        //     log::debug!(
        //         "[SCHEDULER trace_id {scheduler_trace_id}] Collected {} alert events for RCA
        // batch {}",         data.len(),
        //         trace_id
        //     );
        // }

        // [ENTERPRISE] Correlate alert to incident for unified incident management
        #[cfg(feature = "enterprise")]
        if o2_enterprise::enterprise::common::config::get_config()
            .incidents
            .enabled
            && let Some(first_row) = data.first()
        {
            // Extract service name from result labels (used for topology enrichment)
            let service_name = first_row
                .get("service.name")
                .or_else(|| first_row.get("service_name"))
                .and_then(json::Value::as_str);

            // Extract trace_id for trace-based correlation
            let trace_id = first_row
                .get("trace_id")
                .or_else(|| first_row.get("traceId"))
                .or_else(|| first_row.get("TraceId"))
                .and_then(json::Value::as_str);

            match crate::service::alerts::incidents::correlate_alert_to_incident(
                &alert,
                first_row,
                triggered_at,
                service_name,
                trace_id,
            )
            .await
            {
                Ok(Some((incident_id, discovered_service_name))) => {
                    log::info!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Alert {}/{} correlated to incident {} (service: {})",
                        &new_trigger.org,
                        &alert.name,
                        incident_id,
                        discovered_service_name
                    );

                    // Note: Topology enrichment now happens automatically in
                    // find_or_create_incident when dimensions change or
                    // topology is missing. The enrichment is triggered
                    // during incident creation or when new dimensions are discovered.
                    // No need to spawn enrichment here anymore.
                }
                Ok(None) => {
                    log::debug!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] No incident correlation for alert {}/{}",
                        &new_trigger.org,
                        &alert.name
                    );
                }
                Err(e) => {
                    log::error!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Error correlating alert to incident: {e}"
                    );
                    // Don't fail alert processing if incident correlation fails
                }
            }
        }

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
            trigger_results.end_time,
            Some(start_time),
            use_given_time,
        );
        trigger_data_stream.start_time = alert_start_time;
        trigger_data_stream.end_time = alert_end_time;

        // Mark dedup status for history (if dedup was enabled, alert passed through)
        if alert.deduplication.as_ref().is_some_and(|d| d.enabled) {
            trigger_data_stream.dedup_enabled = Some(true);
            trigger_data_stream.dedup_suppressed = Some(false);
        }

        // No grouping - send individual notification
        match alert
            .send_notification(
                &data,
                trigger_results.end_time,
                Some(start_time),
                triggered_at,
            )
            .await
        {
            Ok((success_msg, err_msg)) => {
                let success_msg = success_msg.trim().to_owned();
                let err_msg = err_msg.trim().to_owned();
                if !err_msg.is_empty() {
                    log::error!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Some notifications for alert {}/{} could not be sent: {err_msg}",
                        &new_trigger.org,
                        &new_trigger.module_key
                    );
                    trigger_data_stream.error = Some(err_msg);
                } else {
                    log::info!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Alert notification sent, org: {}, module_key: {}",
                        &new_trigger.org,
                        &new_trigger.module_key
                    );
                }
                trigger_data_stream.success_response = Some(success_msg);
                // Notification was sent successfully, store the last used end_time in the triggers
                trigger_data.period_end_time = if should_store_last_end_time {
                    Some(trigger_results.end_time)
                } else {
                    None
                };
                new_trigger.data = json::to_string(&trigger_data).unwrap();
                // Notification is already sent to some destinations,
                // hence in case of partial errors, no need to retry
                db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
            }
            Err(e) => {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Error sending alert notification: org: {}, module_key: {}",
                    &new_trigger.org,
                    &new_trigger.module_key
                );
                if trigger.retries + 1 >= max_retries {
                    // It has been tried the maximum time, just update the
                    // next_run_at to the next expected trigger time
                    log::debug!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] This alert trigger: {}/{} has reached maximum retries",
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
                    db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
                } else {
                    let trigger_data = json::to_string(&trigger_data).unwrap();
                    // Otherwise update its status and data only
                    db::scheduler::update_status(
                        &new_trigger.org,
                        new_trigger.module,
                        &new_trigger.module_key,
                        db::scheduler::TriggerStatus::Waiting,
                        trigger.retries + 1,
                        Some(&trigger_data),
                        true,
                        &query_trace_id,
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
            "[SCHEDULER trace_id {scheduler_trace_id}] Alert conditions not satisfied, org: {}, module_key: {}",
            &new_trigger.org,
            &new_trigger.module_key
        );
        // Condition did not match, store the last used end_time in the triggers
        // In the next run, the alert will be checked from the last end_time
        trigger_data.period_end_time = if should_store_last_end_time {
            Some(trigger_results.end_time)
        } else {
            None
        };
        new_trigger.data = json::to_string(&trigger_data).unwrap();
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        trigger_data_stream.start_time = start_time;
        trigger_data_stream.end_time = trigger_results.end_time;
        trigger_data_stream.status = TriggerDataStatus::ConditionNotSatisfied;
    }

    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] publish_triggers_usage for alert: {}",
        &trigger_data_stream.key
    );
    // publish the triggers as stream
    publish_triggers_usage(trigger_data_stream);

    // [ENTERPRISE] Mark alert completed and process batch if this was the last alert
    // #[cfg(feature = "enterprise")]
    // mark_rca_completion().await;

    Ok(())
}

#[cfg(not(feature = "enterprise"))]
async fn handle_query_recommendations_triggers(
    _trace_id: &str,
    _trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn handle_query_recommendations_triggers(
    trace_id: &str,
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    use std::{
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    use config::meta::triggers::TriggerStatus;

    let cfg = get_config();
    let query_recommendation_analysis_interval = cfg.limit.query_recommendation_analysis_interval;
    let next_run_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Basic relative time")
        .as_micros() as i64
        + query_recommendation_analysis_interval * 1_000_000;

    log::info!("[QUERY_RECOMMENDATIONS] Generating Query Recommendations. trace_id={trace_id}");

    let query_recommendation_service = QueryRecommendationService {
        ctx: Arc::new(QueryOptimizerContext),
        query_recommendation_analysis_interval: cfg.limit.query_recommendation_analysis_interval,
        query_recommendation_duration: cfg.limit.query_recommendation_duration,
        query_recommendation_top_k: cfg.limit.query_recommendation_top_k,
    };

    let result = query_recommendation_service
        .run()
        .await
        .inspect_err(|e| {
            log::error!(
                "[QUERY_RECOMMENDATIONS] Recommendation service stopped with an error: Error={:?}",
                e
            );
        })
        .inspect(|_| {
            log::info!("[QUERY_RECOMMENDATIONS] Recommendation job completed successfully. trace_id={trace_id}");
        });

    // Always queue the next run, regardless of success or failure
    let new_trigger = db::scheduler::Trigger {
        status: TriggerStatus::Waiting,
        retries: 3,
        next_run_at,
        ..trigger
    };

    db::scheduler::update_trigger(new_trigger, false, trace_id)
        .await
        .inspect_err(|e| {
            log::error!(
                "[QUERY_RECOMMENDATIONS] Failed to update QueryRecommendations trigger. e={:?}",
                e
            )
        })?;

    // If there was an error during generation, log it but don't prevent the next run from being
    // queued
    if let Err(e) = result {
        log::error!(
            "[QUERY_RECOMMENDATIONS] Query Recommendations Job operation encountered an error: e={:?}",
            e
        );
        // Return Ok since the next run has been successfully queued
    }

    Ok(())
}

async fn handle_report_triggers(
    trace_id: &str,
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let query_trace_id = ider::generate_trace_id();
    let scheduler_trace_id = format!("{trace_id}/{query_trace_id}");
    let (_, max_retries) = get_scheduler_max_retries();
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Inside handle_report_trigger,org: {}, module_key: {}",
        &trigger.org,
        &trigger.module_key
    );
    let org_id = &trigger.org;
    // For report, trigger.module_key is the report name
    let report_id = &trigger.module_key;
    let now = now_micros();
    let triggered_at = trigger.start_time.unwrap_or_default();
    let processing_delay = now - trigger.next_run_at;
    let time_in_queue = now - triggered_at;

    let mut new_trigger = db::scheduler::Trigger {
        next_run_at: now,
        is_realtime: false,
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    let mut report = match db::dashboards::reports::get_by_id(conn, report_id).await {
        Ok(report) => report,
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Error getting report: org: {org_id}, report name: {report_id}, error: {e}"
            );
            // if trigger max retries is reached, update the next run at
            if trigger.retries + 1 >= max_retries {
                // next run at is after 5mins
                let next_run_at = now + Duration::minutes(5).num_microseconds().unwrap();
                new_trigger.next_run_at = next_run_at;
                db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
            } else {
                // Mark the trigger as failed
                db::scheduler::update_status(
                    &trigger.org,
                    db::scheduler::TriggerModule::Report,
                    &trigger.module_key,
                    db::scheduler::TriggerStatus::Waiting,
                    trigger.retries + 1,
                    None,
                    true,
                    &query_trace_id,
                )
                .await?;
            }
            publish_triggers_usage(TriggerData {
                _timestamp: now,
                org: trigger.org.clone(),
                module: TriggerDataType::Report,
                key: format!("/{report_id}"),
                next_run_at: now,
                is_realtime: trigger.is_realtime,
                is_silenced: trigger.is_silenced,
                status: TriggerDataStatus::Failed,
                start_time: trigger.start_time.unwrap_or_default(),
                end_time: trigger.end_time.unwrap_or_default(),
                retries: trigger.retries,
                error: None,
                success_response: None,
                is_partial: None,
                delay_in_secs: Some(Duration::microseconds(processing_delay).num_seconds()),
                evaluation_took_in_secs: None,
                source_node: Some(LOCAL_NODE.name.clone()),
                query_took: None,
                scheduler_trace_id: Some(scheduler_trace_id.clone()),
                time_in_queue_ms: Some(Duration::microseconds(time_in_queue).num_milliseconds()),
                ..Default::default()
            });
            return Err(anyhow::anyhow!(
                "Error getting report: {report_id}, error: {e}"
            ));
        }
    };
    let report_name = report.name.clone();

    #[cfg(feature = "cloud")]
    {
        if !is_org_in_free_trial_period(&trigger.org).await? {
            log::info!(
                "pausing report {}  in org {} because free trial expiry",
                report_name,
                trigger.org
            );
            report.enabled = false;
            if let Err(e) =
                crate::service::dashboards::reports::enable(&report.org_id, &report.name, false)
                    .await
            {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Failed to pause report due to trial expiry: {}/{} : {e}",
                    &trigger.org,
                    report_name
                );
            }
            return Ok(());
        }
    }

    if !report.enabled {
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Report not enabled: org: {org_id}, report name: {report_name} id: {report_id}"
        );
        // update trigger, check on next week
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        return Ok(());
    }
    let mut run_once = false;

    let mut frequency_seconds = 60;

    // Update trigger, set `next_run_at` to the
    // frequency interval of this report
    match report.frequency.frequency_type {
        ReportFrequencyType::Hours => {
            frequency_seconds = report.frequency.interval * 3600;
            new_trigger.next_run_at += Duration::try_hours(report.frequency.interval)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Days => {
            frequency_seconds = report.frequency.interval * 86400;
            new_trigger.next_run_at += Duration::try_days(report.frequency.interval)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Weeks => {
            frequency_seconds = report.frequency.interval * 604800;
            new_trigger.next_run_at += Duration::try_weeks(report.frequency.interval)
                .unwrap()
                .num_microseconds()
                .unwrap();
        }
        ReportFrequencyType::Months => {
            // Assumes each month to be of 30 days.
            frequency_seconds = report.frequency.interval * 2592000;
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

    if report.frequency.align_time && report.frequency.frequency_type != ReportFrequencyType::Cron {
        new_trigger.next_run_at = TriggerCondition::align_time(
            new_trigger.next_run_at,
            report.tz_offset,
            Some(frequency_seconds),
            if report.timezone.is_empty() {
                None
            } else {
                Some(&report.timezone)
            },
        );
    }

    let mut trigger_data_stream = TriggerData {
        _timestamp: now,
        org: trigger.org.clone(),
        module: if report.destinations.is_empty() {
            TriggerDataType::CachedReport
        } else {
            TriggerDataType::Report
        },
        key: format!("{report_name}/{report_id}"),
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
        source_node: Some(LOCAL_NODE.name.clone()),
        query_took: None,
        scheduler_trace_id: Some(scheduler_trace_id.clone()),
        time_in_queue_ms: Some(Duration::microseconds(time_in_queue).num_milliseconds()),
        ..Default::default()
    };

    if trigger.retries >= max_retries {
        // It has been tried the maximum time, just update the
        // next_run_at to the next expected trigger time
        log::info!(
            "[SCHEDULER trace_id {scheduler_trace_id}] This report trigger: {org_id}/{report_name} has passed maximum retries, skipping to next run",
            org_id = &new_trigger.org,
            report_name = report_name
        );
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        return Ok(());
    }
    match report.send_subscribers().await {
        Ok(_) => {
            log::info!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Report name: {report_name} id: {report_id} sent to destination"
            );
            // Report generation successful, update the trigger
            if run_once {
                new_trigger.status = db::scheduler::TriggerStatus::Completed;
            }
            db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
            log::debug!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Update trigger for report name: {report_name} id: {report_id}"
            );
            trigger_data_stream.end_time = now_micros();
        }
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Error sending report to subscribers: {e}"
            );
            if trigger.retries + 1 >= max_retries && !run_once {
                // It has been tried the maximum time, just update the
                // next_run_at to the next expected trigger time
                log::debug!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] This report trigger: {org_id}/{report_name} has reached maximum possible retries"
                );
                trigger_data_stream.next_run_at = new_trigger.next_run_at;
                db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
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
                    None,
                    true,
                    &query_trace_id,
                )
                .await?;
            }
            trigger_data_stream.end_time = now_micros();
            trigger_data_stream.status = TriggerDataStatus::Failed;
            trigger_data_stream.error = Some(format!("error processing report: {e}"));
        }
    }
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] publish_triggers_usage for report: {}",
        &trigger_data_stream.key
    );
    publish_triggers_usage(trigger_data_stream);

    Ok(())
}

async fn handle_derived_stream_triggers(
    trace_id: &str,
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    let query_trace_id = ider::generate_trace_id();
    let current_time = now_micros();
    let time_in_queue =
        Duration::microseconds(current_time - trigger.start_time.unwrap_or_default())
            .num_milliseconds();
    let scheduler_trace_id = format!("{trace_id}/{query_trace_id}");
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Inside handle_derived_stream_triggers processing trigger: {}",
        trigger.module_key
    );
    let (_, max_retries) = get_scheduler_max_retries();

    // module_key format: stream_type/org_id/pipeline_name/pipeline_id
    let (org_id, stream_type, pipeline_name, pipeline_id) =
        match get_pipeline_info_from_module_key(&trigger.module_key) {
            Ok(info) => info,
            Err(e) => {
                log::error!(
                    "[SCHEDULER trace_id {trace_id}] error getting pipeline module key {e}"
                );
                return Err(anyhow::anyhow!("[SCHEDULER trace_id {trace_id}] {e}"));
            }
        };

    let mut new_trigger = db::scheduler::Trigger {
        next_run_at: Utc::now().timestamp_micros(),
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        ..trigger.clone()
    };
    let mut new_trigger_data = if trigger.data.is_empty() {
        ScheduledTriggerData::default()
    } else {
        ScheduledTriggerData::from_json_string(&trigger.data).unwrap()
    };
    // Try to get pipeline from cache first, fallback to database if not found
    let pipeline = if let Some(cached_pipeline) =
        db::pipeline::get_scheduled_pipeline_from_cache(&pipeline_id).await
    {
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline {pipeline_id} found in cache"
        );
        cached_pipeline
    } else {
        // Cache miss, try to fetch from database and cache it
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline {pipeline_id} not in cache, fetching from database"
        );
        match db::pipeline::get_by_id(&pipeline_id).await {
            Ok(pipeline) => {
                // Cache the pipeline for future use
                db::pipeline::cache_scheduled_pipeline(&pipeline).await;
                log::debug!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline {pipeline_id} fetched from database and cached"
                );
                pipeline
            }
            Err(_) => {
                let err_msg = format!(
                    "Pipeline associated with trigger not found: {org_id}/{stream_type}/{pipeline_name}/{pipeline_id}. Checking after 5 mins."
                );
                // Check after 5 mins if the pipeline is created
                new_trigger.next_run_at += Duration::try_minutes(5)
                    .unwrap()
                    .num_microseconds()
                    .unwrap();
                let trigger_data_stream = TriggerData {
                    _timestamp: now_micros(),
                    org: new_trigger.org.clone(),
                    module: TriggerDataType::DerivedStream,
                    key: new_trigger.module_key.clone(),
                    next_run_at: new_trigger.next_run_at,
                    is_realtime: new_trigger.is_realtime,
                    is_silenced: new_trigger.is_silenced,
                    status: TriggerDataStatus::Failed,
                    start_time: 0,
                    end_time: 0,
                    retries: new_trigger.retries,
                    error: Some(err_msg.clone()),
                    success_response: None,
                    is_partial: None,
                    delay_in_secs: None,
                    evaluation_took_in_secs: None,
                    source_node: Some(LOCAL_NODE.name.clone()),
                    query_took: None,
                    scheduler_trace_id: Some(scheduler_trace_id.clone()),
                    time_in_queue_ms: Some(time_in_queue),
                    ..Default::default()
                };

                log::error!("[SCHEDULER trace_id {scheduler_trace_id}] {err_msg}");
                new_trigger_data.reset();
                new_trigger.data = new_trigger_data.to_json_string();
                db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
                publish_triggers_usage(trigger_data_stream);
                return Err(anyhow::anyhow!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] {}",
                    err_msg
                ));
            }
        }
    };

    #[cfg(feature = "cloud")]
    {
        if !is_org_in_free_trial_period(&trigger.org).await? {
            log::info!(
                "[Scheduler trace_id {scheduler_trace_id}] pausing pipeline {} id {} in org {} because free trial expiry",
                pipeline.name,
                pipeline_id,
                trigger.org
            );

            if let Err(e) =
                crate::service::pipeline::enable_pipeline(&pipeline.org, &pipeline.id, false, false)
                    .await
            {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Failed to pause pipeline due to trial expiry: {}/{} : {e}",
                    &trigger.org,
                    pipeline.name
                );
            }
            return Ok(());
        }
    }

    if !pipeline.enabled {
        // Pipeline not enabled, check again in 5 mins
        let msg = format!(
            "Pipeline associated with trigger not enabled: {org_id}/{stream_type}/{pipeline_name}/{pipeline_id}. Checking after 5 mins."
        );
        new_trigger.next_run_at += Duration::try_minutes(5)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let trigger_data_stream = TriggerData {
            _timestamp: now_micros(),
            org: new_trigger.org.clone(),
            module: TriggerDataType::DerivedStream,
            key: new_trigger.module_key.clone(),
            next_run_at: new_trigger.next_run_at,
            is_realtime: new_trigger.is_realtime,
            is_silenced: new_trigger.is_silenced,
            status: TriggerDataStatus::Failed,
            start_time: 0,
            end_time: 0,
            retries: new_trigger.retries,
            error: Some(msg.clone()),
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: Some(LOCAL_NODE.name.clone()),
            query_took: None,
            scheduler_trace_id: Some(scheduler_trace_id.clone()),
            time_in_queue_ms: Some(time_in_queue),
            ..Default::default()
        };
        log::info!("[SCHEDULER trace_id {scheduler_trace_id}] {msg}");
        new_trigger_data.reset();
        new_trigger.data = new_trigger_data.to_json_string();
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        publish_triggers_usage(trigger_data_stream);
        return Ok(());
    }

    let Some(derived_stream) = pipeline.get_derived_stream() else {
        let err_msg = format!(
            "DerivedStream associated with the trigger not found in pipeline: {org_id}/{pipeline_name}/{pipeline_id}. Checking after 5 mins."
        );
        new_trigger.next_run_at += Duration::try_minutes(5)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let trigger_data_stream = TriggerData {
            _timestamp: Utc::now().timestamp_micros(),
            org: new_trigger.org.clone(),
            module: TriggerDataType::DerivedStream,
            key: new_trigger.module_key.clone(),
            next_run_at: new_trigger.next_run_at,
            is_realtime: new_trigger.is_realtime,
            is_silenced: new_trigger.is_silenced,
            status: TriggerDataStatus::Failed,
            start_time: 0,
            end_time: 0,
            retries: new_trigger.retries,
            error: Some(err_msg.clone()),
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: Some(LOCAL_NODE.name.clone()),
            query_took: None,
            scheduler_trace_id: Some(scheduler_trace_id.clone()),
            time_in_queue_ms: Some(time_in_queue),
            ..Default::default()
        };
        log::error!("[SCHEDULER trace_id {scheduler_trace_id}] {err_msg}");
        new_trigger_data.reset();
        new_trigger.data = new_trigger_data.to_json_string();
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        publish_triggers_usage(trigger_data_stream);
        return Err(anyhow::anyhow!(
            "[SCHEDULER trace_id {scheduler_trace_id}] {}",
            err_msg
        ));
    };
    let start_time = new_trigger_data
        .period_end_time
        .map(|period_end_time| period_end_time + 1);

    // in case the range [start_time, end_time] is greater than querying period, it needs to
    // evaluate and ingest 1 period at a time.
    let user_defined_delay = derived_stream
        .delay
        .and_then(|delay_in_mins| {
            chrono::Duration::try_minutes(delay_in_mins as _).and_then(|td| td.num_microseconds())
        })
        .unwrap_or_default();
    let supposed_to_be_run_at = trigger.next_run_at - user_defined_delay;
    let is_cron_frequency = derived_stream
        .trigger_condition
        .frequency_type
        .eq(&config::meta::alerts::FrequencyType::Cron);
    let period_num_microseconds = Duration::try_minutes(derived_stream.trigger_condition.period)
        .unwrap()
        .num_microseconds()
        .unwrap();
    let aligned_supposed_to_be_run_at = if !is_cron_frequency {
        TriggerCondition::align_time(
            supposed_to_be_run_at,
            derived_stream.tz_offset,
            Some(derived_stream.trigger_condition.period * 60),
            derived_stream.trigger_condition.timezone.as_deref(), /* Derived streams don't have
                                                                   * timezone string yet */
        )
    } else {
        // For cron frequency, we don't need to align the end time as it is already aligned (the
        // cron crate takes care of it)
        TriggerCondition::align_time(
            supposed_to_be_run_at,
            derived_stream.tz_offset,
            None,
            derived_stream.trigger_condition.timezone.as_deref(),
        )
    };

    let (mut start, mut end) = if derived_stream.start_at.is_some() && trigger.data.is_empty() {
        (derived_stream.start_at, supposed_to_be_run_at)
    } else if let Some(t0) = start_time {
        // If the delay is equal to or greater than the frequency, we need to ingest data one by
        // one If the delay is less than the frequency, we need to ingest data for
        // the "next run at" period, For example, if the current time is 5:19pm,
        // frequency is 5 mins, and delay is 4mins (supposed to be run at 5:15pm),
        // we need to ingest data for the period from 5:10pm to 5:15pm only. The
        // next run at will be 5:20pm which will query for the period from 5:15pm to
        // 5:20pm. But, if the suppossed to be run at is 5:10pm, then we need ingest
        // data for the period from 5:05pm to 5:15pm. Which is to cover the skipped
        // period from 5:05pm to 5:15pm.
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] module key: {}, supposed_to_be_run_at: {}, t0 + supposed_to_be_run_at: {}, supposed_to_be_run_smaller: {}",
            new_trigger.module_key,
            chrono::DateTime::from_timestamp_micros(supposed_to_be_run_at)
                .unwrap()
                .time(),
            chrono::DateTime::from_timestamp_micros(t0 + period_num_microseconds)
                .unwrap()
                .time(),
            supposed_to_be_run_at < t0 + period_num_microseconds,
        );
        (
            Some(t0),
            if is_cron_frequency {
                // For cron frequency, don't believe the period, the period can be dynamic for cron.
                // For example, if cron expression evaluates to "run every weekend 12am", the period
                // is dynamic here.
                std::cmp::min(
                    supposed_to_be_run_at,
                    derived_stream.trigger_condition.get_next_trigger_time(
                        false,
                        derived_stream.tz_offset,
                        false,
                        Some(t0),
                    )?,
                )
            } else {
                std::cmp::min(supposed_to_be_run_at, t0 + period_num_microseconds)
            },
        )
    } else {
        (None, supposed_to_be_run_at)
    };
    // For derived stream, period is in minutes, so we need to convert it to seconds for align_time
    let aligned_end_time = if !is_cron_frequency {
        // For non-cron frequency, we need to align the current time so that the end_time is
        // divisible by the period For example, if the current time is 5:19pm, period is 5
        // mins, and delay is 4mins (supposed to be run at 5:15pm), we need to ingest data
        // for the period from 5:10pm to 5:15pm only. The next run at will be 5:24pm which
        // will query for the period from 5:15pm to 5:20pm. But, if the suppossed to be run
        // at is 5:10pm, then we need ingest data for the period from 5:05pm to 5:15pm.
        // Which is to cover the skipped period from 5:05pm to 5:15pm.
        TriggerCondition::align_time(
            end,
            derived_stream.tz_offset,
            Some(derived_stream.trigger_condition.period * 60),
            derived_stream.trigger_condition.timezone.as_deref(), /* Derived streams don't have
                                                                   * timezone string yet */
        )
    } else {
        // For cron frequency, we don't need to align the end time as it is already aligned (the
        // cron crate takes care of it)
        TriggerCondition::align_time(
            end,
            derived_stream.tz_offset,
            None,
            derived_stream.trigger_condition.timezone.as_deref(),
        )
    };

    let mut trigger_data_stream = TriggerData {
        _timestamp: now_micros(),
        org: new_trigger.org.clone(),
        module: TriggerDataType::DerivedStream,
        key: new_trigger.module_key.to_lowercase(),
        next_run_at: new_trigger.next_run_at,
        is_realtime: new_trigger.is_realtime,
        is_silenced: new_trigger.is_silenced,
        status: TriggerDataStatus::Completed,
        start_time: if let Some(start) = start {
            start
        } else {
            end - period_num_microseconds
        },
        end_time: end,
        retries: new_trigger.retries,
        error: None,
        success_response: None,
        is_partial: None,
        delay_in_secs: None,
        evaluation_took_in_secs: None,
        source_node: Some(LOCAL_NODE.name.clone()),
        query_took: None,
        scheduler_trace_id: Some(scheduler_trace_id.clone()),
        time_in_queue_ms: Some(time_in_queue),
        ..Default::default()
    };

    // conditionally modify supposed_to_be_run_at
    if start.is_none_or(|t0| t0 < aligned_end_time) {
        end = aligned_end_time;
    } else {
        // either t0 = aligned_end_time or t0 > aligned_end_time
        // in both cases, we need to skip to next run because, we should always use
        // aligned_curr_time as the end time
        // Invalid timerange, most probably due to non-zero delay
        // Don't do any further processing, just skip to next run
        let start_time = start.unwrap();
        log::warn!(
            "[SCHEDULER trace_id {scheduler_trace_id}] module key: {}, Invalid timerange. Skipping to next run. start: {}, end: {}",
            new_trigger.module_key,
            start_time,
            end,
        );
        new_trigger.next_run_at = derived_stream.trigger_condition.get_next_trigger_time(
            false,
            derived_stream.tz_offset,
            false,
            Some(trigger.next_run_at),
        )?;
        trigger_data_stream.status = TriggerDataStatus::Skipped;
        trigger_data_stream.end_time = aligned_end_time;
        trigger_data_stream.next_run_at = new_trigger.next_run_at;
        trigger_data_stream.start_time = start_time;
        trigger_data_stream.error = Some(format!(
            "Invalid timerange - start: {start_time}, end: {end}, should be fixed in the next run"
        ));
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        publish_triggers_usage(trigger_data_stream);
        return Ok(());
    }

    // In case the scheduler background job (watch_timeout) updates the trigger retries
    // (not through this handler), we need to skip to the next run at but with the same
    // trigger start time. If we don't handle here, in that case, the `clean_complete`
    // background job will clear this job as it has reached max retries.
    if trigger.retries >= max_retries {
        log::info!(
            "[SCHEDULER trace_id {scheduler_trace_id}] DerivedStream trigger: {}/{} has reached maximum possible retries. Skipping to next run",
            new_trigger.org,
            new_trigger.module_key
        );
        // Go to the next nun at, but use the same trigger start time
        new_trigger.next_run_at = derived_stream.trigger_condition.get_next_trigger_time(
            false,
            derived_stream.tz_offset,
            false,
            Some(trigger.next_run_at),
        )?;
        // Start over next time
        new_trigger.retries = 0;
        db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await?;
        return Ok(());
    }

    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] DerivedStream: {} querying for time range: start_time {}, end_time {}.",
        new_trigger.module_key,
        start.unwrap_or_default(),
        end,
    );

    // end can change due to delay feature, so we need to update the start and end time
    if start.is_none() {
        trigger_data_stream.start_time = end - period_num_microseconds;
    }
    trigger_data_stream.end_time = end;

    // evaluate trigger and configure trigger next run time
    match derived_stream
        .evaluate(
            (start, end),
            &trigger.module_key,
            Some(query_trace_id.clone()),
        )
        .await
    {
        Err(e) => {
            let err_msg = format!(
                "Source node DerivedStream QueryCondition error during query evaluation, caused by {e}"
            );
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] pipeline org/name({}/{}): source node DerivedStream failed at QueryCondition evaluation with error: {}",
                pipeline.org,
                pipeline.name,
                e
            );

            // update TriggerData that's to be reported to _meta
            trigger_data_stream.status = TriggerDataStatus::Failed;
            trigger_data_stream.error = Some(err_msg.clone());
            trigger_data_stream.retries += 1;

            // report pipeline error
            let pipeline_error = PipelineError {
                pipeline_id: pipeline.id.to_string(),
                pipeline_name: pipeline.name.to_string(),
                error: Some(err_msg),
                node_errors: HashMap::new(),
            };
            crate::service::self_reporting::publish_error(ErrorData {
                _timestamp: Utc::now().timestamp_micros(),
                stream_params: pipeline.get_source_stream_params(),
                error_source: ErrorSource::Pipeline(pipeline_error),
            })
            .await;

            // incr trigger retry count
            new_trigger.retries += 1;
        }
        Ok(trigger_results) => {
            let is_satisfied = trigger_results
                .data
                .as_ref()
                .is_some_and(|ret| !ret.is_empty());

            // ingest evaluation result into destination
            if is_satisfied {
                log::info!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] DerivedStream(org: {}/module_key: {}): query conditions satisfied. Result to be processed and ingested",
                    new_trigger.org,
                    new_trigger.module_key
                );

                let local_val = trigger_results.data // checked is some
                        .unwrap()
                        .into_iter()
                        .map(json::Value::Object)
                        .collect::<Vec<_>>();

                // pass search results to pipeline to get modified results before ingesting
                let mut json_data_by_stream: HashMap<StreamParams, Vec<json::Value>> =
                    HashMap::new();
                let mut ingestion_error_msg = None;

                match ExecutablePipeline::new(&pipeline).await {
                    Err(e) => {
                        let err_msg = format!(
                            "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline org/name({org_id}/{pipeline_name}) failed to initialize to ExecutablePipeline. Caused by: {e}"
                        );
                        log::error!("{err_msg}");
                        ingestion_error_msg = Some(err_msg);
                    }
                    Ok(exec_pl) => match exec_pl.process_batch(&org_id, local_val, None).await {
                        Err(e) => {
                            let err_msg = format!(
                                "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline org/name({org_id}/{pipeline_name}) failed to process DerivedStream query results. Caused by: {e}"
                            );
                            log::error!("{err_msg}");
                            ingestion_error_msg = Some(err_msg);
                        }
                        Ok(pl_results) => {
                            for (stream_params, stream_pl_results) in pl_results {
                                if matches!(
                                    stream_params.stream_type,
                                    StreamType::Logs
                                        | StreamType::EnrichmentTables
                                        | StreamType::Metrics
                                        | StreamType::Traces
                                ) {
                                    let (_, results): (Vec<_>, Vec<_>) =
                                        stream_pl_results.into_iter().unzip();
                                    json_data_by_stream
                                        .entry(stream_params.clone())
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
                        // need to get the metadata from the destination node with the same
                        // stream_params since this is a scheduled
                        // pipeline, only the destination node can be of stream node.
                        let mut request_metadata = pipeline
                            .get_metadata_by_stream_params(&dest_stream)
                            .map(|meta| {
                                let mut meta = meta;
                                meta.insert("is_derived".to_string(), "true".to_string());
                                cluster_rpc::IngestRequestMetadata { data: meta }
                            });
                        if request_metadata.is_none() {
                            let mut metadata = HashMap::new();
                            metadata.insert("is_derived".to_string(), "true".to_string());
                            request_metadata =
                                Some(cluster_rpc::IngestRequestMetadata { data: metadata });
                        }
                        let (org_id, stream_name, stream_type): (String, String, String) = {
                            (
                                dest_stream.org_id.into(),
                                dest_stream.stream_name.into(),
                                dest_stream.stream_type.to_string(),
                            )
                        };
                        let records_len = records.len();

                        let req = cluster_rpc::IngestionRequest {
                            org_id: org_id.clone(),
                            stream_name: stream_name.clone(),
                            stream_type: stream_type.clone(),
                            data: Some(cluster_rpc::IngestionData::from(records)),
                            ingestion_type: Some(cluster_rpc::IngestionType::Json.into()),
                            metadata: request_metadata,
                        };
                        match ingestion_service::ingest(req).await {
                            Ok(resp) if resp.status_code == 200 => {
                                log::info!(
                                    "[SCHEDULER trace_id {scheduler_trace_id}] DerivedStream result ingested to destination {org_id}/{stream_name}/{stream_type}, records: {records_len}"
                                );
                            }
                            error => {
                                let err = error.map_or_else(|e| e.to_string(), |resp| resp.message);
                                log::error!(
                                    "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline org/name({}/{}) failed to ingest processed results to destination {}/{}/{}, caused by {}",
                                    pipeline.org,
                                    pipeline.name,
                                    org_id,
                                    stream_name,
                                    stream_type,
                                    err
                                );
                                ingestion_error_msg = Some(err);
                                break;
                            }
                        };
                    }
                }

                if let Some(err) = ingestion_error_msg {
                    // FAIL: update new_trigger, trigger_data_stream, and
                    new_trigger.retries += 1;

                    // trigger_data_stream
                    trigger_data_stream.status = TriggerDataStatus::Failed;
                    trigger_data_stream.error = Some(err.clone());
                    trigger_data_stream.retries += 1;

                    // report pipeline error
                    let pipeline_error = PipelineError {
                        pipeline_id: pipeline.id.to_string(),
                        pipeline_name: pipeline.name.to_string(),
                        error: Some(err),
                        node_errors: HashMap::new(),
                    };
                    crate::service::self_reporting::publish_error(ErrorData {
                        _timestamp: Utc::now().timestamp_micros(),
                        stream_params: pipeline.get_source_stream_params(),
                        error_source: ErrorSource::Pipeline(pipeline_error),
                    })
                    .await;

                    // do not move time window forward
                } else {
                    // SUCCESS: move the time range forward by frequency and continue
                    start = Some(trigger_results.end_time);
                    trigger_data_stream.query_took = trigger_results.query_took;
                }
            } else {
                log::info!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] DerivedStream condition does not match any data for the period, org: {}, module_key: {}",
                    &new_trigger.org,
                    &new_trigger.module_key
                );
                trigger_data_stream.status = TriggerDataStatus::ConditionNotSatisfied;
                trigger_data_stream.query_took = trigger_results.query_took;

                // move the time range forward by frequency and continue
                start = Some(trigger_results.end_time);
            }
        }
    };

    // configure next run time before exiting the loop
    // Store the last used derived stream period end time
    if let Some(start_time) = start {
        new_trigger.data = json::to_string(&ScheduledTriggerData {
            // updated start_time as end_time
            period_end_time: Some(start_time),
            tolerance: 0,
            last_satisfied_at: None,
            backfill_job: None,
        })
        .unwrap();
    }

    // If the trigger has failed and is not at the max retries, no need to update the next
    // run at In that case, the trigger will be picked up again by the scheduler
    // at the next batch immediately Once it reaches max retries, the trigger
    // will be run again at the next scheduled time.
    if !(trigger_data_stream.status == TriggerDataStatus::Failed
        && new_trigger.retries < max_retries)
    {
        let need_to_catch_up = end < aligned_supposed_to_be_run_at;
        // If the trigger didn't fail, we need to reset the `retries` count.
        // Only cumulative failures should be used to check with `max_retries`
        if trigger_data_stream.status != TriggerDataStatus::Failed {
            new_trigger.retries = 0;
        }

        if trigger_data_stream.status != TriggerDataStatus::Failed && need_to_catch_up {
            // Go to the next nun at, but use the same trigger start time
            new_trigger.next_run_at = derived_stream.trigger_condition.get_next_trigger_time(
                false,
                derived_stream.tz_offset,
                false,
                Some(end),
            )?;
        } else {
            // Go to the next nun at, but use the same trigger start time
            new_trigger.next_run_at = derived_stream
                .trigger_condition
                .get_next_trigger_time_non_aligned(
                    false,
                    derived_stream.tz_offset,
                    false,
                    Some(trigger.next_run_at),
                )?;
        }
    }
    trigger_data_stream.next_run_at = new_trigger.next_run_at;

    // publish the triggers as stream
    publish_triggers_usage(trigger_data_stream);

    // If it reaches max retries, go to the next nun at, but use the same trigger start time
    if new_trigger.retries >= max_retries {
        // Report a final pipeline error
        log::warn!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline({}/{})]: DerivedStream trigger has reached maximum retries.",
            &pipeline.org,
            &pipeline.name
        );
        let err_msg = format!(
            "[SCHEDULER trace_id {scheduler_trace_id}] DerivedStream has reached max retries of {max_retries}. Pipeline will be retried after the next scheduled run. Please fix reported errors in pipeline."
        );
        let pipeline_error = PipelineError {
            pipeline_id: pipeline.id.to_string(),
            pipeline_name: pipeline.name.to_string(),
            error: Some(err_msg),
            node_errors: HashMap::new(),
        };
        crate::service::self_reporting::publish_error(ErrorData {
            _timestamp: Utc::now().timestamp_micros(),
            stream_params: pipeline.get_source_stream_params(),
            error_source: ErrorSource::Pipeline(pipeline_error),
        })
        .await;
        new_trigger.retries = 0; // start over
    }

    if let Err(e) = db::scheduler::update_trigger(new_trigger, true, &query_trace_id).await {
        log::warn!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Pipeline({}/{})]: DerivedStream's new trigger failed to be updated, caused by {}",
            &pipeline.org,
            &pipeline.name,
            e
        );
    }

    Ok(())
}

pub fn get_pipeline_info_from_module_key(
    module_key: &str,
) -> Result<(String, StreamType, String, String), anyhow::Error> {
    let columns = module_key.split('/').collect::<Vec<_>>();
    if columns.len() < 4 {
        return Err(anyhow::anyhow!(
            "Invalid module_key format: {}.",
            module_key
        ));
    }
    let stream_type: StreamType = columns[0].into();
    let org_id = columns[1];
    let pipeline_name = columns[2];
    // Handles the case where the pipeline name contains a `/`
    let pipeline_id = columns[columns.len() - 1];
    Ok((
        org_id.to_string(),
        stream_type,
        pipeline_name.to_string(),
        pipeline_id.to_string(),
    ))
}

async fn handle_backfill_triggers(
    trace_id: &str,
    trigger: db::scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    use config::meta::{
        pipeline::components::PipelineSource,
        triggers::{DeletionStatus, ScheduledTriggerData},
    };

    let (_, max_retries) = get_scheduler_max_retries();
    let job_id = trigger.module_key.clone();
    log::debug!(
        "[SCHEDULER trace_id {trace_id}] Processing backfill trigger: {}",
        &job_id
    );

    let now = Utc::now().timestamp_micros();
    let _source_node = LOCAL_NODE.name.clone();

    // 1. Fetch static config from backfill_jobs table
    let config = match infra::table::backfill_jobs::get(&trigger.org, &job_id).await {
        Ok(config) => config,
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {trace_id}] [job_id: {}] Failed to fetch backfill job config: {e}",
                &job_id
            );
            // Delete the trigger if config is not found
            let _ = db::scheduler::delete(
                &trigger.org,
                db::scheduler::TriggerModule::Backfill,
                &job_id,
            )
            .await;
            return Err(anyhow::anyhow!(
                "Failed to fetch backfill job config: {}",
                e
            ));
        }
    };

    // 2. Parse backfill job dynamic state from trigger.data
    let trigger_data = match ScheduledTriggerData::from_json_string(&trigger.data) {
        Ok(data) => data,
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {trace_id}] [job_id: {}] Failed to parse backfill trigger data: {e}",
                &job_id
            );
            return Err(anyhow::anyhow!("Failed to parse trigger data: {}", e));
        }
    };

    let mut backfill_job = match trigger_data.backfill_job {
        Some(job) => job,
        None => {
            log::error!(
                "[SCHEDULER trace_id {trace_id}] [job_id: {}] Missing backfill job data in trigger",
                &job_id
            );
            return Err(anyhow::anyhow!("Missing backfill job data"));
        }
    };

    // 3. Fetch the source pipeline configuration
    let pipeline = match crate::service::db::pipeline::get_by_id(&config.pipeline_id).await {
        Ok(pipeline) => pipeline,
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {trace_id}] [job_id: {}] Failed to fetch pipeline {}: {e}",
                &job_id,
                config.pipeline_id
            );
            if trigger.retries + 1 >= max_retries {
                // Delete the trigger after max retries
                let _ = db::scheduler::delete(
                    &trigger.org,
                    db::scheduler::TriggerModule::Backfill,
                    &job_id,
                )
                .await;
            } else {
                let _ = db::scheduler::update_status(
                    &trigger.org,
                    db::scheduler::TriggerModule::Backfill,
                    &job_id,
                    db::scheduler::TriggerStatus::Waiting,
                    trigger.retries + 1,
                    None,
                    true,
                    trace_id,
                )
                .await;
            }
            return Err(anyhow::anyhow!("Failed to fetch pipeline: {}", e));
        }
    };

    // 4. Extract DerivedStream configuration
    let derived_stream = match &pipeline.source {
        PipelineSource::Scheduled(ds) => ds,
        _ => {
            log::error!(
                "[SCHEDULER trace_id {trace_id}] [job_id: {}] Pipeline {} is not scheduled",
                &job_id,
                config.pipeline_id
            );
            // Delete the trigger as this is a configuration error
            let _ = db::scheduler::delete(
                &trigger.org,
                db::scheduler::TriggerModule::Backfill,
                &job_id,
            )
            .await;
            return Err(anyhow::anyhow!("Pipeline is not scheduled"));
        }
    };

    // Get destination streams from pipeline nodes
    let destination_streams = match get_destination_stream_from_pipeline(&pipeline) {
        Ok(streams) => streams,
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {trace_id}] [job_id: {}] Failed to get destination streams: {e}",
                &job_id
            );
            let _ = db::scheduler::delete(
                &trigger.org,
                db::scheduler::TriggerModule::Backfill,
                &job_id,
            )
            .await;
            return Err(e);
        }
    };

    // 5. Handle deletion phase if required
    if config.delete_before_backfill {
        match &backfill_job.deletion_status {
            DeletionStatus::NotRequired => {
                // Not required, proceed to backfill
            }
            DeletionStatus::Pending => {
                // Initiate deletion for all destination streams
                log::info!(
                    "[BACKFILL trace_id {trace_id}] [job_id: {}] Starting deletion for {} destination stream(s), time range {}-{}",
                    &job_id,
                    destination_streams.len(),
                    config.start_time,
                    config.end_time
                );

                // Initiate deletion for all streams
                let mut deletion_job_ids = Vec::new();
                let mut failed = false;
                let mut error_msg = String::new();

                for (idx, stream) in destination_streams.iter().enumerate() {
                    log::debug!(
                        "[BACKFILL trace_id {trace_id}] [job_id: {}] Initiating deletion for stream {}/{} ({}/{})",
                        &job_id,
                        stream.stream_type,
                        stream.stream_name,
                        idx + 1,
                        destination_streams.len()
                    );

                    match initiate_stream_deletion(
                        &trigger.org,
                        stream,
                        config.start_time,
                        config.end_time,
                    )
                    .await
                    {
                        Ok(deletion_job_id) => {
                            deletion_job_ids.push(deletion_job_id.clone());
                            log::debug!(
                                "[BACKFILL trace_id {trace_id}] [job_id: {}] Deletion job {} created for stream {}/{}",
                                &job_id,
                                deletion_job_id,
                                stream.stream_type,
                                stream.stream_name
                            );
                        }
                        Err(e) => {
                            error_msg = format!(
                                "Failed to initiate deletion for stream {}/{}: {}",
                                stream.stream_type, stream.stream_name, e
                            );
                            log::error!(
                                "[BACKFILL trace_id {trace_id}] [job_id: {}] {}",
                                &job_id,
                                error_msg
                            );
                            failed = true;
                            break;
                        }
                    }
                }

                if failed {
                    backfill_job.error = Some(error_msg.clone());
                    let updated_trigger_data = ScheduledTriggerData {
                        backfill_job: Some(backfill_job),
                        ..trigger_data
                    };
                    db::scheduler::update_trigger(
                        db::scheduler::Trigger {
                            status: db::scheduler::TriggerStatus::Completed,
                            data: updated_trigger_data.to_json_string(),
                            ..trigger
                        },
                        true,
                        trace_id,
                    )
                    .await?;
                    return Err(anyhow::anyhow!("{}", error_msg));
                }

                // All deletions initiated successfully
                backfill_job.deletion_status = DeletionStatus::InProgress;
                backfill_job.deletion_job_ids = deletion_job_ids.clone();
                backfill_job.error = None; // Clear any previous errors

                let updated_trigger_data = ScheduledTriggerData {
                    backfill_job: Some(backfill_job.clone()),
                    ..trigger_data
                };

                // Use delay_between_chunks_secs for checking deletion status
                let delay = config.delay_between_chunks_secs.unwrap_or(30);
                let next_run_at = now + (delay * 1_000_000);

                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        next_run_at,
                        status: db::scheduler::TriggerStatus::Waiting,
                        data: updated_trigger_data.to_json_string(),
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;

                log::info!(
                    "[BACKFILL trace_id {trace_id}] [job_id: {}] {} deletion job(s) initiated, will check status in {}s",
                    &job_id,
                    deletion_job_ids.len(),
                    delay
                );
                return Ok(());
            }
            DeletionStatus::InProgress => {
                // Check if all deletion jobs are complete
                if !backfill_job.deletion_job_ids.is_empty() {
                    let mut all_completed = true;
                    let mut completed_count = 0;

                    for deletion_job_id in &backfill_job.deletion_job_ids {
                        match check_deletion_status(deletion_job_id).await {
                            Ok(status) if status == "completed" => {
                                completed_count += 1;
                            }
                            Ok(status) => {
                                log::debug!(
                                    "[BACKFILL trace_id {trace_id}] [job_id: {}] Deletion job {} status: {}",
                                    &job_id,
                                    deletion_job_id,
                                    status
                                );
                                all_completed = false;
                            }
                            Err(e) => {
                                log::warn!(
                                    "[BACKFILL trace_id {trace_id}] [job_id: {}] Failed to check deletion job {} status: {}",
                                    &job_id,
                                    deletion_job_id,
                                    e
                                );
                                all_completed = false;
                            }
                        }
                    }

                    if all_completed {
                        log::info!(
                            "[BACKFILL trace_id {trace_id}] [job_id: {}] All {} deletion job(s) completed, starting backfill",
                            &job_id,
                            backfill_job.deletion_job_ids.len()
                        );
                        backfill_job.deletion_status = DeletionStatus::Completed;
                        backfill_job.error = None; // Clear any previous errors
                    // Continue to backfill phase below
                    } else {
                        // Still in progress, reschedule to check again
                        // Use delay_between_chunks_secs for checking deletion status
                        let delay = config.delay_between_chunks_secs.unwrap_or(30);
                        let next_run_at = now + (delay * 1_000_000);

                        db::scheduler::update_trigger(
                            db::scheduler::Trigger {
                                next_run_at,
                                status: db::scheduler::TriggerStatus::Waiting,
                                ..trigger
                            },
                            true,
                            trace_id,
                        )
                        .await?;

                        log::debug!(
                            "[BACKFILL trace_id {trace_id}] [job_id: {}] Deletion in progress ({}/{} completed), checking again in {}s",
                            &job_id,
                            completed_count,
                            backfill_job.deletion_job_ids.len(),
                            delay
                        );
                        return Ok(());
                    }
                }
            }
            DeletionStatus::Completed => {
                // Deletion already complete, proceed to backfill
            }
        }
    }

    // 6. Calculate current chunk to process
    let chunk_period = config
        .chunk_period_minutes
        .unwrap_or(derived_stream.trigger_condition.period);
    let chunk_end = std::cmp::min(
        backfill_job.current_position + (chunk_period * 60 * 1_000_000),
        config.end_time,
    );

    log::debug!(
        "[BACKFILL trace_id {trace_id}] [job_id: {}] Processing chunk: {}-{}",
        &job_id,
        backfill_job.current_position,
        chunk_end
    );

    // 7. Execute the pipeline for this chunk
    let results = match derived_stream
        .evaluate(
            (Some(backfill_job.current_position), chunk_end),
            &job_id,
            Some(trace_id.to_string()),
        )
        .await
    {
        Ok(results) => results,
        Err(e) => {
            log::error!(
                "[BACKFILL trace_id {trace_id}] [job_id: {}] Failed to evaluate pipeline: {e}",
                &job_id
            );

            // Increment retries
            let new_retries = trigger.retries + 1;

            if new_retries >= max_retries {
                // Max retries reached, report error and reset retries for next scheduled run
                log::warn!(
                    "[BACKFILL trace_id {trace_id}] [job_id: {}] Backfill job for pipeline {} has reached maximum retries.",
                    &job_id,
                    config.pipeline_id
                );

                // Calculate next run time with delay
                let delay = config.delay_between_chunks_secs.unwrap_or(0);
                let next_run_at = now + (delay * 1_000_000);

                // Update trigger with reset retries and scheduled next run
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        retries: 0, // Reset retries for next attempt
                        next_run_at,
                        status: db::scheduler::TriggerStatus::Waiting,
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;
            } else {
                // Increment retries but don't update next_run_at - let scheduler pick it up
                // immediately
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        retries: new_retries,
                        status: db::scheduler::TriggerStatus::Waiting,
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;
            }
            return Err(anyhow::anyhow!("Failed to evaluate pipeline: {}", e));
        }
    };

    // 8. Process results through pipeline
    let executable_pipeline = match ExecutablePipeline::new(&pipeline).await {
        Ok(ep) => ep,
        Err(e) => {
            log::error!(
                "[BACKFILL trace_id {trace_id}] [job_id: {}] Failed to create executable pipeline: {e}",
                &job_id
            );

            // Increment retries
            let new_retries = trigger.retries + 1;

            if new_retries >= max_retries {
                // Max retries reached, report error and reset retries for next scheduled run
                log::warn!(
                    "[BACKFILL trace_id {trace_id}] [job_id: {}] Backfill job for pipeline {} has reached maximum retries on pipeline creation.",
                    &job_id,
                    config.pipeline_id
                );

                // Calculate next run time with delay
                let delay = config.delay_between_chunks_secs.unwrap_or(0);
                let next_run_at = now + (delay * 1_000_000);

                // Update trigger with reset retries and scheduled next run
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        retries: 0, // Reset retries for next attempt
                        next_run_at,
                        status: db::scheduler::TriggerStatus::Waiting,
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;
            } else {
                // Increment retries but don't update next_run_at - let scheduler pick it up
                // immediately
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        retries: new_retries,
                        status: db::scheduler::TriggerStatus::Waiting,
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;
            }
            return Err(anyhow::anyhow!(
                "Failed to create executable pipeline: {}",
                e
            ));
        }
    };

    if let Some(data) = results.data {
        let records: Vec<json::Value> = data.into_iter().map(json::Value::Object).collect();
        if let Err(e) = executable_pipeline
            .process_batch(&trigger.org, records, None)
            .await
        {
            log::error!(
                "[BACKFILL trace_id {trace_id}] [job_id: {}] Failed to process batch: {e}",
                &job_id
            );

            // Increment retries
            let new_retries = trigger.retries + 1;

            if new_retries >= max_retries {
                // Max retries reached, report error and reset retries for next scheduled run
                log::warn!(
                    "[BACKFILL trace_id {trace_id}] [job_id: {}] Backfill job for pipeline {} has reached maximum retries on batch processing.",
                    &job_id,
                    config.pipeline_id
                );

                // Calculate next run time with delay
                let delay = config.delay_between_chunks_secs.unwrap_or(0);
                let next_run_at = now + (delay * 1_000_000);

                // Update trigger with reset retries and scheduled next run
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        retries: 0, // Reset retries for next attempt
                        next_run_at,
                        status: db::scheduler::TriggerStatus::Waiting,
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;
            } else {
                // Increment retries but don't update next_run_at - let scheduler pick it up
                // immediately
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        retries: new_retries,
                        status: db::scheduler::TriggerStatus::Waiting,
                        ..trigger
                    },
                    true,
                    trace_id,
                )
                .await?;
            }
            return Err(anyhow::anyhow!("Failed to process batch: {}", e));
        }
    }

    // 9. Update progress or complete
    if chunk_end >= config.end_time {
        // Backfill complete - set current_position to end_time and mark trigger as completed
        backfill_job.current_position = config.end_time;
        backfill_job.error = None; // Clear any previous errors on successful completion

        let updated_trigger_data = ScheduledTriggerData {
            backfill_job: Some(backfill_job.clone()),
            ..trigger_data
        };

        log::info!(
            "[BACKFILL trace_id {trace_id}] [job_id: {}] Backfill job completed for pipeline {}",
            &job_id,
            config.pipeline_id
        );
        db::scheduler::update_trigger(
            db::scheduler::Trigger {
                status: db::scheduler::TriggerStatus::Completed,
                data: serde_json::to_string(&updated_trigger_data)?,
                ..trigger
            },
            true,
            trace_id,
        )
        .await?;
    } else {
        // Update progress and schedule next chunk
        backfill_job.current_position = chunk_end;
        backfill_job.error = None; // Clear any previous errors on successful chunk processing

        let delay = config.delay_between_chunks_secs.unwrap_or(0);
        let next_run_at = now + (delay * 1_000_000);

        let updated_trigger_data = ScheduledTriggerData {
            backfill_job: Some(backfill_job.clone()),
            ..trigger_data
        };

        db::scheduler::update_trigger(
            db::scheduler::Trigger {
                next_run_at,
                status: db::scheduler::TriggerStatus::Waiting,
                data: updated_trigger_data.to_json_string(),
                retries: 0, // Reset retries on successful chunk
                ..trigger
            },
            true,
            trace_id,
        )
        .await?;

        let progress = ((chunk_end - config.start_time) as f64
            / (config.end_time - config.start_time) as f64
            * 100.0) as u8;
        log::debug!(
            "[BACKFILL trace_id {trace_id}] [job_id: {}] Progress: {}%, next chunk in {}s",
            &job_id,
            progress,
            delay
        );
    }

    Ok(())
}

/// Helper function to get destination streams from pipeline
fn get_destination_stream_from_pipeline(
    pipeline: &config::meta::pipeline::Pipeline,
) -> Result<Vec<StreamParams>, anyhow::Error> {
    let mut destination_streams = Vec::new();

    for node in &pipeline.nodes {
        if let NodeData::Stream(stream_params) = &node.data {
            // Destination stream node (not the query source node)
            let node_id = node.get_node_id();
            if !matches!(node_id.as_str(), "source" | "query") {
                destination_streams.push(stream_params.clone());
            }
        }
    }

    if destination_streams.is_empty() {
        Err(anyhow::anyhow!("No destination streams found in pipeline"))
    } else {
        Ok(destination_streams)
    }
}

/// Helper function to initiate stream deletion
async fn initiate_stream_deletion(
    org_id: &str,
    stream: &StreamParams,
    start_time: i64,
    end_time: i64,
) -> Result<String, anyhow::Error> {
    use chrono::TimeZone;
    use config::meta::stream::StreamType;

    // Convert microseconds to formatted time range strings
    let time_range_start = {
        let ts = Utc
            .timestamp_micros(start_time)
            .single()
            .ok_or_else(|| anyhow::anyhow!("Invalid start_time"))?;
        if stream.stream_type == StreamType::Logs {
            ts.format("%Y-%m-%dT%H:00:00Z").to_string()
        } else {
            ts.format("%Y-%m-%d").to_string()
        }
    };
    let time_range_end = {
        let ts = Utc
            .timestamp_micros(end_time)
            .single()
            .ok_or_else(|| anyhow::anyhow!("Invalid end_time"))?;
        if stream.stream_type == StreamType::Logs {
            ts.format("%Y-%m-%dT%H:00:00Z").to_string()
        } else {
            ts.format("%Y-%m-%d").to_string()
        }
    };

    // Create deletion job using existing retention service
    let (key, _created) = crate::service::db::compact::retention::delete_stream(
        org_id,
        stream.stream_type,
        &stream.stream_name,
        Some((time_range_start.as_str(), time_range_end.as_str())),
    )
    .await?;

    // Create a job in the compact manual jobs table
    let job = infra::table::compactor_manual_jobs::CompactorManualJob {
        id: config::ider::uuid(),
        key: key.clone(),
        status: infra::table::compactor_manual_jobs::Status::Pending,
        created_at: Utc::now().timestamp_micros(),
        ended_at: 0,
    };

    let job_id = crate::service::db::compact::compactor_manual_jobs::add_job(job).await?;
    Ok(job_id)
}

/// Helper function to check deletion job status
/// We need to only check this local region status. This is because the ingestion will happen only
/// in this region, so we can start backfilling as soon as the deletion in this region is complete.
async fn check_deletion_status(job_id: &str) -> Result<String, anyhow::Error> {
    let job = crate::service::db::compact::compactor_manual_jobs::get_job(job_id).await?;
    let status_str = match job.status {
        infra::table::compactor_manual_jobs::Status::Pending => "pending",
        infra::table::compactor_manual_jobs::Status::Running => "running",
        infra::table::compactor_manual_jobs::Status::Completed => "completed",
    };
    Ok(status_str.to_string())
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;

    #[test]
    fn test_get_pipeline_info_from_module_key_valid_input() {
        // Test with valid module key format
        let module_key = "logs/org123/pipeline_name/pipeline_id_456";
        let result = get_pipeline_info_from_module_key(module_key);

        assert!(result.is_ok());
        let (org_id, stream_type, pipeline_name, pipeline_id) = result.unwrap();
        assert_eq!(org_id, "org123");
        assert_eq!(stream_type, StreamType::Logs);
        assert_eq!(pipeline_name, "pipeline_name");
        assert_eq!(pipeline_id, "pipeline_id_456");
    }

    #[test]
    fn test_get_pipeline_info_from_module_key_different_stream_types() {
        // Test different stream types
        let test_cases = vec![
            ("logs/org1/pipeline1/id1", StreamType::Logs),
            ("metrics/org2/pipeline2/id2", StreamType::Metrics),
            ("traces/org3/pipeline3/id3", StreamType::Traces),
            (
                "enrichment_tables/org4/pipeline4/id4",
                StreamType::EnrichmentTables,
            ),
        ];

        for (module_key, expected_stream_type) in test_cases {
            let result = get_pipeline_info_from_module_key(module_key);
            assert!(result.is_ok());
            let (_, stream_type, ..) = result.unwrap();
            assert_eq!(stream_type, expected_stream_type);
        }
    }

    #[test]
    fn test_get_pipeline_info_from_module_key_invalid_inputs() {
        // Test with insufficient parts
        let invalid_cases = vec![
            "logs/org123",          // Only 2 parts
            "logs/org123/pipeline", // Only 3 parts
            "logs",                 // Only 1 part
            "",                     // Empty string
            "single_part",          // Single part
        ];

        for invalid_module_key in invalid_cases {
            let result = get_pipeline_info_from_module_key(invalid_module_key);
            assert!(result.is_err());
            let error_msg = result.unwrap_err().to_string();
            assert!(error_msg.contains("Invalid module_key format"));
            assert!(error_msg.contains(invalid_module_key));
        }
    }

    #[test]
    fn test_get_pipeline_info_from_module_key_edge_cases() {
        // Test with empty parts
        let module_key = "logs//pipeline_name/pipeline_id";
        let result = get_pipeline_info_from_module_key(module_key);

        assert!(result.is_ok());
        let (org_id, _, pipeline_name, pipeline_id) = result.unwrap();
        assert_eq!(org_id, "");
        assert_eq!(pipeline_name, "pipeline_name");
        assert_eq!(pipeline_id, "pipeline_id");

        // Test with very long names
        let long_name = "a".repeat(1000);
        let module_key = format!("logs/org123/{long_name}/pipeline_id");
        let result = get_pipeline_info_from_module_key(&module_key);

        assert!(result.is_ok());
        let (_, _, pipeline_name, _) = result.unwrap();
        assert_eq!(pipeline_name, long_name);
    }

    #[test]
    fn test_get_skipped_timestamps_with_cron() {
        // Test with cron expression
        let supposed_to_run_at = 1640995200000000; // 2022-01-01 00:00:00 UTC in microseconds
        let cron = "0 */5 * * * *"; // Every 5 minutes
        let tz_offset = 0; // UTC
        let frequency = 300; // 5 minutes in seconds
        let delay = 600000000; // 10 minutes in microseconds
        let align_time = false;
        let now = 1640995800000000; // 2022-01-01 00:10:00 UTC

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // Should have skipped timestamps for 5:00, 5:05, 5:10
        assert!(!skipped_timestamps.is_empty());
        assert!(skipped_timestamps.len() >= 2);

        // Final timestamp should be the current time when align_time is false
        assert_eq!(final_timestamp, now);
    }

    #[test]
    fn test_get_skipped_timestamps_with_frequency() {
        // Test with frequency-based scheduling (no cron)
        let supposed_to_run_at = 1640995200000000; // 2022-01-01 00:00:00 UTC
        let cron = ""; // Empty cron means frequency-based
        let tz_offset = 0; // UTC
        let frequency = 300; // 5 minutes in seconds
        let delay = 600000000; // 10 minutes in microseconds
        let align_time = false;
        let now = 1640995800000000; // 2022-01-01 00:10:00 UTC

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // Should have skipped timestamps for 5:00, 5:05, 5:10
        assert!(!skipped_timestamps.is_empty());
        assert!(skipped_timestamps.len() >= 2);

        // Final timestamp should be the current time when align_time is false
        assert_eq!(final_timestamp, now);
    }

    #[test]
    fn test_get_skipped_timestamps_with_align_time() {
        // Test with align_time = true
        let supposed_to_run_at = 1640995200000000; // 2022-01-01 00:00:00 UTC
        let cron = "";
        let tz_offset = 0;
        let frequency = 300; // 5 minutes
        let delay = 300000000; // 5 minutes in microseconds
        let align_time = true;
        let now = 1640995500000000; // 2022-01-01 00:05:00 UTC

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // When align_time is true and there are skipped timestamps,
        // final_timestamp should be the supposed_to_run_at or adjusted value
        if !skipped_timestamps.is_empty() {
            // Should be aligned to the frequency
            assert!(final_timestamp >= supposed_to_run_at);
        }
    }

    #[test]
    fn test_get_skipped_timestamps_with_timezone() {
        // Test with timezone offset (UTC+5:30 for India)
        let supposed_to_run_at = 1640995200000000; // 2022-01-01 00:00:00 UTC
        let cron = "0 */5 * * * *"; // Every 5 minutes
        let tz_offset = 330; // UTC+5:30 in minutes
        let frequency = 300;
        let delay = 600000000;
        let align_time = false;
        let now = 1640995800000000;

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // Should still work with timezone offset
        assert!(skipped_timestamps.len() >= 2);
        assert_eq!(final_timestamp, now);
    }

    #[test]
    fn test_get_skipped_timestamps_no_delay() {
        // Test with no delay (delay = 0)
        let supposed_to_run_at = 1640995200000000;
        let cron = "";
        let tz_offset = 0;
        let frequency = 300;
        let delay = 0; // No delay
        let align_time = false;
        let now = 1640995200000000; // Same as supposed_to_run_at

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // Should have no skipped timestamps when delay is 0
        assert!(skipped_timestamps.is_empty());
        assert_eq!(final_timestamp, now);
    }

    #[test]
    fn test_get_skipped_timestamps_large_delay() {
        // Test with large delay
        let supposed_to_run_at = 1640995200000000;
        let cron = "";
        let tz_offset = 0;
        let frequency = 60; // 1 minute
        let delay = 3600000000; // 1 hour in microseconds
        let align_time = false;
        let now = 1640998800000000; // 1 hour later

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // Should have many skipped timestamps (60 minutes worth)
        assert!(skipped_timestamps.len() >= 50);
        assert_eq!(final_timestamp, now);
    }

    #[test]
    fn test_get_skipped_timestamps_invalid_cron() {
        // Test with invalid cron expression - should panic
        let supposed_to_run_at = 1640995200000000;
        let cron = "invalid cron";
        let tz_offset = 0;
        let frequency = 300;
        let delay = 600000000;
        let align_time = false;
        let now = 1640995800000000;

        // This should panic due to invalid cron expression
        let result = std::panic::catch_unwind(|| {
            get_skipped_timestamps(
                supposed_to_run_at,
                cron,
                tz_offset,
                frequency,
                delay,
                align_time,
                now,
                None,
            )
        });

        assert!(result.is_err());
    }

    #[test]
    fn test_get_skipped_timestamps_edge_case_empty_skipped_timestamps() {
        // Test case where skipped_timestamps is empty and align_time is true
        let supposed_to_run_at = 1640995200000000;
        let cron = "";
        let tz_offset = 0;
        let frequency = 300;
        let delay = 0; // No delay, so no skipped timestamps
        let align_time = true;
        let now = 1640995200000000;

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        assert!(skipped_timestamps.is_empty());
        assert_eq!(final_timestamp, supposed_to_run_at);
    }

    #[test]
    fn test_get_skipped_timestamps_pop_last_timestamp() {
        // Test case where the last timestamp is greater than supposed_to_run_at
        let supposed_to_run_at = 1640995200000000;
        let cron = "";
        let tz_offset = 0;
        let frequency = 60; // 1 minute
        let delay = 120000000; // 2 minutes
        let align_time = true;
        let now = 1640995320000000; // 2 minutes later

        let (skipped_timestamps, final_timestamp) = get_skipped_timestamps(
            supposed_to_run_at,
            cron,
            tz_offset,
            frequency,
            delay,
            align_time,
            now,
            None,
        );

        // Should have some skipped timestamps
        assert!(!skipped_timestamps.is_empty());

        // The final timestamp should be adjusted based on the logic
        assert!(final_timestamp >= supposed_to_run_at);
    }
}
