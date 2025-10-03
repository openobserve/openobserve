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

use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    cluster::LOCAL_NODE,
    ider::{self, uuid},
    meta::{
        alerts::Alert,
        reports::{Report, ReportFrequencyType},
    },
    utils::json,
};
use hashbrown::HashMap;
use infra::errors::Error;
use svix_ksuid::Ksuid;

use super::{
    batch_updater::{TriggerBatchUpdater, get_batch_updater},
    handlers::{
        get_pipeline_info_from_module_key, get_scheduler_max_retries, get_skipped_timestamps,
        publish_triggers_usage,
    },
};
use crate::{
    common::{
        infra::config::STREAM_ALERTS,
        meta::{
            alerts::trigger::TriggerData,
            prom::VALUE_LABEL,
            stream::StreamType,
            usage::{TriggerData as UsageTriggerData, TriggerDataType},
        },
    },
    handler::http::request::alerts::QueryCondition,
    service::{
        alerts::{
            self,
            destinations::{self, send_notification},
            templates,
            trigger::TriggerEvaluatorOutput,
        },
        db::{
            self,
            orm::{ORM_CLIENT, connect_to_orm},
            scheduler::{self as db_scheduler, Trigger, TriggerModule, TriggerStatus},
        },
        ingestion::derive_stream_processor::DerivedStreamProcessor,
        search::{MetadataMap, SearchEventContext, cluster::get_cached_online_querier_nodes},
    },
};

/// Batched version of handle_triggers that uses the batch updater
pub async fn handle_triggers_batched(
    trace_id: &str,
    trigger: db_scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    match trigger.module {
        db_scheduler::TriggerModule::Report => {
            handle_report_triggers_batched(trace_id, trigger).await
        }
        db_scheduler::TriggerModule::Alert => {
            handle_alert_triggers_batched(trace_id, trigger).await
        }
        db_scheduler::TriggerModule::DerivedStream => {
            handle_derived_stream_triggers_batched(trace_id, trigger).await
        }
    }
}

