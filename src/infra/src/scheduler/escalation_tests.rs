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

//! M138 (a) and OF-10 escalation arm and fenced finish cases, run against every scheduler backend.

use config::meta::triggers::{Trigger, TriggerStatus};

use super::EscalationFinish;
use crate::race::Barriers;

const NOW: i64 = 1_000_000_000_000;
const SEC: i64 = 1_000_000;

/// One backend's empty scheduler table and the escalation statements the cases need on it.
pub(super) trait EscalationDb: Sized + Send + Sync + 'static {
    /// A fresh, empty table, or `None` when the backend is not available here.
    async fn fresh_table() -> Option<Self>;
    /// The backend's escalation arm of the page at `at` with `data`.
    fn arm_at(&self, at: i64, data: &str) -> impl std::future::Future<Output = ()> + Send;
    /// The backend's fenced finish of `claim`.
    fn finish_at(
        &self,
        claim: &Trigger,
        next_run_at: Option<i64>,
    ) -> impl std::future::Future<Output = EscalationFinish> + Send;
    /// Claims due escalation rows at `now` the way the module's puller does.
    async fn claim_due(&self, now: i64) -> Vec<Trigger>;
    /// Forces the page's escalation row into `status` at `next_run_at`.
    async fn force(&self, status: TriggerStatus, next_run_at: i64);
    /// The page's escalation row with its `armed_for`, if there is one.
    async fn escalation_row(&self) -> Option<(Trigger, Option<i64>)>;
    /// Overwrites the row's `data`, as a tick's fenced write does.
    async fn write_data(&self, data: &str);
}

async fn claimed<D: EscalationDb>(db: &D, case: &str) -> Trigger {
    db.arm_at(NOW, "tick").await;
    let [held] = &db.claim_due(NOW).await[..] else {
        panic!("{case}: not claimed");
    };
    held.clone()
}

/// M138 (a): the arm on a missing, Waiting, Completed and Processing row; `data` always lands.
pub(super) async fn an_escalation_arm_keeps_a_running_ticks_claim<D: EscalationDb>() {
    use TriggerStatus::{Completed, Processing, Waiting};
    // (case, existing row (status, next_run_at), arm at, expected status, next_run_at, armed_for)
    let cases = [
        ("missing inserts", None, NOW, Waiting, NOW, None),
        (
            "waiting later moves earlier",
            Some((Waiting, NOW + 5 * SEC)),
            NOW,
            Waiting,
            NOW,
            None,
        ),
        (
            "waiting earlier stays",
            Some((Waiting, NOW)),
            NOW + 5 * SEC,
            Waiting,
            NOW,
            None,
        ),
        (
            "completed waits again",
            Some((Completed, 1)),
            NOW + 5 * SEC,
            Waiting,
            NOW + 5 * SEC,
            None,
        ),
        (
            "processing only notes the arm",
            Some((Processing, 7)),
            NOW,
            Processing,
            7,
            Some(NOW),
        ),
    ];
    for (case, existing, at, status, next_run_at, armed_for) in cases {
        let Some(db) = D::fresh_table().await else {
            return;
        };
        if let Some((s, n)) = existing {
            db.arm_at(0, "before").await;
            db.force(s, n).await;
        }
        db.arm_at(at, "released").await;
        let (got, armed) = db.escalation_row().await.expect(case);
        assert_eq!(
            (got.status, got.next_run_at, armed),
            (status, next_run_at, armed_for),
            "{case}"
        );
        assert_eq!(got.data, "released", "{case}");
    }
}

/// OF-10: a finish with a next tick re-queues at it, or at an earlier arm; the arm's data stays.
pub(super) async fn a_finish_requeues_at_the_tick_or_an_earlier_arm<D: EscalationDb>() {
    // (case, arm during the tick at, tick's next run, expected next_run_at)
    let cases = [
        ("no arm", None, NOW + 60 * SEC, NOW + 60 * SEC),
        (
            "earlier arm",
            Some(NOW + 5 * SEC),
            NOW + 60 * SEC,
            NOW + 5 * SEC,
        ),
        (
            "later arm",
            Some(NOW + 90 * SEC),
            NOW + 60 * SEC,
            NOW + 60 * SEC,
        ),
    ];
    for (case, arm, next, expected) in cases {
        let Some(db) = D::fresh_table().await else {
            return;
        };
        let held = claimed(&db, case).await;
        if let Some(at) = arm {
            db.arm_at(at, "verdict").await;
        }
        let EscalationFinish::Requeued(row) = db.finish_at(&held, Some(next)).await else {
            panic!("{case}: not re-queued");
        };
        let (got, armed) = db.escalation_row().await.expect(case);
        assert_eq!(row.next_run_at, got.next_run_at, "{case}");
        assert_eq!(
            (got.status, got.next_run_at, armed),
            (TriggerStatus::Waiting, expected, None),
            "{case}"
        );
        let data = if arm.is_some() { "verdict" } else { "tick" };
        assert_eq!(got.data, data, "{case}");
    }
}

