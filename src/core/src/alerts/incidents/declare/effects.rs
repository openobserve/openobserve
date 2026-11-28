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

use std::time::Duration;

use config::meta::{
    alerts::{
        incidents::{
            DeclareEffectEntry, DeclareEffectKind, DeclareEffectState, DeclareIntent,
            IncidentSeverity,
        },
        priority::AlertPriority,
        rca_runs::{AutoRunOpts, RunState, RunTrigger},
    },
    oncall::{Response, ResponseEvent, ResponseEventKind, SubjectType},
    triggers::{Trigger, TriggerModule},
};
use infra::{
    db::get_orm_client_rw,
    table::{
        ai_chat_sessions, alert_incidents,
        entity::{alert_incidents::Model as Incident, rca_runs},
        incident_contexts, incident_declare_keys, oncall_responses,
    },
};
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config, super_cluster::queue,
};
use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, QueryOrder};

use super::{DeclareError, DeclareResponse, DeclareRuntime, Prepared, source};
use crate::alerts::incidents::{
    IncidentNotice, RCA_OFF_START_FAILED, RcaLaunch, SYSTEM_USER_EMAIL, admit_automatic_rca,
    apply_incident_to_context, incident_page_url, launch_incident_rca, merge_incident_destinations,
    notice_subject, notify_incident_destination, page_again_after_new_alert_in_records,
    record_new_incident_l0_off, route_new_incident, subject_notification_context,
};

const EFFECT_TIMEOUT: Duration = Duration::from_secs(240);
const CLAIM_TIMEOUT_US: i64 = 5 * 60 * 1_000_000;

pub(super) struct Dispatch<'a> {
    pub org: &'a str,
    pub response: &'a DeclareResponse,
    pub intent: &'a DeclareIntent,
    pub kind: &'a DeclareEffectKind,
}

