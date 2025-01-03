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

use super::get_lock;
use crate::{
    db::{connect_to_orm, mysql, postgres, sqlite, IndexStatement, ORM_CLIENT},
    errors::{self, DbError, Error},
};

// invitation_id BIGINT PRIMARY KEY,
// org_id BIGINT NOT NULL,
// inviter_id BIGINT NOT NULL,
// invitee_email VARCHAR(255) NOT NULL,
// role VARCHAR(50) NOT NULL,
// status ENUM('pending', 'accepted', 'rejected', 'expired') DEFAULT 'pending',
// token VARCHAR(255) UNIQUE NOT NULL,
// expires_at TIMESTAMP NOT NULL,
// created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

// define the organizations type
#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "i32", db_type = "Integer")]
pub enum OrgInviteStatus {
    Pending = 0,
    Accepted = 1,
    Rejected = 2,
    Expired = 3,
}

// define the org_invites table
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "org_invites")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub token: String,
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub org_id: String,
    pub inviter_id: String,
    pub invitee_id: String,
    #[sea_orm(column_type = "String(StringLen::N(50))")]
    pub role: String,
    pub status: OrgInviteStatus,
    pub expires_at: i64,
    pub created_at: i64,
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
pub struct InvitationRecord {
    pub org_id: String,
    pub token: String,
    pub role: String,
    pub status: OrgInviteStatus,
    pub expires_at: i64,
    pub created_at: i64,
}

impl InvitationRecord {
    pub fn new(
        org_id: &str,
        token: &str,
        role: &str,
        status: OrgInviteStatus,
        expires_at: i64,
    ) -> Self {
        Self {
            org_id: org_id.to_string(),
            token: token.to_string(),
            role: role.to_string(),
            status,
            expires_at,
            created_at: chrono::Utc::now().timestamp_micros(),
        }
    }
}

#[derive(FromQueryResult, Debug)]
pub struct OrgInviteToken {
    pub token: String,
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
    // TODO: Revisit to see if token index should be unique or not
    let index1 = IndexStatement::new(
        "org_invites_token_invitee_id_idx",
        "org_invites",
        true,
        &["token", "invitee_id"],
    );
    let index2 = IndexStatement::new(
        "org_invites_created_at_idx",
        "org_invites",
        false,
        &["created_at"],
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
    token: &str,
    inviter_id: &str,
    invitee_id: &str,
    expires_at: i64,
    role: &str,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org_id: Set(org_id.to_string()),
        token: Set(token.to_string()),
        inviter_id: Set(inviter_id.to_string()),
        invitee_id: Set(invitee_id.to_string()),
        expires_at: Set(expires_at),
        role: Set(role.to_string()),
        status: Set(OrgInviteStatus::Pending),
        created_at: Set(chrono::Utc::now().timestamp_micros()),
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

pub async fn add_many(
    role: &str,
    inviter_id: &str,
    org_id: &str,
    token: &str,
    expires_at: i64,
    invitee_ids: Vec<String>,
) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let mut entries = vec![];

    for invitee_id in invitee_ids {
        entries.push(ActiveModel {
            org_id: Set(org_id.to_string()),
            token: Set(token.to_string()),
            inviter_id: Set(inviter_id.to_string()),
            invitee_id: Set(invitee_id),
            role: Set(role.to_string()),
            status: Set(OrgInviteStatus::Pending),
            expires_at: Set(expires_at),
            created_at: Set(now),
            ..Default::default()
        });
    }

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert_many(entries)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn remove(token: &str, user: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Token.eq(token))
        .filter(Column::InviteeId.eq(user))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn get(token: &str) -> Result<Vec<InvitationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Token)
        .column(Column::Role)
        .column(Column::Status)
        .column(Column::ExpiresAt)
        .column(Column::CreatedAt)
        .filter(Column::Token.eq(token))
        .into_model::<InvitationRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record)
}

pub async fn get_by_token_user(token: &str, user: &str) -> Result<InvitationRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Token)
        .column(Column::Role)
        .column(Column::Status)
        .column(Column::ExpiresAt)
        .column(Column::CreatedAt)
        .filter(Column::Token.eq(token))
        .filter(Column::InviteeId.eq(user))
        .into_model::<InvitationRecord>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(
                "Invititation token not found".to_string(),
            ))
        })?;

    Ok(record)
}

pub async fn list_by_invitee(user: &str) -> Result<Vec<InvitationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Token)
        .column(Column::Role)
        .column(Column::Status)
        .column(Column::ExpiresAt)
        .column(Column::CreatedAt)
        .filter(Column::InviteeId.eq(user))
        .into_model::<InvitationRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

pub async fn list(limit: Option<i64>) -> Result<Vec<InvitationRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Token)
        .column(Column::Role)
        .column(Column::Status)
        .column(Column::ExpiresAt)
        .column(Column::CreatedAt)
        .order_by(Column::CreatedAt, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res
        .into_model::<InvitationRecord>()
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
            log::error!("org_invites len error: {}", e);
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

pub async fn get_expired(
    expired_before: i64,
    limit: Option<i64>,
) -> Result<Vec<String>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find()
        .select_only()
        .column(Column::Token)
        .filter(Column::CreatedAt.lt(expired_before));
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let res = res.into_model::<OrgInviteToken>().all(client).await;

    match res {
        Ok(records) => Ok(records.iter().map(|r| r.token.clone()).collect()),
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
}

pub async fn batch_remove(tokens: Vec<String>) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Token.is_in(tokens))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}