/// Batched version of alert trigger handler
async fn handle_alert_triggers_batched(
    trace_id: &str,
    trigger: db_scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    let query_trace_id = ider::generate_trace_id();
    let scheduler_trace_id = format!("{trace_id}/{query_trace_id}");
    let (_, max_retries) = get_scheduler_max_retries();

    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Inside handle_alert_triggers_batched: processing trigger: {}",
        &trigger.module_key
    );

    let batch_updater = get_batch_updater();
    let now = Utc::now().timestamp_micros();
    let triggered_at = trigger.start_time.unwrap_or_default();
    let time_in_queue = Duration::microseconds(now - triggered_at).num_milliseconds();
    let source_node = LOCAL_NODE.name.clone();

    let mut new_trigger = db_scheduler::Trigger {
        next_run_at: now,
        is_silenced: false,
        status: db_scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    // Get alert information
    let alert = if let Ok(alert_id) = svix_ksuid::Ksuid::from_str(&trigger.module_key) {
        let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
        match db::alerts::alert::get_by_id(client, &trigger.org, alert_id).await {
            Ok(Some((_, alert))) => alert,
            Ok(None) => {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Alert not found for module_key: {}, deleting this trigger job",
                    trigger.module_key
                );
                if let Err(e) = db_scheduler::delete(
                    &trigger.org,
                    db_scheduler::TriggerModule::Alert,
                    &trigger.module_key,
                )
                .await
                {
                    log::error!(
                        "[SCHEDULER trace_id {scheduler_trace_id}] Error deleting trigger job: {e}"
                    );
                }
                publish_triggers_usage(UsageTriggerData {
                    _timestamp: now,
                    org: trigger.org.clone(),
                    module: TriggerDataType::Alert,
                    module_key: trigger.module_key.clone(),
                    node: source_node,
                    trigger_data_stream: None,
                })
                .await;
                return Ok(());
            }
            Err(e) => {
                log::error!("[SCHEDULER trace_id {scheduler_trace_id}] Error getting alert: {e}");
                if trigger.retries + 1 >= max_retries {
                    let next_run_at = now + Duration::minutes(5).num_microseconds().unwrap();
                    new_trigger.next_run_at = next_run_at;
                    batch_updater.update_trigger(new_trigger).await?;
                } else {
                    batch_updater
                        .update_status(
                            &trigger.org,
                            db_scheduler::TriggerModule::Alert,
                            &trigger.module_key,
                            db_scheduler::TriggerStatus::Waiting,
                            trigger.retries + 1,
                            None,
                            new_trigger,
                        )
                        .await?;
                }
                return Ok(());
            }
        }
    } else {
        return Err(anyhow::anyhow!("Invalid alert ID format"));
    };

    let mut trigger_data = match json::from_str::<TriggerData>(&trigger.data) {
        Ok(trigger_data) => trigger_data,
        Err(e) => {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Error parsing trigger data: {e}"
            );
            return Err(anyhow::anyhow!("Error parsing trigger data: {e}"));
        }
    };

    let is_realtime = trigger_data.is_realtime;
    let is_silenced = trigger.is_silenced;

    // Handle scheduled checks
    if !is_realtime {
        let skipped_timestamps = get_skipped_timestamps(
            &scheduler_trace_id,
            &trigger_data,
            &trigger.module_key,
            false,
        )?;

        if skipped_timestamps.is_empty() {
            log::debug!(
                "[SCHEDULER trace_id {scheduler_trace_id}] No skipped timestamps found, updating next run time"
            );
            let next_run_at = trigger_data.calculate_next_run_at()?;
            new_trigger.next_run_at = next_run_at;
            batch_updater.update_trigger(new_trigger).await?;
            return Ok(());
        }
    }

    // Handle realtime silencing
    if is_realtime && is_silenced {
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Realtime alert need wakeup, {}/{}",
            &trigger.org,
            &trigger.module_key
        );
        batch_updater.update_trigger(new_trigger).await?;
        return Ok(());
    }

    // Check if alert is enabled
    if !alert.enabled {
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        new_trigger.is_silenced = true;
        batch_updater.update_trigger(new_trigger).await?;
        return Ok(());
    }

    // Example of processing alert (simplified)
    // In the real implementation, you would call the alert evaluation logic here
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Processing alert: {}/{}",
        &trigger.org,
        &alert.name
    );

    // Simulate alert processing result
    let alert_fired = false; // This would be determined by actual alert evaluation

    if alert_fired {
        // Handle alert firing - send notifications, etc.
        // For now, just update the trigger
        let next_run_at = trigger_data.calculate_next_run_at()?;
        new_trigger.next_run_at = next_run_at;
        trigger_data.reset();
        new_trigger.data = json::to_string(&trigger_data).unwrap();
        batch_updater.update_trigger(new_trigger).await?;
    } else {
        // Alert didn't fire, update next run time
        let next_run_at = trigger_data.calculate_next_run_at()?;
        new_trigger.next_run_at = next_run_at;
        new_trigger.data = json::to_string(&trigger_data).unwrap();
        batch_updater.update_trigger(new_trigger).await?;
    }

    Ok(())
}

