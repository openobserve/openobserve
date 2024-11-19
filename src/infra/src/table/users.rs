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
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{connect_to_orm, mysql, postgres, sqlite, IndexStatement, ORM_CLIENT},
    errors::{self, DbError, Error},
};

// define the organizations type
#[derive(Debug, PartialEq, Eq, Clone, Copy, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "i32", db_type = "Integer")]
#[serde(rename_all = "snake_case")]
pub enum UserType {
    Internal = 0,
    /// Is the user authenticated and created via LDAP
    External = 1,
}

impl From<UserType> for bool {
    fn from(user_type: UserType) -> bool {
        match user_type {
            UserType::Internal => false,
            UserType::External => true,
        }
    }
}

// define the organizations table
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub email: String,
    #[sea_orm(column_type = "String(StringLen::N(50))")]
    pub first_name: String,
    #[sea_orm(column_type = "String(StringLen::N(50))")]
    pub last_name: String,
    #[sea_orm(column_type = "Text")]
    pub password: String,
    pub salt: String,
    pub is_root: bool,
    pub password_ext: Option<String>,
    pub user_type: UserType,
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

#[derive(FromQueryResult, Clone, Debug, Serialize, Deserialize)]
pub struct UserRecord {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub password: String,
    pub salt: String,
    pub is_root: bool,
    #[serde(default)]
    pub password_ext: Option<String>,
    pub user_type: UserType,
    pub created_ts: i64,
}

impl UserRecord {
    pub fn new(
        email: &str,
        first_name: &str,
        last_name: &str,
        password: &str,
        salt: &str,
        is_root: bool,
        password_ext: Option<String>,
        user_type: UserType,
    ) -> Self {
        Self {
            email: email.to_string(),
            first_name: first_name.to_string(),
            last_name: last_name.to_string(),
            password: password.to_string(),
            salt: salt.to_string(),
            is_root,
            password_ext,
            user_type,
            created_ts: chrono::Utc::now().timestamp_micros(),
        }
    }
}

#[derive(FromQueryResult, Debug)]
pub struct OrgId {
    pub identifier: String,
}

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

    client
        .execute(builder.build(&create_table_stmt))
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn create_table_index() -> Result<(), errors::Error> {
    let index1 = IndexStatement::new("users_email_idx", "users", true, &["email"]);

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match client.get_database_backend() {
        DatabaseBackend::MySql => {
            mysql::create_index(index1).await?;
        }
        DatabaseBackend::Postgres => {
            postgres::create_index(index1).await?;
        }
        _ => {
            sqlite::create_index(index1).await?;
        }
    }
    Ok(())
}

pub async fn add(user: UserRecord) -> Result<(), errors::Error> {
    let record = ActiveModel {
        email: Set(user.email),
        first_name: Set(user.first_name.to_string()),
        last_name: Set(user.last_name.to_string()),
        password: Set(user.password.to_string()),
        salt: Set(user.salt.to_string()),
        is_root: Set(user.is_root),
        password_ext: Set(user.password_ext),
        user_type: Set(user.user_type),
        created_ts: Set(chrono::Utc::now().timestamp_micros()),
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

pub async fn update(
    email: &str,
    first_name: &str,
    last_name: &str,
    password: &str,
    password_ext: Option<String>,
) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let result = Entity::update_many()
        .col_expr(Column::FirstName, Expr::value(first_name))
        .col_expr(Column::LastName, Expr::value(last_name))
        .col_expr(Column::Password, Expr::value(password))
        .col_expr(Column::PasswordExt, Expr::value(password_ext))
        .filter(Column::Email.eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

pub async fn remove(email: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Email.eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn get(email: &str) -> Result<UserRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(Column::Email)
        .column(Column::FirstName)
        .column(Column::LastName)
        .column(Column::Password)
        .column(Column::Salt)
        .column(Column::IsRoot)
        .column(Column::PasswordExt)
        .column(Column::UserType)
        .column(Column::CreatedTs)
        .filter(Column::Email.eq(email))
        .into_model::<UserRecord>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("User not found".to_string())))?;

    Ok(record)
}

pub async fn get_root_user() -> Result<UserRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(Column::Email)
        .column(Column::FirstName)
        .column(Column::LastName)
        .column(Column::Password)
        .column(Column::Salt)
        .column(Column::IsRoot)
        .column(Column::PasswordExt)
        .column(Column::UserType)
        .column(Column::CreatedTs)
        .filter(Column::IsRoot.eq(true))
        .into_model::<UserRecord>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Root user not found".to_string())))?;

    Ok(record)
}

pub async fn list(limit: Option<i64>) -> Result<Vec<UserRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find()
        .select_only()
        .column(Column::Email)
        .column(Column::FirstName)
        .column(Column::LastName)
        .column(Column::Password)
        .column(Column::Salt)
        .column(Column::IsRoot)
        .column(Column::PasswordExt)
        .column(Column::UserType)
        .column(Column::CreatedTs)
        .order_by(Column::CreatedTs, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res
        .into_model::<UserRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

pub async fn len() -> usize {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let len = Entity::find().count(client).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("users len error: {}", e);
            0
        }
    }
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn is_empty() -> bool {
    len().await == 0
}

pub async fn batch_remove(emails: Vec<String>) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Email.is_in(emails))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}
