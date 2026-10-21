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
trait Admission {
    type Lock;
    async fn lock(&self, secs: u64) -> Result<Self::Lock>;
    async fn unlock(&self, lock: Self::Lock) -> Result<()>;
    async fn need_wait(&self) -> Result<(bool, ConcurrencyStatus)>;
    async fn process(&self) -> Result<()>;
    async fn done(&self) -> Result<()>;
}

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
impl Admission for QueueAdmission<'_> {
    type Lock = Option<dist_lock::Locker>;

    async fn lock(&self, secs: u64) -> Result<Self::Lock> {
        let cfg = get_config();
        if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
            return Ok(None);
        }
        dist_lock::lock_with_trace_id(self.trace_id, self.locker_key, secs)
            .await
            .map_err(|e| Error::Message(e.to_string()))
    }

    async fn unlock(&self, lock: Self::Lock) -> Result<()> {
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

    async fn done(&self) -> Result<()> {
        self.work_group
            .done(self.trace_id, Some(self.org_id), self.user_id)
            .await
            .map_err(|e| Error::Message(e.to_string()))
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
    work_group_checking(
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

/// Waits for a slot and admits the search; the admission lock is held only to recheck and insert.
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
) -> Result<()> {
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
        .and_then(|st| SearchEventType::try_from(st.as_str()).ok());
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

/// Polls the caps without the lock until a slot looks free, then admits through `try_admit`.
#[cfg(feature = "enterprise")]
async fn admit<A: Admission>(
    adm: &A,
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    timeout: u64,
    mut abort: oneshot::Receiver<()>,
    caller: &str,
) -> Result<()> {
    let deadline_ms = timeout * 1000;
    let mut waited = false;
    loop {
        let elapsed = stop_watch.total_millis();
        if elapsed >= deadline_ms {
            return Err(queue_timeout(trace_id, org_id, caller));
        }
        let (wait, status) = adm.need_wait().await?;
        if !wait {
            let lock_secs = (deadline_ms - elapsed).div_ceil(1000);
            if try_admit(
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
                // A cancel that arrived during the attempt would otherwise run the search.
                if !matches!(abort.try_recv(), Err(oneshot::error::TryRecvError::Empty)) {
                    if let Err(e) = adm.done().await {
                        log::error!(
                            "[trace_id {trace_id}] search: failed to release a canceled slot: {e}"
                        );
                    }
                    return Err(canceled_in_queue(trace_id));
                }
                if waited {
                    log::info!(
                        "[trace_id {trace_id}] {caller}: approved in work_group: {status:?}"
                    );
                }
                return Ok(());
            }
        } else if !waited {
            log::info!("[trace_id {trace_id}] {caller}: waiting in work_group: {status:?}");
            waited = true;
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
            _ = &mut abort => return Err(canceled_in_queue(trace_id)),
        }
    }
}

/// Takes the admission lock, rechecks every cap, inserts when still free and releases the lock.
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
async fn try_admit<A: Admission>(
    adm: &A,
    lock_secs: u64,
    trace_id: &str,
    org_id: &str,
    stop_watch: &TookWatcher,
    deadline_ms: u64,
    caller: &str,
) -> Result<bool> {
    let lock = match adm.lock(lock_secs).await {
        Ok(lock) => lock,
        Err(_) if stop_watch.total_millis() >= deadline_ms => {
            return Err(queue_timeout(trace_id, org_id, caller));
        }
        Err(e) => return Err(e),
    };
    let admitted = match adm.need_wait().await {
        Ok((false, _)) => adm.process().await.map(|_| true),
        Ok((true, _)) => Ok(false),
        Err(e) => Err(e),
    };
    match adm.unlock(lock).await {
        Ok(()) => admitted,
        Err(e) if matches!(admitted, Ok(true)) => {
            if let Err(done_err) = adm.done().await {
                log::error!(
                    "[trace_id {trace_id}] search: failed to mark work group as done after unlock error: {done_err:?}"
                );
            }
            Err(e)
        }
        Err(e) => {
            log::warn!("[trace_id {trace_id}] search: unlock failed after a refused attempt: {e}");
            admitted
        }
    }
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

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use std::{
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use infra::table::search_queue::QueueCounts;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
    use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

    use super::*;

    const PUBLIC: Option<SearchEventType> = Some(SearchEventType::PublicDashboard);

    #[derive(Clone, Debug, PartialEq)]
    struct Row {
        org: String,
        user: String,
        search_type: Option<SearchEventType>,
        trace: String,
    }

    /// One work group's queue with an injectable admission lock; `None` lock means queue off.
    #[derive(Default)]
    struct Queue {
        lock: Option<Arc<AsyncMutex<()>>>,
        rows: Mutex<Vec<Row>>,
        replica: Mutex<Option<Vec<Row>>>,
        lock_calls: AtomicUsize,
        unlock_failures: AtomicUsize,
        lock_error_after: Option<Duration>,
        on_lock: Mutex<Option<Row>>,
        on_process: Mutex<Option<oneshot::Sender<()>>>,
    }

    impl Queue {
        fn new(queue_enabled: bool) -> Arc<Self> {
            Arc::new(Self {
                lock: queue_enabled.then(|| Arc::new(AsyncMutex::new(()))),
                ..Default::default()
            })
        }

        fn push(&self, org: &str, search_type: Option<SearchEventType>, trace: &str) {
            self.rows.lock().unwrap().push(row(org, search_type, trace));
        }

        fn remove(&self, trace: &str) {
            self.rows.lock().unwrap().retain(|r| r.trace != trace);
        }

        fn traces(&self, trace: &str) -> usize {
            let rows = self.rows.lock().unwrap();
            rows.iter().filter(|r| r.trace == trace).count()
        }

        fn len(&self) -> usize {
            self.rows.lock().unwrap().len()
        }

        /// Reads lag behind writes, as on a read replica, until this is cleared.
        fn freeze_reads(&self) {
            *self.replica.lock().unwrap() = Some(self.rows.lock().unwrap().clone());
        }
    }

    fn row(org: &str, search_type: Option<SearchEventType>, trace: &str) -> Row {
        Row {
            org: org.to_string(),
            user: format!("user-of-{org}"),
            search_type,
            trace: trace.to_string(),
        }
    }

    struct Fake {
        queue: Arc<Queue>,
        me: Row,
    }

    impl Admission for Fake {
        type Lock = Option<OwnedMutexGuard<()>>;

        async fn lock(&self, _secs: u64) -> Result<Self::Lock> {
            self.queue.lock_calls.fetch_add(1, Ordering::SeqCst);
            if let Some(delay) = self.queue.lock_error_after {
                tokio::time::sleep(delay).await;
                return Err(Error::Message("nats lock acquire timeout".to_string()));
            }
            let guard = match &self.queue.lock {
                Some(lock) => Some(lock.clone().lock_owned().await),
                None => None,
            };
            if let Some(other) = self.queue.on_lock.lock().unwrap().take() {
                self.queue.rows.lock().unwrap().push(other);
            }
            Ok(guard)
        }

        async fn unlock(&self, lock: Self::Lock) -> Result<()> {
            drop(lock);
            let failures = &self.queue.unlock_failures;
            if failures.load(Ordering::SeqCst) > 0 {
                failures.fetch_sub(1, Ordering::SeqCst);
                return Err(Error::Message("nats unlock failed".to_string()));
            }
            Ok(())
        }

        async fn need_wait(&self) -> Result<(bool, ConcurrencyStatus)> {
            let rows = match self.queue.replica.lock().unwrap().clone() {
                Some(stale) => stale,
                None => self.queue.rows.lock().unwrap().clone(),
            };
            let n = |f: &dyn Fn(&Row) -> bool| rows.iter().filter(|r| f(r)).count();
            let me = &self.me;
            let typed = |r: &Row| me.search_type.is_some() && r.search_type == me.search_type;
            let counts = QueueCounts {
                global: rows.len(),
                org: n(&|r| r.org == me.org),
                user: n(&|r| r.org == me.org && r.user == me.user),
                type_global: n(&|r| typed(r)),
                type_org: n(&|r| typed(r) && r.org == me.org),
            };
            // A concurrent admission can run between this count and the insert.
            tokio::task::yield_now().await;
            Ok(WorkGroup::Short.wait_status(
                &get_o2_config().work_group,
                Some(&me.org),
                Some(&me.user),
                me.search_type,
                counts,
            ))
        }

        async fn process(&self) -> Result<()> {
            self.queue.rows.lock().unwrap().push(self.me.clone());
            if let Some(abort) = self.queue.on_process.lock().unwrap().take() {
                abort.send(()).unwrap();
            }
            Ok(())
        }

        async fn done(&self) -> Result<()> {
            self.queue.remove(&self.me.trace);
            Ok(())
        }
    }

    async fn run(
        queue: &Arc<Queue>,
        org: &str,
        trace: &str,
        timeout: u64,
        abort: oneshot::Receiver<()>,
    ) -> Result<()> {
        let fake = Fake {
            queue: queue.clone(),
            me: row(org, PUBLIC, trace),
        };
        let watch = TookWatcher::new();
        admit(&fake, trace, org, &watch, timeout, abort, "test").await
    }

    fn spawn(queue: &Arc<Queue>, org: &str, trace: &str) -> tokio::task::JoinHandle<Result<()>> {
        let (queue, org, trace) = (queue.clone(), org.to_string(), trace.to_string());
        let (abort, rx) = oneshot::channel();
        tokio::spawn(async move {
            let _abort = abort;
            run(&queue, &org, &trace, 10, rx).await
        })
    }

    fn timeouts(org: &str) -> u64 {
        metrics::QUERY_TIMEOUT_NUMS.with_label_values(&[org]).get()
    }

    #[tokio::test]
    async fn waiting_polls_without_the_admission_lock() {
        let queue = Queue::new(true);
        queue.push("w1", PUBLIC, "a");
        queue.push("w1", PUBLIC, "b");
        let waiter = spawn(&queue, "w1", "me");
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(!waiter.is_finished(), "the per-org public cap of 2 is full");
        assert_eq!(queue.lock_calls.load(Ordering::SeqCst), 0);
        assert!(queue.lock.as_ref().unwrap().try_lock().is_ok());

        queue.remove("a");
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(queue.lock_calls.load(Ordering::SeqCst), 1);
        assert_eq!(queue.traces("me"), 1);
        assert!(queue.lock.as_ref().unwrap().try_lock().is_ok());
    }

    #[tokio::test]
    async fn the_recheck_under_the_lock_refuses_a_slot_taken_meanwhile() {
        let queue = Queue::new(true);
        queue.push("w2", PUBLIC, "a");
        *queue.on_lock.lock().unwrap() = Some(row("w2", PUBLIC, "other"));
        let waiter = spawn(&queue, "w2", "me");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!waiter.is_finished());
        assert_eq!(queue.traces("me"), 0);
        assert_eq!(queue.lock_calls.load(Ordering::SeqCst), 1);

        queue.remove("other");
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(queue.traces("me"), 1);
        assert_eq!(queue.lock_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_cancel_during_an_admitting_attempt_releases_the_slot() {
        let queue = Queue::new(true);
        let (abort, rx) = oneshot::channel();
        *queue.on_process.lock().unwrap() = Some(abort);
        let err = run(&queue, "w3", "me", 10, rx).await.unwrap_err();
        assert!(
            err.to_string().contains("waiting in queue was canceled"),
            "{err}"
        );
        assert_eq!(queue.len(), 0, "done() removed the inserted row");
        assert!(queue.lock.as_ref().unwrap().try_lock().is_ok());
    }

    #[tokio::test]
    async fn a_cancel_while_waiting_ends_the_wait() {
        let queue = Queue::new(true);
        queue.push("w4", PUBLIC, "a");
        queue.push("w4", PUBLIC, "b");
        let (abort, rx) = oneshot::channel();
        let q = queue.clone();
        let waiter = tokio::spawn(async move { run(&q, "w4", "me", 10, rx).await });
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
        assert_eq!(queue.traces("me"), 0);
    }

    #[tokio::test]
    async fn an_unlock_failure_after_admitting_releases_the_slot() {
        let queue = Queue::new(true);
        queue.unlock_failures.store(1, Ordering::SeqCst);
        let (_abort, rx) = oneshot::channel();
        let err = run(&queue, "w5", "me", 10, rx).await.unwrap_err();
        assert!(err.to_string().contains("nats unlock failed"), "{err}");
        assert_eq!(queue.len(), 0, "done() removed the inserted row");
    }

    #[tokio::test]
    async fn an_unlock_failure_after_a_refused_attempt_keeps_waiting() {
        let queue = Queue::new(true);
        queue.push("w6", PUBLIC, "a");
        *queue.on_lock.lock().unwrap() = Some(row("w6", PUBLIC, "other"));
        queue.unlock_failures.store(1, Ordering::SeqCst);
        let waiter = spawn(&queue, "w6", "me");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!waiter.is_finished());
        queue.remove("other");
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(queue.traces("me"), 1);
    }

    #[tokio::test]
    async fn a_full_queue_times_out_with_the_queue_timeout_metric() {
        for (queue_enabled, org) in [(true, "w7-on"), (false, "w7-off")] {
            let queue = Queue::new(queue_enabled);
            queue.push(org, PUBLIC, "a");
            queue.push(org, PUBLIC, "b");
            let before = timeouts(org);
            let started = std::time::Instant::now();
            let (_abort, rx) = oneshot::channel();
            let err = run(&queue, org, "me", 1, rx).await.unwrap_err();
            assert!(
                err.to_string().contains("request timeout in queue"),
                "{err}"
            );
            assert!(started.elapsed() >= Duration::from_secs(1));
            assert_eq!(timeouts(org), before + 1);
            assert_eq!(queue.lock_calls.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn a_lock_wait_that_runs_past_the_deadline_is_a_queue_timeout() {
        let queue = Arc::new(Queue {
            lock: Some(Arc::new(AsyncMutex::new(()))),
            lock_error_after: Some(Duration::from_millis(1100)),
            ..Default::default()
        });
        let before = timeouts("w8");
        let (_abort, rx) = oneshot::channel();
        let err = run(&queue, "w8", "me", 1, rx).await.unwrap_err();
        assert!(
            err.to_string().contains("request timeout in queue"),
            "{err}"
        );
        assert_eq!(timeouts("w8"), before + 1);
        assert_eq!(queue.len(), 0);
    }

    /// Two public searches race for the last of 4 global slots: best effort, never exact.
    #[tokio::test]
    async fn the_type_cap_is_best_effort_with_the_queue_on_and_off() {
        for (queue_enabled, stale_reads, admitted) in
            [(false, false, 5), (true, false, 4), (true, true, 5)]
        {
            let queue = Queue::new(queue_enabled);
            for org in ["x1", "x2", "x3"] {
                queue.push(org, PUBLIC, org);
            }
            if stale_reads {
                queue.freeze_reads();
            }
            let (_a, rx_a) = oneshot::channel();
            let (_b, rx_b) = oneshot::channel();
            let _ = futures::future::join(
                run(&queue, "y1", "y1", 1, rx_a),
                run(&queue, "y2", "y2", 1, rx_b),
            )
            .await;
            assert_eq!(
                queue.len(),
                admitted,
                "queue_enabled={queue_enabled} stale_reads={stale_reads}"
            );
        }
    }
}