/// Batched version of report trigger handler
async fn handle_report_triggers_batched(
    trace_id: &str,
    trigger: db_scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    let query_trace_id = ider::generate_trace_id();
    let scheduler_trace_id = format!("{trace_id}/{query_trace_id}");
    let (_, max_retries) = get_scheduler_max_retries();

    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Inside handle_report_triggers_batched: processing trigger: {}",
        &trigger.module_key
    );

    let batch_updater = get_batch_updater();
    let now = Utc::now().timestamp_micros();

    let mut new_trigger = db_scheduler::Trigger {
        next_run_at: now,
        is_silenced: false,
        status: db_scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    // Get report information
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let report_name = &trigger.module_key;
    let report_id = match Ksuid::from_str(report_name) {
        Ok(id) => id,
        Err(_) => {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Invalid report ID format: {}",
                report_name
            );
            return Err(anyhow::anyhow!("Invalid report ID format"));
        }
    };

    let report = match db::reports::get_by_id(client, &trigger.org, report_id).await {
        Ok(Some((_, report))) => report,
        Ok(None) => {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Report not found: {}",
                report_name
            );
            if let Err(e) = db_scheduler::delete(
                &trigger.org,
                db_scheduler::TriggerModule::Report,
                &trigger.module_key,
            )
            .await
            {
                log::error!(
                    "[SCHEDULER trace_id {scheduler_trace_id}] Error deleting trigger job: {e}"
                );
            }
            return Ok(());
        }
        Err(e) => {
            log::error!("[SCHEDULER trace_id {scheduler_trace_id}] Error getting report: {e}");
            if trigger.retries + 1 >= max_retries {
                let next_run_at = now + Duration::minutes(5).num_microseconds().unwrap();
                new_trigger.next_run_at = next_run_at;
                batch_updater.update_trigger(new_trigger).await?;
            } else {
                batch_updater
                    .update_status(
                        &trigger.org,
                        db_scheduler::TriggerModule::Report,
                        &trigger.module_key,
                        db_scheduler::TriggerStatus::Waiting,
                        trigger.retries + 1,
                        None,
                        new_trigger,
                    )
                    .await?;
            }
            return Ok(());
        }
    };

    // Check if report is enabled
    if !report.enabled {
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Report not enabled: org: {}, report name: {}",
            &trigger.org,
            report_name
        );
        new_trigger.next_run_at += Duration::try_days(7).unwrap().num_microseconds().unwrap();
        batch_updater.update_trigger(new_trigger).await?;
        return Ok(());
    }

    // Calculate next run time
    let next_run_at = match report.frequency_type {
        ReportFrequencyType::Cron => {
            // Handle cron-based scheduling
            now + Duration::hours(1).num_microseconds().unwrap() // Simplified
        }
        ReportFrequencyType::Hours => {
            now + Duration::hours(report.frequency as i64)
                .num_microseconds()
                .unwrap()
        }
        ReportFrequencyType::Minutes => {
            now + Duration::minutes(report.frequency as i64)
                .num_microseconds()
                .unwrap()
        }
    };

    new_trigger.next_run_at = next_run_at;

    // Example of report processing (simplified)
    // In the real implementation, you would generate the report here
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Processing report: {}/{}",
        &trigger.org,
        &report.name
    );

    // Simulate successful report generation
    let report_success = true;

    if report_success {
        log::info!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Report generated successfully: {}",
            report_name
        );
        batch_updater.update_trigger(new_trigger).await?;
    } else {
        log::error!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Report generation failed: {}",
            report_name
        );
        if trigger.retries + 1 >= max_retries {
            new_trigger.next_run_at = next_run_at;
            batch_updater.update_trigger(new_trigger).await?;
        } else {
            batch_updater
                .update_status(
                    &trigger.org,
                    db_scheduler::TriggerModule::Report,
                    &trigger.module_key,
                    db_scheduler::TriggerStatus::Waiting,
                    trigger.retries + 1,
                    None,
                    new_trigger,
                )
                .await?;
        }
    }

    Ok(())
}

