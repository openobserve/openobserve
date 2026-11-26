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

use common::meta::incidents_v2::{RecoverySettings, recovery_max_checks_per_org};
use config::{
    ider::generate_ulid,
    meta::{
        alerts::{
            incidents::{
                IncidentEvent, IncidentEventType, RecoveryFailureReason, RecoveryRelapsePhase,
            },
            recovery::{
                Observation, Rollback, Verdict,
                transitions::{
                    self, CheckState, GuardFacts, IncidentEffect, Phase, RecoveryEvent, Transition,
                },
            },
        },
        system_settings::{SettingScope, keys::AUTO_RESOLVE_AT_HELD},
    },
    utils::time::now_micros,
};
use infra::table::{
    alert_incidents,
    entity::{alert_incidents as incident, incident_recovery_checks as check},
    incident_events, incident_recovery_checks as checks, system_settings,
};
use sea_orm::{ActiveModelTrait, DatabaseConnection, DatabaseTransaction, Set, TransactionTrait};

#[cfg(feature = "enterprise")]
use super::super::relapse_repage::RelapseRepage;
use super::{ApplyMetadata, Check, micros, next_grid, samples, trigger_kind, watched_interval};

const RELAPSE_DEFERRED: &str = "awaiting a live recovery check slot";
pub(super) const RELAPSE_ACTOR: &str = "system (relapse)";

#[derive(Default)]
pub(super) struct Effects {
    pub changed_checks: Vec<String>,
    pub status: Option<StatusEffect>,
    #[cfg(feature = "enterprise")]
    pub repage: Option<RelapseRepage>,
    close_at_held: bool,
}

pub(super) struct StatusEffect {
    pub row: Box<incident::Model>,
    pub reopened: Option<IncidentEvent>,
    pub muted: bool,
}

struct Attempt<'a> {
    txn: &'a DatabaseTransaction,
    row: incident::Model,
    active: incident::ActiveModel,
    checks: Vec<AttemptCheck>,
    cancelled: Vec<String>,
    effects: Effects,
}

impl<'a> Attempt<'a> {
    async fn load(
        txn: &'a DatabaseTransaction,
        row: incident::Model,
    ) -> anyhow::Result<Option<Self>> {
        let Some(attempt_id) = row.fix_attempt_id.as_deref() else {
            return Ok(None);
        };
        if row.security_case || row.merged_into_id.is_some() {
            return Ok(None);
        }
        let mut cancelled = Vec::new();
        let checks = checks::list(txn, &row.org_id, &row.id)
            .await?
            .into_iter()
            .filter(|check| check.attempt_id == attempt_id)
            .filter_map(|check| {
                if check.state == CheckState::Cancelled.as_str() {
                    cancelled.push(check.id);
                    None
                } else {
                    Some(check)
                }
            })
            .map(|check| {
                let state = CheckState::parse(&check.state)
                    .ok_or_else(|| anyhow::anyhow!("Unknown recovery state: {}", check.state))?;
                Ok(AttemptCheck {
                    check,
                    state,
                    dirty: false,
                })
            })
            .collect::<anyhow::Result<_>>()?;
        Ok(Some(Self {
            txn,
            active: row.clone().into(),
            row,
            checks,
            cancelled,
            effects: Effects::default(),
        }))
    }

    fn phase(&self) -> Phase {
        checks::phase(&self.row)
    }

    fn has_check(&self, check: &str) -> bool {
        self.checks.iter().any(|entry| entry.check.id == check)
            || self.cancelled.iter().any(|id| id == check)
    }

    fn locate(&self, id: &str, generation: i64) -> Option<usize> {
        self.checks.iter().position(|entry| {
            entry.check.id == id
                && entry.check.generation == generation
                && trigger_kind(&self.row, &entry.check).is_some()
        })
    }

    fn relapse_deferred(&self) -> bool {
        self.checks.iter().any(|entry| {
            matches!(entry.state, CheckState::Soaking | CheckState::Held)
                && entry.check.state_reason.as_deref() == Some(RELAPSE_DEFERRED)
        })
    }

    async fn append(&self, at: i64, event_type: IncidentEventType) -> anyhow::Result<()> {
        incident_events::append_in(
            self.txn,
            &self.row.org_id,
            &self.row.id,
            IncidentEvent {
                timestamp: at,
                seq: 0,
                event_type,
            },
        )
        .await?;
        Ok(())
    }

    async fn failure(
        &self,
        at: i64,
        index: usize,
        reason: RecoveryFailureReason,
    ) -> anyhow::Result<()> {
        self.append(
            at,
            IncidentEventType::RecoveryFailed {
                transition_id: generate_ulid(now_micros()),
                check_id: self.checks[index].check.id.clone(),
                attempt_id: (reason == RecoveryFailureReason::NotRecovering)
                    .then(|| self.checks[index].check.attempt_id.clone()),
                reason,
            },
        )
        .await
    }

