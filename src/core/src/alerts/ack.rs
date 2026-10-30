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

//! Acknowledge (§5.2-5.6): who may act on an alert's firing, the ack writes and their propagation.

use std::collections::HashMap;

use config::{
    meta::{
        alerts::{
            ack::{
                AckAction, AckConflict, AckIncidentRef, AckOncallOutcome, AckRequest, AckResponse,
                AckSource, AckView, ActRefusal, AlertAck, AlertAckSummary, OnCallPersonRef,
                PersonRef, RefusalCode, RefusalRule, UnackRequest, UnackResponse,
            },
            state::{AlertState, ROLLUP_GROUP_KEY},
        },
        self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType},
        triggers::{ScheduledTriggerData, TriggerModule},
        user::UserRole,
    },
    utils::time::now_micros,
};

use crate::alerts::lifecycle;

tokio::task_local! {
    /// The alert whose own ack is propagating, so the incident hook does not write it back.
    static ACK_ORIGIN: String;
}

const CAN_ACT_SHOWN: usize = 2;
const ON_CALL_SHOWN: usize = 3;

/// What the caller wants to do; Ack and Mute share one rule (Δ2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    Ack,
    Mute,
}

/// Which part of the rule let the actor in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Via {
    Root,
    Fga,
    Role,
    Responder,
}

/// The alert or composite an ack names, with what the ack needs to know about it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AckTarget {
    pub org_id: String,
    pub alert_id: String,
    pub name: String,
    pub folder_id: String,
    pub multi_alert: bool,
    pub composite: bool,
    /// The silence window an unack reopens, in microseconds.
    pub silence_micros: i64,
    /// Whether the trigger keeps evaluating through silence (delivery decides, not the schedule).
    pub evaluates_through_silence: bool,
}

impl AckTarget {
    fn module(&self) -> TriggerDataType {
        if self.composite {
            TriggerDataType::CompositeAlert
        } else {
            TriggerDataType::Alert
        }
    }

