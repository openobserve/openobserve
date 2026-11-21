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

use std::str::FromStr;

use config::meta::alerts::rca_runs::{RcaSkippedPage, RunSubjectType, SkipReason};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, Set, sea_query::OnConflict,
};
use sha2::{Digest, Sha256};

use super::entity::rca_skipped_pages::{ActiveModel, Column, Entity, Model};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

#[derive(Debug, Clone)]
pub struct NewSkippedPage {
    pub org_id: String,
    pub subject_type: RunSubjectType,
    pub subject_id: String,
    pub incident_id: Option<String>,
    pub response_id: Option<String>,
    pub firing_key: String,
    pub reason: SkipReason,
    pub covering_run_id: String,
    pub covering_run_number: Option<u32>,
    pub retry_after_us: Option<i64>,
    pub cooldown_us: Option<i64>,
    pub at_us: i64,
}

/// Hex SHA-256 of org|subject_type|subject_id|firing_key|response_id|covering_run_id.
pub fn skipped_page_id(page: &NewSkippedPage) -> String {
    let key = format!(
        "{}|{}|{}|{}|{}|{}",
        page.org_id,
        page.subject_type.as_str(),
        page.subject_id,
        page.firing_key,
        page.response_id.as_deref().unwrap_or(""),
        page.covering_run_id,
    );
    hex::encode(Sha256::digest(key.as_bytes()))
}

/// Conflicting ids write nothing, so repeated deliveries cannot duplicate a skipped page.
pub async fn insert_in<C: ConnectionTrait>(
    conn: &C,
    pages: &[NewSkippedPage],
) -> Result<(), DbErr> {
    for page in pages {
        let covering_run_number = page
            .covering_run_number
            .map(i32::try_from)
            .transpose()
            .map_err(|e| DbErr::Type(e.to_string()))?;
        Entity::insert(ActiveModel {
            id: Set(skipped_page_id(page)),
            org_id: Set(page.org_id.clone()),
            subject_type: Set(page.subject_type.as_str().to_string()),
            subject_id: Set(page.subject_id.clone()),
            incident_id: Set(page.incident_id.clone()),
            response_id: Set(page.response_id.clone()),
            reason: Set(page.reason.as_str().to_string()),
            covering_run_id: Set(page.covering_run_id.clone()),
            covering_run_number: Set(covering_run_number),
            retry_after_us: Set(page.retry_after_us),
            cooldown_us: Set(page.cooldown_us),
            at_us: Set(page.at_us),
        })
        .on_conflict(OnConflict::column(Column::Id).do_nothing().to_owned())
        .exec_without_returning(conn)
        .await?;
    }
    Ok(())
}

/// Timestamp ties retain the greatest ids, so repeated pruning keeps the same rows.
pub async fn retain_newest_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    subject_type: RunSubjectType,
    subject_id: &str,
    keep: usize,
) -> Result<(), DbErr> {
    let retained = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SubjectType.eq(subject_type.as_str()))
        .filter(Column::SubjectId.eq(subject_id))
        .order_by_desc(Column::AtUs)
        .order_by_desc(Column::Id)
        .limit(keep as u64)
        .into_query();
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SubjectType.eq(subject_type.as_str()))
        .filter(Column::SubjectId.eq(subject_id))
        .filter(Column::Id.not_in_subquery(retained))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_for_runs_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    covering_run_ids: &[String],
) -> Result<(), DbErr> {
    if covering_run_ids.is_empty() {
        return Ok(());
    }
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::CoveringRunId.is_in(covering_run_ids.iter().map(String::as_str)))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_for_incident(org_id: &str, incident_id: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IncidentId.eq(incident_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

/// Uses inclusive `newer_than_us` and exclusive `older_than_us` bounds, newest first.
pub async fn list_for_incident(
    org_id: &str,
    incident_id: &str,
    newer_than_us: Option<i64>,
    older_than_us: Option<i64>,
    limit: u64,
) -> Result<Vec<RcaSkippedPage>, DbErr> {
    list_for_incident_in(
        get_orm_client_ro().await,
        org_id,
        incident_id,
        newer_than_us,
        older_than_us,
        limit,
    )
    .await
}

pub async fn list_for_response(
    org_id: &str,
    response_id: &str,
) -> Result<Vec<RcaSkippedPage>, DbErr> {
    list_for_response_in(get_orm_client_ro().await, org_id, response_id).await
}

async fn list_for_incident_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
    newer_than_us: Option<i64>,
    older_than_us: Option<i64>,
    limit: u64,
) -> Result<Vec<RcaSkippedPage>, DbErr> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IncidentId.eq(incident_id));
    if let Some(at_us) = newer_than_us {
        query = query.filter(Column::AtUs.gte(at_us));
    }
    if let Some(at_us) = older_than_us {
        query = query.filter(Column::AtUs.lt(at_us));
    }
    Ok(query
        .order_by_desc(Column::AtUs)
        .order_by_desc(Column::Id)
        .limit(limit)
        .all(conn)
        .await?
        .into_iter()
        .filter_map(to_page)
        .collect())
}

