// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::collections::BTreeSet;

use config::meta::stream::StreamType;
use infra::table::alert_incidents::{self, FieldEdit};
use serde_json::{Value, json};

use super::{
    Check, DatabaseConnection, Fixture, GRID, IncidentEventType, RecoveryFailureReason,
    RecoveryFixtureSpec, SECOND, SETTINGS, SOAK_SECS, TransactionTrait as _, Verdict, backends,
    create_scheduled_jobs_for_test, now_micros, reconcile, shared_connection,
    with_scheduler_test_db,
};
use crate::{
    alerts::incidents::{
        mitigations::{MitigationError, tests::record_recovery_fixture_with_sources},
        recovery::checks::{CheckKey, cancel_with, edit_with, list_with},
    },
    authz::{QuerySource, TypedStream, fake_checker},
};

async fn fixture(db: &DatabaseConnection, scope_count: usize) -> Fixture {
    let org = config::ider::generate();
    let (incident, recorded) = record_recovery_fixture_with_sources(
        db,
        &org,
        RecoveryFixtureSpec {
            scope_count,
            pass_window_secs: 90,
            soak_secs: SOAK_SECS,
            missing_slo_id: None,
        },
        &[QuerySource::Stream {
            org_id: org.clone(),
            stream_type: StreamType::Logs,
            name: "requests".to_owned(),
        }],
    )
    .await;
    assert_eq!(recorded.watch_refused, None);
    assert_eq!(recorded.check_ids.len(), scope_count);
    Fixture {
        db: shared_connection(db),
        org,
        id: incident.id,
    }
}

fn key<'a>(fixture: &'a Fixture, check: &'a Check) -> CheckKey<'a> {
    CheckKey {
        org: &fixture.org,
        incident: &fixture.id,
        check: &check.id,
    }
}

fn stream(fixture: &Fixture) -> TypedStream {
    TypedStream {
        org_id: fixture.org.clone(),
        stream_type: StreamType::Logs,
        name: "requests".to_owned(),
    }
}

fn grant_read(fixture: &Fixture, viewer: &str) {
    fake_checker().grant_read(viewer, &stream(fixture));
}

fn actor(fixture: &Fixture) -> String {
    let actor = config::ider::generate();
    grant_read(fixture, &actor);
    actor
}

#[tokio::test]
async fn t2_condition_edit_resets_the_entire_attempt() {
    for db in backends("t2_condition_edit").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        with_scheduler_test_db(&db, assert_attempt_reset(&db)).await;
    }
}

