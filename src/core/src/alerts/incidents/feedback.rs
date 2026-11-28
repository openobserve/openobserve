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

use std::{
    future::Future,
    sync::{Arc, LazyLock},
};

use config::{
    meta::{
        alerts::incidents::{Incident, IncidentEvent, IncidentEventType},
        oncall::{ResolutionCause, Response},
        self_reporting::llm_scores::{
            LlmScoreDataLevel, LlmScoreDataSourceType, LlmScoreDataType, LlmScoreRecord,
            LlmScoreTargetScope,
        },
    },
    utils::time::now_micros,
};
use dashmap::DashMap;
pub use infra::table::entity::rca_feedback::Model as Feedback;
use infra::{
    db::get_orm_client_rw,
    table::{
        alert_incidents,
        entity::{alert_incidents::Model as IncidentRow, rca_runs::Model as Run},
        incident_events, oncall_responses, rca_feedback, rca_runs,
    },
};
use sea_orm::{
    ActiveModelTrait, ConnectionTrait, DatabaseConnection, DatabaseTransaction, DbErr, Set,
    TransactionTrait,
};
use serde::Deserialize;
use tokio::sync::Mutex;
use utoipa::ToSchema;

use super::IncidentNotice;
use crate::alerts::notifications::{
    NotificationContext,
    notify::{self, NotifyError, Resolved},
};

const MAX_CAUSE_CHARS: usize = 1000;
static CAUSE_NOTICE_SLOTS: LazyLock<DashMap<(String, String), Arc<Mutex<()>>>> =
    LazyLock::new(DashMap::new);

#[derive(Debug, thiserror::Error)]
pub enum FeedbackError {
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("Incident or run not found")]
    NotFound,
    #[error("Security case access denied")]
    CaseAccessDenied,
    #[error(transparent)]
    Database(#[from] DbErr),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Clone, Copy)]
pub struct FeedbackActor<'a> {
    pub email: &'a str,
    pub may_access_cases: bool,
}

#[derive(Clone, Copy)]
pub struct RunKey<'a> {
    pub org: &'a str,
    pub incident: &'a str,
    pub run: &'a str,
}

#[derive(Clone, Copy, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    Run,
    Hypothesis,
    Evidence,
    Step,
    Action,
}

