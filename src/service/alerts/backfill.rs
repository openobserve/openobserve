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
use config::{
    ider,
    meta::triggers::{BackfillJob, DeletionStatus, ScheduledTriggerData, TriggerModule},
};
use serde::{Deserialize, Serialize};
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
    pub deletion_job_id: Option<String>,
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

    // 2. Validate time range
    if start_time >= end_time {
        return Err(anyhow::anyhow!("start_time must be before end_time"));
    }

    let now = Utc::now().timestamp_micros();
    if end_time > now {
        return Err(anyhow::anyhow!("end_time cannot be in the future"));
    }

    // 3. Create backfill job in backfill_jobs table
    let backfill_job_id = ider::generate();
    let module_key = format!("backfill/{}/{}/{}", org_id, pipeline_id, backfill_job_id);

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

    // Store dynamic state in scheduled_jobs trigger data
    let backfill_job = BackfillJob {
        source_pipeline_id: pipeline_id.to_string(),
        start_time,
        end_time,
        chunk_period_minutes,
        current_position: start_time,
        max_execution_time_secs: None,
        delay_between_chunks_secs,
        delete_before_backfill,
        deletion_status,
        deletion_job_id: None,
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

pub async fn list_backfill_jobs(org_id: &str) -> Result<Vec<BackfillJobStatus>, anyhow::Error> {
    let triggers =
        db::scheduler::list_by_org_with_created_at(org_id, Some(TriggerModule::Backfill)).await?;

    let mut jobs = Vec::new();
    for trigger in triggers {
        let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
        if let Some(backfill_job) = trigger_data.backfill_job {
            // Get pipeline name
            let pipeline_name =
                match crate::service::db::pipeline::get_by_id(&backfill_job.source_pipeline_id)
                    .await
                {
                    Ok(pipeline) => Some(pipeline.name),
                    Err(_) => None,
                };

            // Calculate progress based on deletion status
            let progress_percent = if backfill_job.delete_before_backfill {
                match &backfill_job.deletion_status {
                    DeletionStatus::Pending => 0,
                    DeletionStatus::InProgress => 10,
                    DeletionStatus::Completed | DeletionStatus::NotRequired => {
                        // Backfill phase = 20-100% progress
                        let total_duration = backfill_job.end_time - backfill_job.start_time;
                        if total_duration == 0 {
                            100
                        } else {
                            let completed_duration =
                                backfill_job.current_position - backfill_job.start_time;
                            let backfill_progress =
                                (completed_duration as f64 / total_duration as f64 * 80.0) as u8;
                            20 + backfill_progress
                        }
                    }
                    DeletionStatus::Failed(_) => 0,
                }
            } else {
                // No deletion, just backfill progress
                let total_duration = backfill_job.end_time - backfill_job.start_time;
                if total_duration == 0 {
                    100
                } else {
                    let completed_duration =
                        backfill_job.current_position - backfill_job.start_time;
                    (completed_duration as f64 / total_duration as f64 * 100.0) as u8
                }
            };

            // Calculate chunks
            let chunk_period = backfill_job.chunk_period_minutes.unwrap_or(60);
            let total_duration_minutes =
                (backfill_job.end_time - backfill_job.start_time) / (60 * 1_000_000);
            let chunks_total = (total_duration_minutes as f64 / chunk_period as f64).ceil() as u64;
            let completed_duration_minutes =
                (backfill_job.current_position - backfill_job.start_time) / (60 * 1_000_000);
            let chunks_completed =
                (completed_duration_minutes as f64 / chunk_period as f64).floor() as u64;

            // Determine actual status: if trigger is Completed but job hasn't reached end_time,
            // it's paused
            let actual_status = if trigger.status == db::scheduler::TriggerStatus::Completed
                && backfill_job.current_position < backfill_job.end_time
            {
                "paused".to_string()
            } else {
                format!("{:?}", trigger.status).to_lowercase()
            };

            jobs.push(BackfillJobStatus {
                job_id: trigger
                    .module_key
                    .split('/')
                    .next_back()
                    .unwrap_or(&trigger.module_key)
                    .to_string(),
                pipeline_id: backfill_job.source_pipeline_id,
                pipeline_name,
                start_time: backfill_job.start_time,
                end_time: backfill_job.end_time,
                current_position: backfill_job.current_position,
                progress_percent,
                status: actual_status,
                deletion_status: Some(backfill_job.deletion_status.clone()),
                deletion_job_id: backfill_job.deletion_job_id.clone(),
                created_at: trigger.created_at,
                last_triggered_at: trigger.start_time,
                chunks_completed: Some(chunks_completed),
                chunks_total: Some(chunks_total),
                chunk_period_minutes: backfill_job.chunk_period_minutes,
                delay_between_chunks_secs: backfill_job.delay_between_chunks_secs,
                delete_before_backfill: Some(backfill_job.delete_before_backfill),
            });
        }
    }

    Ok(jobs)
}

pub async fn get_backfill_job(
    org_id: &str,
    job_id: &str,
) -> Result<BackfillJobStatus, anyhow::Error> {
    // Try to find the trigger with this job_id
    let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

    for trigger in triggers {
        if trigger.module_key.ends_with(job_id) {
            let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
            if let Some(backfill_job) = trigger_data.backfill_job {
                let pipeline_name =
                    match crate::service::db::pipeline::get_by_id(&backfill_job.source_pipeline_id)
                        .await
                    {
                        Ok(pipeline) => Some(pipeline.name),
                        Err(_) => None,
                    };

                let progress_percent = if backfill_job.delete_before_backfill {
                    match &backfill_job.deletion_status {
                        DeletionStatus::Pending => 0,
                        DeletionStatus::InProgress => 10,
                        DeletionStatus::Completed | DeletionStatus::NotRequired => {
                            let total_duration = backfill_job.end_time - backfill_job.start_time;
                            if total_duration == 0 {
                                100
                            } else {
                                let completed_duration =
                                    backfill_job.current_position - backfill_job.start_time;
                                let backfill_progress =
                                    (completed_duration as f64 / total_duration as f64 * 80.0)
                                        as u8;
                                20 + backfill_progress
                            }
                        }
                        DeletionStatus::Failed(_) => 0,
                    }
                } else {
                    let total_duration = backfill_job.end_time - backfill_job.start_time;
                    if total_duration == 0 {
                        100
                    } else {
                        let completed_duration =
                            backfill_job.current_position - backfill_job.start_time;
                        (completed_duration as f64 / total_duration as f64 * 100.0) as u8
                    }
                };

                let chunk_period = backfill_job.chunk_period_minutes.unwrap_or(60);
                let total_duration_minutes =
                    (backfill_job.end_time - backfill_job.start_time) / (60 * 1_000_000);
                let chunks_total =
                    (total_duration_minutes as f64 / chunk_period as f64).ceil() as u64;
                let completed_duration_minutes =
                    (backfill_job.current_position - backfill_job.start_time) / (60 * 1_000_000);
                let chunks_completed =
                    (completed_duration_minutes as f64 / chunk_period as f64).floor() as u64;

                return Ok(BackfillJobStatus {
                    job_id: job_id.to_string(),
                    pipeline_id: backfill_job.source_pipeline_id,
                    pipeline_name,
                    start_time: backfill_job.start_time,
                    end_time: backfill_job.end_time,
                    current_position: backfill_job.current_position,
                    progress_percent,
                    status: format!("{:?}", trigger.status).to_lowercase(),
                    deletion_status: Some(backfill_job.deletion_status.clone()),
                    deletion_job_id: backfill_job.deletion_job_id.clone(),
                    created_at: None,
                    last_triggered_at: trigger.start_time,
                    chunks_completed: Some(chunks_completed),
                    chunks_total: Some(chunks_total),
                    chunk_period_minutes: backfill_job.chunk_period_minutes,
                    delay_between_chunks_secs: backfill_job.delay_between_chunks_secs,
                    delete_before_backfill: Some(backfill_job.delete_before_backfill),
                });
            }
        }
    }

    Err(anyhow::anyhow!("Backfill job not found"))
}

pub async fn cancel_backfill_job(org_id: &str, job_id: &str) -> Result<(), anyhow::Error> {
    // Find the full module key
    let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

    for trigger in triggers {
        if trigger.module_key.ends_with(job_id) {
            log::info!(
                "[BACKFILL] Pausing backfill job {} in org {}",
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
                &format!("pause_backfill_{}", job_id),
            )
            .await?;
            return Ok(());
        }
    }

    Err(anyhow::anyhow!("Backfill job not found"))
}

pub async fn delete_backfill_job(org_id: &str, job_id: &str) -> Result<(), anyhow::Error> {
    // Find the full module key
    let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

    for trigger in triggers {
        if trigger.module_key.ends_with(job_id) {
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

pub async fn resume_backfill_job(org_id: &str, job_id: &str) -> Result<(), anyhow::Error> {
    // Find the full module key
    let triggers = db::scheduler::list_by_org(org_id, Some(TriggerModule::Backfill)).await?;

    for trigger in triggers {
        if trigger.module_key.ends_with(job_id) {
            // Check if job is paused (Completed status but not actually finished)
            if trigger.status != db::scheduler::TriggerStatus::Completed {
                return Err(anyhow::anyhow!("Job is not paused"));
            }

            let trigger_data = ScheduledTriggerData::from_json_string(&trigger.data)?;
            if let Some(backfill_job) = trigger_data.backfill_job {
                // Check if job is actually completed
                if backfill_job.current_position >= backfill_job.end_time {
                    return Err(anyhow::anyhow!("Job is already completed"));
                }

                log::info!(
                    "[BACKFILL] Resuming backfill job {} in org {}",
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
                    &format!("resume_backfill_{}", job_id),
                )
                .await?;
                return Ok(());
            }
        }
    }

    Err(anyhow::anyhow!("Backfill job not found"))
}

pub async fn update_backfill_job(
    org_id: &str,
    job_id: &str,
    req: crate::handler::http::request::pipelines::backfill::BackfillRequest,
) -> Result<(), anyhow::Error> {
    let triggers = db::scheduler::list_by_org_with_created_at(
        org_id,
        Some(db::scheduler::TriggerModule::Backfill),
    )
    .await?;

    for trigger in triggers {
        if let Ok(trigger_data) = serde_json::from_str::<ScheduledTriggerData>(&trigger.data)
            && let Some(mut backfill_job) = trigger_data.backfill_job
        {
            let trigger_job_id = trigger
                .module_key
                .split('/')
                .next_back()
                .unwrap_or(&trigger.module_key);

            if trigger_job_id == job_id {
                // Only allow updating paused or completed jobs
                if trigger.status != db::scheduler::TriggerStatus::Completed {
                    return Err(anyhow::anyhow!(
                        "Can only update paused or completed backfill jobs. Current status: {:?}",
                        trigger.status
                    ));
                }

                // Update the backfill job fields
                backfill_job.start_time = req.start_time;
                backfill_job.end_time = req.end_time;
                backfill_job.chunk_period_minutes = req.chunk_period_minutes;
                backfill_job.delay_between_chunks_secs = req.delay_between_chunks_secs;
                backfill_job.delete_before_backfill = req.delete_before_backfill;

                // Reset current_position to start_time and reset deletion status for restart as
                // new job
                backfill_job.current_position = req.start_time;
                backfill_job.deletion_status = DeletionStatus::NotRequired;
                backfill_job.deletion_job_id = None;

                // Update backfill_jobs table
                let db_job = infra::table::backfill_jobs::BackfillJob {
                    id: job_id.to_string(),
                    org: org_id.to_string(),
                    pipeline_id: backfill_job.source_pipeline_id.clone(),
                    start_time: backfill_job.start_time,
                    end_time: backfill_job.end_time,
                    chunk_period_minutes: backfill_job.chunk_period_minutes,
                    delay_between_chunks_secs: backfill_job.delay_between_chunks_secs,
                    delete_before_backfill: backfill_job.delete_before_backfill,
                    created_at: trigger
                        .created_at
                        .unwrap_or(chrono::Utc::now().timestamp_micros()),
                };
                infra::table::backfill_jobs::update(&db_job).await?;

                // Update trigger data and reset to Waiting status for re-execution
                let updated_trigger_data = ScheduledTriggerData {
                    backfill_job: Some(backfill_job),
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
                        status: db::scheduler::TriggerStatus::Waiting, /* Reset to Waiting
                                                                        * for execution */
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
                return Ok(());
            }
        }
    }

    Err(anyhow::anyhow!("Backfill job not found"))
}
