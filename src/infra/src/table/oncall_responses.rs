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

//! Response records and their timelines.

use config::{
    ider,
    meta::oncall::{
        Channel, ResolutionCause, ResponderRole, Response, ResponseEvent, ResponseEventKind,
        ResponseState, SubjectRef, SubjectType, response::FIRST_LADDER_RUN,
    },
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, FromQueryResult, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Select, Set,
    sea_query::{Expr, ExprTrait},
};

use super::entity::{oncall_response_events, oncall_responses};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

/// Rows whose stored discriminants this build cannot interpret are dropped.
/// A record whose state we cannot read must not be shown as `triggered` and
/// re-escalated.
fn to_response(m: oncall_responses::Model) -> Option<Response> {
    let subject_type = SubjectType::from_i32(m.subject_type)?;
    Some(Response {
        subject: SubjectRef::parse(subject_type, &m.subject_id).ok()?,
        state: ResponseState::from_i32(m.state)?,
        id: m.id,
        org_id: m.org_id,
        team_id: m.team_id,
        title: m.title,
        // An unreadable cause degrades to "no cause recorded" rather than
        // taking the whole record down; the note beside it still survives.
        cause: m.cause.as_deref().and_then(ResolutionCause::from_str_opt),
        cause_note: m.cause_note,
        snoozed_until: m.snoozed_until,
        ladder_anchor: m.ladder_anchor,
        ladder_run: m.ladder_run,
        responder_role: ResponderRole::from_i32(m.responder_role).unwrap_or(ResponderRole::Owner),
        origin_response_id: m.origin_response_id,
        priority: m.priority,
        opened_at: m.opened_at,
        acked_by: m.acked_by,
        acked_at: m.acked_at,
        closed_at: m.closed_at,
        incident_id: m.incident_id,
        exhausted_at: m.exhausted_at,
    })
}

fn to_event(m: oncall_response_events::Model) -> Option<ResponseEvent> {
    Some(ResponseEvent {
        kind: ResponseEventKind::from_i32(m.kind)?,
        at: m.at,
        actor: m.actor,
        body: m.body,
        rung_micros: m.rung_micros,
        ladder_run: m.ladder_run,
        recipient: m.recipient,
        // A channel this build cannot name costs the entry its dedup key, not
        // its existence — the same trade as an unreadable rung. The worst case
        // is one page sent twice; dropping the entry would lose the fact that
        // anybody was paged at all.
        channel: m.channel.and_then(Channel::from_i32),
        delivered: m.delivered,
    })
}

/// Opens a record for one firing.
///
/// The unique index on `(org_id, subject_type, subject_id)` is what makes
/// this safe to call from several nodes at once — the second caller gets a
/// constraint violation rather than a duplicate record, and should read the
/// existing one.
pub async fn open(
    org_id: &str,
    subject: &SubjectRef,
    team_id: &str,
    priority: i32,
    title: Option<&str>,
    role: ResponderRole,
    origin_response_id: Option<&str>,
) -> Result<Response, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_responses::ActiveModel {
        id: Set(ider::uuid()),
        org_id: Set(org_id.to_string()),
        subject_type: Set(subject.subject_type.to_i32()),
        subject_id: Set(subject.subject_id()),
        team_id: Set(team_id.to_string()),
        title: Set(title.map(|t| t.to_string())),
        cause: Set(None),
        cause_note: Set(None),
        snoozed_until: Set(None),
        ladder_anchor: Set(None),
        ladder_run: Set(Some(FIRST_LADDER_RUN)),
        responder_role: Set(role.to_i32()),
        origin_response_id: Set(origin_response_id.map(|s| s.to_string())),
        priority: Set(priority),
        state: Set(ResponseState::Triggered.to_i32()),
        opened_at: Set(now_micros()),
        acked_by: Set(None),
        acked_at: Set(None),
        closed_at: Set(None),
        incident_id: Set(None),
        // Copied at open, so the page keeps pointing where the alert pointed
        // when it fired.
        runbook_url: Set(runbook_for(org_id, subject).await),
        exhausted_at: Set(None),
    };
    let inserted = model.insert(client).await?;
    to_response(inserted).ok_or_else(|| {
        Error::DbError(DbError::KeyNotExists(
            "just-inserted response failed to decode".to_string(),
        ))
    })
}

/// Reads the record for a firing, or creates it. Returns `(record, created)`.
pub async fn open_or_get(
    org_id: &str,
    subject: &SubjectRef,
    team_id: &str,
    priority: i32,
    title: Option<&str>,
    role: ResponderRole,
    origin_response_id: Option<&str>,
) -> Result<(Response, bool), errors::Error> {
    if let Some(found) = get_by_subject(org_id, subject).await? {
        return Ok((found, false));
    }
    match open(
        org_id,
        subject,
        team_id,
        priority,
        title,
        role,
        origin_response_id,
    )
    .await
    {
        Ok(created) => Ok((created, true)),
        Err(e) => match get_by_subject(org_id, subject).await? {
            Some(found) => Ok((found, false)),
            None => Err(e),
        },
    }
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .and_then(to_response))
}

pub async fn get_by_subject(
    org_id: &str,
    subject: &SubjectRef,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::SubjectType.eq(subject.subject_type.to_i32()))
        .filter(oncall_responses::Column::SubjectId.eq(subject.subject_id()))
        .one(client)
        .await?
        .and_then(to_response))
}

/// How many times this source has fired, so the next firing gets the next
/// number. Counts records, so it survives restarts and needs no counter row.
pub async fn firing_count(
    org_id: &str,
    subject_type: SubjectType,
    source_id: &str,
) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::SubjectType.eq(subject_type.to_i32()))
        .filter(oncall_responses::Column::SubjectId.starts_with(format!("{source_id}#")))
        .count(client)
        .await?)
}

