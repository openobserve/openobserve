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

#[path = "check_tests.rs"]
mod check_tests;

use std::sync::Arc;

use common::meta::incidents_v2::RecoverySettings;
use config::{
    meta::{
        alerts::{
            incident_fields::{CustomerImpact, ResolutionDetails},
            incidents::{
                IncidentEvent, IncidentEventType, RecoveryFailureReason, RecoveryRelapsePhase,
            },
            recovery::{Observation, Rollback, Verdict},
        },
        oncall::response::ResolutionCause,
        system_settings::{SettingCategory, SystemSetting, keys::AUTO_RESOLVE_AT_HELD},
        triggers::{Trigger, TriggerModule, TriggerStatus},
    },
    utils::time::now_micros,
};
use infra::{
    errors::{DbError, Error},
    race::{Barriers, Order, in_both_orders},
    scheduler::{self, create_scheduled_jobs_for_test, with_scheduler_test_db},
    table::{
        alert_incidents::{
            self, CloseCaller, FieldEdit, FirstAlert, GuardedClose, KeptReason, StaleScope,
        },
        entity::{
            alert_incidents as incident, incident_recovery_checks::Model as Check, rca_runs, slos,
        },
        incident_events, incident_recovery_checks as checks, system_settings,
    },
};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, Schema, SqlxPostgresConnector,
    SqlxSqliteConnector, TransactionTrait,
};

use super::{
    ApplyMetadata, apply_observation, handle_claim, next_grid, retry_at, samples, tick_clock,
    triggers::reconcile,
};
use crate::alerts::incidents::mitigations::tests::{
    RecoveryFixtureSpec, assert_recovery_retract_refused, backends, record_recovery_fixture,
    record_recovery_fixture_for, record_without_watch,
};

const SECOND: i64 = 1_000_000;
const GRID: i64 = 30 * SECOND;
const HELD: i64 = 300 * SECOND;
const SOAK_SECS: i32 = 900;
const APPLY_LOCK: &str = "recovery_apply_lock";
const APPLY_LOCKED: &str = "recovery_apply_locked";
const TICK_LOCKED: &str = "recovery_tick_locked";
const MODULE: TriggerModule = TriggerModule::IncidentRecovery;
const SETTINGS: RecoverySettings = RecoverySettings {
    max_held_watches_per_org: 200,
    grid_secs: 30,
    held_interval_secs: 300,
    query_timeout_secs: 10,
    window_secs: 120,
    permission_cache_secs: 300,
    expect_effect_secs: 600,
    relapse_secs: 600,
    deadline_secs: 3_600,
    pass_window_cap_secs: 1_800,
    soak_floor_secs: SOAK_SECS,
    soak_cap_secs: 7_200,
};

struct Fixture {
    db: DatabaseConnection,
    org: String,
    id: String,
}

impl Fixture {
    async fn record(
        db: &DatabaseConnection,
        org: String,
        scope_count: usize,
        pass_window_secs: i32,
        soak_secs: i32,
    ) -> Self {
        Self::record_with_spec(
            db,
            org,
            RecoveryFixtureSpec {
                scope_count,
                pass_window_secs,
                soak_secs,
                missing_slo_id: None,
            },
        )
        .await
    }

    async fn record_with_spec(
        db: &DatabaseConnection,
        org: String,
        spec: RecoveryFixtureSpec,
    ) -> Self {
        let scope_count = spec.scope_count;
        let (row, recorded) = record_recovery_fixture(db, &org, spec).await;
        assert_eq!(recorded.watch_refused, None);
        assert_eq!(recorded.check_ids.len(), scope_count);
        Self {
            db: shared_connection(db),
            org,
            id: row.id,
        }
    }

    async fn new(db: &DatabaseConnection) -> Self {
        Self::record(db, config::ider::generate(), 1, 90, SOAK_SECS).await
    }

    async fn incident(&self) -> incident::Model {
        alert_incidents::get_with(&self.db, &self.org, &self.id)
            .await
            .unwrap()
            .unwrap()
    }

    async fn rows(&self) -> Vec<Check> {
        checks::list(&self.db, &self.org, &self.id).await.unwrap()
    }

    async fn check(&self) -> Check {
        let [check]: [Check; 1] = self.rows().await.try_into().unwrap();
        check
    }

    async fn events(&self) -> Vec<IncidentEvent> {
        incident_events::get_with(&self.db, &self.org, &self.id)
            .await
            .unwrap()
    }

    async fn relapses(&self) -> Vec<(i64, String, String)> {
        self.events()
            .await
            .into_iter()
            .filter_map(|event| match event.event_type {
                IncidentEventType::RecoveryRelapsed {
                    check_id,
                    transition_id,
                    ..
                } => Some((event.timestamp, check_id, transition_id)),
                _ => None,
            })
            .collect()
    }

    fn observation(&self, row: &Check, at: i64, verdict: Verdict) -> Observation {
        let value = match &verdict {
            Verdict::Pass => Some(0.8),
            Verdict::NotYet => Some(1.3),
            Verdict::Breach => Some(2.1),
            _ => None,
        };
        Observation {
            incident_id: self.id.clone(),
            check_id: row.id.clone(),
            attempt_id: row.attempt_id.clone(),
            generation: row.generation,
            sample_ts: at,
            verdict,
            value,
            volume_pct: value.map(|_| 100.0),
            evaluator_region: "local".to_owned(),
        }
    }

    async fn apply(&self, observation: &Observation) {
        apply_fixture_observation(&self.db, &self.org, observation, None).await;
    }

    async fn apply_with_metadata(&self, observation: &Observation, metadata: ApplyMetadata) {
        apply_observation(&self.db, &self.org, observation, metadata, &SETTINGS)
            .await
            .unwrap();
    }

    async fn sample(&self, row: &Check, at: i64, verdict: Verdict) {
        self.apply(&self.observation(row, at, verdict)).await;
    }

    async fn rollback(&self, row: &Check, sampled_at: i64, effect: i64) {
        self.sample(
            row,
            sampled_at,
            Verdict::RollbackObserved(Rollback {
                change_ref: format!("deploy:rollback:{effect}"),
                at: effect,
            }),
        )
        .await;
    }

    async fn tick(&self, row: &Check, at: i64) {
        tick_clock(&self.db, &self.org, row, at, &SETTINGS)
            .await
            .unwrap();
    }

    async fn verify(&self) -> Check {
        let [verified]: [Check; 1] = self.verify_scopes().await.try_into().unwrap();
        verified
    }

    async fn verify_scopes(&self) -> Vec<Check> {
        let checks = self.rows().await;
        for index in 1..=4 {
            for check in &checks {
                self.sample(check, check.trigger_at + index * GRID, Verdict::Pass)
                    .await;
            }
        }
        let verified = self.rows().await;
        assert!(verified.iter().all(|row| row.state == "soaking"));
        verified
    }

    async fn finish_soak(&self, check: &Check) -> i64 {
        self.finish_soak_scopes(std::slice::from_ref(check)).await
    }

    async fn finish_soak_scopes(&self, checks: &[Check]) -> i64 {
        let check = &checks[0];
        let verified = check.verified_at.unwrap();
        let due = check.soak_until.unwrap();
        for at in (verified + GRID..=due).step_by(GRID as usize) {
            for scope in checks {
                self.sample(scope, at, Verdict::Pass).await;
            }
        }
        self.tick(check, due).await;
        due
    }

    async fn assert_latch(&self, at: Option<i64>, attempt: &str) {
        assert_eq!(self.incident().await.not_recovering_at, at);
        let failures: Vec<_> = self
            .events()
            .await
            .into_iter()
            .filter_map(|event| match event.event_type {
                IncidentEventType::RecoveryFailed {
                    transition_id,
                    reason: RecoveryFailureReason::NotRecovering,
                    attempt_id,
                    ..
                } => Some((event.timestamp, transition_id, attempt_id)),
                _ => None,
            })
            .collect();
        if let Some(at) = at {
            let [(timestamp, transition_id, attempt_id)] = failures.as_slice() else {
                panic!("expected one not_recovering event, got {failures:?}");
            };
            assert_eq!(*timestamp, at);
            assert_eq!(transition_id.len(), 26);
            assert_eq!(attempt_id.as_deref(), Some(attempt));
        } else {
            assert!(failures.is_empty());
        }
    }

