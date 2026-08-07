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
        EscalationLevel, Response, ResponseEvent, ResponseEventKind, ResponseState, SubjectRef,
        SubjectType,
    },
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
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
        priority: m.priority,
        opened_at: m.opened_at,
        acked_by: m.acked_by,
        acked_at: m.acked_at,
        closed_at: m.closed_at,
        incident_id: m.incident_id,
    })
}

fn to_event(m: oncall_response_events::Model) -> Option<ResponseEvent> {
    Some(ResponseEvent {
        kind: ResponseEventKind::from_i32(m.kind)?,
        at: m.at,
        actor: m.actor,
        body: m.body,
        level: m.level.and_then(EscalationLevel::from_i32),
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
) -> Result<Response, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_responses::ActiveModel {
        id: Set(ider::uuid()),
        org_id: Set(org_id.to_string()),
        subject_type: Set(subject.subject_type.to_i32()),
        subject_id: Set(subject.subject_id()),
        team_id: Set(team_id.to_string()),
        priority: Set(priority),
        state: Set(ResponseState::Triggered.to_i32()),
        opened_at: Set(now_micros()),
        acked_by: Set(None),
        acked_at: Set(None),
        closed_at: Set(None),
        incident_id: Set(None),
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
) -> Result<(Response, bool), errors::Error> {
    if let Some(found) = get_by_subject(org_id, subject).await? {
        return Ok((found, false));
    }
    match open(org_id, subject, team_id, priority).await {
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

/// Records still escalating: what the on-call engineer's home screen shows.
pub async fn list_open(
    org_id: &str,
    team_id: Option<&str>,
) -> Result<Vec<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut q = oncall_responses::Entity::find()
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::State.is_in([
            ResponseState::Triggered.to_i32(),
            ResponseState::Triaged.to_i32(),
        ]));
    if let Some(t) = team_id {
        q = q.filter(oncall_responses::Column::TeamId.eq(t));
    }
    Ok(q.order_by_asc(oncall_responses::Column::Priority)
        .order_by_desc(oncall_responses::Column::OpenedAt)
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
/// First ack wins: the second responder's click must not overwrite who
/// actually has the ball.
pub async fn acknowledge(
    org_id: &str,
    id: &str,
    user_email: &str,
) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let current = ResponseState::from_i32(existing.state);
    if current.is_some_and(|s| !s.is_open()) {
        return Ok(to_response(existing));
    }
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.state = Set(ResponseState::Acknowledged.to_i32());
    model.acked_by = Set(Some(user_email.to_string()));
    model.acked_at = Set(Some(now_micros()));
    Ok(to_response(model.update(client).await?))
}

/// Resolves a record. Idempotent — a second resolve keeps the first time.
pub async fn resolve(org_id: &str, id: &str) -> Result<Option<Response>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_responses::Entity::find_by_id(id)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    if existing.closed_at.is_some() {
        return Ok(to_response(existing));
    }
    let mut model: oncall_responses::ActiveModel = existing.into();
    model.state = Set(ResponseState::Resolved.to_i32());
    model.closed_at = Set(Some(now_micros()));
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

pub async fn add_event(response_id: &str, event: &ResponseEvent) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_response_events::ActiveModel {
        id: Set(ider::uuid()),
        response_id: Set(response_id.to_string()),
        kind: Set(event.kind.to_i32()),
        at: Set(event.at),
        actor: Set(event.actor.clone()),
        body: Set(event.body.clone()),
        level: Set(event.level.map(|l| l.to_i32())),
    };
    model.insert(client).await?;
    Ok(())
}

/// Sorted on `at`, with the id as the tiebreak. Ksuids alone cannot order
/// these — their timestamp resolution is one second.
pub async fn list_events(response_id: &str) -> Result<Vec<ResponseEvent>, errors::Error> {
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
            priority: 2,
            state: ResponseState::Triggered.to_i32(),
            opened_at: 1_000,
            acked_by: None,
            acked_at: None,
            closed_at: None,
            incident_id: None,
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

    #[test]
    fn test_event_row_maps_onto_the_meta_type() {
        let m = oncall_response_events::Model {
            id: "ev_1".into(),
            response_id: "resp_1".into(),
            kind: ResponseEventKind::Page.to_i32(),
            at: 1_500,
            actor: "o2-engine".into(),
            body: "email sent to ana@o2.ai".into(),
            level: Some(EscalationLevel::Primary.to_i32()),
        };
        let e = to_event(m).unwrap();
        assert_eq!(e.kind, ResponseEventKind::Page);
        assert_eq!(e.level, Some(EscalationLevel::Primary));
        assert_eq!(e.at, 1_500);
    }

    /// An unknown level on an otherwise readable event drops the level, not
    /// the event — losing "who it went to" is better than losing the fact
    /// that a page happened.
    #[test]
    fn test_unknown_level_drops_the_level_not_the_event() {
        let m = oncall_response_events::Model {
            id: "ev_1".into(),
            response_id: "resp_1".into(),
            kind: ResponseEventKind::Page.to_i32(),
            at: 1_500,
            actor: "o2-engine".into(),
            body: "sent".into(),
            level: Some(99),
        };
        let e = to_event(m).unwrap();
        assert_eq!(e.level, None);
        assert_eq!(e.kind, ResponseEventKind::Page);
    }

    #[test]
    fn test_unknown_event_kind_is_dropped() {
        let m = oncall_response_events::Model {
            id: "ev_1".into(),
            response_id: "resp_1".into(),
            kind: 99,
            at: 1_500,
            actor: "o2-engine".into(),
            body: "sent".into(),
            level: None,
        };
        assert!(to_event(m).is_none());
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
