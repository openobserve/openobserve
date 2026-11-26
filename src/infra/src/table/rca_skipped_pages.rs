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
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, FromQueryResult, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, Set, sea_query::OnConflict,
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

/// Where a page of the incident's run list starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageStart {
    Newest,
    /// Below a cursor at this time, µs.
    Below(i64),
    /// The cursor is neither a stored run nor a v1 report, so the page holds no skipped pages.
    Lost,
}

impl PageStart {
    /// `cursor_at_us` is the cursor's time when it names a stored run or a v1 report.
    pub fn of(cursor: Option<&str>, cursor_at_us: Option<i64>) -> Self {
        match (cursor, cursor_at_us) {
            (None, _) => Self::Newest,
            (Some(_), Some(at_us)) => Self::Below(at_us),
            (Some(_), None) => Self::Lost,
        }
    }
}

/// What a skipped page shows; the per-recipient rows of one refusal share all of it.
#[derive(Debug, FromQueryResult)]
struct PageFields {
    at_us: i64,
    reason: String,
    covering_run_id: String,
    covering_run_number: Option<i32>,
    retry_after_us: Option<i64>,
    cooldown_us: Option<i64>,
}

impl From<Model> for PageFields {
    fn from(row: Model) -> Self {
        Self {
            at_us: row.at_us,
            reason: row.reason,
            covering_run_id: row.covering_run_id,
            covering_run_number: row.covering_run_number,
            retry_after_us: row.retry_after_us,
            cooldown_us: row.cooldown_us,
        }
    }
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
/// Returns the pages this call stored.
pub async fn insert_in<'a, C: ConnectionTrait>(
    conn: &C,
    pages: &'a [NewSkippedPage],
) -> Result<Vec<&'a NewSkippedPage>, DbErr> {
    let mut stored = Vec::new();
    for page in pages {
        let covering_run_number = page
            .covering_run_number
            .map(i32::try_from)
            .transpose()
            .map_err(|e| DbErr::Type(e.to_string()))?;
        let inserted = Entity::insert(ActiveModel {
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
        if inserted > 0 {
            stored.push(page);
        }
    }
    Ok(stored)
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

/// One entry per refused page, newest first, from `start` down to `oldest_shown_us` inclusive.
pub async fn list_for_incident(
    org_id: &str,
    incident_id: &str,
    start: PageStart,
    oldest_shown_us: Option<i64>,
    limit: u64,
) -> Result<Vec<RcaSkippedPage>, DbErr> {
    list_for_incident_in(
        get_orm_client_ro().await,
        org_id,
        incident_id,
        start,
        oldest_shown_us,
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
    start: PageStart,
    oldest_shown_us: Option<i64>,
    limit: u64,
) -> Result<Vec<RcaSkippedPage>, DbErr> {
    let mut query = Entity::find()
        .select_only()
        .column(Column::AtUs)
        .column(Column::Reason)
        .column(Column::CoveringRunId)
        .column_as(Column::CoveringRunNumber.max(), "covering_run_number")
        .column_as(Column::RetryAfterUs.max(), "retry_after_us")
        .column_as(Column::CooldownUs.max(), "cooldown_us")
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IncidentId.eq(incident_id));
    match start {
        PageStart::Newest => {}
        PageStart::Below(at_us) => query = query.filter(Column::AtUs.lt(at_us)),
        PageStart::Lost => return Ok(Vec::new()),
    }
    if let Some(at_us) = oldest_shown_us {
        query = query.filter(Column::AtUs.gte(at_us));
    }
    // One refusal writes a row per recipient; they share the refusal time and covering run.
    Ok(query
        .group_by(Column::AtUs)
        .group_by(Column::Reason)
        .group_by(Column::CoveringRunId)
        .order_by_desc(Column::AtUs)
        .order_by_desc(Column::CoveringRunId)
        .limit(limit)
        .into_model::<PageFields>()
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
        .filter_map(|row| to_page(row.into()))
        .collect())
}

fn to_page(row: PageFields) -> Option<RcaSkippedPage> {
    let reason = match SkipReason::from_str(&row.reason) {
        Ok(reason) => reason,
        Err(error) => {
            log::warn!(
                "[RCA_SKIPPED_PAGES] page covered by {} has unknown reason: {error}",
                row.covering_run_id
            );
            return None;
        }
    };
    let covering_run_number = match row.covering_run_number.map(u32::try_from).transpose() {
        Ok(number) => number,
        Err(error) => {
            log::warn!(
                "[RCA_SKIPPED_PAGES] page covered by {} has invalid covering run number: {error}",
                row.covering_run_id
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
        let first = insert_in(&db, std::slice::from_ref(&page)).await.unwrap();
        assert_eq!(first.len(), 1);
        let again = insert_in(&db, std::slice::from_ref(&page)).await.unwrap();
        assert!(again.is_empty(), "a repeated page is not stored again");
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
        for (oldest_shown, start, limit, expected) in [
            (Some(20), PageStart::Below(40), 10, vec![30, 20]),
            (Some(20), PageStart::Below(40), 1, vec![30]),
            (None, PageStart::Below(20), 10, vec![10]),
            (Some(30), PageStart::Newest, 10, vec![40, 30]),
            (None, PageStart::Newest, 0, vec![]),
            (None, PageStart::Lost, 10, vec![]),
        ] {
            let rows = list_for_incident_in(&db, ORG, "incident_1", start, oldest_shown, limit)
                .await
                .unwrap();
            assert_eq!(
                rows.iter().map(|row| row.at_us).collect::<Vec<_>>(),
                expected
            );
        }
    }

    /// Runs at 50 and 40, v1 reports at 30, 20 and 10, limit 3: page 1 ends at the v1 report at 30.
    #[tokio::test]
    async fn run_list_pages_show_each_skipped_page_once() {
        let db = db().await;
        let pages: Vec<_> = [45, 41, 35, 30, 25, 5]
            .into_iter()
            .map(|at_us| page(&format!("firing_{at_us}"), at_us))
            .collect();
        insert_in(&db, &pages).await.unwrap();

        let first = list_for_incident_in(
            &db,
            ORG,
            "incident_1",
            PageStart::of(None, None),
            Some(30),
            100,
        )
        .await
        .unwrap();
        let v1_cursor = PageStart::of(Some("v1_report_30"), Some(30));
        let second = list_for_incident_in(&db, ORG, "incident_1", v1_cursor, None, 100)
            .await
            .unwrap();
        let seen: Vec<i64> = first.iter().chain(&second).map(|page| page.at_us).collect();
        assert_eq!(seen, [45, 41, 35, 30, 25, 5]);

        // A cursor pruned between two requests, or a v1 id no report has, repeats nothing.
        let lost = PageStart::of(Some("pruned_run"), None);
        assert_eq!(lost, PageStart::Lost);
        let rows = list_for_incident_in(&db, ORG, "incident_1", lost, None, 100)
            .await
            .unwrap();
        assert!(rows.is_empty(), "{rows:?}");
    }

    #[tokio::test]
    async fn one_refusal_lists_once_however_many_recipients_it_had() {
        let db = db().await;
        let mut second_recipient = page("firing_b", 20);
        second_recipient.response_id = Some("response_2".to_string());
        let mut other_run = page("firing_c", 20);
        other_run.covering_run_id = "run_2".to_string();
        insert_in(
            &db,
            &[
                page("firing_a", 10),
                page("firing_b", 20),
                second_recipient,
                other_run,
            ],
        )
        .await
        .unwrap();
        assert_eq!(Entity::find().count(&db).await.unwrap(), 4);
        let rows = list_for_incident_in(&db, ORG, "incident_1", PageStart::Newest, None, 2)
            .await
            .unwrap();
        assert_eq!(
            rows.iter()
                .map(|row| (row.at_us, row.covering_run_id.as_str()))
                .collect::<Vec<_>>(),
            [(20, "run_2"), (20, "run_1")]
        );
        assert_eq!(rows[1].covering_run_number, Some(3));
        assert_eq!(rows[1].retry_after_us, Some(120));
    }

    /// The grouped listing on the configured store (Postgres in CI), not only in-memory SQLite.
    #[tokio::test]
    async fn the_grouped_listing_runs_on_the_meta_store() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("skipped_pages");
        let at = |firing_key: &str, response_id: &str, at_us: i64| NewSkippedPage {
            org_id: org.clone(),
            response_id: Some(response_id.to_string()),
            ..page(firing_key, at_us)
        };
        let pages = [
            at("a", "response_1", 10),
            at("b", "response_1", 20),
            at("b", "response_2", 20),
        ];
        insert_in(get_orm_client_rw().await, &pages).await.unwrap();
        let newest = list_for_incident(&org, "incident_1", PageStart::Newest, None, 100)
            .await
            .unwrap();
        assert_eq!(
            newest.iter().map(|page| page.at_us).collect::<Vec<_>>(),
            [20, 10]
        );
        assert_eq!(newest[0].covering_run_number, Some(3));
        let below = list_for_incident(&org, "incident_1", PageStart::Below(20), None, 100)
            .await
            .unwrap();
        assert_eq!(
            below.iter().map(|page| page.at_us).collect::<Vec<_>>(),
            [10]
        );
        delete_by_org(&org).await.unwrap();
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
