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

//! Process-local single flight per result key, build permits and the child-search join (5.3).

use std::{
    future::Future,
    panic::AssertUnwindSafe,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
    time::Duration,
};

use config::{
    get_config,
    meta::public_dashboards::{NotReadyResponse, ResultBody},
    metrics,
    utils::time::now_micros,
};
use dashmap::{DashMap, mapref::entry::Entry};
use futures::{
    FutureExt,
    future::{BoxFuture, Shared},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, oneshot};

use super::store::Header;

/// The flights of this querier, sized from the config.
pub static FLIGHTS: LazyLock<Flights> = LazyLock::new(|| {
    let cfg = &get_config().public_dashboards;
    Flights::new(cfg.max_inflight_builds, cfg.max_inflight_builds_per_org)
});

static NEXT_FLIGHT_ID: AtomicU64 = AtomicU64::new(1);

/// What a flight runs for its key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Build,
    AuthCheck,
}

/// A flight's result as every waiter receives it.
#[derive(Clone, Debug)]
pub struct Built {
    pub header: Header,
    pub body: Option<Arc<ResultBody>>,
    /// False when the file could not be written; the result is served once and not cached.
    pub stored: bool,
}

/// Why a flight produced nothing to serve.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    Panic,
    /// The authorization service or the membership read failed; serve nothing.
    Unavailable,
    /// Paused, expired, revoked, departed publisher or range removed: the file is gone.
    NotServable,
}

pub type Outcome = Result<Built, Failure>;

/// One flight in progress; followers subscribe to its shared result.
pub struct Flight {
    id: u64,
    pub kind: Kind,
    pub started_at: i64,
    result: Shared<BoxFuture<'static, Outcome>>,
    waiters: AtomicU32,
    estimate_secs: AtomicU64,
    progress_milli: AtomicU32,
}

impl Flight {
    /// Publishes the build's estimate from the search partition call.
    pub fn set_estimate(&self, secs: u64) {
        self.estimate_secs.store(secs, Ordering::Relaxed);
    }

    pub fn set_progress(&self, done: usize, total: usize) {
        let milli = (done * 1000).checked_div(total).unwrap_or(0);
        self.progress_milli
            .store(u32::try_from(milli).unwrap_or(1000), Ordering::Relaxed);
    }

    /// Seconds the build is still expected to run, from its published estimate.
    pub fn remaining_secs(&self, now: i64) -> u64 {
        let elapsed = u64::try_from((now - self.started_at) / 1_000_000).unwrap_or(0);
        self.estimate_secs
            .load(Ordering::Relaxed)
            .saturating_sub(elapsed)
    }

    /// The 202 body for a reader that is not waiting on this flight.
    pub fn building(&self, now: i64) -> NotReadyResponse {
        NotReadyResponse::Building {
            started_at: self.started_at,
            estimated_secs: self.remaining_secs(now),
            progress: f64::from(self.progress_milli.load(Ordering::Relaxed)) / 1000.0,
        }
    }

    /// Waits up to `timeout` unless `max_waiters` already wait; leaving never cancels the task.
    pub async fn wait(&self, timeout: Duration, max_waiters: u32) -> Wait {
        if self.waiters.fetch_add(1, Ordering::SeqCst) >= max_waiters {
            self.waiters.fetch_sub(1, Ordering::SeqCst);
            return Wait::Full;
        }
        let _waiter = WaiterGuard(&self.waiters);
        match tokio::time::timeout(timeout, self.result.clone()).await {
            Ok(outcome) => Wait::Done(Box::new(outcome)),
            Err(_) => Wait::TimedOut,
        }
    }
}

/// How a subscription to a flight ended.
#[derive(Debug)]
pub enum Wait {
    Done(Box<Outcome>),
    TimedOut,
    Full,
}

/// How a request met the key's flight.
pub enum Start {
    /// This request installed the flight; its task is already spawned.
    Leader(Arc<Flight>),
    Follower(Arc<Flight>),
    /// No permit; nothing was installed.
    Capacity,
}

/// The map of live flights and the build permits of one querier.
pub struct Flights {
    map: DashMap<String, Arc<Flight>>,
    permits: Arc<Semaphore>,
    org_inflight: Arc<DashMap<String, u32>>,
    max_per_org: u32,
}

impl Flights {
    pub fn new(max_builds: u32, max_per_org: u32) -> Self {
        Self {
            map: DashMap::new(),
            permits: Arc::new(Semaphore::new(max_builds.max(1) as usize)),
            org_inflight: Arc::new(DashMap::new()),
            max_per_org: max_per_org.max(1),
        }
    }

