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

use infra::{
    race::{Barriers, in_both_orders},
    table::{
        create_incident_recovery_checks_for_test,
        entity::{
            alert_acks, alert_incident_alerts as members, incident_events as timeline,
            incident_recovery_checks as check, oncall_responses, system_settings,
        },
        sqlite_and_postgres_for_test,
    },
};
use sea_orm::{ConnectionTrait, DatabaseBackend, Schema};
use serde_json::{Value, json};

use super::*;

const POINT: &str = "mitigations.before_budget_lock";

#[cfg(feature = "enterprise")]
pub(in crate::alerts::incidents) struct RecoveryFixtureSpec {
    pub scope_count: usize,
    pub pass_window_secs: i32,
    pub soak_secs: i32,
    pub missing_slo_id: Option<String>,
}

pub(in crate::alerts::incidents) async fn backends(label: &str) -> Vec<DatabaseConnection> {
    let dbs = sqlite_and_postgres_for_test(label).await;
    for db in &dbs {
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(incident::Entity),
            schema.create_table_from_entity(alert_acks::Entity),
            schema.create_table_from_entity(members::Entity),
            schema.create_table_from_entity(timeline::Entity),
            schema.create_table_from_entity(system_settings::Entity),
            schema.create_table_from_entity(oncall_responses::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        create_incident_recovery_checks_for_test(db).await.unwrap();
    }
    dbs
}

#[cfg(feature = "enterprise")]
pub(in crate::alerts::incidents) async fn record_recovery_fixture(
    db: &DatabaseConnection,
    org: &str,
    spec: RecoveryFixtureSpec,
) -> (incident::Model, Recorded) {
    record_recovery_fixture_with_sources(db, org, spec, &[]).await
}

#[cfg(feature = "enterprise")]
pub(in crate::alerts::incidents) async fn record_recovery_fixture_with_sources(
    db: &DatabaseConnection,
    org: &str,
    spec: RecoveryFixtureSpec,
    sources: &[crate::authz::QuerySource],
) -> (incident::Model, Recorded) {
    let row = new_incident(db, org).await;
    let recorded = record_recovery_fixture_for_with_sources(db, &row, spec, sources).await;
    (row, recorded)
}

#[cfg(feature = "enterprise")]
pub(in crate::alerts::incidents) async fn record_recovery_fixture_for(
    db: &DatabaseConnection,
    row: &incident::Model,
    spec: RecoveryFixtureSpec,
) -> Recorded {
    record_recovery_fixture_for_with_sources(db, row, spec, &[]).await
}

#[cfg(feature = "enterprise")]
pub(in crate::alerts::incidents) async fn record_without_watch(
    db: &DatabaseConnection,
    org: &str,
) -> incident::Model {
    let row = new_incident(db, org).await;
    record_with(
        db,
        &row,
        "ana",
        request(None, None),
        async |_| Ok(PreparedWatch::None),
        50,
    )
    .await
    .unwrap();
    alert_incidents::get_with(db, org, &row.id)
        .await
        .unwrap()
        .unwrap()
}

#[cfg(feature = "enterprise")]
pub(in crate::alerts::incidents) async fn assert_recovery_retract_refused(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
    attempt: &str,
) {
    let outcome = retract_with(db, (org, id), attempt, "ana", false, 50, async |_| Ok(())).await;
    assert!(matches!(
        outcome,
        Err(MitigationError::Refused(Refusal::InvalidTransition))
    ));
}

#[cfg(feature = "enterprise")]
async fn record_recovery_fixture_for_with_sources(
    db: &DatabaseConnection,
    row: &incident::Model,
    spec: RecoveryFixtureSpec,
    sources: &[crate::authz::QuerySource],
) -> Recorded {
    if spec.scope_count > 1 {
        for scope in 0..spec.scope_count {
            alert_incidents::add_firing_once_with(
                db,
                &row.org_id,
                &row.id,
                &alert_incidents::FirstAlert {
                    alert_id: &config::ider::generate(),
                    alert_name: "Error rate",
                    alert_kind: "internal",
                    correlation_reason: "service",
                    labels: Some(&json!({"region": format!("region-{scope}")}).to_string()),
                    severity: None,
                },
                row.first_alert_at,
            )
            .await
            .unwrap();
        }
    }
    record_with(
        db,
        row,
        "ana",
        request(None, None),
        async |row: &incident::Model| {
            let inputs = watch_inputs(db, row, None).await?;
            let (source, numerator, denominator) = if spec.missing_slo_id.is_some() {
                ("slo", "good", "total")
            } else {
                (
                    "query",
                    "SELECT count(*) FROM requests WHERE status >= 500",
                    "SELECT count(*) FROM requests",
                )
            };
            let measured = inputs
                .regions
                .iter()
                .map(|region| Check {
                    source: source.to_owned(),
                    source_ref: spec.missing_slo_id.clone(),
                    target: json!({
                        "signal": "logs", "stream_type": "logs",
                        "start_us": 0, "end_us": 0, "sources": sources
                    })
                    .to_string(),
                    scope: region.as_ref().map(|r| json!({"region":r}).to_string()),
                    measure: json!({
                        "kind": "ratio", "cv": 1, "unit": "%", "reducer": "sum",
                        "numerator": numerator, "denominator": denominator,
                        "volume_probe": denominator
                    })
                    .to_string(),
                    baseline_volume: Some(100.0),
                    pass_window_secs: spec.pass_window_secs,
                    soak_secs: spec.soak_secs,
                    ..check(row)
                })
                .collect();
            Ok(PreparedWatch::Checks(measured, inputs))
        },
        50,
    )
    .await
    .unwrap()
}

async fn new_incident(db: &DatabaseConnection, org: &str) -> incident::Model {
    declare_and_ack(db, org, json!({})).await
}

async fn declare_and_ack(db: &DatabaseConnection, org: &str, groups: Value) -> incident::Model {
    let txn = db.begin().await.unwrap();
    let row = alert_incidents::insert_declared_in(
        &txn,
        alert_incidents::DeclaredIncident {
            org,
            severity: "P3",
            title: "Recovery test",
            groups,
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
    alert_incidents::acknowledge_with(db, org, &row.id, "lead")
        .await
        .unwrap()
        .unwrap()
}

fn check(row: &incident::Model) -> Check {
    Check {
        id: config::ider::generate(),
        org_id: row.org_id.clone(),
        incident_id: row.id.clone(),
        attempt_id: config::ider::generate(),
        source: "query".into(),
        target: "{}".into(),
        measure: "{}".into(),
        volume_floor_pct: 50,
        comparator: "gt".into(),
        alert_threshold: 2.0,
        recover_threshold: 1.0,
        pass_window_secs: 90,
        soak_secs: 900,
        state: "checking".into(),
        expect_effect_secs: 720,
        recent_samples: "[]".into(),
        created_by: "ana".into(),
        generation: 1,
        ..Default::default()
    }
}

async fn prepared_check(
    db: &DatabaseConnection,
    row: &incident::Model,
) -> Result<PreparedWatch, MitigationError> {
    let inputs = watch_inputs(db, row, None).await?;
    Ok(PreparedWatch::Checks(vec![check(row)], inputs))
}

fn request(expected: Option<&str>, supersede: Option<&str>) -> RecordRequest {
    RecordRequest {
        summary: "Rolled back".into(),
        kind: "rollback".into(),
        option_key: Some("deploy:1".into()),
        command: None,
        source_ref: None,
        observed_ref: None,
        expected_attempt_id: expected.map(str::to_owned),
        supersede_attempt_id: supersede.map(str::to_owned),
        expect_effect_secs: None,
        watch: None,
    }
}

async fn record_check(
    db: &DatabaseConnection,
    row: &incident::Model,
    who: &str,
) -> Result<Recorded, MitigationError> {
    record_with(
        db,
        row,
        who,
        request(None, None),
        async |row: &incident::Model| prepared_check(db, row).await,
        50,
    )
    .await
}

async fn race_fixture(db: &DatabaseConnection, budget: bool) -> (incident::Model, incident::Model) {
    let org = config::ider::generate();
    let a = new_incident(db, &org).await;
    if !budget {
        return (a.clone(), a);
    }
    let backlog = new_incident(db, &org).await;
    let txn = db.begin().await.unwrap();
    for _ in 0..49 {
        checks::insert_in(&txn, check(&backlog), 1).await.unwrap();
    }
    txn.commit().await.unwrap();
    (a, new_incident(db, &org).await)
}

async fn recovery_race(db: &DatabaseConnection, budget: bool) {
    let run = |row, who| async move {
        let recorded = record_check(db, &row, who).await;
        (row, recorded)
    };
    if db.get_database_backend() == DatabaseBackend::Postgres {
        let (a, b) = race_fixture(db, budget).await;
        let barriers = Barriers::new();
        barriers.arm(POINT, 2);
        let ((row, a), (_, b)) = barriers
            .run(async { tokio::join!(run(a, "ana"), run(b, "bea")) })
            .await;
        barriers.assert_all_met();
        assert_race(db, &row, a, b, budget).await;
    } else {
        for result in in_both_orders(|_| async {
            let (a, b) = race_fixture(db, budget).await;
            (run(a, "ana"), run(b, "bea"))
        })
        .await
        {
            let (row, a) = result.a;
            assert_race(db, &row, a, result.b.1, budget).await;
        }
    }
}

async fn assert_race(
    db: &DatabaseConnection,
    row: &incident::Model,
    a: Result<Recorded, MitigationError>,
    b: Result<Recorded, MitigationError>,
    budget: bool,
) {
    let live = checks::count_live_org(db, &row.org_id).await.unwrap();
    if budget {
        let (a, b) = (a.unwrap(), b.unwrap());
        assert_eq!(live, 50);
        assert_eq!(a.check_ids.len() + b.check_ids.len(), 1);
        assert_eq!(
            a.watch_refused.or(b.watch_refused).as_deref(),
            Some("budget")
        );
    } else {
        assert_eq!(live, 1);
        let (winner, loser) = if a.is_ok() { (a, b) } else { (b, a) };
        let winner = winner.unwrap();
        let MitigationError::Current(conflict) = loser.unwrap_err() else {
            panic!("expected one record and one attempt conflict");
        };
        assert_eq!(
            conflict.attempt_id.as_deref(),
            Some(winner.attempt_id.as_str())
        );
        assert_eq!(conflict.targets.len(), 1);
    }
}

#[tokio::test]
async fn r17_concurrent_records_one_attempt() {
    for db in backends("recovery_r17").await {
        recovery_race(&db, false).await;
    }
}

#[tokio::test]
async fn budget_lock_caps_org_checks() {
    for db in backends("recovery_budget").await {
        recovery_race(&db, true).await;
    }
}

#[tokio::test]
async fn mitigation_r17_conflict_confirmation_expiry_and_replay() {
    for db in backends("recovery_conflict").await {
        let row = new_incident(&db, "acme").await;
        let record = |actor: &'static str, expected: Option<&str>, confirm: Option<&str>| {
            record_with(
                &db,
                &row,
                actor,
                request(expected, confirm),
                async |_| Ok(PreparedWatch::None),
                50,
            )
        };
        let first = record("ana", None, None).await.unwrap();
        let replay = record("ana", None, None).await.unwrap();
        assert_eq!(replay.attempt_id, first.attempt_id);
        for confirm in [None, Some("old-attempt")] {
            let err = record("bea", Some(&first.attempt_id), confirm)
                .await
                .unwrap_err();
            let MitigationError::Current(details) = err else {
                panic!("{err:?}")
            };
            let body: Value = serde_json::to_value(details).unwrap();
            assert_eq!(body["attempt_id"], first.attempt_id);
            assert_eq!(body["applied_by"], "ana");
            assert_eq!(body["at"], first.fix_applied_at);
            assert_eq!(body["summary"], "Rolled back");
            assert!(body["check_at"].is_null());
            assert!(body.get("value").is_none());
        }
        let stored = alert_incidents::get_with(&db, "acme", &row.id)
            .await
            .unwrap()
            .unwrap();
        let mut active: incident::ActiveModel = stored.into();
        active.fix_applied_at = Set(Some(first.fix_applied_at - REPLAY_WINDOW));
        active.update(&db).await.unwrap();
        assert!(matches!(
            record("bea", None, None).await,
            Err(MitigationError::Current(_))
        ));
        let second = record("bea", Some(&first.attempt_id), None).await.unwrap();
        assert_ne!(first.attempt_id, second.attempt_id);
    }
}

#[tokio::test]
async fn mitigation_distinct_manual_fix_with_stale_attempt_is_a_conflict() {
    for db in backends("mitigation_distinct_manual_fix").await {
        let row = new_incident(&db, "acme").await;
        let record = |summary: &str, kind: &str| {
            record_with(
                &db,
                &row,
                "ana",
                RecordRequest {
                    summary: summary.to_owned(),
                    kind: kind.to_owned(),
                    option_key: None,
                    ..request(None, None)
                },
                async |_| Ok(PreparedWatch::None),
                50,
            )
        };
        let first = record("Restarted checkout workers", "restart")
            .await
            .unwrap();
        let error = record("Raised checkout connection limits", "config")
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            MitigationError::Current(current)
                if current.attempt_id.as_deref() == Some(first.attempt_id.as_str())
        ));
    }
}

