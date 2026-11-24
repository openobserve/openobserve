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

use std::{
    cell::Cell,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

use config::metrics::authz as metrics;
#[cfg(feature = "test-utils")]
pub use o2_openfga::authorizer::accounting::with_budget;
pub use o2_openfga::authorizer::accounting::{CallCounts, CallOp, CallOutcome, REQUEST_CALLS};

tokio::task_local! {
    static ROLE_CHECK_SENT: Cell<bool>;
}

struct MergeIntoOuter {
    inner: Arc<CallCounts>,
    outer: Option<Arc<CallCounts>>,
}

impl Drop for MergeIntoOuter {
    fn drop(&mut self) {
        if let Some(outer) = &self.outer {
            outer.calls.fetch_add(self.inner.calls(), Ordering::Relaxed);
            outer
                .errors
                .fetch_add(self.inner.errors(), Ordering::Relaxed);
        }
    }
}

/// Counts one call in the request's `REQUEST_CALLS`, as ENT does for each request it sends.
pub fn record_call(outcome: CallOutcome) {
    let _ = REQUEST_CALLS.try_with(|counts| counts.count(outcome));
}

/// Sends every OpenFGA call ENT makes to the `zo_authz_openfga_*` metrics.
pub fn install_call_observer() {
    o2_openfga::authorizer::accounting::set_call_observer(observe_call);
}

/// Runs `fut` in a request scope and records its call count under `route`.
pub async fn count_request<F: Future>(route: &str, fut: F) -> F::Output {
    let counts = Arc::new(CallCounts::default());
    let output = REQUEST_CALLS.scope(counts.clone(), fut).await;
    finish_request(route, &counts);
    output
}

/// Runs `fut` in its own scope, adds its counts to the enclosing one, and returns its errors.
pub async fn in_own_scope<F: Future>(fut: F) -> (F::Output, u32) {
    let counts = Arc::new(CallCounts::default());
    let _merge = MergeIntoOuter {
        inner: counts.clone(),
        outer: REQUEST_CALLS.try_with(Arc::clone).ok(),
    };
    let output = REQUEST_CALLS.scope(counts.clone(), fut).await;
    (output, counts.errors())
}

pub(crate) async fn track_role_check<F: Future>(fut: F) -> (F::Output, bool) {
    ROLE_CHECK_SENT
        .scope(Cell::new(false), async {
            let output = fut.await;
            (output, ROLE_CHECK_SENT.with(Cell::get))
        })
        .await
}

fn finish_request(route: &str, counts: &CallCounts) {
    let calls = counts.calls();
    metrics::AUTHZ_OPENFGA_CALLS_PER_REQUEST
        .with_label_values(&[route])
        .observe(f64::from(calls));
    let budget = o2_openfga::config::get_config().check_budget_per_request;
    if calls > budget {
        log::warn!("[authz] {route} sent {calls} OpenFGA calls, over the budget of {budget}");
        metrics::AUTHZ_CHECK_BUDGET_EXCEEDED_TOTAL
            .with_label_values(&[route])
            .inc();
    }
}

fn observe_call(op: CallOp, outcome: CallOutcome, elapsed: Duration) {
    if op == CallOp::Role {
        let _ = ROLE_CHECK_SENT.try_with(|sent| sent.set(true));
    }
    metrics::AUTHZ_OPENFGA_REQUESTS_TOTAL
        .with_label_values(&[op.as_str(), outcome.as_str()])
        .inc();
    metrics::AUTHZ_OPENFGA_REQUEST_DURATION_SECONDS
        .with_label_values(&[op.as_str()])
        .observe(elapsed.as_secs_f64());
}

#[cfg(all(test, feature = "test-utils"))]
mod tests {
    use config::meta::stream::StreamType;
    use futures::{StreamExt, future::join_all};

    use super::*;
    use crate::authz::{FakeStreamChecker, StreamAccessChecker, TypedStream};

    fn stream(i: usize) -> TypedStream {
        TypedStream {
            org_id: "budget_org".to_string(),
            stream_type: StreamType::Logs,
            name: format!("s{i}"),
        }
    }

    async fn serial(fake: &FakeStreamChecker) {
        for i in 0..60 {
            fake.can_read_stream("u10@example.com", &stream(i)).await;
        }
    }

    async fn buffered(fake: &FakeStreamChecker) {
        futures::stream::iter(0..60)
            .map(|i| async move { fake.can_read_stream("u10@example.com", &stream(i)).await })
            .buffer_unordered(16)
            .collect::<Vec<_>>()
            .await;
    }

    async fn joined(fake: &FakeStreamChecker) {
        let streams: Vec<TypedStream> = (0..60).map(stream).collect();
        let checks = streams
            .iter()
            .map(|s| fake.can_read_stream("u10@example.com", s));
        join_all(checks).await;
    }

    #[tokio::test]
    #[should_panic(expected = "over the budget of 50")]
    async fn a_serial_loop_breaks_the_budget() {
        with_budget(50, serial(&FakeStreamChecker::default())).await;
    }

    #[tokio::test]
    #[should_panic(expected = "over the budget of 50")]
    async fn a_buffered_loop_breaks_the_budget() {
        with_budget(50, buffered(&FakeStreamChecker::default())).await;
    }

    #[tokio::test]
    #[should_panic(expected = "over the budget of 50")]
    async fn a_joined_loop_breaks_the_budget() {
        with_budget(50, joined(&FakeStreamChecker::default())).await;
    }

    #[tokio::test]
    async fn the_loops_do_not_panic_outside_a_budget() {
        let fake = FakeStreamChecker::default();
        serial(&fake).await;
        buffered(&fake).await;
        joined(&fake).await;
    }

    #[tokio::test]
    async fn a_request_scope_records_its_calls_under_the_route() {
        let route = "/api/{org_id}/u10_route";
        let histogram = || {
            metrics::AUTHZ_OPENFGA_CALLS_PER_REQUEST
                .with_label_values(&[route])
                .get_sample_sum()
        };
        let before = histogram();
        let fake = FakeStreamChecker::default();
        count_request(route, async {
            fake.can_read_stream("u10@example.com", &stream(0)).await;
            fake.can_read_stream("u10@example.com", &stream(1)).await;
        })
        .await;
        assert_eq!(histogram() - before, 2.0);
    }

    #[tokio::test]
    async fn an_inner_scope_reports_its_errors_and_adds_its_calls_to_the_request() {
        let outer = Arc::new(CallCounts::default());
        let (_, errors) = REQUEST_CALLS
            .scope(outer.clone(), async {
                record_call(CallOutcome::Allow);
                in_own_scope(async {
                    record_call(CallOutcome::Error);
                    record_call(CallOutcome::Deny);
                })
                .await
            })
            .await;
        assert_eq!(errors, 1);
        assert_eq!((outer.calls(), outer.errors()), (3, 1));
    }

    #[tokio::test]
    async fn role_check_tracking_is_scoped() {
        let (output, role_check_sent) = track_role_check(async {
            observe_call(CallOp::Role, CallOutcome::Error, Duration::ZERO);
            42
        })
        .await;
        assert_eq!(output, 42);
        assert!(role_check_sent);

        observe_call(CallOp::Role, CallOutcome::Allow, Duration::ZERO);
        let (_, role_check_sent) = track_role_check(async {
            observe_call(CallOp::Probe, CallOutcome::Deny, Duration::ZERO);
            observe_call(CallOp::List, CallOutcome::Allow, Duration::ZERO);
        })
        .await;
        assert!(!role_check_sent);
    }

    #[tokio::test]
    async fn a_cancelled_inner_scope_still_adds_its_sent_calls_to_the_request() {
        let outer = Arc::new(CallCounts::default());
        let result = REQUEST_CALLS
            .scope(outer.clone(), async {
                tokio::time::timeout(
                    Duration::from_millis(10),
                    in_own_scope(async {
                        record_call(CallOutcome::Allow);
                        record_call(CallOutcome::Error);
                        std::future::pending::<()>().await;
                    }),
                )
                .await
            })
            .await;
        assert!(result.is_err());
        assert_eq!((outer.calls(), outer.errors()), (2, 1));
    }
}
