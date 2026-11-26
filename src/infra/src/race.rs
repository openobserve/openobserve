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

//! Named barrier points for race tests; outside `test` / `test-utils` builds they expand to
//! nothing.

#[cfg(any(test, feature = "test-utils"))]
use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};

#[cfg(any(test, feature = "test-utils"))]
use tokio::sync::watch;

/// `race_point!("name");` holds a task inside [`crate::race::Barriers::run`] until its parties
/// meet.
#[cfg(any(test, feature = "test-utils"))]
#[macro_export]
macro_rules! race_point {
    ($name:expr) => {
        $crate::race::point($name).await
    };
}

/// `race_point!("name");` expands to `()`, so normal and release builds carry no barrier code.
#[cfg(not(any(test, feature = "test-utils")))]
#[macro_export]
macro_rules! race_point {
    ($name:expr) => {
        ()
    };
}

// Above the 30 s default meta-store pool acquire timeout, so a queued `begin` is not read as a
// miss.
#[cfg(any(test, feature = "test-utils"))]
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

#[cfg(any(test, feature = "test-utils"))]
tokio::task_local! {
    static SCOPE: Barriers;
}

/// The points armed for one race; only tasks inside [`Barriers::run`] stop at them.
/// Timeouts use `tokio::time`, so do not arm points under a paused clock.
#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone)]
pub struct Barriers {
    points: Arc<Mutex<HashMap<&'static str, Arc<Point>>>>,
    timeout: Duration,
}

#[cfg(any(test, feature = "test-utils"))]
impl Barriers {
    pub fn new() -> Self {
        Self {
            points: Arc::default(),
            timeout: DEFAULT_TIMEOUT,
        }
    }

    /// How long a party waits for the others before the test panics instead of hanging.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Arms `name` to release once `parties` arrivals meet; later arrivals pass straight through.
    pub fn arm(&self, name: &'static str, parties: usize) -> &Self {
        assert!(parties > 0, "race point `{name}` needs at least one party");
        let point = Arc::new(Point {
            parties,
            state: watch::Sender::new(PointState::default()),
        });
        let previous = self.points.lock().unwrap().insert(name, point);
        assert!(previous.is_none(), "race point `{name}` is armed twice");
        self
    }

    /// Runs `fut` inside this race; a task `tokio::spawn`ed from it is outside the race
    /// (task-locals are not inherited) and passes every point unheld.
    pub async fn run<F: Future>(&self, fut: F) -> F::Output {
        SCOPE.scope(self.clone(), fut).await
    }

    /// The calling task joins `name` as one party, from inside or outside [`Barriers::run`].
    pub async fn wait(&self, name: &'static str) {
        let point = self
            .get(name)
            .unwrap_or_else(|| panic!("race point `{name}` is not armed"));
        point.meet(name, self.timeout).await;
    }

    /// How many parties are at or past `name`; 0 for a point that is not armed.
    pub fn arrived(&self, name: &'static str) -> usize {
        self.get(name)
            .map_or(0, |point| point.state.borrow().arrived)
    }

    /// Panics unless every armed point met all its parties, so a race that never raced fails.
    pub fn assert_all_met(&self) {
        let points = self.points.lock().unwrap();
        let mut unmet: Vec<String> = points
            .iter()
            .filter_map(|(name, point)| {
                let state = *point.state.borrow();
                (state.failed || state.arrived < point.parties)
                    .then(|| format!("`{name}` {} of {}", state.arrived, point.parties))
            })
            .collect();
        unmet.sort();
        assert!(
            unmet.is_empty(),
            "race points not met: {}",
            unmet.join(", ")
        );
    }

    fn get(&self, name: &'static str) -> Option<Arc<Point>> {
        self.points.lock().unwrap().get(name).cloned()
    }
}

#[cfg(any(test, feature = "test-utils"))]
impl Default for Barriers {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(any(test, feature = "test-utils"))]
struct Point {
    parties: usize,
    state: watch::Sender<PointState>,
}