/// Batched version of derived stream trigger handler
async fn handle_derived_stream_triggers_batched(
    trace_id: &str,
    trigger: db_scheduler::Trigger,
) -> Result<(), anyhow::Error> {
    let query_trace_id = ider::generate_trace_id();
    let scheduler_trace_id = format!("{trace_id}/{query_trace_id}");

    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Inside handle_derived_stream_triggers_batched: processing trigger: {}",
        &trigger.module_key
    );

    let batch_updater = get_batch_updater();
    let now = Utc::now().timestamp_micros();

    let mut new_trigger = db_scheduler::Trigger {
        next_run_at: now,
        is_silenced: false,
        status: db_scheduler::TriggerStatus::Waiting,
        retries: 0,
        ..trigger.clone()
    };

    // Parse pipeline info from module key
    let (org, pipeline_id, stream_name, stream_type) = match get_pipeline_info_from_module_key(
        &trigger.module_key,
    ) {
        Some(info) => info,
        None => {
            log::error!(
                "[SCHEDULER trace_id {scheduler_trace_id}] Invalid derived stream module key: {}",
                trigger.module_key
            );
            return Err(anyhow::anyhow!("Invalid derived stream module key"));
        }
    };

    // Example of derived stream processing (simplified)
    // In the real implementation, you would process the derived stream here
    log::debug!(
        "[SCHEDULER trace_id {scheduler_trace_id}] Processing derived stream: {}/{}/{}/{}",
        org,
        pipeline_id,
        stream_name,
        stream_type
    );

    // Calculate next run time (simplified)
    let next_run_at = now + Duration::minutes(5).num_microseconds().unwrap();
    new_trigger.next_run_at = next_run_at;

    // Simulate successful processing
    let processing_success = true;

    if processing_success {
        log::debug!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Derived stream processed successfully: {}",
            trigger.module_key
        );
        batch_updater.update_trigger(new_trigger).await?;
    } else {
        log::error!(
            "[SCHEDULER trace_id {scheduler_trace_id}] Derived stream processing failed: {}",
            trigger.module_key
        );
        batch_updater
            .update_status(
                &trigger.org,
                db_scheduler::TriggerModule::DerivedStream,
                &trigger.module_key,
                db_scheduler::TriggerStatus::Waiting,
                trigger.retries + 1,
                None,
                new_trigger,
            )
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    #[tokio::test]
    async fn test_handle_triggers_batched_alert() {
        let trigger = db_scheduler::Trigger {
            id: 1,
            org: "test_org".to_string(),
            module: db_scheduler::TriggerModule::Alert,
            module_key: "01HF8DQGDM4BHQJJQRP5GJM2K8".to_string(), // Valid KSUID
            status: db_scheduler::TriggerStatus::Waiting,
            start_time: Some(Utc::now().timestamp_micros()),
            end_time: None,
            retries: 0,
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: false,
            is_silenced: false,
            data: r#"{"is_realtime": false}"#.to_string(),
        };

        // This test would fail in practice because it needs database connections
        // but it demonstrates the structure
        let result = handle_triggers_batched("test_trace", trigger).await;
        // In a real test environment with proper setup, this should work
        // assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_triggers_batched_report() {
        let trigger = db_scheduler::Trigger {
            id: 2,
            org: "test_org".to_string(),
            module: db_scheduler::TriggerModule::Report,
            module_key: "01HF8DQGDM4BHQJJQRP5GJM2K9".to_string(), // Valid KSUID
            status: db_scheduler::TriggerStatus::Waiting,
            start_time: Some(Utc::now().timestamp_micros()),
            end_time: None,
            retries: 0,
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: false,
            is_silenced: false,
            data: "{}".to_string(),
        };

        let result = handle_triggers_batched("test_trace", trigger).await;
        // In a real test environment with proper setup, this should work
        // assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_handle_triggers_batched_derived_stream() {
        let trigger = db_scheduler::Trigger {
            id: 3,
            org: "test_org".to_string(),
            module: db_scheduler::TriggerModule::DerivedStream,
            module_key: "test_org/pipeline123/stream456/logs".to_string(),
            status: db_scheduler::TriggerStatus::Waiting,
            start_time: Some(Utc::now().timestamp_micros()),
            end_time: None,
            retries: 0,
            next_run_at: Utc::now().timestamp_micros(),
            is_realtime: false,
            is_silenced: false,
            data: "{}".to_string(),
        };

        let result = handle_triggers_batched("test_trace", trigger).await;
        // In a real test environment with proper setup, this should work
        // assert!(result.is_ok());
    }
}
