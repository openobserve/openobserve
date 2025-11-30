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

use std::time::Duration;

#[cfg(feature = "enterprise")]
use config::utils::stopwatch::StopWatch;
use config::{get_config, metrics};
use infra::errors::{Error, Result};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::WorkGroup;

use super::utils::AsyncDefer;

/// Guard that automatically releases work group lock when dropped
pub struct WorkGroupLock {
    pub took_wait: usize,
    pub work_group_str: String,
    #[cfg(feature = "enterprise")]
    #[allow(dead_code)] // Available for external use/debugging
    pub work_group: Option<WorkGroup>,
    _guard: AsyncDefer,
}

/// OSS version: Uses distributed lock for concurrency control
#[cfg(not(feature = "enterprise"))]
#[tracing::instrument(
    name = "service:search:work_group:check",
    skip_all,
    fields(caller = caller, trace_id = trace_id)
)]
pub async fn check_work_group(
    trace_id: &str,
    org_id: &str,
    timeout: u64,
    stop_watch: &mut StopWatch,
    caller: &str,
) -> Result<WorkGroupLock> {
    let cfg = get_config();
    let work_group_str = "global".to_string();

    let locker_key = format!("/search/cluster_queue/{work_group_str}");
    let locker = if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
        None
    } else {
        infra::dist_lock::lock_with_trace_id(trace_id, &locker_key, timeout)
            .await
            .map_err(|e| {
                metrics::QUERY_PENDING_NUMS
                    .with_label_values(&[org_id])
                    .dec();
                Error::Message(e.to_string())
            })?
    };

    let took_wait = stop_watch.record_split("queue_wait").as_millis() as usize;
    log::info!("[trace_id {trace_id}] {caller}->search: wait in queue took: {took_wait} ms");

    // Create cleanup guard
    let trace_id_owned = trace_id.to_string();
    let caller_owned = caller.to_string();
    let locker_clone = locker.clone();
    let guard = AsyncDefer::new(async move {
        if let Err(e) = infra::dist_lock::unlock_with_trace_id(&trace_id_owned, &locker_clone).await
        {
            log::error!(
                "[trace_id {trace_id_owned}] {caller_owned}->search: failed to unlock: {e:?}"
            );
        }
    });

    Ok(WorkGroupLock {
        took_wait,
        work_group_str,
        _guard: guard,
    })
}

/// Enterprise version: Uses workgroup concurrency control with waiting
#[cfg(feature = "enterprise")]
#[tracing::instrument(
    name = "service:search:work_group:check",
    skip_all,
    fields(caller = caller, trace_id = trace_id, work_group = ?work_group)
)]
pub async fn check_work_group(
    trace_id: &str,
    org_id: &str,
    user_id: Option<&str>,
    timeout: u64,
    work_group: WorkGroup,
    stop_watch: &mut StopWatch,
    caller: &str,
) -> Result<WorkGroupLock> {
    let cfg = get_config();
    let work_group_str = work_group.to_string();

    // Get distributed lock temporarily (for queue coordination)
    let locker_key = format!("/search/cluster_queue/{work_group_str}");
    let locker = if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
        None
    } else {
        infra::dist_lock::lock_with_trace_id(trace_id, &locker_key, timeout)
            .await
            .map_err(|e| {
                metrics::QUERY_PENDING_NUMS
                    .with_label_values(&[org_id])
                    .dec();
                Error::Message(e.to_string())
            })?
    };

    // Check global concurrency
    work_group_need_wait(
        trace_id,
        stop_watch,
        org_id,
        timeout,
        &work_group,
        None,
        caller,
    )
    .await?;

    // Check user concurrency (skip for background tasks)
    let is_background = matches!(work_group, WorkGroup::Background);
    if user_id.is_some() && !is_background {
        work_group_need_wait(
            trace_id,
            stop_watch,
            org_id,
            timeout,
            &work_group,
            user_id,
            caller,
        )
        .await?;
    }

    // Add to workgroup queue
    if let Err(e) = work_group.process(trace_id, user_id).await {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[org_id])
            .dec();
        if let Err(unlock_err) = infra::dist_lock::unlock_with_trace_id(trace_id, &locker).await {
            log::error!(
                "[trace_id {trace_id}] {caller}->search: failed to unlock after process error: {unlock_err:?}"
            );
        }
        return Err(Error::Message(e.to_string()));
    }

    // Release distributed lock (workgroup queue now owns the concurrency control)
    if let Err(e) = infra::dist_lock::unlock_with_trace_id(trace_id, &locker).await {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[org_id])
            .dec();
        if let Err(done_err) = work_group.done(trace_id, user_id).await {
            log::error!(
                "[trace_id {trace_id}] {caller}->search: failed to mark work group as done after unlock error: {done_err:?}"
            );
        }
        return Err(e);
    }

    let took_wait = stop_watch.record_split("queue_wait").as_millis() as usize;
    log::info!("[trace_id {trace_id}] {caller}->search: wait in queue took: {took_wait} ms");

    // Create cleanup guard
    let trace_id_owned = trace_id.to_string();
    let user_id_owned = user_id.map(|s| s.to_string());
    let org_id_owned = org_id.to_string();
    let work_group_clone = work_group.clone();
    let caller_owned = caller.to_string();
    let guard = AsyncDefer::new(async move {
        if let Err(e) = work_group_clone
            .done(&trace_id_owned, user_id_owned.as_deref())
            .await
        {
            log::error!(
                "[trace_id {trace_id_owned}] {caller_owned}->search: failed to mark work group as done: {e:?}"
            );
        }

        metrics::QUERY_RUNNING_NUMS
            .with_label_values(&[&org_id_owned])
            .dec();
        log::info!("[trace_id {trace_id_owned}] search completed, metrics decremented");
    });

    Ok(WorkGroupLock {
        took_wait,
        work_group_str,
        work_group: Some(work_group),
        _guard: guard,
    })
}

/// Enterprise: Wait for workgroup slot to become available
#[cfg(feature = "enterprise")]
#[tracing::instrument(
    name = "service:search:work_group:need_wait",
    skip_all,
    fields(caller = caller, user_id = user_id)
)]
async fn work_group_need_wait(
    trace_id: &str,
    stop_watch: &mut StopWatch,
    org_id: &str,
    timeout: u64,
    work_group: &WorkGroup,
    user_id: Option<&str>,
    caller: &str,
) -> Result<()> {
    let mut log_wait = false;
    loop {
        // Check timeout - use total_millis() to check total time from start
        if stop_watch.total_millis() >= timeout * 1000 {
            metrics::QUERY_TIMEOUT_NUMS
                .with_label_values(&[org_id])
                .inc();
            return Err(Error::Message(format!(
                "[trace_id {trace_id}] {caller}->search: request timeout in queue"
            )));
        }

        match work_group.need_wait(user_id).await {
            Ok((true, cur, max)) => {
                // Need to wait - concurrency limit reached
                if !log_wait {
                    log::info!(
                        "[trace_id {trace_id}] user: {user_id:?} is waiting in work_group {work_group:?}[{cur}/{max}]"
                    );
                    log_wait = true;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Ok((false, cur, max)) => {
                // Got approval - slot available
                if log_wait {
                    log::info!(
                        "[trace_id {trace_id}] user: {user_id:?} get approved in work_group {work_group:?}[{cur}/{max}]"
                    );
                }
                return Ok(());
            }
            Err(e) => {
                return Err(Error::Message(e.to_string()));
            }
        }
    }
}
