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

use config::meta::triggers::{OncallSlackSyncData, SlackSyncFinish, Trigger, TriggerStatus};

/// The org every sync test arms in.
pub(super) const ORG: &str = "o1";
/// The page every sync test arms.
pub(super) const KEY: &str = "p1";
// A clock far from zero, in microseconds.
const NOW: i64 = 1_000_000_000;
// One second in microseconds.
const SEC: i64 = 1_000_000;

/// One backend's empty scheduler table and the statements the cases need on it.
pub(super) trait SyncDb: Sized {
    /// A fresh, empty table.
    async fn fresh() -> Self;
    /// Runs the backend's arm of `KEY` at `at`.
    async fn arm(&self, at: i64);
    /// Runs the backend's finish of `claim`.
    async fn finish(
        &self,
        claim: &Trigger,
        read_armed: i64,
        finish: SlackSyncFinish,
        data: &OncallSlackSyncData,
        now: i64,
    ) -> bool;
    /// Claims due sync rows at `now` the way the sync lane's puller does.
    async fn claim(&self, now: i64) -> Vec<Trigger>;
    /// Forces the row into `status` at `next_run_at` with `data`, as earlier passes would leave it.
    async fn set(&self, status: TriggerStatus, next_run_at: i64, data: &str);
    /// The page's sync row.
    async fn row(&self) -> Trigger;
}

