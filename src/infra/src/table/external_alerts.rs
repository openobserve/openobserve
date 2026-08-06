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

//! Table ops for `external_alerts`: idempotent, timestamp-ruled upsert of
//! normalized events from external alert sources (Grafana, Alertmanager,
//! generic JSON) into the row that represents "this dedup key's current
//! state" for an integration.

use config::meta::alerts::incidents::{ExternalAlertEvent, ExternalAlertStatus};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr, sea_query::Expr};
use svix_ksuid::KsuidLike;

use super::{
    entity::external_alerts::{ActiveModel, Column, Entity, Model},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

#[derive(Debug, Clone)]
pub struct ExternalAlertRecord {
    pub id: String,
    pub org_id: String,
    pub integration_id: String,
    pub detected_source: String,
    pub dedup_key: String,
    pub title: String,
    pub severity: String,
    pub state: String,
    pub labels: serde_json::Value,
    pub source_url: Option<String>,
    pub last_payload: serde_json::Value,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub resolved_at: Option<i64>,
}

impl From<Model> for ExternalAlertRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            integration_id: m.integration_id,
            detected_source: m.detected_source,
            dedup_key: m.dedup_key,
            title: m.title,
            severity: m.severity,
            state: m.state,
            labels: serde_json::from_str(&m.labels).unwrap_or_else(|_| serde_json::json!({})),
            source_url: m.source_url,
            last_payload: serde_json::from_str(&m.last_payload)
                .unwrap_or_else(|_| serde_json::json!({})),
            first_seen_at: m.first_seen_at,
            last_seen_at: m.last_seen_at,
            resolved_at: m.resolved_at,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum UpsertOutcome {
    Inserted,
    Refreshed,
    Reopened,
    ResolvedApplied,
    StaleIgnored,
}

/// Pure decision: what should upsert do, given existing row state (if any)?
#[derive(Debug, PartialEq, Eq)]
pub enum UpsertAction {
    Insert,
    NoopStale,
    RefreshFiring { new_last_seen: i64 },
    ApplyResolved { resolved_at: i64 },
    Reopen { new_last_seen: i64 },
}

/// Pure decision: what should upsert do, given existing row state (if any)?
///
/// `existing` is `(state, last_seen_at, resolved_at)` for the row identified by
/// `(org_id, integration_id, detected_source, dedup_key)`, or `None` if no such row exists.
pub fn decide_upsert(
    existing: Option<(&str, i64, Option<i64>)>,
    incoming_status: &ExternalAlertStatus,
    event_ts: i64,
) -> UpsertAction {
    match (existing, incoming_status) {
        (None, ExternalAlertStatus::Firing) => UpsertAction::Insert,
        (None, ExternalAlertStatus::Resolved) => UpsertAction::NoopStale,
        (Some(("firing", last_seen_at, _)), ExternalAlertStatus::Firing) => {
            UpsertAction::RefreshFiring {
                new_last_seen: last_seen_at.max(event_ts),
            }
        }
        (Some(("firing", last_seen_at, _)), ExternalAlertStatus::Resolved) => {
            if event_ts >= last_seen_at {
                UpsertAction::ApplyResolved {
                    resolved_at: event_ts,
                }
            } else {
                UpsertAction::NoopStale
            }
        }
        (Some((_, _, resolved_at)), ExternalAlertStatus::Firing) => {
            // Row is resolved (or any non-"firing" state).
            let resolved_at = resolved_at.unwrap_or(i64::MIN);
            if event_ts > resolved_at {
                UpsertAction::Reopen {
                    new_last_seen: event_ts,
                }
            } else {
                UpsertAction::NoopStale
            }
        }
        (Some(_), ExternalAlertStatus::Resolved) => UpsertAction::NoopStale,
    }
}

/// Upsert one normalized external alert event into `external_alerts`, applying
/// the timestamp rules in `decide_upsert`.
///
/// On `NoopStale` with no existing row (no-row + Resolved), returns a synthetic,
/// non-persisted `ExternalAlertRecord` built from the event with an empty `id` — this
/// record was never written to the DB, it exists only to give the caller something to
/// report back (202-no-op semantics).
pub async fn upsert_event(
    org_id: &str,
    integration_id: &str,
    detected_source: &str,
    ev: &ExternalAlertEvent,
) -> Result<(ExternalAlertRecord, UpsertOutcome), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let existing = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IntegrationId.eq(integration_id))
        .filter(Column::DetectedSource.eq(detected_source))
        .filter(Column::DedupKey.eq(&ev.dedup_key))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    let action = decide_upsert(
        existing
            .as_ref()
            .map(|m| (m.state.as_str(), m.last_seen_at, m.resolved_at)),
        &ev.status,
        ev.event_ts,
    );

    match action {
        UpsertAction::Insert => {
            let record = insert_new(org_id, integration_id, detected_source, ev).await?;
            Ok((record, UpsertOutcome::Inserted))
        }
        UpsertAction::NoopStale => {
            let record = existing
                .map(ExternalAlertRecord::from)
                .unwrap_or_else(|| synthetic_record(org_id, integration_id, detected_source, ev));
            Ok((record, UpsertOutcome::StaleIgnored))
        }
        UpsertAction::RefreshFiring { new_last_seen } => {
            let existing = existing.expect("RefreshFiring implies an existing row");
            let labels_json = serde_json::to_string(&ev.labels).unwrap_or_else(|_| "{}".into());
            let last_payload_json = ev.raw.to_string();
            Entity::update_many()
                .col_expr(Column::LastSeenAt, Expr::value(new_last_seen))
                .col_expr(Column::Title, Expr::value(ev.title.clone()))
                .col_expr(Column::Severity, Expr::value(ev.severity.to_string()))
                .col_expr(Column::Labels, Expr::value(labels_json))
                .col_expr(Column::LastPayload, Expr::value(last_payload_json))
                .col_expr(Column::SourceUrl, Expr::value(ev.source_url.clone()))
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Id.eq(existing.id.clone()))
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
            let record = get_by_id(org_id, &existing.id)
                .await?
                .expect("row just updated must still exist");
            Ok((record, UpsertOutcome::Refreshed))
        }
        UpsertAction::ApplyResolved { resolved_at } => {
            let existing = existing.expect("ApplyResolved implies an existing row");
            Entity::update_many()
                .col_expr(Column::State, Expr::value("resolved"))
                .col_expr(Column::ResolvedAt, Expr::value(resolved_at))
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Id.eq(existing.id.clone()))
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
            let record = get_by_id(org_id, &existing.id)
                .await?
                .expect("row just updated must still exist");
            Ok((record, UpsertOutcome::ResolvedApplied))
        }
        UpsertAction::Reopen { new_last_seen } => {
            let existing = existing.expect("Reopen implies an existing row");
            Entity::update_many()
                .col_expr(Column::State, Expr::value("firing"))
                .col_expr(Column::ResolvedAt, Expr::value(Option::<i64>::None))
                .col_expr(Column::LastSeenAt, Expr::value(new_last_seen))
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Id.eq(existing.id.clone()))
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
            let record = get_by_id(org_id, &existing.id)
                .await?
                .expect("row just updated must still exist");
            Ok((record, UpsertOutcome::Reopened))
        }
    }
}