/// What a list read is asking for.
///
/// A struct rather than a growing argument list because these arrived one at a
/// time and will keep doing so: the alert drawer wants one source, the "Related
/// & past" panels want one owning team, and the known-causes tab wants one
/// cause. Every one of them was previously answered by fetching the org's whole
/// open list and filtering in the client.
#[derive(Debug, Default, Clone)]
pub struct ResponseFilter<'a> {
    pub team_id: Option<&'a str>,
    /// Include closed records.
    pub include_resolved: bool,
    /// Every firing of one alert (or other subject), regardless of firing
    /// number — the alert drawer's Firings tab.
    pub source_id: Option<&'a str>,
    pub subject_type: Option<SubjectType>,
    /// Restrict to these teams. How an ownership-path filter is expressed: the
    /// path names teams, and the record carries a team.
    pub team_ids: Option<Vec<String>>,
    /// What previous firings turned out to be — the known-causes tab.
    pub cause: Option<ResolutionCause>,
}

/// Records nobody has closed yet: what the on-call engineer's home screen
/// shows.
///
/// Acknowledged is included. It is not escalating, but somebody owns it and
/// still has to close it — dropping it here is how a page gets acknowledged
/// into a void.
///
/// Paged, and not optionally: a busy org accumulates hundreds of open records,
/// and this is the first screen somebody loads at 3am. `limit` is required
/// rather than defaulted so no future caller can quietly ask for all of them.
pub async fn list_open(
    org_id: &str,
    filter: &ResponseFilter<'_>,
    limit: u64,
    offset: u64,
) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(open_query(org_id, filter)
        // Most urgent first, then newest — and the id as a final tiebreak,
        // without which two records sharing a priority and an open time could
        // swap places between two pages and be shown twice or not at all.
        .order_by_asc(oncall_responses::Column::Priority)
        .order_by_desc(oncall_responses::Column::OpenedAt)
        .order_by_desc(oncall_responses::Column::Id)
        .limit(limit)
        .offset(offset)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_response)
        .collect())
}

/// How many records the same filter matches, so a paged screen can say what
/// it is a page of. "Showing 50" is not an answer to "how bad is it".
pub async fn count_open(org_id: &str, filter: &ResponseFilter<'_>) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(open_query(org_id, filter).count(client).await?)
}

fn open_query(org_id: &str, filter: &ResponseFilter<'_>) -> Select<oncall_responses::Entity> {
    let mut states = vec![
        ResponseState::Triggered.to_i32(),
        ResponseState::Triaged.to_i32(),
        ResponseState::Acknowledged.to_i32(),
    ];
    // A cause only exists on a closed record, so asking for one and not for
    // resolved records is a filter that can only ever return nothing. Widening
    // rather than refusing keeps "what keeps breaking us" answerable from the
    // same endpoint the open list uses.
    if filter.include_resolved || filter.cause.is_some() {
        states.push(ResponseState::Resolved.to_i32());
    }
    let mut q = oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::State.is_in(states));
    if let Some(t) = filter.team_id {
        q = q.filter(oncall_responses::Column::TeamId.eq(t));
    }
    if let Some(teams) = filter.team_ids.as_ref() {
        // An empty set means "no team owns that path". Answering it with the
        // unfiltered list would report every page in the org as belonging to a
        // path nobody owns, so it is matched literally.
        q = q.filter(oncall_responses::Column::TeamId.is_in(teams.clone()));
    }
    if let Some(source_id) = filter.source_id {
        // Anchored on the `#`, or `al_ck` would match every firing of
        // `al_ckt`.
        q = q.filter(oncall_responses::Column::SubjectId.starts_with(format!("{source_id}#")));
    }
    if let Some(subject_type) = filter.subject_type {
        q = q.filter(oncall_responses::Column::SubjectType.eq(subject_type.to_i32()));
    }
    if let Some(cause) = filter.cause {
        q = q.filter(oncall_responses::Column::Cause.eq(cause.as_str()));
    }
    q
}

/// How often each cause has closed a page, for a team or a whole org.
///
/// The org-level counterpart to `prior_causes`, which groups the firings of one
/// subject. This answers "what keeps breaking us", and it does the counting in
/// the database: the org that most needs the answer is the one with the most
/// rows, and loading them all to tally them in Rust would make the endpoint
/// slowest exactly where it matters.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct CauseCount {
    pub cause: ResolutionCause,
    pub count: i64,
    /// The most recent example, so a row is a link and not just a number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_response_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_cause_note: Option<String>,
    /// Micros. When that example closed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_at: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct CauseTally {
    cause: String,
    count: i64,
}

/// Counts per cause across a closed window, most common first.
///
/// `from`/`to` are micros over `closed_at`, because the question is "what have
/// we been resolving lately" — bucketing on when a page opened would credit a
/// long-running firing to the week it started rather than the week it was
/// understood.
pub async fn cause_breakdown(
    org_id: &str,
    team_id: Option<&str>,
    from: i64,
    to: i64,
) -> Result<Vec<CauseCount>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let base = || {
        let mut q = oncall_responses::Entity::find()
            .filter(oncall_responses::Column::OrgId.eq(org_id))
            .filter(oncall_responses::Column::ClosedAt.gte(from))
            .filter(oncall_responses::Column::ClosedAt.lt(to))
            .filter(oncall_responses::Column::Cause.is_not_null());
        if let Some(t) = team_id {
            q = q.filter(oncall_responses::Column::TeamId.eq(t));
        }
        q
    };

    let tallies: Vec<CauseTally> = base()
        .select_only()
        .column_as(oncall_responses::Column::Cause, "cause")
        .column_as(oncall_responses::Column::Id.count(), "count")
        .group_by(oncall_responses::Column::Cause)
        .into_model::<CauseTally>()
        .all(client)
        .await?;

    let mut out = Vec::with_capacity(tallies.len());
    for tally in tallies {
        // A cause string this build cannot read is dropped rather than shown
        // as some other cause: a miscounted category is worse than a missing
        // one, because nobody can tell it is wrong.
        let Some(cause) = ResolutionCause::from_str_opt(&tally.cause) else {
            continue;
        };
        // One bounded lookup per cause that actually occurred — at most
        // `ResolutionCause::ALL.len()`, each an indexed single row. The
        // alternative, a correlated per-group subquery, is not portable across
        // the three backends this ships on.
        let example = base()
            .filter(oncall_responses::Column::Cause.eq(cause.as_str()))
            .order_by_desc(oncall_responses::Column::ClosedAt)
            .order_by_desc(oncall_responses::Column::Id)
            .one(client)
            .await?;
        out.push(CauseCount {
            cause,
            count: tally.count,
            last_response_id: example.as_ref().map(|e| e.id.clone()),
            last_title: example.as_ref().and_then(|e| e.title.clone()),
            last_cause_note: example.as_ref().and_then(|e| e.cause_note.clone()),
            last_at: example.as_ref().and_then(|e| e.closed_at),
        });
    }
    // Most common first, then most recent — "what keeps breaking us" is a
    // ranking, and ties resolved by recency put the live problem on top.
    out.sort_by(|a, b| b.count.cmp(&a.count).then(b.last_at.cmp(&a.last_at)));
    Ok(out)
}