async fn assert_attempt_reset(db: &DatabaseConnection) {
    let fixture = fixture(db, 2).await;
    let actor = actor(&fixture);
    let verified = fixture.verify_scopes().await;
    fixture.finish_soak_scopes(&verified).await;
    let before = fixture.rows().await;
    let original = fixture.incident().await;
    assert!(original.mitigated_at.is_some());
    assert!(original.recovered_at.is_some());
    assert!(original.impact_end_at.is_some());
    for scope in &before {
        assert_eq!(scope.state, "held");
        reconcile(db, &fixture.org, &scope.id, now_micros(), &SETTINGS)
            .await
            .unwrap();
        fixture.job(&format!("{}:held", scope.id)).await;
    }

    let check = key(&fixture, &before[0]);
    let before_read = list_with(db, &fixture.org, &fixture.id, &actor)
        .await
        .unwrap();
    let unsafe_patch = serde_json::from_value(json!({"recover_threshold": 3.0})).unwrap();
    let rejected = edit_with(db, check, &actor, unsafe_patch, &SETTINGS).await;
    assert!(matches!(rejected, Err(MitigationError::BadRequest(_))));
    assert_eq!(fixture.rows().await, before);

    let body = serde_json::from_value(json!({
        "recover_threshold": 0.7,
        "expect_effect_secs": 120,
        "volume_floor_pct": 65,
    }))
    .unwrap();
    assert!(edit_with(db, check, &actor, body, &SETTINGS).await.is_ok());
    let edited_read = list_with(db, &fixture.org, &fixture.id, &actor)
        .await
        .unwrap();
    assert!(!edited_read.matches_etag([before_read.etag.as_str()]));
    let updated = fixture.rows().await;
    let base = updated[0].effect_from_at;
    for (scope, prior) in updated.iter().zip(&before) {
        assert_eq!(scope.state, "checking");
        assert_eq!(scope.generation, prior.generation + 1);
        assert_eq!(scope.passes, 0);
        assert_eq!(scope.pass_started_at, None);
        assert_eq!(scope.effect_from_at, base);
        assert_eq!(scope.recent_samples, prior.recent_samples);
        let window = i64::from(scope.expect_effect_secs) + SETTINGS.deadline_secs;
        assert_eq!(scope.deadline_at, base + window * SECOND);
        reconcile(db, &fixture.org, &scope.id, now_micros(), &SETTINGS)
            .await
            .unwrap();
        fixture.assert_no_job(&format!("{}:held", scope.id)).await;
        fixture.job(&scope.id).await;
    }
    let measure: Value = serde_json::from_str(&updated[0].measure).unwrap();
    assert_eq!(measure["cv"], 2);
    assert_eq!(updated[0].recover_threshold, 0.7);
    assert_eq!(updated[0].expect_effect_secs, 120);
    assert_eq!(updated[0].volume_floor_pct, 65);
    assert_eq!(updated[1].measure, before[1].measure);
    assert_eq!(updated[1].recover_threshold, before[1].recover_threshold);
    let incident = fixture.incident().await;
    assert_eq!(incident.mitigated_at, None);
    assert_eq!(incident.recovered_at, None);
    assert_eq!(incident.impact_end_at, None);
    assert_eq!(incident.fix_applied_at, Some(before[0].trigger_at));
    assert_eq!(
        incident.recovery_due_at,
        Some(base + i64::from(before[1].expect_effect_secs) * SECOND)
    );
    let events = fixture.events().await;
    let event = events.last().unwrap();
    assert_eq!(event.timestamp, base);
    assert!(matches!(&event.event_type,
        IncidentEventType::RecoveryConditionChanged { check_id, old, new, actor: by, transition_id }
            if check_id == &updated[0].id && old.recover_threshold == before[0].recover_threshold
                && new.recover_threshold == 0.7 && by == &actor && transition_id.len() == 26
    ));
}

#[tokio::test]
async fn t2_condition_edit_preserves_latch_and_human_impact_end() {
    for db in backends("t2_condition_edit_latch").await {
        let fixture = fixture(&db, 1).await;
        let actor = actor(&fixture);
        let before = fixture.check().await;
        let original_due = fixture.incident().await.recovery_due_at.unwrap();
        fixture.sample(&before, original_due, Verdict::NotYet).await;
        fixture.tick(&before, original_due).await;
        fixture
            .assert_latch(Some(original_due), &before.attempt_id)
            .await;
        let impact_end = before.trigger_at + GRID / 2;
        let txn = db.begin().await.unwrap();
        alert_incidents::edit_fields_in(
            &txn,
            &fixture.org,
            &fixture.id,
            FieldEdit::ImpactWindow {
                start: before.trigger_at,
                end: Some(impact_end),
            },
            &actor,
        )
        .await
        .unwrap();
        txn.commit().await.unwrap();

        let patch = serde_json::from_value(json!({"expect_effect_secs": 120})).unwrap();
        assert!(
            edit_with(&db, key(&fixture, &before), &actor, patch, &SETTINGS)
                .await
                .is_ok()
        );
        let after = fixture.check().await;
        let incident = fixture.incident().await;
        assert_eq!(incident.impact_end_at, Some(impact_end));
        assert_eq!(
            incident.recovery_due_at,
            Some(after.effect_from_at + 120 * SECOND)
        );
        let sample_at = original_due.max(after.effect_from_at) + GRID;
        fixture.sample(&before, sample_at, Verdict::Breach).await;
        assert_eq!(fixture.check().await, after);
        fixture.sample(&after, sample_at, Verdict::NotYet).await;
        fixture.tick(&after, sample_at).await;
        fixture
            .assert_latch(Some(original_due), &before.attempt_id)
            .await;
    }
}

