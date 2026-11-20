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
    crate::QueryPhase,
    config::meta::search::SearchEventType,
    infra::{dist_lock, errors::ErrorCodes},
    o2_enterprise::enterprise::search::{WorkGroup, work_group::ConcurrencyStatus},
    tokio::sync::oneshot,
};

use super::{QueryTracker, utils::AsyncDefer};

/// Guard that automatically releases work group lock when dropped
pub struct DeferredLock {
    pub took_wait: usize,
    #[cfg(feature = "enterprise")]
    pub work_group: Option<WorkGroup>,
    pub work_group_str: String,
    _guard: AsyncDefer,
}

/// The shared state one admission touches: the NATS admission lock and the search queue.
#[cfg(feature = "enterprise")]
struct QueueAdmission<'a> {
    trace_id: &'a str,
    locker_key: &'a str,
    work_group: &'a WorkGroup,
    org_id: &'a str,
    user_id: Option<&'a str>,
    search_type: Option<SearchEventType>,
}

#[cfg(feature = "enterprise")]
impl QueueAdmission<'_> {
    /// Whether the search waits holding the admission lock, so it admits in arrival order.
    fn in_order(&self) -> bool {
        self.search_type != Some(SearchEventType::PublicDashboard)
    }

    async fn lock(&self, secs: u64) -> Result<Option<dist_lock::Locker>> {
        let cfg = get_config();
        if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
            return Ok(None);
        }
        dist_lock::lock_with_trace_id(self.trace_id, self.locker_key, secs)
            .await
            .map_err(|e| Error::Message(e.to_string()))
    }

    async fn unlock(&self, lock: Option<dist_lock::Locker>) -> Result<()> {
        dist_lock::unlock_with_trace_id(self.trace_id, &lock).await
    }

    async fn need_wait(&self) -> Result<(bool, ConcurrencyStatus)> {
        self.work_group
            .need_wait(Some(self.org_id), self.user_id, self.search_type)
            .await
            .map_err(|e| Error::Message(e.to_string()))
    }

    async fn process(&self) -> Result<()> {
        self.work_group
            .process(
                self.trace_id,
                Some(self.org_id),
                self.user_id,
                self.search_type,
            )
            .await
            .map_err(|e| Error::Message(e.to_string()))
    }

    /// Deletes this search's queue row; owned so a drop guard can run it.
    fn release(&self) -> impl Future<Output = Result<()>> + Send + 'static {
        let (work_group, trace_id) = (self.work_group.clone(), self.trace_id.to_string());
        let (org_id, user_id) = (self.org_id.to_string(), self.user_id.map(str::to_string));
        async move {
            work_group
                .done(&trace_id, Some(&org_id), user_id.as_deref())
                .await
                .map_err(|e| Error::Message(e.to_string()))
        }
    }
}

/// OSS version: Uses distributed lock for concurrency control
#[cfg(not(feature = "enterprise"))]
#[tracing::instrument(
    name = "service:search:work_group:check",
    skip_all,
    fields(caller = caller)
)]
pub async fn check_work_group(
    query_tracker: &QueryTracker,
    org_id: &str,
    timeout: u64,
    stop_watch: &mut TookWatcher,
    caller: &str,
) -> Result<DeferredLock> {
    let trace_id = query_tracker.trace_id();
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
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(
    name = "service:search:work_group:check",
    skip_all,
    fields(caller = caller, work_group = ?work_group)
)]
pub async fn check_work_group(
    query_tracker: &QueryTracker,
    org_id: &str,
    user_id: Option<&str>,
    search_type: Option<SearchEventType>,
    timeout: u64,
    work_group: WorkGroup,
    stop_watch: &mut TookWatcher,
    caller: &str,
) -> Result<DeferredLock> {
    let trace_id = query_tracker.trace_id();
    let work_group_str = work_group.to_string();
    let locker_key = format!("/search/cluster_queue/{work_group_str}");

    // Check all three concurrency levels (global, org, user) and add to the workgroup queue
    let slot = work_group_checking(
        query_tracker,
        stop_watch,
        org_id,
        timeout,
        &locker_key,
        &work_group,
        user_id,
        search_type,
        caller,
    )
    .await?;

    let took_wait = stop_watch.record_split("queue_wait").as_millis() as usize;
    log::info!("[trace_id {trace_id}] {caller}->search: wait in queue took: {took_wait} ms");

    let org_id_owned = org_id.to_string();
    let guard = AsyncDefer::new(async move {
        // Dropping the slot deletes this search's queue row.
        drop(slot);
        metrics::QUERY_RUNNING_NUMS
            .with_label_values(&[&org_id_owned])
            .dec();
    });

    Ok(DeferredLock {
        took_wait,
        work_group: Some(work_group),
        work_group_str,
        _guard: guard,
    })
}