    /// The live flight of `key`, if any.
    pub fn get(&self, key: &str) -> Option<Arc<Flight>> {
        self.map.get(key).map(|f| f.clone())
    }

    /// Joins the key's flight or installs one, permits first, before any work (design 5.3).
    pub fn start<F, Fut>(&'static self, key: &str, org: &str, kind: Kind, run: F) -> Start
    where
        F: FnOnce(Arc<Flight>) -> Fut + Send + 'static,
        Fut: Future<Output = Outcome> + Send + 'static,
    {
        let vacant = match self.map.entry(key.to_string()) {
            Entry::Occupied(e) => return Start::Follower(e.get().clone()),
            Entry::Vacant(v) => v,
        };
        let permits = match kind {
            Kind::Build => match self.acquire(org) {
                Some(p) => Some(p),
                None => return Start::Capacity,
            },
            // The authorization deadline holds regardless of build capacity.
            Kind::AuthCheck => None,
        };
        let id = NEXT_FLIGHT_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel::<Outcome>();
        let flight = Arc::new(Flight {
            id,
            kind,
            started_at: now_micros(),
            result: rx
                .map(|r| r.unwrap_or(Err(Failure::Panic)))
                .boxed()
                .shared(),
            waiters: AtomicU32::new(0),
            estimate_secs: AtomicU64::new(0),
            progress_milli: AtomicU32::new(0),
        });
        drop(vacant.insert(flight.clone()));
        let key = key.to_string();
        let task_flight = flight.clone();
        tokio::spawn(async move {
            let out = AssertUnwindSafe(run(task_flight))
                .catch_unwind()
                .await
                .unwrap_or_else(|_| {
                    log::error!("public dashboard flight for {key} panicked");
                    Err(Failure::Panic)
                });
            self.map.remove_if(&key, |_, f| f.id == id);
            drop(permits);
            let _ = tx.send(out);
        });
        Start::Leader(flight)
    }

    fn acquire(&self, org: &str) -> Option<Permits> {
        let permit = self.permits.clone().try_acquire_owned().ok()?;
        let mut slots = self.org_inflight.entry(org.to_string()).or_insert(0);
        if *slots >= self.max_per_org {
            return None;
        }
        *slots += 1;
        drop(slots);
        metrics::PUBLIC_DASHBOARD_INFLIGHT_BUILDS.inc();
        Some(Permits {
            _permit: permit,
            org: org.to_string(),
            org_inflight: self.org_inflight.clone(),
        })
    }

    #[cfg(test)]
    pub fn available_permits(&self) -> usize {
        self.permits.available_permits()
    }

    #[cfg(test)]
    pub fn in_flight(&self) -> usize {
        self.map.len()
    }
}

/// A build's semaphore permit and org slot; both go back when the task ends.
struct Permits {
    _permit: OwnedSemaphorePermit,
    org: String,
    org_inflight: Arc<DashMap<String, u32>>,
}

impl Drop for Permits {
    fn drop(&mut self) {
        if let Entry::Occupied(mut slots) = self.org_inflight.entry(self.org.clone()) {
            *slots.get_mut() = slots.get().saturating_sub(1);
            if *slots.get() == 0 {
                slots.remove();
            }
        }
        metrics::PUBLIC_DASHBOARD_INFLIGHT_BUILDS.dec();
    }
}

struct WaiterGuard<'a>(&'a AtomicU32);

impl Drop for WaiterGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// One build's trace ids: children are `{prefix}-{n}`, so one prefix abort reaches every search.
pub struct TraceFamily {
    org_id: String,
    prefix: String,
    next: AtomicU32,
    cancelled: AtomicBool,
}

impl TraceFamily {
    /// A family whose children run in `org_id`, the org the abort is scoped to.
    pub fn new(org_id: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            prefix: config::ider::generate_trace_id(),
            next: AtomicU32::new(0),
            cancelled: AtomicBool::new(false),
        }
    }

    /// The build id every child trace id starts with.
    pub fn id(&self) -> &str {
        &self.prefix
    }

    pub fn child(&self) -> String {
        format!(
            "{}-{}",
            self.prefix,
            self.next.fetch_add(1, Ordering::Relaxed)
        )
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Stops new children and aborts every running one.
    pub async fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        // The prefix itself is never registered, so only the children are aborted.
        search_service::abort_trace_family(&self.org_id, &self.prefix).await;
    }
}

