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

use sea_orm::{ConnectOptions, Database, DatabaseConnection, TransactionTrait};

use super::*;
use crate::table::migration::create_notification_deliveries_for_test;

const T0: i64 = 1_700_000_000_000_000;
const MIN: i64 = 60 * 1_000_000;
const DAY: i64 = 24 * 3600 * 1_000_000;

async fn db() -> DatabaseConnection {
    let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
    opts.max_connections(1);
    let db = Database::connect(opts).await.unwrap();
    create_notification_deliveries_for_test(&db).await.unwrap();
    db
}

fn key() -> EpisodeKey {
    EpisodeKey {
        org: "acme".into(),
        kind: "anomaly".into(),
        episode_id: "a1:100".into(),
    }
}

fn trigger(dest: &str, platform: bool) -> NewDelivery {
    NewDelivery {
        org: "acme".into(),
        kind: "anomaly".into(),
        object_id: "a1".into(),
        episode_id: "a1:100".into(),
        event: "firing:100".into(),
        destination: dest.into(),
        channel: if platform { "pagerduty" } else { "slack" }.into(),
        platform: platform.then(|| "pagerduty".to_string()),
        template_source: "compiled".into(),
        template_name: "o2_default_anomaly".into(),
        template_skipped: "[]".into(),
        opens_episode: true,
        closed_at_insert: false,
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        subject: None,
        payload: "{\"v\":1}".into(),
    }
}

fn informational(event: &str) -> NewDelivery {
    NewDelivery {
        kind: "downtime".into(),
        episode_id: "d1:1".into(),
        event: event.into(),
        opens_episode: false,
        closed_at_insert: true,
        ..trigger("slack", false)
    }
}

fn fanout(dest: &str, platform: bool) -> FanoutDestination {
    FanoutDestination {
        destination: dest.into(),
        channel: if platform { "pagerduty" } else { "slack" }.into(),
        platform: platform.then(|| "pagerduty".to_string()),
        template_source: if platform {
            "platform_resolve"
        } else {
            "compiled"
        }
        .into(),
        template_name: String::new(),
        subject: None,
        payload: "{\"v\":1}".into(),
    }
}

fn sent() -> Finish {
    Finish {
        sent: true,
        answered: true,
        retryable: false,
        status_code: Some(200),
        error: None,
        skip_reason: None,
    }
}

fn rejected(status: i32) -> Finish {
    Finish {
        sent: false,
        answered: true,
        retryable: status >= 500,
        status_code: Some(status),
        error: Some(format!("HTTP {status}")),
        skip_reason: None,
    }
}

fn no_answer() -> Finish {
    Finish {
        sent: false,
        answered: false,
        retryable: true,
        status_code: None,
        error: Some("timed out".into()),
        skip_reason: None,
    }
}

fn owned(c: Claim) -> Model {
    match c {
        Claim::Owned(row) => *row,
        other => panic!("expected Owned, got {other:?}"),
    }
}

async fn resolve(db: &DatabaseConnection, current: &[FanoutDestination], now: i64) -> Vec<String> {
    let txn = db.begin().await.unwrap();
    let written = resolve_episode_in(
        &txn,
        &key(),
        "a1",
        current,
        |r| {
            Some(FanoutDestination {
                destination: r.destination.clone(),
                channel: r.channel.clone(),
                platform: r.platform.clone(),
                template_source: "platform_resolve".into(),
                ..Default::default()
            })
        },
        CLOSED_BY_RESOLVE,
        true,
        now,
    )
    .await
    .unwrap();
    txn.commit().await.unwrap();
    written
}

async fn resolve_row(db: &DatabaseConnection, dest: &str) -> Model {
    queued_or_any(db, "resolved", dest).await.unwrap()
}

async fn queued_or_any(db: &DatabaseConnection, event: &str, dest: &str) -> Option<Model> {
    Entity::find()
        .filter(Column::Event.eq(event))
        .filter(Column::Destination.eq(dest))
        .one(db)
        .await
        .unwrap()
}

async fn record_of(db: &DatabaseConnection, dest: &str) -> Option<String> {
    recorded_destinations(db, &key())
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.destination == dest)
        .map(|r| r.trigger_outcome)
}

