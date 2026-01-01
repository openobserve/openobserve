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

use chrono::Utc;
use config::meta::triggers::{BackfillJob, DeletionStatus, ScheduledTriggerData, TriggerModule};
use serde::{Deserialize, Serialize};
use svix_ksuid::{Ksuid, KsuidLike};
use utoipa::ToSchema;

use crate::service::db;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BackfillJobStatus {
    pub job_id: String,
    pub pipeline_id: String,
    pub pipeline_name: Option<String>,
    pub start_time: i64,
    pub end_time: i64,
    pub current_position: i64,
    pub progress_percent: u8,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_status: Option<DeletionStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletion_job_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_triggered_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunks_completed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunks_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_period_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_between_chunks_secs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_before_backfill: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Helper function to extract destination streams from pipeline
fn get_destination_streams(
    pipeline: &config::meta::pipeline::Pipeline,
) -> Result<Vec<config::meta::stream::StreamParams>, anyhow::Error> {
    let mut destination_streams = Vec::new();

    for node in &pipeline.nodes {
        if let config::meta::pipeline::components::NodeData::Stream(stream_params) = &node.data {
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

/// Validate that timestamps are aligned to hour boundaries (for logs streams)
/// Hours must be at :00:00.000000 (zero minutes, seconds, microseconds)
fn validate_time_alignment_hourly(start_time: i64, end_time: i64) -> Result<(), anyhow::Error> {
    use chrono::{TimeZone, Timelike};

    let start_dt = Utc
        .timestamp_micros(start_time)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid start_time"))?;
    let end_dt = Utc
        .timestamp_micros(end_time)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid end_time"))?;

    // Check if aligned to hour boundary (minute, second, and microsecond must be 0)
    if start_dt.minute() != 0 || start_dt.second() != 0 || start_dt.nanosecond() != 0 {
        return Err(anyhow::anyhow!(
            "For logs streams with delete_before_backfill enabled, start_time must be aligned to hour boundary (e.g., 2024-01-15T10:00:00Z). Got: {}",
            start_dt.format("%Y-%m-%dT%H:%M:%S%.6fZ")
        ));
    }

    if end_dt.minute() != 0 || end_dt.second() != 0 || end_dt.nanosecond() != 0 {
        return Err(anyhow::anyhow!(
            "For logs streams with delete_before_backfill enabled, end_time must be aligned to hour boundary (e.g., 2024-01-15T14:00:00Z). Got: {}",
            end_dt.format("%Y-%m-%dT%H:%M:%S%.6fZ")
        ));
    }

    Ok(())
}

/// Validate that timestamps are aligned to day boundaries (for metrics/traces streams)
/// Days must be at 00:00:00.000000 (midnight)
fn validate_time_alignment_daily(start_time: i64, end_time: i64) -> Result<(), anyhow::Error> {
    use chrono::{TimeZone, Timelike};

    let start_dt = Utc
        .timestamp_micros(start_time)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid start_time"))?;
    let end_dt = Utc
        .timestamp_micros(end_time)
        .single()
        .ok_or_else(|| anyhow::anyhow!("Invalid end_time"))?;

    // Check if aligned to day boundary (hour, minute, second, and microsecond must be 0)
    if start_dt.hour() != 0
        || start_dt.minute() != 0
        || start_dt.second() != 0
        || start_dt.nanosecond() != 0
    {
        return Err(anyhow::anyhow!(
            "For metrics/traces streams with delete_before_backfill enabled, start_time must be aligned to day boundary (e.g., 2024-01-15T00:00:00Z). Got: {}",
            start_dt.format("%Y-%m-%dT%H:%M:%S%.6fZ")
        ));
    }

    if end_dt.hour() != 0
        || end_dt.minute() != 0
        || end_dt.second() != 0
        || end_dt.nanosecond() != 0
    {
        return Err(anyhow::anyhow!(
            "For metrics/traces streams with delete_before_backfill enabled, end_time must be aligned to day boundary (e.g., 2024-01-16T00:00:00Z). Got: {}",
            end_dt.format("%Y-%m-%dT%H:%M:%S%.6fZ")
        ));
    }

    Ok(())
}

pub async fn create_backfill_job(
    org_id: &str,
    pipeline_id: &str,
    start_time: i64,
    end_time: i64,
    chunk_period_minutes: Option<i64>,
    delay_between_chunks_secs: Option<i64>,
    delete_before_backfill: bool,
) -> Result<String, anyhow::Error> {
    // 1. Validate pipeline exists and is scheduled
    let pipeline = crate::service::db::pipeline::get_by_id(pipeline_id).await?;

    if !pipeline.source.is_scheduled() {
        return Err(anyhow::anyhow!("Pipeline is not a scheduled pipeline"));
    }

    // 1a. Validate deletion is not enabled for pipelines with remote destinations
    if delete_before_backfill {
        let has_remote_destination = pipeline.nodes.iter().any(|node| {
            matches!(
                &node.data,
                config::meta::pipeline::components::NodeData::RemoteStream(_)
            )
        });

        if has_remote_destination {
            return Err(anyhow::anyhow!(
                "Deletion is not supported for pipelines with remote destinations"
            ));
        }
    }

    // 2. Validate time range
    if start_time >= end_time {
        return Err(anyhow::anyhow!("start_time must be before end_time"));
    }

    let now = Utc::now().timestamp_micros();
    if end_time > now {
        return Err(anyhow::anyhow!("end_time cannot be in the future"));
    }

    // 2a. Validate time alignment if deletion is enabled
    if delete_before_backfill {
        // Get destination streams to check their types
        let destination_streams = get_destination_streams(&pipeline)?;

        // Check if any destination is a logs stream (requires hourly alignment)
        // or metrics/traces stream (requires daily alignment)
        let requires_hourly_alignment = destination_streams
            .iter()
            .any(|s| s.stream_type == config::meta::stream::StreamType::Logs);
        let requires_daily_alignment = destination_streams.iter().any(|s| {
            matches!(
                s.stream_type,
                config::meta::stream::StreamType::Metrics
                    | config::meta::stream::StreamType::Traces
            )
        });

        // Validate time alignment based on stream types
        if requires_hourly_alignment {
            validate_time_alignment_hourly(start_time, end_time)?;
        }
        if requires_daily_alignment {
            validate_time_alignment_daily(start_time, end_time)?;
        }
    }

    // 3. Create backfill job in backfill_jobs table
    let backfill_job_id = Ksuid::new(None, None).to_string();
    let module_key = backfill_job_id.clone();

    let deletion_status = if delete_before_backfill {
        DeletionStatus::Pending
    } else {
        DeletionStatus::NotRequired
    };

    // Store static configuration in backfill_jobs table
    let backfill_job_config = infra::table::backfill_jobs::BackfillJob {
        id: backfill_job_id.clone(),
        org: org_id.to_string(),
        pipeline_id: pipeline_id.to_string(),
        start_time,
        end_time,
        chunk_period_minutes,
        delay_between_chunks_secs,
        delete_before_backfill,
        created_at: now,
    };

    infra::table::backfill_jobs::add(backfill_job_config).await?;

    // Store only dynamic state in scheduled_jobs trigger data
    let backfill_job = BackfillJob {
        current_position: start_time,
        deletion_status,
        deletion_job_ids: Vec::new(),
        error: None,
    };

    let trigger_data = ScheduledTriggerData {
        backfill_job: Some(backfill_job),
        ..Default::default()
    };

    // 4. Create trigger
    let trigger = db::scheduler::Trigger {
        org: org_id.to_string(),
        module: TriggerModule::Backfill,
        module_key,
        next_run_at: now, // Start immediately
        is_realtime: false,
        is_silenced: false,
        status: db::scheduler::TriggerStatus::Waiting,
        data: trigger_data.to_json_string(),
        ..Default::default()
    };

    db::scheduler::push(trigger).await?;

    log::info!(
        "[BACKFILL] Created backfill job {} for pipeline {} in org {}, time range: {}-{}{}",
        backfill_job_id,
        pipeline_id,
        org_id,
        start_time,
        end_time,
        if delete_before_backfill {
            " (with deletion)"
        } else {
            ""
        }
    );

    Ok(backfill_job_id)
}

/// Helper function to create BackfillJobStatus from config and trigger data
/// Static config is passed as parameter, dynamic state comes from BackfillJob
async fn create_backfill_job_status(
    config: &infra::table::backfill_jobs::BackfillJob,
    trigger_status: db::scheduler::TriggerStatus,
    trigger_start_time: Option<i64>,
    backfill_job: &BackfillJob,
    created_at: Option<i64>,
) -> Result<BackfillJobStatus, anyhow::Error> {
    // Get pipeline name
    let pipeline_name = match crate::service::db::pipeline::get_by_id(&config.pipeline_id).await {
        Ok(pipeline) => Some(pipeline.name),
        Err(_) => None,
    };

    // Calculate progress
    let progress_percent = {
        let total_duration = config.end_time - config.start_time;
        if total_duration == 0 {
            100
        } else {
            let completed_duration = backfill_job.current_position - config.start_time;
            (completed_duration as f64 / total_duration as f64 * 100.0) as u8
        }
    };

    // Calculate chunks
    let chunk_period = config.chunk_period_minutes.unwrap_or(60);
    let total_duration_minutes = (config.end_time - config.start_time) / (60 * 1_000_000);
    let chunks_total = (total_duration_minutes as f64 / chunk_period as f64).ceil() as u64;
    let completed_duration_minutes =
        (backfill_job.current_position - config.start_time) / (60 * 1_000_000);
    let chunks_completed = (completed_duration_minutes as f64 / chunk_period as f64).floor() as u64;

    // Determine actual status: if trigger is Completed but job hasn't reached end_time,
    // it's paused
    let actual_status = if trigger_status == db::scheduler::TriggerStatus::Completed
        && backfill_job.current_position < config.end_time
    {
        "paused".to_string()
    } else {
        format!("{:?}", trigger_status).to_lowercase()
    };

    Ok(BackfillJobStatus {
        job_id: config.id.clone(),
        pipeline_id: config.pipeline_id.clone(),
        pipeline_name,
        start_time: config.start_time,
        end_time: config.end_time,
        current_position: backfill_job.current_position,
        progress_percent,
        status: actual_status,
        deletion_status: Some(backfill_job.deletion_status.clone()),
        deletion_job_ids: if backfill_job.deletion_job_ids.is_empty() {
            None
        } else {
            Some(backfill_job.deletion_job_ids.clone())
        },
        created_at,
        last_triggered_at: trigger_start_time,
        chunks_completed: Some(chunks_completed),
        chunks_total: Some(chunks_total),
        chunk_period_minutes: config.chunk_period_minutes,
        delay_between_chunks_secs: config.delay_between_chunks_secs,
        delete_before_backfill: Some(config.delete_before_backfill),
        error: backfill_job.error.clone(),
    })
}

pub async fn list_backfill_jobs(org_id: &str) -> Result<Vec<BackfillJobStatus>, anyhow::Error> {
    // Fetch all backfill job configs from table
    let configs = infra::table::backfill_jobs::list_by_org(org_id).await?;

    // Fetch all backfill triggers (no longer using list_by_org_with_created_at)
    let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

    // Create a map of job_id -> trigger for quick lookup
    let mut trigger_map = std::collections::HashMap::new();
    for trigger in triggers {
        trigger_map.insert(trigger.module_key.clone(), trigger);
    }

    let mut jobs = Vec::new();
    for config in configs {
        // Find corresponding trigger using job_id as module_key
        if let Some(trigger) = trigger_map.get(&config.id) {
            let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
            if let Some(backfill_job) = trigger_data.backfill_job {
                let job_status = create_backfill_job_status(
                    &config,
                    trigger.status.clone(),
                    trigger.start_time,
                    &backfill_job,
                    Some(config.created_at), // Use created_at from backfill_jobs table
                )
                .await?;
                jobs.push(job_status);
            }
        }
    }

    Ok(jobs)
}

pub async fn get_backfill_job(
    org_id: &str,
    job_id: &str,
) -> Result<BackfillJobStatus, anyhow::Error> {
    // Fetch static config from backfill_jobs table
    let config = infra::table::backfill_jobs::get(org_id, job_id).await?;

    // Fetch the trigger using module_key (which is the job_id)
    let trigger = db::scheduler::get(org_id, TriggerModule::Backfill, job_id).await?;

    // Parse trigger data to get dynamic state
    let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
    if let Some(backfill_job) = trigger_data.backfill_job {
        return create_backfill_job_status(
            &config,
            trigger.status,
            trigger.start_time,
            &backfill_job,
            Some(config.created_at), // Use created_at from backfill_jobs table
        )
        .await;
    }

    Err(anyhow::anyhow!("Backfill job data not found in trigger"))
}

pub async fn delete_backfill_job(org_id: &str, job_id: &str) -> Result<(), anyhow::Error> {
    // Find the trigger by job_id
    let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

    for trigger in triggers {
        if trigger.module_key == job_id {
            log::info!(
                "[BACKFILL] Deleting backfill job {} in org {}",
                job_id,
                org_id
            );
            // Delete from scheduled_jobs
            db::scheduler::delete(org_id, TriggerModule::Backfill, &trigger.module_key).await?;
            // Delete from backfill_jobs table
            infra::table::backfill_jobs::delete(org_id, job_id).await?;
            return Ok(());
        }
    }

    Err(anyhow::anyhow!("Backfill job not found"))
}

pub async fn delete_backfill_jobs_by_pipeline(
    org_id: &str,
    pipeline_id: &str,
) -> Result<(), anyhow::Error> {
    log::info!(
        "[BACKFILL] Deleting all backfill jobs for pipeline {} in org {}",
        pipeline_id,
        org_id
    );

    // Get all backfill jobs for this pipeline
    let jobs = infra::table::backfill_jobs::list_by_pipeline(org_id, pipeline_id).await?;
    let jobs_count = jobs.len();

    for job in jobs {
        log::info!("delete jobs: {:#?}", job);
        // Delete the trigger from scheduled_jobs
        if let Err(e) = db::scheduler::delete(org_id, TriggerModule::Backfill, &job.id).await {
            log::warn!(
                "[BACKFILL] Failed to delete trigger for job {} from scheduled_jobs: {}",
                job.id,
                e
            );
            // Continue even if trigger deletion fails - it might not exist
        }

        // Delete from backfill_jobs table
        if let Err(e) = infra::table::backfill_jobs::delete(org_id, &job.id).await {
            log::error!(
                "[BACKFILL] Failed to delete backfill job {} from backfill_jobs table: {}",
                job.id,
                e
            );
            return Err(anyhow::anyhow!(
                "Failed to delete backfill job {}: {}",
                job.id,
                e
            ));
        }
    }

    log::info!(
        "[BACKFILL] Successfully deleted {} backfill jobs for pipeline {}",
        jobs_count,
        pipeline_id
    );
    Ok(())
}

pub async fn enable_backfill_job(
    org_id: &str,
    job_id: &str,
    enable: bool,
) -> Result<(), anyhow::Error> {
    if enable {
        // Resume/Enable the job
        // Fetch static config from backfill_jobs table
        let config = infra::table::backfill_jobs::get(org_id, job_id).await?;

        // Fetch the trigger using module_key (which is the job_id)
        let trigger = db::scheduler::get(org_id, TriggerModule::Backfill, job_id).await?;

        // Check if job is paused (Completed status but not actually finished)
        if trigger.status != db::scheduler::TriggerStatus::Completed {
            return Err(anyhow::anyhow!("Job is not paused"));
        }

        // Parse trigger data to get dynamic state
        let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
        let backfill_job = trigger_data
            .backfill_job
            .ok_or_else(|| anyhow::anyhow!("Backfill job data not found in trigger"))?;

        // Check if job is actually completed
        if backfill_job.current_position >= config.end_time {
            return Err(anyhow::anyhow!("Job is already completed"));
        }

        log::info!(
            "[BACKFILL] Enabling backfill job {} in org {}",
            job_id,
            org_id
        );

        let now = Utc::now().timestamp_micros();
        // Resume by setting status back to Waiting
        db::scheduler::update_trigger(
            db::scheduler::Trigger {
                status: db::scheduler::TriggerStatus::Waiting,
                next_run_at: now, // Start immediately
                ..trigger
            },
            true,
            &format!("enable_backfill_{}", job_id),
        )
        .await?;
    } else {
        // Pause/Disable the job
        // Find the trigger by job_id
        let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

        for trigger in triggers {
            if trigger.module_key == job_id {
                log::info!(
                    "[BACKFILL] Disabling backfill job {} in org {}",
                    job_id,
                    org_id
                );
                // Mark trigger as Completed to pause it (keeps all data intact)
                db::scheduler::update_trigger(
                    db::scheduler::Trigger {
                        status: db::scheduler::TriggerStatus::Completed,
                        ..trigger
                    },
                    true,
                    &format!("disable_backfill_{}", job_id),
                )
                .await?;
                return Ok(());
            }
        }

        return Err(anyhow::anyhow!("Backfill job not found"));
    }
    Ok(())
}

#[deprecated(note = "Use enable_backfill_job with enable=false instead")]
pub async fn pause_backfill_job(org_id: &str, job_id: &str) -> Result<(), anyhow::Error> {
    enable_backfill_job(org_id, job_id, false).await
}

#[deprecated(note = "Use enable_backfill_job with enable=true instead")]
pub async fn resume_backfill_job(org_id: &str, job_id: &str) -> Result<(), anyhow::Error> {
    enable_backfill_job(org_id, job_id, true).await
}

pub async fn update_backfill_job(
    org_id: &str,
    job_id: &str,
    req: crate::handler::http::request::pipelines::backfill::BackfillRequest,
) -> Result<(), anyhow::Error> {
    // Fetch existing config from backfill_jobs table
    let existing_config = infra::table::backfill_jobs::get(org_id, job_id).await?;

    // Fetch the trigger using module_key (which is the job_id)
    let trigger = db::scheduler::get(org_id, TriggerModule::Backfill, job_id).await?;

    // Only allow updating paused or completed jobs
    if trigger.status != db::scheduler::TriggerStatus::Completed {
        return Err(anyhow::anyhow!(
            "Can only update paused or completed backfill jobs. Current status: {:?}",
            trigger.status
        ));
    }

    // Parse trigger data to get current dynamic state
    let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
    let _backfill_job = trigger_data
        .backfill_job
        .ok_or_else(|| anyhow::anyhow!("Backfill job data not found in trigger"))?;

    // Validate deletion is not enabled for pipelines with remote destinations
    if req.delete_before_backfill {
        let pipeline =
            crate::service::db::pipeline::get_by_id(&existing_config.pipeline_id).await?;
        let has_remote_destination = pipeline.nodes.iter().any(|node| {
            matches!(
                &node.data,
                config::meta::pipeline::components::NodeData::RemoteStream(_)
            )
        });

        if has_remote_destination {
            return Err(anyhow::anyhow!(
                "Deletion is not supported for pipelines with remote destinations"
            ));
        }
    }

    // Update backfill_jobs table with new config
    let updated_db_job = infra::table::backfill_jobs::BackfillJob {
        id: job_id.to_string(),
        org: org_id.to_string(),
        pipeline_id: existing_config.pipeline_id, // Keep existing pipeline_id
        start_time: req.start_time,
        end_time: req.end_time,
        chunk_period_minutes: req.chunk_period_minutes,
        delay_between_chunks_secs: req.delay_between_chunks_secs,
        delete_before_backfill: req.delete_before_backfill,
        created_at: existing_config.created_at,
    };
    infra::table::backfill_jobs::update(&updated_db_job).await?;

    // Reset dynamic state for restart as new job
    let reset_backfill_job = BackfillJob {
        current_position: req.start_time,
        deletion_status: DeletionStatus::NotRequired,
        deletion_job_ids: Vec::new(),
        error: None,
    };

    // Update trigger data and reset to Waiting status for re-execution
    let updated_trigger_data = ScheduledTriggerData {
        backfill_job: Some(reset_backfill_job),
        ..trigger_data
    };

    let now = chrono::Utc::now().timestamp_micros();
    db::scheduler::update_trigger(
        db::scheduler::Trigger {
            id: trigger.id,
            org: trigger.org.clone(),
            module: trigger.module,
            module_key: trigger.module_key.clone(),
            next_run_at: now, // Schedule immediately
            is_realtime: trigger.is_realtime,
            is_silenced: trigger.is_silenced,
            status: db::scheduler::TriggerStatus::Waiting, // Reset to Waiting for execution
            start_time: trigger.start_time,
            end_time: trigger.end_time,
            retries: 0, // Reset retries
            data: serde_json::to_string(&updated_trigger_data)?,
        },
        true,
        &format!("update_backfill_{}", job_id),
    )
    .await?;

    log::info!(
        "[BACKFILL] Updated backfill job {} for org {}",
        job_id,
        org_id
    );
    Ok(())
}
