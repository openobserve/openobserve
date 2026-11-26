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

use std::sync::Mutex;

use config::meta::{
    alerts::{
        incident_fields::ResolutionDetails,
        rca_runs::{RunMode, RunSubjectType, RunTrigger},
    },
    oncall::{
        ResponderRole, ResponseState, SubjectRef, SubjectType,
        response::ResolutionCause::{CapacityOrLoad, DependencyFailure},
    },
};
use infra::{
    race::{Barriers, Order, in_both_orders},
    table::{
        create_rca_feedback_for_test,
        entity::{
            alert_incidents as incident, alerts, folders, oncall_response_events as page_event,
            oncall_responses as page, rca_runs as run, rca_skipped_pages,
        },
    },
};
use sea_orm::{
    ColumnTrait, DatabaseBackend, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    Schema,
};

use super::*;
use crate::alerts::incidents::mitigations::tests::backends;

const ANA: &str = "ana@example.test";
const BEA: &str = "bea@example.test";
const UPSERT: &str = "rca_feedback_upsert";

struct Fixture<'a> {
    db: &'a DatabaseConnection,
    incident: incident::Model,
    run_id: String,
}

impl<'a> Fixture<'a> {
    async fn new(db: &'a DatabaseConnection) -> Self {
        let org = config::ider::generate();
        let txn = db.begin().await.unwrap();
        let incident = alert_incidents::insert_declared_in(
            &txn,
            alert_incidents::DeclaredIncident {
                org: &org,
                severity: "P3",
                title: "Checkout latency",
                groups: serde_json::json!({}),
                now: now_micros(),
                impact_start_at: None,
                source_fingerprint: None,
                owner_team_id: None,
                muted_by: None,
            },
        )
        .await
        .unwrap();
        txn.commit().await.unwrap();
        let run_id = rca_runs::new_run_id();
        let started = rca_runs::start_run_with(
            db,
            rca_runs::NewRun {
                run_id: run_id.clone(),
                org_id: org,
                incident_id: Some(incident.id.clone()),
                subject_type: RunSubjectType::Incident,
                subject_id: incident.id.clone(),
                trigger: RunTrigger::Manual,
                mode: RunMode::Fresh,
                started_by: ANA.to_owned(),
                guidance: None,
                oncall_subjects: None,
                context_used: None,
                recipients: Vec::new(),
                page_key: None,
            },
            rca_runs::StartGuards {
                now_us: now_micros(),
                rca_timeout_secs: 600,
                cooldown_us: None,
                history_limit: 10,
                latest_run_id: None,
                first_run: false,
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert!(matches!(started, rca_runs::StartResult::Started { .. }));
        Self {
            db,
            incident,
            run_id,
        }
    }

    fn key(&self) -> RunKey<'_> {
        RunKey {
            org: &self.incident.org_id,
            incident: &self.incident.id,
            run: &self.run_id,
        }
    }

    async fn post(&self, author: &str, verdict: &str) -> Vec<Feedback> {
        post_with(
            self.db,
            self.key(),
            writer(author),
            request(verdict),
            |_| async { Ok(()) },
        )
        .await
        .unwrap()
    }

    async fn events(&self) -> Vec<IncidentEvent> {
        incident_events::get_with(self.db, &self.incident.org_id, &self.incident.id)
            .await
            .unwrap()
    }
}

async fn databases(label: &str) -> Vec<DatabaseConnection> {
    let dbs = backends(label).await;
    for db in &dbs {
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(folders::Entity),
            schema.create_table_from_entity(alerts::Entity),
            schema.create_table_from_entity(run::Entity),
            schema.create_table_from_entity(page_event::Entity),
            schema.create_table_from_entity(rca_skipped_pages::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        create_rca_feedback_for_test(db).await.unwrap();
    }
    dbs
}

fn writer(email: &str) -> FeedbackActor<'_> {
    FeedbackActor {
        email,
        may_access_cases: false,
    }
}

fn request(verdict: &str) -> FeedbackRequest {
    FeedbackRequest {
        target_kind: TargetKind::Run,
        target_id: String::new(),
        verdict: verdict.to_owned(),
        cause_class: None,
        actual_cause: None,
        note: None,
    }
}

fn assert_same_author(a: &[Feedback], b: &[Feedback], final_rows: &[Feedback], later: &str) {
    let ([a], [b], [last]) = (a, b, final_rows) else {
        panic!("expected exactly one row in each response");
    };
    assert_eq!(a.id, b.id);
    assert_eq!(a.created_at, b.created_at);
    assert_ne!(a.updated_at, b.updated_at);
    assert_eq!(last.updated_at, a.updated_at.max(b.updated_at));
    assert_eq!(last.verdict, later);
    assert!(last.updated_at > last.created_at);
}

async fn assert_postgres_race(db: &DatabaseConnection) {
    let fixture = Fixture::new(db).await;
    let race = Barriers::new();
    race.arm(UPSERT, 2);
    let (a, b) = tokio::join!(
        race.run(fixture.post(ANA, "correct")),
        race.run(fixture.post(ANA, "wrong"))
    );
    race.assert_all_met();
    let events = fixture.events().await;
    let [first, last] = events.as_slice() else {
        panic!("both posts must commit an event");
    };
    assert!(matches!(
        first.event_type,
        IncidentEventType::FeedbackGiven { .. }
    ));
    let IncidentEventType::FeedbackGiven { verdict, .. } = &last.event_type else {
        panic!("expected feedback event");
    };
    let final_rows = list_with(db, fixture.key(), false).await.unwrap();
    assert_same_author(&a, &b, &final_rows, verdict);
    assert_eq!(fixture.post(BEA, "partly").await.len(), 2);
}

async fn assert_sqlite_orders(db: &DatabaseConnection) {
    let runs = in_both_orders(|order| async move {
        let fixture = std::sync::Arc::new(Fixture::new(db).await);
        let other = fixture.clone();
        let (first, last) = match order {
            Order::AThenB => ("correct", "wrong"),
            Order::BThenA => ("wrong", "correct"),
        };
        let race = Barriers::new();
        race.arm(UPSERT, 1);
        let other_race = race.clone();
        (
            async move {
                let a = race.run(fixture.post(ANA, "correct")).await;
                (fixture, race, a, first, last)
            },
            async move { other_race.run(other.post(ANA, "wrong")).await },
        )
    })
    .await;
    for run in runs {
        let (fixture, race, a, first, last) = run.a;
        race.assert_all_met();
        let final_rows = list_with(db, fixture.key(), false).await.unwrap();
        assert_same_author(&a, &run.b, &final_rows, last);
        let earlier = if first == "correct" { &a } else { &run.b };
        assert!(earlier[0].updated_at < final_rows[0].updated_at);
        assert_eq!(fixture.post(BEA, "partly").await.len(), 2);
    }
}

#[tokio::test]
async fn feedback_concurrent_same_author_one_row() {
    for db in databases("rca_feedback_race").await {
        match db.get_database_backend() {
            DatabaseBackend::Postgres => assert_postgres_race(&db).await,
            _ => assert_sqlite_orders(&db).await,
        }
    }
}

#[test]
fn feedback_validates_target_shape_and_verdict() {
    let kinds = [
        (
            TargetKind::Run,
            "",
            &["correct", "partly", "wrong", "cannot_tell"][..],
        ),
        (TargetKind::Hypothesis, "h2", &["accept", "reject"][..]),
        (
            TargetKind::Evidence,
            "e3",
            &["relevant", "irrelevant", "wrong_data"][..],
        ),
        (TargetKind::Step, "0", &["verified", "wrong"][..]),
        (
            TargetKind::Action,
            "1",
            &["helped", "no_effect", "not_tried"][..],
        ),
    ];
    for (kind, id, allowed) in kinds {
        for (_, _, verdicts) in kinds {
            for verdict in verdicts {
                let input = FeedbackRequest {
                    target_kind: kind,
                    target_id: id.to_owned(),
                    ..request(verdict)
                };
                assert_eq!(input.validate().is_ok(), allowed.contains(verdict));
            }
        }
        for bad_id in [" ", "h", "e", "h-1", "e_1", "-1", "a1"] {
            let input = FeedbackRequest {
                target_kind: kind,
                target_id: bad_id.to_owned(),
                ..request(allowed[0])
            };
            assert!(input.validate().is_err(), "{kind:?} {bad_id}");
        }
    }
    let mut input = request("wrong");
    input.actual_cause = Some("é".repeat(1000));
    assert!(input.validate().is_ok());
    input.actual_cause = Some("é".repeat(1001));
    assert!(input.validate().is_err());
}

#[tokio::test]
async fn feedback_checks_run_membership_and_snapshots_each_write() {
    for db in databases("rca_feedback_scope").await {
        let fixture = Fixture::new(&db).await;
        let other = Fixture::new(&db).await;
        for key in [
            RunKey {
                run: &other.run_id,
                ..fixture.key()
            },
            RunKey {
                org: &other.incident.org_id,
                ..fixture.key()
            },
            RunKey {
                incident: &other.incident.id,
                ..fixture.key()
            },
        ] {
            assert!(matches!(
                list_with(&db, key, false).await,
                Err(FeedbackError::NotFound)
            ));
            assert!(matches!(
                post_with(&db, key, writer(ANA), request("wrong"), |_| async {
                    panic!("published foreign run")
                })
                .await,
                Err(FeedbackError::NotFound)
            ));
        }
        let before = fixture.post(ANA, "correct").await;
        assert!(before[0].band.is_none() && before[0].outcome.is_none());
        let run_row = run::Entity::find_by_id(&fixture.run_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let mut running: run::ActiveModel = run_row.into();
        running.confidence = Set(Some("high".into()));
        running.outcome = Set(Some("root_cause_found".into()));
        running.update(&db).await.unwrap();
        let after = post_with(
            &db,
            fixture.key(),
            writer(ANA),
            request("wrong"),
            async |score| {
                assert_eq!(score.source_type, LlmScoreDataSourceType::Feedback);
                assert_eq!(score.value_categorical.as_deref(), Some("wrong"));
                assert_eq!(score.evaluation_key, "rca_feedback/run");
                assert_eq!(score.target_id, fixture.run_id);
                assert_eq!(score.author.as_deref(), Some(ANA));
                let rows = list_with(&db, fixture.key(), false).await.unwrap();
                assert_eq!(rows[0].verdict, "wrong");
                anyhow::bail!("publication unavailable")
            },
        )
        .await
        .unwrap();
        assert_eq!(after[0].band.as_deref(), Some("high"));
        assert_eq!(after[0].outcome.as_deref(), Some("root_cause_found"));
        assert_eq!(after[0].verdict, "wrong");
        assert_eq!(fixture.events().await.len(), 2);
    }
}

#[tokio::test]
async fn feedback_is_rolled_back_when_its_event_cannot_be_written() {
    for db in databases("rca_feedback_atomic").await {
        let fixture = Fixture::new(&db).await;
        db.execute_unprepared("DROP TABLE incident_events")
            .await
            .unwrap();
        let result = post_with(
            &db,
            fixture.key(),
            writer(ANA),
            request("wrong"),
            async |_| panic!("published feedback that did not commit"),
        )
        .await;
        assert!(matches!(result, Err(FeedbackError::Database(_))));
        assert!(
            list_with(&db, fixture.key(), false)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

#[tokio::test]
async fn reclassification_restricts_feedback_reads_and_writes() {
    for db in databases("feedback_case_write").await {
        let fixture = Fixture::new(&db).await;
        let RunKey { org, incident, .. } = fixture.key();
        fixture.post(ANA, "correct").await;
        let actor = writer(ANA);
        assert!(!fixture.incident.security_case);
        alert_incidents::mark_security_case_with(&db, org, incident)
            .await
            .unwrap();

        let feedback = post_with(&db, fixture.key(), actor, request("wrong"), async |_| {
            panic!("published feedback for a restricted case")
        })
        .await;
        assert!(matches!(feedback, Err(FeedbackError::CaseAccessDenied)));
        let cause = CauseRequest {
            cause_class: CapacityOrLoad,
            cause_text: "Load increased".into(),
        };
        let review = confirm_in(&db, org, incident, actor, &cause).await;
        assert!(matches!(review, Err(FeedbackError::CaseAccessDenied)));
        assert!(matches!(
            list_with(&db, fixture.key(), false).await,
            Err(FeedbackError::CaseAccessDenied)
        ));
        let rows = list_with(&db, fixture.key(), true).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].verdict, "correct");
        assert_eq!(fixture.events().await.len(), 1);
    }
}

#[tokio::test]
async fn feedback_org_cleanup_removes_only_that_org() {
    for db in databases("rca_feedback_cleanup").await {
        let fixture = Fixture::new(&db).await;
        let other = Fixture::new(&db).await;
        fixture.post(ANA, "correct").await;
        other.post(ANA, "wrong").await;
        rca_feedback::delete_by_org(&db, &fixture.incident.org_id)
            .await
            .unwrap();
        assert!(
            list_with(&db, fixture.key(), false)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(list_with(&db, other.key(), false).await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn cause_confirms_twice_then_resolve_with_a_different_cause() {
    for db in databases("cause_confirm_resolve").await {
        let fixture = Fixture::new(&db).await;
        let RunKey { org, incident, .. } = fixture.key();
        let first = confirm_in(
            &db,
            org,
            incident,
            writer(ANA),
            &CauseRequest {
                cause_class: CapacityOrLoad,
                cause_text: "Load increased".into(),
            },
        )
        .await
        .unwrap();
        let first = first.incident;
        assert_eq!(first.resolution_cause.as_deref(), Some("capacity_or_load"));
        assert_eq!(first.cause_reviewed_by.as_deref(), Some(ANA));
        assert!(first.cause_reviewed_at.is_some());
        assert!(matches!(
            fixture.events().await.as_slice(),
            [IncidentEvent {
                event_type: IncidentEventType::CauseReviewed {
                    cause_class: CapacityOrLoad,
                    ..
                },
                ..
            }]
        ));

        let second = confirm_in(
            &db,
            org,
            incident,
            writer(BEA),
            &CauseRequest {
                cause_class: DependencyFailure,
                cause_text: "Dependency timed out".into(),
            },
        )
        .await
        .unwrap();
        let second = second.incident;
        assert_eq!(
            second.resolution_cause.as_deref(),
            Some("dependency_failure")
        );
        assert_eq!(second.cause_reviewed_by.as_deref(), Some(BEA));
        assert!(second.resolution_note.is_none());
        assert!(matches!(
            fixture.events().await.as_slice(),
            [
                IncidentEvent {
                    event_type: IncidentEventType::CauseReviewed {
                        cause_class: CapacityOrLoad,
                        ..
                    },
                    ..
                },
                IncidentEvent {
                    event_type: IncidentEventType::CauseReviewed {
                        cause_class: DependencyFailure,
                        ..
                    },
                    ..
                },
            ]
        ));

        let resolved = alert_incidents::update_resolution_with(
            &db,
            org,
            incident,
            ANA,
            &ResolutionDetails {
                resolution_cause: Some(CapacityOrLoad),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(resolved.status, "resolved");
        assert_eq!(
            resolved.resolution_cause.as_deref(),
            Some("capacity_or_load")
        );
        assert!(resolved.cause_reviewed_by.is_none());
        assert!(resolved.cause_reviewed_at.is_none());
        assert!(matches!(
            fixture.events().await.last().unwrap().event_type,
            IncidentEventType::ResolutionRecorded { .. }
        ));
        assert_eq!(fixture.events().await.len(), 3);
    }
}

async fn page_record(
    fixture: &Fixture<'_>,
    state: ResponseState,
    note: Option<&str>,
) -> page::Model {
    let now = now_micros();
    let id = config::ider::uuid();
    let subject = SubjectRef::new(SubjectType::Incident, id.as_str(), 1);
    page::ActiveModel {
        id: Set(id),
        org_id: Set(fixture.incident.org_id.clone()),
        subject_type: Set(subject.subject_type.to_i32()),
        subject_id: Set(subject.subject_id()),
        team_id: Set(Some("checkout".into())),
        title: Set(Some("Checkout team".into())),
        cause: Set(None),
        cause_note: Set(note.map(str::to_owned)),
        snoozed_until: Set(None),
        ladder_anchor: Set(Some(now)),
        ladder_run: Set(Some(1)),
        responder_role: Set(ResponderRole::Owner.to_i32()),
        origin_response_id: Set(None),
        priority: Set(3),
        state: Set(state.to_i32()),
        opened_at: Set(now),
        acked_by: Set(None),
        acked_at: Set(None),
        closed_at: Set((state == ResponseState::Resolved).then_some(now)),
        incident_id: Set(Some(fixture.incident.id.clone())),
        runbook_url: Set(None),
        exhausted_at: Set(None),
        updated_at: Set(now),
    }
    .insert(fixture.db)
    .await
    .unwrap()
}

#[tokio::test]
async fn cause_cascades_to_closed_causeless_pages_only() {
    for db in databases("cause_oncall_cascade").await {
        let fixture = Fixture::new(&db).await;
        let closed = page_record(&fixture, ResponseState::Resolved, None).await;
        let open = page_record(&fixture, ResponseState::Triggered, None).await;
        let responder =
            page_record(&fixture, ResponseState::Resolved, Some("Responder cause")).await;
        let org = &fixture.incident.org_id;
        let cause = CauseRequest {
            cause_class: DependencyFailure,
            cause_text: "Dependency timed out".into(),
        };
        let reviewed = confirm_in(&db, org, &fixture.incident.id, writer(ANA), &cause)
            .await
            .unwrap();
        let resolved = Mutex::new(Vec::new());
        let db_ref = &db;
        let cause_text = cause.cause_text.as_str();
        let fence = CauseFence::new(db_ref, &reviewed, None);
        cascade_with(db_ref, &reviewed, &fence, |candidate| {
            // Count attempts too, so omitting the closed filter cannot pass via the write guard.
            resolved.lock().unwrap().push(candidate.id.clone());
            async move {
                oncall_responses::resolve_as_with(
                    db_ref,
                    org,
                    &candidate.id,
                    ANA,
                    Some(cause.cause_class),
                    Some(cause_text),
                )
                .await?
                .ok_or_else(|| anyhow::anyhow!("page disappeared"))
            }
        })
        .await;
        assert_eq!(resolved.into_inner().unwrap(), [closed.id.clone()]);
        let after = page::Entity::find_by_id(&closed.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.cause.as_deref(), Some("dependency_failure"));
        assert_eq!(after.cause_note.as_deref(), Some("Dependency timed out"));
        assert_eq!(after.closed_at, closed.closed_at);
        assert_eq!(
            page_event::Entity::find()
                .filter(page_event::Column::ResponseId.eq(&closed.id))
                .count(&db)
                .await
                .unwrap(),
            0
        );
        let after_open = page::Entity::find_by_id(&open.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after_open, open);
        let live = oncall_responses::list_for_incident_with(&db, org, &fixture.incident.id)
            .await
            .unwrap();
        assert!(
            live.iter()
                .any(|page| page.id == open.id && page.is_escalating())
        );
        assert_eq!(
            page::Entity::find_by_id(&responder.id)
                .one(&db)
                .await
                .unwrap()
                .unwrap(),
            responder,
        );
    }
}

#[tokio::test]
async fn cause_cascade_refuses_a_concurrent_responder_edit() {
    for db in databases("cause_oncall_revision").await {
        let fixture = Fixture::new(&db).await;
        let closed = page_record(&fixture, ResponseState::Resolved, None).await;
        let org = &fixture.incident.org_id;
        let [read] = oncall_responses::list_for_incident_with(&db, org, &fixture.incident.id)
            .await
            .unwrap()
            .try_into()
            .unwrap();
        let edited = oncall_responses::resolve_as_with(
            &db,
            org,
            &closed.id,
            BEA,
            Some(CapacityOrLoad),
            Some("Responder cause"),
        )
        .await
        .unwrap()
        .unwrap();
        let cause = CauseRequest {
            cause_class: DependencyFailure,
            cause_text: "Reviewer's cause".into(),
        };
        let review = confirm_in(&db, org, &fixture.incident.id, writer(ANA), &cause)
            .await
            .unwrap();
        let stale = oncall_responses::with_closed_causeless_record(
            &read,
            &review.transition_id,
            oncall_responses::resolve_as_with(
                &db,
                org,
                &closed.id,
                ANA,
                Some(DependencyFailure),
                Some("Reviewer's cause"),
            ),
        )
        .await;
        assert!(matches!(stale, Err(infra::errors::Error::OtherError(error))
            if error.is::<oncall_responses::ResponseConflict>()));
        let after = page::Entity::find_by_id(&closed.id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.updated_at, edited.updated_at);
        assert_eq!(after.cause_note.as_deref(), Some("Responder cause"));
    }
}

#[tokio::test]
async fn superseded_cause_stops_cascade_and_notice_and_cannot_write_the_page() {
    for db in databases("cause_superseded").await {
        let fixture = Fixture::new(&db).await;
        let RunKey { org, incident, .. } = fixture.key();
        let closed = page_record(&fixture, ResponseState::Resolved, None).await;
        let first = CauseRequest {
            cause_class: CapacityOrLoad,
            cause_text: "Load increased".into(),
        };
        let first_review = confirm_in(&db, org, incident, writer(ANA), &first)
            .await
            .unwrap();
        let fence = CauseFence::new(&db, &first_review, None);
        assert!(fence.check_current().await.is_ok());
        let [page] = oncall_responses::list_for_incident_with(&db, org, incident)
            .await
            .unwrap()
            .try_into()
            .unwrap();

        let second = CauseRequest {
            cause_class: DependencyFailure,
            cause_text: "Dependency timed out".into(),
        };
        let second_review = confirm_in(&db, org, incident, writer(BEA), &second)
            .await
            .unwrap();
        cascade_with(&db, &first_review, &fence, |_| async {
            panic!("resolved on-call with a superseded cause")
        })
        .await;
        assert!(fence.check_current().await.is_err());
        let current = CauseFence::new(&db, &second_review, None);
        assert!(current.check_current().await.is_ok());
        let (_lease, lost) = tokio::sync::watch::channel(true);
        let expired_fence = CauseFence::new(&db, &second_review, Some(lost));
        assert!(expired_fence.check_current().await.is_err());

        let stale_write = oncall_responses::with_closed_causeless_record(
            &page,
            &first_review.transition_id,
            oncall_responses::resolve_as_with(
                &db,
                org,
                &closed.id,
                ANA,
                Some(first.cause_class),
                Some(&first.cause_text),
            ),
        )
        .await;
        assert!(
            matches!(stale_write, Err(infra::errors::Error::OtherError(error))
            if error.is::<oncall_responses::ResponseConflict>())
        );
        assert_eq!(
            page::Entity::find_by_id(&closed.id)
                .one(&db)
                .await
                .unwrap()
                .unwrap(),
            closed
        );
    }
}

#[tokio::test]
async fn correcting_a_reviewed_cause_on_a_closed_incident_preserves_its_close() {
    for db in databases("closed_cause_correction").await {
        let fixture = Fixture::new(&db).await;
        let RunKey { org, incident, .. } = fixture.key();
        let closed = alert_incidents::update_status_with(&db, org, incident, "resolved")
            .await
            .unwrap();
        let cause = CauseRequest {
            cause_class: CapacityOrLoad,
            cause_text: "Load increased".into(),
        };
        confirm_in(&db, org, incident, writer(ANA), &cause)
            .await
            .unwrap();

        let replacement = ResolutionDetails {
            resolution_cause: Some(DependencyFailure),
            ..Default::default()
        };
        for _ in 0..2 {
            let corrected =
                alert_incidents::update_resolution_with(&db, org, incident, BEA, &replacement)
                    .await
                    .unwrap();
            assert_eq!(corrected.resolved_at, closed.resolved_at);
            assert_eq!(
                corrected.resolution_cause.as_deref(),
                Some("dependency_failure")
            );
            assert!(corrected.cause_reviewed_by.is_none() && corrected.cause_reviewed_at.is_none());
        }
        assert_eq!(fixture.events().await.len(), 2);
    }
}

#[tokio::test]
async fn second_confirm_sends_an_update_once_to_each_incident_destination() {
    use common::infra::config::DESTINATIONS;
    use config::meta::destinations::Destination;

    for db in databases("cause_notice").await {
        let fixture = Fixture::new(&db).await;
        let RunKey { org, incident, .. } = fixture.key();
        let folder_pk = config::ider::uuid();
        folders::ActiveModel {
            id: Set(folder_pk.clone()),
            org: Set(org.to_owned()),
            folder_id: Set("default".to_owned()),
            name: Set("Default".to_owned()),
            description: Set(None),
            icon: Set(None),
            r#type: Set(1),
        }
        .insert(&db)
        .await
        .unwrap();
        // Entity-built tables lack the migration column defaults, so every NOT NULL column is set.
        let alert_id = config::ider::generate();
        alerts::ActiveModel {
            id: Set(alert_id.clone()),
            org: Set(org.to_owned()),
            folder_id: Set(folder_pk),
            name: Set("checkout".to_owned()),
            stream_type: Set("logs".to_owned()),
            stream_name: Set("default".to_owned()),
            is_real_time: Set(false),
            destinations: Set(serde_json::json!([
                "engineering",
                "operations",
                "engineering"
            ])),
            row_template_type: Set(0),
            enabled: Set(true),
            tz_offset: Set(0),
            query_type: Set(0),
            trigger_threshold_operator: Set(">".to_owned()),
            trigger_period_seconds: Set(60),
            trigger_threshold_count: Set(1),
            trigger_frequency_type: Set(0),
            trigger_frequency_seconds: Set(300),
            trigger_silence_seconds: Set(600),
            align_time: Set(false),
            dedup_enabled: Set(false),
            creates_incident: Set(true),
            workflows: Set(serde_json::json!([])),
            pending_period_sec: Set(0),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();
        alert_incidents::add_firing_once_with(
            &db,
            org,
            incident,
            &alert_incidents::FirstAlert {
                alert_id: &alert_id,
                alert_name: "checkout",
                alert_kind: "internal",
                correlation_reason: "service",
                labels: None,
                severity: None,
            },
            now_micros(),
        )
        .await
        .unwrap();
        let destination_names = ["engineering", "operations", "new-destination"];
        for name in destination_names {
            DESTINATIONS.insert(
                format!("{org}/{name}"),
                Destination {
                    org_id: org.to_owned(),
                    name: name.to_owned(),
                    ..Default::default()
                },
            );
        }
        let notices = Mutex::new(Vec::new());
        let notices_ref = &notices;
        let mut first_review = None;
        for (actor, cause) in [
            (
                ANA,
                CauseRequest {
                    cause_class: CapacityOrLoad,
                    cause_text: "Load increased".into(),
                },
            ),
            (
                BEA,
                CauseRequest {
                    cause_class: DependencyFailure,
                    cause_text: "Dependency timed out".into(),
                },
            ),
        ] {
            let confirmation = confirm_with(
                &db,
                org,
                incident,
                writer(actor),
                &cause,
                |recipient, message, _ctx| async move {
                    let _turn = tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        super::super::incident_turn(incident).lock(),
                    )
                    .await
                    .expect("cause notice must send after the incident turn ends");
                    let slot = CauseNoticeSlot((org.to_owned(), incident.to_owned()));
                    assert!(slot.mutex().try_lock().is_err());
                    notices_ref
                        .lock()
                        .unwrap()
                        .push((recipient.destination.name, message));
                    Ok(())
                },
            )
            .await
            .unwrap();
            if actor == ANA {
                first_review = Some((confirmation, cause));
                alerts::Entity::update_many()
                    .col_expr(
                        alerts::Column::Destinations,
                        sea_orm::sea_query::Expr::value(serde_json::json!(["new-destination"])),
                    )
                    .filter(alerts::Column::Id.eq(&alert_id))
                    .exec(&db)
                    .await
                    .unwrap();
            }
        }
        let (review, cause) = first_review.unwrap();
        let fence = CauseFence::new(&db, &review, None);
        send_cause_notice(&fence, &cause, |_, _, _| async {
            panic!("sent a superseded cause notice")
        })
        .await;
        for name in destination_names {
            DESTINATIONS.remove(&format!("{org}/{name}"));
        }

        let sent = notices.into_inner().unwrap();
        let sent: Vec<_> = sent
            .iter()
            .map(|(destination, message)| (destination.as_str(), message.as_str()))
            .collect();
        let first = "Cause confirmed for Checkout latency: capacity_or_load. Load increased";
        let second = "Cause updated for Checkout latency: dependency_failure. Dependency timed out";
        assert_eq!(
            sent,
            [
                ("engineering", first),
                ("operations", first),
                ("engineering", second),
                ("operations", second),
            ]
        );
    }
}

#[tokio::test]
async fn oversized_cause_text_does_not_change_incident_or_timeline() {
    for db in databases("cause_text_limit").await {
        let fixture = Fixture::new(&db).await;
        let RunKey { org, incident, .. } = fixture.key();
        let cause = CauseRequest {
            cause_class: CapacityOrLoad,
            cause_text: "é".repeat(1001),
        };
        assert!(matches!(
            confirm_in(&db, org, incident, writer(ANA), &cause).await,
            Err(FeedbackError::BadRequest(_))
        ));
        let row = alert_incidents::get_with(&db, org, incident)
            .await
            .unwrap()
            .unwrap();
        assert!(row.cause_reviewed_at.is_none() && row.resolution_cause.is_none());
        assert!(fixture.events().await.is_empty());
    }
}