    async fn job(&self, key: &str) -> Trigger {
        scheduler::get(&self.org, MODULE, key).await.unwrap()
    }

    async fn assert_no_job(&self, key: &str) {
        let result = scheduler::get(&self.org, MODULE, key).await;
        assert!(matches!(
            result,
            Err(Error::DbError(DbError::KeyNotExists(_)))
        ));
    }

    async fn claim(&self, key: &str, due: i64) -> Trigger {
        let mut waiting = self.job(key).await;
        assert_eq!(waiting.status, TriggerStatus::Waiting);
        waiting.next_run_at = due;
        scheduler::update_trigger(waiting, false).await.unwrap();
        let [claim]: [Trigger; 1] = scheduler::pull(1, 60, 60, Some(MODULE))
            .await
            .unwrap()
            .try_into()
            .unwrap();
        assert_eq!(claim.module_key, key);
        assert_eq!(claim.next_run_at, due);
        assert_eq!(claim.status, TriggerStatus::Processing);
        claim
    }
}

#[derive(Clone, Copy)]
enum Walk {
    PassThenNoData,
    BetweenLines,
}

impl Walk {
    async fn setup(self, db: &DatabaseConnection) -> (Arc<Fixture>, Check, Observation) {
        let fixture =
            Arc::new(Fixture::record(db, config::ider::generate(), 1, 180, SOAK_SECS).await);
        let check = fixture.check().await;
        let due = fixture.incident().await.recovery_due_at.unwrap();
        let (before, at_due) = match self {
            Self::PassThenNoData => (Verdict::Pass, Verdict::NoData),
            Self::BetweenLines => (Verdict::NotYet, Verdict::NotYet),
        };
        fixture.sample(&check, due - GRID, before).await;
        let observation = fixture.observation(&check, due, at_due);
        (fixture, check, observation)
    }

    async fn assert(self, fixture: &Fixture, check: &Check, due: i64) {
        match self {
            Self::PassThenNoData => {
                fixture.assert_latch(None, &check.attempt_id).await;
                assert_eq!(fixture.incident().await.recovery_due_at, Some(due));
                fixture.sample(check, due + GRID, Verdict::Breach).await;
                fixture.tick(check, due + GRID).await;
                fixture.tick(check, due + GRID).await;
                fixture
                    .assert_latch(Some(due + GRID), &check.attempt_id)
                    .await;
            }
            Self::BetweenLines => {
                fixture.assert_latch(Some(due), &check.attempt_id).await;
                fixture.tick(check, due).await;
                fixture.assert_latch(Some(due), &check.attempt_id).await;
            }
        }
    }
}

/// `DatabaseConnection` is not `Clone` under sea-orm `mock`; a second handle shares the pool.
fn shared_connection(db: &DatabaseConnection) -> DatabaseConnection {
    match db.get_database_backend() {
        DatabaseBackend::Postgres => SqlxPostgresConnector::from_sqlx_postgres_pool(
            db.get_postgres_connection_pool().clone(),
        ),
        _ => SqlxSqliteConnector::from_sqlx_sqlite_pool(db.get_sqlite_connection_pool().clone()),
    }
}

pub(in crate::alerts::incidents) async fn apply_fixture_observation(
    db: &DatabaseConnection,
    org: &str,
    observation: &Observation,
    measured_at: Option<i64>,
) {
    let metadata = ApplyMetadata {
        measured_at,
        ..Default::default()
    };
    apply_observation(db, org, observation, metadata, &SETTINGS)
        .await
        .unwrap();
}

pub(in crate::alerts::incidents) async fn produce_repage(
    db: &DatabaseConnection,
    row: &incident::Model,
    after_resolve: bool,
) -> super::super::relapse_repage::RelapseRepage {
    record_recovery_fixture_for(
        db,
        row,
        RecoveryFixtureSpec {
            scope_count: 1,
            pass_window_secs: 90,
            soak_secs: SOAK_SECS,
            missing_slo_id: None,
        },
    )
    .await;
    let fixture = Fixture {
        db: shared_connection(db),
        org: row.org_id.clone(),
        id: row.id.clone(),
    };
    fixture.verify().await;
    if after_resolve {
        alert_incidents::update_status_by_with(db, &row.org_id, &row.id, "resolved", Some("ana"))
            .await
            .unwrap();
    }
    let check = fixture.check().await;
    let first_breach = check.verified_at.unwrap() + GRID;
    fixture.sample(&check, first_breach, Verdict::Breach).await;
    let second = fixture.observation(&check, first_breach + GRID, Verdict::Breach);
    let effects = apply_observation(
        db,
        &row.org_id,
        &second,
        ApplyMetadata::default(),
        &SETTINGS,
    )
    .await
    .unwrap();
    effects.repage.expect("relapse effect")
}

async fn apply_side(
    race: Barriers,
    fixture: Arc<Fixture>,
    observation: Observation,
    after: Option<&'static str>,
) -> Arc<Fixture> {
    race.run(async {
        if let Some(point) = after {
            race.wait(point).await;
        }
        fixture.apply(&observation).await;
    })
    .await;
    fixture
}

async fn tick_side(
    race: Barriers,
    fixture: Arc<Fixture>,
    check: Check,
    at: i64,
    after: Option<&'static str>,
) {
    race.run(async {
        if let Some(point) = after {
            race.wait(point).await;
        }
        fixture.tick(&check, at).await;
    })
    .await;
}

async fn t4_walk(db: &DatabaseConnection, walk: Walk) {
    if db.get_database_backend() == DatabaseBackend::Postgres {
        for order in [Order::AThenB, Order::BThenA] {
            let (fixture, check, observation) = walk.setup(db).await;
            let due = observation.sample_ts;
            let race = Barriers::new();
            let (apply_after, tick_after) = match order {
                Order::AThenB => (None, Some(APPLY_LOCKED)),
                Order::BThenA => (Some(TICK_LOCKED), None),
            };
            race.arm(apply_after.or(tick_after).unwrap(), 2);
            let apply = tokio::spawn(apply_side(
                race.clone(),
                fixture.clone(),
                observation,
                apply_after,
            ));
            let tick = tokio::spawn(tick_side(
                race.clone(),
                fixture.clone(),
                check.clone(),
                due,
                tick_after,
            ));
            apply.await.unwrap();
            tick.await.unwrap();
            race.assert_all_met();
            walk.assert(&fixture, &check, due).await;
        }
    } else {
        let runs = in_both_orders(|_| async {
            let (fixture, check, observation) = walk.setup(db).await;
            let due = observation.sample_ts;
            let race = Barriers::new();
            race.arm(APPLY_LOCKED, 1).arm(TICK_LOCKED, 1);
            let tick = tick_side(race.clone(), fixture.clone(), check.clone(), due, None);
            (
                async move {
                    let fixture = apply_side(race.clone(), fixture, observation, None).await;
                    (fixture, check, due, race)
                },
                tick,
            )
        })
        .await;
        for run in runs {
            let (fixture, check, due, race) = run.a;
            race.assert_all_met();
            walk.assert(&fixture, &check, due).await;
        }
    }
}

#[tokio::test]
async fn t4_pass_then_no_data_never_latches() {
    for db in backends("recovery_t4_nodata").await {
        t4_walk(&db, Walk::PassThenNoData).await;
    }
}

#[tokio::test]
async fn t4_between_the_lines_latches() {
    for db in backends("recovery_t4_notyet").await {
        t4_walk(&db, Walk::BetweenLines).await;
    }
}