#[tokio::test]
async fn t16_cancel_checking_scope_lets_the_remaining_scope_verify() {
    for db in backends("t16_cancel_scope").await {
        let fixture = fixture(&db, 2).await;
        let actor = actor(&fixture);
        let longer = fixture.rows().await.remove(0);
        edit_with(
            &db,
            key(&fixture, &longer),
            &actor,
            serde_json::from_value(json!({"expect_effect_secs": 1800})).unwrap(),
            &SETTINGS,
        )
        .await
        .unwrap();
        let [cancelled, active]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let due = active.effect_from_at + i64::from(active.expect_effect_secs) * SECOND;
        assert_eq!(cancelled.id, longer.id);
        assert!(fixture.incident().await.recovery_due_at.unwrap() > due);
        let before = list_with(&db, &fixture.org, &fixture.id, &actor)
            .await
            .unwrap();
        cancel_with(&db, key(&fixture, &cancelled), &actor)
            .await
            .unwrap();
        assert_eq!(fixture.incident().await.recovery_due_at, Some(due));
        let after = list_with(&db, &fixture.org, &fixture.id, &actor)
            .await
            .unwrap();
        assert!(!after.matches_etag([before.etag.as_str()]));
        for at in 1..=4 {
            fixture
                .sample(
                    &cancelled,
                    active.effect_from_at + at * GRID,
                    Verdict::Breach,
                )
                .await;
            fixture
                .sample(&active, active.effect_from_at + at * GRID, Verdict::Pass)
                .await;
        }
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        assert_eq!(first.state, "cancelled");
        assert_eq!(first.generation, cancelled.generation + 1);
        assert_eq!(first.last_checked_at, None);
        assert_eq!(second.state, "soaking");
        assert!(fixture.incident().await.mitigated_at.is_some());
    }
}

#[tokio::test]
async fn t16_cancel_last_checking_scope_clears_due_and_keeps_latch() {
    for db in backends("t16_clear_due").await {
        let fixture = fixture(&db, 1).await;
        let actor = actor(&fixture);
        let original = fixture.check().await;
        let due = fixture.incident().await.recovery_due_at.unwrap();
        fixture.sample(&original, due, Verdict::NotYet).await;
        fixture.tick(&original, due).await;
        fixture.assert_latch(Some(due), &original.attempt_id).await;

        cancel_with(&db, key(&fixture, &original), &actor)
            .await
            .unwrap();
        let cancelled = fixture.check().await;
        assert_eq!(cancelled.state, "cancelled");
        assert_eq!(cancelled.generation, original.generation + 1);
        let incident = fixture.incident().await;
        assert_eq!(incident.recovery_due_at, None);
        assert_eq!(incident.fix_applied_at, Some(cancelled.trigger_at));
        fixture.assert_latch(Some(due), &original.attempt_id).await;
    }
}