/// The runbook links for a page of records, keyed by record id.
///
/// A separate read rather than a field on `Response`: the meta type is
/// constructed by the escalation engine in several places, and widening it
/// would be a change to code this surface does not own. One `IN` query per page
/// keeps it to a single round trip regardless of page size.
pub async fn runbook_urls(
    org_id: &str,
    ids: &[String],
) -> Result<std::collections::HashMap<String, String>, errors::Error> {
    if ids.is_empty() {
        return Ok(Default::default());
    }
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::Id.is_in(ids.to_vec()))
        .filter(oncall_responses::Column::RunbookUrl.is_not_null())
        .select_only()
        .column(oncall_responses::Column::Id)
        .column(oncall_responses::Column::RunbookUrl)
        .into_tuple::<(String, Option<String>)>()
        .all(client)
        .await?
        .into_iter()
        .filter_map(|(id, url)| url.map(|u| (id, u)))
        .collect())
}

/// The runbook the alert names, if the subject is an alert that names one.
///
/// Looked up here, at the moment the record opens, so the link is copied onto
/// the page rather than joined at read time. An alert edited or deleted the
/// next morning must not change what a resolved page claimed to point at.
async fn runbook_for(org_id: &str, subject: &SubjectRef) -> Option<String> {
    if subject.subject_type != SubjectType::Alert {
        return None;
    }
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    super::entity::alerts::Entity::find_by_id(subject.source_id.clone())
        .filter(super::entity::alerts::Column::Org.eq(org_id))
        .one(client)
        .await
        .ok()
        .flatten()
        .and_then(|a| a.runbook_url)
        .filter(|u| !u.trim().is_empty())
}

/// Records whose ladder is supposed to still be climbing.
///
/// The reconciliation sweep's input. Oldest first and bounded, because the
/// point of the sweep is to find records that have been sitting there — a
/// record abandoned an hour ago matters more than one abandoned a second ago,
/// and one pass should do a bounded amount of work.
pub async fn list_escalating(org_id: &str, limit: u64) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::State.is_in(escalating_states()))
        .order_by_asc(oncall_responses::Column::OpenedAt)
        .limit(limit)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_response)
        .collect())
}

pub async fn list_by_team(
    org_id: &str,
    team_id: &str,
    limit: u64,
) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::TeamId.eq(team_id))
        .order_by_desc(oncall_responses::Column::OpenedAt)
        .limit(limit)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_response)
        .collect())
}

/// Quiets a record until `until`, without claiming it.
/// Records that the ladder ran out with nobody answering.
///
/// Idempotent: the reconcile sweep and the engine can both reach exhaustion for
/// the same record, and the first instant is the true one. Leaves `state`
/// alone — an exhausted page is still somebody's problem and can still be
/// acknowledged, which is exactly why this is not a state.
pub async fn mark_exhausted(
    org_id: &str,
    id: &str,
    at: i64,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    if existing.exhausted_at.is_some() {
        return Ok(to_response(existing));
    }
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.exhausted_at = Set(Some(at));
    Ok(to_response(model.update(client).await?))
}

pub async fn snooze(
    org_id: &str,
    id: &str,
    from: i64,
    until: i64,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let (existing_anchor, opened_at, already_quiet_until) = (
        existing.ladder_anchor,
        existing.opened_at,
        existing.snoozed_until,
    );
    let mut model: oncall_responses::ActiveModel = existing.into();
    let anchor = config::meta::oncall::response::snoozed_ladder_anchor(
        existing_anchor,
        opened_at,
        already_quiet_until,
        from,
        until,
    );
    model.snoozed_until = Set(Some(until));
    model.ladder_anchor = Set(Some(anchor));
    Ok(to_response(model.update(client).await?))
}

/// Writes a new severity onto an open record.
///
/// The severity is what SLO reporting, digests and the post-incident review
/// read as truth, so the only caller is the escalation engine applying a
/// ratcheted promotion — the value handed here is `SeverityDecision::applied`,
/// never a verdict's raw suggestion.
pub async fn set_priority(
    org_id: &str,
    id: &str,
    priority: i32,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.priority = Set(priority);
    Ok(to_response(model.update(client).await?))
}

/// Moves a record to another team and starts its ladder again.
///
/// Clearing the ack is what makes a handoff a real transfer: the page is open
/// again for the receiving team, and the ladder restarts under their rotation.
/// The timeline is deliberately NOT cleared — who was paged before is history
/// the new team needs — which is exactly why the run number moves instead. The
/// old team's pages stay readable while ceasing to count as this team's ledger;
/// without that, the first tick after the handoff finds every rung already sent
/// and the receiving team is never paged at all.
pub async fn reassign_team(
    org_id: &str,
    id: &str,
    to_team_id: &str,
    now: i64,
) -> Result<Option<Response>, errors::Error> {
    hand_over(org_id, id, Some(to_team_id), now).await
}

/// Hands a record to somebody on the same team, starting its ladder again.
///
/// Same transfer semantics as [`reassign_team`], minus the team change: the
/// recipient is paged from the first rung, and the page keeps climbing if they
/// never answer.
pub async fn restart_ladder(
    org_id: &str,
    id: &str,
    now: i64,
) -> Result<Option<Response>, errors::Error> {
    hand_over(org_id, id, None, now).await
}

async fn hand_over(
    org_id: &str,
    id: &str,
    to_team_id: Option<&str>,
    now: i64,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let Some(current) = to_response(existing.clone()) else {
        return Ok(None);
    };
    // What a handoff does to a record is a decision, and it is made in one
    // place: `Response::handed_over`. This only writes down what it decided.
    let next = current.handed_over(to_team_id, now);
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.team_id = Set(next.team_id.clone());
    model.state = Set(next.state.to_i32());
    model.acked_by = Set(next.acked_by.clone());
    model.acked_at = Set(next.acked_at);
    model.snoozed_until = Set(next.snoozed_until);
    model.ladder_anchor = Set(next.ladder_anchor);
    model.ladder_run = Set(next.ladder_run);
    // Cleared by `handed_over` because the new run has rungs left. Written
    // here, or the decision would be made and then thrown away.
    model.exhausted_at = Set(next.exhausted_at);
    Ok(to_response(model.update(client).await?))
}