#[tokio::test]
async fn a_second_claim_of_a_live_row_is_in_flight_and_a_sent_row_is_already_delivered() {
    let db = db().await;
    let row = owned(
        claim(&db, &trigger("slack", false), "t1", T0)
            .await
            .unwrap(),
    );
    assert_eq!(row.attempt, 1);
    assert_eq!(row.status, STATUS_PENDING);
    assert_eq!(
        claim(&db, &trigger("slack", false), "t2", T0)
            .await
            .unwrap(),
        Claim::Refused(Refusal::InFlight)
    );
    assert!(finish(&db, &row.id, "t1", &sent(), T0 + 1).await.unwrap());
    assert_eq!(
        claim(&db, &trigger("slack", false), "t3", T0 + 2)
            .await
            .unwrap(),
        Claim::Refused(Refusal::AlreadyDelivered)
    );
    assert_eq!(record_of(&db, "slack").await.as_deref(), Some(OUTCOME_SENT));
}

#[tokio::test]
async fn a_failed_row_waits_for_its_retry_time_then_is_reclaimed() {
    let db = db().await;
    let row = owned(
        claim(&db, &trigger("slack", false), "t1", T0)
            .await
            .unwrap(),
    );
    finish(&db, &row.id, "t1", &rejected(503), T0)
        .await
        .unwrap();
    assert_eq!(
        claim(&db, &trigger("slack", false), "t2", T0 + 1_000_000)
            .await
            .unwrap(),
        Claim::Refused(Refusal::RetryScheduled)
    );
    let again = owned(
        claim(&db, &trigger("slack", false), "t3", T0 + MIN)
            .await
            .unwrap(),
    );
    assert_eq!(again.attempt, 2);
}

#[tokio::test]
async fn the_budget_holds_on_every_path() {
    let db = db().await;
    let mut now = T0;
    let mut row = owned(
        claim(&db, &trigger("slack", false), "t1", now)
            .await
            .unwrap(),
    );
    for attempt in 1..5 {
        finish(&db, &row.id, &format!("t{attempt}"), &rejected(503), now)
            .await
            .unwrap();
        now += 61 * MIN;
        row = owned(
            reclaim(&db, &row.id, &format!("t{}", attempt + 1), now)
                .await
                .unwrap(),
        );
    }
    assert_eq!(row.attempt, 5);
    // The fifth claim went stale: expiry leaves attempt alone and marks the row not retryable.
    now += LEASE_US + 1;
    assert_eq!(expire_leases(&db, now).await.unwrap(), 1);
    let stale = get(&db, &row.id).await.unwrap().unwrap();
    assert_eq!(stale.attempt, 5);
    assert!(!stale.retryable);
    assert_eq!(stale.error.as_deref(), Some(LEASE_EXPIRED));
    assert_eq!(
        reclaim(&db, &row.id, "t9", now + DAY).await.unwrap(),
        Claim::Refused(Refusal::Exhausted)
    );
}

#[tokio::test]
async fn a_claim_after_a_stale_read_changes_nothing() {
    let db = db().await;
    let mut row = owned(claim(&db, &trigger("slack", false), "a", T0).await.unwrap());
    let stale_read = row.clone();
    let mut now = T0;
    for n in 0..5 {
        finish(&db, &row.id, &format!("b{n}"), &rejected(503), now)
            .await
            .ok();
        if n == 0 {
            finish(&db, &row.id, "a", &rejected(503), now)
                .await
                .unwrap();
        }
        now += 61 * MIN;
        match reclaim(&db, &row.id, &format!("b{}", n + 1), now)
            .await
            .unwrap()
        {
            Claim::Owned(r) => row = *r,
            Claim::Refused(_) => break,
        }
    }
    let before = get(&db, &row.id).await.unwrap().unwrap().attempt;
    assert_eq!(
        reclaim(&db, &stale_read.id, "a", now + DAY).await.unwrap(),
        Claim::Refused(Refusal::Exhausted)
    );
    assert_eq!(get(&db, &row.id).await.unwrap().unwrap().attempt, before);
}

