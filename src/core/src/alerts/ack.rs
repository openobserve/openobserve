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
                AckAction, AckConflict, AckIncidentRef, AckOncallOutcome, AckResponse, AckSource,
                AckView, ActRefusal, AlertAck, AlertAckSummary, OnCallPersonRef, PersonRef,
                RefusalCode, RefusalRule, StillPaging, UnackResponse,
            },
            incidents::IncidentStatus,
            state::{AlertState, ROLLUP_GROUP_KEY},
        },
        self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType},
        triggers::{ScheduledTriggerData, TriggerModule},
        user::UserRole,
    },
    utils::time::now_micros,
};

use crate::alerts::lifecycle;

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

/// What the caller asks of the problem's acknowledgement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verb {
    Acknowledge,
    TakeOver,
    Unack,
    /// An unack for a hand-off: the hand-off, not the unack, restarts the page it moves.
    HandOff,
}

/// Which firing groups of an alert an ack names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Groups {
    One {
        group_key: String,
        firing_started_at: Option<i64>,
    },
    All,
}

/// What a person acknowledges: the firing's incident if it is in one, else the firing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Problem {
    Firing { target: AckTarget, groups: Groups },
    Incident { org_id: String, incident_id: String },
}

impl Problem {
    pub fn org_id(&self) -> &str {
        match self {
            Self::Firing { target, .. } => &target.org_id,
            Self::Incident { org_id, .. } => org_id,
        }
    }
}

/// One record that carries the problem's acknowledgement.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AckRecord {
    Firing {
        alert_id: String,
        group_key: String,
        firing_started_at: i64,
    },
    Incident {
        incident_id: String,
    },
}

/// A record and who holds it now; `named` when the caller asked for it rather than carried it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldRecord {
    pub record: AckRecord,
    pub holder: Option<String>,
    pub named: bool,
}

/// One open page of the problem; `acked_by` is set while it is acknowledged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenPage {
    pub response_id: String,
    pub team: String,
    pub acked_by: Option<String>,
    /// The current firing's page, not one left open by an earlier firing (D34).
    pub current: bool,
}

