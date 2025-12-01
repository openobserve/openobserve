// Copyright 2025 OpenObserve Inc.
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

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, Schema, Set,
    entity::prelude::*,
};
use serde::{Deserialize, Serialize};
use svix_ksuid::KsuidLike;

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, ORM_CLIENT_DDL, connect_to_orm, connect_to_orm_ddl},
    errors::{self, DbError, Error},
};

/// Service Streams Table
///
/// Stores services with their metadata, dimensions, and associated streams.
/// Primary key: id (KSUID)
/// Unique index: (org_id, service_key)
///
/// service_key format: "service_name?dimension1=value1&dimension2=value2"
/// Example: "api-server?environment=production&host=server01"
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "service_streams")]
pub struct Model {
    /// 27-character human readable KSUID
    #[sea_orm(
        primary_key,
        column_type = "String(StringLen::N(27))",
        auto_increment = false
    )]
    pub id: String,

    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub org_id: String,

    #[sea_orm(column_type = "String(StringLen::N(512))")]
    pub service_key: String,

    /// Service name (e.g., "api-server", "web-server")
    #[sea_orm(column_type = "String(StringLen::N(256))")]
    pub service_name: String,

    /// Dimensions as JSON: {"environment": "production", "version": "1.0"}
    #[sea_orm(column_type = "Text")]
    pub dimensions: String,

    /// Streams as JSON: {"logs": [...], "metrics": [...], "traces": [...]}
    #[sea_orm(column_type = "Text")]
    pub streams: String,

    /// When this service was first discovered (microseconds since epoch)
    pub first_seen: i64,

    /// When this service was last seen (microseconds since epoch)
    pub last_seen: i64,

    /// Additional metadata as JSON (optional)
    #[sea_orm(column_type = "Text", nullable)]
    pub metadata: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(FromQueryResult, Debug, Serialize, Deserialize)]
pub struct ServiceRecord {
    pub org_id: String,
    pub service_key: String,
    pub service_name: String,
    pub dimensions: String,
    pub streams: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub metadata: Option<String>,
}

impl ServiceRecord {
    pub fn new(
        org_id: &str,
        service_key: &str,
        service_name: &str,
        dimensions: &str,
        streams: &str,
        first_seen: i64,
        last_seen: i64,
    ) -> Self {
        Self {
            org_id: org_id.to_owned(),
            service_key: service_key.to_owned(),
            service_name: service_name.to_owned(),
            dimensions: dimensions.to_owned(),
            streams: streams.to_owned(),
            first_seen,
            last_seen,
            metadata: None,
        }
    }
}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
    Ok(())
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT_DDL.get_or_init(connect_to_orm_ddl).await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client
        .execute(builder.build(&create_table_stmt))
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Add or update a service (upsert)
pub async fn put(record: ServiceRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Try to find existing record by unique constraint (org_id, service_key)
    let existing = Entity::find()
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::ServiceKey.eq(&record.service_key))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    if let Some(existing_record) = existing {
        // Update existing record
        let mut active_model: ActiveModel = existing_record.into();
        active_model.service_name = Set(record.service_name);
        active_model.dimensions = Set(record.dimensions);
        active_model.streams = Set(record.streams);
        active_model.first_seen = Set(record.first_seen);
        active_model.last_seen = Set(record.last_seen);
        active_model.metadata = Set(record.metadata);

        active_model
            .update(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    } else {
        // Insert new record
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let active_model = ActiveModel {
            id: Set(id),
            org_id: Set(record.org_id),
            service_key: Set(record.service_key),
            service_name: Set(record.service_name),
            dimensions: Set(record.dimensions),
            streams: Set(record.streams),
            first_seen: Set(record.first_seen),
            last_seen: Set(record.last_seen),
            metadata: Set(record.metadata),
        };

        Entity::insert(active_model)
            .exec(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    }

    Ok(())
}

/// Get a specific service
pub async fn get(org_id: &str, service_key: &str) -> Result<Option<ServiceRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceKey.eq(service_key))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(|r| ServiceRecord {
        org_id: r.org_id,
        service_key: r.service_key,
        service_name: r.service_name,
        dimensions: r.dimensions,
        streams: r.streams,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        metadata: r.metadata,
    }))
}