/// Records opened because `origin_id` fired — the impacted teams.
pub async fn list_impacted(org_id: &str, origin_id: &str) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::OriginResponseId.eq(origin_id))
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_response)
        .collect())
}

/// The newest still-open record for a source, if any.
///
/// Recovery closes THIS rather than every record for the source: an older
/// firing that a human already resolved must stay resolved, with its own
/// cause intact.
pub async fn latest_open_for_source(
    org_id: &str,
    subject_type: SubjectType,
    source_id: &str,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::SubjectType.eq(subject_type.to_i32()))
        .filter(oncall_responses::Column::SubjectId.starts_with(format!("{source_id}#")))
        .filter(oncall_responses::Column::State.is_in([
            ResponseState::Triggered.to_i32(),
            ResponseState::Triaged.to_i32(),
            ResponseState::Acknowledged.to_i32(),
        ]))
        .order_by_desc(oncall_responses::Column::OpenedAt)
        .one(client)
        .await?
        .and_then(to_response))
}

/// Every past firing of the same source, newest first — the "this fired
/// before, and here is what it was" history.
pub async fn history_for_source(
    org_id: &str,
    subject_type: SubjectType,
    source_id: &str,
    limit: u64,
) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::SubjectType.eq(subject_type.to_i32()))
        .filter(oncall_responses::Column::SubjectId.starts_with(format!("{source_id}#")))
        .order_by_desc(oncall_responses::Column::OpenedAt)
        .limit(limit)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_response)
        .collect())
}

/// Acknowledges a record. Returns `None` if it is gone, and the unchanged
/// record if somebody already took it.
///
/// First ack wins, and it is decided by the database rather than by this
/// process: the state filter is part of the UPDATE, so of two responders
/// clicking at once exactly one row is written and the loser reads back who
/// actually has the ball. Read-then-write would let both pass the check and
/// the second one overwrite the first.
///
/// The same filter is what stops the escalation engine paging a record that
/// was acknowledged while it was resolving a schedule and talking to SMTP.
pub async fn acknowledge(
    org_id: &str,
    id: &str,
    user_email: &str,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    oncall_responses::Entity::update_many()
        .col_expr(
            oncall_responses::Column::State,
            Expr::value(ResponseState::Acknowledged.to_i32()),
        )
        .col_expr(
            oncall_responses::Column::AckedBy,
            Expr::value(user_email.to_string()),
        )
        .col_expr(oncall_responses::Column::AckedAt, Expr::value(now_micros()))
        .filter(oncall_responses::Column::Id.eq(id))
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::State.is_in(escalating_states()))
        .exec(client)
        .await?;
    // Read back whether we won or lost: the caller's question is "who has it
    // now", and after a lost race that is somebody else.
    get(org_id, id).await
}

/// The states a record is still climbing its ladder in. Mirrors
/// `ResponseState::is_escalating`, spelled for a SQL filter.
fn escalating_states() -> Vec<i32> {
    vec![
        ResponseState::Triggered.to_i32(),
        ResponseState::Triaged.to_i32(),
    ]
}

/// Whether the ladder should still be climbing for this record.
///
/// A dedicated read because the engine has to ask again immediately before it
/// delivers: the tick that decided to page read the record before the policy,
/// the schedule and N SMTP calls, and an acknowledgement landing inside that
/// window has to stop the page rather than arrive after it.
pub async fn is_escalating(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    Ok(get(org_id, id)
        .await?
        // The RECORD, not the state: a spent ladder keeps the `Triggered`
        // state, and a rung still in flight when it ran out has nothing left
        // to reach. Safe against repeats because a new run clears the flag.
        .is_some_and(|r| r.is_escalating()))
}

/// Resolves a record. Idempotent — a second resolve keeps the first time.
pub async fn resolve(
    org_id: &str,
    id: &str,
    cause: Option<ResolutionCause>,
    cause_note: Option<&str>,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let note = cause_note.map(str::trim).filter(|n| !n.is_empty());
    // Already closed. Resolving again must not move `closed_at` — it was
    // resolved when it was resolved, and rewriting that would falsify every
    // time-to-resolve built on it.
    //
    // But it must not swallow a cause either. This used to return the record
    // untouched, so somebody who resolved in a hurry and came back to record
    // *why* got a 200 and lost what they typed. A cause arriving late is the
    // most useful thing anybody adds to a closed record: it is what turns the
    // next firing's `prior-causes` from a list of dates into history.
    if existing.closed_at.is_some() {
        if cause.is_none() && note.is_none() {
            return Ok(to_response(existing));
        }
        let mut model: oncall_responses::ActiveModel = existing.into();
        if let Some(c) = cause {
            model.cause = Set(Some(c.as_str().to_string()));
        }
        if let Some(n) = note {
            model.cause_note = Set(Some(n.to_string()));
        }
        return Ok(to_response(model.update(client).await?));
    }
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.state = Set(ResponseState::Resolved.to_i32());
    model.closed_at = Set(Some(now_micros()));
    if let Some(c) = cause {
        model.cause = Set(Some(c.as_str().to_string()));
    }
    if let Some(n) = note {
        model.cause_note = Set(Some(n.to_string()));
    }
    Ok(to_response(model.update(client).await?))
}

pub async fn attach_incident(
    org_id: &str,
    id: &str,
    incident_id: &str,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.incident_id = Set(Some(incident_id.to_string()));
    Ok(to_response(model.update(client).await?))
}

/// The paging record for an incident, newest firing first.
///
/// Keyed on the column rather than the `subject_id` naming convention, so the
/// link survives any change to how subject ids are spelled.
pub async fn list_for_incident(
    org_id: &str,
    incident_id: &str,
) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::IncidentId.eq(incident_id))
        .order_by_desc(oncall_responses::Column::OpenedAt)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_response)
        .collect())
}