/// OF-10 `fenced_finish_keeps_armed_for`: a tick ending its ladder while an arm noted
/// `armed_for` leaves the row at that time; with no arm the row goes, as Live.
pub(super) async fn fenced_finish_keeps_armed_for<D: EscalationDb>() {
    let Some(db) = D::fresh_table().await else {
        return;
    };
    let held = claimed(&db, "armed").await;
    db.arm_at(NOW + 30 * SEC, "verdict").await;
    assert!(matches!(
        db.finish_at(&held, None).await,
        EscalationFinish::Requeued(_)
    ));
    let (got, armed) = db.escalation_row().await.expect("the armed row survives");
    assert_eq!(
        (got.status, got.next_run_at, armed, got.data.as_str()),
        (TriggerStatus::Waiting, NOW + 30 * SEC, None, "verdict")
    );
    let [next] = &db.claim_due(NOW + 30 * SEC).await[..] else {
        panic!("the tick at armed_for does not run");
    };
    assert_eq!(next.claim_epoch, held.claim_epoch + 1);

    let Some(db) = D::fresh_table().await else {
        return;
    };
    let held = claimed(&db, "unarmed").await;
    assert!(matches!(
        db.finish_at(&held, None).await,
        EscalationFinish::Deleted
    ));
    assert!(db.escalation_row().await.is_none());
}

/// OF-10 [strong]: a finish holding a lost claim epoch writes nothing, with or without a next run.
pub(super) async fn a_finish_of_a_lost_claim_writes_nothing<D: EscalationDb>() {
    for next in [Some(NOW + 60 * SEC), None] {
        let Some(db) = D::fresh_table().await else {
            return;
        };
        let held = claimed(&db, "lost").await;
        db.arm_at(NOW + SEC, "verdict").await;
        let mut stale = held.clone();
        stale.claim_epoch -= 1;
        assert!(
            matches!(db.finish_at(&stale, next).await, EscalationFinish::Lost),
            "{next:?}"
        );
        let (got, armed) = db.escalation_row().await.expect("the row stays");
        assert_eq!(
            (got.status, got.next_run_at, armed),
            (TriggerStatus::Processing, NOW, Some(NOW + SEC)),
            "{next:?}"
        );
    }
}

/// OF-10 race: an arm that lands after the finish found no arm, before its delete, still
/// re-queues the row.
pub(super) async fn an_arm_between_the_finish_statements_still_requeues<D: EscalationDb>() {
    let Some(db) = D::fresh_table().await else {
        return;
    };
    let db = std::sync::Arc::new(db);
    let held = claimed(db.as_ref(), "race").await;
    let race = Barriers::new();
    race.arm("escalation_finish.unarmed", 2)
        .arm("escalation_finish.before_delete", 2);
    let finish = {
        let (race, db) = (race.clone(), db.clone());
        tokio::spawn(async move { race.run(db.finish_at(&held, None)).await })
    };
    race.wait("escalation_finish.unarmed").await;
    db.arm_at(NOW + 30 * SEC, "verdict").await;
    race.wait("escalation_finish.before_delete").await;
    let outcome = finish.await.unwrap();
    race.assert_all_met();
    assert!(
        matches!(outcome, EscalationFinish::Requeued(_)),
        "{outcome:?}"
    );
    let (got, armed) = db.escalation_row().await.expect("the armed row survives");
    assert_eq!(
        (got.status, got.next_run_at, armed),
        (TriggerStatus::Waiting, NOW + 30 * SEC, None)
    );
}

/// s06 F2 race: a retry budget the tick writes between an arm's read and its write survives the
/// arm, and the arm's own fields still land.
pub(super) async fn an_arm_keeps_a_budget_the_tick_wrote_after_its_read<D: EscalationDb>() {
    let Some(db) = D::fresh_table().await else {
        return;
    };
    let db = std::sync::Arc::new(db);
    claimed(db.as_ref(), "budget").await;
    db.write_data(r#"{"analysis":"pending","transport":null}"#)
        .await;
    let race = Barriers::new();
    race.arm("arm_escalation.read", 2)
        .arm("arm_escalation.before_write", 2);
    let arm = {
        let (race, db) = (race.clone(), db.clone());
        tokio::spawn(async move {
            race.run(db.arm_at(NOW + 5 * SEC, r#"{"analysis":"complete","transport":null}"#))
                .await
        })
    };
    race.wait("arm_escalation.read").await;
    db.write_data(r#"{"analysis":"pending","transport":{"run":1,"attempts":1}}"#)
        .await;
    race.wait("arm_escalation.before_write").await;
    arm.await.unwrap();
    race.assert_all_met();
    let (got, armed) = db.escalation_row().await.expect("the row stays");
    let data: serde_json::Value = serde_json::from_str(&got.data).unwrap();
    assert_eq!(
        data,
        serde_json::json!({"analysis": "complete", "transport": {"run": 1, "attempts": 1}})
    );
    assert_eq!(
        (got.status, armed),
        (TriggerStatus::Processing, Some(NOW + 5 * SEC))
    );
}