    fn trigger_module(&self) -> TriggerModule {
        if self.composite {
            TriggerModule::CompositeAlert
        } else {
            TriggerModule::Alert
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum AckError {
    NotFound,
    Refused(ActRefusal),
    Conflict(AckConflict),
    Internal(String),
}

impl From<infra::errors::Error> for AckError {
    fn from(e: infra::errors::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

/// One open on-call response for the alert or its incident, and the people behind it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResponderTeam {
    pub response_id: String,
    pub team_id: String,
    pub team_name: String,
    pub members: Vec<String>,
    pub on_call: Vec<String>,
}

/// Everything [`decide`] needs, gathered by [`authorize`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AuthorizeFacts {
    pub root: bool,
    pub fga_enabled: bool,
    pub fga_allows: bool,
    pub role: Option<UserRole>,
    pub responders: Vec<ResponderTeam>,
}

/// Δ2: root; alert PUT (OpenFGA on) or Admin/Editor/service account; or a member of a paged team.
pub fn decide(actor: &str, facts: &AuthorizeFacts) -> Option<Via> {
    if facts.root {
        return Some(Via::Root);
    }
    let edit = if facts.fga_enabled {
        facts.fga_allows.then_some(Via::Fga)
    } else {
        facts
            .role
            .as_ref()
            .filter(|r| {
                matches!(
                    r,
                    UserRole::Root | UserRole::Admin | UserRole::Editor | UserRole::ServiceAccount
                )
            })
            .map(|_| Via::Role)
    };
    edit.or_else(|| {
        let actor = actor.trim().to_ascii_lowercase();
        facts
            .responders
            .iter()
            .any(|t| t.members.iter().any(|m| m.eq_ignore_ascii_case(&actor)))
            .then_some(Via::Responder)
    })
}

/// The refusal body: who is on call, and up to two people who could act (Admins first).
pub fn refusal(
    act: Act,
    facts: &AuthorizeFacts,
    org_editors: &[(String, UserRole, Option<String>)],
) -> ActRefusal {
    let mut on_call: Vec<OnCallPersonRef> = Vec::new();
    for team in &facts.responders {
        let people = if team.on_call.is_empty() {
            &team.members
        } else {
            &team.on_call
        };
        for email in people.iter().take(ON_CALL_SHOWN) {
            if !on_call.iter().any(|p| &p.email == email) {
                on_call.push(OnCallPersonRef {
                    email: email.clone(),
                    name: None,
                    team: team.team_name.clone(),
                });
            }
        }
    }
    let mut editors: Vec<&(String, UserRole, Option<String>)> = org_editors
        .iter()
        .filter(|(_, role, _)| matches!(role, UserRole::Admin | UserRole::Editor))
        .collect();
    editors.sort_by_key(|(email, role, _)| (*role != UserRole::Admin, email.clone()));
    let can_act = editors
        .into_iter()
        .take(CAN_ACT_SHOWN)
        .map(|(email, _, name)| PersonRef {
            email: email.clone(),
            name: name.clone(),
        })
        .collect();
    let (code, verb) = match act {
        Act::Ack => (RefusalCode::AckRefused, "acknowledge"),
        Act::Mute => (RefusalCode::MuteRefused, "mute"),
    };
    let message = if facts.fga_enabled {
        format!("You need edit access to this alert, or to be on call for it, to {verb} it")
    } else {
        format!("Only an admin, an editor or the alert's on-call responder can {verb} it")
    };
    ActRefusal {
        code,
        message,
        rule: if facts.fga_enabled {
            RefusalRule::Fga
        } else {
            RefusalRule::Role
        },
        on_call,
        can_act,
    }
}

/// The alert or composite behind `alert_id`, or `NotFound`.
pub async fn resolve_target(org_id: &str, alert_id: &str) -> Result<AckTarget, AckError> {
    if let Ok(ksuid) = alert_id.parse::<svix_ksuid::Ksuid>()
        && let Some((folder, alert)) =
            db::alerts::alert::get_by_id(infra::db::get_orm_client_ro().await, org_id, ksuid)
                .await?
    {
        let multi_level = config::meta::alerts::level::is_multi_level(&alert);
        let multi_alert = alert.query_condition.multi_alert_enabled();
        return Ok(AckTarget {
            org_id: org_id.to_string(),
            alert_id: alert_id.to_string(),
            name: alert.name.clone(),
            folder_id: folder.folder_id,
            multi_alert,
            composite: false,
            silence_micros: alert.trigger_condition.silence.max(0) * 60 * 1_000_000,
            evaluates_through_silence: config::meta::alerts::dispatch::evaluates_through_silence(
                multi_alert,
                multi_level,
            ),
        });
    }
    match crate::alerts::composite::get_composite(org_id, alert_id).await {
        Ok(Some(composite)) => Ok(AckTarget {
            org_id: org_id.to_string(),
            alert_id: alert_id.to_string(),
            name: composite.definition.name.clone(),
            folder_id: composite.definition.folder_id.clone(),
            multi_alert: false,
            composite: true,
            silence_micros: composite.definition.silence_seconds.max(0) * 1_000_000,
            evaluates_through_silence: true,
        }),
        Ok(None) => Err(AckError::NotFound),
        Err(e) => Err(AckError::Internal(e.to_string())),
    }
}

/// Lets the actor act on the alert, or says who is on call and who could act instead.
pub async fn authorize(target: &AckTarget, actor: &str, act: Act) -> Result<Via, ActRefusal> {
    let facts = gather_facts(target, actor).await;
    if let Some(via) = decide(actor, &facts) {
        return Ok(via);
    }
    let editors = org_editors(&target.org_id).await;
    Err(refusal(act, &facts, &editors))
}

/// Acks the group's current firing, or every firing group with `all_groups` (§5.3).
pub async fn ack(
    target: &AckTarget,
    req: &AckRequest,
    actor: &str,
    source: AckSource,
) -> Result<AckResponse, AckError> {
    let rows = if req.all_groups {
        firing_rows(target).await
    } else if target.multi_alert == (req.group_key == ROLLUP_GROUP_KEY) {
        // A multi-alert is acked per group, any other alert on its own row.
        return Err(AckError::Conflict(AckConflict::NotFiring));
    } else {
        let current = current_firing(target, &req.group_key).await?;
        let Some(started) = current else {
            return Err(AckError::Conflict(AckConflict::NotFiring));
        };
        if req.firing_started_at.is_some_and(|f| f != started) {
            return Err(AckError::Conflict(AckConflict::FiringChanged {
                firing_started_at: started,
            }));
        }
        vec![(req.group_key.clone(), started)]
    };
    if rows.is_empty() {
        return Err(AckError::Conflict(AckConflict::NotFiring));
    }
    let (acks, changed, previous_holders) =
        write_acks(target, &rows, actor, source, req.take_over).await?;
    let other_groups_unacked = other_groups_unacked(target).await;
    let (incident, oncall) = if changed {
        propagate(target, actor, other_groups_unacked, &previous_holders).await
    } else {
        (None, None)
    };
    Ok(AckResponse {
        changed,
        acks,
        incident,
        oncall,
        other_groups_unacked,
    })
}

/// Unacks the group's firing; repeats resume one silence window after the unack (§5.5).
pub async fn unack(
    target: &AckTarget,
    req: &UnackRequest,
    actor: &str,
    source: AckSource,
) -> Result<UnackResponse, AckError> {
    let firing = match req.firing_started_at {
        Some(f) => Some(f),
        None => current_firing(target, &req.group_key).await?,
    };
    let Some(firing) = firing else {
        return Ok(UnackResponse {
            changed: false,
            ack: None,
        });
    };
    let at = now_micros();
    let Some(row) = db::alerts::alert_acks::unack(
        &target.org_id,
        &target.alert_id,
        &req.group_key,
        firing,
        actor,
        at,
    )
    .await?
    else {
        return Ok(UnackResponse {
            changed: false,
            ack: None,
        });
    };
    reopen_silence(target, &req.group_key, firing, at).await;
    record_event(
        target,
        &req.group_key,
        actor,
        AckAction::Unack,
        source,
        None,
    );
    lifecycle::on_view_changed(&target.org_id, &target.alert_id, Some(&req.group_key)).await;
    Ok(UnackResponse {
        changed: true,
        ack: Some(row.view()),
    })
}

/// The acks in force, per group, for the alert detail.
pub async fn list_in_force(target: &AckTarget) -> Result<Vec<AckView>, AckError> {
    let acks = infra::table::alert_acks::list_for_alert(&target.org_id, &target.alert_id).await?;
    if acks.is_empty() {
        return Ok(vec![]);
    }
    let firing: HashMap<String, i64> = firing_rows(target).await.into_iter().collect();
    Ok(acks
        .iter()
        .filter(|a| a.in_force_for(firing.get(&a.group_key).copied()))
        .map(AlertAck::view)
        .collect())
}

/// The ack in force on this row's current firing; reads nothing while the row is not firing.
pub async fn in_force(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: Option<i64>,
) -> Option<AlertAck> {
    firing_started_at?;
    match infra::table::alert_acks::get(org_id, alert_id, group_key).await {
        Ok(ack) => ack.filter(|a| a.in_force_for(firing_started_at)),
        Err(e) => {
            log::warn!("[ALERT_ACK] could not read the ack of {alert_id}/{group_key:?}: {e}");
            None
        }
    }
}

/// `group_key → acked_by` for the groups whose current firing is acked; one read per evaluation.
pub async fn in_force_by_group(
    org_id: &str,
    alert_id: &str,
    states: &HashMap<String, AlertState>,
) -> HashMap<String, String> {
    if !states.values().any(|s| s.firing_started_at.is_some()) {
        return HashMap::new();
    }
    match infra::table::alert_acks::list_for_alert(org_id, alert_id).await {
        Ok(acks) => acks_in_force(&acks, states),
        Err(e) => {
            log::warn!("[ALERT_ACK] could not read the acks of {alert_id}: {e}");
            HashMap::new()
        }
    }
}

/// The pure half of [`in_force_by_group`].
pub fn acks_in_force(
    acks: &[AlertAck],
    states: &HashMap<String, AlertState>,
) -> HashMap<String, String> {
    acks.iter()
        .filter(|a| a.in_force_for(states.get(&a.group_key).and_then(|s| s.firing_started_at)))
        .map(|a| (a.group_key.clone(), a.acked_by.clone()))
        .collect()
}

/// The alert list item's ack summary, from its ack rows and the firings they must match.
pub fn summary(acks: &[AlertAck], firing: &HashMap<String, i64>) -> Option<AlertAckSummary> {
    let in_force: Vec<&AlertAck> = acks
        .iter()
        .filter(|a| a.in_force_for(firing.get(&a.group_key).copied()))
        .collect();
    let latest = in_force.iter().max_by_key(|a| a.acked_at)?;
    Some(AlertAckSummary {
        acked_by: latest.acked_by.clone(),
        acked_at: latest.acked_at,
        ack_source: latest.ack_source,
        groups_acked: u32::try_from(in_force.len()).unwrap_or(u32::MAX),
    })
}

/// Whether this task runs inside an alert's own ack propagation.
pub fn propagating() -> bool {
    ACK_ORIGIN.try_with(|_| ()).is_ok()
}

/// Acks every firing group of the alert for an ack made elsewhere (incident), skipping the rule.
pub async fn ack_from_elsewhere(org_id: &str, alert_id: &str, actor: &str, source: AckSource) {
    if propagating() {
        return;
    }
    let target = match resolve_target(org_id, alert_id).await {
        Ok(t) => t,
        Err(AckError::NotFound) => return,
        Err(e) => {
            log::warn!("[ALERT_ACK] could not resolve {alert_id} for a {source:?} ack: {e:?}");
            return;
        }
    };
    let rows = firing_rows(&target).await;
    if rows.is_empty() {
        return;
    }
    if let Err(e) = write_acks(&target, &rows, actor, source, false).await {
        log::error!("[ALERT_ACK] could not write the {source:?} ack of {alert_id}: {e:?}");
    }
}

/// A row from another region landed: reopen the silence of an unack and refresh its messages.
pub async fn after_replicated(ack: &AlertAck) {
    if let Some(at) = ack.unacked_at {
        match resolve_target(&ack.org_id, &ack.alert_id).await {
            Ok(target) => reopen_silence(&target, &ack.group_key, ack.firing_started_at, at).await,
            Err(e) => log::warn!(
                "[ALERT_ACK] replicated unack of {}/{} with no alert here: {e:?}",
                ack.alert_id,
                ack.group_key
            ),
        }
    }
    lifecycle::on_view_changed(&ack.org_id, &ack.alert_id, Some(&ack.group_key)).await;
}

/// The rows an ack can name: a multi-alert's firing groups, else the alert's own row.
async fn firing_rows(target: &AckTarget) -> Vec<(String, i64)> {
    if target.multi_alert {
        return infra::table::alert_states::firing_groups(&target.alert_id, None)
            .await
            .unwrap_or_else(|e| {
                log::warn!(
                    "[ALERT_ACK] could not list the firing groups of {}: {e}",
                    target.alert_id
                );
                vec![]
            });
    }
    match current_firing(target, ROLLUP_GROUP_KEY).await {
        Ok(Some(started)) => vec![(ROLLUP_GROUP_KEY.to_string(), started)],
        Ok(None) => vec![],
        Err(e) => {
            log::warn!(
                "[ALERT_ACK] could not read the state of {}: {e:?}",
                target.alert_id
            );
            vec![]
        }
    }
}

async fn current_firing(target: &AckTarget, group_key: &str) -> Result<Option<i64>, AckError> {
    Ok(infra::table::alert_states::get(&target.alert_id, group_key)
        .await?
        .and_then(|s| s.firing_started_at))
}

/// Writes one ack per row; a row already acked keeps its ack unless `take_over` moves it.
async fn write_acks(
    target: &AckTarget,
    rows: &[(String, i64)],
    actor: &str,
    source: AckSource,
    take_over: bool,
) -> Result<(Vec<AckView>, bool, Vec<String>), AckError> {
    let mut views = Vec::with_capacity(rows.len());
    let mut changed = false;
    let mut previous_holders = Vec::new();
    for (group_key, started) in rows {
        let now = now_micros();
        let held = infra::table::alert_acks::get(&target.org_id, &target.alert_id, group_key)
            .await?
            .filter(|a| a.in_force_for(Some(*started)));
        let taken_over_from = match held {
            Some(h) if !take_over || h.acked_by.eq_ignore_ascii_case(actor) => {
                views.push(h.view());
                continue;
            }
            Some(h) => Some(h.acked_by),
            None => None,
        };
        let ack = AlertAck {
            org_id: target.org_id.clone(),
            alert_id: target.alert_id.clone(),
            group_key: group_key.clone(),
            firing_started_at: *started,
            acked_by: actor.to_string(),
            acked_at: now,
            ack_source: source,
            taken_over_from: taken_over_from.clone(),
            unacked_at: None,
            unacked_by: None,
            updated_at: now,
        };
        let won = if taken_over_from.is_some() {
            db::alerts::alert_acks::put(&ack).await?;
            true
        } else {
            db::alerts::alert_acks::claim(&ack).await?
        };
        if !won {
            // Lost a race to another ack of the same firing: answer with theirs.
            if let Some(theirs) =
                infra::table::alert_acks::get(&target.org_id, &target.alert_id, group_key).await?
            {
                views.push(theirs.view());
            }
            continue;
        }
        changed = true;
        if let Some(holder) = &taken_over_from {
            previous_holders.push(holder.clone());
        }
        let action = if taken_over_from.is_some() {
            AckAction::TakeOver
        } else {
            AckAction::Ack
        };
        record_event(target, group_key, actor, action, source, taken_over_from);
        lifecycle::on_view_changed(&target.org_id, &target.alert_id, Some(group_key)).await;
        views.push(ack.view());
    }
    Ok((views, changed, previous_holders))
}

/// Groups of a multi-alert still firing with no ack in force (R-132).
async fn other_groups_unacked(target: &AckTarget) -> u32 {
    if !target.multi_alert {
        return 0;
    }
    let firing: Vec<(String, i64)> =
        match infra::table::alert_states::firing_groups(&target.alert_id, None).await {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!(
                    "[ALERT_ACK] could not list the firing groups of {}: {e}",
                    target.alert_id
                );
                return 0;
            }
        };
    let acks = infra::table::alert_acks::list_for_alert(&target.org_id, &target.alert_id)
        .await
        .unwrap_or_default();
    let acked: HashMap<&str, &AlertAck> = acks.iter().map(|a| (a.group_key.as_str(), a)).collect();
    let open = firing
        .iter()
        .filter(|(key, started)| {
            !acked
                .get(key.as_str())
                .is_some_and(|a| a.in_force_for(Some(*started)))
        })
        .count();
    u32::try_from(open).unwrap_or(u32::MAX)
}

/// Unack reopens the silence window from the unack time, through each kind's delivery state.
async fn reopen_silence(target: &AckTarget, group_key: &str, firing: i64, at: i64) {
    if target.silence_micros <= 0 {
        return;
    }
    let until = at.saturating_add(target.silence_micros);
    if target.multi_alert && group_key != ROLLUP_GROUP_KEY {
        if let Err(e) = infra::table::alert_states::set_silence_after_unack(
            &target.alert_id,
            group_key,
            firing,
            until,
        )
        .await
        {
            log::warn!(
                "[ALERT_ACK] could not reopen the silence of {}/{group_key}: {e}",
                target.alert_id
            );
        }
        return;
    }
    reopen_trigger_silence(target, until).await;
}

/// Single-row and composite alerts keep their delivery window on the trigger.
async fn reopen_trigger_silence(target: &AckTarget, until: i64) {
    let mut trigger =
        match db::scheduler::get(&target.org_id, target.trigger_module(), &target.alert_id).await {
            Ok(t) => t,
            Err(e) => {
                log::warn!(
                    "[ALERT_ACK] no trigger for {} to reopen silence: {e}",
                    target.alert_id
                );
                return;
            }
        };
    // A run in flight rewrites the whole row, so writing now can strand it in Processing.
    if trigger.status == db::scheduler::TriggerStatus::Processing {
        log::info!(
            "[ALERT_ACK] {} is evaluating; its repeats resume from the next run, not after a silence window",
            target.alert_id
        );
        return;
    }
    let mut data: ScheduledTriggerData =
        config::utils::json::from_str(&trigger.data).unwrap_or_default();
    data.delivery_silenced_until = Some(data.delivery_silenced_until.unwrap_or(0).max(until));
    trigger.data = config::utils::json::to_string(&data).unwrap_or_default();
    if !target.evaluates_through_silence {
        trigger.next_run_at = trigger.next_run_at.max(until);
        trigger.is_silenced = true;
    }
    if let Err(e) = db::scheduler::update_trigger(trigger, false, "alert-unack").await {
        log::warn!(
            "[ALERT_ACK] could not reopen the silence of {}: {e}",
            target.alert_id
        );
    }
}

/// One `ack_event` history row; the run history is where an old firing's ack stays readable.
fn record_event(
    target: &AckTarget,
    group_key: &str,
    actor: &str,
    action: AckAction,
    source: AckSource,
    taken_over_from: Option<String>,
) {
    usage_reporting::publish_triggers_usage(TriggerData {
        _timestamp: now_micros(),
        org: target.org_id.clone(),
        module: target.module(),
        key: format!("{}/{}", target.name, target.alert_id),
        status: RunOutcome::AckEvent,
        group_label: (!group_key.is_empty()).then(|| group_key.to_string()),
        acked_by: Some(actor.to_string()),
        ack_action: Some(action),
        ack_source: Some(source),
        taken_over_from,
        ..TriggerData::default()
    });
}

#[cfg(feature = "enterprise")]
async fn gather_facts(target: &AckTarget, actor: &str) -> AuthorizeFacts {
    let root = db::user::is_root_user(actor);
    let fga_enabled = o2_openfga::config::get_config().enabled;
    let fga_allows = !root
        && fga_enabled
        && crate::auth::check_permissions(
            &target.alert_id,
            &target.org_id,
            actor,
            "alerts",
            "PUT",
            Some(&target.folder_id),
            false,
            true,
            false,
        )
        .await;
    let role = crate::users::get_user(Some(&target.org_id), actor)
        .await
        .map(|u| u.role);
    let responders = if root {
        vec![]
    } else {
        responder_teams(target).await
    };
    AuthorizeFacts {
        root,
        fga_enabled,
        fga_allows,
        role,
        responders,
    }
}

#[cfg(not(feature = "enterprise"))]
async fn gather_facts(target: &AckTarget, actor: &str) -> AuthorizeFacts {
    let root = db::user::is_root_user(actor);
    let role = crate::users::get_user(Some(&target.org_id), actor)
        .await
        .map(|u| u.role);
    AuthorizeFacts {
        root,
        role,
        ..Default::default()
    }
}

/// Open responses on the alert subject and on the subject of the incident its firing joined.
#[cfg(feature = "enterprise")]
pub(crate) async fn open_responses(
    org_id: &str,
    alert_id: &str,
) -> Vec<config::meta::oncall::response::Response> {
    use config::meta::oncall::subject::SubjectType;
    use infra::table::oncall_responses;

    if !o2_enterprise::enterprise::oncall::is_enabled() {
        return vec![];
    }
    let mut found = Vec::new();
    let mut subjects = vec![(SubjectType::Alert, alert_id.to_string())];
    if let Some(incident_id) = firing_incident(org_id, alert_id).await {
        subjects.push((SubjectType::Incident, incident_id));
    }
    for (kind, source) in subjects {
        if let Ok(Some(r)) = oncall_responses::latest_open_for_source(org_id, kind, &source).await {
            found.push(r);
        }
        if let Ok(rs) = oncall_responses::open_group_records_for_source(org_id, kind, &source).await
        {
            found.extend(rs);
        }
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|r| seen.insert(r.id.clone()));
    found
}

#[cfg(feature = "enterprise")]
async fn responder_teams(target: &AckTarget) -> Vec<ResponderTeam> {
    let mut teams = Vec::new();
    for response in open_responses(&target.org_id, &target.alert_id).await {
        let team_id = response.team().to_string();
        if team_id.is_empty() {
            continue;
        }
        let members = infra::table::oncall_teams::list_members(&team_id)
            .await
            .map(|m| m.into_iter().map(|m| m.user_email).collect())
            .unwrap_or_default();
        let team_name = infra::table::oncall_teams::get_cached(&target.org_id, &team_id)
            .await
            .ok()
            .flatten()
            .map_or_else(|| team_id.clone(), |t| t.name);
        let on_call = o2_enterprise::enterprise::oncall::service::who_is_on_call(
            &target.org_id,
            &team_id,
            None,
        )
        .await
        .map(|positions| positions.into_iter().map(|p| p.user_email).collect())
        .unwrap_or_default();
        teams.push(ResponderTeam {
            response_id: response.id.clone(),
            team_id,
            team_name,
            members,
            on_call,
        });
    }
    teams
}

/// The incident the alert's firing belongs to: the episode's, else the open one by alert id.
#[cfg(feature = "enterprise")]
pub(crate) async fn firing_incident(org_id: &str, alert_id: &str) -> Option<String> {
    let episode = infra::table::alert_states::get(alert_id, ROLLUP_GROUP_KEY)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.episode_incident_id);
    if episode.is_some() {
        return episode;
    }
    infra::table::alert_incidents::find_open_incident_containing_alert(org_id, alert_id)
        .await
        .ok()
        .flatten()
        .map(|m| m.id)
}

async fn org_editors(org_id: &str) -> Vec<(String, UserRole, Option<String>)> {
    let Ok(users) = infra::table::org_users::list_users_by_org(org_id).await else {
        return vec![];
    };
    let mut out = Vec::new();
    for u in users
        .into_iter()
        .filter(|u| matches!(u.role, UserRole::Admin | UserRole::Editor))
    {
        let name = crate::users::get_user(Some(org_id), &u.email)
            .await
            .map(|full| {
                format!("{} {}", full.first_name, full.last_name)
                    .trim()
                    .to_string()
            })
            .filter(|n| !n.is_empty());
        out.push((u.email, u.role, name));
        if out.len() >= 16 {
            break;
        }
    }
    out
}

/// Ack → the firing's incident (unless a downtime muted it) and, under the group rule, the pages.
#[cfg(feature = "enterprise")]
async fn propagate(
    target: &AckTarget,
    actor: &str,
    other_groups_unacked: u32,
    previous_holders: &[String],
) -> (Option<AckIncidentRef>, Option<AckOncallOutcome>) {
    let incident = ACK_ORIGIN
        .scope(target.alert_id.clone(), ack_incident(target, actor))
        .await;
    let oncall = ACK_ORIGIN
        .scope(
            target.alert_id.clone(),
            ack_pages(target, actor, other_groups_unacked, previous_holders),
        )
        .await;
    (incident, oncall)
}

#[cfg(not(feature = "enterprise"))]
async fn propagate(
    _target: &AckTarget,
    _actor: &str,
    _other_groups_unacked: u32,
    _previous_holders: &[String],
) -> (Option<AckIncidentRef>, Option<AckOncallOutcome>) {
    (None, None)
}

#[cfg(feature = "enterprise")]
async fn ack_incident(target: &AckTarget, actor: &str) -> Option<AckIncidentRef> {
    use config::meta::alerts::incidents::IncidentStatus;

    let id = firing_incident(&target.org_id, &target.alert_id).await?;
    let model = infra::table::alert_incidents::get(&target.org_id, &id)
        .await
        .ok()
        .flatten()?;
    let status: IncidentStatus = model.status.parse().unwrap_or_default();
    // A downtime's mute owns a muted incident (AC-P2.3.3); an incident ack of it is left alone.
    if model.muted_by_downtime_id.is_some() || status != IncidentStatus::Open {
        return Some(AckIncidentRef { id, status });
    }
    match crate::alerts::incidents::update_status(&target.org_id, &id, "acknowledged", actor).await
    {
        Ok(updated) => Some(AckIncidentRef {
            id,
            status: updated.status,
        }),
        Err(e) => {
            log::error!("[ALERT_ACK] could not acknowledge incident {id}: {e}");
            Some(AckIncidentRef { id, status })
        }
    }
}

/// Acks the open pages only when no other group fires un-acked; otherwise they keep paging.
#[cfg(feature = "enterprise")]
async fn ack_pages(
    target: &AckTarget,
    actor: &str,
    other_groups_unacked: u32,
    previous_holders: &[String],
) -> Option<AckOncallOutcome> {
    use config::meta::alerts::ack::StillPaging;

    let teams = responder_teams(target).await;
    if teams.is_empty() {
        return None;
    }
    let mut outcome = AckOncallOutcome::default();
    let let_go = holders_who_let_go(target, previous_holders).await;
    for team in teams {
        for previous_holder in &let_go {
            if let Err(e) = o2_enterprise::enterprise::oncall::escalation::take_over_as(
                &target.org_id,
                &team.response_id,
                previous_holder,
                actor,
            )
            .await
            {
                log::error!(
                    "[ALERT_ACK] could not transfer page {}: {e}",
                    team.response_id
                );
            }
        }
        let still = StillPaging {
            response_id: team.response_id.clone(),
            team: team.team_name.clone(),
        };
        if other_groups_unacked > 0 {
            outcome.still_paging.push(still);
            continue;
        }
        match o2_enterprise::enterprise::oncall::escalation::acknowledge_as(
            &target.org_id,
            &team.response_id,
            actor,
        )
        .await
        {
            Ok(_) => outcome.acknowledged.push(team.response_id),
            Err(e) => {
                log::info!("[ALERT_ACK] page {} still paging: {e}", team.response_id);
                outcome.still_paging.push(still);
            }
        }
    }
    Some(outcome)
}

/// Pages have no group, so one moves only once its holder acks no other firing group.
#[cfg(feature = "enterprise")]
async fn holders_who_let_go(target: &AckTarget, previous_holders: &[String]) -> Vec<String> {
    if previous_holders.is_empty() {
        return vec![];
    }
    let acks =
        match infra::table::alert_acks::list_for_alert(&target.org_id, &target.alert_id).await {
            Ok(acks) => acks,
            Err(e) => {
                log::warn!(
                    "[ALERT_ACK] could not list the acks of {}; pages stay put: {e}",
                    target.alert_id
                );
                return vec![];
            }
        };
    let firing: HashMap<String, i64> = firing_rows(target).await.into_iter().collect();
    let_go_of(previous_holders, &acks, &firing)
}

#[cfg(feature = "enterprise")]
fn let_go_of(
    previous_holders: &[String],
    acks: &[AlertAck],
    firing: &HashMap<String, i64>,
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for holder in previous_holders {
        let still_holds = acks.iter().any(|a| {
            a.acked_by.eq_ignore_ascii_case(holder)
                && firing
                    .get(&a.group_key)
                    .is_some_and(|started| a.in_force_for(Some(*started)))
        });
        if !still_holds && !out.iter().any(|h| h.eq_ignore_ascii_case(holder)) {
            out.push(holder.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team(members: &[&str]) -> ResponderTeam {
        ResponderTeam {
            response_id: "r1".into(),
            team_id: "t1".into(),
            team_name: "sre".into(),
            members: members.iter().map(|m| m.to_string()).collect(),
            on_call: vec![],
        }
    }

    fn facts(role: Option<UserRole>) -> AuthorizeFacts {
        AuthorizeFacts {
            role,
            ..Default::default()
        }
    }

    #[test]
    fn the_role_rule_admits_admin_editor_and_service_accounts_and_refuses_viewers() {
        assert_eq!(
            decide(
                "x@acme.com",
                &AuthorizeFacts {
                    root: true,
                    ..Default::default()
                }
            ),
            Some(Via::Root)
        );
        for role in [UserRole::Admin, UserRole::Editor, UserRole::ServiceAccount] {
            assert_eq!(decide("x@acme.com", &facts(Some(role))), Some(Via::Role));
        }
        for role in [Some(UserRole::Viewer), Some(UserRole::User), None] {
            assert_eq!(decide("x@acme.com", &facts(role)), None);
        }
    }

    #[test]
    fn a_responder_acks_through_a_non_empty_team_and_an_empty_team_grants_nothing() {
        let mut f = facts(Some(UserRole::Viewer));
        f.responders = vec![team(&["dana@acme.com"])];
        assert_eq!(decide("Dana@Acme.com", &f), Some(Via::Responder));
        assert_eq!(decide("bob@acme.com", &f), None);
        f.responders = vec![team(&[])];
        assert_eq!(
            decide("dana@acme.com", &f),
            None,
            "an empty team admits nobody"
        );
    }

    #[test]
    fn with_openfga_on_the_alert_put_decides_and_the_role_does_not() {
        let editor_without_put = AuthorizeFacts {
            fga_enabled: true,
            fga_allows: false,
            role: Some(UserRole::Editor),
            ..Default::default()
        };
        assert_eq!(decide("e@acme.com", &editor_without_put), None);
        let viewer_with_put = AuthorizeFacts {
            fga_enabled: true,
            fga_allows: true,
            role: Some(UserRole::Viewer),
            ..Default::default()
        };
        assert_eq!(decide("v@acme.com", &viewer_with_put), Some(Via::Fga));
        let mut responder = editor_without_put.clone();
        responder.responders = vec![team(&["e@acme.com"])];
        assert_eq!(decide("e@acme.com", &responder), Some(Via::Responder));
    }

    #[test]
    fn a_refusal_names_who_is_on_call_and_two_people_who_can_act_admins_first() {
        let mut f = facts(Some(UserRole::Viewer));
        f.responders = vec![ResponderTeam {
            on_call: vec!["oncall@acme.com".into()],
            ..team(&["m1@acme.com", "m2@acme.com"])
        }];
        let editors = vec![
            ("eda@acme.com".to_string(), UserRole::Editor, None),
            ("viewer@acme.com".to_string(), UserRole::Viewer, None),
            (
                "ad@acme.com".to_string(),
                UserRole::Admin,
                Some("Ada".to_string()),
            ),
            ("edb@acme.com".to_string(), UserRole::Editor, None),
        ];
        let r = refusal(Act::Ack, &f, &editors);
        assert_eq!(r.code, RefusalCode::AckRefused);
        assert_eq!(r.rule, RefusalRule::Role);
        assert_eq!(r.on_call.len(), 1);
        assert_eq!(
            (r.on_call[0].email.as_str(), r.on_call[0].team.as_str()),
            ("oncall@acme.com", "sre")
        );
        let can: Vec<&str> = r.can_act.iter().map(|p| p.email.as_str()).collect();
        assert_eq!(can, vec!["ad@acme.com", "eda@acme.com"]);
        assert_eq!(r.can_act[0].name.as_deref(), Some("Ada"));
        let fga = refusal(
            Act::Mute,
            &AuthorizeFacts {
                fga_enabled: true,
                ..Default::default()
            },
            &[],
        );
        assert_eq!(
            (fga.code, fga.rule),
            (RefusalCode::MuteRefused, RefusalRule::Fga)
        );
    }

    fn state(key: &str, firing: Option<i64>) -> (String, AlertState) {
        (
            key.to_string(),
            AlertState {
                firing_started_at: firing,
                ..AlertState::empty("a1", key)
            },
        )
    }

    fn ack(key: &str, firing: i64, at: i64) -> AlertAck {
        AlertAck {
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: key.into(),
            firing_started_at: firing,
            acked_by: format!("{key}@acme.com"),
            acked_at: at,
            ack_source: AckSource::Ui,
            updated_at: at,
            ..Default::default()
        }
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_holder_lets_go_only_with_no_in_force_ack_left_on_the_alert() {
        let firing: HashMap<String, i64> =
            [("g1".to_string(), 100), ("g2".to_string(), 300)].into();
        let alice = |key: &str, started: i64| AlertAck {
            acked_by: "alice@acme.com".into(),
            ..ack(key, started, 5)
        };
        let holders = vec!["ALICE@acme.com".to_string(), "alice@acme.com".to_string()];
        assert!(let_go_of(&holders, &[alice("g2", 300)], &firing).is_empty());
        assert_eq!(
            let_go_of(&holders, &[alice("g2", 200)], &firing),
            vec!["ALICE@acme.com".to_string()],
            "an ack of an older firing holds nothing"
        );
        assert_eq!(let_go_of(&holders, &[], &firing).len(), 1);
    }

    #[test]
    fn only_acks_of_the_current_firing_are_in_force_and_summarised() {
        let states: HashMap<String, AlertState> = [
            state("g1", Some(100)),
            state("g2", Some(300)),
            state("g3", None),
        ]
        .into_iter()
        .collect();
        let acks = vec![ack("g1", 100, 5), ack("g2", 200, 6), ack("g3", 50, 7)];
        let in_force = acks_in_force(&acks, &states);
        assert_eq!(
            in_force.len(),
            1,
            "a new firing and a cleared row start unacked"
        );
        assert_eq!(in_force.get("g1").map(String::as_str), Some("g1@acme.com"));

        let firing: HashMap<String, i64> = [("g1".to_string(), 100), ("g2".to_string(), 200)]
            .into_iter()
            .collect();
        let s = summary(&acks, &firing).unwrap();
        assert_eq!((s.acked_by.as_str(), s.groups_acked), ("g2@acme.com", 2));
        assert!(summary(&acks, &HashMap::new()).is_none());
    }

    #[tokio::test]
    async fn the_origin_guard_is_set_only_inside_an_alerts_own_propagation() {
        assert!(!propagating());
        let inside = ACK_ORIGIN
            .scope("a1".to_string(), async { propagating() })
            .await;
        assert!(inside);
    }
}