/// Everything [`plan`] decides from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanFacts {
    pub verb: Verb,
    pub actor: String,
    pub records: Vec<HeldRecord>,
    /// Firing groups of the alert the caller did not name that no ack holds.
    pub other_groups_unacked: u32,
    /// Who holds the firing groups of the alert the caller did not name.
    pub other_holders: Vec<String>,
    pub pages: Vec<OpenPage>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecordWrite {
    Claim,
    Move { from: String },
    Clear { holder: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PageStep {
    Stop { by: String },
    MoveTo { from: String },
    Restart { holder: String },
    Leave,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Answer {
    Changed,
    AlreadyYours,
    HeldBy(String),
    NothingFiring,
    NotHeld,
}

/// The writes, page steps and answer of one verb, in the order they are carried out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AckPlan {
    pub writes: Vec<(AckRecord, RecordWrite)>,
    pub pages: Vec<(String, PageStep)>,
    pub still_paging: Vec<StillPaging>,
    pub answer: Answer,
}

/// What carrying a plan out did, for the route's answer.
#[derive(Debug, Default)]
struct Outcome {
    changed: bool,
    acks: Vec<AckView>,
    incident: Option<AckIncidentRef>,
    oncall: Option<AckOncallOutcome>,
    other_groups_unacked: u32,
}

/// The facts and the targets of the alerts they name.
struct Gathered {
    facts: PlanFacts,
    targets: HashMap<String, AckTarget>,
    held: HashMap<(String, String), AlertAck>,
    incident_status: Option<IncidentStatus>,
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

/// Decides every write and page step of one verb on the problem. [pure]
pub fn plan(f: &PlanFacts) -> AckPlan {
    match f.verb {
        Verb::Acknowledge | Verb::TakeOver => plan_hold(f),
        Verb::Unack | Verb::HandOff => plan_release(f),
    }
}

/// The alert or incident a page's subject names, without its impacted and group suffixes. [pure]
pub fn source_of_page(source_id: &str) -> &str {
    let origin = source_id.split(":impacted:").next().unwrap_or(source_id);
    origin.split(":group:").next().unwrap_or(origin)
}

/// The firing's problem: its incident if it is in one, else the firing. [strong] (reads)
pub async fn problem_of_alert(
    org_id: &str,
    alert_id: &str,
    groups: Groups,
) -> Result<Problem, AckError> {
    let target = resolve_target(org_id, alert_id).await?;
    problem_of_target(target, groups).await
}

/// [`problem_of_alert`] for an alert already resolved. [strong] (reads)
pub async fn problem_of_target(target: AckTarget, groups: Groups) -> Result<Problem, AckError> {
    Ok(match incident_of(&target).await? {
        Some(incident_id) => Problem::Incident {
            org_id: target.org_id.clone(),
            incident_id,
        },
        None => Problem::Firing { target, groups },
    })
}

/// The problem behind a page: its incident, or its alert with every group. [strong] (reads)
pub async fn problem_of_page(org_id: &str, response_id: &str) -> Result<Problem, AckError> {
    use config::meta::oncall::SubjectType;

    let Some(page) = infra::table::oncall_responses::get(org_id, response_id).await? else {
        return Err(AckError::NotFound);
    };
    match page.subject.subject_type {
        SubjectType::Incident => Ok(Problem::Incident {
            org_id: org_id.to_string(),
            incident_id: source_of_page(&page.subject.source_id).to_string(),
        }),
        SubjectType::Alert => {
            problem_of_alert(org_id, source_of_page(&page.subject.source_id), Groups::All).await
        }
    }
}

/// Lets the actor act on the problem; `Refused` says who can act instead. [strong] (reads)
pub async fn authorize_problem(p: &Problem, actor: &str, act: Act) -> Result<Via, AckError> {
    let pages = problem_pages(p).await?;
    let facts = gather_facts(p, actor, &pages).await;
    if let Some(via) = decide(actor, &facts) {
        return Ok(via);
    }
    let editors = org_editors(p.org_id()).await;
    Err(AckError::Refused(refusal(act, &facts, &editors)))
}

/// Lets the actor act on the alert's problem; `Refused` says who can. [strong] (reads)
pub async fn authorize(target: &AckTarget, actor: &str, act: Act) -> Result<Via, AckError> {
    let problem = problem_of_target(target.clone(), Groups::All).await?;
    authorize_problem(&problem, actor, act).await
}

/// A page whose alert is gone: root, the role rule or its team may act. [strong] (reads)
#[cfg(feature = "enterprise")]
pub async fn authorize_orphan_page(
    page: &config::meta::oncall::response::Response,
    actor: &str,
    act: Act,
) -> Result<Via, ActRefusal> {
    let facts = AuthorizeFacts {
        root: db::user::is_root_user(actor),
        fga_enabled: o2_openfga::config::get_config().enabled,
        // With OpenFGA on there is no alert left to hold edit rights on.
        fga_allows: false,
        role: crate::users::get_user(Some(&page.org_id), actor)
            .await
            .map(|u| u.role),
        responders: responders_of(&page.org_id, std::slice::from_ref(page)).await,
    };
    if let Some(via) = decide(actor, &facts) {
        return Ok(via);
    }
    let editors = org_editors(&page.org_id).await;
    Err(refusal(act, &facts, &editors))
}

/// Whether `may_edit` admits the alert, or any alert of the incident (D24). [strong] (reads)
#[cfg(feature = "enterprise")]
pub async fn may_edit_any_alert_with<F, Fut>(p: &Problem, may_edit: F) -> bool
where
    F: Fn(AckTarget) -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let targets = match p {
        Problem::Firing { target, .. } => vec![target.clone()],
        Problem::Incident {
            org_id,
            incident_id,
        } => {
            let ids = match incident_alert_ids(incident_id).await {
                Ok(ids) => ids,
                Err(e) => {
                    log::warn!("[ALERT_ACK] could not list the alerts of {incident_id}: {e:?}");
                    vec![]
                }
            };
            let mut targets = Vec::with_capacity(ids.len());
            for id in ids {
                if let Ok(t) = resolve_target(org_id, &id).await {
                    targets.push(t);
                }
            }
            targets
        }
    };
    for target in targets {
        if may_edit(target).await {
            return true;
        }
    }
    false
}

/// Acknowledges the problem as `actor` and stops its pages.
/// [weak: the problem's ack is written first; a failed page stop leaves that page escalating and is
/// logged; a retry finds the ack in place and stops the remaining pages]
pub async fn acknowledge(
    p: &Problem,
    actor: &str,
    source: AckSource,
) -> Result<AckResponse, AckError> {
    hold(p, Verb::Acknowledge, actor, source).await
}

/// Moves the problem's ack to `actor` on every record and page. [weak: same as acknowledge]
pub async fn take_over(
    p: &Problem,
    actor: &str,
    source: AckSource,
) -> Result<AckResponse, AckError> {
    hold(p, Verb::TakeOver, actor, source).await
}

/// Clears the problem's ack and restarts the pages it stopped at step 1.
/// [weak: the ack is cleared first; a page that fails to restart stays acknowledged until the next
/// unack; one restarted with no ladder armed is logged and left to `reconcile_abandoned`]
pub async fn unack(p: &Problem, actor: &str, source: AckSource) -> Result<UnackResponse, AckError> {
    release(p, Verb::Unack, actor, source).await
}

/// Clears the problem's ack for a hand-off, which restarts the page it moves.
/// [weak: a record that fails to clear is an error; the ones cleared before it stay cleared, and a
/// retry clears the rest]
pub async fn release_for_hand_off(
    p: &Problem,
    actor: &str,
    source: AckSource,
) -> Result<UnackResponse, AckError> {
    release(p, Verb::HandOff, actor, source).await
}

/// A firing that joins an acknowledged incident takes the incident's ack, so nobody is re-paged.
/// [weak: a row that fails to write is logged and the firing reads unacknowledged; the next join
/// writes it]
#[cfg(feature = "enterprise")]
pub async fn join_acked_incident(org_id: &str, incident_id: &str, alert_id: &str) {
    let holder = match infra::table::alert_incidents::get(org_id, incident_id).await {
        Ok(Some(m)) if m.status == "acknowledged" => m.acknowledged_by,
        Ok(_) => None,
        Err(e) => {
            log::error!("[ALERT_ACK] could not read incident {incident_id} for a join: {e}");
            None
        }
    };
    let Some(holder) = holder else {
        return;
    };
    let target = match resolve_target(org_id, alert_id).await {
        Ok(t) => t,
        Err(e) => {
            log::error!("[ALERT_ACK] {alert_id} joined {incident_id} and could not be read: {e:?}");
            return;
        }
    };
    let acks = match infra::table::alert_acks::list_for_alert(org_id, alert_id).await {
        Ok(acks) => acks,
        Err(e) => {
            log::error!("[ALERT_ACK] could not read the acks of {alert_id} for a join: {e}");
            return;
        }
    };
    for (group_key, started) in firing_rows(&target).await {
        if acks
            .iter()
            .any(|a| a.group_key == group_key && a.in_force_for(Some(started)))
        {
            continue;
        }
        if let Err(e) = write_firing(
            &target,
            &group_key,
            started,
            &RecordWrite::Claim,
            &holder,
            AckSource::Incident,
        )
        .await
        {
            log::error!("[ALERT_ACK] could not carry {incident_id}'s ack to {alert_id}: {e:?}");
        }
    }
}

/// Snoozes each open page of the alert's problem until `until`, for at most a day.
/// [weak: each page is snoozed on its own; one that fails, or pages that cannot be read, say why in
/// `refused`]
#[cfg(feature = "enterprise")]
pub async fn snooze_pages_until(
    target: &AckTarget,
    actor: &str,
    until: i64,
    now: i64,
) -> Vec<config::meta::downtimes::MutedPage> {
    use config::meta::downtimes::MutedPage;
    use o2_enterprise::enterprise::oncall::{escalation, service::OncallError};

    let pages = match problem_of_target(target.clone(), Groups::All).await {
        Ok(problem) => problem_pages(&problem).await,
        Err(e) => Err(e),
    };
    let pages = match pages {
        Ok(pages) => pages,
        Err(e) => {
            log::error!("[ALERT_MUTE] pages of {} not read: {e:?}", target.alert_id);
            return vec![MutedPage {
                refused: Some("the alert's open pages could not be read".to_string()),
                ..MutedPage::default()
            }];
        }
    };
    let minutes = snooze_minutes(until, now);
    let mut out = Vec::new();
    for page in pages {
        let team = team_name(&page.org_id, page.team()).await;
        let (snoozed_until, refused) =
            match escalation::snooze(&page.org_id, &page.id, actor, minutes, now).await {
                Ok(Some(r)) => (r.snoozed_until, None),
                Ok(None) => (None, Some("the page is gone".to_string())),
                Err(e) if e.downcast_ref::<OncallError>().is_some() => (None, Some(e.to_string())),
                Err(e) => {
                    log::error!("[ALERT_MUTE] could not snooze page {}: {e}", page.id);
                    (None, Some("the page could not be snoozed".to_string()))
                }
            };
        out.push(MutedPage {
            response_id: page.id,
            team,
            snoozed_until,
            refused,
        });
    }
    out
}

/// Whole minutes from `now` to `until`, rounded up, within one minute and a day. [pure]
pub fn snooze_minutes(until: i64, now: i64) -> i64 {
    const MINUTE: i64 = 60 * 1_000_000;
    const DAY_MINUTES: i64 = 24 * 60;
    let left = until.saturating_sub(now).max(0);
    ((left + MINUTE - 1) / MINUTE).clamp(1, DAY_MINUTES)
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

/// Open responses on the alert subject and on the subject of the incident its firing joined.
#[cfg(feature = "enterprise")]
pub(crate) async fn open_responses(
    org_id: &str,
    alert_id: &str,
) -> Vec<config::meta::oncall::response::Response> {
    use config::meta::oncall::subject::SubjectType;

    if !o2_enterprise::enterprise::oncall::is_enabled() {
        return vec![];
    }
    let mut found = Vec::new();
    let mut subjects = vec![(SubjectType::Alert, alert_id.to_string())];
    if let Some(incident_id) = firing_incident(org_id, alert_id).await {
        subjects.push((SubjectType::Incident, incident_id));
    }
    for (kind, source) in subjects {
        match open_for_source(org_id, kind, &source).await {
            Ok(pages) => found.extend(pages.into_iter().map(|(page, _)| page)),
            // A view shows what it can read.
            Err(e) => log::warn!("[ALERT_ACK] could not read the pages of {source}: {e:?}"),
        }
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|r| seen.insert(r.id.clone()));
    found
}

/// The incident the alert's firing belongs to, for a view: a failed read reads as none.
#[cfg(feature = "enterprise")]
pub(crate) async fn firing_incident(org_id: &str, alert_id: &str) -> Option<String> {
    match firing_incident_checked(org_id, alert_id).await {
        Ok(id) => id,
        Err(e) => {
            log::warn!("[ALERT_ACK] could not read the incident of {alert_id}: {e:?}");
            None
        }
    }
}

/// The incident the alert's firing belongs to: the episode's, else the open one by alert id.
#[cfg(feature = "enterprise")]
async fn firing_incident_checked(org_id: &str, alert_id: &str) -> Result<Option<String>, AckError> {
    let episode = infra::table::alert_states::get(alert_id, ROLLUP_GROUP_KEY)
        .await?
        .and_then(|s| s.episode_incident_id);
    if episode.is_some() {
        return Ok(episode);
    }
    Ok(
        infra::table::alert_incidents::find_open_incident_containing_alert(org_id, alert_id)
            .await?
            .map(|m| m.id),
    )
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
async fn gather_facts(
    p: &Problem,
    actor: &str,
    pages: &[config::meta::oncall::response::Response],
) -> AuthorizeFacts {
    let root = db::user::is_root_user(actor);
    let fga_enabled = o2_openfga::config::get_config().enabled;
    let fga_allows = !root && fga_enabled && may_edit_any_alert(p, actor).await;
    let role = crate::users::get_user(Some(p.org_id()), actor)
        .await
        .map(|u| u.role);
    let responders = if root {
        vec![]
    } else {
        responders_of(p.org_id(), pages).await
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
async fn gather_facts(
    p: &Problem,
    actor: &str,
    _pages: &[config::meta::oncall::response::Response],
) -> AuthorizeFacts {
    let root = db::user::is_root_user(actor);
    let role = crate::users::get_user(Some(p.org_id()), actor)
        .await
        .map(|u| u.role);
    AuthorizeFacts {
        root,
        role,
        ..Default::default()
    }
}

/// OpenFGA edit on the alert, or on any alert of the incident (D24).
#[cfg(feature = "enterprise")]
async fn may_edit_any_alert(p: &Problem, actor: &str) -> bool {
    may_edit_any_alert_with(p, |target: AckTarget| async move {
        crate::auth::check_permissions(
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
        .await
    })
    .await
}

/// The members of every team with an open page on the problem, owner or impacted.
#[cfg(feature = "enterprise")]
async fn responders_of(
    org_id: &str,
    pages: &[config::meta::oncall::response::Response],
) -> Vec<ResponderTeam> {
    let mut teams: Vec<ResponderTeam> = Vec::new();
    for page in pages {
        let team_id = page.team().to_string();
        if team_id.is_empty() || teams.iter().any(|t| t.team_id == team_id) {
            continue;
        }
        let members = infra::table::oncall_teams::list_members(&team_id)
            .await
            .map(|m| m.into_iter().map(|m| m.user_email).collect())
            .unwrap_or_default();
        let on_call =
            o2_enterprise::enterprise::oncall::service::who_is_on_call(org_id, &team_id, None)
                .await
                .map(|positions| positions.into_iter().map(|p| p.user_email).collect())
                .unwrap_or_default();
        teams.push(ResponderTeam {
            response_id: page.id.clone(),
            team_name: team_name(org_id, &team_id).await,
            team_id,
            members,
            on_call,
        });
    }
    teams
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

fn same(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn plan_hold(f: &PlanFacts) -> AckPlan {
    let take_over = f.verb == Verb::TakeOver;
    let named: Vec<&HeldRecord> = f.records.iter().filter(|r| r.named).collect();
    let free = named.iter().any(|r| r.holder.is_none());
    let other = named
        .iter()
        .find_map(|r| r.holder.as_ref().filter(|h| !same(h, &f.actor)));
    // Someone else holds all of it: nothing moves, and the stops their ack left unfinished finish
    // as them.
    if let Some(holder) = other
        && !take_over
        && !free
    {
        let (pages, still_paging) = hold_pages(f, holder, false);
        return AckPlan {
            writes: vec![],
            pages,
            still_paging,
            answer: Answer::HeldBy(holder.clone()),
        };
    }
    let writes = f
        .records
        .iter()
        .filter_map(|r| hold_write(r, &f.actor, take_over).map(|w| (r.record.clone(), w)))
        .collect();
    let changed = named
        .iter()
        .any(|r| hold_write(r, &f.actor, take_over).is_some());
    let (pages, still_paging) = hold_pages(f, &f.actor, take_over);
    let answer = match (named.is_empty(), changed) {
        (true, _) => Answer::NothingFiring,
        (false, true) => Answer::Changed,
        (false, false) => Answer::AlreadyYours,
    };
    AckPlan {
        writes,
        pages,
        still_paging,
        answer,
    }
}

fn hold_write(r: &HeldRecord, actor: &str, take_over: bool) -> Option<RecordWrite> {
    match &r.holder {
        None => Some(RecordWrite::Claim),
        Some(h) if same(h, actor) => None,
        Some(h) if take_over => Some(RecordWrite::Move { from: h.clone() }),
        Some(_) => None,
    }
}

/// Each page's step when `by` holds the problem, and the pages left paging.
fn hold_pages(
    f: &PlanFacts,
    by: &str,
    take_over: bool,
) -> (Vec<(String, PageStep)>, Vec<StillPaging>) {
    let mut still_paging = Vec::new();
    let pages = f
        .pages
        .iter()
        .map(|p| {
            let step = hold_step(p, f, by, take_over);
            if step == PageStep::Leave && p.acked_by.is_none() {
                still_paging.push(StillPaging {
                    response_id: p.response_id.clone(),
                    team: p.team.clone(),
                });
            }
            (p.response_id.clone(), step)
        })
        .collect();
    (pages, still_paging)
}

/// A take-over moves only a current page whose holder holds no other group of the alert.
fn hold_step(p: &OpenPage, f: &PlanFacts, by: &str, take_over: bool) -> PageStep {
    match &p.acked_by {
        None if f.other_groups_unacked > 0 => PageStep::Leave,
        None => PageStep::Stop { by: by.to_string() },
        Some(h) if same(h, by) => PageStep::Leave,
        Some(h) if take_over && p.current && !f.other_holders.iter().any(|o| same(o, h)) => {
            PageStep::MoveTo { from: h.clone() }
        }
        Some(_) => PageStep::Leave,
    }
}

/// An unack restarts the current pages an ack stopped (D34); a hand-off leaves them be.
fn plan_release(f: &PlanFacts) -> AckPlan {
    let held = f.records.iter().any(|r| r.named && r.holder.is_some());
    let writes = if held {
        f.records
            .iter()
            .filter_map(|r| {
                r.holder
                    .as_ref()
                    .map(|h| (r.record.clone(), RecordWrite::Clear { holder: h.clone() }))
            })
            .collect()
    } else {
        vec![]
    };
    let pages = f
        .pages
        .iter()
        .map(|p| {
            let step = match (&p.acked_by, f.verb) {
                (Some(h), Verb::Unack) if p.current => PageStep::Restart { holder: h.clone() },
                _ => PageStep::Leave,
            };
            (p.response_id.clone(), step)
        })
        .collect();
    AckPlan {
        writes,
        pages,
        still_paging: vec![],
        answer: if held {
            Answer::Changed
        } else {
            Answer::NotHeld
        },
    }
}

async fn hold(
    p: &Problem,
    verb: Verb,
    actor: &str,
    source: AckSource,
) -> Result<AckResponse, AckError> {
    let g = gather(p, verb, actor).await?;
    let plan = plan(&g.facts);
    // Nothing fires and no page is open: there is nothing to acknowledge at all.
    if plan.answer == Answer::NothingFiring && g.facts.pages.is_empty() {
        return Err(AckError::Conflict(AckConflict::NotFiring));
    }
    let out = carry_out(p, &g, &plan, actor, source).await?;
    Ok(AckResponse {
        changed: out.changed,
        acks: out.acks,
        incident: out.incident,
        oncall: out.oncall,
        other_groups_unacked: out.other_groups_unacked,
    })
}

async fn release(
    p: &Problem,
    verb: Verb,
    actor: &str,
    source: AckSource,
) -> Result<UnackResponse, AckError> {
    let g = gather(p, verb, actor).await?;
    let plan = plan(&g.facts);
    let out = carry_out(p, &g, &plan, actor, source).await?;
    Ok(UnackResponse {
        changed: out.changed,
        ack: out.acks.into_iter().next(),
    })
}

/// Reads who holds each record of the problem and which of its pages are open. [strong] (reads)
async fn gather(p: &Problem, verb: Verb, actor: &str) -> Result<Gathered, AckError> {
    let mut pages = Vec::new();
    for (r, current) in marked_problem_pages(p).await? {
        let acked_by = (r.state == config::meta::oncall::ResponseState::Acknowledged)
            .then(|| r.acked_by.clone())
            .flatten();
        pages.push(OpenPage {
            team: team_name(&r.org_id, r.team()).await,
            response_id: r.id,
            acked_by,
            current,
        });
    }
    let mut g = Gathered {
        facts: PlanFacts {
            verb,
            actor: actor.to_string(),
            records: vec![],
            other_groups_unacked: 0,
            other_holders: vec![],
            pages,
        },
        targets: HashMap::new(),
        held: HashMap::new(),
        incident_status: None,
    };
    match p {
        Problem::Firing { target, groups } => gather_firing(&mut g, target, groups).await?,
        Problem::Incident {
            org_id,
            incident_id,
        } => gather_incident(&mut g, org_id, incident_id).await?,
    }
    Ok(g)
}

async fn gather_firing(
    g: &mut Gathered,
    target: &AckTarget,
    groups: &Groups,
) -> Result<(), AckError> {
    let acks = infra::table::alert_acks::list_for_alert(&target.org_id, &target.alert_id).await?;
    let named = match groups {
        Groups::All => firing_rows(target).await,
        Groups::One {
            group_key,
            firing_started_at,
        } => one_row(target, group_key, *firing_started_at, g.facts.verb).await?,
    };
    for (group_key, started) in &named {
        push_firing(g, target, group_key, *started, &acks, true);
    }
    if let Groups::One { group_key, .. } = groups
        && target.multi_alert
    {
        for (key, started) in firing_rows(target).await {
            if &key == group_key {
                continue;
            }
            match acks
                .iter()
                .find(|a| a.group_key == key && a.in_force_for(Some(started)))
            {
                Some(a) => g.facts.other_holders.push(a.acked_by.clone()),
                None => g.facts.other_groups_unacked += 1,
            }
        }
    }
    g.targets.insert(target.alert_id.clone(), target.clone());
    Ok(())
}

/// The one row a group ack names; an unack names the firing it is given, or the current one.
async fn one_row(
    target: &AckTarget,
    group_key: &str,
    firing_started_at: Option<i64>,
    verb: Verb,
) -> Result<Vec<(String, i64)>, AckError> {
    if matches!(verb, Verb::Unack | Verb::HandOff) {
        let firing = match firing_started_at {
            Some(f) => Some(f),
            None => current_firing(target, group_key).await?,
        };
        return Ok(firing
            .map(|f| vec![(group_key.to_string(), f)])
            .unwrap_or_default());
    }
    // A multi-alert is acked per group, any other alert on its own row.
    if target.multi_alert == (group_key == ROLLUP_GROUP_KEY) {
        return Err(AckError::Conflict(AckConflict::NotFiring));
    }
    let Some(started) = current_firing(target, group_key).await? else {
        return Err(AckError::Conflict(AckConflict::NotFiring));
    };
    if firing_started_at.is_some_and(|f| f != started) {
        return Err(AckError::Conflict(AckConflict::FiringChanged {
            firing_started_at: started,
        }));
    }
    Ok(vec![(group_key.to_string(), started)])
}

fn push_firing(
    g: &mut Gathered,
    target: &AckTarget,
    group_key: &str,
    started: i64,
    acks: &[AlertAck],
    named: bool,
) {
    let held = acks
        .iter()
        .find(|a| a.group_key == group_key && a.in_force_for(Some(started)));
    g.facts.records.push(HeldRecord {
        record: AckRecord::Firing {
            alert_id: target.alert_id.clone(),
            group_key: group_key.to_string(),
            firing_started_at: started,
        },
        holder: held.map(|a| a.acked_by.clone()),
        named,
    });
    if let Some(a) = held {
        g.held
            .insert((target.alert_id.clone(), group_key.to_string()), a.clone());
    }
}

#[cfg(feature = "enterprise")]
async fn gather_incident(
    g: &mut Gathered,
    org_id: &str,
    incident_id: &str,
) -> Result<(), AckError> {
    let Some(model) = infra::table::alert_incidents::get(org_id, incident_id).await? else {
        return Err(AckError::NotFound);
    };
    let status: IncidentStatus = model.status.parse().unwrap_or_default();
    g.incident_status = Some(status);
    // A resolved incident has nothing to acknowledge or clear; reopening it is its own verb.
    if status == IncidentStatus::Resolved {
        return Ok(());
    }
    g.facts.records.push(HeldRecord {
        record: AckRecord::Incident {
            incident_id: incident_id.to_string(),
        },
        holder: (status == IncidentStatus::Acknowledged)
            .then_some(model.acknowledged_by)
            .flatten(),
        named: true,
    });
    for alert_id in incident_alert_ids(incident_id).await? {
        let target = match resolve_target(org_id, &alert_id).await {
            Ok(t) => t,
            Err(AckError::NotFound) => continue,
            Err(e) => return Err(e),
        };
        let acks = infra::table::alert_acks::list_for_alert(org_id, &alert_id).await?;
        for (group_key, started) in firing_rows(&target).await {
            push_firing(g, &target, &group_key, started, &acks, false);
        }
        g.targets.insert(alert_id, target);
    }
    Ok(())
}

#[cfg(not(feature = "enterprise"))]
async fn gather_incident(
    _g: &mut Gathered,
    _org_id: &str,
    _incident_id: &str,
) -> Result<(), AckError> {
    Err(AckError::NotFound)
}

/// The alerts of an incident, each once.
#[cfg(feature = "enterprise")]
async fn incident_alert_ids(incident_id: &str) -> Result<Vec<String>, AckError> {
    let mut ids: Vec<String> = infra::table::alert_incidents::get_incident_alerts(incident_id)
        .await?
        .into_iter()
        .map(|a| a.alert_id)
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Carries the plan out: the named records first, so a lost race writes nothing else.
async fn carry_out(
    p: &Problem,
    g: &Gathered,
    plan: &AckPlan,
    actor: &str,
    source: AckSource,
) -> Result<Outcome, AckError> {
    let mut views: HashMap<(String, String), AckView> =
        g.held.iter().map(|(k, a)| (k.clone(), a.view())).collect();
    let mut won_named = false;
    let mut lost_named = false;
    let mut incident_status = g.incident_status;
    for (record, write) in &plan.writes {
        let named = g
            .facts
            .records
            .iter()
            .any(|r| &r.record == record && r.named);
        let won = match record {
            AckRecord::Incident { incident_id } => {
                let won = write_incident(p.org_id(), incident_id, write, actor).await?;
                if won {
                    incident_status = Some(status_after(write));
                } else if *write == RecordWrite::Claim {
                    // Someone else's ack landed first; theirs stands and nothing else moves.
                    incident_status = Some(IncidentStatus::Acknowledged);
                    break;
                }
                won
            }
            AckRecord::Firing {
                alert_id,
                group_key,
                firing_started_at,
            } => {
                let Some(target) = g.targets.get(alert_id) else {
                    return Err(AckError::Internal(format!("no target read for {alert_id}")));
                };
                let src = if matches!(p, Problem::Incident { .. }) {
                    AckSource::Incident
                } else {
                    source
                };
                let (view, won) =
                    write_firing(target, group_key, *firing_started_at, write, actor, src).await?;
                let key = (alert_id.clone(), group_key.clone());
                match view {
                    Some(v) => views.insert(key, v),
                    None => views.remove(&key),
                };
                won
            }
        };
        won_named |= named && won;
        lost_named |= named && !won;
    }
    // Every write asked for lost a race: the winner's own press stops the pages, as the winner.
    let (oncall, stepped) = if lost_named && !won_named {
        (None, false)
    } else {
        step_pages(p.org_id(), g, plan, actor).await
    };
    let page_only = matches!(plan.answer, Answer::NothingFiring | Answer::NotHeld);
    Ok(Outcome {
        changed: won_named || (page_only && stepped),
        acks: ordered_views(&g.facts.records, &mut views),
        incident: incident_ref(p, incident_status),
        oncall,
        other_groups_unacked: g.facts.other_groups_unacked,
    })
}

fn ordered_views(
    records: &[HeldRecord],
    views: &mut HashMap<(String, String), AckView>,
) -> Vec<AckView> {
    records
        .iter()
        .filter_map(|r| match &r.record {
            AckRecord::Firing {
                alert_id,
                group_key,
                ..
            } => views.remove(&(alert_id.clone(), group_key.clone())),
            AckRecord::Incident { .. } => None,
        })
        .collect()
}

fn status_after(write: &RecordWrite) -> IncidentStatus {
    match write {
        RecordWrite::Claim | RecordWrite::Move { .. } => IncidentStatus::Acknowledged,
        RecordWrite::Clear { .. } => IncidentStatus::Open,
    }
}

fn incident_ref(p: &Problem, status: Option<IncidentStatus>) -> Option<AckIncidentRef> {
    match (p, status) {
        (Problem::Incident { incident_id, .. }, Some(status)) => Some(AckIncidentRef {
            id: incident_id.clone(),
            status,
        }),
        _ => None,
    }
}

/// Writes one firing row; the view is the row as it stands after, and `true` when this write won.
async fn write_firing(
    target: &AckTarget,
    group_key: &str,
    started: i64,
    write: &RecordWrite,
    actor: &str,
    source: AckSource,
) -> Result<(Option<AckView>, bool), AckError> {
    let now = now_micros();
    let ack = |taken_over_from: Option<String>| AlertAck {
        org_id: target.org_id.clone(),
        alert_id: target.alert_id.clone(),
        group_key: group_key.to_string(),
        firing_started_at: started,
        acked_by: actor.to_string(),
        acked_at: now,
        ack_source: source,
        taken_over_from,
        unacked_at: None,
        unacked_by: None,
        updated_at: now,
    };
    let (row, action, from) = match write {
        RecordWrite::Claim => {
            let row = ack(None);
            if !db::alerts::alert_acks::claim(&row).await? {
                // Lost a race to another ack of the same firing: answer with theirs.
                let theirs =
                    infra::table::alert_acks::get(&target.org_id, &target.alert_id, group_key)
                        .await?;
                return Ok((theirs.map(|t| t.view()), false));
            }
            (row, AckAction::Ack, None)
        }
        RecordWrite::Move { from } => {
            let row = ack(Some(from.clone()));
            if !db::alerts::alert_acks::take_over(&row, from).await? {
                // The holder this read named let go or was taken over meanwhile: theirs stands.
                let theirs =
                    infra::table::alert_acks::get(&target.org_id, &target.alert_id, group_key)
                        .await?;
                return Ok((theirs.map(|t| t.view()), false));
            }
            (row, AckAction::TakeOver, Some(from.clone()))
        }
        RecordWrite::Clear { .. } => {
            let Some(row) = db::alerts::alert_acks::unack(
                &target.org_id,
                &target.alert_id,
                group_key,
                started,
                actor,
                now,
            )
            .await?
            else {
                return Ok((None, false));
            };
            reopen_silence(target, group_key, started, now).await;
            (row, AckAction::Unack, None)
        }
    };
    record_event(target, group_key, actor, action, source, from);
    lifecycle::on_view_changed(&target.org_id, &target.alert_id, Some(group_key)).await;
    Ok((Some(row.view()), true))
}

/// Writes the incident row and its one event; `true` when this write won.
#[cfg(feature = "enterprise")]
async fn write_incident(
    org_id: &str,
    incident_id: &str,
    write: &RecordWrite,
    actor: &str,
) -> Result<bool, AckError> {
    use config::meta::alerts::incidents::IncidentEvent;
    use infra::table::alert_incidents;

    let (won, event) = match write {
        RecordWrite::Claim => {
            let Some(m) = alert_incidents::acknowledge(org_id, incident_id, actor).await? else {
                return Err(AckError::NotFound);
            };
            let won = m.status == "acknowledged"
                && m.acknowledged_by.as_deref().is_some_and(|h| same(h, actor));
            (won, IncidentEvent::acknowledged(actor))
        }
        RecordWrite::Move { from } => (
            alert_incidents::take_over_acknowledgement(org_id, incident_id, from, actor).await?,
            IncidentEvent::acknowledged(actor),
        ),
        RecordWrite::Clear { holder } => (
            alert_incidents::unacknowledge(org_id, incident_id, holder).await?,
            IncidentEvent::reopened(actor, "Unacknowledged"),
        ),
    };
    if won {
        let status = status_after(write);
        crate::alerts::incidents::record_ack_change(org_id, incident_id, status, event).await;
    }
    Ok(won)
}

#[cfg(not(feature = "enterprise"))]
async fn write_incident(
    _org_id: &str,
    _incident_id: &str,
    _write: &RecordWrite,
    _actor: &str,
) -> Result<bool, AckError> {
    Err(AckError::NotFound)
}

/// Runs each page step (a failure is logged and still paging); true when any took effect.
#[cfg(feature = "enterprise")]
async fn step_pages(
    org_id: &str,
    g: &Gathered,
    plan: &AckPlan,
    actor: &str,
) -> (Option<AckOncallOutcome>, bool) {
    if plan.pages.is_empty() {
        return (None, false);
    }
    let mut outcome = AckOncallOutcome {
        acknowledged: vec![],
        still_paging: plan.still_paging.clone(),
        stopped: vec![],
    };
    let mut stepped = false;
    for (response_id, step) in &plan.pages {
        if *step == PageStep::Leave {
            continue;
        }
        let page = || StillPaging {
            response_id: response_id.clone(),
            team: g
                .facts
                .pages
                .iter()
                .find(|p| &p.response_id == response_id)
                .map(|p| p.team.clone())
                .unwrap_or_default(),
        };
        match step_page(org_id, response_id, step, actor).await {
            Ok(false) => {}
            Ok(true) => {
                stepped = true;
                if !matches!(step, PageStep::Restart { .. }) {
                    outcome.acknowledged.push(response_id.clone());
                    outcome.stopped.push(page());
                }
            }
            Err(e) => {
                log::error!("[ALERT_ACK] page {response_id}: {step:?} failed: {e}");
                if matches!(step, PageStep::Stop { .. }) {
                    outcome.still_paging.push(page());
                }
            }
        }
    }
    (Some(outcome), stepped)
}

#[cfg(not(feature = "enterprise"))]
async fn step_pages(
    _org_id: &str,
    _g: &Gathered,
    _plan: &AckPlan,
    _actor: &str,
) -> (Option<AckOncallOutcome>, bool) {
    (None, false)
}

/// One page step through the enterprise ladder functions; true when it changed the page.
#[cfg(feature = "enterprise")]
async fn step_page(
    org_id: &str,
    response_id: &str,
    step: &PageStep,
    actor: &str,
) -> Result<bool, anyhow::Error> {
    use config::meta::oncall::ResponseState;
    use o2_enterprise::enterprise::oncall::escalation;

    let held_by = |r: Option<config::meta::oncall::response::Response>, who: &str| {
        r.is_some_and(|r| {
            r.state == ResponseState::Acknowledged
                && r.acked_by.as_deref().is_some_and(|h| same(h, who))
        })
    };
    match step {
        PageStep::Leave => Ok(false),
        PageStep::Stop { by } => {
            let after = escalation::acknowledge_as(org_id, response_id, by).await?;
            Ok(held_by(Some(after), by))
        }
        PageStep::MoveTo { from } => {
            escalation::take_over_as(org_id, response_id, from, actor).await?;
            Ok(held_by(
                infra::table::oncall_responses::get(org_id, response_id).await?,
                actor,
            ))
        }
        PageStep::Restart { holder } => {
            match escalation::reopen(org_id, response_id, actor, holder).await {
                Ok(reopened) => Ok(reopened.is_some()),
                // `reopen` can fail after the restart committed; then the page did restart.
                Err(e) => {
                    let after = infra::table::oncall_responses::get(org_id, response_id).await?;
                    if after.is_some_and(|r| r.state.is_escalating()) {
                        log::error!(
                            "[ALERT_ACK] page {response_id} restarted without its ladder armed: {e}"
                        );
                        return Ok(true);
                    }
                    Err(e)
                }
            }
        }
    }
}

/// The open pages of the problem: its subjects' pages and the impacted teams' pages they opened.
async fn problem_pages(
    p: &Problem,
) -> Result<Vec<config::meta::oncall::response::Response>, AckError> {
    Ok(marked_problem_pages(p)
        .await?
        .into_iter()
        .map(|(page, _)| page)
        .collect())
}

/// [`problem_pages`], each marked current or left over from an earlier firing (D34).
#[cfg(feature = "enterprise")]
async fn marked_problem_pages(
    p: &Problem,
) -> Result<Vec<(config::meta::oncall::response::Response, bool)>, AckError> {
    use config::meta::oncall::SubjectType;

    if !o2_enterprise::enterprise::oncall::is_enabled() {
        return Ok(vec![]);
    }
    let org_id = p.org_id();
    let mut subjects = match p {
        Problem::Firing { target, .. } => vec![(SubjectType::Alert, target.alert_id.clone())],
        Problem::Incident { incident_id, .. } => vec![(SubjectType::Incident, incident_id.clone())],
    };
    if let Problem::Incident { incident_id, .. } = p {
        let alerts = incident_alert_ids(incident_id).await?;
        subjects.extend(alerts.into_iter().map(|a| (SubjectType::Alert, a)));
    }
    let mut found = Vec::new();
    for (kind, source) in subjects {
        found.extend(open_for_source(org_id, kind, &source).await?);
    }
    let owners: Vec<(String, bool)> = found.iter().map(|(r, now)| (r.id.clone(), *now)).collect();
    for (owner, now) in owners {
        let impacted = infra::table::oncall_responses::list_impacted(org_id, &owner).await?;
        found.extend(impacted.into_iter().map(|r| (r, now)));
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|(r, _)| {
        r.closed_at.is_none() && !r.state.is_terminal() && seen.insert(r.id.clone())
    });
    Ok(found)
}

#[cfg(not(feature = "enterprise"))]
async fn marked_problem_pages(
    _p: &Problem,
) -> Result<Vec<(config::meta::oncall::response::Response, bool)>, AckError> {
    Ok(vec![])
}

/// Every open page of a subject and its open per-group pages; only the newest firing's is current.
#[cfg(feature = "enterprise")]
async fn open_for_source(
    org_id: &str,
    kind: config::meta::oncall::SubjectType,
    source: &str,
) -> Result<Vec<(config::meta::oncall::response::Response, bool)>, AckError> {
    use infra::table::oncall_responses;

    // Newest first, so the first record is the current firing's.
    let records = oncall_responses::open_records_for_source(org_id, kind, source).await?;
    let mut found: Vec<_> = records
        .into_iter()
        .enumerate()
        .map(|(i, r)| (r, i == 0))
        .collect();
    let groups = oncall_responses::open_group_records_for_source(org_id, kind, source).await?;
    found.extend(groups.into_iter().map(|r| (r, true)));
    Ok(found)
}

/// A team's display name; a teamless page has none.
#[cfg(feature = "enterprise")]
async fn team_name(org_id: &str, team_id: &str) -> String {
    if team_id.is_empty() {
        return String::new();
    }
    infra::table::oncall_teams::get_cached(org_id, team_id)
        .await
        .ok()
        .flatten()
        .map_or_else(|| team_id.to_string(), |t| t.name)
}

#[cfg(not(feature = "enterprise"))]
async fn team_name(_org_id: &str, team_id: &str) -> String {
    team_id.to_string()
}

/// The incident the alert's firing is in, unless a downtime mutes it (then it is the mute's).
#[cfg(feature = "enterprise")]
async fn incident_of(target: &AckTarget) -> Result<Option<String>, AckError> {
    let Some(id) = firing_incident_checked(&target.org_id, &target.alert_id).await? else {
        return Ok(None);
    };
    Ok(infra::table::alert_incidents::get(&target.org_id, &id)
        .await?
        .filter(|m| m.muted_by_downtime_id.is_none())
        .map(|_| id))
}

#[cfg(not(feature = "enterprise"))]
async fn incident_of(_target: &AckTarget) -> Result<Option<String>, AckError> {
    Ok(None)
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

    fn firing(group: &str, holder: Option<&str>, named: bool) -> HeldRecord {
        HeldRecord {
            record: AckRecord::Firing {
                alert_id: "a1".into(),
                group_key: group.into(),
                firing_started_at: 100,
            },
            holder: holder.map(str::to_string),
            named,
        }
    }

    fn incident(holder: Option<&str>) -> HeldRecord {
        HeldRecord {
            record: AckRecord::Incident {
                incident_id: "i1".into(),
            },
            holder: holder.map(str::to_string),
            named: true,
        }
    }

    fn page(id: &str, acked_by: Option<&str>) -> OpenPage {
        OpenPage {
            response_id: id.into(),
            team: format!("team-{id}"),
            acked_by: acked_by.map(str::to_string),
            current: true,
        }
    }

    /// A page left open by an earlier firing of the same alert.
    fn leftover(id: &str, acked_by: Option<&str>) -> OpenPage {
        OpenPage {
            current: false,
            ..page(id, acked_by)
        }
    }

    fn facts_for(verb: Verb, records: Vec<HeldRecord>, pages: Vec<OpenPage>) -> PlanFacts {
        PlanFacts {
            verb,
            actor: "bo@acme.io".into(),
            records,
            other_groups_unacked: 0,
            other_holders: vec![],
            pages,
        }
    }

    fn claim(r: &HeldRecord) -> (AckRecord, RecordWrite) {
        (r.record.clone(), RecordWrite::Claim)
    }

    #[test]
    fn the_plan_decides_every_write_and_page_step_of_each_verb() {
        use PageStep::{Leave, MoveTo, Restart};
        let stop = |by: &str| PageStep::Stop { by: by.into() };
        let ana = Some("ana@acme.io");
        let moved = |r: &HeldRecord| {
            (
                r.record.clone(),
                RecordWrite::Move {
                    from: "ana@acme.io".into(),
                },
            )
        };
        let cleared = |r: &HeldRecord| {
            (
                r.record.clone(),
                RecordWrite::Clear {
                    holder: "ana@acme.io".into(),
                },
            )
        };
        let from_ana = || MoveTo {
            from: "ana@acme.io".into(),
        };
        let restart = || Restart {
            holder: "ana@acme.io".into(),
        };
        let still = |id: &str| StillPaging {
            response_id: id.into(),
            team: format!("team-{id}"),
        };
        let one_of_three = PlanFacts {
            other_groups_unacked: 2,
            ..facts_for(
                Verb::Acknowledge,
                vec![firing("g1", None, true)],
                vec![page("p1", None)],
            )
        };
        let holder_keeps_another_group = PlanFacts {
            other_holders: vec!["ANA@acme.io".into()],
            ..facts_for(
                Verb::TakeOver,
                vec![firing("g1", ana, true)],
                vec![page("p1", ana)],
            )
        };
        #[allow(clippy::type_complexity)]
        let cases: Vec<(
            &str,
            PlanFacts,
            Vec<(AckRecord, RecordWrite)>,
            Vec<(&str, PageStep)>,
            Vec<StillPaging>,
            Answer,
        )> = vec![
            (
                "a free firing is claimed and its page stops",
                facts_for(
                    Verb::Acknowledge,
                    vec![firing("", None, true)],
                    vec![page("p1", None)],
                ),
                vec![claim(&firing("", None, true))],
                vec![("p1", stop("bo@acme.io"))],
                vec![],
                Answer::Changed,
            ),
            (
                "one group of three leaves the page paging",
                one_of_three,
                vec![claim(&firing("g1", None, true))],
                vec![("p1", Leave)],
                vec![still("p1")],
                Answer::Changed,
            ),
            (
                "an incident stops its owner and its impacted page",
                facts_for(
                    Verb::Acknowledge,
                    vec![incident(None), firing("", None, false)],
                    vec![page("owner", None), page("impacted", None)],
                ),
                vec![claim(&incident(None)), claim(&firing("", None, false))],
                vec![
                    ("owner", stop("bo@acme.io")),
                    ("impacted", stop("bo@acme.io")),
                ],
                vec![],
                Answer::Changed,
            ),
            (
                "held by someone else writes nothing and finishes the holder's stops as the holder",
                facts_for(
                    Verb::Acknowledge,
                    vec![incident(ana), firing("", ana, false)],
                    vec![page("p1", None)],
                ),
                vec![],
                vec![("p1", stop("ana@acme.io"))],
                vec![],
                Answer::HeldBy("ana@acme.io".into()),
            ),
            (
                "the holder's retry stops the page a failed stop left paging",
                facts_for(
                    Verb::Acknowledge,
                    vec![firing("", Some("Bo@acme.io"), true)],
                    vec![page("p1", None)],
                ),
                vec![],
                vec![("p1", stop("bo@acme.io"))],
                vec![],
                Answer::AlreadyYours,
            ),
            (
                "a take over moves every record and page",
                facts_for(
                    Verb::TakeOver,
                    vec![incident(ana), firing("", ana, false)],
                    vec![page("owner", ana), page("impacted", ana)],
                ),
                vec![moved(&incident(ana)), moved(&firing("", ana, false))],
                vec![("owner", from_ana()), ("impacted", from_ana())],
                vec![],
                Answer::Changed,
            ),
            (
                "a page stays with a holder who still acks another group",
                holder_keeps_another_group,
                vec![moved(&firing("g1", ana, true))],
                vec![("p1", Leave)],
                vec![],
                Answer::Changed,
            ),
            (
                "an unack clears every record and restarts the pages it stopped",
                facts_for(
                    Verb::Unack,
                    vec![incident(ana), firing("", ana, false)],
                    vec![page("owner", ana), page("paging", None)],
                ),
                vec![cleared(&incident(ana)), cleared(&firing("", ana, false))],
                vec![("owner", restart()), ("paging", Leave)],
                vec![],
                Answer::Changed,
            ),
            (
                "a hand-off clears the records and leaves the pages to the hand-off",
                facts_for(
                    Verb::HandOff,
                    vec![firing("", ana, true)],
                    vec![page("owner", ana)],
                ),
                vec![cleared(&firing("", ana, true))],
                vec![("owner", Leave)],
                vec![],
                Answer::Changed,
            ),
            (
                "an unack with nothing held still restarts the page an ack stopped",
                facts_for(
                    Verb::Unack,
                    vec![firing("", None, true)],
                    vec![page("p1", ana)],
                ),
                vec![],
                vec![("p1", restart())],
                vec![],
                Answer::NotHeld,
            ),
            (
                "D34: an unack restarts only the current firing's page",
                facts_for(
                    Verb::Unack,
                    vec![firing("", ana, true)],
                    vec![page("now", ana), leftover("old", ana)],
                ),
                vec![cleared(&firing("", ana, true))],
                vec![("now", restart()), ("old", Leave)],
                vec![],
                Answer::Changed,
            ),
            (
                "D34: a take over moves only the current firing's page",
                facts_for(
                    Verb::TakeOver,
                    vec![firing("", ana, true)],
                    vec![page("now", ana), leftover("old", ana)],
                ),
                vec![moved(&firing("", ana, true))],
                vec![("now", from_ana()), ("old", Leave)],
                vec![],
                Answer::Changed,
            ),
            (
                "D34: an ack still stops a leftover page",
                facts_for(
                    Verb::Acknowledge,
                    vec![firing("", None, true)],
                    vec![leftover("old", None)],
                ),
                vec![claim(&firing("", None, true))],
                vec![("old", stop("bo@acme.io"))],
                vec![],
                Answer::Changed,
            ),
            (
                "a hand-off with nothing held leaves the page to the hand-off",
                facts_for(Verb::HandOff, vec![], vec![page("p1", ana)]),
                vec![],
                vec![("p1", Leave)],
                vec![],
                Answer::NotHeld,
            ),
            (
                "nothing firing still stops the open page",
                facts_for(
                    Verb::Acknowledge,
                    vec![],
                    vec![page("p1", None), page("p2", ana)],
                ),
                vec![],
                vec![("p1", stop("bo@acme.io")), ("p2", Leave)],
                vec![],
                Answer::NothingFiring,
            ),
        ];
        for (name, facts, writes, pages, still_paging, answer) in cases {
            let got = plan(&facts);
            assert_eq!(got.writes, writes, "{name}");
            let pages: Vec<(String, PageStep)> = pages
                .into_iter()
                .map(|(id, step)| (id.to_string(), step))
                .collect();
            assert_eq!(got.pages, pages, "{name}");
            assert_eq!(got.still_paging, still_paging, "{name}");
            assert_eq!(got.answer, answer, "{name}");
        }
    }

    #[test]
    fn a_mute_snoozes_its_pages_for_its_whole_minutes_up_to_a_day() {
        const MINUTE: i64 = 60 * 1_000_000;
        for (until, minutes) in [
            (30 * MINUTE, 30),
            (30 * MINUTE + 1, 31),
            (0, 1),
            (48 * 60 * MINUTE, 24 * 60),
        ] {
            assert_eq!(snooze_minutes(until, 0), minutes, "{until}");
        }
    }

    #[test]
    fn a_page_names_its_source_without_the_group_or_impacted_suffix() {
        for (page_source, source) in [
            ("a1", "a1"),
            ("a1:group:host=web-1", "a1"),
            ("i1:impacted:team_2", "i1"),
            ("a1:group:host=web-1:impacted:team_2", "a1"),
        ] {
            assert_eq!(source_of_page(page_source), source, "{page_source}");
        }
    }
}
