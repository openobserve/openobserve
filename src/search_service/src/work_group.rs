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
    crate::SEARCH_SERVER, config::meta::search::SearchEventType, infra::dist_lock,
    infra::errors::ErrorCodes, o2_enterprise::enterprise::search::WorkGroup,
};

use super::utils::AsyncDefer;

/// Guard that automatically releases work group lock when dropped
pub struct DeferredLock {
    pub took_wait: usize,
    #[cfg(feature = "enterprise")]
    pub work_group: Option<WorkGroup>,
    pub work_group_str: String,
    _guard: AsyncDefer,
}

/// OSS version: Uses distributed lock for concurrency control
#[cfg(not(feature = "enterprise"))]
#[tracing::instrument(
    name = "service:search:work_group:check",
    skip_all,
    fields(caller = caller)
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
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(
    name = "service:search:work_group:check",
    skip_all,
    fields(caller = caller, work_group = ?work_group)
)]
pub async fn check_work_group(
    trace_id: &str,
    org_id: &str,
    user_id: Option<&str>,
    search_type: Option<SearchEventType>,
    timeout: u64,
    work_group: WorkGroup,
    stop_watch: &mut TookWatcher,
    caller: &str,
) -> Result<DeferredLock> {
    let work_group_str = work_group.to_string();
    let locker_key = format!("/search/cluster_queue/{work_group_str}");

    // Check all three concurrency levels (global, org, user) and add to the workgroup queue
    work_group_checking(
        trace_id,
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
        work_group: Some(work_group),
        work_group_str,
        _guard: guard,
    })
}

/// Waits for a slot and admits the search into the work group queue. The admission lock is held
/// only while one attempt checks and inserts, never while waiting.
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(name = "service:search:work_group:checking", skip_all, fields(user_id = user_id))]
pub async fn work_group_checking(
    trace_id: &str,
    stop_watch: &mut TookWatcher,
    org_id: &str,
    timeout: u64,
    locker_key: &str,
    work_group: &WorkGroup,
    user_id: Option<&str>,
    search_type: Option<SearchEventType>,
    caller: &str,
) -> Result<()> {
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    if let Err(err) = SEARCH_SERVER
        .insert_sender(trace_id, abort_sender, false)
        .await
    {
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
    let waited = std::sync::atomic::AtomicBool::new(false);
    // Boxed: the nested admission future otherwise overflows the layout depth of its callers.
    let res = Box::pin(wait_for_slot(
        trace_id,
        org_id,
        stop_watch,
        timeout,
        abort_receiver,
        caller,
        |lock_secs| {
            try_admit(
                trace_id,
                locker_key,
                lock_secs,
                work_group,
                org_id,
                user_id,
                search_type,
                &waited,
            )
        },
    ))
    .await;
    if res.is_err() {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[org_id])
            .dec();
    }
    res
}

/// Polls `attempt` until it admits, the timeout passes or the search is canceled. `attempt` gets
/// the seconds left and returns whether it admitted; nothing is held between attempts.
#[cfg(feature = "enterprise")]
async fn wait_for_slot<F, Fut>(
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    timeout: u64,
    mut abort_receiver: tokio::sync::oneshot::Receiver<()>,
    caller: &str,
    mut attempt: F,
) -> Result<()>
where
    F: FnMut(u64) -> Fut,
    Fut: std::future::Future<Output = Result<bool>>,
{
    loop {
        let elapsed = stop_watch.total_millis();
        if elapsed >= timeout * 1000 {
            metrics::QUERY_TIMEOUT_NUMS
                .with_label_values(&[org_id])
                .inc();
            return Err(Error::Message(format!(
                "[trace_id {trace_id}] {caller}->search: request timeout in queue"
            )));
        }
        if attempt((timeout * 1000 - elapsed).div_ceil(1000)).await? {
            return Ok(());
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
            _ = &mut abort_receiver => {
                log::warn!("[trace_id {trace_id}] search->cluster: waiting in queue was canceled");
                return Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!(
                    "[trace_id {trace_id}] search->cluster: waiting in queue was canceled"
                ))));
            }
        }
    }
}

/// One admission attempt: take the admission lock, check every cap, insert when free, release.
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
async fn try_admit(
    trace_id: &str,
    locker_key: &str,
    lock_secs: u64,
    work_group: &WorkGroup,
    org_id: &str,
    user_id: Option<&str>,
    search_type: Option<SearchEventType>,
    waited: &std::sync::atomic::AtomicBool,
) -> Result<bool> {
    use std::sync::atomic::Ordering;

    let cfg = get_config();
    let locker = if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
        None
    } else {
        dist_lock::lock_with_trace_id(trace_id, locker_key, lock_secs)
            .await
            .map_err(|e| Error::Message(e.to_string()))?
    };

    let admitted = match work_group
        .need_wait(Some(org_id), user_id, search_type)
        .await
    {
        Ok((true, status)) => {
            if !waited.swap(true, Ordering::Relaxed) {
                log::info!(
                    "[trace_id {trace_id}] user: {user_id:?} is waiting in work_group {work_group:?}: {status:?}"
                );
            }
            Ok(false)
        }
        Ok((false, status)) => {
            if waited.load(Ordering::Relaxed) {
                log::info!(
                    "[trace_id {trace_id}] user: {user_id:?} get approved in work_group {work_group:?}: {status:?}"
                );
            }
            work_group
                .process(trace_id, Some(org_id), user_id, search_type)
                .await
                .map(|_| true)
                .map_err(|e| Error::Message(e.to_string()))
        }
        Err(e) => Err(Error::Message(e.to_string())),
    };

    if let Err(e) = dist_lock::unlock_with_trace_id(trace_id, &locker).await {
        if matches!(admitted, Ok(true))
            && let Err(done_err) = work_group.done(trace_id, Some(org_id), user_id).await
        {
            log::error!(
                "[trace_id {trace_id}] search: failed to mark work group as done after unlock error: {done_err:?}"
            );
        }
        return Err(e);
    }
    admitted
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