#[tokio::test]
async fn t4_uses_live_measurement_time_and_expires_a_late_read_first() {
    for db in backends("recovery_t4_measured").await {
        let fixture = Fixture::new(&db).await;
        let check = fixture.check().await;
        let due = fixture.incident().await.recovery_due_at.unwrap();
        let measured = due + SECOND;
        let observation = fixture.observation(&check, due, Verdict::NotYet);
        apply_fixture_observation(&db, &fixture.org, &observation, Some(measured)).await;
        fixture.tick(&check, measured + SECOND).await;
        fixture
            .assert_latch(Some(measured), &check.attempt_id)
            .await;

        let fixture = Fixture::new(&db).await;
        let check = fixture.check().await;
        let measured = check.deadline_at + SECOND;
        let observation = fixture.observation(&check, check.deadline_at - GRID, Verdict::Breach);
        apply_fixture_observation(&db, &fixture.org, &observation, Some(measured)).await;
        fixture.tick(&check, measured).await;
        assert_eq!(fixture.check().await.state, "expired");
        fixture.assert_latch(None, &check.attempt_id).await;
    }
}

#[tokio::test]
async fn stale_observation_is_dropped() {
    for db in backends("recovery_stale").await {
        let fixture = Fixture::new(&db).await;
        let prior = fixture.check().await;
        let at = prior.trigger_at + GRID;
        fixture
            .sample(
                &prior,
                at,
                Verdict::RollbackObserved(Rollback {
                    change_ref: "deploy:rollback".to_owned(),
                    at: at - SECOND,
                }),
            )
            .await;
        let current = fixture.check().await;
        let incident = fixture.incident().await;
        assert_eq!(current.generation, prior.generation + 1);
        fixture.sample(&prior, at + GRID, Verdict::Breach).await;
        fixture.sample(&current, at, Verdict::Breach).await;
        fixture.sample(&current, at - 1, Verdict::Breach).await;
        let mut old_attempt = fixture.observation(&current, at + GRID, Verdict::Breach);
        old_attempt.attempt_id = config::ider::generate();
        fixture.apply(&old_attempt).await;
        assert_eq!(fixture.check().await, current);
        assert_eq!(fixture.incident().await.updated_at, incident.updated_at);
        duplicate_sample(&db).await;
    }
}

async fn duplicate_fixture(db: &DatabaseConnection) -> (Arc<Fixture>, Observation) {
    let fixture = Arc::new(Fixture::new(db).await);
    let check = fixture.check().await;
    let observation = fixture.observation(&check, check.trigger_at + GRID, Verdict::Pass);
    (fixture, observation)
}

async fn duplicate_sample(db: &DatabaseConnection) {
    if db.get_database_backend() == DatabaseBackend::Postgres {
        let (fixture, observation) = duplicate_fixture(db).await;
        let race = Barriers::new();
        race.arm(APPLY_LOCK, 2);
        let left = tokio::spawn(apply_side(
            race.clone(),
            fixture.clone(),
            observation.clone(),
            None,
        ));
        let right = tokio::spawn(apply_side(race.clone(), fixture.clone(), observation, None));
        left.await.unwrap();
        right.await.unwrap();
        race.assert_all_met();
        assert_single_sample(&fixture).await;
    } else {
        let runs = in_both_orders(|_| async {
            let (fixture, observation) = duplicate_fixture(db).await;
            let race = Barriers::new();
            race.arm(APPLY_LOCK, 1);
            let a = apply_side(race.clone(), fixture.clone(), observation.clone(), None);
            let b = apply_side(race.clone(), fixture, observation, None);
            (async move { (a.await, race) }, b)
        });
        for run in runs.await {
            let (fixture, race) = run.a;
            race.assert_all_met();
            assert_eq!(race.arrived(APPLY_LOCK), 2);
            assert_single_sample(&fixture).await;
        }
    }
}

async fn assert_single_sample(fixture: &Fixture) {
    let check = fixture.check().await;
    assert_eq!(check.passes, 1);
    let recent: Vec<serde_json::Value> = serde_json::from_str(&check.recent_samples).unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0]["cv"], 1);
}

#[tokio::test]
async fn recovery_eligibility_requires_volume_freshness_and_every_scope() {
    for db in backends("recovery_eligibility").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 2, 90, SOAK_SECS).await;
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let start = first.trigger_at + GRID;
        let mut observation = fixture.observation(&first, start, Verdict::Pass);
        observation.volume_pct = Some(49.0);
        fixture.apply(&observation).await;
        assert_eq!(fixture.rows().await[0].passes, 0);
        for index in 1..=4 {
            observation.sample_ts = start + index * GRID;
            observation.volume_pct = Some(50.0);
            fixture.apply(&observation).await;
        }
        assert_eq!(fixture.rows().await[0].passes, 4);
        assert_eq!(fixture.incident().await.mitigated_at, None);

        fixture
            .sample(&first, start + 7 * GRID, Verdict::Pass)
            .await;
        assert_eq!(fixture.rows().await[0].passes, 0);
        for index in 8..=11 {
            let at = start + index * GRID;
            fixture.sample(&first, at, Verdict::Pass).await;
            fixture.sample(&second, at, Verdict::Pass).await;
        }
        let incident = fixture.incident().await;
        assert_eq!(incident.mitigated_at, Some(start + 11 * GRID));
        assert_eq!(incident.impact_end_at, Some(start + 8 * GRID));
        assert_eq!(incident.fix_applied_at, None);
        assert_eq!(incident.recovery_due_at, None);
        assert!(
            fixture
                .rows()
                .await
                .iter()
                .all(|row| row.state == "soaking")
        );
    }
}

#[tokio::test]
async fn recovery_pass_cannot_verify_after_a_required_scope_deadline() {
    for db in backends("recovery_pass_deadline").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 2, 90, SOAK_SECS).await;
        let [_, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let rollout = second.trigger_at + 10 * GRID;
        fixture.rollback(&second, rollout, rollout - SECOND).await;
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let late = first.deadline_at + GRID;
        assert!(late < second.deadline_at);
        fixture.sample(&first, late - 4 * GRID, Verdict::Pass).await;
        fixture
            .sample(&second, late - 4 * GRID, Verdict::NoData)
            .await;
        for offset in (1..=3).rev() {
            let at = late - offset * GRID;
            fixture.sample(&first, at, Verdict::Pass).await;
            fixture.sample(&second, at, Verdict::Pass).await;
        }
        assert_eq!(fixture.incident().await.mitigated_at, None);

        fixture.sample(&second, late, Verdict::Pass).await;
        assert_eq!(fixture.incident().await.mitigated_at, None);
        fixture.tick(&second, late).await;
        let [expired, live]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        assert_eq!(expired.state, "expired");
        assert_eq!(live.state, "checking");
        assert!(fixture.events().await.iter().any(|event| matches!(
            &event.event_type,
            IncidentEventType::RecoveryFailed {
                check_id,
                reason: RecoveryFailureReason::Expired,
                ..
            } if check_id == &first.id
        )));
    }
}

#[tokio::test]
async fn recovery_delayed_live_read_cannot_verify_before_expiry_tick() {
    for db in backends("recovery_delayed_live_pass").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 2, 90, SOAK_SECS).await;
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let grid = first.deadline_at - GRID;
        for offset in (1..=3).rev() {
            fixture
                .sample(&first, grid - offset * GRID, Verdict::Pass)
                .await;
            fixture
                .sample(&second, grid - offset * GRID, Verdict::Pass)
                .await;
        }
        let completed_late = first.deadline_at + SECOND;
        let late = fixture.observation(&first, grid, Verdict::Pass);
        let wire = serde_json::to_value(&late).unwrap();
        assert!(wire.get("measured_at").is_none());
        assert!(wire.get("verification_blocked").is_none());
        apply_fixture_observation(&db, &fixture.org, &late, Some(completed_late)).await;
        let timely = fixture.observation(&second, grid, Verdict::Pass);
        apply_fixture_observation(&db, &fixture.org, &timely, Some(grid + SECOND)).await;

        assert_eq!(fixture.incident().await.mitigated_at, None);
        assert!(
            fixture
                .rows()
                .await
                .iter()
                .all(|check| check.state == "checking")
        );
        fixture.tick(&first, completed_late).await;
        assert!(
            fixture
                .rows()
                .await
                .iter()
                .all(|check| check.state == "expired")
        );
        assert_eq!(fixture.incident().await.recovery_due_at, None);
    }
}