pub async fn add_event(response_id: &str, event: &ResponseEvent) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_response_events::ActiveModel {
        id: Set(ider::uuid()),
        response_id: Set(response_id.to_string()),
        kind: Set(event.kind.to_i32()),
        at: Set(event.at),
        actor: Set(event.actor.clone()),
        body: Set(event.body.clone()),
        rung_micros: Set(event.rung_micros),
        ladder_run: Set(event.ladder_run),
        recipient: Set(event.recipient.clone()),
        channel: Set(event.channel.map(|c| c.to_i32())),
        delivered: Set(event.delivered),
    };
    model.insert(client).await?;
    Ok(())
}

/// The timeline, as a person reads it.
///
/// Sorted on `at`, with the id as the tiebreak. Ksuids alone cannot order
/// these — their timestamp resolution is one second.
///
/// Per-delivery rows are left out. They are the engine's dedup key, not a
/// story: a rung that paged the whole team on two channels is one line to a
/// responder and sixteen rows to the ledger, and the `Page` entry beside them
/// already says who was reached and who was not.
pub async fn list_events(response_id: &str) -> Result<Vec<ResponseEvent>, errors::Error> {
    Ok(all_events(response_id)
        .await?
        .into_iter()
        .filter(|e| !e.kind.is_ledger_only())
        .collect())
}

/// Every page this record actually attempted, per person and per channel.
///
/// The ledger the engine replays against, and the honest answer to "did the
/// page reach them" — which is the one thing the record exists for.
pub async fn list_deliveries(response_id: &str) -> Result<Vec<ResponseEvent>, errors::Error> {
    Ok(all_events(response_id)
        .await?
        .into_iter()
        .filter(|e| e.kind == ResponseEventKind::Delivery)
        .collect())
}

/// Drops the timeline of records that closed before `cutoff` (`06` §7).
///
/// `oncall_response_events` is the only on-call table that grows without an
/// upper bound: one row per recipient, per channel, per rung, per ladder run,
/// and a P1 that pages a ten-person team on two channels through five rungs
/// writes a hundred of them for one firing. Nothing pruned it.
///
/// What is kept, and why:
///
/// - **Every open record's timeline, whatever its age.** A page that has been open for four months
///   is a page somebody is still working, and it is the one whose history is being read.
/// - **Everything about a record closed after `cutoff`.** That is the window in which a responder
///   opens last week's firing to see what was tried.
/// - **Every response row, always.** Prior causes are read off `oncall_responses.cause` and
///   `cause_note` by `history_for_source`, never off this table, so the answer to "what was it last
///   time" is untouched by any retention set here. That is the whole reason this sweep can be
///   aggressive about the ledger without making the next page less useful.
///
/// Bounded at `max_records` records per pass, and **convergent**: the candidate
/// set is restricted to records that still have events, so a pass that has
/// already cleaned the oldest five hundred moves on to the next five hundred
/// instead of selecting the same rows forever. That restriction is the whole
/// reason for the subquery — ordering by `closed_at` alone would pick the same
/// batch on every pass and the sweep would never reach row five hundred and one.
///
/// The subquery is a `DISTINCT` over `response_id`, which is the events table's
/// own lookup index; the sweep runs hourly on one node, which is the cadence
/// `06` §7 asks for and is what makes that affordable.
///
/// Returns `(records_pruned, events_deleted)`.
pub async fn prune_events(cutoff: i64, max_records: u64) -> Result<(u64, u64), errors::Error> {
    use sea_orm::sea_query::Query;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let ids: Vec<String> = oncall_responses::Entity::find()
        .filter(oncall_responses::Column::ClosedAt.is_not_null())
        .filter(oncall_responses::Column::ClosedAt.lt(cutoff))
        .filter(
            oncall_responses::Column::Id.in_subquery(
                Query::select()
                    .distinct()
                    .column(oncall_response_events::Column::ResponseId)
                    .from(oncall_response_events::Entity)
                    .to_owned(),
            ),
        )
        // Oldest first, so a backlog is worked off from the end that matters
        // least to a responder.
        .order_by_asc(oncall_responses::Column::ClosedAt)
        .limit(max_records)
        .select_only()
        .column(oncall_responses::Column::Id)
        .into_tuple()
        .all(client)
        .await?;
    if ids.is_empty() {
        return Ok((0, 0));
    }
    let records = ids.len() as u64;
    let deleted = oncall_response_events::Entity::delete_many()
        .filter(oncall_response_events::Column::ResponseId.is_in(ids))
        .exec(client)
        .await?
        .rows_affected;
    Ok((records, deleted))
}

async fn all_events(response_id: &str) -> Result<Vec<ResponseEvent>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_response_events::Entity::find()
        .filter(oncall_response_events::Column::ResponseId.eq(response_id))
        .order_by_asc(oncall_response_events::Column::At)
        .order_by_asc(oncall_response_events::Column::Id)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_event)
        .collect())
}

// ── Aggregates for the team screens ───────────────────────────────────────────
//
// Every function below counts in the database. The org that most needs these
// answers is the one with the most rows, and a summary computed by loading
// every response of the last week would be slowest exactly where it matters —
// the same reason `cause_breakdown` above groups in SQL.

/// A window over `opened_at`, restricted to one team.
///
/// Shared by every tally here so that "pages this team took last week" means
/// one thing, not six subtly different things.
fn team_window(
    org_id: &str,
    team_id: &str,
    from: i64,
    to: i64,
) -> Select<oncall_responses::Entity> {
    oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::TeamId.eq(team_id))
        .filter(oncall_responses::Column::OpenedAt.gte(from))
        .filter(oncall_responses::Column::OpenedAt.lt(to))
}

/// Records whose id appears in the events table under some condition.
///
/// The rung questions ("did this ever reach the second rung?") live on the
/// timeline, and the timeline has no org column. Expressing them as an
/// `IN (subquery)` on the response id keeps the whole answer a single `COUNT`
/// rather than a `DISTINCT` the three backends spell differently.
fn reached_rung_at_least(
    org_id: &str,
    team_id: &str,
    from: i64,
    to: i64,
    rung_micros: i64,
) -> Select<oncall_responses::Entity> {
    use sea_orm::sea_query::Query;

    team_window(org_id, team_id, from, to).filter(
        oncall_responses::Column::Id.in_subquery(
            Query::select()
                .column(oncall_response_events::Column::ResponseId)
                .from(oncall_response_events::Entity)
                .and_where(
                    Expr::col(oncall_response_events::Column::Kind)
                        .eq(ResponseEventKind::Page.to_i32()),
                )
                .and_where(Expr::col(oncall_response_events::Column::RungMicros).gte(rung_micros))
                .to_owned(),
        ),
    )
}

