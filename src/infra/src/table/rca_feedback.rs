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

//! Service layer for `rca_feedback`: one "Was this the cause?" answer per RCA report and user.

use std::collections::HashMap;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, SqlErr};

pub use super::entity::rca_feedback::Model;
use super::{entity::rca_feedback::*, fit};
use crate::{db::get_orm_client_rw, errors};

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// One answer to store; `outcome` is `yes`, `partly` or `no`.
#[derive(Debug, Clone, Copy)]
pub struct Answer<'a> {
    pub org_id: &'a str,
    pub incident_id: &'a str,
    pub report_id: &'a str,
    pub user_email: &'a str,
    pub outcome: &'a str,
    pub reason: Option<&'a str>,
}

/// Stores `answer`, replacing the same user's earlier answer to the same report.
pub async fn upsert(answer: Answer<'_>, now: i64) -> Result<Model, errors::Error> {
    upsert_with(get_orm_client_rw().await, answer, now).await
}

pub async fn upsert_with<C: ConnectionTrait>(
    conn: &C,
    answer: Answer<'_>,
    now: i64,
) -> Result<Model, errors::Error> {
    if let Some(found) = find(conn, &answer).await? {
        return update(conn, found, &answer, now).await;
    }
    let model = Model {
        id: config::ider::uuid(),
        org_id: fit(answer.org_id, 256),
        incident_id: fit(answer.incident_id, 256),
        report_id: fit(answer.report_id, 64),
        user_email: fit(answer.user_email, 256),
        outcome: answer.outcome.to_string(),
        reason: answer.reason.map(str::to_string),
        created_at: now,
        updated_at: now,
    };
    let record = ActiveModel {
        id: Set(model.id.clone()),
        org_id: Set(model.org_id.clone()),
        incident_id: Set(model.incident_id.clone()),
        report_id: Set(model.report_id.clone()),
        user_email: Set(model.user_email.clone()),
        outcome: Set(model.outcome.clone()),
        reason: Set(model.reason.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };
    // A plain insert: sea-query's MySQL `ON CONFLICT DO NOTHING` is not valid SQL.
    match Entity::insert(record).exec_without_returning(conn).await {
        Ok(_) => Ok(model),
        Err(e) if matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_))) => {
            let found = find(conn, &answer)
                .await?
                .ok_or_else(|| db_err("rca_feedback row vanished after a duplicate insert"))?;
            update(conn, found, &answer, now).await
        }
        Err(e) => Err(db_err(e)),
    }
}

/// `user_email`'s answers on one incident, keyed by `report_id`.
pub async fn outcomes_of(
    org_id: &str,
    incident_id: &str,
    user_email: &str,
) -> Result<HashMap<String, String>, errors::Error> {
    // The primary, so an answer shows on the reload right after it was given.
    outcomes_of_with(get_orm_client_rw().await, org_id, incident_id, user_email).await
}

pub async fn outcomes_of_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
    user_email: &str,
) -> Result<HashMap<String, String>, errors::Error> {
    let rows = Entity::find()
        .filter(Column::OrgId.eq(fit(org_id, 256)))
        .filter(Column::IncidentId.eq(fit(incident_id, 256)))
        .filter(Column::UserEmail.eq(fit(user_email, 256)))
        .all(conn)
        .await
        .map_err(db_err)?;
    Ok(rows.into_iter().map(|r| (r.report_id, r.outcome)).collect())
}

/// Removes the answers to reports that fell out of an incident's history.
pub async fn delete_by_reports(org_id: &str, report_ids: &[String]) -> Result<(), errors::Error> {
    delete_by_reports_with(get_orm_client_rw().await, org_id, report_ids).await
}

pub async fn delete_by_reports_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    report_ids: &[String],
) -> Result<(), errors::Error> {
    if report_ids.is_empty() {
        return Ok(());
    }
    Entity::delete_many()
        .filter(Column::OrgId.eq(fit(org_id, 256)))
        .filter(Column::ReportId.is_in(report_ids.iter().map(|id| fit(id, 64))))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Removes every answer of an org; the incidents they describe go with it.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await
        .map_err(db_err)?;
    Ok(())
}

async fn find<C: ConnectionTrait>(
    conn: &C,
    answer: &Answer<'_>,
) -> Result<Option<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(fit(answer.org_id, 256)))
        .filter(Column::ReportId.eq(fit(answer.report_id, 64)))
        .filter(Column::UserEmail.eq(fit(answer.user_email, 256)))
        .one(conn)
        .await
        .map_err(db_err)
}

async fn update<C: ConnectionTrait>(
    conn: &C,
    found: Model,
    answer: &Answer<'_>,
    now: i64,
) -> Result<Model, errors::Error> {
    let mut record: ActiveModel = found.into();
    record.outcome = Set(answer.outcome.to_string());
    record.reason = Set(answer.reason.map(str::to_string));
    record.updated_at = Set(now);
    Entity::update(record).exec(conn).await.map_err(db_err)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, Schema};

    use super::*;

    fn answer<'a>(user: &'a str, outcome: &'a str, reason: Option<&'a str>) -> Answer<'a> {
        Answer {
            org_id: "o",
            incident_id: "inc",
            report_id: "rep",
            user_email: user,
            outcome,
            reason,
        }
    }

    #[tokio::test]
    async fn one_answer_per_report_and_user_and_the_latest_wins() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        // The unique key the migration creates.
        db.execute_unprepared(
            "CREATE UNIQUE INDEX uq ON rca_feedback (org_id, report_id, user_email)",
        )
        .await
        .unwrap();

        let first = upsert_with(&db, answer("a@x", "yes", None), 1)
            .await
            .unwrap();
        let again = upsert_with(&db, answer("a@x", "yes", None), 2)
            .await
            .unwrap();
        assert_eq!(first.id, again.id);
        let changed = upsert_with(&db, answer("a@x", "partly", Some("only the pool")), 3)
            .await
            .unwrap();
        assert_eq!(changed.id, first.id);
        assert_eq!(changed.outcome, "partly");
        assert_eq!(changed.reason.as_deref(), Some("only the pool"));
        assert_eq!((changed.created_at, changed.updated_at), (1, 3));
        upsert_with(&db, answer("b@x", "no", None), 4)
            .await
            .unwrap();
        assert_eq!(Entity::find().all(&db).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_caller_reads_only_their_answers_and_pruned_reports_lose_theirs() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        let on = |report_id, user, outcome| Answer {
            org_id: "o",
            incident_id: "inc",
            report_id,
            user_email: user,
            outcome,
            reason: None,
        };
        upsert_with(&db, on("r1", "a@x", "yes"), 1).await.unwrap();
        upsert_with(&db, on("r2", "a@x", "no"), 1).await.unwrap();
        upsert_with(&db, on("r1", "b@x", "partly"), 1)
            .await
            .unwrap();

        let mine = outcomes_of_with(&db, "o", "inc", "a@x").await.unwrap();
        assert_eq!(mine.len(), 2);
        assert_eq!(mine["r1"], "yes");
        assert!(
            outcomes_of_with(&db, "o", "other", "a@x")
                .await
                .unwrap()
                .is_empty()
        );

        delete_by_reports_with(&db, "o", &[]).await.unwrap();
        delete_by_reports_with(&db, "o", &["r1".to_string()])
            .await
            .unwrap();
        let left = Entity::find().all(&db).await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].report_id, "r2");
    }
}