#[tokio::test]
async fn recovery_blocked_pass_neither_verifies_nor_latches() {
    for db in backends("recovery_blocked_pass").await {
        let fixture = Fixture::new(&db).await;
        let check = fixture.check().await;
        let due = fixture.incident().await.recovery_due_at.unwrap();
        for offset in (1..=3).rev() {
            fixture
                .sample(&check, due - offset * GRID, Verdict::Pass)
                .await;
        }
        let blocked = fixture.observation(&check, due, Verdict::Pass);
        fixture
            .apply_with_metadata(
                &blocked,
                ApplyMetadata {
                    verification_blocked: true,
                    ..Default::default()
                },
            )
            .await;
        let blocked_check = fixture.check().await;
        let readings = samples::read(&blocked_check).unwrap();
        let last = readings.last().unwrap();
        assert_eq!(last.verdict, Verdict::Pass);
        assert!(last.verification_blocked);
        assert_eq!(blocked_check.passes, 4);
        assert_eq!(blocked_check.state, "checking");

        fixture.tick(&check, due).await;
        fixture.assert_latch(None, &check.attempt_id).await;
        fixture.sample(&check, due + GRID, Verdict::Pass).await;
        let incident = fixture.incident().await;
        assert_eq!(incident.mitigated_at, Some(due + GRID));
        assert_eq!(incident.impact_end_at, Some(due - 3 * GRID));
    }
}

#[tokio::test]
async fn recovery_soak_pause_moves_deadline_and_expires_without_samples() {
    for db in backends("recovery_soak_pause").await {
        let fixture = Fixture::new(&db).await;
        let check = fixture.verify().await;
        let due = check.soak_until.unwrap();
        let at = check.verified_at.unwrap() + GRID;
        fixture.sample(&check, at, Verdict::NoData).await;
        fixture.tick(&check, at).await;
        assert!(fixture.check().await.soak_until.unwrap() > due);

        fixture.tick(&check, due + 3 * GRID).await;
        assert_eq!(fixture.check().await.state, "unverified");
        assert_eq!(fixture.incident().await.mitigated_at, check.verified_at);
        assert_eq!(fixture.incident().await.recovered_at, None);
        let events = fixture.events().await;
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(
                    &event.event_type,
                    IncidentEventType::RecoveryFailed {
                        reason: RecoveryFailureReason::Unverified,
                        check_id,
                        ..
                    } if check_id == &check.id
                ))
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn recovery_scope_loss_ends_active_sibling_watches() {
    for db in backends("recovery_scope_loss").await {
        for denied in [true, false] {
            let fixture = Fixture::record(&db, config::ider::generate(), 2, 90, SOAK_SECS).await;
            let [passing, losing]: [Check; 2] = fixture.verify_scopes().await.try_into().unwrap();
            let verified = passing.verified_at.unwrap();
            if denied {
                fixture
                    .sample(
                        &losing,
                        verified + GRID,
                        Verdict::Denied {
                            reason: "creator lost read access to stream requests".into(),
                        },
                    )
                    .await;
            } else {
                let paused_at = verified + i64::from(SOAK_SECS) * SECOND + GRID;
                for at in (verified + GRID..=paused_at).step_by(GRID as usize) {
                    fixture.sample(&passing, at, Verdict::Pass).await;
                    fixture.sample(&losing, at, Verdict::NoData).await;
                }
                fixture.tick(&passing, paused_at).await;
            }
            let incident = fixture.incident().await;
            assert_eq!(incident.mitigated_at, Some(verified));
            assert_eq!(incident.recovered_at, None);
            let rows = fixture.rows().await;
            assert!(rows.iter().all(|row| row.state == "unverified"));
            let events = fixture.events().await;
            for check in rows {
                assert!(events.iter().any(|event| matches!(
                    &event.event_type,
                    IncidentEventType::RecoveryFailed {
                        check_id,
                        reason: RecoveryFailureReason::Unverified,
                        ..
                    } if check_id == &check.id
                )));
            }
        }
    }
}

#[tokio::test]
async fn recovery_held_cap_limits_real_watches_at_200() {
    for db in backends("recovery_held_cap").await {
        let org = config::ider::generate();
        for index in 0..=200 {
            let fixture = Fixture::record(&db, org.clone(), 1, 90, 60).await;
            let check = fixture.verify().await;
            fixture.finish_soak(&check).await;
            let finished = fixture.check().await;
            if index < 200 {
                assert_eq!(finished.state, "held");
            } else {
                assert_eq!(finished.state, "unverified");
                assert_eq!(
                    finished.state_reason.as_deref(),
                    Some("held watch limit reached (200)")
                );
                assert!(fixture.incident().await.mitigated_at.is_some());
            }
        }
    }
}

#[tokio::test]
async fn recovery_held_late_good_sample_cannot_erase_watch_pause() {
    for db in backends("recovery_held_late_sample").await {
        let fixture = Fixture::new(&db).await;
        let soaking = fixture.verify().await;
        let held_at = fixture.finish_soak(&soaking).await;
        let held = fixture.check().await;
        assert_eq!(held.state, "held");
        let first_due = next_grid(held_at, SETTINGS.held_interval_secs);
        for offset in 0..4 {
            fixture
                .sample(&held, first_due + offset * HELD, Verdict::NoData)
                .await;
        }
        let blind = fixture.check().await;
        assert_eq!(blind.state, "held");
        let good_at = first_due + 4 * HELD;
        fixture.sample(&held, good_at, Verdict::Pass).await;

        let ended = fixture.check().await;
        assert_eq!(ended.state, "unverified");
        assert_eq!(
            ended.state_reason.as_deref(),
            Some("watch paused 20m of 15m")
        );
        assert_eq!(ended.last_checked_at, blind.last_checked_at);
        assert_eq!(ended.recent_samples, blind.recent_samples);
        assert_eq!(fixture.incident().await.mitigated_at, soaking.verified_at);
    }
}

#[tokio::test]
async fn recovery_held_regular_samples_outlive_a_short_soak() {
    for db in backends("recovery_held_interval").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 1, 90, 60).await;
        let soaking = fixture.verify().await;
        let held_at = fixture.finish_soak(&soaking).await;
        let held = fixture.check().await;
        assert_eq!(held.state, "held");
        let first_due = next_grid(held_at, SETTINGS.held_interval_secs);
        for offset in 0..3 {
            let at = first_due + offset * HELD;
            fixture.tick(&held, at).await;
            fixture.sample(&held, at, Verdict::Pass).await;
            let row = fixture.check().await;
            assert_eq!(row.state, "held");
            assert_eq!(row.last_checked_at, Some(at));
        }
        assert_eq!(fixture.incident().await.recovered_at, Some(held_at));
    }
}

#[tokio::test]
async fn recovery_held_blindness_starts_at_the_first_absolute_grid() {
    for db in backends("recovery_held_first_grid").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 1, 90, 60).await;
        let check = fixture.check().await;
        let first_due = next_grid(check.trigger_at + 6 * GRID, SETTINGS.held_interval_secs);
        let verified_at = first_due - 3 * GRID;
        for offset in (0..=3).rev() {
            fixture
                .sample(&check, verified_at - offset * GRID, Verdict::Pass)
                .await;
        }
        let soaking = fixture.check().await;
        assert_eq!(soaking.verified_at, Some(verified_at));
        for offset in 1..=2 {
            fixture
                .sample(&soaking, verified_at + offset * GRID, Verdict::Pass)
                .await;
        }
        let held_at = first_due - SECOND;
        fixture.tick(&soaking, held_at).await;
        let held = fixture.check().await;
        assert_eq!(held.state, "held");
        assert_eq!(fixture.incident().await.recovered_at, Some(held_at));

        fixture.tick(&held, first_due).await;
        assert_eq!(fixture.check().await.state, "held");
        fixture.sample(&held, first_due + HELD, Verdict::Pass).await;
        let ended = fixture.check().await;
        assert_eq!(ended.state, "unverified");
        assert_eq!(ended.state_reason.as_deref(), Some("watch paused 5m of 1m"));
        assert_eq!(ended.last_checked_at, held.last_checked_at);
    }
}

