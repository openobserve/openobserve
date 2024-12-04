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
    entity::prelude::*, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, PaginatorTrait,
    QueryFilter, Schema, Set,
};

use super::get_lock;
use crate::{
    db::{connect_to_orm, mysql, postgres, sqlite, IndexStatement, ORM_CLIENT},
    errors,
};

// define the short_urls table
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "search_queue")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(16))")]
    pub work_group: String,
    #[sea_orm(column_type = "String(StringLen::N(256))")]
    pub user_id: String,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub trace_id: String,
    pub created_ts: i64,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
    create_table_index().await?;
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

    client.execute(builder.build(&create_table_stmt)).await?;

    Ok(())
}

pub async fn create_table_index() -> Result<(), errors::Error> {
    let index1 = IndexStatement::new(
        "search_queue_work_group_idx",
        "search_queue",
        false,
        &["work_group", "user_id"],
    );
    let index2 = IndexStatement::new(
        "search_queue_created_ts_idx",
        "search_queue",
        false,
        &["created_ts"],
    );

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match client.get_database_backend() {
        DatabaseBackend::MySql => {
            mysql::create_index(index1).await?;
            mysql::create_index(index2).await?;
        }
        DatabaseBackend::Postgres => {
            postgres::create_index(index1).await?;
            postgres::create_index(index2).await?;
        }
        _ => {
            sqlite::create_index(index1).await?;
            sqlite::create_index(index2).await?;
        }
    }
    Ok(())
}

pub async fn add(work_group: &str, user_id: &str, trace_id: &str) -> Result<(), errors::Error> {
    let record = ActiveModel {
        work_group: Set(work_group.to_string()),
        user_id: Set(user_id.to_string()),
        trace_id: Set(trace_id.to_string()),
        created_ts: Set(chrono::Utc::now().timestamp_micros()),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn delete(id: i64) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_by_trace_id(trace_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::TraceId.eq(trace_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn count(work_group: &str, user_id: Option<&str>) -> Result<usize, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::find().filter(Column::WorkGroup.eq(work_group));
    if let Some(user_id) = user_id {
        query = query.filter(Column::UserId.eq(user_id));
    }
    let res = query.count(client).await?;
    Ok(res as usize)
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

pub async fn clean_incomplete(expired: i64) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::CreatedTs.lt(expired))
        .exec(client)
        .await?;

    Ok(())
}