async fn insert_new(
    org_id: &str,
    integration_id: &str,
    detected_source: &str,
    ev: &ExternalAlertEvent,
) -> Result<ExternalAlertRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let id = svix_ksuid::Ksuid::new(None, None).to_string();
    let labels_json = serde_json::to_string(&ev.labels).unwrap_or_else(|_| "{}".into());
    let last_payload_json = ev.raw.to_string();

    let model = ActiveModel {
        id: Set(id.clone()),
        org_id: Set(org_id.to_owned()),
        integration_id: Set(integration_id.to_owned()),
        detected_source: Set(detected_source.to_owned()),
        dedup_key: Set(ev.dedup_key.clone()),
        title: Set(ev.title.clone()),
        severity: Set(ev.severity.to_string()),
        state: Set("firing".to_owned()),
        labels: Set(labels_json),
        source_url: Set(ev.source_url.clone()),
        last_payload: Set(last_payload_json),
        first_seen_at: Set(ev.event_ts),
        last_seen_at: Set(ev.event_ts),
        resolved_at: Set(None),
    };

    match Entity::insert(model).exec(client).await {
        Ok(_) => {
            let record = get_by_id(org_id, &id)
                .await?
                .expect("row just inserted must exist");
            Ok(record)
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                // Concurrent insert raced us — fall through to the update path by
                // re-running the full decision against the row the other writer created.
                let existing = Entity::find()
                    .filter(Column::OrgId.eq(org_id))
                    .filter(Column::IntegrationId.eq(integration_id))
                    .filter(Column::DetectedSource.eq(detected_source))
                    .filter(Column::DedupKey.eq(&ev.dedup_key))
                    .one(client)
                    .await
                    .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
                    .ok_or_else(|| {
                        Error::DbError(DbError::SeaORMError(
                            "unique constraint violation but row not found on retry".to_string(),
                        ))
                    })?;

                let action = decide_upsert(
                    Some((
                        existing.state.as_str(),
                        existing.last_seen_at,
                        existing.resolved_at,
                    )),
                    &ev.status,
                    ev.event_ts,
                );
                match action {
                    UpsertAction::RefreshFiring { new_last_seen } => {
                        let labels_json =
                            serde_json::to_string(&ev.labels).unwrap_or_else(|_| "{}".into());
                        let last_payload_json = ev.raw.to_string();
                        Entity::update_many()
                            .col_expr(Column::LastSeenAt, Expr::value(new_last_seen))
                            .col_expr(Column::Title, Expr::value(ev.title.clone()))
                            .col_expr(Column::Severity, Expr::value(ev.severity.to_string()))
                            .col_expr(Column::Labels, Expr::value(labels_json))
                            .col_expr(Column::LastPayload, Expr::value(last_payload_json))
                            .col_expr(Column::SourceUrl, Expr::value(ev.source_url.clone()))
                            .filter(Column::OrgId.eq(org_id))
                            .filter(Column::Id.eq(existing.id.clone()))
                            .exec(client)
                            .await
                            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
                    }
                    UpsertAction::ApplyResolved { resolved_at } => {
                        Entity::update_many()
                            .col_expr(Column::State, Expr::value("resolved"))
                            .col_expr(Column::ResolvedAt, Expr::value(resolved_at))
                            .filter(Column::OrgId.eq(org_id))
                            .filter(Column::Id.eq(existing.id.clone()))
                            .exec(client)
                            .await
                            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
                    }
                    UpsertAction::Reopen { new_last_seen } => {
                        Entity::update_many()
                            .col_expr(Column::State, Expr::value("firing"))
                            .col_expr(Column::ResolvedAt, Expr::value(Option::<i64>::None))
                            .col_expr(Column::LastSeenAt, Expr::value(new_last_seen))
                            .filter(Column::OrgId.eq(org_id))
                            .filter(Column::Id.eq(existing.id.clone()))
                            .exec(client)
                            .await
                            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
                    }
                    UpsertAction::Insert | UpsertAction::NoopStale => {
                        // Nothing to persist; fall through to re-reading current state below.
                    }
                }
                let record = get_by_id(org_id, &existing.id)
                    .await?
                    .expect("row must exist after retry");
                Ok(record)
            }
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Build a non-persisted record representing a no-row + Resolved event: this row was
/// never written to the DB (there is nothing to resolve), so `id` is left empty. Callers
/// must not treat this as a real, addressable row.
fn synthetic_record(
    org_id: &str,
    integration_id: &str,
    detected_source: &str,
    ev: &ExternalAlertEvent,
) -> ExternalAlertRecord {
    ExternalAlertRecord {
        id: String::new(),
        org_id: org_id.to_owned(),
        integration_id: integration_id.to_owned(),
        detected_source: detected_source.to_owned(),
        dedup_key: ev.dedup_key.clone(),
        title: ev.title.clone(),
        severity: ev.severity.to_string(),
        state: "resolved".to_owned(),
        labels: serde_json::to_value(&ev.labels).unwrap_or_else(|_| serde_json::json!({})),
        source_url: ev.source_url.clone(),
        last_payload: ev.raw.clone(),
        first_seen_at: ev.event_ts,
        last_seen_at: ev.event_ts,
        resolved_at: Some(ev.event_ts),
    }
}

pub async fn get_by_id(
    org_id: &str,
    id: &str,
) -> Result<Option<ExternalAlertRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(record.map(ExternalAlertRecord::from))
}

