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

use std::fmt::Display;

use sea_orm::{
    entity::prelude::*, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait,
    FromQueryResult, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Schema, Set,
};

use super::get_lock;
use crate::{
    db::{connect_to_orm, mysql, postgres, sqlite, IndexStatement, ORM_CLIENT},
    errors::{self, DbError, Error},
};

// define the organizations type
#[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "i32", db_type = "Integer")]
pub enum UserRole {
    Admin = 0,
    Root = 1,
    Viewer = 2,
    User = 3,
    Editor = 4,
    ServiceAccount = 5,
}

impl Display for UserRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserRole::Admin => write!(f, "admin"),
            UserRole::Root => write!(f, "root"),
            UserRole::Viewer => write!(f, "viewer"),
            UserRole::User => write!(f, "user"),
            UserRole::Editor => write!(f, "editor"),
            UserRole::ServiceAccount => write!(f, "service_account"),
        }
    }
}

// define the organizations table
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "org_users")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub org_id: String,
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub email: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_ts: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::Email",
        to = "super::users::Column::Email"
    )]
    Users,
    #[sea_orm(
        belongs_to = "super::organizations::Entity",
        from = "Column::OrgId",
        to = "super::organizations::Column::Identifier"
    )]
    Organizations,
}

// `Related` trait has to be implemented by hand
impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Users.def()
    }
}

// `Related` trait has to be implemented by hand
impl Related<super::organizations::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Organizations.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(FromQueryResult, Debug, Clone)]
pub struct OrgUserRecord {
    pub email: String,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_ts: i64,
}

impl OrgUserRecord {
    pub fn new(
        org_id: &str,
        user_email: &str,
        role: UserRole,
        token: &str,
        rum_token: Option<String>,
    ) -> Self {
        Self {
            org_id: org_id.to_string(),
            email: user_email.to_string(),
            role,
            token: token.to_string(),
            rum_token,
            created_ts: chrono::Utc::now().timestamp_micros(),
        }
    }
}

#[derive(FromQueryResult, Debug)]
pub struct UserOrgExpandedRecord {
    pub email: String,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_ts: i64,
    pub org_name: String,
    pub org_type: super::organizations::OrganizationType,
}

#[derive(FromQueryResult, Debug)]
pub struct OrgUserExpandedRecord {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub user_type: super::users::UserType,
    pub password: String,
    pub salt: String,
    pub password_ext: Option<String>,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_ts: i64,
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
    let index1 = IndexStatement::new(
        "org_users_identifier_email_idx",
        "org_users",
        true,
        &["org_id", "email"],
    );
    let index2 = IndexStatement::new(
        "org_users_rum_token_idx",
        "org_users",
        false,
        &["rum_token"],
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

pub async fn add(
    org_id: &str,
    user_email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org_id: Set(org_id.to_string()),
        email: Set(user_email.to_string()),
        role: Set(role),
        token: Set(token.to_string()),
        rum_token: Set(rum_token),
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

pub async fn remove(org_id: &str, email: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Email.eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn remove_by_user(email: &str) -> Result<(), errors::Error> {
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

pub async fn update(
    org_id: &str,
    email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // There can be only one record with one org_id and email.
    // Hence the below updates only one record.
    Entity::update_many()
        .col_expr(Column::Role, Expr::value(role))
        .col_expr(Column::Token, Expr::value(token.to_string()))
        .col_expr(Column::RumToken, Expr::value(rum_token))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Email.eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn update_rum_token(
    org_id: &str,
    email: &str,
    rum_token: &str,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // There can be only one record with one org_id and email.
    // Hence the below updates only one record.
    Entity::update_many()
        .col_expr(Column::RumToken, Expr::value(Some(rum_token.to_string())))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Email.eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn update_token(org_id: &str, email: &str, token: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // There can be only one record with one org_id and email.
    // Hence the below updates only one record.
    Entity::update_many()
        .col_expr(Column::Token, Expr::value(token.to_string()))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Email.eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn get(org_id: &str, email: &str) -> Result<OrgUserRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Email)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedTs)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Email.eq(email))
        .into_model::<OrgUserRecord>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("User not found".to_string())))?;

    Ok(record)
}

pub async fn get_expanded_user_org(
    org_id: &str,
    email: &str,
) -> Result<OrgUserExpandedRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(super::users::Column::Email)
        .column(super::users::Column::FirstName)
        .column(super::users::Column::LastName)
        .column(super::users::Column::UserType)
        .column(super::users::Column::Password)
        .column(super::users::Column::Salt)
        .column(super::users::Column::PasswordExt)
        .column(Column::OrgId)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedTs)
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Email.eq(email))
        .inner_join(super::users::Entity)
        .into_model::<OrgUserExpandedRecord>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(
                "Organization user not found".to_string(),
            ))
        })?;

    Ok(record)
}

pub async fn get_user_by_rum_token(
    org_id: &str,
    rum_token: &str,
) -> Result<OrgUserExpandedRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(super::users::Column::Email)
        .column(super::users::Column::FirstName)
        .column(super::users::Column::LastName)
        .column(super::users::Column::UserType)
        .column(super::users::Column::Password)
        .column(super::users::Column::Salt)
        .column(super::users::Column::PasswordExt)
        .column(Column::OrgId)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedTs)
        .filter(Column::RumToken.eq(rum_token))
        .filter(Column::OrgId.eq(org_id))
        .inner_join(super::users::Entity)
        .into_model::<OrgUserExpandedRecord>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(
                "Organization user not found".to_string(),
            ))
        })?;
    Ok(record)
}

pub async fn list_users_by_org(org_id: &str) -> Result<Vec<OrgUserRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Email)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedTs)
        .filter(Column::OrgId.eq(org_id))
        .into_model::<OrgUserRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

pub async fn list_orgs_by_user(email: &str) -> Result<Vec<UserOrgExpandedRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::Email.eq(email))
        .inner_join(super::organizations::Entity)
        .select_only()
        .column(Column::Email)
        .column(Column::OrgId)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedTs)
        .column(super::organizations::Column::OrgName)
        .column(super::organizations::Column::OrgType)
        .into_model::<UserOrgExpandedRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

pub async fn list(limit: Option<i64>) -> Result<Vec<OrgUserRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Email)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedTs)
        .order_by(Column::CreatedTs, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res
        .into_model::<OrgUserRecord>()
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
            log::error!("org_users len error: {}", e);
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