#[tokio::test]
async fn a_late_worker_finishes_nothing_after_its_lease_expired() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    expire_leases(&db, T0 + LEASE_US + 1).await.unwrap();
    let written = resolve(&db, &[fanout("pd", true)], T0 + LEASE_US + 2).await;
    assert_eq!(written, ["pd"]);
    let r = resolve_row(&db, "pd").await;
    let resolve_claim = owned(reclaim(&db, &r.id, "r1", T0 + LEASE_US + 3).await.unwrap());
    finish(&db, &resolve_claim.id, "r1", &sent(), T0 + LEASE_US + 4)
        .await
        .unwrap();
    // The worker that held the trigger resumes with its own token.
    assert!(
        !finish(&db, &row.id, "t1", &sent(), T0 + LEASE_US + 5)
            .await
            .unwrap()
    );
    let trigger_row = get(&db, &row.id).await.unwrap().unwrap();
    assert_eq!(trigger_row.status, STATUS_SKIPPED);
    assert_eq!(trigger_row.skip_reason.as_deref(), Some(SKIP_SUPERSEDED));
    assert_eq!(record_of(&db, "pd").await.as_deref(), Some(OUTCOME_UNKNOWN));
    assert_eq!(resolve_row(&db, "pd").await.status, STATUS_SENT);
}

#[tokio::test]
async fn a_trigger_after_the_episode_closed_is_superseded_without_a_send() {
    let db = db().await;
    resolve(&db, &[fanout("pd", true)], T0).await;
    assert_eq!(
        claim(&db, &trigger("pd", true), "t1", T0 + 1)
            .await
            .unwrap(),
        Claim::Refused(Refusal::Superseded)
    );
    let row = queued_or_any(&db, "firing:100", "pd").await.unwrap();
    assert_eq!(row.attempt, 0);
    assert_eq!(row.skip_reason.as_deref(), Some(SKIP_SUPERSEDED));
}

#[tokio::test]
async fn recovery_while_a_trigger_failed_with_an_answer_skips_the_platform_resolve() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    finish(&db, &row.id, "t1", &rejected(503), T0)
        .await
        .unwrap();
    resolve(&db, &[fanout("pd", true)], T0 + 1).await;
    let trigger_row = get(&db, &row.id).await.unwrap().unwrap();
    assert_eq!(trigger_row.skip_reason.as_deref(), Some(SKIP_SUPERSEDED));
    assert_eq!(
        record_of(&db, "pd").await.as_deref(),
        Some(OUTCOME_ATTEMPTED)
    );
    let r = resolve_row(&db, "pd").await;
    assert_eq!(
        reclaim(&db, &r.id, "r1", T0 + 2).await.unwrap(),
        Claim::Refused(Refusal::NoTriggerRecorded)
    );
    assert!(
        retry_candidates(&db, T0 + DAY, 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn recovery_while_a_trigger_timed_out_still_resolves() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    finish(&db, &row.id, "t1", &no_answer(), T0).await.unwrap();
    assert_eq!(record_of(&db, "pd").await.as_deref(), Some(OUTCOME_UNKNOWN));
    resolve(&db, &[fanout("pd", true)], T0 + 1).await;
    let r = resolve_row(&db, "pd").await;
    owned(reclaim(&db, &r.id, "r1", T0 + 2).await.unwrap());
}

#[tokio::test]
async fn recovery_while_a_trigger_is_in_flight_waits_for_it() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    resolve(&db, &[fanout("pd", true)], T0 + 1).await;
    let r = resolve_row(&db, "pd").await;
    assert_eq!(
        reclaim(&db, &r.id, "r1", T0 + 2).await.unwrap(),
        Claim::Refused(Refusal::InFlight)
    );
    assert_eq!(resolve_row(&db, "pd").await.status, STATUS_QUEUED);
    finish(&db, &row.id, "t1", &sent(), T0 + 3).await.unwrap();
    assert_eq!(record_of(&db, "pd").await.as_deref(), Some(OUTCOME_SENT));
    assert_eq!(resolve_row(&db, "pd").await.next_retry_at, Some(T0 + 3));
    let candidates = retry_candidates(&db, T0 + 3, 100).await.unwrap();
    assert_eq!(candidates.len(), 1);
    owned(reclaim(&db, &candidates[0].id, "r2", T0 + 3).await.unwrap());
}