pub async fn get_by_ids(
    org_id: &str,
    ids: &[String],
) -> Result<Vec<ExternalAlertRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.is_in(ids.to_vec()))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(records.into_iter().map(ExternalAlertRecord::from).collect())
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::incidents::ExternalAlertStatus as S;

    use super::*;

    #[test]
    fn test_new_firing_inserts() {
        assert_eq!(decide_upsert(None, &S::Firing, 100), UpsertAction::Insert);
    }
    #[test]
    fn test_new_resolved_is_noop() {
        assert_eq!(
            decide_upsert(None, &S::Resolved, 100),
            UpsertAction::NoopStale
        );
    }
    #[test]
    fn test_firing_refresh_takes_max_ts() {
        assert_eq!(
            decide_upsert(Some(("firing", 200, None)), &S::Firing, 100),
            UpsertAction::RefreshFiring { new_last_seen: 200 }
        );
        assert_eq!(
            decide_upsert(Some(("firing", 200, None)), &S::Firing, 300),
            UpsertAction::RefreshFiring { new_last_seen: 300 }
        );
    }
    #[test]
    fn test_resolve_requires_endsat_gte_last_seen() {
        assert_eq!(
            decide_upsert(Some(("firing", 200, None)), &S::Resolved, 199),
            UpsertAction::NoopStale
        );
        assert_eq!(
            decide_upsert(Some(("firing", 200, None)), &S::Resolved, 200),
            UpsertAction::ApplyResolved { resolved_at: 200 }
        );
    }
    #[test]
    fn test_reopen_requires_ts_after_resolved_at() {
        assert_eq!(
            decide_upsert(Some(("resolved", 200, Some(250))), &S::Firing, 250),
            UpsertAction::NoopStale
        );
        assert_eq!(
            decide_upsert(Some(("resolved", 200, Some(250))), &S::Firing, 251),
            UpsertAction::Reopen { new_last_seen: 251 }
        );
    }
    #[test]
    fn test_resolved_resolved_is_noop() {
        assert_eq!(
            decide_upsert(Some(("resolved", 200, Some(250))), &S::Resolved, 300),
            UpsertAction::NoopStale
        );
    }
}