#[cfg(any(test, feature = "test-utils"))]
impl Point {
    async fn meet(&self, name: &'static str, timeout: Duration) {
        let parties = self.parties;
        let mut failed = false;
        self.state.send_modify(|state| {
            failed = state.failed;
            if !failed {
                state.arrived += 1;
            }
        });
        assert!(
            !failed,
            "race point `{name}` already timed out or lost a party"
        );
        let arrival = Arrival {
            point: self,
            waiting: true,
        };
        let mut rx = self.state.subscribe();
        let met = tokio::time::timeout(timeout, async {
            rx.wait_for(|state| state.failed || state.arrived >= parties)
                .await
                .map(|state| !state.failed)
        })
        .await;
        match met {
            Ok(Ok(true)) => return arrival.settle(),
            Ok(_) => {
                arrival.settle();
                panic!("race point `{name}` failed: another party timed out or left")
            }
            Err(_) => {}
        }
        let (arrived, met_late) = arrival.withdraw();
        if !met_late {
            panic!(
                "race point `{name}`: {arrived} of {parties} parties arrived within {timeout:?}"
            );
        }
    }
}

/// One party's arrival while it waits; dropping the wait (abort, `select!`, `timeout`) before
/// the point meets withdraws it and fails the point, so no later arrival passes unheld.
#[cfg(any(test, feature = "test-utils"))]
struct Arrival<'a> {
    point: &'a Point,
    waiting: bool,
}

#[cfg(any(test, feature = "test-utils"))]
impl Arrival<'_> {
    /// The point met, or another party already failed it: nothing to withdraw.
    fn settle(mut self) {
        self.waiting = false;
    }

    /// `(arrived, met)`: a point that met in the meantime keeps this arrival.
    fn withdraw(mut self) -> (usize, bool) {
        self.waiting = false;
        self.withdraw_now()
    }

    fn withdraw_now(&self) -> (usize, bool) {
        let parties = self.point.parties;
        let mut arrived = 0;
        let mut met = false;
        self.point.state.send_modify(|state| {
            arrived = state.arrived;
            met = !state.failed && state.arrived >= parties;
            if !met && !state.failed {
                state.arrived -= 1;
                state.failed = true;
            }
        });
        (arrived, met)
    }
}

#[cfg(any(test, feature = "test-utils"))]
impl Drop for Arrival<'_> {
    fn drop(&mut self) {
        if self.waiting {
            self.withdraw_now();
        }
    }
}

/// A timed-out point stays failed, so a later arrival panics instead of passing unheld.
#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Copy, Default)]
struct PointState {
    arrived: usize,
    failed: bool,
}

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Order {
    AThenB,
    BThenA,
}

/// One serial run's outputs, `a` and `b` in their own fields whichever ran first.
#[cfg(any(test, feature = "test-utils"))]
#[derive(Debug)]
pub struct SerialRun<RA, RB> {
    pub order: Order,
    pub a: RA,
    pub b: RB,
}

/// The hook table code calls through `race_point!`; a no-op outside a race or for an unarmed name.
#[cfg(any(test, feature = "test-utils"))]
pub async fn point(name: &'static str) {
    let Ok((Some(point), timeout)) = SCOPE.try_with(|race| (race.get(name), race.timeout)) else {
        return;
    };
    point.meet(name, timeout).await;
}