/// What a team's last N days looked like, in six numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct TeamPageStats {
    /// Records opened in the window.
    pub pages: i64,
    pub acknowledged: i64,
    /// Acknowledged within five minutes of opening — the number a team
    /// actually manages against.
    pub acked_under_5m: i64,
    /// Opened inside one of `night_windows`, which the caller computes in the
    /// team's own zone. "2am" is a fact about a person, not about UTC.
    pub night_pages: i64,
    /// Climbed past the first rung, so the first person did not answer.
    pub reached_second_rung: i64,
    /// Climbed to the last rung its own priority's ladder has — which, in the
    /// shipped default policy, is the whole team.
    pub reached_final_rung: i64,
}

/// Five minutes, in micros. §2's "acknowledged quickly" threshold.
pub const FAST_ACK_MICROS: i64 = 5 * 60 * 1_000_000;

/// The six numbers, as six `COUNT`s.
///
/// `night_windows` are absolute UTC intervals the caller derived from the
/// team's timezone; `final_rung_micros` maps a priority onto the `after_micros`
/// of the last step in its ladder, which is what "reached the bottom" means for
/// a record at that priority. Both are passed in rather than read here so this
/// layer keeps no opinion about policy or geography.
///
/// Bounded: at most `6 + final_rung_micros.len()` statements, and the caller
/// only ever has five priorities.
pub async fn team_page_stats(
    org_id: &str,
    team_id: &str,
    from: i64,
    to: i64,
    night_windows: &[(i64, i64)],
    final_rung_micros: &[(i32, i64)],
) -> Result<TeamPageStats, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let pages = team_window(org_id, team_id, from, to).count(client).await? as i64;
    let acknowledged = team_window(org_id, team_id, from, to)
        .filter(oncall_responses::Column::AckedAt.is_not_null())
        .count(client)
        .await? as i64;
    let acked_under_5m = team_window(org_id, team_id, from, to)
        .filter(oncall_responses::Column::AckedAt.is_not_null())
        .filter(
            Expr::col(oncall_responses::Column::AckedAt)
                .sub(Expr::col(oncall_responses::Column::OpenedAt))
                .lt(FAST_ACK_MICROS),
        )
        .count(client)
        .await? as i64;

    // One `COUNT` for every night in the window, OR'd into a single predicate
    // rather than run per night: seven statements to answer "how many woke
    // somebody" would be six more than the question deserves.
    let night_pages = if night_windows.is_empty() {
        0
    } else {
        let mut nights = sea_orm::Condition::any();
        for (start, end) in night_windows {
            nights = nights.add(
                sea_orm::Condition::all()
                    .add(oncall_responses::Column::OpenedAt.gte(*start))
                    .add(oncall_responses::Column::OpenedAt.lt(*end)),
            );
        }
        team_window(org_id, team_id, from, to)
            .filter(nights)
            .count(client)
            .await? as i64
    };

    // Anything above rung zero. `after_micros` is a delay, so "> 0" is "not
    // the rung that fired immediately" without this layer needing the ladder.
    let reached_second_rung = reached_rung_at_least(org_id, team_id, from, to, 1)
        .count(client)
        .await? as i64;

    let mut reached_final_rung = 0;
    for (priority, last_rung) in final_rung_micros {
        // A ladder whose only rung is rung zero has no bottom to reach: every
        // page would count, which would make the number meaningless.
        if *last_rung <= 0 {
            continue;
        }
        reached_final_rung += reached_rung_at_least(org_id, team_id, from, to, *last_rung)
            .filter(oncall_responses::Column::Priority.eq(*priority))
            .count(client)
            .await? as i64;
    }

    Ok(TeamPageStats {
        pages,
        acknowledged,
        acked_under_5m,
        night_pages,
        reached_second_rung,
        reached_final_rung,
    })
}

#[derive(Debug, FromQueryResult)]
struct PersonTally {
    who: String,
    count: i64,
}

/// How many of the team's pages each person acknowledged, grouped in SQL.
///
/// The fairness question's third column. Records nobody acknowledged have a
/// null `acked_by` and are excluded by the filter, so the sum of these is
/// [`TeamPageStats::acknowledged`] and not [`TeamPageStats::pages`].
pub async fn acks_by_person(
    org_id: &str,
    team_id: &str,
    from: i64,
    to: i64,
) -> Result<Vec<(String, i64)>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(team_window(org_id, team_id, from, to)
        .filter(oncall_responses::Column::AckedBy.is_not_null())
        .select_only()
        .column_as(oncall_responses::Column::AckedBy, "who")
        .column_as(oncall_responses::Column::Id.count(), "count")
        .group_by(oncall_responses::Column::AckedBy)
        .into_model::<PersonTally>()
        .all(client)
        .await?
        .into_iter()
        .map(|t| (t.who, t.count))
        .collect())
}

