// Copyright 2026 OpenObserve Inc.
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

//! Backfill-job teardown that other domains have to run as a cascade.
//!
//! This is deliberately separate from [`crate::alerts::backfill`]: everything else in that module
//! belongs to the scheduler, which sits well above the pipeline code, but deleting a pipeline has
//! to drop that pipeline's backfill jobs too. The cascade only touches the `backfill_jobs` and
//! `scheduled_jobs` tables, so it lives down here where the pipeline layer can reach it.

use config::meta::triggers::TriggerModule;

use crate::db;

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
    let jobs = db::backfill::list_by_pipeline(org_id, pipeline_id).await?;
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
        if let Err(e) = db::backfill::delete(org_id, &job.id).await {
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