/// Each future must be one transaction on SQLite's write client for the two orders to cover
/// every outcome, because SQLite runs only one write transaction at a time.
#[cfg(any(test, feature = "test-utils"))]
pub async fn in_both_orders<S, SF, FA, FB>(mut setup: S) -> [SerialRun<FA::Output, FB::Output>; 2]
where
    S: FnMut(Order) -> SF,
    SF: Future<Output = (FA, FB)>,
    FA: Future,
    FB: Future,
{
    let (fa, fb) = setup(Order::AThenB).await;
    let a = fa.await;
    let b = fb.await;
    let a_then_b = SerialRun {
        order: Order::AThenB,
        a,
        b,
    };
    let (fa, fb) = setup(Order::BThenA).await;
    let b = fb.await;
    let a = fa.await;
    let b_then_a = SerialRun {
        order: Order::BThenA,
        a,
        b,
    };
    [a_then_b, b_then_a]
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    use config::meta::meta_store::MetaStore;
    use sea_orm::TransactionTrait;

    use super::*;
    use crate::table::{kv_store, testing};

    fn log() -> Arc<Mutex<Vec<&'static str>>> {
        Arc::new(Mutex::new(Vec::new()))
    }

    #[tokio::test]
    async fn test_two_tasks_meet_at_a_named_point() {
        let race = Barriers::new();
        race.arm("meet", 2);
        let events = log();
        let task = |before: &'static str, after: &'static str| {
            let (race, events) = (race.clone(), events.clone());
            tokio::spawn(async move {
                race.run(async {
                    events.lock().unwrap().push(before);
                    race_point!("meet");
                    events.lock().unwrap().push(after);
                })
                .await
            })
        };
        let (a, b) = (task("a before", "a after"), task("b before", "b after"));
        a.await.unwrap();
        b.await.unwrap();

        let events = events.lock().unwrap();
        let mut first_two = events[..2].to_vec();
        first_two.sort();
        assert_eq!(first_two, ["a before", "b before"]);
        assert_eq!(race.arrived("meet"), 2);
        race.assert_all_met();
    }

    #[tokio::test]
    async fn test_a_point_holds_a_task_until_every_party_arrives() {
        let race = Barriers::new();
        race.arm("held", 2);
        let passed = Arc::new(AtomicBool::new(false));
        let task = {
            let (race, passed) = (race.clone(), passed.clone());
            tokio::spawn(async move {
                race.run(async {
                    race_point!("held");
                    passed.store(true, Ordering::SeqCst);
                })
                .await
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(race.arrived("held"), 1);
        assert!(!passed.load(Ordering::SeqCst));

        race.wait("held").await;
        task.await.unwrap();
        assert!(passed.load(Ordering::SeqCst));
        race.assert_all_met();
    }

    #[tokio::test]
    async fn test_a_point_is_a_no_op_outside_a_race_or_when_not_armed() {
        let race = Barriers::new().with_timeout(Duration::from_millis(50));
        race.arm("armed", 2);
        race_point!("armed");
        race.run(async { race_point!("not armed") }).await;
        assert_eq!(race.arrived("armed"), 0);
        assert_eq!(race.arrived("not armed"), 0);
    }

    #[tokio::test]
    #[should_panic(expected = "race point `alone`: 1 of 2 parties arrived")]
    async fn test_a_point_whose_parties_never_meet_panics_instead_of_hanging() {
        let race = Barriers::new().with_timeout(Duration::from_millis(50));
        race.arm("alone", 2);
        race.run(async { race_point!("alone") }).await;
    }

    #[test]
    #[should_panic(expected = "race points not met: `missed` 0 of 2")]
    fn test_assert_all_met_panics_when_an_armed_point_is_never_reached() {
        let race = Barriers::new();
        race.arm("missed", 2).arm("met", 1);
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(race.run(async { race_point!("met") }));
        race.assert_all_met();
    }

    #[tokio::test]
    async fn test_a_late_arrival_after_a_timeout_panics_instead_of_passing() {
        let race = Barriers::new().with_timeout(Duration::from_millis(50));
        race.arm("late", 2);
        let arrive = || {
            let race = race.clone();
            tokio::spawn(async move { race.run(async { race_point!("late") }).await })
        };
        let first = arrive().await.unwrap_err().into_panic();
        assert!(
            first
                .downcast_ref::<String>()
                .unwrap()
                .contains("1 of 2 parties arrived")
        );
        assert_eq!(race.arrived("late"), 0);

        let late = arrive().await.unwrap_err().into_panic();
        assert!(
            late.downcast_ref::<String>()
                .unwrap()
                .contains("already timed out")
        );
        assert_eq!(race.arrived("late"), 0);
    }

    #[tokio::test]
    async fn test_a_dropped_arrival_is_withdrawn_and_fails_the_point() {
        let race = Barriers::new();
        race.arm("dropped", 2);
        let abandoned = tokio::time::timeout(
            Duration::from_millis(50),
            race.run(async { race_point!("dropped") }),
        )
        .await;
        assert!(abandoned.is_err(), "the lone party must still be waiting");
        assert_eq!(race.arrived("dropped"), 0);

        let late = {
            let race = race.clone();
            tokio::spawn(async move { race.run(async { race_point!("dropped") }).await })
        }
        .await
        .unwrap_err()
        .into_panic();
        assert!(
            late.downcast_ref::<String>()
                .unwrap()
                .contains("lost a party")
        );
        let unmet =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| race.assert_all_met()))
                .unwrap_err();
        assert!(
            unmet
                .downcast_ref::<String>()
                .unwrap()
                .contains("`dropped` 0 of 2")
        );
    }

    #[tokio::test]
    async fn test_in_both_orders_runs_each_order_on_a_fresh_setup() {
        let setups = AtomicUsize::new(0);
        let runs = in_both_orders(|order| {
            setups.fetch_add(1, Ordering::SeqCst);
            let events = log();
            async move {
                let (ea, eb) = (events.clone(), events.clone());
                let a = async move {
                    ea.lock().unwrap().push("a");
                    (order, ea.lock().unwrap().clone())
                };
                let b = async move {
                    eb.lock().unwrap().push("b");
                    eb.lock().unwrap().clone()
                };
                (a, b)
            }
        })
        .await;

        assert_eq!(setups.load(Ordering::SeqCst), 2);
        let [a_then_b, b_then_a] = runs;
        assert_eq!(a_then_b.order, Order::AThenB);
        assert_eq!(a_then_b.a, (Order::AThenB, vec!["a"]));
        assert_eq!(a_then_b.b, vec!["a", "b"]);
        assert_eq!(b_then_a.order, Order::BThenA);
        assert_eq!(b_then_a.a, (Order::BThenA, vec!["b", "a"]));
        assert_eq!(b_then_a.b, vec!["b"]);
    }

    async fn claim_in_a_transaction(org: String, value: &'static [u8]) -> bool {
        let txn = crate::db::get_orm_client_rw().await.begin().await.unwrap();
        race_point!("claim.before_write");
        let won = kv_store::compare_and_set_in(&txn, &org, "claim", None, value)
            .await
            .unwrap();
        txn.commit().await.unwrap();
        won
    }

    #[tokio::test]
    async fn test_in_both_orders_on_the_meta_store_lets_the_first_transaction_win() {
        if !testing::meta_store().await {
            return;
        }
        let runs = in_both_orders(|order| async move {
            let org = testing::unique(&format!("t_race_{order:?}"));
            (
                claim_in_a_transaction(org.clone(), b"a"),
                claim_in_a_transaction(org, b"b"),
            )
        })
        .await;
        let [a_then_b, b_then_a] = runs;
        assert!(a_then_b.a && !a_then_b.b);
        assert!(!b_then_a.a && b_then_a.b);
    }

    #[tokio::test]
    async fn test_two_open_postgres_transactions_meet_and_exactly_one_wins() {
        let store: MetaStore = config::get_config().common.meta_store.as_str().into();
        if !testing::meta_store().await || !matches!(store, MetaStore::PostgreSQL) {
            return;
        }
        let org = testing::unique("t_race_pg");
        let race = Barriers::new();
        race.arm("claim.before_write", 2);
        let task = |value: &'static [u8]| {
            let (race, org) = (race.clone(), org.clone());
            tokio::spawn(async move { race.run(claim_in_a_transaction(org, value)).await })
        };
        let (a, b) = (task(b"a"), task(b"b"));
        let (a, b) = (a.await.unwrap(), b.await.unwrap());

        race.assert_all_met();
        assert!(a ^ b, "exactly one transaction claims the row: a={a} b={b}");
    }
}