/// How many pages each person was sent, grouped in SQL.
///
/// Counted off the delivery ledger rather than off the response record,
/// because "pages Aarav received" is not "records Aarav's team took": one
/// firing that climbs three rungs reaches three different people, and the
/// fairness screen is asking about phones, not records.
///
/// `night_windows` are the same absolute intervals [`team_page_stats`] takes;
/// passing an empty slice asks only for the totals.
pub async fn deliveries_by_person(
    org_id: &str,
    team_id: &str,
    from: i64,
    to: i64,
    night_windows: &[(i64, i64)],
) -> Result<Vec<(String, i64, i64)>, errors::Error> {
    use std::collections::HashMap;

    use sea_orm::sea_query::Query;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let base = || {
        oncall_response_events::Entity::find()
            .filter(oncall_response_events::Column::Kind.eq(ResponseEventKind::Delivery.to_i32()))
            .filter(oncall_response_events::Column::Recipient.is_not_null())
            .filter(oncall_response_events::Column::At.gte(from))
            .filter(oncall_response_events::Column::At.lt(to))
            // The ledger has no org column, so the team restriction has to
            // come through the records it belongs to.
            .filter(
                oncall_response_events::Column::ResponseId.in_subquery(
                    Query::select()
                        .column(oncall_responses::Column::Id)
                        .from(oncall_responses::Entity)
                        .and_where(Expr::col(oncall_responses::Column::OrgId).eq(org_id))
                        .and_where(Expr::col(oncall_responses::Column::TeamId).eq(team_id))
                        .to_owned(),
                ),
            )
    };

    let totals: Vec<PersonTally> = base()
        .select_only()
        .column_as(oncall_response_events::Column::Recipient, "who")
        .column_as(oncall_response_events::Column::Id.count(), "count")
        .group_by(oncall_response_events::Column::Recipient)
        .into_model()
        .all(client)
        .await?;

    let mut nights_by_person: HashMap<String, i64> = HashMap::new();
    if !night_windows.is_empty() {
        let mut nights = sea_orm::Condition::any();
        for (start, end) in night_windows {
            nights = nights.add(
                sea_orm::Condition::all()
                    .add(oncall_response_events::Column::At.gte(*start))
                    .add(oncall_response_events::Column::At.lt(*end)),
            );
        }
        let tallies: Vec<PersonTally> = base()
            .filter(nights)
            .select_only()
            .column_as(oncall_response_events::Column::Recipient, "who")
            .column_as(oncall_response_events::Column::Id.count(), "count")
            .group_by(oncall_response_events::Column::Recipient)
            .into_model()
            .all(client)
            .await?;
        nights_by_person = tallies.into_iter().map(|t| (t.who, t.count)).collect();
    }

    Ok(totals
        .into_iter()
        .map(|t| {
            let nights = nights_by_person.get(&t.who).copied().unwrap_or(0);
            (t.who, t.count, nights)
        })
        .collect())
}

#[derive(Debug, FromQueryResult)]
struct RoutingTally {
    body: String,
    count: i64,
    last_at: i64,
}

/// How often each routing sentence was written, and when it was last written.
///
/// This is the only durable record of *which rule* caught a page: the response
/// row carries a team, and `start_for_subject` writes the decision's own
/// sentence onto the timeline. Grouping by that sentence gives one row per
/// distinct routing outcome — bounded by the number of rules, not by the
/// number of firings — and the caller matches each sentence back to its rule.
///
/// `marker` is the fragment the caller is looking for, so this layer holds no
/// opinion about how a decision phrases itself.
pub async fn routing_sentences(
    org_id: &str,
    marker: &str,
    from: i64,
    to: i64,
    limit: u64,
) -> Result<Vec<(String, i64, i64)>, errors::Error> {
    use sea_orm::sea_query::Query;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_response_events::Entity::find()
        .filter(oncall_response_events::Column::Kind.eq(ResponseEventKind::Sys.to_i32()))
        .filter(oncall_response_events::Column::At.gte(from))
        .filter(oncall_response_events::Column::At.lt(to))
        .filter(oncall_response_events::Column::Body.contains(marker))
        .filter(
            oncall_response_events::Column::ResponseId.in_subquery(
                Query::select()
                    .column(oncall_responses::Column::Id)
                    .from(oncall_responses::Entity)
                    .and_where(Expr::col(oncall_responses::Column::OrgId).eq(org_id))
                    .to_owned(),
            ),
        )
        .select_only()
        .column_as(oncall_response_events::Column::Body, "body")
        .column_as(oncall_response_events::Column::Id.count(), "count")
        .column_as(oncall_response_events::Column::At.max(), "last_at")
        .group_by(oncall_response_events::Column::Body)
        .limit(limit)
        .into_model::<RoutingTally>()
        .all(client)
        .await?
        .into_iter()
        .map(|t| (t.body, t.count, t.last_at))
        .collect())
}

#[derive(Debug, FromQueryResult)]
struct RungReached {
    response_id: String,
    rung: i64,
}

