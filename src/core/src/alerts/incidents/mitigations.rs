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

#[cfg(feature = "enterprise")]
pub(super) mod signals;

use std::collections::BTreeSet;

use config::{
    meta::alerts::{
        incidents::{IncidentEvent, IncidentEventType},
        recovery::transitions::{
            self, CheckState, CheckTiming, GuardFacts, RecoveryEvent, Refusal,
        },
    },
    utils::time::now_micros,
};
use infra::table::{
    alert_incidents,
    entity::{
        alert_incident_alerts as members, alert_incidents as incident,
        incident_recovery_checks::Model as Check,
    },
    incident_events, incident_recovery_checks as checks,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction,
    EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
#[cfg(feature = "enterprise")]
pub use signals::prepare_watch;
use utoipa::ToSchema;

const MINUTE: i64 = 60_000_000;
const REPLAY_WINDOW: i64 = 10 * MINUTE;
const MAX_PER_ATTEMPT: usize = 5;
// Each value lands in the incident timeline, which every read of the incident returns.
const MAX_SUMMARY_CHARS: usize = 2000;
const MAX_KEY_CHARS: usize = 64;
const MAX_REF_CHARS: usize = 512;
const MAX_COMMAND_CHARS: usize = 4096;
const TOO_LONG: &str =
    "A summary is at most 2000 characters, a kind or option key 64, a ref 512 and a command 4096";

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RecordRequest {
    pub summary: String,
    pub kind: String,
    pub option_key: Option<String>,
    pub command: Option<String>,
    pub source_ref: Option<String>,
    pub observed_ref: Option<String>,
    pub expected_attempt_id: Option<String>,
    pub supersede_attempt_id: Option<String>,
    pub expect_effect_secs: Option<i32>,
    pub watch: Option<Watch>,
}

impl RecordRequest {
    pub fn validate(&self) -> Result<(), MitigationError> {
        if self
            .observed_ref
            .as_ref()
            .is_some_and(|reference| reference.trim().is_empty())
        {
            return Err(MitigationError::BadRequest(
                "Provide the observed rollout ref",
            ));
        }
        if self.summary.trim().is_empty() || self.kind.trim().is_empty() {
            return Err(MitigationError::BadRequest("Provide summary and kind"));
        }
        if too_long(Some(&self.summary), MAX_SUMMARY_CHARS)
            || too_long(Some(&self.kind), MAX_KEY_CHARS)
            || too_long(self.option_key.as_deref(), MAX_KEY_CHARS)
            || too_long(self.command.as_deref(), MAX_COMMAND_CHARS)
            || too_long(self.source_ref.as_deref(), MAX_REF_CHARS)
            || too_long(self.observed_ref.as_deref(), MAX_REF_CHARS)
        {
            return Err(MitigationError::BadRequest(TOO_LONG));
        }
        if self
            .expect_effect_secs
            .is_some_and(|seconds| !(60..=7200).contains(&seconds))
        {
            return Err(MitigationError::BadRequest(
                "Expected effect must be 60–7200 seconds",
            ));
        }
        if let Some(watch) = &self.watch {
            watch.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Watch {
    pub signal: Option<Signal>,
    pub recover_threshold: Option<f64>,
    pub alert_threshold: Option<f64>,
    pub volume_floor_pct: Option<i32>,
}

impl Watch {
    fn validate(&self) -> Result<(), MitigationError> {
        if !(10..=100).contains(&self.volume_floor_pct.unwrap_or(50)) {
            return Err(MitigationError::BadRequest(
                "Volume floor must be 10–100 percent",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Signal {
    pub kind: SignalKind,
    #[serde(rename = "ref")]
    pub source_ref: String,
}

#[derive(Clone, Copy, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SignalKind {
    Alert,
    Slo,
    Query,
    TracesRed,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Recorded {
    pub attempt_id: String,
    pub fix_applied_at: i64,
    pub check_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watch_refused: Option<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct CurrentAttempt {
    pub attempt_id: Option<String>,
    pub applied_by: Option<String>,
    pub at: Option<i64>,
    pub summary: Option<String>,
    pub check_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_at: Option<i64>,
    #[serde(skip)]
    targets: Vec<Check>,
}

impl CurrentAttempt {
    #[cfg(feature = "enterprise")]
    pub async fn authorize_values(&mut self, viewer: &str) {
        let mut rows: Vec<_> = std::mem::take(&mut self.targets)
            .into_iter()
            .filter(|row| row.last_value.is_some())
            .map(|row| {
                let measured_at = super::recovery::last_measurement_at(&row);
                (row, measured_at)
            })
            .collect();
        rows.sort_by_key(|(_, at)| std::cmp::Reverse(*at));
        for (row, measured_at) in rows {
            if signals::may_read(viewer, &row).await {
                self.value = row.last_value;
                self.value_at = measured_at;
                return;
            }
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Retracted {
    pub retracted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revived_attempt_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ClaimRequest {
    pub option_key: String,
    pub summary: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Claimed {
    pub claimed_by: String,
    pub at: i64,
    pub expires_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum MitigationError {
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("The caller cannot perform this mitigation action")]
    Forbidden,
    #[error("Recovery checks are unavailable for security cases")]
    SecurityCase,
    #[error("The incident must be acknowledged before recording a fix")]
    AcknowledgementRequired,
    #[error("The incident changed while measuring recovery")]
    MeasurementChanged,
    #[error("Recovery check capacity is unavailable for the superseded attempt")]
    RevivalBudget,
    #[error("Incident not found")]
    Missing,
    #[error("The incident recovery transition was refused")]
    Refused(Refusal),
    #[error("The current attempt changed or needs confirmation")]
    Current(Box<CurrentAttempt>),
    #[error("The observed rollout is no longer current")]
    ObservedChange(Box<Option<config::meta::alerts::what_changed::ChangeRow>>),
    #[error(transparent)]
    Db(#[from] sea_orm::DbErr),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub enum PreparedWatch {
    None,
    CannotMeasure,
    Budget,
    Checks(Vec<Check>, WatchInputs),
}

impl PreparedWatch {
    fn into_checks(self, result: &mut Recorded) -> Vec<Check> {
        let reason = match self {
            Self::Checks(rows, _) => return rows,
            Self::None => return Vec::new(),
            Self::CannotMeasure => "cannot_measure",
            Self::Budget => "budget",
        };
        result.watch_refused = Some(reason.to_owned());
        Vec::new()
    }
}

#[derive(PartialEq, Eq)]
pub struct WatchInputs {
    onset_minute: i64,
    regions: Vec<Option<String>>,
    opening_alert: Option<String>,
}

struct RecordSnapshot {
    row: incident::Model,
    events: Vec<IncidentEvent>,
    replay: Option<Recorded>,
}

#[cfg(feature = "enterprise")]
pub async fn record(
    row: &incident::Model,
    actor: &str,
    request: RecordRequest,
    prepare: impl AsyncFnOnce(&incident::Model) -> Result<PreparedWatch, MitigationError>,
) -> Result<Recorded, MitigationError> {
    let result = record_with(
        infra::db::get_orm_client_rw().await,
        row,
        actor,
        request,
        prepare,
        common::meta::incidents_v2::recovery_max_checks_per_org(),
    )
    .await?;
    super::recovery::sync_best_effort(&row.org_id, &row.id).await;
    Ok(result)
}

#[cfg(feature = "enterprise")]
pub async fn retract(
    org: &str,
    id: &str,
    attempt: &str,
    actor: &str,
) -> Result<Retracted, MitigationError> {
    let result = retract_with(
        infra::db::get_orm_client_rw().await,
        (org, id),
        attempt,
        actor,
        crate::users::is_org_admin(org, actor).await,
        common::meta::incidents_v2::recovery_max_checks_per_org(),
        async |rows| {
            for row in rows {
                if row.attempt_id == attempt && !signals::may_read(actor, row).await {
                    return Err(MitigationError::Forbidden);
                }
            }
            Ok(())
        },
    )
    .await?;
    super::recovery::sync_best_effort(org, id).await;
    Ok(result)
}

#[cfg(feature = "enterprise")]
pub async fn claim(
    org: &str,
    id: &str,
    actor: &str,
    request: ClaimRequest,
) -> Result<Claimed, MitigationError> {
    claim_with(
        infra::db::get_orm_client_rw().await,
        org,
        id,
        actor,
        request,
    )
    .await
}

pub fn ensure_recordable(row: &incident::Model) -> Result<(), MitigationError> {
    if row.security_case {
        return Err(MitigationError::SecurityCase);
    }
    Ok(())
}

pub fn ensure_open(row: &incident::Model, event: RecoveryEvent) -> Result<(), MitigationError> {
    transitions::apply(
        (checks::phase(row), None),
        event,
        GuardFacts {
            record_allowed: true,
            retract_allowed: true,
            ..Default::default()
        },
    )
    .map(|_| ())
    .map_err(MitigationError::Refused)
}

pub(super) fn keeps_human_impact_end(row: &incident::Model, events: &[IncidentEvent]) -> bool {
    let human_end = events
        .iter()
        .rev()
        .take_while(|e| !matches!(e.event_type, IncidentEventType::Reopened { .. }))
        .find_map(|e| match &e.event_type {
            IncidentEventType::ImpactWindowChanged { to_end, .. } => Some(*to_end),
            _ => None,
        })
        .flatten();
    human_end.is_some() && human_end == row.impact_end_at
}

async fn watch_inputs(
    db: &impl ConnectionTrait,
    row: &incident::Model,
    watch: Option<&Watch>,
) -> Result<WatchInputs, MitigationError> {
    let links = members::Entity::find()
        .filter(members::Column::IncidentId.eq(&row.id))
        .order_by_asc(members::Column::CreatedAt)
        .order_by_asc(members::Column::AlertFiredAt)
        .order_by_asc(members::Column::AlertId)
        .all(db)
        .await?;
    let opening_alert = watch
        .and_then(|watch| watch.signal.as_ref())
        .is_none()
        .then(|| links.first().map(|link| link.alert_id.clone()))
        .flatten();
    let region = |value: &serde_json::Value| {
        value
            .get("region")
            .and_then(serde_json::Value::as_str)
            .filter(|v| !v.trim().is_empty())
            .map(str::to_owned)
    };
    let mut regions = BTreeSet::from_iter(region(&row.group_values));
    for link in links {
        if let Some(labels) = link.labels {
            let labels = serde_json::from_str(&labels).map_err(anyhow::Error::from)?;
            regions.extend(region(&labels));
        }
    }
    let onset = row.impact_start_at.unwrap_or(row.first_alert_at);
    Ok(WatchInputs {
        onset_minute: onset - onset.rem_euclid(MINUTE),
        regions: if regions.is_empty() {
            vec![None]
        } else {
            regions.into_iter().map(Some).collect()
        },
        opening_alert,
    })
}

async fn record_with(
    db: &DatabaseConnection,
    prior: &incident::Model,
    actor: &str,
    request: RecordRequest,
    prepare: impl AsyncFnOnce(&incident::Model) -> Result<PreparedWatch, MitigationError>,
    cap: usize,
) -> Result<Recorded, MitigationError> {
    let txn = db.begin().await?;
    let RecordSnapshot {
        row: measured,
        replay,
        ..
    } = preflight_record(&txn, prior, &request, actor).await?;
    txn.commit().await?;
    if let Some(replay) = replay {
        return Ok(replay);
    }
    let watch = prepare(&measured).await?;

    infra::race_point!("mitigations.before_budget_lock");
    let txn = budget_transaction(db, &prior.org_id).await?;
    let RecordSnapshot {
        row,
        events,
        replay,
    } = preflight_record(&txn, prior, &request, actor).await?;
    if let Some(replay) = replay {
        txn.commit().await?;
        return Ok(replay);
    }
    if measured.reopen_count != row.reopen_count {
        return Err(MitigationError::MeasurementChanged);
    }
    if let PreparedWatch::Checks(_, inputs) = &watch
        && *inputs != watch_inputs(&txn, &row, request.watch.as_ref()).await?
    {
        return Err(MitigationError::MeasurementChanged);
    }
    let previous = row.fix_attempt_id.as_deref();
    let observed = match request.observed_ref.as_deref() {
        #[cfg(feature = "enterprise")]
        Some(reference) => Some(
            crate::alerts::what_changed::confirm_rollout(
                &txn,
                &row,
                actor,
                reference,
                request.option_key.as_deref(),
            )
            .await?
            .map_err(|current| MitigationError::ObservedChange(Box::new(current)))?,
        ),
        #[cfg(not(feature = "enterprise"))]
        Some(_) => return Err(MitigationError::BadRequest("observed_ref is unavailable")),
        None => None,
    };
    let now = now_micros();
    let attempt = config::ider::generate();
    let transition_id = config::ider::generate_ulid(now);
    if let Some(previous) = previous {
        checks::supersede_in(&txn, &row, previous, now).await?;
        append(
            &txn,
            &row,
            now,
            IncidentEventType::FixSuperseded {
                transition_id: Some(transition_id.clone()),
                attempt_id: attempt.clone(),
                superseded_attempt_id: previous.to_owned(),
            },
        )
        .await?;
    }
    let mut result = Recorded {
        attempt_id: attempt,
        fix_applied_at: now,
        check_ids: Vec::new(),
        watch_refused: None,
    };
    let rows = watch.into_checks(&mut result);
    let due = create_checks(&txn, &row, rows, cap, &mut result, now).await?;
    write_attempt(
        &txn,
        row.clone(),
        Some((&result.attempt_id, actor, now)),
        due,
        now,
        &events,
    )
    .await?;
    if previous.is_none()
        && let Some((reference, at)) = request.observed_ref.as_deref().zip(observed)
    {
        append(
            &txn,
            &row,
            now,
            IncidentEventType::RollbackObserved {
                transition_id: transition_id.clone(),
                attempt_id: result.attempt_id.clone(),
                change_ref: reference.to_owned(),
                at,
            },
        )
        .await?;
    }
    append(
        &txn,
        &row,
        now,
        IncidentEventType::FixApplied {
            transition_id: Some(transition_id),
            attempt_id: result.attempt_id.clone(),
            summary: request.summary,
            kind: request.kind,
            option_key: request.option_key,
            command: request.command,
            source_ref: request.source_ref,
            observed_ref: request.observed_ref,
            watch_refused: result.watch_refused.clone(),
            actor: actor.to_owned(),
        },
    )
    .await?;
    txn.commit().await?;
    Ok(result)
}

async fn preflight_record(
    txn: &DatabaseTransaction,
    prior: &incident::Model,
    request: &RecordRequest,
    actor: &str,
) -> Result<RecordSnapshot, MitigationError> {
    let row = get_locked(txn, &prior.org_id, &prior.id).await?;
    ensure_recordable(&row)?;
    ensure_open(&row, RecoveryEvent::Record)?;
    if row.acknowledged_by.is_none() {
        return Err(MitigationError::AcknowledgementRequired);
    }
    let now = now_micros();
    let events = incident_events::get_with(txn, &row.org_id, &row.id).await?;
    let current = checks::list(txn, &row.org_id, &row.id)
        .await?
        .into_iter()
        .filter(|r| Some(r.attempt_id.as_str()) == row.fix_attempt_id.as_deref())
        .collect();
    let replay = record_guard(&row, request, actor, now, &events, current)?;
    Ok(RecordSnapshot {
        row,
        events,
        replay,
    })
}

fn record_guard(
    row: &incident::Model,
    request: &RecordRequest,
    actor: &str,
    now: i64,
    events: &[IncidentEvent],
    current: Vec<Check>,
) -> Result<Option<Recorded>, MitigationError> {
    let applied = row
        .fix_attempt_id
        .as_deref()
        .and_then(|id| applied(events, id));
    let (summary, same_mitigation, watch_refused) = match applied.map(|e| &e.event_type) {
        Some(IncidentEventType::FixApplied {
            summary,
            kind,
            option_key,
            command,
            source_ref,
            observed_ref,
            watch_refused,
            ..
        }) => (
            Some(summary.clone()),
            match (option_key, &request.option_key) {
                (Some(applied), Some(requested)) => applied == requested,
                (None, None) => {
                    *summary == request.summary
                        && *kind == request.kind
                        && *command == request.command
                        && *source_ref == request.source_ref
                        && *observed_ref == request.observed_ref
                }
                _ => false,
            },
            watch_refused.clone(),
        ),
        _ => (None, false, None),
    };
    let same_actor = row.fix_applied_by.as_deref() == Some(actor);
    let at = row.fix_applied_at.or_else(|| applied.map(|e| e.timestamp));
    let recent = at.is_some_and(|at| now.saturating_sub(at) < REPLAY_WINDOW);
    let changed = request.expected_attempt_id != row.fix_attempt_id;
    let stale_confirm = request.supersede_attempt_id.is_some()
        && request.supersede_attempt_id != row.fix_attempt_id;
    let replay_confirm = row
        .fix_attempt_id
        .as_deref()
        .is_some_and(|id| superseded(events, id) == request.supersede_attempt_id.as_deref());
    if changed
        && same_actor
        && same_mitigation
        && recent
        && (!stale_confirm || replay_confirm)
        && let Some((attempt_id, fix_applied_at)) = row.fix_attempt_id.clone().zip(at)
    {
        return Ok(Some(Recorded {
            attempt_id,
            fix_applied_at,
            check_ids: current.into_iter().map(|c| c.id).collect(),
            watch_refused,
        }));
    }
    let guarded = row.fix_attempt_id.is_some()
        && !same_actor
        && row.mitigated_at.is_none()
        && row.not_recovering_at.is_none()
        && current.iter().all(|check| check.verified_at.is_none())
        && (recent
            || current
                .iter()
                .any(|check| checks::LIVE.contains(&check.state.as_str())));
    if changed || stale_confirm || (guarded && request.supersede_attempt_id.is_none()) {
        return Err(MitigationError::Current(Box::new(CurrentAttempt {
            attempt_id: row.fix_attempt_id.clone(),
            applied_by: row.fix_applied_by.clone(),
            at,
            summary,
            check_at: row.recovery_due_at,
            value: None,
            value_at: None,
            targets: current,
        })));
    }
    Ok(None)
}

async fn retract_with(
    db: &DatabaseConnection,
    (org, id): (&str, &str),
    attempt: &str,
    actor: &str,
    admin: bool,
    cap: usize,
    authorize: impl AsyncFnOnce(&[Check]) -> Result<(), MitigationError>,
) -> Result<Retracted, MitigationError> {
    let txn = budget_transaction(db, org).await?;
    let row = get_locked(&txn, org, id).await?;
    authorize_case(&row, actor).await?;
    let phase = checks::phase(&row);
    if matches!(
        phase,
        transitions::Phase::Resolved | transitions::Phase::MergedAway
    ) {
        ensure_open(&row, RecoveryEvent::Retract)?;
    }
    if !admin
        && row.assigned_to.as_deref() != Some(actor)
        && row.fix_applied_by.as_deref() != Some(actor)
    {
        return Err(MitigationError::Forbidden);
    }
    let events = incident_events::get_with(&txn, org, id).await?;
    let rows = checks::list(&txn, org, id).await?;
    let eligible = row.fix_attempt_id.as_deref() == Some(attempt)
        && row.not_recovering_at.is_none()
        && !rows
            .iter()
            .any(|c| c.attempt_id == attempt && c.verified_at.is_some())
        && !events.iter().any(|e| match &e.event_type {
            IncidentEventType::RollbackObserved { attempt_id, .. } => attempt_id == attempt,
            IncidentEventType::Unknown(raw) => {
                raw["type"] == "RollbackObserved" && raw["data"]["attempt_id"] == attempt
            }
            _ => false,
        });
    transitions::apply(
        (phase, None),
        RecoveryEvent::Retract,
        GuardFacts {
            retract_allowed: eligible,
            ..Default::default()
        },
    )
    .map_err(MitigationError::Refused)?;
    authorize(&rows).await?;
    let now = now_micros();
    checks::cancel_in(&txn, &row, attempt, now).await?;
    let revival = if row
        .fix_applied_at
        .is_some_and(|at| now.saturating_sub(at) < REPLAY_WINDOW)
    {
        revive(&txn, &row, &events, rows, cap, now).await?
    } else {
        None
    };
    let (new_attempt, due) = match revival.as_ref() {
        Some((id, by, at, due)) => (Some((id.as_str(), by.as_str(), *at)), *due),
        None => (None, None),
    };
    write_attempt(&txn, row.clone(), new_attempt, due, now, &events).await?;
    let revived_attempt_id = revival.map(|(id, ..)| id);
    append(
        &txn,
        &row,
        now,
        IncidentEventType::FixRetracted {
            transition_id: Some(config::ider::generate_ulid(now)),
            attempt_id: attempt.to_owned(),
            revived_attempt_id: revived_attempt_id.clone(),
        },
    )
    .await?;
    txn.commit().await?;
    Ok(Retracted {
        retracted: true,
        revived_attempt_id,
    })
}

async fn claim_with(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
    actor: &str,
    request: ClaimRequest,
) -> Result<Claimed, MitigationError> {
    if request.option_key.trim().is_empty() || request.summary.trim().is_empty() {
        return Err(MitigationError::BadRequest(
            "Provide option_key and summary",
        ));
    }
    if too_long(Some(&request.option_key), MAX_KEY_CHARS)
        || too_long(Some(&request.summary), MAX_SUMMARY_CHARS)
    {
        return Err(MitigationError::BadRequest(TOO_LONG));
    }
    let txn = db.begin().await?;
    let row = get_locked(&txn, org, id).await?;
    authorize_case(&row, actor).await?;
    ensure_open(&row, RecoveryEvent::Claim)?;
    let now = now_micros();
    let events = incident_events::get_with(&txn, org, id).await?;
    let prior = events
        .iter()
        .rev()
        .find_map(|event| match &event.event_type {
            IncidentEventType::FixApplied {
                option_key: Some(key),
                ..
            } if key == &request.option_key => Some(None),
            IncidentEventType::FixClaimed {
                option_key,
                actor: by,
                expires_at,
                ..
            } if option_key == &request.option_key && by == actor => {
                Some((*expires_at > now).then_some((event.timestamp, *expires_at)))
            }
            _ => None,
        })
        .flatten();
    let (at, expires_at) = if let Some(prior) = prior {
        prior
    } else {
        let expires_at = now + 15 * MINUTE;
        append(
            &txn,
            &row,
            now,
            IncidentEventType::FixClaimed {
                transition_id: Some(config::ider::generate_ulid(now)),
                option_key: request.option_key,
                summary: request.summary,
                actor: actor.to_owned(),
                expires_at,
            },
        )
        .await?;
        (now, expires_at)
    };
    txn.commit().await?;
    Ok(Claimed {
        claimed_by: actor.to_owned(),
        at,
        expires_at,
    })
}

async fn authorize_case(row: &incident::Model, actor: &str) -> Result<(), MitigationError> {
    if row.security_case {
        if !crate::security::security_allowed(&row.org_id, actor, "PUT").await {
            return Err(MitigationError::Forbidden);
        }
        o2_enterprise::enterprise::security::audit::mark();
    }
    Ok(())
}

async fn budget_transaction(
    db: &DatabaseConnection,
    org: &str,
) -> Result<DatabaseTransaction, MitigationError> {
    let txn = db.begin().await?;
    checks::lock_budget(&txn, org)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(txn)
}

async fn get_locked(
    txn: &DatabaseTransaction,
    org: &str,
    id: &str,
) -> Result<incident::Model, MitigationError> {
    alert_incidents::get_locked(txn, org, id)
        .await?
        .ok_or(MitigationError::Missing)
}

async fn append(
    txn: &DatabaseTransaction,
    row: &incident::Model,
    timestamp: i64,
    event_type: IncidentEventType,
) -> Result<(), MitigationError> {
    incident_events::append_in(
        txn,
        &row.org_id,
        &row.id,
        IncidentEvent {
            timestamp,
            seq: 0,
            event_type,
        },
    )
    .await?;
    Ok(())
}

async fn create_checks(
    txn: &DatabaseTransaction,
    row: &incident::Model,
    rows: Vec<Check>,
    cap: usize,
    result: &mut Recorded,
    now: i64,
) -> Result<Option<i64>, MitigationError> {
    if rows.is_empty() {
        return Ok(None);
    }
    let live = checks::count_live_org(txn, &row.org_id).await?;
    if rows.len() > MAX_PER_ATTEMPT || live.saturating_add(rows.len() as u64) > cap as u64 {
        result.watch_refused = Some("budget".to_owned());
        return Ok(None);
    }
    let grace = common::meta::incidents_v2::recovery_settings().deadline_secs * 1_000_000;
    let mut due = None;
    for mut check in rows {
        check.id = config::ider::generate();
        check.attempt_id = result.attempt_id.clone();
        check.trigger_at = result.fix_applied_at;
        let timing = CheckTiming::from_base(check.trigger_at, check.expect_effect_secs);
        check.effect_from_at = timing.effect_from_at;
        let base = timing.recovery_due_at;
        check.deadline_at = base.saturating_add(grace);
        check.created_at = now;
        check.generation = 1;
        check.state = CheckState::Checking.as_str().to_owned();
        check.state_reason = None;
        check.verified_at = None;
        check.soak_until = None;
        check.passes = 0;
        check.pass_started_at = None;
        check.last_checked_at = None;
        check.last_value = None;
        check.recent_samples = "[]".to_owned();
        due = Some(due.map_or(base, |at: i64| at.max(base)));
        result.check_ids.push(check.id.clone());
        checks::insert_in(txn, check, now).await?;
    }
    Ok(due)
}

async fn write_attempt(
    txn: &DatabaseTransaction,
    row: incident::Model,
    attempt: Option<(&str, &str, i64)>,
    due: Option<i64>,
    now: i64,
    events: &[IncidentEvent],
) -> Result<(), MitigationError> {
    let keep_end = keeps_human_impact_end(&row, events);
    let mut active: incident::ActiveModel = row.into();
    active.fix_attempt_id = Set(attempt.map(|(id, ..)| id.to_owned()));
    active.fix_applied_by = Set(attempt.map(|(_, by, _)| by.to_owned()));
    active.fix_applied_at = Set(attempt.map(|(_, _, at)| at));
    active.recovery_due_at = Set(due);
    active.not_recovering_at = Set(None);
    active.mitigated_at = Set(None);
    active.recovered_at = Set(None);
    if !keep_end {
        active.impact_end_at = Set(None);
    }
    active.updated_at = Set(now);
    active.update(txn).await?;
    Ok(())
}

async fn revive(
    txn: &DatabaseTransaction,
    row: &incident::Model,
    events: &[IncidentEvent],
    all_rows: Vec<Check>,
    cap: usize,
    now: i64,
) -> Result<Option<(String, String, i64, Option<i64>)>, MitigationError> {
    let Some(id) = row
        .fix_attempt_id
        .as_deref()
        .and_then(|id| superseded(events, id))
    else {
        return Ok(None);
    };
    let Some(IncidentEvent {
        timestamp,
        event_type: IncidentEventType::FixApplied { actor, .. },
        ..
    }) = applied(events, id)
    else {
        return Ok(None);
    };
    let rows: Vec<_> = all_rows
        .into_iter()
        .filter(|c| c.attempt_id == id && c.state == CheckState::Superseded.as_str())
        .collect();
    let at = rows.first().map_or(*timestamp, |c| c.trigger_at);
    let mut result = Recorded {
        attempt_id: config::ider::generate(),
        fix_applied_at: at,
        check_ids: Vec::new(),
        watch_refused: None,
    };
    let due = create_checks(txn, row, rows, cap, &mut result, now).await?;
    if result.watch_refused.is_some() {
        return Err(MitigationError::RevivalBudget);
    }
    Ok(Some((result.attempt_id, actor.clone(), at, due)))
}

fn superseded<'a>(events: &'a [IncidentEvent], attempt: &str) -> Option<&'a str> {
    events.iter().rev().find_map(|e| match &e.event_type {
        IncidentEventType::FixSuperseded {
            attempt_id,
            superseded_attempt_id,
            ..
        } if attempt_id == attempt => Some(superseded_attempt_id.as_str()),
        _ => None,
    })
}

fn applied<'a>(events: &'a [IncidentEvent], mut attempt: &'a str) -> Option<&'a IncidentEvent> {
    let mut retracted = false;
    for e in events.iter().rev() {
        match &e.event_type {
            IncidentEventType::FixApplied { attempt_id, .. }
                if attempt_id == attempt && !retracted =>
            {
                return Some(e);
            }
            IncidentEventType::FixRetracted {
                attempt_id,
                revived_attempt_id,
                ..
            } if revived_attempt_id.as_deref() == Some(attempt) => {
                attempt = attempt_id;
                retracted = true;
            }
            IncidentEventType::FixSuperseded {
                attempt_id,
                superseded_attempt_id,
                ..
            } if retracted && attempt_id == attempt => {
                attempt = superseded_attempt_id;
                retracted = false;
            }
            _ => {}
        }
    }
    None
}

fn too_long(value: Option<&str>, max: usize) -> bool {
    value.is_some_and(|value| value.chars().count() > max)
}

#[cfg(test)]
pub(super) mod tests;
