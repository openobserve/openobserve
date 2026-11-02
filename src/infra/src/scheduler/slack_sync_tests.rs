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

//! SY-2 arm and finish cases, run against every scheduler backend.

use config::meta::triggers::{
    OncallSlackSyncData, SlackSyncFinish, Trigger, TriggerModule, TriggerStatus,
};

/// The org every sync test arms in.
pub(super) const ORG: &str = "o1";
/// The page every sync test arms.
pub(super) const KEY: &str = "p1";
const NOW: i64 = 1_000_000_000_000;
const SEC: i64 = 1_000_000;

/// One backend's empty scheduler table and the statements the cases need on it.
pub(super) trait SyncDb: Sized {
    /// A fresh, empty table, or `None` when the backend is not available here.
    async fn fresh() -> Option<Self>;
    /// The backend's arm of `KEY` at `t` (already the later of the arm and the backoff).
    async fn arm(&self, t: i64);
    /// The backend's finish of `claim`.
    async fn finish(&self, claim: &Trigger, finish: &SlackSyncFinish) -> bool;
    /// Claims due sync rows at `now` the way the sync lane's puller does.
    async fn claim(&self, now: i64) -> Vec<Trigger>;
    /// Forces `KEY`'s row into `status` at `next_run_at`, as earlier passes would leave it.
    async fn set(&self, status: TriggerStatus, next_run_at: i64);
    /// The `module` row of `KEY` with its `armed_for`.
    async fn row_of(&self, module: TriggerModule) -> (Trigger, Option<i64>);
    /// Inserts a Waiting row of another module under the same org and key.
    async fn insert(&self, module: TriggerModule, next_run_at: i64);
}

async fn row<D: SyncDb>(db: &D) -> (Trigger, Option<i64>) {
    db.row_of(TriggerModule::OncallSlackSync).await
}

fn done() -> SlackSyncFinish {
    SlackSyncFinish {
        status: TriggerStatus::Completed,
        next_run_at: NOW,
        data: OncallSlackSyncData::default(),
    }
}

/// SY-2.2: the arm on a missing, Waiting, Completed and Processing row.
pub(super) async fn an_arm_follows_sy2_on_every_row_state<D: SyncDb>() {
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
        let Some(db) = D::fresh().await else {
            return;
        };
        if let Some((s, n)) = existing {
            db.arm(0).await;
            db.set(s, n).await;
        }
        db.arm(at).await;
        let (got, armed) = row(&db).await;
        assert_eq!(
            (got.status, got.next_run_at, armed),
            (status, next_run_at, armed_for),
            "{case}"
        );
        assert_eq!(got.retries, 0, "{case}");
    }
}

/// SY-2.2: arms during a pass keep the earliest asked-for time.
pub(super) async fn arms_during_a_pass_keep_the_earliest<D: SyncDb>() {
    let Some(db) = D::fresh().await else {
        return;
    };
    db.arm(NOW).await;
    assert_eq!(db.claim(NOW).await.len(), 1);
    db.arm(NOW + 5 * SEC).await;
    db.arm(NOW + 2 * SEC).await;
    db.arm(NOW + 9 * SEC).await;
    assert_eq!(row(&db).await.1, Some(NOW + 2 * SEC));
}

/// SY-2.3: the pass's own outcome, or an arm's time during it, never before the new backoff.
pub(super) async fn a_finish_applies_the_pass_unless_an_arm_came_in<D: SyncDb>() {
    use TriggerStatus::{Completed, Waiting};
    let retry = |not_before: i64| SlackSyncFinish {
        status: Waiting,
        next_run_at: not_before,
        data: OncallSlackSyncData {
            attempt: 2,
            not_before,
        },
    };
    // (case, arm during the pass at, finish, expected status, next_run_at)
    let cases = [
        ("done", None, done(), Completed, NOW),
        (
            "retry",
            None,
            retry(NOW + 40 * SEC),
            Waiting,
            NOW + 40 * SEC,
        ),
        (
            "arm for +5 s re-queues at +5 s, not now",
            Some(NOW + 5 * SEC),
            done(),
            Waiting,
            NOW + 5 * SEC,
        ),
        (
            "arm under a 30 s Retry-After waits 30 s",
            Some(NOW),
            retry(NOW + 30 * SEC),
            Waiting,
            NOW + 30 * SEC,
        ),
    ];
    for (case, arm, finish, status, next_run_at) in cases {
        let Some(db) = D::fresh().await else {
            return;
        };
        db.arm(NOW).await;
        let [held] = &db.claim(NOW).await[..] else {
            panic!("{case}: not claimed");
        };
        if let Some(at) = arm {
            db.arm(at).await;
        }
        assert!(db.finish(held, &finish).await, "{case}");
        let (got, armed) = row(&db).await;
        assert_eq!(
            (got.status, got.next_run_at, armed),
            (status, next_run_at, None),
            "{case}"
        );
        let data: OncallSlackSyncData = serde_json::from_str(&got.data).unwrap();
        assert_eq!(data, finish.data, "{case}");
    }
}

/// SY-2.3 [strong]: a finish holding an older claim changes nothing.
pub(super) async fn a_finish_of_a_reclaimed_row_changes_nothing<D: SyncDb>() {
    let Some(db) = D::fresh().await else {
        return;
    };
    db.arm(NOW).await;
    let [held] = &db.claim(NOW).await[..] else {
        panic!("not claimed");
    };
    db.arm(NOW + SEC).await;
    let mut stale = held.clone();
    stale.claim_epoch -= 1;
    assert!(!db.finish(&stale, &done()).await);
    let (got, armed) = row(&db).await;
    assert_eq!(
        (got.status, armed),
        (TriggerStatus::Processing, Some(NOW + SEC))
    );
}

/// SY-2.1: an arm never touches another module's row of the same org and key.
pub(super) async fn another_modules_row_is_untouched<D: SyncDb>() {
    let Some(db) = D::fresh().await else {
        return;
    };
    db.insert(TriggerModule::OncallEscalation, NOW + 60 * SEC)
        .await;
    db.arm(NOW).await;
    let (other, armed) = db.row_of(TriggerModule::OncallEscalation).await;
    assert_eq!(
        (other.status, other.next_run_at, armed),
        (TriggerStatus::Waiting, NOW + 60 * SEC, None)
    );
}