/// List all services for an organization
pub async fn list(org_id: &str) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records
        .into_iter()
        .map(|r| ServiceRecord {
            org_id: r.org_id,
            service_key: r.service_key,
            service_name: r.service_name,
            dimensions: r.dimensions,
            streams: r.streams,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            metadata: r.metadata,
        })
        .collect())
}

/// List services by service name (across all dimension combinations)
pub async fn list_by_name(
    org_id: &str,
    service_name: &str,
) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceName.eq(service_name))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records
        .into_iter()
        .map(|r| ServiceRecord {
            org_id: r.org_id,
            service_key: r.service_key,
            service_name: r.service_name,
            dimensions: r.dimensions,
            streams: r.streams,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            metadata: r.metadata,
        })
        .collect())
}

/// Delete a specific service
pub async fn delete(org_id: &str, service_key: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceKey.eq(service_key))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Delete all services for an organization
pub async fn delete_all(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Get total count of services for an organization
pub async fn count(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_put_and_get_service() {
        let _ = delete_all("test_org").await;

        let org_id = "test_org";
        let service_key = "api-server?environment=production";

        let record = ServiceRecord::new(
            org_id,
            service_key,
            "api-server",
            r#"{"environment":"production"}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        );

        put(record).await.unwrap();

        let retrieved = get(org_id, service_key).await.unwrap();
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.service_name, "api-server");
        assert_eq!(retrieved.dimensions, r#"{"environment":"production"}"#);
    }

    #[tokio::test]
    async fn test_upsert_service() {
        let _ = delete_all("test_org2").await;

        let org_id = "test_org2";
        let service_key = "web-server";

        // Insert
        let record1 = ServiceRecord::new(
            org_id,
            service_key,
            "web-server",
            r#"{}"#,
            r#"{"logs":["stream1"],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        );
        put(record1).await.unwrap();

        // Upsert with updated streams
        let record2 = ServiceRecord::new(
            org_id,
            service_key,
            "web-server",
            r#"{}"#,
            r#"{"logs":["stream1","stream2"],"metrics":[],"traces":[]}"#,
            1000000,
            2000000,
        );
        put(record2).await.unwrap();

        let retrieved = get(org_id, service_key).await.unwrap().unwrap();
        assert_eq!(retrieved.last_seen, 2000000);
        assert!(retrieved.streams.contains("stream2"));

        // Should only have 1 record (upsert, not duplicate)
        let count = count(org_id).await.unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn test_list_services() {
        let _ = delete_all("test_org3").await;

        let org_id = "test_org3";

        // Add multiple services
        put(ServiceRecord::new(
            org_id,
            "svc1",
            "svc1",
            r#"{}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        ))
        .await
        .unwrap();

        put(ServiceRecord::new(
            org_id,
            "svc2",
            "svc2",
            r#"{}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        ))
        .await
        .unwrap();

        let services = list(org_id).await.unwrap();
        assert_eq!(services.len(), 2);
    }

    #[tokio::test]
    async fn test_list_by_name() {
        let _ = delete_all("test_org4").await;

        let org_id = "test_org4";

        // Add same service with different dimensions
        put(ServiceRecord::new(
            org_id,
            "api?env=prod",
            "api",
            r#"{"env":"prod"}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        ))
        .await
        .unwrap();

        put(ServiceRecord::new(
            org_id,
            "api?env=staging",
            "api",
            r#"{"env":"staging"}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        ))
        .await
        .unwrap();

        put(ServiceRecord::new(
            org_id,
            "web",
            "web",
            r#"{}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        ))
        .await
        .unwrap();

        let api_services = list_by_name(org_id, "api").await.unwrap();
        assert_eq!(api_services.len(), 2);

        let web_services = list_by_name(org_id, "web").await.unwrap();
        assert_eq!(web_services.len(), 1);
    }

    #[tokio::test]
    async fn test_delete_service() {
        let _ = delete_all("test_org5").await;

        let org_id = "test_org5";
        let service_key = "delete-me";

        put(ServiceRecord::new(
            org_id,
            service_key,
            "delete-me",
            r#"{}"#,
            r#"{"logs":[],"metrics":[],"traces":[]}"#,
            1000000,
            1000000,
        ))
        .await
        .unwrap();

        delete(org_id, service_key).await.unwrap();

        let retrieved = get(org_id, service_key).await.unwrap();
        assert!(retrieved.is_none());
    }
}