#[tokio::test]
async fn a_resolve_claimed_after_a_lease_expiry_reconciles_the_trigger_itself() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    let later = T0 + LEASE_US + 1;
    resolve(&db, &[fanout("pd", true)], later).await;
    let r = resolve_row(&db, "pd").await;
    owned(reclaim(&db, &r.id, "r1", later + 1).await.unwrap());
    let trigger_row = get(&db, &row.id).await.unwrap().unwrap();
    assert_eq!(trigger_row.skip_reason.as_deref(), Some(SKIP_SUPERSEDED));
    assert_eq!(record_of(&db, "pd").await.as_deref(), Some(OUTCOME_UNKNOWN));
    assert_eq!(expire_leases(&db, later + 2).await.unwrap(), 0);
}

#[tokio::test]
async fn a_destination_removed_while_its_trigger_is_in_flight_still_gets_its_resolve() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    assert_eq!(
        record_of(&db, "pd").await.as_deref(),
        Some(OUTCOME_ATTEMPTED)
    );
    let written = resolve(&db, &[], T0 + 1).await;
    assert_eq!(written, ["pd"]);
    finish(&db, &row.id, "t1", &sent(), T0 + 2).await.unwrap();
    let r = resolve_row(&db, "pd").await;
    assert_eq!(r.next_retry_at, Some(T0 + 2));
    owned(reclaim(&db, &r.id, "r1", T0 + 2).await.unwrap());
}