#[tokio::test]
async fn t16_cancel_last_watch_marks_unverified_and_keeps_mitigated() {
    for db in backends("t16_last_watch").await {
        let fixture = fixture(&db, 2).await;
        let actor = actor(&fixture);
        let [first, second]: [Check; 2] = fixture.verify_scopes().await.try_into().unwrap();
        let verified_at = fixture.incident().await.mitigated_at;
        cancel_with(&db, key(&fixture, &first), &actor)
            .await
            .unwrap();
        let rows = fixture.rows().await;
        assert_eq!(rows[0].state, "cancelled");
        assert_eq!(rows[1].state, "soaking");
        assert_eq!(rows[0].verified_at, first.verified_at);
        let recovered_at = fixture.finish_soak(&rows[1]).await;
        let held = fixture.rows().await.remove(1);
        assert_eq!(held.state, "held");
        cancel_with(&db, key(&fixture, &second), &actor)
            .await
            .unwrap();
        let last = fixture.rows().await.remove(1);
        assert_eq!(last.state, "unverified");
        assert_eq!(last.generation, held.generation + 1);
        assert_eq!(
            last.state_reason.unwrap(),
            format!("monitoring cancelled by {actor}")
        );
        let incident = fixture.incident().await;
        assert_eq!(incident.mitigated_at, verified_at);
        assert_eq!(incident.recovered_at, Some(recovered_at));
        let events = fixture.events().await;
        assert!(matches!(
            &events.last().unwrap().event_type,
            IncidentEventType::RecoveryFailed {
                check_id, transition_id, reason: RecoveryFailureReason::Unverified, ..
            } if check_id == &held.id && transition_id.len() == 26
        ));
    }
}

#[tokio::test]
async fn recovery_checks_get_returns_hidden_form_without_source_access() {
    for db in backends("recovery_checks_hidden").await {
        let fixture = fixture(&db, 1).await;
        let check = fixture.check().await;
        fixture
            .sample(&check, check.trigger_at + GRID, Verdict::Pass)
            .await;
        let viewer = config::ider::generate();
        fake_checker();
        let read = list_with(&db, &fixture.org, &fixture.id, &viewer)
            .await
            .unwrap();
        let body = serde_json::to_value(read.into_body().unwrap()).unwrap();
        let hidden = body["checks"][0].as_object().unwrap();
        let keys: BTreeSet<_> = hidden.keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            BTreeSet::from(["check_id", "state", "state_reason", "scope", "timestamps"])
        );
        assert_eq!(hidden["check_id"], check.id);
        assert_eq!(hidden["state"], "checking");
        assert_eq!(
            hidden["timestamps"]["last_checked_at"],
            check.trigger_at + GRID
        );
        assert_eq!(
            body["due_at"],
            fixture.incident().await.recovery_due_at.unwrap()
        );
    }
}

#[tokio::test]
async fn recovery_checks_etag_changes_on_viewer_access_change() {
    for db in backends("recovery_checks_etag").await {
        let fixture = fixture(&db, 1).await;
        let check = fixture.check().await;
        fixture
            .sample(&check, check.trigger_at + GRID, Verdict::Pass)
            .await;
        let prior = fixture.check().await;
        let viewer = config::ider::generate();
        fake_checker();
        let hidden = list_with(&db, &fixture.org, &fixture.id, &viewer)
            .await
            .unwrap();
        let tag = hidden.etag.as_str();
        let repeat = list_with(&db, &fixture.org, &fixture.id, &viewer)
            .await
            .unwrap();
        assert!(repeat.matches_etag([tag]));

        grant_read(&fixture, &viewer);
        let visible = list_with(&db, &fixture.org, &fixture.id, &viewer)
            .await
            .unwrap();
        assert!(!visible.matches_etag([tag]));
        assert_eq!(fixture.check().await, prior);
        let visible_tag = visible.etag.clone();
        let body = serde_json::to_value(visible.into_body().unwrap()).unwrap();
        assert_eq!(body["checks"][0]["measure"]["cv"], 1);
        assert_eq!(body["checks"][0]["recent_samples"][0]["value"], 0.8);

        fake_checker().revoke_read(&viewer, &stream(&fixture));
        let denied = list_with(&db, &fixture.org, &fixture.id, &viewer)
            .await
            .unwrap();
        assert!(!denied.matches_etag([visible_tag.as_str()]));
        assert!(denied.matches_etag([tag]));
        assert_eq!(fixture.check().await, prior);
        let body = serde_json::to_value(denied.into_body().unwrap()).unwrap();
        assert!(body["checks"][0].get("recent_samples").is_none());
    }
}