/// Waits for a slot and admits the search: in arrival order under the admission lock, or for a
/// public build by polling outside it so a full per-type cap does not block the group.
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(name = "service:search:work_group:checking", skip_all, fields(user_id = user_id))]
pub async fn work_group_checking(
    query_tracker: &QueryTracker,
    stop_watch: &mut TookWatcher,
    org_id: &str,
    timeout: u64,
    locker_key: &str,
    work_group: &WorkGroup,
    user_id: Option<&str>,
    search_type: Option<SearchEventType>,
    caller: &str,
) -> Result<AsyncDefer> {
    let trace_id = query_tracker.trace_id();
    let abort_receiver = match query_tracker.abort_receiver(QueryPhase::Queued) {
        Ok(receiver) => receiver,
        Err(err) => {
            metrics::QUERY_PENDING_NUMS
                .with_label_values(&[org_id])
                .dec();
            log::warn!(
                "[trace_id {trace_id}] search->cluster: request canceled, missing work-group registration: {err}"
            );
            return Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] search->cluster: request canceled, missing work-group registration: {err}"
            ))));
        }
    };
    let admission = QueueAdmission {
        trace_id,
        locker_key,
        work_group,
        org_id,
        user_id,
        search_type,
    };
    // Boxed: the nested admission future otherwise overflows the layout depth of its callers.
    let res = Box::pin(admit(
        &admission,
        trace_id,
        org_id,
        stop_watch,
        timeout,
        abort_receiver,
        caller,
    ))
    .await;
    if res.is_err() {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[org_id])
            .dec();
    }
    res
}

/// Acquire work group lock with automatic work group prediction (enterprise)
/// or simple distributed lock (OSS)
///
/// This is a high-level helper that encapsulates:
/// - Determining if request is a background task
/// - Predicting appropriate work group
/// - Adding work group to search server
/// - Acquiring the work group lock
#[cfg(not(feature = "enterprise"))]
pub async fn acquire_work_group_lock(
    query_tracker: &QueryTracker,
    req: &Request,
    stop_watch: &mut TookWatcher,
    caller: &str,
    _nodes: &[Node],
    _file_id_list_vec: &[&FileId],
) -> Result<DeferredLock> {
    check_work_group(
        query_tracker,
        &req.org_id,
        req.timeout as u64,
        stop_watch,
        caller,
    )
    .await
}

#[cfg(feature = "enterprise")]
pub async fn acquire_work_group_lock(
    query_tracker: &QueryTracker,
    req: &Request,
    stop_watch: &mut TookWatcher,
    caller: &str,
    nodes: &[Node],
    file_id_list_vec: &[&FileId],
) -> Result<DeferredLock> {
    let search_type = req
        .search_event_type
        .as_ref()
        .and_then(|st| st.parse::<SearchEventType>().ok());
    let is_background_task = search_type.is_some_and(|st| st.is_background());

    let work_group = o2_enterprise::enterprise::search::work_group::predict(
        nodes,
        file_id_list_vec,
        is_background_task,
    );

    query_tracker.set_work_group(work_group.clone());

    let user_id = req.user_id.as_deref();

    check_work_group(
        query_tracker,
        &req.org_id,
        user_id,
        search_type,
        req.timeout as u64,
        work_group,
        stop_watch,
        caller,
    )
    .await
}

/// Admits the search and returns its slot, which deletes the queue row when dropped.
#[cfg(feature = "enterprise")]
async fn admit(
    adm: &QueueAdmission<'_>,
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    timeout: u64,
    mut abort: oneshot::Receiver<()>,
    caller: &str,
) -> Result<AsyncDefer> {
    let deadline_ms = timeout * 1000;
    let slot = if adm.in_order() {
        admit_in_order(
            adm,
            trace_id,
            org_id,
            stop_watch,
            deadline_ms,
            &mut abort,
            caller,
        )
        .await?
    } else {
        admit_polling(
            adm,
            trace_id,
            org_id,
            stop_watch,
            deadline_ms,
            &mut abort,
            caller,
        )
        .await?
    };
    // A cancel during the attempt would otherwise run the search; returning drops `slot`.
    if !matches!(abort.try_recv(), Err(oneshot::error::TryRecvError::Empty)) {
        return Err(canceled_in_queue(trace_id));
    }
    Ok(slot)
}