#[tokio::test]
async fn recovery_held_relapse_at_cap_waits_for_admission_once() {
    for db in backends("recovery_relapse_cap").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        let org = config::ider::generate();
        let fixture = Fixture::record(&db, org.clone(), 2, 90, SOAK_SECS).await;
        let soaking = fixture.verify_scopes().await;
        let held_at = fixture.finish_soak_scopes(&soaking).await;
        let held = fixture.rows().await;
        assert!(held.iter().all(|check| check.state == "held"));
        let prior_incident = fixture.incident().await;

        let spare = Fixture::record(&db, org.clone(), 5, 90, SOAK_SECS).await;
        for _ in 1..10 {
            Fixture::record(&db, org.clone(), 5, 90, SOAK_SECS).await;
        }
        assert_eq!(checks::count_live_org(&db, &org).await.unwrap(), 50);
        let check = &held[0];
        let first_due = next_grid(held_at, SETTINGS.held_interval_secs);
        fixture.sample(check, first_due, Verdict::Breach).await;
        let relapse_at = first_due + HELD;
        let breach = fixture.observation(check, relapse_at, Verdict::Breach);
        fixture.apply(&breach).await;
        let deferred = fixture.rows().await;
        for (row, prior) in deferred.iter().zip(&held) {
            assert_eq!(row.state, "held");
            assert_eq!(row.verified_at, prior.verified_at);
            assert_eq!(row.generation, prior.generation);
        }
        assert_eq!(
            deferred[0].state_reason.as_deref(),
            Some("awaiting a live recovery check slot")
        );
        assert_eq!(deferred[1], held[1]);
        assert_eq!(fixture.incident().await, prior_incident);
        assert_recovery_retract_refused(&db, &org, &fixture.id, &check.attempt_id).await;

        let relapses = fixture.relapses().await;
        let [(at, check_id, transition_id)] = relapses.as_slice() else {
            panic!("one relapse event must describe the deferred transition");
        };
        assert_eq!((*at, check_id), (relapse_at, &check.id));
        assert_eq!(transition_id.len(), 26);
        fixture.apply(&breach).await;
        assert_eq!(fixture.rows().await, deferred);
        let extra_at = relapse_at + HELD;
        fixture
            .sample(&deferred[0], extra_at, Verdict::Breach)
            .await;
        assert_eq!(fixture.rows().await[0].last_checked_at, Some(extra_at));
        assert_eq!(fixture.relapses().await, relapses);
        assert_eq!(checks::count_live_org(&db, &org).await.unwrap(), 50);

        alert_incidents::update_status_with(&db, &org, &spare.id, "resolved")
            .await
            .unwrap();
        assert_eq!(checks::count_live_org(&db, &org).await.unwrap(), 45);
        fixture.tick(&deferred[1], extra_at + GRID).await;
        let due = relapse_at + i64::from(SETTINGS.relapse_secs) * SECOND;
        for (row, prior) in fixture.rows().await.iter().zip(&held) {
            assert_eq!(row.state, "checking");
            assert_eq!(row.state_reason, None);
            assert_eq!(row.verified_at, prior.verified_at);
            assert_eq!(row.generation, prior.generation + 1);
            assert_eq!(row.effect_from_at, relapse_at);
            assert_eq!(row.deadline_at, due + SETTINGS.deadline_secs * SECOND);
        }
        let incident = fixture.incident().await;
        assert_eq!(
            incident.fix_attempt_id.as_deref(),
            Some(check.attempt_id.as_str())
        );
        assert_eq!(incident.fix_applied_at, Some(check.trigger_at));
        assert_eq!(incident.mitigated_at, None);
        assert_eq!(incident.recovered_at, None);
        assert_eq!(incident.impact_end_at, None);
        assert_eq!(incident.recovery_due_at, Some(due));
        assert_eq!(checks::count_live_org(&db, &org).await.unwrap(), 47);
        assert_eq!(fixture.relapses().await, relapses);
        assert_recovery_retract_refused(&db, &org, &fixture.id, &check.attempt_id).await;
    }
}

