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

use config::{
    datafusion::request::Request, get_config, meta::cluster::Node, metrics,
    utils::took_watcher::TookWatcher,
};
use infra::{
    errors::{Error, Result},
    file_list::FileId,
};
#[cfg(feature = "enterprise")]
use {
    crate::service::search::SEARCH_SERVER, config::meta::search::SearchEventType, infra::dist_lock,
    infra::errors::ErrorCodes, o2_enterprise::enterprise::search::WorkGroup,
};

use super::utils::AsyncDefer;

/// Guard that automatically releases work group lock when dropped
pub struct DeferredLock {
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
    stop_watch: &mut TookWatcher,
    caller: &str,
) -> Result<DeferredLock> {
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
    let guard = AsyncDefer::new(async move {
        if let Err(e) = infra::dist_lock::unlock_with_trace_id(&trace_id_owned, &locker).await {
            log::error!(
                "[trace_id {trace_id_owned}] {caller_owned}->search: failed to unlock: {e:?}"
            );
        }
    });

    Ok(DeferredLock {
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
    stop_watch: &mut TookWatcher,
    caller: &str,
) -> Result<DeferredLock> {
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

    // Check all three concurrency levels (global, org, user) in a single query
    work_group_checking(
        trace_id,
        stop_watch,
        org_id,
        timeout,
        &locker,
        &work_group,
        user_id,
        caller,
    )
    .await?;

    // Add to workgroup queue
    if let Err(e) = work_group.process(trace_id, Some(org_id), user_id).await {
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
        if let Err(done_err) = work_group.done(trace_id, Some(org_id), user_id).await {
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
            .done(
                &trace_id_owned,
                Some(&org_id_owned),
                user_id_owned.as_deref(),
            )
            .await
        {
            log::error!(
                "[trace_id {trace_id_owned}] {caller_owned}->search: failed to mark work group as done: {e:?}"
            );
        }

        metrics::QUERY_RUNNING_NUMS
            .with_label_values(&[&org_id_owned])
            .dec();
    });

    Ok(DeferredLock {
        took_wait,
        work_group_str,
        work_group: Some(work_group),
        _guard: guard,
    })
}

#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(name = "service:search:work_group:checking", skip_all, fields(user_id = user_id))]
pub async fn work_group_checking(
    trace_id: &str,
    stop_watch: &mut TookWatcher,
    org_id: &str,
    timeout: u64,
    locker: &Option<dist_lock::Locker>,
    work_group: &WorkGroup,
    user_id: Option<&str>,
    caller: &str,
) -> Result<()> {
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    if SEARCH_SERVER
        .insert_sender(trace_id, abort_sender, false)
        .await
        .is_err()
    {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[org_id])
            .dec();
        dist_lock::unlock_with_trace_id(trace_id, locker).await?;
        log::warn!("[trace_id {trace_id}] search->cluster: request canceled before enter queue");
        return Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!(
            "[trace_id {trace_id}] search->cluster: request canceled before enter queue"
        ))));
    }
    tokio::select! {
        res = work_group_need_wait(trace_id, stop_watch, org_id, timeout, work_group, user_id, caller) => {
            match res {
                Ok(_) => {
                    return Ok(());
                },
                Err(e) => {
                    metrics::QUERY_PENDING_NUMS
                        .with_label_values(&[org_id])
                        .dec();
                    dist_lock::unlock_with_trace_id(trace_id, locker).await?;
                    return Err(e);
                }
            }
        }
        _ = abort_receiver => {
            metrics::QUERY_PENDING_NUMS
                .with_label_values(&[org_id])
                .dec();
            dist_lock::unlock_with_trace_id(trace_id, locker).await?;
            log::warn!("[trace_id {trace_id}] search->cluster: waiting in queue was canceled");
            return Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!("[trace_id {trace_id}] search->cluster: waiting in queue was canceled"))));
        }
    }
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
    stop_watch: &mut TookWatcher,
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

        match work_group.need_wait(Some(org_id), user_id).await {
            Ok((true, status)) => {
                // Need to wait - concurrency limit reached
                if !log_wait {
                    log::info!(
                        "[trace_id {trace_id}] user: {user_id:?} is waiting in work_group {work_group:?}[global:{}/{}, org:{}/{}, user:{}/{}]",
                        status.global_current,
                        status.global_limit,
                        status.org_current,
                        status.org_limit,
                        status.user_current,
                        status.user_limit
                    );
                    log_wait = true;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Ok((false, status)) => {
                // Got approval - slot available
                if log_wait {
                    log::info!(
                        "[trace_id {trace_id}] user: {user_id:?} get approved in work_group {work_group:?}[global:{}/{}, org:{}/{}, user:{}/{}]",
                        status.global_current,
                        status.global_limit,
                        status.org_current,
                        status.org_limit,
                        status.user_current,
                        status.user_limit
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

/// Acquire work group lock with automatic work group prediction (enterprise)
/// or simple distributed lock (OSS)
///
/// This is a high-level helper that encapsulates:
/// - Determining if request is a background task
/// - Predicting appropriate work group (enterprise only)
/// - Adding work group to search server (enterprise only)
/// - Acquiring the work group lock
#[cfg(not(feature = "enterprise"))]
pub async fn acquire_work_group_lock(
    trace_id: &str,
    req: &Request,
    stop_watch: &mut TookWatcher,
    caller: &str,
    _nodes: &[Node],
    _file_id_list_vec: &[&FileId],
) -> Result<DeferredLock> {
    check_work_group(
        trace_id,
        &req.org_id,
        req.timeout as u64,
        stop_watch,
        caller,
    )
    .await
}

/// Acquire work group lock with automatic work group prediction (enterprise)
/// or simple distributed lock (OSS)
///
/// This is a high-level helper that encapsulates:
/// - Determining if request is a background task
/// - Predicting appropriate work group (enterprise only)
/// - Adding work group to search server (enterprise only)
/// - Acquiring the work group lock
#[cfg(feature = "enterprise")]
pub async fn acquire_work_group_lock(
    trace_id: &str,
    req: &Request,
    stop_watch: &mut TookWatcher,
    caller: &str,
    nodes: &[Node],
    file_id_list_vec: &[&FileId],
) -> Result<DeferredLock> {
    // Predict workgroup first
    let is_background_task = req
        .search_event_type
        .as_ref()
        .and_then(|st| SearchEventType::try_from(st.as_str()).ok())
        .map(|st| st.is_background())
        .unwrap_or(false);

    let work_group = o2_enterprise::enterprise::search::work_group::predict(
        nodes,
        file_id_list_vec,
        is_background_task,
    );

    SEARCH_SERVER
        .add_work_group(trace_id, Some(work_group.clone()))
        .await;

    let user_id = req.user_id.as_deref();

    check_work_group(
        trace_id,
        &req.org_id,
        user_id,
        req.timeout as u64,
        work_group,
        stop_watch,
        caller,
    )
    .await
}
