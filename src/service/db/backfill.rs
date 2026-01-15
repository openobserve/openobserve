// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use infra::errors::Result;
pub use infra::table::backfill_jobs::BackfillJob;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::super_cluster::queue::BACKFILL_JOBS_KEY;

/// Get a backfill job by org and job ID
pub async fn get(org: &str, job_id: &str) -> Result<BackfillJob> {
    infra::table::backfill_jobs::get(org, job_id).await
}

/// List all backfill jobs for an organization
pub async fn list_by_org(org: &str) -> Result<Vec<BackfillJob>> {
    infra::table::backfill_jobs::list_by_org(org).await
}

/// List all backfill jobs for a specific pipeline
pub async fn list_by_pipeline(org: &str, pipeline_id: &str) -> Result<Vec<BackfillJob>> {
    infra::table::backfill_jobs::list_by_pipeline(org, pipeline_id).await
}

/// Add a new backfill job
pub async fn add(job: BackfillJob) -> Result<()> {
    infra::table::backfill_jobs::add(job.clone()).await?;

    // Super cluster support
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = format!("{BACKFILL_JOBS_KEY}/{}/{}", job.org, job.id);
        match config::utils::json::to_vec(&job) {
            Err(e) => {
                log::error!(
                    "[BACKFILL] error serializing backfill job {}/{} for super_cluster event: {e}",
                    job.org,
                    job.id
                );
            }
            Ok(value_vec) => {
                if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::backfill_add(
                    &key,
                    value_vec.into(),
                )
                .await
                {
                    log::error!(
                        "[BACKFILL] error sending backfill job {}/{} to super_cluster: {e}",
                        job.org,
                        job.id
                    );
                }
            }
        }
    }

    Ok(())
}

/// Delete a backfill job
pub async fn delete(org: &str, job_id: &str) -> Result<()> {
    infra::table::backfill_jobs::delete(org, job_id).await?;

    // Super cluster support
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = format!("{BACKFILL_JOBS_KEY}/{}/{}", org, job_id);
        if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::backfill_delete(&key).await
        {
            log::error!(
                "[BACKFILL] error sending backfill job {}/{} delete event to super_cluster: {e}",
                org,
                job_id
            );
        }
    }

    Ok(())
}

/// Update an existing backfill job
pub async fn update(job: &BackfillJob) -> Result<()> {
    infra::table::backfill_jobs::update(job).await?;

    // Super cluster support
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = format!("{BACKFILL_JOBS_KEY}/{}/{}", job.org, job.id);
        match config::utils::json::to_vec(job) {
            Err(e) => {
                log::error!(
                    "[BACKFILL] error serializing backfill job {}/{} for super_cluster update event: {e}",
                    job.org,
                    job.id
                );
            }
            Ok(value_vec) => {
                if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::backfill_update(
                    &key,
                    value_vec.into(),
                )
                .await
                {
                    log::error!(
                        "[BACKFILL] error sending backfill job {}/{} update to super_cluster: {e}",
                        job.org,
                        job.id
                    );
                }
            }
        }
    }

    Ok(())
}

/// Update the enabled status of a backfill job
pub async fn update_enabled(org: &str, job_id: &str, enabled: bool) -> Result<()> {
    use chrono::Utc;

    use super::scheduler;

    // Update the enabled field in the backfill_jobs table
    infra::table::backfill_jobs::update_enabled(org, job_id, enabled).await?;

    // If enabling, set the trigger status to Waiting so it runs immediately
    if enabled {
        let now = Utc::now().timestamp_micros();
        match scheduler::get(org, scheduler::TriggerModule::Backfill, job_id).await {
            Ok(trigger) => {
                // Trigger exists, update it to Waiting
                if let Err(e) = scheduler::update_trigger(
                    scheduler::Trigger {
                        status: scheduler::TriggerStatus::Waiting,
                        next_run_at: now, // Start immediately
                        ..trigger
                    },
                    true,
                    &format!("enable_backfill_{}", job_id),
                )
                .await
                {
                    log::error!(
                        "[BACKFILL] Failed to update trigger status when enabling backfill job {}/{}: {}",
                        org,
                        job_id,
                        e
                    );
                }
            }
            Err(_) => {
                // Trigger doesn't exist, create a new one
                // First, get the backfill job to initialize trigger data
                match get(org, job_id).await {
                    Ok(backfill_job) => {
                        // Create trigger data with backfill job state
                        let trigger_data = config::meta::triggers::ScheduledTriggerData {
                            period_end_time: None,
                            tolerance: 0,
                            last_satisfied_at: None,
                            backfill_job: Some(config::meta::triggers::BackfillJob {
                                current_position: backfill_job.start_time,
                                deletion_status:
                                    config::meta::triggers::DeletionStatus::NotRequired,
                                deletion_job_ids: vec![],
                                error: None,
                            }),
                        };

                        let data = match config::utils::json::to_string(&trigger_data) {
                            Ok(d) => d,
                            Err(e) => {
                                log::error!(
                                    "[BACKFILL] Failed to serialize trigger data for {}/{}: {}",
                                    org,
                                    job_id,
                                    e
                                );
                                String::new()
                            }
                        };

                        let trigger = scheduler::Trigger {
                            id: 0, // Will be auto-generated
                            org: org.to_string(),
                            module: scheduler::TriggerModule::Backfill,
                            module_key: job_id.to_string(),
                            next_run_at: now,
                            is_realtime: false,
                            is_silenced: false,
                            status: scheduler::TriggerStatus::Waiting,
                            start_time: None,
                            end_time: None,
                            retries: 0,
                            data,
                        };

                        if let Err(e) = scheduler::push(trigger).await {
                            log::error!(
                                "[BACKFILL] Failed to create trigger when enabling backfill job {}/{}: {}",
                                org,
                                job_id,
                                e
                            );
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "[BACKFILL] Failed to get backfill job when creating trigger for {}/{}: {}",
                            org,
                            job_id,
                            e
                        );
                    }
                }
            }
        }
    }

    // Super cluster support
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        // Fetch the updated job to send to super cluster
        if let Ok(job) = get(org, job_id).await {
            let key = format!("{BACKFILL_JOBS_KEY}/{}/{}", org, job_id);
            match config::utils::json::to_vec(&job) {
                Err(e) => {
                    log::error!(
                        "[BACKFILL] error serializing backfill job {}/{} for super_cluster enable/disable event: {e}",
                        org,
                        job_id
                    );
                }
                Ok(value_vec) => {
                    if let Err(e) =
                        o2_enterprise::enterprise::super_cluster::queue::backfill_update(
                            &key,
                            value_vec.into(),
                        )
                        .await
                    {
                        log::error!(
                            "[BACKFILL] error sending backfill job {}/{} enable/disable to super_cluster: {e}",
                            org,
                            job_id
                        );
                    }
                }
            }
        }
    }

    Ok(())
}
