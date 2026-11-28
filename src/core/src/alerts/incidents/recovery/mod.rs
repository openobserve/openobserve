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

pub mod checks;
mod sample;
mod samples;
mod state;
mod triggers;

use common::meta::incidents_v2::{
    RecoverySettings, incidents_v2_enabled, recovery_is_unlicensed, recovery_settings,
};
use config::{
    meta::{
        alerts::recovery::{Observation, Verdict, transitions::CheckState},
        triggers::{Trigger, TriggerStatus},
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    scheduler,
    table::{
        entity::{alert_incidents as incident, incident_recovery_checks::Model as Check},
        incident_recovery_checks as check_table,
    },
};
use sea_orm::DatabaseConnection;

pub(super) use self::{samples::last_measurement_at, triggers::sync_best_effort};
use self::{
    state::{Effects, RELAPSE_ACTOR, apply_observation, tick_clock},
    triggers::{load, reconcile, retire_claim},
};
use super::{ClusterIncidentTurns, IncidentTurns, SYSTEM_USER_EMAIL, finish_status_change};

const MICROS_PER_SECOND: i64 = 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TriggerKind {
    Grid,
    Held,
}

impl TriggerKind {
    fn interval(self, settings: &RecoverySettings) -> i64 {
        match self {
            Self::Grid => settings.grid_secs,
            Self::Held => settings.held_interval_secs,
        }
    }

    fn from_key(key: &str) -> (&str, Self) {
        match key.strip_suffix(check_table::HELD_TRIGGER_SUFFIX) {
            Some(id) => (id, Self::Held),
            None => (key, Self::Grid),
        }
    }

    fn key(self, id: &str) -> String {
        match self {
            Self::Grid => id.to_owned(),
            Self::Held => format!("{id}{}", check_table::HELD_TRIGGER_SUFFIX),
        }
    }
}

#[derive(Clone, Copy, Default)]
struct ApplyMetadata {
    measured_at: Option<i64>,
    verification_blocked: bool,
}

pub async fn handle(trigger: &Trigger) -> anyhow::Result<()> {
    let settings = recovery_settings();
    if !incidents_v2_enabled() || recovery_is_unlicensed() {
        let (_, kind) = TriggerKind::from_key(&trigger.module_key);
        return rearm(trigger, kind, false, &settings).await;
    }
    handle_claim(get_orm_client_rw().await, trigger, &settings).await
}

async fn handle_claim(
    db: &DatabaseConnection,
    trigger: &Trigger,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let (id, kind) = TriggerKind::from_key(&trigger.module_key);
    match run_tick(db, trigger, id, kind, settings).await {
        Ok(Some(failed)) => rearm(trigger, kind, failed, settings).await,
        Ok(None) => Ok(()),
        Err(error) => {
            log::warn!("[INCIDENT RECOVERY] Tick {}/{id}: {error:#}", trigger.org);
            rearm(trigger, kind, true, settings).await
        }
    }
}

async fn run_tick(
    db: &DatabaseConnection,
    trigger: &Trigger,
    id: &str,
    kind: TriggerKind,
    settings: &RecoverySettings,
) -> anyhow::Result<Option<bool>> {
    let org = &trigger.org;
    let Some((incident, check)) = load(db, org, id).await? else {
        retire_claim(db, trigger).await?;
        return Ok(None);
    };
    if trigger_kind(&incident, &check) != Some(kind) {
        reconcile(db, org, id, now_micros(), settings).await?;
        retire_claim(db, trigger).await?;
        return Ok(None);
    }

    // The claim can be requeued, so both workers must sample the same stored grid point.
    let (observation, metadata) =
        sample::observe(db, &incident, &check, trigger.next_run_at, settings).await;
    let failed = observation.verdict == Verdict::Error;
    let mut effects = advance_with_status_turn(db, &observation, org, metadata, settings).await?;
    #[cfg(feature = "enterprise")]
    if let Some(effect) = effects.repage.take() {
        effect.run(db, org, &incident.id).await;
    }
    effects.changed_checks.sort_unstable();
    effects.changed_checks.dedup();
    for id in effects.changed_checks {
        reconcile(db, org, &id, now_micros(), settings).await?;
    }
    Ok(Some(failed))
}

async fn advance_with_status_turn(
    db: &DatabaseConnection,
    observation: &Observation,
    org: &str,
    metadata: ApplyMetadata,
    settings: &RecoverySettings,
) -> anyhow::Result<Effects> {
    let id = &observation.incident_id;
    let turn = ClusterIncidentTurns.take(org, id).await?;
    let mut advanced = advance(db, observation, org, metadata, settings).await;
    if let Ok(effects) = &mut advanced
        && let Some(effect) = effects.status.take()
    {
        let actor = if effect.reopened.is_some() {
            RELAPSE_ACTOR
        } else {
            SYSTEM_USER_EMAIL
        };
        let muted = effect.muted
            && o2_enterprise::enterprise::common::config::get_config()
                .downtimes
                .enabled;
        if let Err(error) = finish_status_change(
            org,
            id,
            actor,
            muted,
            *effect.row,
            turn.fence.as_ref(),
            effect.reopened,
        )
        .await
        {
            log::error!("[INCIDENT RECOVERY] Status effects for {org}/{id}: {error:#}");
        }
    }
    turn.end().await;
    advanced
}

async fn advance(
    db: &DatabaseConnection,
    observation: &Observation,
    org: &str,
    metadata: ApplyMetadata,
    settings: &RecoverySettings,
) -> anyhow::Result<Effects> {
    let mut effects = apply_observation(db, org, observation, metadata, settings).await?;
    #[cfg(feature = "enterprise")]
    if effects.repage.is_some() {
        return Ok(effects);
    }
    if effects.status.is_none()
        && let Some(snapshot) = check_table::get(db, org, &observation.check_id).await?
    {
        let clock = tick_clock(db, org, &snapshot, now_micros(), settings).await?;
        effects.changed_checks.extend(clock.changed_checks);
        effects.status = clock.status;
    }
    Ok(effects)
}

async fn rearm(
    trigger: &Trigger,
    kind: TriggerKind,
    failed: bool,
    settings: &RecoverySettings,
) -> anyhow::Result<()> {
    let mut next = trigger.clone();
    let now = now_micros();
    next.next_run_at = if failed {
        retry_at(now, trigger.retries, settings)
    } else {
        next_grid(now.max(trigger.next_run_at), kind.interval(settings))
    };
    next.retries = if failed {
        trigger.retries.saturating_add(1)
    } else {
        0
    };
    next.status = TriggerStatus::Waiting;
    next.end_time = None;
    scheduler::complete_claim(next).await?;
    Ok(())
}

fn trigger_kind(incident: &incident::Model, check: &Check) -> Option<TriggerKind> {
    if check.deleted_at.is_some()
        || incident.security_case
        || incident.merged_into_id.is_some()
        || incident.fix_attempt_id.as_deref() != Some(check.attempt_id.as_str())
    {
        return None;
    }
    match (CheckState::parse(&check.state)?, incident.status.as_str()) {
        (CheckState::Checking, "resolved") => None,
        (CheckState::Checking | CheckState::Soaking, _) => Some(TriggerKind::Grid),
        (CheckState::Held, status) if status != "resolved" => Some(TriggerKind::Held),
        _ => None,
    }
}

fn watched_interval(state: CheckState, settings: &RecoverySettings) -> i64 {
    micros(if state == CheckState::Held {
        settings.held_interval_secs
    } else {
        settings.grid_secs
    })
}

fn retry_at(now: i64, retries: i32, settings: &RecoverySettings) -> i64 {
    let grid = micros(settings.grid_secs);
    let align_up = |at: i64| at.saturating_add((grid - at.rem_euclid(grid)) % grid);
    let due = align_up(now.saturating_add(micros(backoff_secs(retries, settings))));
    let cap = now.saturating_add(micros(settings.held_interval_secs));
    let capped = due.min(cap);
    // A short cap can leave no grid point at least one full interval away.
    (capped - capped.rem_euclid(grid)).max(align_up(now.saturating_add(grid)))
}

fn backoff_secs(retries: i32, settings: &RecoverySettings) -> i64 {
    let cap = settings.held_interval_secs;
    match retries {
        1 => (2 * settings.grid_secs).min(cap),
        2 => (4 * settings.grid_secs).min(cap),
        3.. => cap,
        _ => settings.grid_secs.min(cap),
    }
}

fn next_grid(now: i64, seconds: i64) -> i64 {
    let interval = micros(seconds);
    now - now.rem_euclid(interval) + interval
}

fn micros(seconds: i64) -> i64 {
    seconds * MICROS_PER_SECOND
}

#[cfg(test)]
pub(super) mod tests;