/// The deepest rung each of these records reached, in one grouped query.
///
/// The pages list has to say how far a firing climbed, and asking the timeline
/// once per row is the N+1 this exists to avoid — the same reason
/// [`runbook_urls`] takes a page of ids rather than one.
pub async fn deepest_rungs(
    ids: &[String],
) -> Result<std::collections::HashMap<String, i64>, errors::Error> {
    if ids.is_empty() {
        return Ok(Default::default());
    }
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_response_events::Entity::find()
        .filter(oncall_response_events::Column::ResponseId.is_in(ids.to_vec()))
        .filter(oncall_response_events::Column::Kind.eq(ResponseEventKind::Page.to_i32()))
        .filter(oncall_response_events::Column::RungMicros.is_not_null())
        .select_only()
        .column_as(oncall_response_events::Column::ResponseId, "response_id")
        .column_as(oncall_response_events::Column::RungMicros.max(), "rung")
        .group_by(oncall_response_events::Column::ResponseId)
        .into_model::<RungReached>()
        .all(client)
        .await?
        .into_iter()
        .map(|r| (r.response_id, r.rung))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model() -> oncall_responses::Model {
        oncall_responses::Model {
            id: "resp_1".into(),
            org_id: "default".into(),
            subject_type: SubjectType::Alert.to_i32(),
            subject_id: "al_ckt#2".into(),
            team_id: "team_1".into(),
            title: Some("payment_gateway_error_rate".into()),
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: Some(FIRST_LADDER_RUN),
            responder_role: ResponderRole::Owner.to_i32(),
            origin_response_id: None,
            priority: 2,
            state: ResponseState::Triggered.to_i32(),
            opened_at: 1_000,
            acked_by: None,
            acked_at: None,
            closed_at: None,
            incident_id: None,
            runbook_url: None,
        }
    }

    #[test]
    fn test_row_maps_onto_the_meta_type() {
        let r = to_response(model()).unwrap();
        assert_eq!(r.subject.subject_type, SubjectType::Alert);
        assert_eq!(r.subject.source_id, "al_ckt");
        assert_eq!(r.subject.firing, 2);
        assert_eq!(r.state, ResponseState::Triggered);
        assert_eq!(r.priority, 2);
        assert_eq!(r.incident_id, None);
    }

    /// A record whose state this build cannot read must be dropped, not
    /// shown as `triggered` and re-escalated.
    #[test]
    fn test_undecodable_rows_are_dropped() {
        let mut m = model();
        m.state = 99;
        assert!(to_response(m).is_none());

        let mut m = model();
        m.subject_type = 99;
        assert!(to_response(m).is_none());

        let mut m = model();
        m.subject_id = "al_ckt".into();
        assert!(
            to_response(m).is_none(),
            "a subject id with no firing suffix is not a valid record"
        );
    }

    #[test]
    fn test_every_state_decodes() {
        for state in [
            ResponseState::Triggered,
            ResponseState::Triaged,
            ResponseState::Acknowledged,
            ResponseState::Resolved,
        ] {
            let mut m = model();
            m.state = state.to_i32();
            assert_eq!(to_response(m).unwrap().state, state);
        }
    }

    fn event_model(kind: ResponseEventKind) -> oncall_response_events::Model {
        oncall_response_events::Model {
            id: "ev_1".into(),
            response_id: "resp_1".into(),
            kind: kind.to_i32(),
            at: 1_500,
            actor: "o2-engine".into(),
            body: "email sent to ana@o2.ai".into(),
            rung_micros: Some(0),
            ladder_run: Some(1),
            recipient: None,
            channel: None,
            delivered: None,
        }
    }

    #[test]
    fn test_event_row_maps_onto_the_meta_type() {
        let e = to_event(event_model(ResponseEventKind::Page)).unwrap();
        assert_eq!(e.kind, ResponseEventKind::Page);
        assert_eq!(e.rung_micros, Some(0));
        assert_eq!(e.run(), 1);
        assert_eq!(e.at, 1_500);
    }

    /// The ledger row has to come back whole, or the engine cannot tell a
    /// page that landed from one it has yet to try.
    #[test]
    fn test_a_delivery_row_keeps_its_recipient_channel_and_outcome() {
        let mut m = event_model(ResponseEventKind::Delivery);
        m.recipient = Some("ana@o2.ai".into());
        m.channel = Some(Channel::Email.to_i32());
        m.delivered = Some(true);
        let e = to_event(m).unwrap();
        assert!(e.is_delivery_of(1, 0, "ana@o2.ai", Channel::Email));
    }

    /// A channel this build cannot name costs the entry its dedup key, not
    /// its existence: one page sent twice beats losing the record that
    /// anybody was paged at all.
    #[test]
    fn test_an_unknown_channel_drops_the_channel_not_the_event() {
        let mut m = event_model(ResponseEventKind::Delivery);
        m.recipient = Some("ana@o2.ai".into());
        m.channel = Some(99);
        m.delivered = Some(true);
        let e = to_event(m).unwrap();
        assert_eq!(e.kind, ResponseEventKind::Delivery);
        assert_eq!(e.channel, None);
        assert!(!e.is_delivery_of(1, 0, "ana@o2.ai", Channel::Email));
    }

    /// A row written before the ladder could restart belongs to the first
    /// run, not to whichever run is climbing now.
    #[test]
    fn test_a_row_with_no_run_is_on_the_first_one() {
        let mut m = event_model(ResponseEventKind::Page);
        m.ladder_run = None;
        assert_eq!(to_event(m).unwrap().run(), FIRST_LADDER_RUN);

        let mut r = model();
        r.ladder_run = None;
        assert_eq!(to_response(r).unwrap().current_run(), FIRST_LADDER_RUN);
    }

    /// An unknown rung on an otherwise readable event drops the rung, not
    /// the event — losing "who it went to" is better than losing the fact
    /// that a page happened.
    #[test]
    fn test_unknown_level_drops_the_level_not_the_event() {
        let mut m = event_model(ResponseEventKind::Page);
        m.rung_micros = Some(99);
        let e = to_event(m).unwrap();
        assert_eq!(e.rung_micros, Some(99));
        assert_eq!(e.kind, ResponseEventKind::Page);
    }

    #[test]
    fn test_unknown_event_kind_is_dropped() {
        let mut m = event_model(ResponseEventKind::Page);
        m.kind = 99;
        assert!(to_event(m).is_none());
    }

    /// The timeline is what a person reads; the ledger is what the engine
    /// replays. Sharing a table is fine, showing a responder sixteen rows for
    /// one rung is not.
    #[test]
    fn test_the_timeline_leaves_out_the_per_delivery_rows() {
        let mut delivery = event_model(ResponseEventKind::Delivery);
        delivery.recipient = Some("ana@o2.ai".into());
        let events: Vec<ResponseEvent> = [event_model(ResponseEventKind::Page), delivery]
            .into_iter()
            .filter_map(to_event)
            .collect();

        let timeline: Vec<&ResponseEvent> =
            events.iter().filter(|e| !e.kind.is_ledger_only()).collect();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].kind, ResponseEventKind::Page);

        let ledger: Vec<&ResponseEvent> = events
            .iter()
            .filter(|e| e.kind == ResponseEventKind::Delivery)
            .collect();
        assert_eq!(ledger.len(), 1, "the ledger still has it");
    }

    /// A handoff must clear the ack, move the clock and move the run in one
    /// step: leaving the run behind is what left the receiving team unpaged.
    #[test]
    fn test_handing_a_record_over_writes_a_whole_new_run() {
        let mut m = model();
        m.state = ResponseState::Acknowledged.to_i32();
        m.acked_by = Some("ana@o2.ai".into());
        m.acked_at = Some(1_200);
        let next = to_response(m).unwrap().handed_over(Some("team_2"), 5_000);

        assert_eq!(next.team_id, "team_2");
        assert_eq!(next.state, ResponseState::Triggered);
        assert_eq!(next.acked_by, None);
        assert_eq!(next.ladder_anchor, Some(5_000));
        assert_eq!(next.ladder_run, Some(2));
    }

    /// The firing prefix has to be `source#`, not a bare `source` - otherwise
    /// `al_ck` would match every firing of `al_ckt`.
    #[test]
    fn test_history_prefix_is_anchored_on_the_hash() {
        let prefix = format!("{}#", "al_ck");
        assert!(!"al_ckt#1".starts_with(&prefix));
        assert!("al_ck#1".starts_with(&prefix));
    }
}