/// Holds the admission lock across the wait, as on main, so searches queued on it admit in order.
#[cfg(feature = "enterprise")]
async fn admit_in_order(
    adm: &QueueAdmission<'_>,
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    deadline_ms: u64,
    abort: &mut oneshot::Receiver<()>,
    caller: &str,
) -> Result<AsyncDefer> {
    let elapsed = stop_watch.total_millis();
    if elapsed >= deadline_ms {
        return Err(queue_timeout(trace_id, org_id, caller));
    }
    let lock = match adm.lock((deadline_ms - elapsed).div_ceil(1000)).await {
        Ok(lock) => lock,
        Err(_) if stop_watch.total_millis() >= deadline_ms => {
            return Err(queue_timeout(trace_id, org_id, caller));
        }
        Err(e) => return Err(e),
    };
    let mut waited = false;
    let admitted = loop {
        if stop_watch.total_millis() >= deadline_ms {
            break Err(queue_timeout(trace_id, org_id, caller));
        }
        match adm.need_wait().await {
            Ok((false, status)) => {
                if waited {
                    log::info!(
                        "[trace_id {trace_id}] {caller}: approved in work_group: {status:?}"
                    );
                }
                break insert(adm, trace_id, caller).await;
            }
            Ok((true, status)) if !waited => {
                log::info!("[trace_id {trace_id}] {caller}: waiting in work_group: {status:?}");
                waited = true;
            }
            Ok((true, _)) => {}
            Err(e) => break Err(e),
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
            _ = &mut *abort => break Err(canceled_in_queue(trace_id)),
        }
    };
    match adm.unlock(lock).await {
        Ok(()) => admitted,
        // Dropping the admitted slot frees it.
        Err(e) if admitted.is_ok() => Err(e),
        Err(e) => {
            log::warn!("[trace_id {trace_id}] search: unlock failed after a refused attempt: {e}");
            admitted
        }
    }
}

/// Polls the caps without the lock until a slot looks free, then admits through `try_admit`.
#[cfg(feature = "enterprise")]
async fn admit_polling(
    adm: &QueueAdmission<'_>,
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    deadline_ms: u64,
    abort: &mut oneshot::Receiver<()>,
    caller: &str,
) -> Result<AsyncDefer> {
    let mut waited = false;
    loop {
        let elapsed = stop_watch.total_millis();
        if elapsed >= deadline_ms {
            return Err(queue_timeout(trace_id, org_id, caller));
        }
        let (wait, status) = adm.need_wait().await?;
        if !wait {
            let lock_secs = (deadline_ms - elapsed).div_ceil(1000);
            if let Some(slot) = try_admit(
                adm,
                lock_secs,
                trace_id,
                org_id,
                stop_watch,
                deadline_ms,
                caller,
            )
            .await?
            {
                if waited {
                    log::info!(
                        "[trace_id {trace_id}] {caller}: approved in work_group: {status:?}"
                    );
                }
                return Ok(slot);
            }
        } else if !waited {
            log::info!("[trace_id {trace_id}] {caller}: waiting in work_group: {status:?}");
            waited = true;
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
            _ = &mut *abort => return Err(canceled_in_queue(trace_id)),
        }
    }
}

/// Takes the admission lock, rechecks every cap, inserts when still free and releases the lock.
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
async fn try_admit(
    adm: &QueueAdmission<'_>,
    lock_secs: u64,
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    deadline_ms: u64,
    caller: &str,
) -> Result<Option<AsyncDefer>> {
    let lock = match adm.lock(lock_secs).await {
        Ok(lock) => lock,
        Err(_) if stop_watch.total_millis() >= deadline_ms => {
            return Err(queue_timeout(trace_id, org_id, caller));
        }
        Err(e) => return Err(e),
    };
    let admitted = match adm.need_wait().await {
        Ok((false, _)) => insert(adm, trace_id, caller).await.map(Some),
        Ok((true, _)) => Ok(None),
        Err(e) => Err(e),
    };
    match adm.unlock(lock).await {
        Ok(()) => admitted,
        // Dropping the admitted slot frees it.
        Err(e) if matches!(admitted, Ok(Some(_))) => Err(e),
        Err(e) => {
            log::warn!("[trace_id {trace_id}] search: unlock failed after a refused attempt: {e}");
            admitted
        }
    }
}

/// Inserts the queue row with its release guard armed first, so a search dropped after the insert
/// still frees its slot.
#[cfg(feature = "enterprise")]
async fn insert(adm: &QueueAdmission<'_>, trace_id: &str, caller: &str) -> Result<AsyncDefer> {
    let (release, trace_id, caller) = (adm.release(), trace_id.to_string(), caller.to_string());
    let slot = AsyncDefer::new(async move {
        if let Err(e) = release.await {
            log::error!(
                "[trace_id {trace_id}] {caller}->search: failed to release the work group slot: {e:?}"
            );
        }
    });
    adm.process().await?;
    Ok(slot)
}

#[cfg(feature = "enterprise")]
fn queue_timeout(trace_id: &str, org_id: &str, caller: &str) -> Error {
    metrics::QUERY_TIMEOUT_NUMS
        .with_label_values(&[org_id])
        .inc();
    Error::Message(format!(
        "[trace_id {trace_id}] {caller}->search: request timeout in queue"
    ))
}

#[cfg(feature = "enterprise")]
fn canceled_in_queue(trace_id: &str) -> Error {
    log::warn!("[trace_id {trace_id}] search->cluster: waiting in queue was canceled");
    Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!(
        "[trace_id {trace_id}] search->cluster: waiting in queue was canceled"
    )))
}
