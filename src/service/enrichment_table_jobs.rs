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

use infra::table::enrichment_table_jobs;
use tokio::sync::mpsc;

use crate::service::enrichment_table;

// 1. Lookup `enrichment_table_jobs` table and fetch the `task_id` and `task_status` of the rows
//    where `task_status` is `pending` in ascending order of `created_ts`.
// 2. For each task, spawn a task to process the enrichment table. Limit the number of tasks spawned
//    concurrently to the value of `ENRICHMENT_TABLE_JOBS_CONCURRENCY`
// 3. Update the `task_status` to `processing` for the tasks spawned.
// 4. Once done processing, update the `task_status` to `completed` if successful or `failed`.
// 5. If the task is cancelled, update the `task_status` to `cancelled`.
// 6. Remove the file from disk if the task is completed or failed or cancelled.
pub async fn run(id: i64) -> Result<(), anyhow::Error> {
    // Get the oldest pending task
    let job = match enrichment_table_jobs::get_pending_task().await {
        Some(task) => task,
        None => return Ok(()),
    };

    let start = std::time::Instant::now();
    log::info!(
        "[ENRICHMENT_TABLE_JOB: {}] task_id {} Starting enrichment table job",
        id,
        job.task_id
    );

    let ttl = std::cmp::max(
        120,
        config::get_config().limit.enrichment_table_job_timeout / 4,
    ) as u64;
    let job_id = job.task_id.clone();
    let (_tx, mut rx) = mpsc::channel::<()>(1);
    tokio::task::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(ttl)) => {}
                _ = rx.recv() => {
                    log::debug!(
                        "[ENRICHMENT_TABLE_JOBS: {}] task_id {} enrichment table processed.",
                        id,
                        job_id
                    );
                    return;
                }
            }

            if let Err(e) = enrichment_table_jobs::update_running_job(&job_id).await {
                log::error!(
                    "[ENRICHMENT_TABLE_JOBS : {}] task_id:{} update job status failed: {}",
                    id,
                    job_id,
                    e
                );
            }
        }
    });

    if let Err(e) = enrichment_table::extract_and_save_data(&job).await {
        log::error!(
            "[ENRICHMENT_TABLE_JOBS: {}] task_id {} enrichment table job failed: {}",
            id,
            &job.task_id,
            e
        );
        enrichment_table_jobs::set_job_failed(&job.task_id).await?;
        return Ok(());
    };

    // update the task status to completed
    enrichment_table_jobs::set_job_finish(&job.task_id).await?;

    log::info!(
        "[ENRICHMENT_TABLE_JOBS: {}] task_id {} enrichment table job completed in {}ms",
        id,
        &job.task_id,
        start.elapsed().as_millis()
    );

    Ok(())
}