#[tokio::test]
async fn recovery_held_watch_count_excludes_security_cases() {
    for db in backends("recovery_held_security").await {
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(rca_runs::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        let fixture = Fixture::new(&db).await;
        let soaking = fixture.verify().await;
        fixture.finish_soak(&soaking).await;
        assert_eq!(
            checks::count_held_watches(&db, &fixture.org).await.unwrap(),
            1
        );
        alert_incidents::mark_security_case_with(&db, &fixture.org, &fixture.id)
            .await
            .unwrap();
        assert!(fixture.incident().await.security_case);
        assert_eq!(
            checks::count_held_watches(&db, &fixture.org).await.unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn recovery_checking_survives_the_stale_sweep() {
    for db in backends("recovery_stale_sweep").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        with_scheduler_test_db(&db, async {
            let fixture = Fixture::new(&db).await;
            let check = fixture.check().await;
            reconcile(&db, &fixture.org, &check.id, check.trigger_at, &SETTINGS)
                .await
                .unwrap();
            assert_eq!(fixture.job(&check.id).await.status, TriggerStatus::Waiting);

            let sweep_at = check.trigger_at + GRID;
            let (count, resolved) =
                alert_incidents::auto_resolve_stale_with(&db, sweep_at, sweep_at, StaleScope::Ops)
                    .await
                    .unwrap();
            assert_eq!(count, 0);
            assert!(resolved.is_empty());
            assert_ne!(fixture.incident().await.status, "resolved");
            assert_eq!(fixture.check().await.state, "checking");
            assert_eq!(fixture.job(&check.id).await.status, TriggerStatus::Waiting);
        })
        .await;
    }
}

#[tokio::test]
async fn recovery_held_and_relapse_swap_triggers_and_clear_milestones() {
    for db in backends("recovery_held_triggers").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        with_scheduler_test_db(&db, assert_held_and_relapse_triggers(&db)).await;
    }
}

async fn assert_held_and_relapse_triggers(db: &DatabaseConnection) {
    let fixture = Fixture::new(db).await;
    let original = fixture.check().await;
    let grid_key = &original.id;
    let held_key = format!("{grid_key}:held");
    reconcile(db, &fixture.org, grid_key, original.trigger_at, &SETTINGS)
        .await
        .unwrap();
    assert_eq!(fixture.job(grid_key).await.status, TriggerStatus::Waiting);
    fixture.assert_no_job(&held_key).await;

    let soaking = fixture.verify().await;
    let held_at = fixture.finish_soak(&soaking).await;
    let held = fixture.check().await;
    assert_eq!(held.state, "held");
    assert_eq!(fixture.incident().await.recovered_at, Some(held_at));
    let grid_claim = fixture.claim(grid_key, now_micros()).await;
    handle_claim(db, &grid_claim, &SETTINGS).await.unwrap();
    assert_eq!(fixture.job(&held_key).await.status, TriggerStatus::Waiting);
    fixture.assert_no_job(grid_key).await;

    let txn = db.begin().await.unwrap();
    let human_end = original.trigger_at + GRID;
    alert_incidents::edit_fields_in(
        &txn,
        &fixture.org,
        &fixture.id,
        FieldEdit::ImpactWindow {
            start: original.trigger_at,
            end: Some(human_end),
        },
        "ana",
    )
    .await
    .unwrap();
    txn.commit().await.unwrap();
    assert_eq!(fixture.incident().await.impact_end_at, Some(human_end));

    let relapse_at = held_at + 2 * HELD;
    fixture.sample(&held, held_at + HELD, Verdict::Breach).await;
    assert_eq!(fixture.check().await.state, "held");
    fixture.sample(&held, relapse_at, Verdict::Breach).await;
    fixture.tick(&held, relapse_at).await;
    let restarted = fixture.check().await;
    let incident = fixture.incident().await;
    let due = relapse_at + 600 * SECOND;
    assert_eq!(restarted.state, "checking");
    assert_eq!(restarted.generation, held.generation + 1);
    assert_eq!(restarted.verified_at, held.verified_at);
    assert_eq!(restarted.effect_from_at, relapse_at);
    assert_eq!(restarted.deadline_at, due + 3600 * SECOND);
    assert_eq!(restarted.passes, 0);
    assert_eq!(incident.recovery_due_at, Some(due));
    assert_eq!(incident.fix_applied_at, Some(original.trigger_at));
    assert_eq!(incident.mitigated_at, None);
    assert_eq!(incident.recovered_at, None);
    assert_eq!(incident.impact_end_at, None);
    let held_claim = fixture.claim(&held_key, now_micros()).await;
    handle_claim(db, &held_claim, &SETTINGS).await.unwrap();
    assert_eq!(fixture.job(grid_key).await.status, TriggerStatus::Waiting);
    fixture.assert_no_job(&held_key).await;
}

#[tokio::test]
async fn recovery_backoff_uses_bounded_ladder_and_resets_on_success() {
    for db in backends("recovery_backoff").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        with_scheduler_test_db(&db, assert_backoff(&db)).await;
    }
}

async fn assert_backoff(db: &DatabaseConnection) {
    let fixture = Fixture::record_with_spec(
        db,
        config::ider::generate(),
        RecoveryFixtureSpec {
            scope_count: 1,
            pass_window_secs: 90,
            soak_secs: SOAK_SECS,
            missing_slo_id: Some(config::ider::generate()),
        },
    )
    .await;
    let key = fixture.check().await.id;
    let now = now_micros();
    let start = now - now.rem_euclid(GRID) - 6 * GRID;
    reconcile(db, &fixture.org, &key, start - GRID, &SETTINGS)
        .await
        .unwrap();
    for (attempt, delay) in [30, 60, 120, 300, 300].into_iter().enumerate() {
        let claim = fixture.claim(&key, start + attempt as i64 * GRID).await;
        assert_eq!(claim.retries, attempt as i32);
        let before = now_micros();
        handle_claim(db, &claim, &SETTINGS).await.unwrap();
        let after = now_micros();
        let waiting = fixture.job(&key).await;
        assert_eq!(waiting.status, TriggerStatus::Waiting);
        assert_eq!(waiting.claim_epoch, claim.claim_epoch);
        assert_eq!(waiting.retries, attempt as i32 + 1);
        let bound = |now: i64| {
            let due = now + delay * SECOND;
            let cap = now + HELD;
            (due + (-due).rem_euclid(GRID)).min(cap - cap.rem_euclid(GRID))
        };
        assert!((bound(before)..=bound(after)).contains(&waiting.next_run_at));
        assert_eq!(waiting.next_run_at.rem_euclid(GRID), 0);
    }

    let backend = db.get_database_backend();
    let table = Schema::new(backend).create_table_from_entity(slos::Entity);
    db.execute(backend.build(&table)).await.unwrap();
    let claim = fixture.claim(&key, start + 5 * GRID).await;
    assert_eq!(claim.retries, 5);
    handle_claim(db, &claim, &SETTINGS).await.unwrap();
    let waiting = fixture.job(&key).await;
    assert_eq!(waiting.status, TriggerStatus::Waiting);
    assert_eq!(waiting.retries, 0);
    assert_eq!(waiting.claim_epoch, claim.claim_epoch);
    let readings = samples::read(&fixture.check().await).unwrap();
    let [errors @ .., last] = readings.as_slice() else {
        panic!("expected the recovery sample history to contain every claim");
    };
    assert_eq!(errors.len(), 5);
    assert!(
        errors
            .iter()
            .all(|reading| reading.verdict == Verdict::Error)
    );
    assert_eq!(last.verdict, Verdict::NoData);
}

#[test]
fn recovery_retry_stays_on_grid_and_within_a_feasible_held_cap() {
    let now = 25 * SECOND;
    assert_eq!(retry_at(now, 0, &SETTINGS), 60 * SECOND);
    assert_eq!(retry_at(now, 3, &SETTINGS), HELD);
    let off_grid_cap = RecoverySettings {
        held_interval_secs: 305,
        ..SETTINGS
    };
    assert_eq!(retry_at(0, 3, &off_grid_cap), HELD);
    let short_cap = RecoverySettings {
        held_interval_secs: SETTINGS.grid_secs,
        ..SETTINGS
    };
    assert_eq!(retry_at(now, 3, &short_cap), 60 * SECOND);
}

#[tokio::test]
async fn recovery_rollback_keeps_passes_and_recomputes_deadline() {
    for db in backends("recovery_rollback").await {
        let fixture = Fixture::new(&db).await;
        let check = fixture.check().await;
        let at = check.trigger_at + 300 * SECOND;
        fixture.sample(&check, at, Verdict::Pass).await;
        let effect = at + SECOND;
        fixture
            .sample(
                &check,
                at + GRID,
                Verdict::RollbackObserved(Rollback {
                    change_ref: "deploy:rollback".into(),
                    at: effect,
                }),
            )
            .await;
        let updated = fixture.check().await;
        let due = effect + 600 * SECOND;
        assert_eq!(updated.effect_from_at, effect);
        assert_eq!(updated.generation, check.generation + 1);
        assert_eq!(updated.passes, 1);
        assert_eq!(updated.pass_started_at, Some(at));
        assert_eq!(updated.deadline_at, due + 3600 * SECOND);
        assert_eq!(fixture.incident().await.recovery_due_at, Some(due));
    }
}

#[tokio::test]
async fn recovery_rollback_moves_only_the_observing_scope() {
    for db in backends("recovery_rollback_scope").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 2, 90, SOAK_SECS).await;
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let late_effect = first.trigger_at + 12 * GRID;
        let early_effect = second.trigger_at + 10 * GRID;
        fixture
            .rollback(&first, late_effect + GRID, late_effect)
            .await;

        let [moved, untouched]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        assert_eq!(moved.effect_from_at, late_effect);
        assert_eq!(moved.generation, first.generation + 1);
        assert_eq!(untouched, second);

        fixture
            .rollback(&second, late_effect + 2 * GRID, early_effect)
            .await;
        let [unchanged, moved_earlier]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        assert_eq!(unchanged, moved);
        assert_eq!(moved_earlier.effect_from_at, early_effect);
        assert_eq!(moved_earlier.generation, second.generation + 1);
        let mut effect_times = fixture
            .events()
            .await
            .into_iter()
            .filter_map(|event| match event.event_type {
                IncidentEventType::RollbackObserved { at, .. } => Some(at),
                _ => None,
            })
            .collect::<Vec<_>>();
        effect_times.sort_unstable();
        assert_eq!(effect_times, [early_effect, late_effect]);
    }
}

#[tokio::test]
async fn recovery_rollback_requires_a_pass_from_the_current_generation() {
    for db in backends("recovery_rollback_pass").await {
        let fixture = Fixture::record(&db, config::ider::generate(), 2, 90, SOAK_SECS).await;
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        let start = first.trigger_at + 10 * GRID;
        for index in 0..=2 {
            let at = start + index * GRID;
            fixture.sample(&first, at, Verdict::Pass).await;
            fixture.sample(&second, at, Verdict::Pass).await;
        }
        fixture
            .sample(&first, start + 3 * GRID, Verdict::Pass)
            .await;
        let at = start + 4 * GRID;
        let effect = start + 2 * GRID + SECOND;
        fixture.rollback(&first, at, effect).await;
        let [first, second]: [Check; 2] = fixture.rows().await.try_into().unwrap();
        assert_eq!(first.passes, 4);
        assert_eq!(first.pass_started_at, Some(start));
        assert_eq!(second.passes, 3);
        let prior = samples::read(&first).unwrap();
        let last = prior.last().unwrap();
        assert!(last.ts > first.effect_from_at);
        assert_eq!(last.generation + 1, first.generation);

        fixture.sample(&second, at, Verdict::Pass).await;
        assert_eq!(fixture.incident().await.mitigated_at, None);
        fixture.sample(&first, at + GRID, Verdict::Pass).await;
        assert_eq!(fixture.incident().await.mitigated_at, Some(at + GRID));
        assert_eq!(fixture.incident().await.impact_end_at, Some(start));
    }
}