#[tokio::test]
async fn the_fan_out_is_idempotent_and_stamps_every_row() {
    let db = db().await;
    let row = owned(
        claim(&db, &trigger("slack", false), "t1", T0)
            .await
            .unwrap(),
    );
    finish(&db, &row.id, "t1", &sent(), T0).await.unwrap();
    let current = [
        fanout("slack", false),
        fanout("pd", true),
        fanout("teams", false),
    ];
    assert_eq!(resolve(&db, &current, T0 + 1).await.len(), 3);
    assert_eq!(resolve(&db, &current, T0 + 2).await.len(), 3);
    let (total, rows) = list(
        &db,
        &ListFilter {
            org: "acme".into(),
            kind: "anomaly".into(),
            episode_id: Some("a1:100".into()),
            event: Some("resolved".into()),
            size: 50,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(total, 3);
    assert!(rows.iter().all(|r| r.episode_closed_at == Some(T0 + 1)));
    let episode = get_episode(&db, &key()).await.unwrap().unwrap();
    assert_eq!(episode.closed_at, Some(T0 + 1));
    assert_eq!(episode.closed_by.as_deref(), Some(CLOSED_BY_RESOLVE));
}

#[tokio::test]
async fn a_fan_out_that_rolls_back_leaves_the_episode_open_and_no_rows() {
    let db = db().await;
    let txn = db.begin().await.unwrap();
    resolve_episode_in(
        &txn,
        &key(),
        "a1",
        &[
            fanout("slack", false),
            fanout("pd", true),
            fanout("teams", false),
        ],
        |_| None,
        CLOSED_BY_RESOLVE,
        true,
        T0,
    )
    .await
    .unwrap();
    txn.rollback().await.unwrap();
    assert!(get_episode(&db, &key()).await.unwrap().is_none());
    assert!(queued_resolves(&db, &key()).await.unwrap().is_empty());
    assert_eq!(
        resolve(&db, &[fanout("slack", false)], T0 + 1).await.len(),
        1
    );
}

#[tokio::test]
async fn informational_rows_closed_at_insert_are_still_retried() {
    let db = db().await;
    for event in ["started", "ends_soon"] {
        let new = informational(event);
        let row = owned(claim(&db, &new, "t1", T0).await.unwrap());
        assert_eq!(row.episode_closed_at, Some(T0));
        finish(&db, &row.id, "t1", &rejected(503), T0)
            .await
            .unwrap();
    }
    let candidates = retry_candidates(&db, T0 + MIN, 100).await.unwrap();
    assert_eq!(candidates.len(), 2);
    for c in candidates {
        let again = owned(reclaim(&db, &c.id, "t2", T0 + MIN).await.unwrap());
        assert_eq!(again.attempt, 2);
    }
}

#[tokio::test]
async fn retention_spares_open_episodes_and_the_hard_cap_keeps_the_routing_state() {
    let db = db().await;
    let row = owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    finish(&db, &row.id, "t1", &sent(), T0).await.unwrap();
    let day40 = T0 + 40 * DAY;
    delete_expired(&db, day40, 30 * DAY, 365 * DAY)
        .await
        .unwrap();
    assert!(
        get(&db, &row.id).await.unwrap().is_some(),
        "open episode survives retention"
    );

    let day400 = T0 + 400 * DAY;
    delete_expired(&db, day400, 30 * DAY, 365 * DAY)
        .await
        .unwrap();
    assert!(
        get(&db, &row.id).await.unwrap().is_none(),
        "hard cap deletes delivery rows"
    );
    assert_eq!(record_of(&db, "pd").await.as_deref(), Some(OUTCOME_SENT));
    assert_eq!(resolve(&db, &[], day400 + 1).await, ["pd"]);
    let r = resolve_row(&db, "pd").await;
    owned(reclaim(&db, &r.id, "r1", day400 + 2).await.unwrap());
}

#[tokio::test]
async fn a_closed_episode_is_deleted_thirty_days_after_it_closed() {
    let db = db().await;
    owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    resolve(&db, &[], T0 + 1).await;
    delete_expired(&db, T0 + 31 * DAY, 30 * DAY, 365 * DAY)
        .await
        .unwrap();
    assert!(get_episode(&db, &key()).await.unwrap().is_none());
    assert!(record_of(&db, "pd").await.is_none());
}

#[tokio::test]
async fn closing_without_resolves_supersedes_a_later_trigger() {
    let db = db().await;
    owned(claim(&db, &trigger("pd", true), "t1", T0).await.unwrap());
    close_episode(&db, &key(), "a1", CLOSED_BY_PRODUCER, T0 + 1)
        .await
        .unwrap();
    assert!(queued_resolves(&db, &key()).await.unwrap().is_empty());
    let mut later = trigger("pd", true);
    later.event = "firing:200".into();
    assert_eq!(
        claim(&db, &later, "t2", T0 + 2).await.unwrap(),
        Claim::Refused(Refusal::Superseded)
    );
}

#[tokio::test]
async fn a_resolve_with_no_recorded_trigger_is_skipped_without_a_send() {
    let db = db().await;
    let mut r = trigger("pd", true);
    r.event = EVENT_RESOLVED.into();
    r.opens_episode = false;
    assert_eq!(
        claim(&db, &r, "r1", T0).await.unwrap(),
        Claim::Refused(Refusal::NoTriggerRecorded)
    );
}

#[tokio::test]
async fn list_pages_newest_first_and_filters_by_object() {
    let db = db().await;
    for (i, dest) in ["a", "b", "c"].into_iter().enumerate() {
        owned(
            claim(&db, &trigger(dest, false), "t", T0 + i as i64)
                .await
                .unwrap(),
        );
    }
    let filter = ListFilter {
        org: "acme".into(),
        kind: "anomaly".into(),
        object_id: Some("a1".into()),
        size: 2,
        ..Default::default()
    };
    let (total, rows) = list(&db, &filter).await.unwrap();
    assert_eq!(total, 3);
    let dests: Vec<&str> = rows.iter().map(|r| r.destination.as_str()).collect();
    assert_eq!(dests, ["c", "b"]);
    let other = ListFilter {
        object_id: Some("zzz".into()),
        ..filter
    };
    assert_eq!(list(&db, &other).await.unwrap().0, 0);
}

#[test]
fn backoff_spans_about_eighty_minutes() {
    let total: i64 = (1..=4).map(backoff_us).sum();
    assert_eq!(total, 81 * MIN);
}
