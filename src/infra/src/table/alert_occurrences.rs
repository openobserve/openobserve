// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Alert occurrence audit table operations.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::entity::alert_occurrences;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

#[derive(Clone, Debug, PartialEq)]
pub struct NewAlertOccurrence {
    pub occurrence_id: Option<String>,
    pub org_id: String,
    pub alert_id: String,
    pub alert_name: Option<String>,
    pub alert_updated_at: Option<i64>,
    pub config_hash: String,
    pub window_start: i64,
    pub window_end: i64,
    pub trigger_timestamp: i64,
    pub query_type: String,
    pub condition_operator: String,
    pub threshold_value: Option<i64>,
    pub matched_count: i64,
    pub result_preview: serde_json::Value,
    pub result_truncated: bool,
    pub query_took: Option<i64>,
    pub trace_id: Option<String>,
    pub created_at: i64,
    pub schema_version: i16,
}

pub async fn create_occurrence(
    occurrence: NewAlertOccurrence,
) -> Result<alert_occurrences::Model, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    create_occurrence_with_conn(client, occurrence).await
}

pub async fn get_occurrence(
    org_id: &str,
    occurrence_id: &str,
) -> Result<Option<alert_occurrences::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    get_occurrence_with_conn(client, org_id, occurrence_id).await
}

pub async fn list_occurrences(
    org_id: &str,
    alert_id: &str,
    limit: u64,
    offset: u64,
) -> Result<Vec<alert_occurrences::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    list_occurrences_with_conn(client, org_id, alert_id, limit, offset).await
}

pub async fn create_occurrence_with_conn<C>(
    conn: &C,
    occurrence: NewAlertOccurrence,
) -> Result<alert_occurrences::Model, errors::Error>
where
    C: ConnectionTrait,
{
    alert_occurrences::ActiveModel {
        occurrence_id: Set(occurrence
            .occurrence_id
            .unwrap_or_else(|| Ksuid::new(None, None).to_string())),
        org_id: Set(occurrence.org_id),
        alert_id: Set(occurrence.alert_id),
        alert_name: Set(occurrence.alert_name),
        alert_updated_at: Set(occurrence.alert_updated_at),
        config_hash: Set(occurrence.config_hash),
        window_start: Set(occurrence.window_start),
        window_end: Set(occurrence.window_end),
        trigger_timestamp: Set(occurrence.trigger_timestamp),
        query_type: Set(occurrence.query_type),
        condition_operator: Set(occurrence.condition_operator),
        threshold_value: Set(occurrence.threshold_value),
        matched_count: Set(occurrence.matched_count),
        result_preview: Set(occurrence.result_preview),
        result_truncated: Set(occurrence.result_truncated),
        query_took: Set(occurrence.query_took),
        trace_id: Set(occurrence.trace_id),
        created_at: Set(occurrence.created_at),
        schema_version: Set(occurrence.schema_version),
    }
    .insert(conn)
    .await
    .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

pub async fn get_occurrence_with_conn<C>(
    conn: &C,
    org_id: &str,
    occurrence_id: &str,
) -> Result<Option<alert_occurrences::Model>, errors::Error>
where
    C: ConnectionTrait,
{
    alert_occurrences::Entity::find_by_id(occurrence_id)
        .filter(alert_occurrences::Column::OrgId.eq(org_id))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

pub async fn list_occurrences_with_conn<C>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
    limit: u64,
    offset: u64,
) -> Result<Vec<alert_occurrences::Model>, errors::Error>
where
    C: ConnectionTrait,
{
    alert_occurrences::Entity::find()
        .filter(alert_occurrences::Column::OrgId.eq(org_id))
        .filter(alert_occurrences::Column::AlertId.eq(alert_id))
        .order_by_desc(alert_occurrences::Column::CreatedAt)
        .order_by_desc(alert_occurrences::Column::OccurrenceId)
        .limit(limit)
        .offset(offset)
        .all(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

pub async fn delete_older_than(cutoff: i64) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    alert_occurrences::Entity::delete_many()
        .filter(alert_occurrences::Column::CreatedAt.lt(cutoff))
        .exec(client)
        .await
        .map(|res| res.rows_affected)
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    alert_occurrences::Entity::delete_many()
        .filter(alert_occurrences::Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map(|_| ())
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DbBackend, Schema};

    use super::*;

    async fn test_db() -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let schema = Schema::new(DbBackend::Sqlite);
        db.execute(
            db.get_database_backend()
                .build(&schema.create_table_from_entity(alert_occurrences::Entity)),
        )
        .await
        .unwrap();
        db
    }

    fn occurrence(org_id: &str, alert_id: &str, created_at: i64) -> NewAlertOccurrence {
        NewAlertOccurrence {
            occurrence_id: None,
            org_id: org_id.to_string(),
            alert_id: alert_id.to_string(),
            alert_name: Some("cpu_high".to_string()),
            alert_updated_at: Some(1000),
            config_hash: "md5:abc".to_string(),
            window_start: created_at - 60,
            window_end: created_at,
            trigger_timestamp: created_at,
            query_type: "sql".to_string(),
            condition_operator: ">=".to_string(),
            threshold_value: Some(3),
            matched_count: 4,
            result_preview: serde_json::json!([{"count": 4}]),
            result_truncated: false,
            query_took: Some(10),
            trace_id: Some("trace-1".to_string()),
            created_at,
            schema_version: 1,
        }
    }

    #[tokio::test]
    async fn create_and_get_occurrence_is_org_scoped() {
        let db = test_db().await;
        let created = create_occurrence_with_conn(&db, occurrence("org1", "alert1", 100))
            .await
            .unwrap();

        assert_eq!(created.org_id, "org1");
        assert!(
            get_occurrence_with_conn(&db, "org1", &created.occurrence_id)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            get_occurrence_with_conn(&db, "org2", &created.occurrence_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn list_occurrences_filters_alert_and_sorts_newest_first() {
        let db = test_db().await;
        create_occurrence_with_conn(&db, occurrence("org1", "alert1", 100))
            .await
            .unwrap();
        create_occurrence_with_conn(&db, occurrence("org1", "alert1", 300))
            .await
            .unwrap();
        create_occurrence_with_conn(&db, occurrence("org1", "alert2", 200))
            .await
            .unwrap();

        let rows = list_occurrences_with_conn(&db, "org1", "alert1", 10, 0)
            .await
            .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].created_at, 300);
        assert_eq!(rows[1].created_at, 100);
    }

    #[tokio::test]
    async fn list_occurrences_applies_pagination() {
        let db = test_db().await;
        create_occurrence_with_conn(&db, occurrence("org1", "alert1", 100))
            .await
            .unwrap();
        create_occurrence_with_conn(&db, occurrence("org1", "alert1", 200))
            .await
            .unwrap();

        let rows = list_occurrences_with_conn(&db, "org1", "alert1", 1, 1)
            .await
            .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].created_at, 100);
    }
}