async fn attach_open_firing(fixture: &Fixture) {
    alert_incidents::add_firing_once_with(
        &fixture.db,
        &fixture.org,
        &fixture.id,
        &FirstAlert {
            alert_id: &config::ider::generate(),
            alert_name: "Error rate",
            alert_kind: "internal",
            correlation_reason: "service",
            labels: None,
            severity: None,
        },
        now_micros(),
    )
    .await
    .unwrap();
}

async fn guarded_close(
    db: &DatabaseConnection,
    row: &incident::Model,
    caller: CloseCaller,
    at_held: Option<&str>,
) -> GuardedClose {
    let txn = db.begin().await.unwrap();
    let outcome = alert_incidents::resolve_guarded_in(
        &txn,
        &row.org_id,
        &row.id,
        caller,
        now_micros(),
        at_held,
    )
    .await
    .unwrap();
    txn.commit().await.unwrap();
    outcome
}

async fn assert_guard_matrix_row(
    db: &DatabaseConnection,
    row: &incident::Model,
    state: &str,
    expected: KeptReason,
    at_held: Option<&str>,
    d6_expected: Option<KeptReason>,
) {
    let callers = [
        CloseCaller::StaleSweep { cutoff: i64::MAX },
        CloseCaller::AlertRecovery,
        CloseCaller::ExternalAlert,
        CloseCaller::OncallClose,
    ];
    for caller in callers {
        let outcome = guarded_close(db, row, caller, None).await;
        assert_eq!(outcome, GuardedClose::Kept(expected), "{state}, {caller:?}");
    }
    let d6 = guarded_close(db, row, CloseCaller::AlertRecovery, at_held).await;
    if let Some(reason) = d6_expected {
        assert_eq!(d6, GuardedClose::Kept(reason), "{state}, D6");
    } else {
        assert!(matches!(d6, GuardedClose::Closed { .. }), "{state}, D6");
    }
}

#[tokio::test]
async fn guard_matrix_keeps_active_attempts_and_security_cases() {
    use KeptReason::{NotAtHeld, RecoveryInProgress, SecurityCase};

    for db in backends("s32_guard_matrix").await {
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(rca_runs::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        let fixture = Fixture::new(&db).await;
        let no_watch = record_without_watch(&db, &config::ider::generate()).await;
        let checking = fixture.incident().await;
        assert_eq!(fixture.check().await.state, "checking");
        assert!(no_watch.fix_applied_at.is_some());
        assert!(
            checks::list(&db, &no_watch.org_id, &no_watch.id)
                .await
                .unwrap()
                .is_empty()
        );
        for (state, row) in [("checking", &checking), ("fix applied", &no_watch)] {
            assert_guard_matrix_row(
                &db,
                row,
                state,
                RecoveryInProgress,
                Some(row.fix_attempt_id.as_deref().unwrap()),
                Some(NotAtHeld),
            )
            .await;
        }
        let verified = fixture.verify().await;
        assert_eq!(verified.state, "soaking");
        let soaking = fixture.incident().await;
        assert_guard_matrix_row(
            &db,
            &soaking,
            "soaking",
            RecoveryInProgress,
            soaking.fix_attempt_id.as_deref(),
            Some(NotAtHeld),
        )
        .await;

        let unverified = Fixture::new(&db).await;
        let watch = unverified.verify().await;
        unverified
            .sample(
                &watch,
                watch.verified_at.unwrap() + GRID,
                Verdict::Denied {
                    reason: "source access revoked".to_owned(),
                },
            )
            .await;
        assert_eq!(unverified.check().await.state, "unverified");
        let mitigated = unverified.incident().await;
        assert!(mitigated.mitigated_at.is_some() && mitigated.recovered_at.is_none());
        assert_guard_matrix_row(
            &db,
            &mitigated,
            "mitigated without held",
            RecoveryInProgress,
            mitigated.fix_attempt_id.as_deref(),
            Some(NotAtHeld),
        )
        .await;

        fixture.finish_soak(&verified).await;
        assert_eq!(fixture.check().await.state, "held");
        let held = fixture.incident().await;
        assert_guard_matrix_row(
            &db,
            &held,
            "watched held with a stale D6 attempt",
            RecoveryInProgress,
            Some("other"),
            Some(NotAtHeld),
        )
        .await;
        assert_guard_matrix_row(
            &db,
            &held,
            "held with the current D6 attempt",
            RecoveryInProgress,
            held.fix_attempt_id.as_deref(),
            None,
        )
        .await;

        let case = Fixture::new(&db).await;
        alert_incidents::mark_security_case_with(&db, &case.org, &case.id)
            .await
            .unwrap();
        let row = case.incident().await;
        assert_guard_matrix_row(
            &db,
            &row,
            "security case",
            SecurityCase,
            row.fix_attempt_id.as_deref(),
            Some(SecurityCase),
        )
        .await;
    }
}

#[tokio::test]
async fn d6_at_held_closes_once() {
    for db in backends("s32_d6_at_held").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        for (setting, firing) in [
            (None, false),
            (Some(false), false),
            (Some(true), true),
            (Some(true), false),
        ] {
            let fixture = Fixture::new(&db).await;
            if let Some(enabled) = setting {
                system_settings::set_with(
                    &db,
                    &SystemSetting::new_org(&fixture.org, AUTO_RESOLVE_AT_HELD, enabled.into())
                        .with_category(SettingCategory::Incidents),
                )
                .await
                .unwrap();
            }
            if firing {
                attach_open_firing(&fixture).await;
            }
            let soaking = fixture.verify().await;
            let at = fixture.finish_soak(&soaking).await;
            let held = fixture.check().await;
            let row = fixture.incident().await;
            let should_close = setting == Some(true) && !firing;
            assert_eq!(row.status == "resolved", should_close);
            assert_eq!(row.resolved_by.as_deref(), should_close.then_some("system"));
            assert_eq!(row.recovered_at, Some(at));
            assert_eq!(held.state, "held");

            with_scheduler_test_db(&db, async {
                let key = format!("{}{}", held.id, checks::HELD_TRIGGER_SUFFIX);
                reconcile(&db, &fixture.org, &held.id, at, &SETTINGS)
                    .await
                    .unwrap();
                if should_close {
                    fixture.assert_no_job(&key).await;
                } else {
                    assert_eq!(fixture.job(&key).await.module_key, key);
                }
            })
            .await;

            fixture.tick(&soaking, at).await;
            fixture.sample(&soaking, at, Verdict::Pass).await;
            assert_eq!(fixture.incident().await.resolved_at, row.resolved_at);
            assert_eq!(
                fixture
                    .events()
                    .await
                    .iter()
                    .filter(|event| matches!(
                        event.event_type,
                        IncidentEventType::RecoveryHeld { .. }
                    ))
                    .count(),
                1
            );
        }
    }
}