#[tokio::test]
async fn mitigation_identical_manual_fix_with_stale_attempt_is_a_replay() {
    for db in backends("mitigation_manual_replay").await {
        let row = new_incident(&db, "acme").await;
        let record = || {
            record_with(
                &db,
                &row,
                "ana",
                RecordRequest {
                    summary: "Restarted checkout workers".into(),
                    kind: "restart".into(),
                    command: Some("restart checkout".into()),
                    option_key: None,
                    ..request(None, None)
                },
                async |_| Ok(PreparedWatch::None),
                50,
            )
        };
        let first = record().await.unwrap();
        let replay = record().await.unwrap();
        assert_eq!(replay.attempt_id, first.attempt_id);
        let events = incident_events::get_with(&db, &row.org_id, &row.id)
            .await
            .unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event.event_type, IncidentEventType::FixApplied { .. }))
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn mitigation_retract_permissions_eligibility_and_revival() {
    for db in backends("recovery_retract").await {
        let row = new_incident(&db, "acme").await;
        let first = record_check(&db, &row, "ana").await.unwrap();
        let second = record_with(
            &db,
            &row,
            "bea",
            request(Some(&first.attempt_id), Some(&first.attempt_id)),
            async |_| Ok(PreparedWatch::None),
            50,
        )
        .await
        .unwrap();
        let retract = |attempt: &str, actor: &'static str, admin| {
            let attempt = attempt.to_owned();
            let (db, id) = (&db, row.id.as_str());
            async move {
                retract_with(db, ("acme", id), &attempt, actor, admin, 50, async |_| {
                    Ok(())
                })
                .await
            }
        };
        assert!(matches!(
            retract(&second.attempt_id, "cai", false).await,
            Err(MitigationError::Forbidden)
        ));
        assert!(matches!(
            retract(&first.attempt_id, "cai", true).await,
            Err(MitigationError::Refused(_))
        ));
        let revived = retract(&second.attempt_id, "cai", true)
            .await
            .unwrap()
            .revived_attempt_id
            .unwrap();
        assert_ne!(revived, first.attempt_id);
        let rows = checks::list(&db, "acme", &row.id).await.unwrap();
        let restored = rows.iter().find(|r| r.attempt_id == revived).unwrap();
        assert_eq!(
            (
                restored.generation,
                restored.trigger_at,
                restored.expect_effect_secs
            ),
            (1, first.fix_applied_at, 720)
        );
        let old = rows
            .iter()
            .find(|r| r.attempt_id == first.attempt_id)
            .unwrap();
        assert_eq!((old.state.as_str(), old.generation), ("superseded", 2));
        let mut active: check::ActiveModel = restored.clone().into();
        active.verified_at = Set(Some(10));
        let verified = active.update(&db).await.unwrap();
        assert!(matches!(
            retract(&revived, "ana", false).await,
            Err(MitigationError::Refused(_))
        ));
        let mut active: check::ActiveModel = verified.into();
        active.verified_at = Set(None);
        active.update(&db).await.unwrap();
        let stored = alert_incidents::get_with(&db, "acme", &row.id)
            .await
            .unwrap()
            .unwrap();
        let mut active: incident::ActiveModel = stored.into();
        active.not_recovering_at = Set(Some(10));
        let latched = active.update(&db).await.unwrap();
        assert!(matches!(
            retract(&revived, "ana", false).await,
            Err(MitigationError::Refused(_))
        ));
        let mut active: incident::ActiveModel = latched.into();
        active.not_recovering_at = Set(None);
        active.assigned_to = Set(Some("lead".to_owned()));
        active.update(&db).await.unwrap();
        assert!(retract(&revived, "lead", false).await.unwrap().retracted);
        let observed = record_check(&db, &row, "ana").await.unwrap();
        let txn = db.begin().await.unwrap();
        append(
            &txn,
            &row,
            now_micros(),
            IncidentEventType::Unknown(json!({
                "type": "RollbackObserved", "data": {"attempt_id": observed.attempt_id},
            })),
        )
        .await
        .unwrap();
        txn.commit().await.unwrap();
        assert!(matches!(
            retract(&observed.attempt_id, "ana", false).await,
            Err(MitigationError::Refused(_))
        ));
    }
}