    fn move_check(&mut self, index: usize, transition: Transition, reason: Option<String>) {
        let entry = &mut self.checks[index];
        if let Some(state) = transition.state {
            if entry.state != state {
                self.effects.changed_checks.push(entry.check.id.clone());
            }
            entry.state = state;
            entry.check.state = state.as_str().to_owned();
        }
        entry.check.generation += i64::from(transition.bump_generation);
        if transition.reset_passes {
            entry.check.passes = 0;
            entry.check.pass_started_at = None;
        }
        entry.check.state_reason = reason;
        entry.dirty = true;
    }

    async fn save(mut self) -> anyhow::Result<Effects> {
        let now = now_micros();
        if self.active.is_changed() {
            self.active.updated_at = Set(now.max(self.row.updated_at.saturating_add(1)));
            self.active.update(self.txn).await?;
        }
        for entry in self.checks.into_iter().filter(|entry| entry.dirty) {
            let mut row = entry.check;
            row.updated_at = now.max(row.updated_at.saturating_add(1));
            check::ActiveModel::from(row)
                .reset_all()
                .update(self.txn)
                .await?;
        }
        Ok(self.effects)
    }
}

struct AttemptCheck {
    check: Check,
    state: CheckState,
    dirty: bool,
}

#[derive(Clone, Copy)]
enum RestartBase {
    Edit(i64),
    Relapse(i64),
}

pub(super) async fn apply_observation(
    db: &DatabaseConnection,
    org: &str,
    observation: &Observation,
    metadata: ApplyMetadata,
    settings: &RecoverySettings,
) -> anyhow::Result<Effects> {
    infra::race_point!("recovery_apply_lock");
    let txn = db.begin().await?;
    // A held breach pair can move the attempt back into the live budget.
    if observation.verdict == Verdict::Breach {
        checks::lock_budget(&txn, org).await?;
    }
    let row = alert_incidents::get_locked(&txn, org, &observation.incident_id).await?;
    infra::race_point!("recovery_apply_locked");
    let effects = match row {
        Some(row) if row.fix_attempt_id.as_deref() == Some(&observation.attempt_id) => {
            if let Some(attempt) = Attempt::load(&txn, row).await? {
                apply_locked(attempt, observation, metadata, settings).await?
            } else {
                Effects::default()
            }
        }
        _ => Effects::default(),
    };
    txn.commit().await?;
    Ok(effects)
}