#[tokio::test]
async fn t11_relapse_reopens_once_per_episode() {
    for db in backends("s32_t11_relapse").await {
        let fixture = Fixture::new(&db).await;
        let mut soaking = fixture.verify().await;
        for episode in 1..=2 {
            alert_incidents::update_status_with(&db, &fixture.org, &fixture.id, "resolved")
                .await
                .unwrap();
            let at = soaking.verified_at.unwrap();
            fixture.sample(&soaking, at + GRID, Verdict::Breach).await;
            assert_eq!(fixture.incident().await.status, "resolved");
            tokio::join!(
                fixture.sample(&soaking, at + 2 * GRID, Verdict::Breach),
                fixture.sample(&soaking, at + 2 * GRID, Verdict::Breach),
            );
            fixture
                .sample(&soaking, at + 2 * GRID, Verdict::Breach)
                .await;
            assert_eq!(fixture.incident().await.status, "open");
            assert_eq!(fixture.incident().await.reopen_count, episode);
            assert_eq!(fixture.incident().await.fix_attempt_id, None);
            let current = checks::get(&db, &fixture.org, &soaking.id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(current.state, "cancelled");
            assert_eq!(current.generation, soaking.generation + 1);

            let mut relapse_id = None;
            let mut reopens = 0;
            for event in fixture.events().await {
                match event.event_type {
                    IncidentEventType::RecoveryRelapsed {
                        phase: RecoveryRelapsePhase::AfterResolve,
                        transition_id,
                        ..
                    } => relapse_id = Some(transition_id),
                    IncidentEventType::Reopened {
                        transition_id,
                        user_id,
                        ..
                    } => {
                        assert_eq!(transition_id, relapse_id);
                        assert_eq!(user_id, "system (relapse)");
                        reopens += 1;
                    }
                    _ => {}
                }
            }
            assert_eq!(reopens, episode);

            if episode == 1 {
                let row = alert_incidents::acknowledge_with(&db, &fixture.org, &fixture.id, "lead")
                    .await
                    .unwrap()
                    .unwrap();
                let recorded = record_recovery_fixture_for(
                    &db,
                    &row,
                    RecoveryFixtureSpec {
                        scope_count: 1,
                        pass_window_secs: 90,
                        soak_secs: SOAK_SECS,
                        missing_slo_id: None,
                    },
                )
                .await;
                let check = checks::get(&db, &fixture.org, &recorded.check_ids[0])
                    .await
                    .unwrap()
                    .unwrap();
                for index in 1..=4 {
                    fixture
                        .sample(&check, check.trigger_at + index * GRID, Verdict::Pass)
                        .await;
                }
                soaking = checks::get(&db, &fixture.org, &check.id)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(soaking.state, "soaking");
            }
        }
    }
}

#[tokio::test]
async fn resolution_records_cause_impact_and_actor_once() {
    for db in backends("s32_resolution_details").await {
        let fixture = Fixture::new(&db).await;
        let details = ResolutionDetails {
            resolution_cause: Some(ResolutionCause::DependencyFailure),
            resolution_note: Some("Upstream timeouts".to_owned()),
            customer_impact: Some(CustomerImpact::Confirmed),
        };
        assert!(
            alert_incidents::unacknowledge_with(&db, &fixture.org, &fixture.id, "lead")
                .await
                .unwrap()
        );
        let unacked = IncidentEvent::reopened("lead", "Unacknowledged");
        let row = alert_incidents::update_resolution_with(
            &db,
            &fixture.org,
            &fixture.id,
            "ana",
            &details,
        )
        .await
        .unwrap();
        incident_events::append_with(&db, &fixture.org, &fixture.id, unacked)
            .await
            .unwrap();
        let retry = alert_incidents::update_resolution_with(
            &db,
            &fixture.org,
            &fixture.id,
            "bob",
            &details,
        )
        .await
        .unwrap();
        assert_eq!(row.resolved_at, retry.resolved_at);
        assert_eq!(
            retry.resolution_cause.as_deref(),
            Some("dependency_failure")
        );
        assert_eq!(retry.resolution_note.as_deref(), Some("Upstream timeouts"));
        assert_eq!(retry.customer_impact.as_deref(), Some("confirmed"));
        assert_eq!(retry.resolved_by.as_deref(), Some("ana"));
        assert_eq!(fixture.check().await.state, "cancelled");
        let events = fixture.events().await;
        let [recorded] = events
            .iter()
            .filter(|event| {
                matches!(
                    event.event_type,
                    IncidentEventType::ResolutionRecorded { .. }
                )
            })
            .collect::<Vec<_>>()
            .try_into()
            .unwrap_or_else(|_| panic!("expected one ResolutionRecorded event"));
        assert_eq!(Some(recorded.timestamp), row.resolved_at);
        assert!(matches!(
            &recorded.event_type,
            IncidentEventType::ResolutionRecorded { actor, details, .. }
                if actor == "ana" && details.customer_impact == Some(CustomerImpact::Confirmed)
        ));
    }
}

#[tokio::test]
async fn resolution_details_conflict_if_d6_already_closed_the_incident() {
    for db in backends("s32_resolution_d6_conflict").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        let fixture = Fixture::new(&db).await;
        system_settings::set_with(
            &db,
            &SystemSetting::new_org(&fixture.org, AUTO_RESOLVE_AT_HELD, true.into())
                .with_category(SettingCategory::Incidents),
        )
        .await
        .unwrap();
        let soaking = fixture.verify().await;
        fixture.finish_soak(&soaking).await;
        let before = fixture.incident().await;
        assert_eq!(before.resolved_by.as_deref(), Some("system"));

        let result = alert_incidents::update_resolution_with(
            &db,
            &fixture.org,
            &fixture.id,
            "ana",
            &ResolutionDetails {
                resolution_cause: Some(ResolutionCause::DependencyFailure),
                ..Default::default()
            },
        )
        .await;
        assert!(
            matches!(result, Err(Error::OtherError(error)) if error.is::<alert_incidents::ResolutionConflict>())
        );
        assert_eq!(fixture.incident().await, before);
    }
}

#[tokio::test]
async fn resolution_details_from_a_prior_episode_conflict_after_d6() {
    for db in backends("s32_resolution_prior_episode").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        let org = config::ider::generate();
        let first = record_without_watch(&db, &org).await;
        let details = ResolutionDetails {
            resolution_cause: Some(ResolutionCause::DependencyFailure),
            ..Default::default()
        };
        let resolved =
            alert_incidents::update_resolution_with(&db, &org, &first.id, "ana", &details)
                .await
                .unwrap();
        alert_incidents::update_status_by_with(&db, &org, &first.id, "open", Some("ana"))
            .await
            .unwrap();
        let lead = alert_incidents::acknowledge_with(&db, &org, &first.id, "ana")
            .await
            .unwrap()
            .unwrap();
        record_recovery_fixture_for(
            &db,
            &lead,
            RecoveryFixtureSpec {
                scope_count: 1,
                pass_window_secs: 90,
                soak_secs: SOAK_SECS,
                missing_slo_id: None,
            },
        )
        .await;
        system_settings::set_with(
            &db,
            &SystemSetting::new_org(&org, AUTO_RESOLVE_AT_HELD, true.into())
                .with_category(SettingCategory::Incidents),
        )
        .await
        .unwrap();
        let fixture = Fixture {
            db: shared_connection(&db),
            org,
            id: first.id,
        };
        let soaking = fixture.verify().await;
        fixture.finish_soak(&soaking).await;
        let d6 = fixture.incident().await;
        assert_eq!(d6.resolved_by.as_deref(), Some("system"));
        assert_ne!(d6.resolved_at, resolved.resolved_at);
        assert_eq!(d6.resolution_cause, resolved.resolution_cause);

        let result = alert_incidents::update_resolution_with(
            &db,
            &fixture.org,
            &fixture.id,
            "ana",
            &details,
        )
        .await;
        assert!(
            matches!(result, Err(Error::OtherError(error)) if error.is::<alert_incidents::ResolutionConflict>())
        );
        assert_eq!(fixture.incident().await, d6);
        let recorded: Vec<_> = fixture
            .events()
            .await
            .into_iter()
            .filter(|event| {
                matches!(
                    event.event_type,
                    IncidentEventType::ResolutionRecorded { .. }
                )
            })
            .map(|event| Some(event.timestamp))
            .collect();
        assert_eq!(recorded, [resolved.resolved_at]);
    }
}

#[tokio::test]
async fn resolution_retires_a_held_watch_after_commit() {
    for db in backends("s32_resolution_retires_watch").await {
        create_scheduled_jobs_for_test(&db).await.unwrap();
        with_scheduler_test_db(&db, async {
            let fixture = Fixture::new(&db).await;
            let soaking = fixture.verify().await;
            let at = fixture.finish_soak(&soaking).await;
            let held = fixture.check().await;
            reconcile(&db, &fixture.org, &held.id, at, &SETTINGS)
                .await
                .unwrap();
            let key = format!("{}{}", held.id, checks::HELD_TRIGGER_SUFFIX);
            assert_eq!(fixture.job(&key).await.status, TriggerStatus::Waiting);

            let resolved = alert_incidents::update_resolution_with(
                &db,
                &fixture.org,
                &fixture.id,
                "ana",
                &ResolutionDetails {
                    resolution_cause: Some(ResolutionCause::DependencyFailure),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            assert_eq!(resolved.status, "resolved");
            assert_eq!(fixture.check().await.state, "held");
            fixture.assert_no_job(&key).await;
        })
        .await;
    }
}
