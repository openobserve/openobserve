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

use chrono::{DateTime, Datelike};
use config::{
    meta::{
        search::{self, Response, SearchPartitionRequest},
        stream::StreamType,
    },
    utils::json,
};
use infra::{
    storage,
    table::entity::{
        background_job_partitions::Model as PartitionJob, background_jobs::Model as Job,
    },
};
use tokio::sync::mpsc;

use crate::service::{
    db::background_job::{
        get_job, get_partition_jobs_by_job_id, is_created_partition_jobs, set_job_error_message,
        set_job_finish, set_partition_job_error_message, set_partition_job_finish,
        set_partition_job_start, set_partition_num, submit_partitions, update_running_job,
    },
    search as SearchService,
};

// the type of workers
// 1. run query
// 2. clean the query
// 3. job for check `background_jobs` updated_at, to check if the job is alive or not

// 1. get the oldest job from `background_jobs` table
// 2. check if the job is previous running (get error then retry, be cancel then retry) (case 1) or
//    do not have previous run (case 2) in case 2, call search_partition to get all jobs, write to
//    database
// 3. get all partition jobs from `background_job_partitions` table
// 4. after run on partition, write result to s3
// 6. when all partition is done, write data to s3, then update `background_jobs` table
pub async fn run(id: i64) -> Result<(), anyhow::Error> {
    // 1. get the oldest job from `background_jobs` table, and set status to running
    let job = match get_job().await? {
        Some(job) => job,
        None => return Ok(()),
    };

    let start = std::time::Instant::now();
    log::info!(
        "[BACKGROUND JOB {id}] job_id: {}, start running, trace_id: {}",
        job.id,
        job.trace_id
    );

    // 2. similar to the compactor, we need to update the job status every 15 seconds
    let ttl = std::cmp::max(
        60,
        config::get_config().limit.background_job_run_timeout / 4,
    ) as u64;
    let job_id = job.id.clone();
    let (_tx, mut rx) = mpsc::channel::<()>(1);
    tokio::task::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(ttl)) => {}
                _ = rx.recv() => {
                    log::debug!("[BACKGROUND JOB {id}] job_id: {job_id}, update_running_jobs done");
                    return;
                }
            }

            if let Err(e) = update_running_job(&job_id).await {
                log::error!(
                    "[BACKGROUND JOB {id}] job_id: {job_id}, update_job_status failed: {e}",
                );
            }
        }
    });

    // 3. check if the job is previous running (get error then retry, be cancel then retry) (case 1)
    //    or do not have previous run (case 2)
    let have_partition_job = is_created_partition_jobs(&job.id).await?;
    if !have_partition_job {
        let res = handle_search_partition(&job).await;
        if let Err(e) = res {
            set_job_error_message(&job.id, &e.to_string()).await?;
            log::error!(
                "[BACKGROUND JOB {id}] job_id: {}, handle_search_partition error: {e}",
                job.id
            );
            return Err(e);
        }
    }

    // 4. get all partition jobs from `background_job_partitions` table
    let partition_jobs = get_partition_jobs_by_job_id(&job.id).await?;
    for partition_job in partition_jobs.iter() {
        log::info!(
            "[BACKGROUND JOB {id}] running job_id: {}, partition id: {}",
            job.id,
            partition_job.partition_id
        );
        let res = run_partition_job(&job, partition_job).await;
        if let Err(e) = res {
            set_job_error_message(&job.id, &e.to_string()).await?;
            log::error!(
                "[BACKGROUND JOB {id}] job_id: {}, run_partition_job error: {e}",
                job.id
            );
            return Err(e);
        }
    }

    log::info!(
        "[BACKGROUND JOB {id}] job_id: {}, start merge all partition result",
        job.id,
    );

    // 5. after run on partition, write result to s3
    // TODO: handle from and size
    let mut reponse = Response::default();
    reponse.set_trace_id(job.trace_id.clone());
    for i in 0..partition_jobs.len() {
        let path = generate_result_path(job.created_at, &job.trace_id, Some(i as i32));
        let buf = storage::get(&path).await?;
        let res: Response = json::from_str(String::from_utf8(buf.to_vec())?.as_str())?;
        reponse.merge(&res);
    }
    let buf = bytes::Bytes::from(json::to_string(&reponse)?);
    let path = generate_result_path(job.created_at, &job.trace_id, None);
    storage::put(&path, buf).await?;

    // 6. update `background_jobs` table
    set_job_finish(&job.id, &path).await?;

    log::info!(
        "[BACKGROUND JOB {id}] finish running, job_id: {}, time_elapsed: {}ms",
        job.id,
        start.elapsed().as_millis()
    );

    Ok(())
}

// 1. call search_partition to get all time range
// 2. write to database
async fn handle_search_partition(job: &Job) -> Result<(), anyhow::Error> {
    let stream_type = StreamType::from(job.stream_type.as_str());
    let req: search::Request = json::from_str(&job.payload)?;
    let partition_req = SearchPartitionRequest::from(&req);
    let res =
        SearchService::search_partition(&job.trace_id, &job.org_id, stream_type, &partition_req)
            .await?;

    submit_partitions(&job.id, res.partitions.as_slice()).await?;

    set_partition_num(&job.id, res.partitions.len() as i32)
        .await
        .map_err(|e| e.into())
}

// 1. rewrite the start_time and end_time to the query
// 2. set the partition status to running
// 3. run the query
// 4. write the result to s3
// 5. set the partition status to finish
async fn run_partition_job(job: &Job, partition_job: &PartitionJob) -> Result<(), anyhow::Error> {
    // 1. rewrite the start_time and end_time to the query
    let mut req: search::Request = json::from_str(&job.payload)?;
    req.query.start_time = partition_job.start_time;
    req.query.end_time = partition_job.end_time;
    let partition_id = partition_job.partition_id;

    // 2. set the partition status to running
    set_partition_job_start(&job.id, partition_id).await?;

    // 3. run the query
    let stream_type = StreamType::from(job.stream_type.as_str());
    let res = SearchService::search(
        &job.trace_id,
        &job.org_id,
        stream_type,
        Some(job.user_id.clone()),
        &req,
    )
    .await;
    if let Err(e) = res {
        set_partition_job_error_message(&job.id, partition_id, &e.to_string()).await?;
        return Err(e.into());
    }

    // 4. write the result to s3
    let result = res.unwrap();
    let buf = bytes::Bytes::from(json::to_string(&result)?);
    let path = generate_result_path(job.created_at, &job.trace_id, Some(partition_id));
    storage::put(&path, buf).await?;

    // 5. set the partition status to finish
    set_partition_job_finish(&job.id, partition_id, path.as_str()).await?;

    Ok(())
}

fn generate_result_path(
    created_at: i64,
    trace_id: &str,
    partition_id: Option<i32>, // None means it is the final result
) -> String {
    let naive_datetime = DateTime::from_timestamp_micros(created_at)
        .unwrap_or_else(|| panic!("Invalid timestamp for created_at for trace_id: {trace_id}"));
    let year = naive_datetime.year();
    let month = naive_datetime.month();
    let day = naive_datetime.day();

    format!(
        "result/{year}/{month}/{day}/{trace_id}/{partition_id}.json",
        year = year,
        month = month,
        day = day,
        trace_id = trace_id,
        partition_id = if partition_id.is_some() {
            partition_id.unwrap().to_string()
        } else {
            "final".to_string()
        }
    )
}
