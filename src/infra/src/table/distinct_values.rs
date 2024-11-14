// Copyright 2024 OpenObserve Inc.
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

use sea_orm::{
    entity::prelude::*, ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter,
    Schema, Set,
};

use super::get_lock;
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors::{self, DbError, Error},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(15))")]
pub enum OriginType {
    #[sea_orm(string_value = "stream")]
    Stream,
    #[sea_orm(string_value = "dashboard")]
    Dashboard,
    #[sea_orm(string_value = "report")]
    Report,
}

// define the distinct fields table
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "distinct_value_fields")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "Text")]
    pub origin: OriginType,
    #[sea_orm(column_type = "Text")]
    pub origin_id: String,
    #[sea_orm(column_type = "Text")]
    pub org_name: String,
    #[sea_orm(column_type = "Text")]
    pub stream_name: String,
    #[sea_orm(column_type = "Text")]
    pub field_name: String,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(FromQueryResult, Debug)]
pub struct DistinctFieldRecord {
    pub origin: OriginType,
    pub origin_id: String,
    pub org_name: String,
    pub stream_name: String,
    pub field_name: String,
}

impl DistinctFieldRecord {
    pub fn new(origin: OriginType, origin_id: &str, org: &str, stream: &str, field: &str) -> Self {
        Self {
            origin,
            origin_id: origin_id.to_owned(),
            org_name: org.to_owned(),
            stream_name: stream.to_owned(),
            field_name: field.to_owned(),
        }
    }
}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
    Ok(())
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

pub async fn add(record: DistinctFieldRecord) -> Result<(), errors::Error> {
    let record = ActiveModel {
        origin: Set(record.origin),
        origin_id: Set(record.origin_id),
        org_name: Set(record.org_name),
        stream_name: Set(record.stream_name),
        field_name: Set(record.field_name),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn remove(record: DistinctFieldRecord) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let record = ActiveModel {
        origin: Set(record.origin),
        origin_id: Set(record.origin_id),
        org_name: Set(record.org_name),
        stream_name: Set(record.stream_name),
        field_name: Set(record.field_name),
        ..Default::default()
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete(record)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn check_field_use(
    org_name: &str,
    stream_name: &str,
    field_name: &str,
) -> Result<Vec<DistinctFieldRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::OrgName.eq(org_name))
        .filter(Column::StreamName.eq(stream_name))
        .filter(Column::FieldName.eq(field_name))
        .into_model::<DistinctFieldRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Ok(records)
}

pub async fn batch_remove(origin: OriginType, origin_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Origin.eq(origin))
        .filter(Column::OriginId.eq(origin_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}
