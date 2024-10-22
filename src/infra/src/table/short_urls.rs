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
    entity::prelude::*, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait,
    FromQueryResult, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Schema, Set,
};

use crate::{
    db::{mysql, postgres, sqlite, IndexStatement, ORM_CLIENT},
    errors::{self, DbError, Error},
};

// define the short_urls table
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "short_urls")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub short_id: String,
    #[sea_orm(column_type = "Text")]
    pub original_url: String,
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

#[derive(FromQueryResult, Debug)]
pub struct ShortUrlRecord {
    pub short_id: String,
    pub original_url: String,
}

impl ShortUrlRecord {
    pub fn new(short_id: &str, original_url: &str) -> Self {
        Self {
            short_id: short_id.to_string(),
            original_url: original_url.to_string(),
        }
    }
}

#[derive(FromQueryResult, Debug)]
pub struct ShortId {
    pub short_id: String,
}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
    create_table_index().await?;
    Ok(())
}

pub async fn create_table() -> Result<(), errors::Error> {
    let builder = ORM_CLIENT.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    let res = ORM_CLIENT.execute(builder.build(&create_table_stmt)).await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn create_table_index() -> Result<(), errors::Error> {
    let index1 = IndexStatement::new("short_urls_short_id_idx", "short_urls", true, &["short_id"]);
    let index2 = IndexStatement::new(
        "short_urls_created_ts_idx",
        "short_urls",
        false,
        &["created_ts"],
    );

    match ORM_CLIENT.get_database_backend() {
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

pub async fn add(short_id: &str, original_url: &str) -> Result<(), errors::Error> {
    let record = ActiveModel {
        short_id: Set(short_id.to_string()),
        original_url: Set(original_url.to_string()),
        created_ts: Set(chrono::Utc::now().timestamp_micros()),
        ..Default::default()
    };

    let res = Entity::insert(record).exec(&ORM_CLIENT.clone()).await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn remove(short_id: &str) -> Result<(), errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::ShortId.eq(short_id))
        .exec(&ORM_CLIENT.clone())
        .await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn get(short_id: &str) -> Result<ShortUrlRecord, errors::Error> {
    let res = Entity::find()
        .select_only()
        .column(Column::ShortId)
        .column(Column::OriginalUrl)
        .filter(Column::ShortId.eq(short_id))
        .into_model::<ShortUrlRecord>()
        .one(&ORM_CLIENT.clone())
        .await;

    match res {
        Ok(record) => {
            if let Some(record) = record {
                Ok(record)
            } else {
                Err(Error::DbError(DbError::SeaORMError(
                    "Short URL not found".to_string(),
                )))
            }
        }
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn list(limit: Option<i64>) -> Result<Vec<ShortUrlRecord>, errors::Error> {
    let mut res = Entity::find()
        .select_only()
        .column(Column::ShortId)
        .column(Column::OriginalUrl)
        .filter(Column::ShortId.contains("google"))
        .order_by(Column::Id, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let res = res
        .into_model::<ShortUrlRecord>()
        .all(&ORM_CLIENT.clone())
        .await;

    match res {
        Ok(records) => Ok(records),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn contains(short_id: &str) -> Result<bool, errors::Error> {
    let res = Entity::find()
        .filter(Column::ShortId.eq(short_id))
        .into_model::<ShortUrlRecord>()
        .one(&ORM_CLIENT.clone())
        .await;

    match res {
        Ok(record) => Ok(record.is_some()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn len() -> usize {
    let len = Entity::find().count(&ORM_CLIENT.clone()).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("short_urls len error: {}", e);
            0
        }
    }
}

pub async fn clear() -> Result<(), errors::Error> {
    let res = Entity::delete_many().exec(&ORM_CLIENT.clone()).await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn is_empty() -> bool {
    len().await == 0
}

pub async fn get_expired(
    expired_before: i64,
    limit: Option<i64>,
) -> Result<Vec<String>, errors::Error> {
    let mut res = Entity::find()
        .select_only()
        .column(Column::ShortId)
        .filter(Column::CreatedTs.lt(expired_before));
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let res = res.into_model::<ShortId>().all(&ORM_CLIENT.clone()).await;

    match res {
        Ok(records) => Ok(records.iter().map(|r| r.short_id.clone()).collect()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn batch_remove(short_ids: Vec<String>) -> Result<(), errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::ShortId.is_in(short_ids))
        .exec(&ORM_CLIENT.clone())
        .await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}