impl Dispatch<'_> {
    fn priority(&self) -> anyhow::Result<AlertPriority> {
        match self.intent.severity {
            IncidentSeverity::P1 => Ok(AlertPriority::P1),
            IncidentSeverity::P2 => Ok(AlertPriority::P2),
            _ => anyhow::bail!("Declare intent has no page priority"),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RcaRecovery {
    Admit,
    Launch {
        run_id: String,
        session_id: Option<String>,
    },
    Complete,
}

impl RcaRecovery {
    fn of(run: Option<rca_runs::Model>, admitted: bool) -> Self {
        let Some(run) = run else {
            return Self::Admit;
        };
        if admitted {
            return Self::Complete;
        }
        if run.state == RunState::Running.as_str() {
            return Self::Launch {
                run_id: run.run_id,
                session_id: run.session_id,
            };
        }
        if run.state == RunState::Failed.as_str() {
            return Self::Admit;
        }
        Self::Complete
    }
}

pub(super) async fn destinations(
    txn: &DatabaseTransaction,
    incident: &Incident,
) -> anyhow::Result<Vec<String>> {
    let firings = alert_incidents::get_incident_alerts_with(txn, &incident.id).await?;
    Ok(merge_incident_destinations(&incident.org_id, &[], &firings).await)
}

pub(super) async fn record(
    txn: &DatabaseTransaction,
    prepared: &Prepared<'_>,
    incident: &Incident,
    response: &DeclareResponse,
    priority: Option<AlertPriority>,
    team: Option<String>,
    runtime: &impl DeclareRuntime,
) -> Result<(), DeclareError> {
    if (!response.created && priority.is_none())
        || (!prepared.request.page_through_downtime && incident.muted_by_downtime_id.is_some())
    {
        return Ok(());
    }
    let kinds = plan_effects(response, priority, runtime, txn, incident).await?;
    if kinds.is_empty() {
        return Ok(());
    }
    let intent = DeclareIntent {
        transition: source::sha256(prepared.key),
        at: prepared.subject.now,
        title: incident
            .title
            .clone()
            .unwrap_or_else(|| prepared.request.title.clone()),
        severity: prepared.request.severity,
        dimensions: serde_json::from_value(incident.group_values.clone()).unwrap_or_else(|error| {
            log::warn!(
                "[incidents] Cannot read declare dimensions for {}: {error}",
                incident.id
            );
            prepared.subject.groups.clone()
        }),
        request_dimensions: prepared.subject.groups.clone(),
        team,
        source_less_guidance: if response.context_id.is_none() {
            prepared.note.clone()
        } else {
            None
        },
        page_through_downtime: prepared.request.page_through_downtime,
        reopen_count: incident.reopen_count,
        effects: kinds
            .into_iter()
            .map(|kind| DeclareEffectEntry {
                kind,
                state: DeclareEffectState::Pending,
                possible_duplicate: false,
            })
            .collect(),
    };
    incident_declare_keys::set_effects_in(txn, &incident.org_id, prepared.key, &intent).await?;
    Ok(())
}

pub(super) async fn resume(
    org: &str,
    key: &str,
    response: &DeclareResponse,
    runtime: &impl DeclareRuntime,
) {
    if let Err(error) = resume_intent(org, key, response, runtime).await {
        log::error!(
            "[incidents] Declare effects {org}/{}: {error:#}",
            response.incident_id
        );
    }
}

pub(super) async fn dispatch(effect: Dispatch<'_>) -> anyhow::Result<()> {
    match effect.kind {
        DeclareEffectKind::Page => page(&effect).await,
        DeclareEffectKind::Rca => start_rca(&effect).await,
        DeclareEffectKind::Notify { destination } => notify(&effect, destination).await,
    }
}

pub(super) async fn resume_impacted_openings(
    org: &str,
    origin_id: &str,
    now: i64,
) -> anyhow::Result<()> {
    for record in oncall_responses::list_impacted(org, origin_id).await? {
        if !record.state.is_escalating() {
            continue;
        }
        let events = oncall_responses::list_events_and_deliveries(&record.id).await?;
        if !needs_impacted_opening(&record, &events) {
            continue;
        }
        publish_impacted_delivery_state(&record, events).await?;
        db::scheduler::push(Trigger {
            org: org.to_owned(),
            module: TriggerModule::OncallEscalation,
            module_key: record.id,
            next_run_at: now,
            ..Default::default()
        })
        .await?;
    }
    Ok(())
}

pub(super) async fn rca_recovery(org: &str, id: &str) -> anyhow::Result<RcaRecovery> {
    let db = get_orm_client_rw().await;
    let prior = rca_runs::Entity::find()
        .filter(rca_runs::Column::OrgId.eq(org))
        .filter(rca_runs::Column::IncidentId.eq(id))
        .filter(rca_runs::Column::Trigger.eq(RunTrigger::AutoNewIncident.as_str()))
        .order_by_desc(rca_runs::Column::StartedAt)
        .order_by_desc(rca_runs::Column::RunId)
        .one(db)
        .await?;
    let session = prior.as_ref().and_then(|run| run.session_id.as_deref());
    let admitted = match session {
        Some(session) => ai_chat_sessions::get_with(db, org, session)
            .await?
            .is_some_and(|row| row.last_turn_id.is_some()),
        None => false,
    };
    Ok(RcaRecovery::of(prior, admitted))
}

async fn plan_effects(
    response: &DeclareResponse,
    priority: Option<AlertPriority>,
    runtime: &impl DeclareRuntime,
    txn: &DatabaseTransaction,
    incident: &Incident,
) -> anyhow::Result<Vec<DeclareEffectKind>> {
    let mut kinds = Vec::new();
    if priority.is_some() {
        if runtime.oncall_enabled() {
            kinds.push(DeclareEffectKind::Page);
        }
        if response.created {
            kinds.push(DeclareEffectKind::Rca);
        }
    }
    kinds.extend(
        runtime
            .destinations(txn, incident)
            .await?
            .into_iter()
            .map(|destination| DeclareEffectKind::Notify { destination }),
    );
    Ok(kinds)
}

async fn resume_intent(
    org: &str,
    key: &str,
    response: &DeclareResponse,
    runtime: &impl DeclareRuntime,
) -> anyhow::Result<()> {
    let Some(intent) = incident_declare_keys::get_intent(org, key).await? else {
        return Ok(());
    };
    for entry in &intent.effects {
        if entry.state == DeclareEffectState::Complete {
            continue;
        }
        let effect = Dispatch {
            org,
            response,
            intent: &intent,
            kind: &entry.kind,
        };
        if !run_claim(key, effect, runtime).await? {
            break;
        }
    }
    Ok(())
}

async fn run_claim(
    key: &str,
    effect: Dispatch<'_>,
    runtime: &impl DeclareRuntime,
) -> anyhow::Result<bool> {
    let id = &effect.response.incident_id;
    let org = effect.org;
    let transition = &effect.intent.transition;
    let kind = effect.kind;
    let may_duplicate = matches!(kind, DeclareEffectKind::Notify { .. });
    let claimed = incident_declare_keys::mutate_intent(org, key, |intent| {
        let entry = intent
            .effects
            .iter_mut()
            .find(|entry| &entry.kind == kind)?;
        let at = runtime.now();
        let claim = DeclareEffectState::Claimed { at };
        match entry.state {
            DeclareEffectState::Complete => return None,
            DeclareEffectState::Claimed { at: prior } => {
                if at.saturating_sub(prior) < CLAIM_TIMEOUT_US {
                    return None;
                }
                entry.possible_duplicate |= may_duplicate;
            }
            DeclareEffectState::Pending => {}
        }
        entry.state = claim;
        Some((claim, entry.possible_duplicate))
    })
    .await?;
    let Some((claim, possible_duplicate)) = claimed else {
        return Ok(false);
    };
    let result = tokio::time::timeout(
        EFFECT_TIMEOUT,
        run_current(effect, possible_duplicate, runtime),
    )
    .await;
    let completed = match result {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            log::warn!("[incidents] Declare effect {kind:?} {org}/{id} ({transition}): {error:#}");
            false
        }
        Err(error) => {
            log::warn!("[incidents] Declare effect {kind:?} {org}/{id} ({transition}): {error}");
            false
        }
    };
    incident_declare_keys::mutate_intent(org, key, |intent| {
        let entry = intent
            .effects
            .iter_mut()
            .find(|entry| &entry.kind == kind)?;
        if entry.state != claim {
            return None;
        }
        entry.state = if completed {
            DeclareEffectState::Complete
        } else {
            DeclareEffectState::Pending
        };
        entry.possible_duplicate |= !completed && may_duplicate;
        Some(())
    })
    .await?;
    Ok(true)
}

async fn run_current(
    effect: Dispatch<'_>,
    possible_duplicate: bool,
    runtime: &impl DeclareRuntime,
) -> anyhow::Result<()> {
    let id = &effect.response.incident_id;
    let Some(incident) = alert_incidents::get_rw(effect.org, id).await? else {
        return Ok(());
    };
    if matches!(
        effect.kind,
        DeclareEffectKind::Page | DeclareEffectKind::Rca
    ) && (!matches!(incident.status.as_str(), "open" | "acknowledged")
        || incident.reopen_count != effect.intent.reopen_count
        || incident.merged_into_id.is_some())
    {
        return Ok(());
    }
    if !effect.intent.page_through_downtime
        && (incident.muted_by_downtime_id.is_some() || declare_downtime(&effect, runtime))
    {
        return Ok(());
    }
    if matches!(effect.kind, DeclareEffectKind::Page) && !runtime.oncall_enabled() {
        return Ok(());
    }
    if possible_duplicate {
        log::warn!(
            "[incidents] possible_duplicate for declare effect {:?} {}/{id} ({})",
            effect.kind,
            effect.org,
            effect.intent.transition
        );
    }
    runtime.run_effect(effect).await
}

fn declare_downtime(effect: &Dispatch<'_>, runtime: &impl DeclareRuntime) -> bool {
    runtime
        .muted_downtime(effect.org, &effect.intent.request_dimensions, runtime.now())
        .is_some()
}

async fn page(effect: &Dispatch<'_>) -> anyhow::Result<()> {
    let result = oncall_responses::with_declared_incident_episode(
        effect.org,
        &effect.response.incident_id,
        effect.intent.reopen_count,
        page_in_episode(effect),
    )
    .await;
    match result {
        Err(error)
            if error
                .chain()
                .any(|cause| cause.is::<oncall_responses::DeclaredIncidentEpisodeChanged>()) =>
        {
            Ok(())
        }
        result => result,
    }
}

async fn page_in_episode(effect: &Dispatch<'_>) -> anyhow::Result<()> {
    let org = effect.org;
    let id = &effect.response.incident_id;
    let origin = incident_page_record(org, id).await?;
    if let Some(origin) = origin
        && (effect.response.created || origin.opened_at >= effect.intent.at)
    {
        if origin.state.is_terminal() {
            return Ok(());
        }
        if origin.incident_id.as_deref() != Some(id) {
            oncall_responses::attach_incident(org, &origin.id, id).await?;
        }
        resume_impacted_openings(org, &origin.id, config::utils::time::now_micros()).await?;
        return crate::alerts::scheduler::handlers::page_blast_radius(
            org,
            &origin,
            &effect.intent.dimensions,
        )
        .await;
    }
    if !effect.response.created {
        let records = oncall_responses::list_for_incident(org, id).await?;
        if records.iter().any(|record| !record.state.is_terminal()) {
            return page_again_after_new_alert_in_records(org, &records, Some(effect.intent.at))
                .await;
        }
    }
    let routed = route_new_incident(
        org,
        id,
        &effect.intent.title,
        effect.priority()?,
        effect.intent.team.as_deref(),
        &effect.intent.dimensions,
    )
    .await;
    if let Some(error) = routed.error.or(routed.impacted_error) {
        return Err(error);
    }
    Ok(())
}

async fn publish_impacted_delivery_state(
    record: &Response,
    events: Vec<ResponseEvent>,
) -> anyhow::Result<()> {
    if config::get_config().common.local_mode || !get_o2_config().super_cluster.enabled {
        return Ok(());
    }
    // The receiving scheduler needs the response and delivery claims before it can run the job.
    queue::oncall_response_put(record.clone()).await?;
    for event in events.into_iter().filter(|event| {
        event.run() == record.current_run()
            && matches!(
                event.kind,
                ResponseEventKind::Page | ResponseEventKind::Delivery
            )
    }) {
        queue::oncall_response_event_put(&record.org_id, &record.id, event).await?;
    }
    Ok(())
}

fn needs_impacted_opening(record: &Response, events: &[ResponseEvent]) -> bool {
    let run = record.current_run();
    let pending = events
        .iter()
        .any(|event| event.run() == run && event.is_pending_delivery());
    pending
        || (!record.is_exhausted()
            && !events.iter().any(|event| {
                event.kind == ResponseEventKind::Page
                    && event.run() == run
                    && !event.is_unreached_rung(run)
            }))
}

async fn incident_page_record(org: &str, id: &str) -> anyhow::Result<Option<Response>> {
    Ok(
        oncall_responses::history_for_source(org, SubjectType::Incident, id, 1)
            .await?
            .into_iter()
            .next(),
    )
}

async fn start_rca(effect: &Dispatch<'_>) -> anyhow::Result<()> {
    let org = effect.org;
    let id = &effect.response.incident_id;
    let db = get_orm_client_rw().await;
    let recovery = rca_recovery(org, id).await?;
    if recovery == RcaRecovery::Complete {
        return Ok(());
    }
    let guidance = match &effect.response.context_id {
        Some(cid) => incident_contexts::get(db, org, id, cid)
            .await?
            .and_then(|row| row.note),
        None => effect.intent.source_less_guidance.clone(),
    };
    let (run_id, session) = match recovery {
        RcaRecovery::Launch { run_id, session_id } => (run_id, session_id),
        RcaRecovery::Admit => {
            let Some(run_id) = admit_declared_rca(effect, guidance.clone()).await? else {
                return Ok(());
            };
            (run_id, None)
        }
        RcaRecovery::Complete => return Ok(()),
    };
    launch_declared_rca(effect, run_id, session, guidance).await
}

async fn admit_declared_rca(
    effect: &Dispatch<'_>,
    guidance: Option<String>,
) -> anyhow::Result<Option<String>> {
    let org = effect.org;
    let id = &effect.response.incident_id;
    let routed = incident_page_record(org, id).await?;
    let priority = effect.priority()?;
    let route = effect.intent.team.as_deref().map(|team| (team, priority));
    if record_new_incident_l0_off(org, id, routed.as_ref(), route).await? {
        return Ok(None);
    }
    let trigger = RunTrigger::AutoNewIncident;
    match admit_automatic_rca(
        org,
        id,
        trigger,
        &AutoRunOpts::for_trigger(trigger),
        guidance,
    )
    .await
    {
        Ok(run) => Ok(Some(run)),
        Err(skipped) => {
            anyhow::ensure!(
                skipped.off_reason() != Some(RCA_OFF_START_FAILED),
                "Declared incident analysis did not start"
            );
            Ok(None)
        }
    }
}

async fn launch_declared_rca(
    effect: &Dispatch<'_>,
    run_id: String,
    session: Option<String>,
    guidance: Option<String>,
) -> anyhow::Result<()> {
    let launch = RcaLaunch {
        trigger: RunTrigger::AutoNewIncident,
        user_email: SYSTEM_USER_EMAIL.to_owned(),
        build_on_previous: false,
        usage_permit: None,
        guidance,
        resume: None,
    };
    let admitted = launch_incident_rca(
        effect.org.to_owned(),
        effect.response.incident_id.clone(),
        run_id.clone(),
        launch,
        session,
    )
    .await
    .map_err(|error| anyhow::anyhow!("Declare RCA turn admission: {}", error.error_code()))?;
    if admitted.is_none() {
        let run = infra::table::rca_runs::get_rw(effect.org, &run_id).await?;
        anyhow::ensure!(
            run.is_some_and(|run| run.state != RunState::Running.as_str()),
            "Declare RCA has no admitted turn or recorded refusal"
        );
    }
    Ok(())
}

async fn notify(effect: &Dispatch<'_>, destination: &str) -> anyhow::Result<()> {
    use crate::alerts::notifications::notify::NotifyError;
    let id = &effect.response.incident_id;
    let org = effect.org;
    let intent = effect.intent;
    let event = if effect.response.created {
        "new_incident_created"
    } else {
        "severity_escalated"
    };
    let cfg = config::get_config();
    let url = incident_page_url(&cfg.common.web_url, &cfg.common.base_uri, org, id);
    let service = intent
        .dimensions
        .get("service_name")
        .or_else(|| intent.dimensions.get("service"));
    let notice = IncidentNotice {
        org_id: org,
        incident_id: id,
        event,
        title: &intent.title,
        severity: intent.severity.as_str(),
        service_name: service.map_or("", String::as_str),
        incident_url: &url,
    };
    let mut context = subject_notification_context(org, &intent.title, intent.at).await;
    apply_incident_to_context(&mut context, &notice);
    let subject = notice_subject(None, event, &intent.title);
    match notify_incident_destination(org, destination, &[], &subject, &mut context).await {
        Ok(_) | Err(NotifyError::Skipped(_)) => Ok(()),
        Err(error) => Err(error.into()),
    }
}