#[tokio::test]
async fn mitigation_claims_are_idempotent_and_closed_incidents_refuse_writes() {
    for db in backends("recovery_claim").await {
        let row = new_incident(&db, "acme").await;
        let claim = |who, option: &str| {
            claim_with(
                &db,
                "acme",
                &row.id,
                who,
                ClaimRequest {
                    option_key: option.to_owned(),
                    summary: "Investigating".to_owned(),
                },
            )
        };
        let a = claim("ana", "deploy:1").await.unwrap();
        assert_eq!(
            claim("ana", "deploy:1").await.unwrap().expires_at,
            a.expires_at
        );
        claim("bea", "deploy:1").await.unwrap();
        claim("ana", "deploy:2").await.unwrap();
        assert_eq!(
            incident_events::get_with(&db, "acme", &row.id)
                .await
                .unwrap()
                .len(),
            3
        );
        let resolved = alert_incidents::update_status_with(&db, "acme", &row.id, "resolved")
            .await
            .unwrap();
        assert!(matches!(
            claim("ana", "deploy:1").await,
            Err(MitigationError::Refused(Refusal::Resolved))
        ));
        assert!(matches!(
            record_check(&db, &row, "ana").await,
            Err(MitigationError::Refused(Refusal::Resolved))
        ));
        let mut active: incident::ActiveModel = resolved.into();
        active.merged_into_id = Set(Some(config::ider::generate()));
        active.update(&db).await.unwrap();
        assert!(matches!(
            claim("ana", "deploy:1").await,
            Err(MitigationError::Refused(Refusal::MergedAway))
        ));
        assert!(matches!(
            record_check(&db, &row, "ana").await,
            Err(MitigationError::Refused(Refusal::MergedAway))
        ));
        assert!(
            alert_incidents::update_status_with(&db, "acme", &row.id, "open")
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn recovery_resolve_preserves_soak_and_reopen_fences_every_row() {
    for db in backends("recovery_status").await {
        let row = new_incident(&db, "acme").await;
        let recorded = record_check(&db, &row, "ana").await.unwrap();
        let txn = db.begin().await.unwrap();
        for state in ["soaking", "held", "superseded"] {
            let mut seeded = check(&row);
            seeded.state = state.to_owned();
            seeded.attempt_id = recorded.attempt_id.clone();
            checks::insert_in(&txn, seeded, 1).await.unwrap();
        }
        txn.commit().await.unwrap();
        alert_incidents::update_status_with(&db, "acme", &row.id, "resolved")
            .await
            .unwrap();
        let resolved = checks::list(&db, "acme", &row.id).await.unwrap();
        assert!(
            resolved
                .iter()
                .any(|r| r.state == "cancelled" && r.generation == 2)
        );
        assert!(
            resolved
                .iter()
                .any(|r| r.state == "soaking" && r.generation == 1 && r.updated_at == 1)
        );
        let reopened =
            alert_incidents::update_status_by_with(&db, "acme", &row.id, "open", Some("lead"))
                .await
                .unwrap();
        let events = incident_events::get_with(&db, "acme", &row.id)
            .await
            .unwrap();
        assert!(matches!(
            events.last(),
            Some(IncidentEvent {
                timestamp,
                event_type: IncidentEventType::Reopened { user_id, transition_id: Some(id), .. },
                ..
            }) if *timestamp == reopened.updated_at && user_id == "lead" && id.len() == 26
        ));
        assert_eq!(reopened.reopen_count, 1);
        assert_eq!(reopened.fix_attempt_id, None);
        assert_eq!(reopened.recovery_due_at, None);
        for check in checks::list(&db, "acme", &row.id).await.unwrap() {
            let prior = resolved.iter().find(|r| r.id == check.id).unwrap();
            assert_eq!(check.generation, prior.generation + 1);
            assert!(!checks::LIVE.contains(&check.state.as_str()));
            assert!(check.updated_at >= prior.updated_at);
        }
    }
}

#[cfg(all(feature = "enterprise", feature = "test-utils"))]
#[tokio::test]
async fn recovery_r17_keeps_measurement_time_and_redacts_without_stream_read() {
    use config::meta::alerts::recovery::{Observation, Rollback, Verdict};

    use crate::alerts::incidents::recovery::tests::apply_fixture_observation;

    for db in backends("recovery_r17_access").await {
        let row = new_incident(&db, &config::ider::generate()).await;
        let first = record_with(
            &db,
            &row,
            "ana",
            request(None, None),
            async |row: &incident::Model| {
                let mut definition = check(row);
                definition.target = json!({
                    "signal": "logs",
                    "streams": ["orders"],
                    "start_us": 0,
                    "end_us": 1,
                    "sources": [
                        {"Stream": {"org_id": row.org_id, "stream_type": "logs", "name": "orders"}}
                    ],
                })
                .to_string();
                let inputs = watch_inputs(&db, row, None).await?;
                Ok(PreparedWatch::Checks(vec![definition], inputs))
            },
            50,
        )
        .await
        .unwrap();
        let check = checks::list(&db, &row.org_id, &row.id)
            .await
            .unwrap()
            .remove(0);
        let sample_ts = check.trigger_at + MINUTE;
        let measured_at = sample_ts + 1_000_000;
        let sample = Observation {
            incident_id: row.id.clone(),
            check_id: check.id.clone(),
            attempt_id: check.attempt_id,
            generation: check.generation,
            sample_ts,
            verdict: Verdict::Breach,
            value: Some(8.0),
            volume_pct: Some(100.0),
            evaluator_region: "local".to_owned(),
        };
        apply_fixture_observation(&db, &row.org_id, &sample, Some(measured_at)).await;
        let rollback = Observation {
            sample_ts: sample_ts + MINUTE,
            verdict: Verdict::RollbackObserved(Rollback {
                change_ref: "deploy:orders:rollback".to_owned(),
                at: sample_ts + MINUTE / 2,
            }),
            value: None,
            volume_pct: None,
            ..sample
        };
        apply_fixture_observation(&db, &row.org_id, &rollback, None).await;
        let updated = checks::get(&db, &row.org_id, &check.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.last_checked_at, Some(rollback.sample_ts));
        assert_eq!(updated.last_value, Some(8.0));

        let err = record_with(
            &db,
            &row,
            "bea",
            request(Some(&first.attempt_id), None),
            async |_| panic!("a conflict must prohibit measuring the next attempt"),
            50,
        )
        .await
        .unwrap_err();
        let MitigationError::Current(conflict) = err else {
            panic!("{err:?}")
        };
        let (viewer, denied) = (config::ider::generate(), config::ider::generate());
        crate::authz::fake_checker().grant_admin(&row.org_id, &viewer);
        let mut hidden = *conflict;
        let mut visible = hidden.clone();
        hidden.authorize_values(&denied).await;
        visible.authorize_values(&viewer).await;
        let hidden = serde_json::to_value(hidden).unwrap();
        assert!(hidden.get("value").is_none() && hidden.get("value_at").is_none());
        assert_eq!(
            (visible.value, visible.value_at),
            (Some(8.0), Some(measured_at))
        );
    }
}

#[tokio::test]
async fn mitigation_record_rechecks_case_and_ack_before_preparing() {
    for db in backends("recovery_record_guards").await {
        let row = new_incident(&db, "acme").await;
        for is_case in [true, false] {
            let mut active: incident::ActiveModel = row.clone().into();
            active.security_case = Set(is_case);
            active.acknowledged_by = Set(None);
            active.acknowledged_at = Set(None);
            active.status = Set("open".to_owned());
            active.update(&db).await.unwrap();
            let error = record_with(
                &db,
                &row,
                "ana",
                request(None, None),
                async |_| panic!("lock guard must run before preparation"),
                50,
            )
            .await
            .unwrap_err();
            if is_case {
                assert!(matches!(error, MitigationError::SecurityCase));
            } else {
                assert!(matches!(error, MitigationError::AcknowledgementRequired));
            }
        }
        assert!(
            incident_events::get_with(&db, "acme", &row.id)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

#[tokio::test]
async fn mitigation_measurement_releases_the_write_lock_and_rechecks_ack() {
    for db in backends("recovery_prepare_unlocked").await {
        let row = new_incident(&db, "acme").await;
        let result = record_with(
            &db,
            &row,
            "ana",
            request(None, None),
            async |row: &incident::Model| {
                let mut active: incident::ActiveModel = row.clone().into();
                active.acknowledged_by = Set(None);
                active.acknowledged_at = Set(None);
                active.status = Set("open".to_owned());
                active.update(&db).await?;
                prepared_check(&db, row).await
            },
            50,
        )
        .await;
        assert!(matches!(
            result,
            Err(MitigationError::AcknowledgementRequired)
        ));
        assert_eq!(checks::count_live_org(&db, "acme").await.unwrap(), 0);
    }
}

#[tokio::test]
async fn mitigation_record_rechecks_onset_and_ignores_a_title_edit() {
    for db in backends("recovery_measurement_inputs").await {
        for change_onset in [false, true] {
            let row = new_incident(&db, "acme").await;
            let result = record_with(
                &db,
                &row,
                "ana",
                request(None, None),
                async |row: &incident::Model| {
                    let watch = prepared_check(&db, row).await?;
                    let mut active: incident::ActiveModel = row.clone().into();
                    active.title = Set(Some("Edited title".to_owned()));
                    active.updated_at = Set(row.updated_at + 1);
                    if change_onset {
                        active.impact_start_at = Set(Some(row.first_alert_at - MINUTE));
                    }
                    active.update(&db).await?;
                    Ok(watch)
                },
                50,
            )
            .await;
            if change_onset {
                assert!(matches!(result, Err(MitigationError::MeasurementChanged)));
            } else {
                assert_eq!(result.unwrap().check_ids.len(), 1);
            }
        }
    }
}

#[tokio::test]
async fn mitigation_revive_rolls_back_when_capacity_is_full() {
    for db in backends("recovery_revival_budget").await {
        let row = new_incident(&db, "acme").await;
        let first = record_check(&db, &row, "ana").await.unwrap();
        let second = record_with(
            &db,
            &row,
            "bea",
            request(Some(&first.attempt_id), Some(&first.attempt_id)),
            async |row: &incident::Model| prepared_check(&db, row).await,
            50,
        )
        .await
        .unwrap();
        let other = new_incident(&db, "acme").await;
        record_check(&db, &other, "bea").await.unwrap();
        let error = retract_with(
            &db,
            ("acme", &row.id),
            &second.attempt_id,
            "bea",
            false,
            1,
            async |_| Ok(()),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, MitigationError::RevivalBudget));
        let stored = alert_incidents::get_with(&db, "acme", &row.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            stored.fix_attempt_id.as_deref(),
            Some(second.attempt_id.as_str())
        );
        assert_eq!(checks::count_live_org(&db, "acme").await.unwrap(), 2);
        let events = incident_events::get_with(&db, "acme", &row.id)
            .await
            .unwrap();
        let [_, superseded, applied] = events.as_slice() else {
            panic!("{events:?}")
        };
        let IncidentEventType::FixSuperseded {
            transition_id: Some(ref before),
            ..
        } = superseded.event_type
        else {
            panic!("{superseded:?}")
        };
        let IncidentEventType::FixApplied {
            transition_id: Some(ref after),
            ..
        } = applied.event_type
        else {
            panic!("{applied:?}")
        };
        assert_eq!(before, after);
    }
}

#[cfg(feature = "enterprise")]
#[tokio::test]
async fn rollback_observed_confirm_rechecks_latest_scoped_rollout() {
    use config::meta::{service_identity::scope_key, stream::StreamType};
    use infra::table::service_version_deploys;

    use crate::{
        alerts::{
            incidents::declare::tests::initialize_meta_store,
            what_changed::tests::{create_change_tables, deploy},
        },
        authz::{TypedStream, fake_checker},
    };

    if !initialize_meta_store().await {
        return;
    }
    for db in backends("s32_rollback_observed").await {
        create_change_tables(&db).await;
        let org = config::ider::generate();
        let actor = format!("{org}@example.com");
        fake_checker().grant_read(
            &actor,
            &TypedStream {
                org_id: org.clone(),
                stream_type: StreamType::Traces,
                name: "payments".into(),
            },
        );
        let row = declare_and_ack(
            &db,
            &org,
            json!({"service": "checkout", "env": "prod", "region": "east"}),
        )
        .await;
        let marker = |at, version: &str, from: &str| {
            let mut rollout = deploy(at, version);
            rollout.org_id = org.clone();
            rollout.from_version = Some(from.to_owned());
            rollout.scope_key = scope_key(&org, &rollout.service_name, &rollout.where_key);
            rollout.to_version_key =
                rollout
                    .to_identity()
                    .key(&org, &rollout.service_name, &rollout.where_key);
            rollout.deploy_key = infra::idempotency::canonical_sha256(&json!([
                org,
                rollout.service_name,
                rollout.where_key,
                rollout.cluster,
                rollout.to_version,
                at,
            ]));
            rollout
        };
        let at = now_micros();
        service_version_deploys::put_batch(&db, vec![marker(at - 2, "v2", "v1")])
            .await
            .unwrap();
        let rejected = confirm_for_test(&db, &row, &actor, "v2", "v2").await;
        assert!(matches!(rejected, Err(MitigationError::ObservedChange(_))));
        service_version_deploys::put_batch(&db, vec![marker(at - 1, "v1", "v2")])
            .await
            .unwrap();
        for (observed, expected) in [("v2", "v2"), ("v1", "v2")] {
            let rejected = confirm_for_test(&db, &row, &actor, observed, expected).await;
            assert!(matches!(
                rejected,
                Err(MitigationError::ObservedChange(current))
                    if current.as_ref().as_ref().and_then(|row| row.git_ref.as_deref()) == Some("v1")
            ));
        }

        let recorded = confirm_for_test(&db, &row, &actor, "v1", "v1")
            .await
            .unwrap();
        let events = incident_events::get_with(&db, &org, &row.id).await.unwrap();
        let [rollback, applied] = events.as_slice() else {
            panic!("expected rollback and fix events, got {events:?}");
        };
        assert!(matches!(
            &rollback.event_type,
            IncidentEventType::RollbackObserved { attempt_id, change_ref, at: observed, .. }
                if attempt_id == &recorded.attempt_id && change_ref == "v1" && *observed == at - 1
        ));
        assert!(matches!(
            &applied.event_type,
            IncidentEventType::FixApplied { attempt_id, observed_ref, .. }
                if attempt_id == &recorded.attempt_id && observed_ref.as_deref() == Some("v1")
        ));
        assert!(rollback.seq < applied.seq);
    }
}

#[cfg(feature = "enterprise")]
async fn confirm_for_test(
    db: &DatabaseConnection,
    row: &incident::Model,
    actor: &str,
    observed: &str,
    expected: &str,
) -> Result<Recorded, MitigationError> {
    let mut confirm = request(None, None);
    confirm.observed_ref = Some(observed.to_owned());
    confirm.option_key = Some(format!("deploy:checkout:{expected}"));
    record_with(
        db,
        row,
        actor,
        confirm,
        async |_| Ok(PreparedWatch::None),
        50,
    )
    .await
}