/// Runs `fut` to its end, cancelling the family at `deadline`, so no child outlives the permit.
pub async fn drain_by<F: Future>(
    family: &TraceFamily,
    deadline: tokio::time::Instant,
    fut: F,
) -> F::Output {
    tokio::pin!(fut);
    tokio::select! {
        out = &mut fut => return out,
        _ = tokio::time::sleep_until(deadline) => {}
    }
    family.cancel().await;
    fut.await
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    fn flights(max: u32, per_org: u32) -> &'static Flights {
        Box::leak(Box::new(Flights::new(max, per_org)))
    }

    fn built() -> Outcome {
        Ok(Built {
            header: Header::default(),
            body: None,
            stored: true,
        })
    }

    async fn outcome(flight: &Flight) -> Outcome {
        match flight.wait(Duration::from_secs(5), u32::MAX).await {
            Wait::Done(out) => *out,
            other => panic!("no outcome: {other:?}"),
        }
    }

    #[tokio::test]
    async fn gate01_instant_completion_leaves_no_placeholder() {
        let flights = flights(2, 1);
        let Start::Leader(f) = flights.start("k", "o", Kind::Build, |_| async { built() }) else {
            panic!("the first reader leads");
        };
        assert!(outcome(&f).await.is_ok());
        assert_eq!(flights.in_flight(), 0);
        assert_eq!(flights.available_permits(), 2);
        assert!(flights.org_inflight.is_empty());
    }

    #[tokio::test]
    async fn gate01_a_panic_leaves_no_placeholder_and_frees_the_permits() {
        let flights = flights(1, 1);
        let Start::Leader(f) = flights.start("k", "o", Kind::Build, |_| async {
            panic!("boom");
        }) else {
            panic!("the first reader leads");
        };
        assert_eq!(outcome(&f).await.unwrap_err(), Failure::Panic);
        assert_eq!(flights.in_flight(), 0);
        assert_eq!(flights.available_permits(), 1);
        assert!(matches!(
            flights.start("k", "o", Kind::Build, |_| async { built() }),
            Start::Leader(_)
        ));
    }

    #[tokio::test]
    async fn gate01_a_write_failure_still_reaches_waiters_and_leaves_no_placeholder() {
        let flights = flights(1, 1);
        let Start::Leader(f) = flights.start("k", "o", Kind::Build, |_| async {
            Ok(Built {
                header: Header::default(),
                body: Some(Arc::new(ResultBody::default())),
                stored: false,
            })
        }) else {
            panic!("the first reader leads");
        };
        let out = outcome(&f).await.unwrap();
        assert!(!out.stored && out.body.is_some());
        assert_eq!(flights.in_flight(), 0);
    }

    #[tokio::test]
    async fn gate01_a_capacity_failure_installs_nothing() {
        let flights = flights(1, 1);
        let (tx, rx) = oneshot::channel::<()>();
        let Start::Leader(slow) = flights.start("a", "o", Kind::Build, |_| async move {
            let _ = rx.await;
            built()
        }) else {
            panic!("the first reader leads");
        };
        assert!(matches!(
            flights.start("b", "o", Kind::Build, |_| async { built() }),
            Start::Capacity
        ));
        assert!(matches!(
            flights.start("c", "other", Kind::Build, |_| async { built() }),
            Start::Capacity
        ));
        assert!(flights.get("b").is_none() && flights.get("c").is_none());
        // The deadline check needs no build permit.
        let Start::Leader(check) = flights.start("b", "o", Kind::AuthCheck, |_| async { built() })
        else {
            panic!("the check leads its key");
        };
        assert!(outcome(&check).await.is_ok());
        tx.send(()).unwrap();
        assert!(outcome(&slow).await.is_ok());
        assert_eq!(flights.in_flight(), 0);
    }

    #[tokio::test]
    async fn gate01_the_per_org_slot_holds_one_org_while_another_builds() {
        let flights = flights(4, 1);
        let (tx, rx) = oneshot::channel::<()>();
        let Start::Leader(slow) = flights.start("a", "o1", Kind::Build, |_| async move {
            let _ = rx.await;
            built()
        }) else {
            panic!("the first reader leads");
        };
        assert!(matches!(
            flights.start("b", "o1", Kind::Build, |_| async { built() }),
            Start::Capacity
        ));
        let Start::Leader(other) = flights.start("c", "o2", Kind::Build, |_| async { built() })
        else {
            panic!("another org builds");
        };
        assert!(outcome(&other).await.is_ok());
        tx.send(()).unwrap();
        assert!(outcome(&slow).await.is_ok());
    }

    #[tokio::test]
    async fn gate01_a_finishing_obsolete_flight_cannot_remove_its_successor() {
        let flights = flights(4, 4);
        let (tx_old, rx_old) = oneshot::channel::<()>();
        let Start::Leader(old) = flights.start("k", "o", Kind::Build, |_| async move {
            let _ = rx_old.await;
            built()
        }) else {
            panic!("the first reader leads");
        };
        // The old entry is gone from the map while its task still runs; a successor installs.
        flights.map.remove("k");
        let (tx_new, rx_new) = oneshot::channel::<()>();
        let Start::Leader(new) = flights.start("k", "o", Kind::Build, |_| async move {
            let _ = rx_new.await;
            built()
        }) else {
            panic!("the successor leads");
        };
        tx_old.send(()).unwrap();
        assert!(outcome(&old).await.is_ok());
        assert!(
            flights.get("k").is_some_and(|f| f.id == new.id),
            "the obsolete flight removed only its own entry"
        );
        tx_new.send(()).unwrap();
        assert!(outcome(&new).await.is_ok());
        assert_eq!(flights.in_flight(), 0);
    }

    #[tokio::test]
    async fn gate01_a_disconnected_waiter_does_not_cancel_the_task() {
        let flights = flights(1, 1);
        let ran = Arc::new(AtomicBool::new(false));
        let done = ran.clone();
        let Start::Leader(f) = flights.start("k", "o", Kind::Build, |_| async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            done.store(true, Ordering::SeqCst);
            built()
        }) else {
            panic!("the first reader leads");
        };
        let waiter = {
            let f = f.clone();
            tokio::spawn(async move { f.wait(Duration::from_secs(5), 10).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        waiter.abort();
        assert!(outcome(&f).await.is_ok());
        assert!(ran.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn gate01_waiters_past_the_cap_get_full_and_a_bounded_wait_times_out() {
        let flights = flights(1, 1);
        let (tx, rx) = oneshot::channel::<()>();
        let Start::Leader(f) = flights.start("k", "o", Kind::Build, |_| async move {
            let _ = rx.await;
            built()
        }) else {
            panic!("the first reader leads");
        };
        let first = {
            let f = f.clone();
            tokio::spawn(async move { f.wait(Duration::from_secs(5), 1).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(matches!(
            f.wait(Duration::from_secs(5), 1).await,
            Wait::Full
        ));
        assert!(matches!(
            f.wait(Duration::from_millis(10), 5).await,
            Wait::TimedOut
        ));
        tx.send(()).unwrap();
        assert!(matches!(first.await.unwrap(), Wait::Done(out) if out.is_ok()));
        f.set_estimate(12);
        f.set_progress(2, 5);
        let NotReadyResponse::Building {
            estimated_secs,
            progress,
            ..
        } = f.building(f.started_at)
        else {
            panic!("a building body");
        };
        assert_eq!((estimated_secs, progress), (12, 0.4));
    }

    #[tokio::test]
    async fn gate09_a_build_timeout_cancels_the_family_and_drains_children_before_the_permit_goes()
    {
        let flights = flights(1, 1);
        let child_done = Arc::new(AtomicBool::new(false));
        let cancelled_seen = Arc::new(AtomicUsize::new(0));
        let (done, seen) = (child_done.clone(), cancelled_seen.clone());
        let Start::Leader(f) = flights.start("k", "o", Kind::Build, move |_| async move {
            let family = TraceFamily::new("o");
            let deadline = tokio::time::Instant::now() + Duration::from_millis(50);
            // A child that cannot be interrupted, as an OSS search without an abort channel.
            drain_by(&family, deadline, async {
                tokio::time::sleep(Duration::from_millis(200)).await;
                done.store(true, Ordering::SeqCst);
                if family.is_cancelled() {
                    seen.fetch_add(1, Ordering::SeqCst);
                }
            })
            .await;
            built()
        }) else {
            panic!("the first reader leads");
        };
        assert!(outcome(&f).await.is_ok());
        assert!(child_done.load(Ordering::SeqCst), "the child was drained");
        assert_eq!(cancelled_seen.load(Ordering::SeqCst), 1);
        assert_eq!(flights.available_permits(), 1);
        assert!(flights.org_inflight.is_empty());
    }

    #[test]
    fn gate09_child_trace_ids_share_the_build_prefix() {
        let family = TraceFamily::new("o");
        let (a, b) = (family.child(), family.child());
        assert_ne!(a, b);
        assert!(a.starts_with(family.id()) && b.starts_with(family.id()));
        // Deltas of a child extend its id, so the prefix abort reaches them too.
        assert!(format!("{a}-0").starts_with(family.id()));
    }
}