/// Each row state gets the SY-2 arm, and arms never touch `retries` or `attempt`.
pub(super) async fn an_arm_follows_sy2_on_every_row_state<D: SyncDb>() {
    let not_before = |at: i64| format!(r#"{{"attempt":2,"not_before":{at}}}"#);
    let waiting = TriggerStatus::Waiting;
    // (case, existing row as (status, next_run_at, data), arm at, expected status, next_run_at)
    let cases = [
        (
            "missing or cleaned up inserts",
            None,
            NOW,
            waiting.clone(),
            NOW,
        ),
        (
            "waiting later moves earlier",
            Some((waiting.clone(), NOW + 5 * SEC, "{}".to_string())),
            NOW,
            waiting.clone(),
            NOW,
        ),
        (
            "+5 s after now keeps now",
            Some((waiting.clone(), NOW, "{}".to_string())),
            NOW + 5 * SEC,
            waiting.clone(),
            NOW,
        ),
        (
            "waiting never before not_before",
            Some((waiting.clone(), NOW + 30 * SEC, not_before(NOW + 30 * SEC))),
            NOW,
            waiting.clone(),
            NOW + 30 * SEC,
        ),
        (
            "completed waits again",
            Some((TriggerStatus::Completed, 1, "{}".to_string())),
            NOW,
            waiting.clone(),
            NOW,
        ),
        (
            "completed never before not_before",
            Some((TriggerStatus::Completed, 1, not_before(NOW + 30 * SEC))),
            NOW,
            waiting.clone(),
            NOW + 30 * SEC,
        ),
        (
            "processing only counts the arm",
            Some((TriggerStatus::Processing, 7, not_before(0))),
            NOW,
            TriggerStatus::Processing,
            7,
        ),
    ];
    for (case, existing, at, status, next_run_at) in cases {
        let db = D::fresh().await;
        let before: OncallSlackSyncData = match existing {
            Some((status, next_run_at, data)) => {
                db.arm(0).await;
                db.set(status, next_run_at, &data).await;
                serde_json::from_str(&data).unwrap()
            }
            None => OncallSlackSyncData::default(),
        };
        db.arm(at).await;
        let got = db.row().await;
        let counted = i64::from(got.status == TriggerStatus::Processing);
        assert_eq!(
            (got.status, got.next_run_at),
            (status, next_run_at),
            "{case}"
        );
        assert_eq!(got.retries, 0, "{case}");
        let after: OncallSlackSyncData = serde_json::from_str(&got.data).unwrap();
        assert_eq!(after.attempt, before.attempt, "{case}");
        assert_eq!(
            after.armed_during_pass,
            before.armed_during_pass + counted,
            "{case}"
        );
    }
}

/// A finish applies the pass's outcome, or waits again if an arm came in, keeping its data.
pub(super) async fn a_finish_applies_the_pass_unless_an_arm_came_in<D: SyncDb>() {
    let retry = OncallSlackSyncData {
        attempt: 3,
        not_before: NOW + 40 * SEC,
        ..Default::default()
    };
    let done = OncallSlackSyncData::default();
    // (case, arms during the pass, finish, pass data, expected status, next_run_at)
    let cases = [
        (
            "done",
            0,
            SlackSyncFinish::Done,
            done.clone(),
            TriggerStatus::Completed,
            NOW,
        ),
        (
            "retry waits for not_before",
            0,
            SlackSyncFinish::Retry,
            retry.clone(),
            TriggerStatus::Waiting,
            NOW + 40 * SEC,
        ),
        (
            "arm during a done pass runs again now",
            1,
            SlackSyncFinish::Done,
            done.clone(),
            TriggerStatus::Waiting,
            NOW + SEC,
        ),
        (
            "arm during a failed pass keeps the backoff",
            2,
            SlackSyncFinish::Retry,
            retry.clone(),
            TriggerStatus::Waiting,
            NOW + 40 * SEC,
        ),
    ];
    for (case, arms, finish, pass, status, next_run_at) in cases {
        let db = D::fresh().await;
        db.arm(NOW).await;
        let [held] = &db.claim(NOW).await[..] else {
            panic!("{case}: not claimed");
        };
        let read: OncallSlackSyncData = serde_json::from_str(&held.data).unwrap();
        for _ in 0..arms {
            db.arm(NOW).await;
        }
        let applied = db
            .finish(held, read.armed_during_pass, finish, &pass, NOW + SEC)
            .await;
        let got = db.row().await;
        assert!(applied, "{case}");
        assert_eq!(
            (got.status, got.next_run_at),
            (status, next_run_at),
            "{case}"
        );
        let after: OncallSlackSyncData = serde_json::from_str(&got.data).unwrap();
        assert_eq!(
            (after.attempt, after.not_before),
            (pass.attempt, pass.not_before),
            "{case}"
        );
        assert_eq!(after.armed_during_pass, arms, "{case}");
    }
}

/// A finish holding an older claim changes nothing.
pub(super) async fn a_finish_of_a_reclaimed_row_changes_nothing<D: SyncDb>() {
    let db = D::fresh().await;
    db.arm(NOW).await;
    let [held] = &db.claim(NOW).await[..] else {
        panic!("not claimed");
    };
    let mut stale = held.clone();
    stale.claim_epoch -= 1;
    let done = OncallSlackSyncData::default();
    assert!(
        !db.finish(&stale, 0, SlackSyncFinish::Done, &done, NOW)
            .await
    );
    assert_eq!(db.row().await.status, TriggerStatus::Processing);
}

/// An arm while a pass holds the row gives no claim before the finish and one pass after it.
pub(super) async fn an_arm_mid_pass_gives_exactly_one_more_pass_after_it<D: SyncDb>() {
    let db = D::fresh().await;
    db.arm(NOW).await;
    let first = db.claim(NOW).await;
    assert_eq!(first.len(), 1);
    db.arm(NOW).await;
    assert!(
        db.claim(NOW + SEC).await.is_empty(),
        "claimed while a pass held it"
    );
    let done = OncallSlackSyncData::default();
    db.finish(&first[0], 0, SlackSyncFinish::Done, &done, NOW + SEC)
        .await;
    let second = db.claim(NOW + SEC).await;
    assert_eq!(second.len(), 1);
    let read: OncallSlackSyncData = serde_json::from_str(&second[0].data).unwrap();
    db.finish(
        &second[0],
        read.armed_during_pass,
        SlackSyncFinish::Done,
        &done,
        NOW + 2 * SEC,
    )
    .await;
    assert_eq!(db.row().await.status, TriggerStatus::Completed);
    assert!(db.claim(NOW + 3 * SEC).await.is_empty());
}