#[cfg(feature = "enterprise")]
pub async fn acquire_work_group_lock(
    trace_id: &str,
    req: &Request,
    stop_watch: &mut TookWatcher,
    caller: &str,
    nodes: &[Node],
    file_id_list_vec: &[&FileId],
) -> Result<DeferredLock> {
    let search_type = req
        .search_event_type
        .as_ref()
        .and_then(|st| SearchEventType::try_from(st.as_str()).ok());
    let is_background_task = search_type.is_some_and(|st| st.is_background());

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
        search_type,
        req.timeout as u64,
        work_group,
        stop_watch,
        caller,
    )
    .await
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use tokio::sync::{Mutex, oneshot};

    use super::*;

    /// A stand-in for one work group: the admission lock (`None` when the queue is off) and the
    /// number of admitted searches against a cap.
    #[derive(Clone)]
    struct Group {
        lock: Option<Arc<Mutex<()>>>,
        admitted: Arc<AtomicUsize>,
        cap: usize,
    }

    impl Group {
        fn new(queue_enabled: bool, cap: usize) -> Self {
            Self {
                lock: queue_enabled.then(|| Arc::new(Mutex::new(()))),
                admitted: Arc::new(AtomicUsize::new(0)),
                cap,
            }
        }

        /// The shape of `try_admit`: lock, count, yield, insert when free, unlock.
        async fn attempt(&self) -> Result<bool> {
            let _guard = match &self.lock {
                Some(lock) => Some(lock.lock().await),
                None => None,
            };
            let free = self.admitted.load(Ordering::SeqCst) < self.cap;
            // Lets a concurrent attempt run between the count and the insert.
            tokio::task::yield_now().await;
            if free {
                self.admitted.fetch_add(1, Ordering::SeqCst);
            }
            Ok(free)
        }

        async fn wait(&self, timeout: u64, abort: oneshot::Receiver<()>) -> Result<()> {
            let watch = TookWatcher::new();
            wait_for_slot("t", "o", &watch, timeout, abort, "test", |_| self.attempt()).await
        }
    }

    #[tokio::test]
    async fn waiting_does_not_hold_the_admission_lock() {
        let group = Group::new(true, 1);
        group.admitted.store(1, Ordering::SeqCst);
        let (_abort, rx) = oneshot::channel();
        let waiter = {
            let group = group.clone();
            tokio::spawn(async move { group.wait(10, rx).await })
        };
        tokio::time::sleep(Duration::from_millis(350)).await;
        assert!(
            !waiter.is_finished(),
            "the cap is full, so the search waits"
        );

        // Another admission into the same group takes the lock while the first one waits.
        let lock = group.lock.clone().unwrap();
        for _ in 0..5 {
            let guard = tokio::time::timeout(Duration::from_millis(50), lock.lock())
                .await
                .expect("the waiting search must not hold the admission lock");
            drop(guard);
            tokio::time::sleep(Duration::from_millis(30)).await;
        }

        // A finished search frees the slot and the waiter is admitted on its next recheck.
        group.admitted.fetch_sub(1, Ordering::SeqCst);
        tokio::time::timeout(Duration::from_secs(2), waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(group.admitted.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn the_wait_keeps_its_timeout_and_cancellation() {
        for queue_enabled in [true, false] {
            let group = Group::new(queue_enabled, 0);
            let (_abort, rx) = oneshot::channel();
            let started = std::time::Instant::now();
            let err = group.wait(1, rx).await.unwrap_err();
            assert!(
                err.to_string().contains("request timeout in queue"),
                "{err}"
            );
            assert!(started.elapsed() >= Duration::from_secs(1));

            let (abort, rx) = oneshot::channel();
            let waiter = {
                let group = group.clone();
                tokio::spawn(async move { group.wait(10, rx).await })
            };
            tokio::time::sleep(Duration::from_millis(150)).await;
            abort.send(()).unwrap();
            let err = tokio::time::timeout(Duration::from_secs(1), waiter)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err();
            assert!(
                err.to_string().contains("waiting in queue was canceled"),
                "{err}"
            );
            if let Some(lock) = &group.lock {
                assert!(
                    lock.try_lock().is_ok(),
                    "a canceled wait leaves the lock free"
                );
            }
        }
    }

    /// With the queue on, the lock spans each check and insert, so concurrent admissions on one
    /// cluster stop at the cap. With the queue off, count then insert overshoots: best effort.
    #[tokio::test]
    async fn concurrent_admissions_against_a_cap_with_the_queue_on_and_off() {
        for (queue_enabled, expected) in [(true, 4), (false, 5)] {
            let group = Group::new(queue_enabled, 4);
            group.admitted.store(3, Ordering::SeqCst);
            let attempts = [group.attempt(), group.attempt()];
            let admitted = futures::future::join_all(attempts).await;
            assert_eq!(
                group.admitted.load(Ordering::SeqCst),
                expected,
                "queue_enabled={queue_enabled}: {admitted:?}"
            );
        }
    }
}
