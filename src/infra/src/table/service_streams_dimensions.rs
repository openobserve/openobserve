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

/// Service Streams Dimension Values Table
///
/// Tracks unique dimension values to detect high-cardinality dimensions.
/// Primary key: id (KSUID)
/// Unique index: (org_id, dimension_name, value_hash)
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "service_streams_dimensions")]
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

    #[sea_orm(column_type = "String(StringLen::N(256))")]
    pub dimension_name: String,

    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub value_hash: String,

    /// Actual dimension value (for reference/debugging)
    #[sea_orm(column_type = "String(StringLen::N(512))")]
    pub dimension_value: String,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Clone, FromQueryResult, Debug, Serialize, Deserialize)]
pub struct DimensionValueRecord {
    pub org_id: String,
    pub dimension_name: String,
    pub value_hash: String,
    pub dimension_value: String,
}

#[derive(FromQueryResult, Debug, Serialize, Deserialize)]
pub struct DimensionStats {
    pub dimension_name: String,
    pub value_count: i64,
}

impl DimensionValueRecord {
    pub fn new(
        org_id: &str,
        dimension_name: &str,
        value_hash: &str,
        dimension_value: &str,
    ) -> Self {
        Self {
            org_id: org_id.to_owned(),
            dimension_name: dimension_name.to_owned(),
            value_hash: value_hash.to_owned(),
            dimension_value: dimension_value.to_owned(),
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

/// Add a dimension value (idempotent - unique violation is OK)
pub async fn add(record: DimensionValueRecord) -> Result<(), errors::Error> {
    // Generate KSUID for new record
    let id = svix_ksuid::Ksuid::new(None, None).to_string();

    let record = ActiveModel {
        id: Set(id),
        org_id: Set(record.org_id),
        dimension_name: Set(record.dimension_name),
        value_hash: Set(record.value_hash),
        dimension_value: Set(record.dimension_value),
    };

    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::insert(record).exec(client).await;

    match res {
        Ok(_) => Ok(()),
        Err(DbErr::Exec(RuntimeErr::SqlxError(SqlxError::Database(e)))) => {
            // Unique violation is OK - value already tracked
            if e.is_unique_violation() {
                Ok(())
            } else {
                Err(Error::DbError(DbError::SeaORMError(e.to_string())))
            }
        }
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

/// Get all unique value hashes for a dimension
pub async fn get_dimension_values(
    org_id: &str,
    dimension_name: &str,
) -> Result<Vec<String>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DimensionName.eq(dimension_name))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records.into_iter().map(|r| r.value_hash).collect())
}

/// Get cardinality (count of unique values) for all dimensions in an org
///
/// Uses SQL GROUP BY aggregation to avoid loading all records into memory.
/// This is critical for orgs with 100K+ dimension values - loading all into
/// memory would cause OOM on queriers.
pub async fn get_all_dimension_stats(org_id: &str) -> Result<Vec<DimensionStats>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let backend = client.get_database_backend();

    // Use raw SQL with GROUP BY to aggregate in the database
    // This avoids loading potentially 100K+ records into memory
    let sql = match backend {
        sea_orm::DatabaseBackend::Postgres => {
            // PostgreSQL uses $1 for parameter placeholders
            r#"
                SELECT dimension_name, COUNT(DISTINCT value_hash) as value_count
                FROM service_streams_dimensions
                WHERE org_id = $1
                GROUP BY dimension_name
            "#
        }
        sea_orm::DatabaseBackend::MySql => {
            // MySQL uses ? for parameter placeholders
            r#"
                SELECT dimension_name, COUNT(DISTINCT value_hash) as value_count
                FROM service_streams_dimensions
                WHERE org_id = ?
                GROUP BY dimension_name
            "#
        }
        sea_orm::DatabaseBackend::Sqlite => {
            // SQLite uses ? for parameter placeholders
            r#"
                SELECT dimension_name, COUNT(DISTINCT value_hash) as value_count
                FROM service_streams_dimensions
                WHERE org_id = ?
                GROUP BY dimension_name
            "#
        }
    };

    let stmt = sea_orm::Statement::from_sql_and_values(backend, sql, [org_id.into()]);

    let stats = DimensionStats::find_by_statement(stmt)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(stats)
}

/// Get cardinality for a specific dimension
pub async fn get_dimension_cardinality(
    org_id: &str,
    dimension_name: &str,
) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DimensionName.eq(dimension_name))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Clear all dimension tracking for an organization
pub async fn clear_org(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Clear tracking for a specific dimension (for testing/maintenance)
pub async fn clear_dimension(org_id: &str, dimension_name: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DimensionName.eq(dimension_name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Get total count of dimension value records (for testing/monitoring)
pub async fn count() -> Result<u64, errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::find()
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}