async fn list_for_response_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    response_id: &str,
) -> Result<Vec<RcaSkippedPage>, DbErr> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ResponseId.eq(response_id))
        .order_by_desc(Column::AtUs)
        .order_by_desc(Column::Id)
        .all(conn)
        .await?
        .into_iter()
        .filter_map(to_page)
        .collect())
}

fn to_page(row: Model) -> Option<RcaSkippedPage> {
    let reason = match SkipReason::from_str(&row.reason) {
        Ok(reason) => reason,
        Err(error) => {
            log::warn!(
                "[RCA_SKIPPED_PAGES] row {} has unknown reason: {error}",
                row.id
            );
            return None;
        }
    };
    let covering_run_number = match row.covering_run_number.map(u32::try_from).transpose() {
        Ok(number) => number,
        Err(error) => {
            log::warn!(
                "[RCA_SKIPPED_PAGES] row {} has invalid covering run number: {error}",
                row.id
            );
            return None;
        }
    };
    Some(RcaSkippedPage {
        at_us: row.at_us,
        reason,
        covering_run_id: row.covering_run_id,
        covering_run_number,
        retry_after_us: row.retry_after_us,
        cooldown_us: row.cooldown_us,
    })
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ConnectOptions, Database, DatabaseConnection, PaginatorTrait, Schema, sea_query::Expr,
    };

    use super::*;

    const ORG: &str = "acme";

    async fn db() -> DatabaseConnection {
        let mut options = ConnectOptions::new("sqlite::memory:".to_string());
        options.max_connections(1);
        let db = Database::connect(options).await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&table)).await.unwrap();
        db
    }

    fn page(firing_key: &str, at_us: i64) -> NewSkippedPage {
        NewSkippedPage {
            org_id: ORG.to_string(),
            subject_type: RunSubjectType::Incident,
            subject_id: "incident_1".to_string(),
            incident_id: Some("incident_1".to_string()),
            response_id: Some("response_1".to_string()),
            firing_key: firing_key.to_string(),
            reason: SkipReason::CoolingDown,
            covering_run_id: "run_1".to_string(),
            covering_run_number: Some(3),
            retry_after_us: Some(at_us + 100),
            cooldown_us: Some(100),
            at_us,
        }
    }

    #[tokio::test]
    async fn repeated_deliveries_insert_once_and_ids_are_scoped_by_org() {
        let db = db().await;
        let page = page("firing_1", 10);
        insert_in(&db, std::slice::from_ref(&page)).await.unwrap();
        insert_in(&db, std::slice::from_ref(&page)).await.unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 1);
        let id = skipped_page_id(&page);
        assert_eq!(id.len(), 64);
        let mut other_org = page.clone();
        other_org.org_id = "other".to_string();
        assert_ne!(id, skipped_page_id(&other_org));
        insert_in(&db, &[other_org]).await.unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 2);
        let stored = list_for_response_in(&db, ORG, "response_1").await.unwrap();
        assert_eq!(
            stored,
            [RcaSkippedPage {
                at_us: 10,
                reason: SkipReason::CoolingDown,
                covering_run_id: "run_1".to_string(),
                covering_run_number: Some(3),
                retry_after_us: Some(110),
                cooldown_us: Some(100),
            }]
        );
    }

    #[tokio::test]
    async fn retention_keeps_newest_rows_and_breaks_timestamp_ties_by_id() {
        let db = db().await;
        let pages = [page("old", 10), page("a", 20), page("b", 20), page("c", 20)];
        insert_in(&db, &pages).await.unwrap();
        let mut other_subject = page("other_subject", 30);
        other_subject.subject_id = "incident_2".to_string();
        let mut other_type = page("other_type", 30);
        other_type.subject_type = RunSubjectType::Alert;
        let mut other_org = page("other_org", 30);
        other_org.org_id = "other".to_string();
        insert_in(&db, &[other_subject, other_type, other_org])
            .await
            .unwrap();
        retain_newest_in(&db, ORG, RunSubjectType::Incident, "incident_1", 2)
            .await
            .unwrap();
        let actual: Vec<String> = Entity::find()
            .select_only()
            .column(Column::Id)
            .filter(Column::OrgId.eq(ORG))
            .filter(Column::SubjectType.eq("incident"))
            .filter(Column::SubjectId.eq("incident_1"))
            .order_by_desc(Column::Id)
            .into_tuple()
            .all(&db)
            .await
            .unwrap();
        let mut expected: Vec<String> = pages[1..].iter().map(skipped_page_id).collect();
        expected.sort_by(|a, b| b.cmp(a));
        expected.truncate(2);
        assert_eq!(actual, expected);
        assert_eq!(Entity::find().count(&db).await.unwrap(), 5);
        retain_newest_in(&db, ORG, RunSubjectType::Incident, "incident_1", 0)
            .await
            .unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 3);
    }

    #[tokio::test]
    async fn incident_history_applies_half_open_bounds_and_limit() {
        let db = db().await;
        let mut other_incident = page("other_incident", 25);
        other_incident.incident_id = Some("incident_2".to_string());
        let mut other_org = page("other_org", 25);
        other_org.org_id = "other".to_string();
        insert_in(
            &db,
            &[
                page("a", 10),
                page("b", 20),
                page("c", 30),
                page("d", 40),
                other_incident,
                other_org,
            ],
        )
        .await
        .unwrap();
        for (newer, older, limit, expected) in [
            (Some(20), Some(40), 10, vec![30, 20]),
            (Some(20), Some(40), 1, vec![30]),
            (None, Some(20), 10, vec![10]),
            (Some(30), None, 10, vec![40, 30]),
            (None, None, 0, vec![]),
        ] {
            let rows = list_for_incident_in(&db, ORG, "incident_1", newer, older, limit)
                .await
                .unwrap();
            assert_eq!(
                rows.iter().map(|row| row.at_us).collect::<Vec<_>>(),
                expected
            );
        }
    }

    #[tokio::test]
    async fn response_history_filters_by_org_and_response_and_skips_unknown_reasons() {
        let db = db().await;
        let mut other_response = page("other_response", 40);
        other_response.response_id = Some("response_2".to_string());
        let mut other_org = page("other_org", 50);
        other_org.org_id = "other".to_string();
        let unknown = page("unknown", 60);
        let unknown_id = skipped_page_id(&unknown);
        insert_in(
            &db,
            &[
                page("a", 10),
                page("b", 30),
                other_response,
                other_org,
                unknown,
            ],
        )
        .await
        .unwrap();
        Entity::update_many()
            .col_expr(Column::Reason, Expr::value("future_reason"))
            .filter(Column::Id.eq(unknown_id))
            .exec(&db)
            .await
            .unwrap();
        let rows = list_for_response_in(&db, ORG, "response_1").await.unwrap();
        assert_eq!(
            rows.iter().map(|row| row.at_us).collect::<Vec<_>>(),
            [30, 10]
        );
    }
}
