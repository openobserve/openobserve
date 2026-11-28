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

use std::collections::HashMap;

use anyhow::Context;
use common::meta::incidents_v2::{
    RecoverySettings, recovery_max_checks_per_org, recovery_settings,
};
use config::{
    ider::generate_ulid,
    meta::alerts::{
        incidents::{IncidentEvent, IncidentEventType, RecoveryFailureReason},
        recovery::{
            RecoveryCondition,
            transitions::{
                self, CheckState, GuardFacts, IncidentEffect, RecoveryEvent, Refusal, Transition,
            },
        },
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    idempotency::canonical_sha256,
    table::{
        alert_incidents,
        entity::{alert_incidents as incident, incident_recovery_checks as check},
        incident_events, incident_recovery_checks as table,
    },
};
use sea_orm::{ActiveModelTrait, DatabaseConnection, DatabaseTransaction, Set, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::{
    super::mitigations::{MitigationError, ensure_recordable, keeps_human_impact_end, signals},
    Check, micros, samples,
    state::due_after_scope_cancel,
    trigger_kind,
};

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CheckPatch {
    recover_threshold: Option<f64>,
    alert_threshold: Option<f64>,
    expect_effect_secs: Option<i32>,
    volume_floor_pct: Option<i32>,
}

impl CheckPatch {
    fn apply(&self, old: RecoveryCondition) -> Result<RecoveryCondition, MitigationError> {
        if self
            .expect_effect_secs
            .is_some_and(|value| !(60..=7200).contains(&value))
        {
            return Err(MitigationError::BadRequest(
                "Expected effect must be 60–7200 seconds",
            ));
        }
        if self
            .volume_floor_pct
            .is_some_and(|value| !(10..=100).contains(&value))
        {
            return Err(MitigationError::BadRequest(
                "Volume floor must be 10–100 percent",
            ));
        }
        Ok(RecoveryCondition {
            recover_threshold: self.recover_threshold.unwrap_or(old.recover_threshold),
            alert_threshold: self.alert_threshold.unwrap_or(old.alert_threshold),
            expect_effect_secs: self.expect_effect_secs.unwrap_or(old.expect_effect_secs),
            volume_floor_pct: self.volume_floor_pct.unwrap_or(old.volume_floor_pct),
        })
    }
}

#[derive(Serialize, ToSchema)]
pub struct Cancelled {
    cancelled: bool,
}

#[derive(Serialize, ToSchema)]
pub struct RecoveryCheckList {
    checks: Vec<RecoveryCheckView>,
    due_at: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct RecoveryCheckView {
    check_id: String,
    state: String,
    state_reason: Option<String>,
    scope: Option<Value>,
    timestamps: CheckTimestamps,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    details: Option<CheckDetails>,
}

impl RecoveryCheckView {
    fn new(check: &Check, readable: bool) -> anyhow::Result<Self> {
        Ok(Self {
            check_id: check.id.clone(),
            state: check.state.clone(),
            state_reason: check.state_reason.clone(),
            scope: check
                .scope
                .as_deref()
                .map(serde_json::from_str)
                .transpose()?,
            timestamps: CheckTimestamps {
                created_at: check.created_at,
                updated_at: check.updated_at,
                trigger_at: check.trigger_at,
                effect_from_at: check.effect_from_at,
                deadline_at: check.deadline_at,
                verified_at: check.verified_at,
                soak_until: check.soak_until,
                last_checked_at: check.last_checked_at,
                pass_started_at: check.pass_started_at,
            },
            details: readable.then(|| CheckDetails::new(check)).transpose()?,
        })
    }
}

#[derive(Serialize, ToSchema)]
struct CheckTimestamps {
    created_at: i64,
    updated_at: i64,
    trigger_at: i64,
    effect_from_at: i64,
    deadline_at: i64,
    verified_at: Option<i64>,
    soak_until: Option<i64>,
    last_checked_at: Option<i64>,
    pass_started_at: Option<i64>,
}

#[derive(Serialize, ToSchema)]
struct CheckDetails {
    attempt_id: String,
    generation: i64,
    source: String,
    source_ref: Option<String>,
    target: Value,
    measure: Value,
    comparator: String,
    #[serde(flatten)]
    condition: RecoveryCondition,
    baseline: Option<f64>,
    baseline_volume: Option<f64>,
    last_value: Option<f64>,
    pass_window_secs: i32,
    passes: i32,
    soak_secs: i32,
    #[schema(value_type = Vec<Value>)]
    recent_samples: Vec<samples::Sample>,
}

impl CheckDetails {
    fn new(check: &Check) -> anyhow::Result<Self> {
        Ok(Self {
            attempt_id: check.attempt_id.clone(),
            generation: check.generation,
            source: check.source.clone(),
            source_ref: check.source_ref.clone(),
            target: serde_json::from_str(&check.target)?,
            measure: serde_json::from_str(&check.measure)?,
            comparator: check.comparator.clone(),
            condition: condition(check),
            baseline: check.baseline,
            baseline_volume: check.baseline_volume,
            last_value: check.last_value,
            pass_window_secs: check.pass_window_secs,
            passes: check.passes,
            soak_secs: check.soak_secs,
            recent_samples: samples::read(check)?,
        })
    }
}

pub struct RecoveryCheckRead {
    pub etag: String,
    pub security_case: bool,
    due_at: Option<i64>,
    rows: Vec<(Check, Option<String>)>,
}

impl RecoveryCheckRead {
    pub fn matches_etag<'a>(&self, headers: impl IntoIterator<Item = &'a str>) -> bool {
        headers
            .into_iter()
            .flat_map(|header| header.split(','))
            .map(str::trim)
            .any(|tag| tag.strip_prefix("W/").unwrap_or(tag) == self.etag)
    }

    pub fn into_body(self) -> anyhow::Result<RecoveryCheckList> {
        let checks = self
            .rows
            .into_iter()
            .map(|(check, denial)| RecoveryCheckView::new(&check, denial.is_none()))
            .collect::<anyhow::Result<_>>()?;
        Ok(RecoveryCheckList {
            checks,
            due_at: self.due_at,
        })
    }
}

#[derive(Clone, Copy)]
pub(super) struct CheckKey<'a> {
    pub org: &'a str,
    pub incident: &'a str,
    pub check: &'a str,
}

struct LockedAttempt {
    incident: incident::Model,
    checks: Vec<Check>,
    addressed: usize,
}

impl LockedAttempt {
    fn state(&self) -> Option<CheckState> {
        CheckState::parse(&self.checks[self.addressed].state)
    }

    fn apply(
        &self,
        event: RecoveryEvent,
        facts: GuardFacts,
    ) -> Result<Transition, MitigationError> {
        transitions::apply((table::phase(&self.incident), self.state()), event, facts)
            .map_err(MitigationError::Refused)
    }
}

pub async fn list(
    org: &str,
    incident: &str,
    viewer: &str,
) -> Result<RecoveryCheckRead, MitigationError> {
    list_with(get_orm_client_rw().await, org, incident, viewer).await
}

pub async fn edit(
    org: &str,
    incident: &str,
    check: &str,
    actor: &str,
    patch: CheckPatch,
) -> Result<RecoveryCheckView, MitigationError> {
    let key = CheckKey {
        org,
        incident,
        check,
    };
    let view = edit_with(
        get_orm_client_rw().await,
        key,
        actor,
        patch,
        &recovery_settings(),
    )
    .await?;
    super::sync_best_effort(org, incident).await;
    Ok(view)
}

pub async fn cancel(
    org: &str,
    incident: &str,
    check: &str,
    actor: &str,
) -> Result<Cancelled, MitigationError> {
    let key = CheckKey {
        org,
        incident,
        check,
    };
    cancel_with(get_orm_client_rw().await, key, actor).await?;
    super::sync_best_effort(org, incident).await;
    Ok(Cancelled { cancelled: true })
}

pub(super) async fn list_with(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
    viewer: &str,
) -> Result<RecoveryCheckRead, MitigationError> {
    let (incident, checks) = table::list_with_incident(db, org, id)
        .await?
        .ok_or(MitigationError::Missing)?;

    let mut access = HashMap::<String, Option<String>>::new();
    let mut rows = Vec::with_capacity(checks.len());
    for check in checks {
        let denial = match access.get(&check.target) {
            Some(denial) => denial.clone(),
            None => {
                let denial = signals::stored_read_denial(viewer, &check).await;
                access.insert(check.target.clone(), denial.clone());
                denial
            }
        };
        rows.push((check, denial));
    }
    let fingerprint = canonical_sha256(&json!({
        "checks": rows.iter().map(|(check, denial)| (&check.id, denial)).collect::<Vec<_>>(),
        "case": incident.security_case,
    }));
    let etag = canonical_sha256(&json!({
        "incident": id,
        "checks": rows.iter().map(|(check, _)| (&check.id, check.updated_at)).collect::<Vec<_>>(),
        "authorization": fingerprint,
        "due_at": incident.recovery_due_at,
    }));
    Ok(RecoveryCheckRead {
        etag: format!("\"{etag}\""),
        security_case: incident.security_case,
        due_at: incident.recovery_due_at,
        rows,
    })
}

pub(super) async fn edit_with(
    db: &DatabaseConnection,
    key: CheckKey<'_>,
    actor: &str,
    patch: CheckPatch,
    settings: &RecoverySettings,
) -> Result<RecoveryCheckView, MitigationError> {
    let snapshot = readable_check(db, key, actor).await?;
    let txn = db.begin().await?;
    table::lock_budget(&txn, key.org)
        .await
        .map_err(anyhow::Error::from)?;
    let mut attempt = lock_attempt(&txn, key, &snapshot).await?;
    let addressed = &mut attempt.checks[attempt.addressed];
    let old = condition(addressed);
    let new = patch.apply(old)?;
    let measure =
        signals::revise_measure(addressed, patch.alert_threshold, patch.recover_threshold)?;
    addressed.measure = measure;
    addressed.alert_threshold = new.alert_threshold;
    addressed.recover_threshold = new.recover_threshold;
    addressed.expect_effect_secs = new.expect_effect_secs;
    addressed.volume_floor_pct = new.volume_floor_pct;

    let now = now_micros();
    let event = IncidentEventType::RecoveryConditionChanged {
        check_id: key.check.to_owned(),
        old,
        new,
        actor: actor.to_owned(),
        transition_id: generate_ulid(now),
    };
    restart_edited_attempt(&txn, &mut attempt, now, settings).await?;
    append(&txn, key, now, event).await?;
    let view = RecoveryCheckView::new(&attempt.checks[attempt.addressed], true)?;
    txn.commit().await?;
    Ok(view)
}

pub(super) async fn cancel_with(
    db: &DatabaseConnection,
    key: CheckKey<'_>,
    actor: &str,
) -> Result<(), MitigationError> {
    let snapshot = readable_check(db, key, actor).await?;
    let txn = db.begin().await?;
    let mut attempt = lock_attempt(&txn, key, &snapshot).await?;
    let checking = attempt.state() == Some(CheckState::Checking);
    let other_watches = has_other_watches(&attempt);
    let transition = attempt.apply(
        RecoveryEvent::Cancel,
        GuardFacts {
            other_watches,
            current_attempt: true,
            ..Default::default()
        },
    )?;
    let now = now_micros();
    let unverified = transition.state == Some(CheckState::Unverified);
    let reason = unverified.then(|| {
        format!("monitoring cancelled by {actor}")
            .chars()
            .take(256)
            .collect()
    });
    let row = &mut attempt.checks[attempt.addressed];
    move_check(&txn, row, transition, now, reason).await?;
    if unverified {
        append(
            &txn,
            key,
            now,
            IncidentEventType::RecoveryFailed {
                transition_id: generate_ulid(now),
                check_id: row.id.clone(),
                attempt_id: None,
                reason: RecoveryFailureReason::Unverified,
            },
        )
        .await?;
    }
    if checking {
        let due = if transition.incident == IncidentEffect::ClearDueKeepingLatch {
            None
        } else {
            due_after_scope_cancel(
                &txn,
                &attempt.incident,
                &attempt.checks,
                &recovery_settings(),
            )
            .await?
        };
        let updated_at = now.max(attempt.incident.updated_at.saturating_add(1));
        let mut write: incident::ActiveModel = attempt.incident.into();
        write.recovery_due_at = Set(due);
        write.updated_at = Set(updated_at);
        write.update(&txn).await?;
    }
    txn.commit().await?;
    Ok(())
}

async fn restart_edited_attempt(
    txn: &DatabaseTransaction,
    attempt: &mut LockedAttempt,
    now: i64,
    settings: &RecoverySettings,
) -> Result<(), MitigationError> {
    let facts = GuardFacts {
        current_attempt: true,
        safe_threshold: true,
        now,
        ..Default::default()
    };
    let edit = RecoveryEvent::ConditionEdit;
    attempt.apply(edit, facts)?;
    require_live_capacity(txn, attempt).await?;

    let phase = table::phase(&attempt.incident);
    let mut due = None;
    for row in &mut attempt.checks {
        let state = CheckState::parse(&row.state);
        if !matches!(
            state,
            Some(CheckState::Checking | CheckState::Soaking | CheckState::Held)
        ) {
            continue;
        }
        let transition = transitions::apply(
            (phase, state),
            edit,
            GuardFacts {
                expect_effect_secs: row.expect_effect_secs,
                ..facts
            },
        )
        .map_err(MitigationError::Refused)?;
        let timing = transition.timing.context("T2 must set check timing")?;
        row.effect_from_at = timing.effect_from_at;
        row.deadline_at = timing
            .recovery_due_at
            .saturating_add(micros(settings.deadline_secs));
        due = Some(due.map_or(timing.recovery_due_at, |due: i64| {
            due.max(timing.recovery_due_at)
        }));
        move_check(txn, row, transition, now, None).await?;
    }
    let incident = &attempt.incident;
    let events = incident_events::get_with(txn, &incident.org_id, &incident.id).await?;
    let mut write: incident::ActiveModel = incident.clone().into();
    write.fix_applied_at = Set(Some(attempt.checks[attempt.addressed].trigger_at));
    write.mitigated_at = Set(None);
    write.recovered_at = Set(None);
    if !keeps_human_impact_end(incident, &events) {
        write.impact_end_at = Set(None);
    }
    write.recovery_due_at = Set(due);
    write.updated_at = Set(now.max(incident.updated_at.saturating_add(1)));
    write.update(txn).await?;
    Ok(())
}

async fn readable_check(
    db: &DatabaseConnection,
    key: CheckKey<'_>,
    actor: &str,
) -> Result<Check, MitigationError> {
    let check = table::get(db, key.org, key.check)
        .await?
        .filter(|check| check.incident_id == key.incident)
        .ok_or(MitigationError::Missing)?;
    if !signals::may_read(actor, &check).await {
        return Err(MitigationError::Forbidden);
    }
    Ok(check)
}

async fn lock_attempt(
    txn: &DatabaseTransaction,
    key: CheckKey<'_>,
    snapshot: &Check,
) -> Result<LockedAttempt, MitigationError> {
    let incident = alert_incidents::get_locked(txn, key.org, key.incident)
        .await?
        .ok_or(MitigationError::Missing)?;
    ensure_recordable(&incident)?;
    let checks: Vec<_> = table::list(txn, key.org, key.incident)
        .await?
        .into_iter()
        .filter(|check| Some(check.attempt_id.as_str()) == incident.fix_attempt_id.as_deref())
        .collect();
    let addressed = checks
        .iter()
        .position(|check| check.id == key.check)
        .ok_or(MitigationError::Refused(Refusal::InvalidTransition))?;
    if checks[addressed].target != snapshot.target {
        return Err(MitigationError::MeasurementChanged);
    }
    Ok(LockedAttempt {
        incident,
        checks,
        addressed,
    })
}

async fn require_live_capacity(
    txn: &DatabaseTransaction,
    attempt: &LockedAttempt,
) -> Result<(), MitigationError> {
    let held = attempt
        .checks
        .iter()
        .filter(|row| row.state == CheckState::Held.as_str())
        .count();
    if held > 0 {
        let live = table::count_live_org(txn, &attempt.incident.org_id).await?;
        if live.saturating_add(held as u64) > recovery_max_checks_per_org() as u64 {
            return Err(MitigationError::RevivalBudget);
        }
    }
    Ok(())
}

fn has_other_watches(attempt: &LockedAttempt) -> bool {
    let checking = attempt.state() == Some(CheckState::Checking);
    attempt.checks.iter().enumerate().any(|(i, row)| {
        i != attempt.addressed
            && trigger_kind(&attempt.incident, row).is_some()
            && if checking {
                matches!(
                    CheckState::parse(&row.state),
                    Some(CheckState::Checking | CheckState::Soaking)
                )
            } else {
                matches!(
                    CheckState::parse(&row.state),
                    Some(CheckState::Soaking | CheckState::Held)
                )
            }
    })
}

async fn move_check(
    txn: &DatabaseTransaction,
    row: &mut Check,
    transition: Transition,
    now: i64,
    reason: Option<String>,
) -> Result<(), MitigationError> {
    let state = transition
        .state
        .context("Check transition must set a state")?;
    row.state = state.as_str().to_owned();
    row.state_reason = reason;
    row.generation += i64::from(transition.bump_generation);
    if transition.reset_passes {
        row.passes = 0;
        row.pass_started_at = None;
    }
    row.updated_at = now.max(row.updated_at.saturating_add(1));
    check::ActiveModel::from(row.clone())
        .reset_all()
        .update(txn)
        .await?;
    Ok(())
}

fn condition(check: &Check) -> RecoveryCondition {
    RecoveryCondition {
        recover_threshold: check.recover_threshold,
        alert_threshold: check.alert_threshold,
        expect_effect_secs: check.expect_effect_secs,
        volume_floor_pct: check.volume_floor_pct,
    }
}

async fn append(
    txn: &DatabaseTransaction,
    key: CheckKey<'_>,
    now: i64,
    event_type: IncidentEventType,
) -> Result<(), MitigationError> {
    incident_events::append_in(
        txn,
        key.org,
        key.incident,
        IncidentEvent {
            timestamp: now,
            seq: 0,
            event_type,
        },
    )
    .await?;
    Ok(())
}