pub(super) async fn tick_clock(
    db: &DatabaseConnection,
    org: &str,
    snapshot: &Check,
    now: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<Effects> {
    infra::race_point!("recovery_tick_lock");
    let txn = db.begin().await?;
    let budget_locked = matches!(
        CheckState::parse(&snapshot.state),
        Some(CheckState::Soaking | CheckState::Held)
    );
    if budget_locked {
        checks::lock_budget(&txn, org).await?;
    }
    let row = alert_incidents::get_locked(&txn, org, &snapshot.incident_id).await?;
    infra::race_point!("recovery_tick_locked");
    let effects = if let Some(row) = row
        && row.fix_attempt_id.as_deref() == Some(&snapshot.attempt_id)
        && let Some(mut attempt) = Attempt::load(&txn, row).await?
        && attempt.locate(&snapshot.id, snapshot.generation).is_some()
    {
        clock_locked(&mut attempt, now, settings, budget_locked).await?;
        let row = attempt.row.clone();
        let mut effects = attempt.save().await?;
        close_at_held(&txn, &row, now, &mut effects).await?;
        effects
    } else {
        Effects::default()
    };
    txn.commit().await?;
    Ok(effects)
}

pub(super) async fn due_after_scope_cancel(
    txn: &DatabaseTransaction,
    row: &incident::Model,
    checks: &[Check],
    settings: &RecoverySettings,
) -> anyhow::Result<Option<i64>> {
    let remaining = checks
        .iter()
        .filter(|check| check.state != CheckState::Cancelled.as_str())
        .count();
    let checking: Vec<_> = checks
        .iter()
        .filter(|check| check.state == CheckState::Checking.as_str())
        .collect();
    if checking.is_empty() {
        return Ok(None);
    }
    let events = incident_events::get_with(txn, &row.org_id, &row.id).await?;
    let restart = restart_bases(&events, |id| checks.iter().any(|check| check.id == id)).next();
    Ok(due_parts(&checking, remaining, restart, settings)
        .map(|(base, streak_end)| streak_end.unwrap_or(base)))
}

async fn apply_locked(
    mut attempt: Attempt<'_>,
    observation: &Observation,
    metadata: ApplyMetadata,
    settings: &RecoverySettings,
) -> anyhow::Result<Effects> {
    let Some(index) = attempt.locate(&observation.check_id, observation.generation) else {
        return Ok(Effects::default());
    };
    let entry = &attempt.checks[index];
    let at = observation.sample_ts;
    if entry.check.last_checked_at.is_some_and(|last| at <= last) {
        return Ok(Effects::default());
    }
    if let Verdict::RollbackObserved(rollback) = &observation.verdict {
        apply_rollback(&mut attempt, index, observation, rollback, settings).await?;
        return attempt.save().await;
    }
    let interval = watched_interval(entry.state, settings);
    let history = samples::read(&entry.check)?;
    let measured_at = metadata.measured_at.unwrap_or(at);
    if entry.state == CheckState::Held
        && !attempt.relapse_deferred()
        && let Some(reason) = watch_pause_reason(&attempt, entry, &history, measured_at, interval)
    {
        stop_watches(
            &mut attempt,
            measured_at,
            RecoveryEvent::WatchPaused,
            &reason,
        )
        .await?;
        return attempt.save().await;
    }
    let entry = &mut attempt.checks[index];
    let history = samples::record(&mut entry.check, history, observation, metadata, interval)?;
    entry.dirty = true;
    if let Verdict::Denied { reason } = &observation.verdict {
        apply_denial(&mut attempt, index, at, reason.clone()).await?;
    } else {
        match entry.state {
            CheckState::Checking => {
                let passing = history
                    .last()
                    .is_some_and(|s| s.eligible && s.verdict == Verdict::Pass);
                apply_checking(&mut attempt, index, at, passing, settings).await?;
            }
            CheckState::Soaking | CheckState::Held => {
                if entry.state == CheckState::Soaking {
                    samples::extend_soak(&mut entry.check, &history);
                }
                if samples::breach_pair(&entry.check, &history, interval) {
                    if attempt.phase() == Phase::Resolved {
                        return reopen_after_relapse(attempt, index, at).await;
                    }
                    apply_relapse(&mut attempt, index, at, settings).await?;
                }
            }
            _ => {}
        }
    }
    attempt.save().await
}

async fn apply_checking(
    attempt: &mut Attempt<'_>,
    index: usize,
    at: i64,
    passing: bool,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let check = &mut attempt.checks[index].check;
    let broke_streak = !passing && check.passes > 0;
    if passing {
        check.passes = check.passes.saturating_add(1);
        check.pass_started_at.get_or_insert(at);
    } else {
        check.passes = 0;
        check.pass_started_at = None;
    }
    if all_scopes_passed(attempt, at, micros(settings.grid_secs))? {
        verify(attempt, at).await?;
    } else if attempt.row.not_recovering_at.is_none() {
        update_due(attempt, settings, broke_streak.then_some(at)).await?;
    }
    Ok(())
}

fn all_scopes_passed(attempt: &Attempt<'_>, at: i64, interval: i64) -> anyhow::Result<bool> {
    let Some(deadline) = attempt
        .checks
        .iter()
        .map(|entry| entry.check.deadline_at)
        .min()
    else {
        return Ok(false);
    };
    if at > deadline {
        return Ok(false);
    }
    for entry in &attempt.checks {
        let check = &entry.check;
        let Some(start) = check.pass_started_at else {
            return Ok(false);
        };
        if entry.state != CheckState::Checking {
            return Ok(false);
        }
        let history = samples::read(check)?;
        if !samples::current(check, &history).is_some_and(|last| {
            last.eligible
                && last.verdict == Verdict::Pass
                && !last.verification_blocked
                && samples::fresh(last.ts, at, interval)
                && last.measurement_at() <= deadline
                && last.ts >= check.effect_from_at
                && last.ts - start >= micros(i64::from(check.pass_window_secs))
        }) {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn verify(attempt: &mut Attempt<'_>, at: i64) -> anyhow::Result<()> {
    let phase = attempt.phase();
    let impact_end = attempt
        .checks
        .iter()
        .filter_map(|entry| entry.check.pass_started_at)
        .max();
    for index in 0..attempt.checks.len() {
        let transition = transition(
            phase,
            attempt.checks[index].state,
            RecoveryEvent::Pass,
            observation_facts(at),
        )?;
        attempt.move_check(index, transition, None);
        let check = &mut attempt.checks[index].check;
        check.verified_at = Some(at);
        check.soak_until = Some(at + micros(i64::from(check.soak_secs)));
    }
    attempt.active.mitigated_at = Set(Some(at));
    if attempt.row.impact_end_at.is_none() {
        attempt.active.impact_end_at = Set(impact_end);
    }
    attempt.active.fix_applied_at = Set(None);
    attempt.active.recovery_due_at = Set(None);
    attempt.active.not_recovering_at = Set(None);
    attempt
        .append(
            at,
            IncidentEventType::RecoveryVerified {
                transition_id: generate_ulid(now_micros()),
            },
        )
        .await
}

async fn apply_denial(
    attempt: &mut Attempt<'_>,
    index: usize,
    at: i64,
    reason: String,
) -> anyhow::Result<()> {
    let phase = attempt.phase();
    let facts = observation_facts(at);
    let transition = transition(
        phase,
        attempt.checks[index].state,
        RecoveryEvent::Denied,
        facts,
    )?;
    if transition.state == Some(CheckState::Unverified) {
        return stop_watches(attempt, at, RecoveryEvent::Denied, &reason).await;
    }
    attempt.move_check(index, transition, Some(reason));
    clear_due_if_finished(attempt);
    attempt
        .failure(at, index, RecoveryFailureReason::Denied)
        .await
}

async fn apply_relapse(
    attempt: &mut Attempt<'_>,
    index: usize,
    at: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    if attempt.phase() != Phase::Mitigated || attempt.relapse_deferred() {
        return Ok(());
    }
    let state = attempt.checks[index].state;
    let relapse_phase = if state == CheckState::Held {
        RecoveryRelapsePhase::HeldWatch
    } else {
        RecoveryRelapsePhase::Soak
    };
    if relapse_has_capacity(attempt).await? {
        restart_after_relapse(attempt, at, settings).await?;
    } else {
        let transition = transition(
            Phase::Mitigated,
            state,
            RecoveryEvent::BreachPair,
            GuardFacts {
                relapse_budget_full: true,
                ..observation_facts(at)
            },
        )?;
        attempt.move_check(index, transition, Some(RELAPSE_DEFERRED.to_owned()));
    }
    let transition_id = generate_ulid(now_micros());
    #[cfg(feature = "enterprise")]
    {
        let check = &attempt.checks[index].check;
        let acknowledgements = alert_incidents::relapse_repage::capture_acks(
            attempt.txn,
            &attempt.row.org_id,
            &attempt.row.id,
        )
        .await?;
        attempt.effects.repage = Some(RelapseRepage {
            transition_id: transition_id.clone(),
            committed_at: now_micros(),
            reopen_count: attempt.row.reopen_count,
            check_id: check.id.clone(),
            attempt_id: check.attempt_id.clone(),
            generation: check.generation,
            after_resolve: false,
            acknowledgements,
        });
    }
    attempt
        .append(
            at,
            IncidentEventType::RecoveryRelapsed {
                transition_id,
                check_id: attempt.checks[index].check.id.clone(),
                phase: relapse_phase,
            },
        )
        .await
}

async fn reopen_after_relapse(
    attempt: Attempt<'_>,
    index: usize,
    at: i64,
) -> anyhow::Result<Effects> {
    let entry = &attempt.checks[index];
    let relapse = transition(
        attempt.phase(),
        entry.state,
        RecoveryEvent::BreachPair,
        observation_facts(at),
    )?;
    anyhow::ensure!(
        relapse.incident == IncidentEffect::ReopenAndClearAttempt,
        "Expected recovery relapse to reopen the incident"
    );
    let now = now_micros();
    let transition_id = generate_ulid(now);
    attempt
        .append(
            at,
            IncidentEventType::RecoveryRelapsed {
                transition_id: transition_id.clone(),
                check_id: entry.check.id.clone(),
                phase: RecoveryRelapsePhase::AfterResolve,
            },
        )
        .await?;
    let txn = attempt.txn;
    let row = attempt.row.clone();
    let event = IncidentEvent {
        timestamp: now,
        seq: 0,
        event_type: IncidentEventType::Reopened {
            transition_id: Some(transition_id.clone()),
            user_id: RELAPSE_ACTOR.to_owned(),
            reason: "Recovery relapsed after resolve".to_owned(),
        },
    };
    let muted = row.muted_by_downtime_id.is_some();
    #[cfg(feature = "enterprise")]
    let (check_id, attempt_id, generation) = (
        entry.check.id.clone(),
        entry.check.attempt_id.clone(),
        entry.check.generation + 1,
    );
    let mut effects = attempt.save().await?;
    let reopened = alert_incidents::reopen_in(txn, row, Some(event), now).await?;
    #[cfg(feature = "enterprise")]
    {
        let acknowledgements = alert_incidents::relapse_repage::capture_acks(
            txn,
            &reopened.row.org_id,
            &reopened.row.id,
        )
        .await?;
        effects.repage = Some(RelapseRepage {
            transition_id,
            committed_at: now,
            reopen_count: reopened.row.reopen_count,
            check_id,
            attempt_id,
            generation,
            after_resolve: true,
            acknowledgements,
        });
    }
    effects.changed_checks.extend(reopened.stopped_checks);
    effects.status = Some(StatusEffect {
        row: Box::new(reopened.row),
        reopened: reopened.event,
        muted,
    });
    Ok(effects)
}

async fn restart_after_relapse(
    attempt: &mut Attempt<'_>,
    at: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let facts = GuardFacts {
        relapse_interval_secs: Some(settings.relapse_secs),
        ..observation_facts(at)
    };
    for i in 0..attempt.checks.len() {
        let state = attempt.checks[i].state;
        if !matches!(state, CheckState::Soaking | CheckState::Held) {
            continue;
        }
        let transition = transition(Phase::Mitigated, state, RecoveryEvent::BreachPair, facts)?;
        let timing = transition
            .timing
            .ok_or_else(|| anyhow::anyhow!("Missing relapse timing"))?;
        attempt.move_check(i, transition, None);
        let check = &mut attempt.checks[i].check;
        check.effect_from_at = timing.effect_from_at;
        check.deadline_at = timing.recovery_due_at + micros(settings.deadline_secs);
        check.soak_until = None;
        attempt.active.recovery_due_at = Set(Some(timing.recovery_due_at));
        attempt.active.fix_applied_at = Set(Some(check.trigger_at));
    }
    attempt.active.mitigated_at = Set(None);
    attempt.active.recovered_at = Set(None);
    attempt.active.impact_end_at = Set(None);
    Ok(())
}

async fn relapse_has_capacity(attempt: &Attempt<'_>) -> anyhow::Result<bool> {
    let additional = attempt
        .checks
        .iter()
        .filter(|entry| entry.state == CheckState::Held)
        .count() as u64;
    if additional == 0 {
        return Ok(true);
    }
    let cap = recovery_max_checks_per_org() as u64;
    let live = checks::count_live_org(attempt.txn, &attempt.row.org_id).await?;
    Ok(live.saturating_add(additional) <= cap)
}

async fn apply_rollback(
    attempt: &mut Attempt<'_>,
    index: usize,
    observation: &Observation,
    rollback: &Rollback,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let entry = &attempt.checks[index];
    if rollback.at <= entry.check.effect_from_at
        || rollback.at > observation.sample_ts
        || !matches!(attempt.phase(), Phase::Open | Phase::Mitigated)
        || !matches!(entry.state, CheckState::Checking | CheckState::Soaking)
    {
        return Ok(());
    }
    let phase = attempt.phase();
    let restart = latest_restart(attempt).await?;
    let transition = transition(
        phase,
        entry.state,
        RecoveryEvent::RollbackObserved,
        observation_facts(observation.sample_ts),
    )?;
    attempt.move_check(index, transition, None);
    let check = &mut attempt.checks[index].check;
    check.effect_from_at = rollback.at;
    check.deadline_at = base_due(check, restart, settings) + micros(settings.deadline_secs);
    // The effect move consumes this grid point without replacing the last measurement.
    check.last_checked_at = Some(observation.sample_ts);
    if phase == Phase::Open {
        update_due_from_base(attempt, restart, settings, None);
    }
    attempt
        .append(
            rollback.at,
            IncidentEventType::RollbackObserved {
                transition_id: generate_ulid(now_micros()),
                attempt_id: observation.attempt_id.clone(),
                change_ref: rollback.change_ref.clone(),
                at: rollback.at,
            },
        )
        .await
}

async fn clock_locked(
    attempt: &mut Attempt<'_>,
    now: i64,
    settings: &RecoverySettings,
    budget_locked: bool,
) -> anyhow::Result<()> {
    match attempt.phase() {
        Phase::Mitigated if attempt.relapse_deferred() => {
            if budget_locked && relapse_has_capacity(attempt).await? {
                let events =
                    incident_events::get_with(attempt.txn, &attempt.row.org_id, &attempt.row.id)
                        .await?;
                let at = deferred_relapse_at(&events, |id| attempt.has_check(id))
                    .ok_or_else(|| anyhow::anyhow!("Missing deferred relapse event"))?;
                restart_after_relapse(attempt, at, settings).await?;
            }
            Ok(())
        }
        Phase::Open => check_deadline(attempt, now, settings).await,
        Phase::Mitigated | Phase::Resolved => {
            watch_clock(attempt, now, settings, budget_locked).await
        }
        Phase::MergedAway => Ok(()),
    }
}

async fn check_deadline(
    attempt: &mut Attempt<'_>,
    now: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    for i in 0..attempt.checks.len() {
        let entry = &attempt.checks[i];
        if entry.state != CheckState::Checking || now <= entry.check.deadline_at {
            continue;
        }
        let transition = transition(
            Phase::Open,
            entry.state,
            RecoveryEvent::ExpiryTick,
            GuardFacts {
                expiry_reached: true,
                ..observation_facts(now)
            },
        )?;
        attempt.move_check(i, transition, Some("recovery deadline expired".to_owned()));
        attempt
            .failure(now, i, RecoveryFailureReason::Expired)
            .await?;
    }
    if let Some(due) = attempt.row.recovery_due_at
        && now >= due
        && attempt.row.not_recovering_at.is_none()
        && let Some((index, ts)) = failure_sample(attempt, now, micros(settings.grid_secs))?
    {
        let transition = transition(
            Phase::Open,
            CheckState::Checking,
            RecoveryEvent::FailureTick,
            GuardFacts {
                due_at: Some(due),
                fresh_non_pass_at: Some(ts),
                ..observation_facts(now)
            },
        )?;
        let IncidentEffect::LatchAt(at) = transition.incident else {
            anyhow::bail!("Missing recovery latch time");
        };
        attempt.active.not_recovering_at = Set(Some(at));
        attempt
            .failure(at, index, RecoveryFailureReason::NotRecovering)
            .await?;
    }
    clear_due_if_finished(attempt);
    Ok(())
}

fn failure_sample(
    attempt: &Attempt<'_>,
    now: i64,
    interval: i64,
) -> anyhow::Result<Option<(usize, i64)>> {
    let mut candidate = None;
    for (i, entry) in attempt.checks.iter().enumerate() {
        if entry.state != CheckState::Checking {
            continue;
        }
        let history = samples::read(&entry.check)?;
        let Some(sample) = samples::current(&entry.check, &history) else {
            continue;
        };
        let measured_at = sample.measurement_at();
        if sample.eligible
            && matches!(sample.verdict, Verdict::NotYet | Verdict::Breach)
            && samples::fresh(sample.ts, now, interval)
            && samples::fresh(measured_at, now, interval)
            && measured_at <= entry.check.deadline_at
            && candidate.is_none_or(|(_, ts)| measured_at > ts)
        {
            candidate = Some((i, measured_at));
        }
    }
    Ok(candidate)
}

async fn watch_clock(
    attempt: &mut Attempt<'_>,
    now: i64,
    settings: &RecoverySettings,
    budget_locked: bool,
) -> anyhow::Result<()> {
    let mut soak_covered = true;
    for entry in &attempt.checks {
        if entry.state == CheckState::Unverified {
            return stop_watches(
                attempt,
                now,
                RecoveryEvent::WatchPaused,
                "required scope is unverified",
            )
            .await;
        }
        if trigger_kind(&attempt.row, &entry.check).is_none() {
            soak_covered = false;
            continue;
        }
        let history = samples::read(&entry.check)?;
        let interval = watched_interval(entry.state, settings);
        if let Some(reason) = watch_pause_reason(attempt, entry, &history, now, interval) {
            return stop_watches(attempt, now, RecoveryEvent::WatchPaused, &reason).await;
        }
        soak_covered &= entry.state == CheckState::Soaking
            && entry.check.soak_until.is_some_and(|until| now >= until)
            && samples::current(&entry.check, &history)
                .is_some_and(|sample| sample.eligible && samples::fresh(sample.ts, now, interval));
    }
    if budget_locked && soak_covered && !attempt.checks.is_empty() {
        complete_soak(attempt, now, settings).await?;
    }
    Ok(())
}

fn watch_pause_reason(
    attempt: &Attempt<'_>,
    entry: &AttemptCheck,
    history: &[samples::Sample],
    now: i64,
    interval: i64,
) -> Option<String> {
    let pause = watch_pause(attempt, entry, history, now, interval);
    (pause > micros(i64::from(entry.check.soak_secs))).then(|| {
        let what = if entry.state == CheckState::Held {
            "watch"
        } else {
            "soak"
        };
        format!(
            "{what} paused {}m of {}m",
            pause / micros(60),
            entry.check.soak_secs / 60
        )
    })
}

fn watch_pause(
    attempt: &Attempt<'_>,
    entry: &AttemptCheck,
    history: &[samples::Sample],
    now: i64,
    interval: i64,
) -> i64 {
    if entry.state == CheckState::Soaking {
        return samples::soak_pause(&entry.check, history, now, interval);
    }
    let last_eligible = history.iter().rev().find(|sample| {
        sample.generation == entry.check.generation && sample.eligible && sample.ts <= now
    });
    let start = attempt
        .row
        .recovered_at
        .or(entry.check.verified_at)
        .unwrap_or(now);
    // Silence before the next scheduled sample is expected.
    let next_expected = next_grid(
        last_eligible.map_or(start, |sample| sample.ts.max(start)),
        interval / micros(1),
    );
    now.saturating_sub(next_expected).max(0)
}

async fn stop_watches(
    attempt: &mut Attempt<'_>,
    at: i64,
    event: RecoveryEvent,
    reason: &str,
) -> anyhow::Result<()> {
    let phase = attempt.phase();
    // A terminal required scope makes attempt-wide coverage impossible.
    for index in 0..attempt.checks.len() {
        let entry = &attempt.checks[index];
        if !matches!(entry.state, CheckState::Soaking | CheckState::Held)
            || trigger_kind(&attempt.row, &entry.check).is_none()
        {
            continue;
        }
        let facts = GuardFacts {
            has_held_watch: entry.state == CheckState::Held,
            ..observation_facts(at)
        };
        let transition = transition(phase, entry.state, event, facts)?;
        attempt.move_check(index, transition, Some(reason.to_owned()));
        attempt
            .failure(at, index, RecoveryFailureReason::Unverified)
            .await?;
    }
    Ok(())
}

async fn complete_soak(
    attempt: &mut Attempt<'_>,
    now: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let phase = attempt.phase();
    let cap = settings.max_held_watches_per_org;
    let org = &attempt.row.org_id;
    let auto_resolve = phase != Phase::Resolved
        && system_settings::get_with(
            attempt.txn,
            &SettingScope::Org,
            Some(org),
            None,
            AUTO_RESOLVE_AT_HELD,
        )
        .await?
        .is_some_and(|setting| setting.setting_value.as_bool() == Some(true));
    let held_budget = phase == Phase::Resolved
        || checks::count_held_watches(attempt.txn, org).await? + attempt.checks.len() as u64
            <= cap as u64;
    // D6 needs no watch slot because the same transaction ends the watch.
    let held = held_budget
        || (auto_resolve && !alert_incidents::has_open_firing(attempt.txn, &attempt.row).await?);
    for i in 0..attempt.checks.len() {
        let transition = transition(
            phase,
            attempt.checks[i].state,
            RecoveryEvent::SoakComplete,
            GuardFacts {
                coverage: true,
                held_budget: held,
                ..observation_facts(now)
            },
        )?;
        let reason = (!held).then(|| format!("held watch limit reached ({cap})"));
        attempt.move_check(i, transition, reason);
    }
    if held {
        attempt.active.recovered_at = Set(Some(now));
        attempt
            .append(
                now,
                IncidentEventType::RecoveryHeld {
                    transition_id: generate_ulid(now_micros()),
                },
            )
            .await?;
        attempt.effects.close_at_held = auto_resolve;
    } else {
        for i in 0..attempt.checks.len() {
            attempt
                .failure(now, i, RecoveryFailureReason::Unverified)
                .await?;
        }
    }
    Ok(())
}

async fn close_at_held(
    txn: &DatabaseTransaction,
    row: &incident::Model,
    now: i64,
    effects: &mut Effects,
) -> anyhow::Result<()> {
    use alert_incidents::{CloseCaller, GuardedClose};

    if !effects.close_at_held {
        return Ok(());
    }
    let closed = alert_incidents::resolve_guarded_in(
        txn,
        &row.org_id,
        &row.id,
        CloseCaller::AlertRecovery,
        now,
        row.fix_attempt_id.as_deref(),
    )
    .await?;
    if let GuardedClose::Closed {
        before,
        after,
        stopped_checks,
    } = closed
    {
        effects.changed_checks.extend(stopped_checks);
        effects.status = Some(StatusEffect {
            row: after,
            reopened: None,
            muted: before.muted_by_downtime_id.is_some(),
        });
    }
    Ok(())
}

async fn update_due(
    attempt: &mut Attempt<'_>,
    settings: &RecoverySettings,
    streak_broke_at: Option<i64>,
) -> anyhow::Result<()> {
    let restart = if attempt
        .checks
        .iter()
        .any(|entry| entry.check.effect_from_at > entry.check.trigger_at)
    {
        latest_restart(attempt).await?
    } else {
        None
    };
    update_due_from_base(attempt, restart, settings, streak_broke_at);
    Ok(())
}

fn update_due_from_base(
    attempt: &mut Attempt<'_>,
    restart: Option<RestartBase>,
    settings: &RecoverySettings,
    streak_broke_at: Option<i64>,
) {
    let checking: Vec<_> = attempt
        .checks
        .iter()
        .filter(|entry| entry.state == CheckState::Checking)
        .map(|entry| &entry.check)
        .collect();
    let Some((base, streak_end)) = due_parts(&checking, attempt.checks.len(), restart, settings)
    else {
        return;
    };
    let due = if let Some(streak_end) = streak_end {
        streak_end
    } else if let Some(at) = streak_broke_at {
        base.max(at)
    } else if attempt
        .checks
        .iter()
        .any(|entry| entry.check.effect_from_at > entry.check.trigger_at)
    {
        base.max(attempt.row.recovery_due_at.unwrap_or(base))
    } else {
        attempt.row.recovery_due_at.unwrap_or(base)
    };
    if attempt.row.recovery_due_at != Some(due) {
        attempt.active.recovery_due_at = Set(Some(due));
    }
}

async fn latest_restart(attempt: &Attempt<'_>) -> anyhow::Result<Option<RestartBase>> {
    let events =
        incident_events::get_with(attempt.txn, &attempt.row.org_id, &attempt.row.id).await?;
    let base = restart_bases(&events, |id| attempt.has_check(id)).next();
    Ok(base)
}

fn restart_bases<'a>(
    events: &'a [IncidentEvent],
    belongs_to_attempt: impl Fn(&str) -> bool + 'a,
) -> impl Iterator<Item = RestartBase> + 'a {
    events
        .iter()
        .rev()
        .filter_map(move |event| match &event.event_type {
            IncidentEventType::RecoveryRelapsed { check_id, .. }
                if belongs_to_attempt(check_id) =>
            {
                Some(RestartBase::Relapse(event.timestamp))
            }
            IncidentEventType::RecoveryConditionChanged { check_id, .. }
                if belongs_to_attempt(check_id) =>
            {
                Some(RestartBase::Edit(event.timestamp))
            }
            _ => None,
        })
}

fn deferred_relapse_at(
    events: &[IncidentEvent],
    belongs_to_attempt: impl Fn(&str) -> bool,
) -> Option<i64> {
    restart_bases(events, belongs_to_attempt).find_map(|base| match base {
        RestartBase::Relapse(at) => Some(at),
        RestartBase::Edit(_) => None,
    })
}

fn due_parts(
    checking: &[&Check],
    remaining: usize,
    restart: Option<RestartBase>,
    settings: &RecoverySettings,
) -> Option<(i64, Option<i64>)> {
    let base = checking
        .iter()
        .map(|check| base_due(check, restart, settings))
        .max()?;
    let streak_end =
        if checking.len() == remaining && checking.iter().all(|c| c.pass_started_at.is_some()) {
            checking
                .iter()
                .filter_map(|c| {
                    c.pass_started_at
                        .map(|at| at + micros(i64::from(c.pass_window_secs)))
                })
                .max()
                .map(|at| at.max(base))
        } else {
            None
        };
    Some((base, streak_end))
}

fn base_due(check: &Check, restart: Option<RestartBase>, settings: &RecoverySettings) -> i64 {
    let (base, expect) = match restart {
        None => (check.trigger_at, check.expect_effect_secs),
        Some(RestartBase::Edit(at)) => (at, check.expect_effect_secs),
        Some(RestartBase::Relapse(at)) => (at, settings.relapse_secs),
    };
    let due = base + micros(i64::from(expect));
    if check.effect_from_at > base {
        due.max(check.effect_from_at + micros(i64::from(settings.expect_effect_secs)))
    } else {
        due
    }
}

fn clear_due_if_finished(attempt: &mut Attempt<'_>) {
    if attempt.row.recovery_due_at.is_some()
        && !attempt
            .checks
            .iter()
            .any(|entry| entry.state == CheckState::Checking)
    {
        attempt.active.recovery_due_at = Set(None);
    }
}

fn observation_facts(now: i64) -> GuardFacts {
    GuardFacts {
        current_attempt: true,
        current_generation: true,
        fresh_observation: true,
        now,
        ..Default::default()
    }
}

fn transition(
    phase: Phase,
    state: CheckState,
    event: RecoveryEvent,
    facts: GuardFacts,
) -> anyhow::Result<Transition> {
    transitions::apply((phase, Some(state)), event, facts)
        .map_err(|refusal| anyhow::anyhow!("Recovery transition {event:?} refused: {refusal:?}"))
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::recovery::RecoveryCondition;

    use super::*;

    #[test]
    fn deferred_relapse_uses_the_current_attempts_breach_time() {
        let relapse = |timestamp, check_id: &str| IncidentEvent {
            timestamp,
            seq: timestamp,
            event_type: IncidentEventType::RecoveryRelapsed {
                transition_id: format!("transition-{timestamp}"),
                check_id: check_id.to_owned(),
                phase: RecoveryRelapsePhase::HeldWatch,
            },
        };
        let condition = RecoveryCondition {
            recover_threshold: 1.0,
            alert_threshold: 2.0,
            expect_effect_secs: 600,
            volume_floor_pct: 50,
        };
        let edit = IncidentEvent {
            timestamp: 3,
            seq: 3,
            event_type: IncidentEventType::RecoveryConditionChanged {
                check_id: "current".into(),
                old: condition,
                new: RecoveryCondition {
                    recover_threshold: 1.5,
                    ..condition
                },
                actor: "ana".into(),
                transition_id: "edit".into(),
            },
        };
        let history = [relapse(1, "current"), relapse(2, "old"), edit];
        assert_eq!(deferred_relapse_at(&history, |id| id == "current"), Some(1));
    }
}
