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

//! Sent downtime notifications, one row per `(downtime_id, window_start, event)`.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    sea_query::OnConflict,
};

use super::entity::downtime_notifications::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DowntimeNotification {
    pub id: String,
    pub org: String,
    pub downtime_id: String,
    pub window_start: i64,
    pub event: String,
    pub sent_at: i64,
    pub destinations: serde_json::Value,
    pub result: Option<String>,
}

impl From<Model> for DowntimeNotification {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org: m.org,
            downtime_id: m.downtime_id,
            window_start: m.window_start,
            event: m.event,
            sent_at: m.sent_at,
            destinations: m.destinations,
            result: m.result,
        }
    }
}

/// False when a row for the same downtime, window and event already exists.
pub async fn insert_if_absent(record: &DowntimeNotification) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    insert_if_absent_with(client, record).await
}

/// Newest first by `sent_at`.
pub async fn list_for_downtime(
    org: &str,
    downtime_id: &str,
    limit: u64,
) -> Result<Vec<DowntimeNotification>, errors::Error> {
    let client = get_orm_client_ro().await;
    list_for_downtime_with(client, org, downtime_id, limit).await
}

pub async fn delete_for_downtime(org: &str, downtime_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_for_downtime_with(client, org, downtime_id).await
}

pub async fn insert_if_absent_with<C: ConnectionTrait>(
    conn: &C,
    record: &DowntimeNotification,
) -> Result<bool, errors::Error> {
    let inserted = Entity::insert(to_active_model(record))
        .on_conflict(
            OnConflict::columns([Column::DowntimeId, Column::WindowStart, Column::Event])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(inserted > 0)
}

pub async fn list_for_downtime_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    downtime_id: &str,
    limit: u64,
) -> Result<Vec<DowntimeNotification>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::DowntimeId.eq(downtime_id))
        .order_by_desc(Column::SentAt)
        .order_by_desc(Column::Id)
        .limit(limit)
        .all(conn)
        .await?
        .into_iter()
        .map(DowntimeNotification::from)
        .collect())
}

pub async fn delete_for_downtime_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    downtime_id: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::DowntimeId.eq(downtime_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

fn to_active_model(r: &DowntimeNotification) -> ActiveModel {
    ActiveModel {
        id: Set(r.id.clone()),
        org: Set(r.org.clone()),
        downtime_id: Set(r.downtime_id.clone()),
        window_start: Set(r.window_start),
        event: Set(r.event.clone()),
        sent_at: Set(r.sent_at),
        destinations: Set(r.destinations.clone()),
        result: Set(r.result.clone()),
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_downtime_notifications_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_downtime_notifications_for_test(&db).await.unwrap();
        db
    }

    fn record(id: &str, downtime_id: &str, window_start: i64, event: &str) -> DowntimeNotification {
        DowntimeNotification {
            id: id.to_string(),
            org: "acme".to_string(),
            downtime_id: downtime_id.to_string(),
            window_start,
            event: event.to_string(),
            sent_at: window_start,
            destinations: serde_json::json!(["slack"]),
            result: None,
        }
    }

    fn ids(rows: &[DowntimeNotification]) -> Vec<&str> {
        rows.iter().map(|r| r.id.as_str()).collect()
    }

    #[tokio::test]
    async fn insert_if_absent_refuses_a_second_row_for_the_same_window_and_event() {
        let db = db().await;
        let first = record("n1", "d1", 10, "start");
        assert!(insert_if_absent_with(&db, &first).await.unwrap());
        assert!(
            !insert_if_absent_with(&db, &record("n2", "d1", 10, "start"))
                .await
                .unwrap()
        );
        assert!(
            insert_if_absent_with(&db, &record("n3", "d1", 10, "end"))
                .await
                .unwrap()
        );
        assert!(
            insert_if_absent_with(&db, &record("n4", "d1", 20, "start"))
                .await
                .unwrap()
        );

        let rows = list_for_downtime_with(&db, "acme", "d1", 10).await.unwrap();
        assert_eq!(ids(&rows), ["n4", "n3", "n1"]);
        assert_eq!(rows[2], first);
    }

    #[tokio::test]
    async fn list_for_downtime_filters_by_org_and_downtime_and_honours_the_limit() {
        let db = db().await;
        for r in [
            record("n1", "d1", 10, "start"),
            record("n2", "d1", 20, "start"),
            record("n3", "d2", 30, "start"),
        ] {
            insert_if_absent_with(&db, &r).await.unwrap();
        }
        let mut foreign = record("n4", "d1", 40, "start");
        foreign.org = "other".to_string();
        insert_if_absent_with(&db, &foreign).await.unwrap();

        assert_eq!(
            ids(&list_for_downtime_with(&db, "acme", "d1", 10).await.unwrap()),
            ["n2", "n1"]
        );
        assert_eq!(
            ids(&list_for_downtime_with(&db, "acme", "d1", 1).await.unwrap()),
            ["n2"]
        );
        assert_eq!(
            ids(&list_for_downtime_with(&db, "other", "d1", 10)
                .await
                .unwrap()),
            ["n4"]
        );
    }

    #[tokio::test]
    async fn delete_for_downtime_spares_other_downtimes_and_orgs() {
        let db = db().await;
        let mut foreign = record("n4", "d1", 40, "start");
        foreign.org = "other".to_string();
        for r in [
            record("n1", "d1", 10, "start"),
            record("n2", "d1", 20, "start"),
            record("n3", "d2", 30, "start"),
            foreign,
        ] {
            insert_if_absent_with(&db, &r).await.unwrap();
        }

        assert_eq!(
            delete_for_downtime_with(&db, "acme", "d1").await.unwrap(),
            2
        );
        assert!(
            list_for_downtime_with(&db, "acme", "d1", 10)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            ids(&list_for_downtime_with(&db, "acme", "d2", 10).await.unwrap()),
            ["n3"]
        );
        assert_eq!(
            ids(&list_for_downtime_with(&db, "other", "d1", 10)
                .await
                .unwrap()),
            ["n4"]
        );
    }
}