impl TargetKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Run => "run",
            Self::Hypothesis => "hypothesis",
            Self::Evidence => "evidence",
            Self::Step => "step",
            Self::Action => "action",
        }
    }

    fn accepts(self, verdict: &str) -> bool {
        match self {
            Self::Run => matches!(verdict, "correct" | "partly" | "wrong" | "cannot_tell"),
            Self::Hypothesis => matches!(verdict, "accept" | "reject"),
            Self::Evidence => matches!(verdict, "relevant" | "irrelevant" | "wrong_data"),
            Self::Step => matches!(verdict, "verified" | "wrong"),
            Self::Action => matches!(verdict, "helped" | "no_effect" | "not_tried"),
        }
    }

    fn valid_id(self, id: &str) -> bool {
        if id.len() > 32 {
            return false;
        }
        match self {
            Self::Run => id.is_empty(),
            Self::Hypothesis => id.strip_prefix('h').is_some_and(is_index),
            Self::Evidence => id.strip_prefix('e').is_some_and(is_index),
            Self::Step | Self::Action => is_index(id),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct FeedbackRequest {
    pub target_kind: TargetKind,
    pub target_id: String,
    pub verdict: String,
    pub cause_class: Option<ResolutionCause>,
    pub actual_cause: Option<String>,
    pub note: Option<String>,
}

impl FeedbackRequest {
    fn validate(&self) -> Result<(), FeedbackError> {
        if !self.target_kind.valid_id(&self.target_id) {
            return Err(FeedbackError::BadRequest(
                "Invalid target_id for target_kind",
            ));
        }
        if !self.target_kind.accepts(&self.verdict) {
            return Err(FeedbackError::BadRequest("Invalid verdict for target_kind"));
        }
        if self.actual_cause.as_deref().is_some_and(cause_too_long) {
            return Err(FeedbackError::BadRequest(
                "actual_cause exceeds 1000 characters",
            ));
        }
        Ok(())
    }

    fn into_row(self, run: Run, incident: &str, actor: &str, now: i64) -> Feedback {
        Feedback {
            id: config::ider::uuid(),
            org_id: run.org_id,
            incident_id: incident.to_owned(),
            run_id: run.run_id,
            target_kind: self.target_kind.as_str().to_owned(),
            target_id: self.target_id,
            verdict: self.verdict,
            band: run.confidence,
            outcome: run.outcome,
            cause_class: self.cause_class.map(|cause| cause.as_str().to_owned()),
            actual_cause: self.actual_cause,
            note: self.note,
            author_email: actor.to_owned(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CauseRequest {
    pub cause_class: ResolutionCause,
    pub cause_text: String,
}

#[derive(Debug)]
struct ConfirmedCause {
    incident: IncidentRow,
    transition_id: String,
    destinations: Vec<String>,
    updated: bool,
}

struct CauseFence<'a> {
    db: &'a DatabaseConnection,
    review: &'a ConfirmedCause,
    lost: Option<tokio::sync::watch::Receiver<bool>>,
}

impl<'a> CauseFence<'a> {
    fn new(
        db: &'a DatabaseConnection,
        review: &'a ConfirmedCause,
        lost: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> Self {
        Self { db, review, lost }
    }

    fn check_lease(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.lost.as_ref().is_some_and(|lost| *lost.borrow()),
            "cause confirmation {} lost its incident lease",
            self.review.transition_id
        );
        Ok(())
    }

    async fn check_current(&self) -> anyhow::Result<()> {
        self.check_lease()?;
        let incident = &self.review.incident;
        let transition = &self.review.transition_id;
        anyhow::ensure!(
            incident_events::cause_review_is_current_with(
                self.db,
                &incident.org_id,
                &incident.id,
                transition,
            )
            .await?,
            "cause confirmation {transition} was superseded"
        );
        self.check_lease()
    }
}

struct CauseNoticeSlot((String, String));

impl CauseNoticeSlot {
    fn mutex(&self) -> Arc<Mutex<()>> {
        CAUSE_NOTICE_SLOTS
            .entry(self.0.clone())
            .or_default()
            .clone()
    }
}

impl Drop for CauseNoticeSlot {
    fn drop(&mut self) {
        CAUSE_NOTICE_SLOTS.remove_if(&self.0, |_, mutex| Arc::strong_count(mutex) == 1);
    }
}

pub async fn list(key: RunKey<'_>, may_access_cases: bool) -> Result<Vec<Feedback>, FeedbackError> {
    list_with(get_orm_client_rw().await, key, may_access_cases).await
}

pub async fn post(
    key: RunKey<'_>,
    actor: FeedbackActor<'_>,
    request: FeedbackRequest,
) -> Result<Vec<Feedback>, FeedbackError> {
    post_with(
        get_orm_client_rw().await,
        key,
        actor,
        request,
        async |score| crate::self_reporting::llm_scores_writer::publish(key.org, &[score]).await,
    )
    .await
}

pub async fn confirm(
    org: &str,
    incident: &str,
    actor: FeedbackActor<'_>,
    cause: CauseRequest,
) -> Result<Incident, FeedbackError> {
    let db = get_orm_client_rw().await;
    let review = confirm_with(
        db,
        org,
        incident,
        actor,
        &cause,
        |recipient, subject, mut ctx| async move {
            notify::send(org, &recipient, Some(&subject), &mut ctx)
                .await
                .map(|_| ())
        },
    )
    .await?;
    Ok(super::model_to_incident(review.incident).await?)
}

async fn confirm_with<F>(
    db: &DatabaseConnection,
    org: &str,
    incident: &str,
    actor: FeedbackActor<'_>,
    cause: &CauseRequest,
    dispatch: impl FnMut(Resolved, String, NotificationContext) -> F + Send,
) -> Result<ConfirmedCause, FeedbackError>
where
    F: Future<Output = Result<(), NotifyError>> + Send,
{
    use o2_enterprise::enterprise::oncall::escalation;

    use super::{ClusterIncidentTurns, IncidentTurns};

    let turn = ClusterIncidentTurns.take(org, incident).await?;
    let lost = turn.cluster.as_ref().map(infra::dist_lock::Locker::lost);
    let review = match confirm_in(db, org, incident, actor, cause).await {
        Ok(review) => review,
        Err(error) => {
            turn.end().await;
            return Err(error);
        }
    };
    let fence = CauseFence::new(db, &review, lost);
    let cause_class = cause.cause_class;
    let cause_text = cause.cause_text.as_str();
    cascade_with(db, &review, &fence, |page| async move {
        escalation::resolve(
            org,
            &page.id,
            actor.email,
            Some(cause_class),
            Some(cause_text),
        )
        .await
    })
    .await;
    turn.end().await;
    send_cause_notice(&fence, cause, dispatch).await;
    Ok(review)
}

async fn list_with(
    db: &DatabaseConnection,
    key: RunKey<'_>,
    may_access_cases: bool,
) -> Result<Vec<Feedback>, FeedbackError> {
    let txn = db.begin().await?;
    checked_incident(&txn, key.org, key.incident, may_access_cases).await?;
    require_run(&txn, key).await?;
    let rows = rca_feedback::list_for_run(&txn, key.org, key.incident, key.run).await?;
    txn.commit().await?;
    Ok(rows)
}

async fn post_with(
    db: &DatabaseConnection,
    key: RunKey<'_>,
    actor: FeedbackActor<'_>,
    request: FeedbackRequest,
    publish: impl AsyncFnOnce(LlmScoreRecord) -> anyhow::Result<()>,
) -> Result<Vec<Feedback>, FeedbackError> {
    request.validate()?;
    infra::race_point!("rca_feedback_upsert");
    let txn = db.begin().await?;
    checked_incident(&txn, key.org, key.incident, actor.may_access_cases).await?;
    let run = require_run(&txn, key).await?;
    let score = feedback_score(&run, &request, actor.email);
    let row = request.into_row(run, key.incident, actor.email, score._timestamp);
    let event = IncidentEvent {
        timestamp: row.updated_at,
        seq: 0,
        event_type: IncidentEventType::FeedbackGiven {
            run_id: row.run_id.clone(),
            target_kind: row.target_kind.clone(),
            target_id: row.target_id.clone(),
            verdict: row.verdict.clone(),
            actor: row.author_email.clone(),
        },
    };
    rca_feedback::upsert_in(&txn, row).await?;
    incident_events::append_in(&txn, key.org, key.incident, event).await?;
    let rows = rca_feedback::list_for_run(&txn, key.org, key.incident, key.run).await?;
    txn.commit().await?;

    if let Err(error) = publish(score).await {
        log::warn!(
            "[incidents] RCA feedback score for {}/{}: {error:#}",
            key.org,
            key.run
        );
    }
    Ok(rows)
}

async fn checked_incident(
    txn: &DatabaseTransaction,
    org: &str,
    incident: &str,
    may_access_cases: bool,
) -> Result<IncidentRow, FeedbackError> {
    let row = alert_incidents::get_locked(txn, org, incident)
        .await?
        .ok_or(FeedbackError::NotFound)?;
    if row.security_case && !may_access_cases {
        return Err(FeedbackError::CaseAccessDenied);
    }
    Ok(row)
}

async fn require_run(conn: &impl ConnectionTrait, key: RunKey<'_>) -> Result<Run, FeedbackError> {
    rca_runs::get_with(conn, key.org, key.run)
        .await?
        .filter(|run| run.incident_id.as_deref() == Some(key.incident))
        .ok_or(FeedbackError::NotFound)
}

fn feedback_score(run: &Run, request: &FeedbackRequest, actor: &str) -> LlmScoreRecord {
    let evaluation_key = format!("rca_feedback/{}", request.target_kind.as_str());
    LlmScoreRecord {
        id: config::ider::uuid(),
        org_id: run.org_id.clone(),
        target_scope: LlmScoreTargetScope::Session,
        target_id: run.run_id.clone(),
        name: evaluation_key.clone(),
        evaluation_key,
        score_version: 1,
        session_id: run.session_id.clone(),
        ref_timestamp: Some(run.started_at),
        level: LlmScoreDataLevel::Session,
        value_categorical: Some(request.verdict.clone()),
        data_type: LlmScoreDataType::Categorical,
        source_type: LlmScoreDataSourceType::Feedback,
        author: Some(actor.to_owned()),
        _timestamp: now_micros(),
        ..Default::default()
    }
}

async fn confirm_in(
    db: &DatabaseConnection,
    org: &str,
    incident: &str,
    actor: FeedbackActor<'_>,
    cause: &CauseRequest,
) -> Result<ConfirmedCause, FeedbackError> {
    if cause_too_long(&cause.cause_text) {
        return Err(FeedbackError::BadRequest(
            "cause_text exceeds 1000 characters",
        ));
    }
    let txn = db.begin().await?;
    let row = checked_incident(&txn, org, incident, actor.may_access_cases).await?;
    let now = now_micros();
    let transition_id = config::ider::generate_ulid(now);
    let updated = row.cause_reviewed_at.is_some();
    let destinations = cause_notice_destinations(&txn, org, incident, now).await?;
    let mut active = infra::table::entity::alert_incidents::ActiveModel::from(row);
    active.resolution_cause = Set(Some(cause.cause_class.as_str().to_owned()));
    active.cause_reviewed_by = Set(Some(actor.email.to_owned()));
    active.cause_reviewed_at = Set(Some(now));
    active.updated_at = Set(now);
    let row = active.update(&txn).await?;
    incident_events::append_in(
        &txn,
        org,
        incident,
        IncidentEvent {
            timestamp: now,
            seq: 0,
            event_type: IncidentEventType::CauseReviewed {
                cause_class: cause.cause_class,
                cause_text: cause.cause_text.clone(),
                actor: actor.email.to_owned(),
                transition_id: transition_id.clone(),
            },
        },
    )
    .await?;
    txn.commit().await?;
    Ok(ConfirmedCause {
        incident: row,
        transition_id,
        destinations,
        updated,
    })
}

async fn cause_notice_destinations(
    txn: &DatabaseTransaction,
    org: &str,
    incident: &str,
    now: i64,
) -> Result<Vec<String>, FeedbackError> {
    if let Some(names) = incident_events::cause_notice_destinations_in(txn, org, incident).await? {
        return Ok(names);
    }
    let names = alert_incidents::configured_destinations_with(txn, org, incident).await?;
    incident_events::record_cause_notice_destinations_in(txn, org, incident, now, &names).await?;
    Ok(names)
}

async fn cascade_with<F>(
    db: &DatabaseConnection,
    review: &ConfirmedCause,
    fence: &CauseFence<'_>,
    mut resolve: impl FnMut(Response) -> F + Send,
) where
    F: Future<Output = anyhow::Result<Response>> + Send,
{
    let (org, id) = (&review.incident.org_id, &review.incident.id);
    let pages = match oncall_responses::list_for_incident_with(db, org, id).await {
        Ok(pages) => pages,
        Err(error) => {
            log::warn!("[incidents] on-call records for reviewed cause {org}/{id}: {error}");
            return;
        }
    };
    for page in pages {
        if page.closed_at.is_none() || page.cause.is_some() || page.cause_note.is_some() {
            continue;
        }
        if let Err(error) = fence.check_current().await {
            log::warn!("[incidents] reviewed cause cascade for {org}/{id}: {error:#}");
            return;
        }
        if let Err(error) = oncall_responses::with_closed_causeless_record(
            &page,
            &review.transition_id,
            resolve(page.clone()),
        )
        .await
        {
            log::warn!(
                "[incidents] reviewed cause for on-call record {org}/{}: {error:#}",
                page.id
            );
        }
    }
}

async fn send_cause_notice<F>(
    fence: &CauseFence<'_>,
    cause: &CauseRequest,
    mut dispatch: impl FnMut(Resolved, String, NotificationContext) -> F + Send,
) where
    F: Future<Output = Result<(), NotifyError>> + Send,
{
    let review = fence.review;
    if review.destinations.is_empty() {
        return;
    }
    let incident = &review.incident;
    let title = incident.title.as_deref().unwrap_or(&incident.id);
    let verb = if review.updated {
        "updated"
    } else {
        "confirmed"
    };
    let message = format!(
        "Cause {verb} for {title}: {}. {}",
        cause.cause_class, cause.cause_text
    );
    let org = &incident.org_id;
    let id = &incident.id;
    let mut ctx = super::subject_notification_context(org, title, now_micros()).await;
    super::v2_fields::carry_notice(&mut ctx, &message);
    let cfg = config::get_config();
    let incident_url = super::incident_page_url(&cfg.common.web_url, &cfg.common.base_uri, org, id);
    let service = incident
        .group_values
        .get("service_name")
        .or_else(|| incident.group_values.get("service"));
    super::apply_incident_to_context(
        &mut ctx,
        &IncidentNotice {
            org_id: org,
            incident_id: id,
            event: "cause_reviewed",
            title,
            severity: &incident.severity,
            service_name: service
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default(),
            incident_url: &incident_url,
        },
    );

    for destination in &review.destinations {
        if let Err(error) =
            send_cause_destination(fence, destination, &message, &ctx, &mut dispatch).await
        {
            log::warn!(
                "[incidents] reviewed cause notice for {org}/{id} to {destination}: {error:#}"
            );
        }
    }
}

async fn send_cause_destination<F>(
    fence: &CauseFence<'_>,
    destination: &str,
    subject: &str,
    ctx: &NotificationContext,
    dispatch: &mut (impl FnMut(Resolved, String, NotificationContext) -> F + Send),
) -> anyhow::Result<()>
where
    F: Future<Output = Result<(), NotifyError>> + Send,
{
    let incident = &fence.review.incident;
    let org = &incident.org_id;
    let attempts = infra::scheduler::get_scheduler_max_retries();
    let mut attempt = 1;
    loop {
        let result = match notify::resolve(org, destination, &[], ctx.kind).await {
            Ok(recipient) => {
                let subject = subject.to_owned();
                let notice = ctx.clone();
                // Prevent a stale handoff from overtaking a newer review on this node.
                let slot = CauseNoticeSlot((org.clone(), incident.id.clone()));
                let mutex = slot.mutex();
                let _handoff = mutex.lock().await;
                fence.check_current().await?;
                dispatch(recipient, subject, notice).await
            }
            Err(error) => Err(error),
        };
        let Err(error) = result else {
            return Ok(());
        };
        if !super::retries_incident_notify(&error, attempt, attempts) {
            return Err(error.into());
        }
        log::warn!(
            "[incidents] notify {destination} failed for {org}, attempt {attempt}/{attempts}: {error}"
        );
        attempt += 1;
        tokio::time::sleep(super::INCIDENT_NOTIFY_RETRY_DELAY).await;
    }
}

fn is_index(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn cause_too_long(text: &str) -> bool {
    text.chars().nth(MAX_CAUSE_CHARS).is_some()
}

#[cfg(test)]
mod tests;
