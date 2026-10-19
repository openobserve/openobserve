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

use core::convert::Into;

use config::{
    ider,
    meta::{
        organization::OrganizationType,
        user::{UserRole, UserType},
    },
};
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Schema, Set, TransactionTrait,
    entity::prelude::*,
    sea_query::{Func, LockType, Query},
};
use serde::{Deserialize, Serialize};

use super::entity::{
    org_users::{ActiveModel, Column, Entity, Model},
    organizations, users,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

#[derive(Debug, Clone)]
pub struct OrgUserRecord {
    pub email: String,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_at: i64,
    pub allow_static_token: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrgUserPut {
    pub email: String,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
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
            created_at: chrono::Utc::now().timestamp_micros(),
            allow_static_token: true, // Default to true for backward compatibility
        }
    }
}

impl From<Model> for OrgUserRecord {
    fn from(model: Model) -> Self {
        Self {
            email: model.email,
            org_id: model.org_id,
            role: model.role.into(),
            token: model.token,
            rum_token: model.rum_token,
            created_at: model.created_at,
            allow_static_token: model.allow_static_token,
        }
    }
}

/// A membership `remove_all_members` deleted, and whether its user went with it.
#[derive(Debug, PartialEq)]
pub struct RemovedMember {
    pub email: String,
    pub role: UserRole,
    pub user_removed: bool,
}

#[derive(Debug)]
pub struct UserOrgExpandedRecord {
    pub email: String,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_at: i64,
    pub org_name: String,
    pub org_type: OrganizationType,
    pub allow_static_token: bool,
}

impl FromQueryResult for UserOrgExpandedRecord {
    fn from_query_result(result: &QueryResult, pre: &str) -> Result<Self, DbErr> {
        let email = result.try_get(pre, "email")?;
        let org_id = result.try_get(pre, "org_id")?;
        let role: i16 = result.try_get(pre, "role")?;
        let token = result.try_get(pre, "token")?;
        let rum_token = result.try_get(pre, "rum_token")?;
        let created_at = result.try_get(pre, "created_at")?;
        let org_name = result.try_get(pre, "org_name")?;
        let org_type: i16 = result.try_get(pre, "org_type")?;
        let allow_static_token: bool = result.try_get(pre, "allow_static_token").unwrap_or(true);

        Ok(Self {
            email,
            org_id,
            role: role.into(),
            token,
            rum_token,
            created_at,
            org_name,
            org_type: org_type.into(),
            allow_static_token,
        })
    }
}

#[derive(Debug)]
pub struct OrgUserExpandedRecord {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub user_type: UserType,
    pub password: String,
    pub salt: String,
    pub password_ext: Option<String>,
    pub org_id: String,
    pub role: UserRole,
    pub token: String,
    pub rum_token: Option<String>,
    pub created_at: i64,
}

impl FromQueryResult for OrgUserExpandedRecord {
    fn from_query_result(res: &QueryResult, pre: &str) -> Result<Self, DbErr> {
        let email = res.try_get(pre, "email")?;
        let first_name = res.try_get(pre, "first_name")?;
        let last_name = res.try_get(pre, "last_name")?;
        let user_type: i16 = res.try_get(pre, "user_type")?;
        let password = res.try_get(pre, "password")?;
        let salt = res.try_get(pre, "salt")?;
        let password_ext = res.try_get(pre, "password_ext")?;
        let org_id = res.try_get(pre, "org_id")?;
        let role: i16 = res.try_get(pre, "role")?;
        let token = res.try_get(pre, "token")?;
        let rum_token = res.try_get(pre, "rum_token")?;
        let created_at = res.try_get(pre, "created_at")?;

        Ok(Self {
            email,
            first_name,
            last_name,
            user_type: user_type.into(),
            password,
            salt,
            password_ext,
            org_id,
            role: role.into(),
            token,
            rum_token,
            created_at,
        })
    }
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
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

pub async fn add(
    org_id: &str,
    user_email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,
) -> Result<(), errors::Error> {
    add_with_flags(org_id, user_email, role, token, rum_token, true).await
}

pub async fn add_with_flag(
    org_id: &str,
    user_email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,
) -> Result<(), errors::Error> {
    add_with_flags(org_id, user_email, role, token, rum_token, true).await
}

pub async fn add_with_flags(
    org_id: &str,
    user_email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,

    allow_static_token: bool,
) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let role: i16 = role.into();
    let record = ActiveModel {
        org_id: Set(org_id.to_string()),
        email: Set(user_email.to_string()),
        role: Set(role),
        token: Set(token.to_string()),
        rum_token: Set(rum_token),
        created_at: Set(now),
        updated_at: Set(now),
        id: Set(ider::uuid()),

        allow_static_token: Set(allow_static_token),
    };

    let client = get_orm_client_rw().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Ok(()),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

pub async fn remove(org_id: &str, email: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn remove_by_user(email: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
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
    let client = get_orm_client_rw().await;
    // There can be only one record with one org_id and email.
    // Hence the below updates only one record.
    Entity::update_many()
        .col_expr(Column::Role, Expr::value(role as i16))
        .col_expr(Column::Token, Expr::value(token.to_string()))
        .col_expr(Column::RumToken, Expr::value(rum_token))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
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
    let client = get_orm_client_rw().await;
    // There can be only one record with one org_id and email.
    // Hence the below updates only one record.
    Entity::update_many()
        .col_expr(Column::RumToken, Expr::value(Some(rum_token.to_string())))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn update_token(org_id: &str, email: &str, token: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    // There can be only one record with one org_id and email.
    // Hence the below updates only one record.
    Entity::update_many()
        .col_expr(Column::Token, Expr::value(token.to_string()))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn get(org_id: &str, email: &str) -> Result<OrgUserRecord, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("User not found".to_string())))?;

    Ok(OrgUserRecord::from(record))
}

pub async fn get_optional(
    org_id: &str,
    email: &str,
) -> Result<Option<OrgUserRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(OrgUserRecord::from))
}

pub async fn get_admin(org_id: &str) -> Result<OrgUserRecord, errors::Error> {
    let client = get_orm_client_ro().await;
    let user = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Role.eq(UserRole::Admin as i16))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("User not found".to_string())))?;

    Ok(OrgUserRecord::from(user))
}

#[derive(Debug, Clone)]
pub struct OrgAdminContact {
    pub org_id: String,
    pub email: String,
    pub first_name: String,
}

impl FromQueryResult for OrgAdminContact {
    fn from_query_result(res: &QueryResult, pre: &str) -> Result<Self, DbErr> {
        Ok(Self {
            org_id: res.try_get(pre, "org_id")?,
            email: res.try_get(pre, "email")?,
            first_name: res.try_get(pre, "first_name")?,
        })
    }
}

/// Batched admin/owner lookup for a set of orgs — one query for the whole
/// list instead of calling `get_admin` per org. Used to label orgs with
/// their owner's identity (e.g. disambiguating two orgs that share a
/// display name in the org switcher).
pub async fn get_admins_for_orgs(
    org_ids: &[String],
) -> Result<Vec<OrgAdminContact>, errors::Error> {
    if org_ids.is_empty() {
        return Ok(vec![]);
    }
    let client = get_orm_client_ro().await;
    // Ordered so a multi-admin org deterministically resolves to the same owner (lowest email).
    let records = Entity::find()
        .filter(Column::OrgId.is_in(org_ids.to_vec()))
        .filter(Column::Role.eq(UserRole::Admin as i16))
        .inner_join(users::Entity)
        .select_only()
        .column(Column::OrgId)
        .column(users::Column::Email)
        .column(users::Column::FirstName)
        .order_by_asc(Column::OrgId)
        .order_by_asc(users::Column::Email)
        .into_model::<OrgAdminContact>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

pub async fn get_expanded_user_org(
    org_id: &str,
    email: &str,
) -> Result<OrgUserExpandedRecord, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(
            Expr::expr(Func::lower(Expr::col((Entity, Column::Email)))).eq(email.to_lowercase()),
        )
        .inner_join(users::Entity)
        .select_only()
        .column(users::Column::Email)
        .column(users::Column::FirstName)
        .column(users::Column::LastName)
        .column(users::Column::UserType)
        .column(users::Column::Password)
        .column(users::Column::Salt)
        .column(users::Column::PasswordExt)
        .column(Column::OrgId)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedAt)
        .column(Column::AllowStaticToken)
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
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::RumToken.eq(rum_token))
        .filter(Column::OrgId.eq(org_id))
        .inner_join(users::Entity)
        .select_only()
        .column(users::Column::Email)
        .column(users::Column::FirstName)
        .column(users::Column::LastName)
        .column(users::Column::UserType)
        .column(users::Column::Password)
        .column(users::Column::Salt)
        .column(users::Column::PasswordExt)
        .column(Column::OrgId)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedAt)
        .column(Column::AllowStaticToken)
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
    let client = get_orm_client_ro().await;
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .into_iter()
        .map(OrgUserRecord::from)
        .collect();

    Ok(records)
}

pub async fn list_orgs_by_user(email: &str) -> Result<Vec<UserOrgExpandedRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let records = Entity::find()
        .filter(
            Expr::expr(Func::lower(Expr::col((Entity, Column::Email)))).eq(email.to_lowercase()),
        )
        .order_by(Column::CreatedAt, Order::Desc)
        .inner_join(super::entity::organizations::Entity)
        .select_only()
        .column(Column::Email)
        .column(Column::OrgId)
        .column(Column::Role)
        .column(Column::Token)
        .column(Column::RumToken)
        .column(Column::CreatedAt)
        .column(organizations::Column::OrgName)
        .column(organizations::Column::OrgType)
        .column(Column::AllowStaticToken)
        .into_model::<UserOrgExpandedRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

/// Reads on the writer, so a membership committed moments ago is never missed by replica lag.
pub async fn list_org_ids_by_user_on_writer(email: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::find()
        .filter(
            Expr::expr(Func::lower(Expr::col((Entity, Column::Email)))).eq(email.to_lowercase()),
        )
        .select_only()
        .column(Column::OrgId)
        .into_tuple::<String>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

pub async fn list(limit: Option<i64>) -> Result<Vec<OrgUserRecord>, errors::Error> {
    let client = get_orm_client_ro().await;
    let mut res = Entity::find().order_by(Column::CreatedAt, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .into_iter()
        .map(OrgUserRecord::from)
        .collect();

    Ok(records)
}

pub async fn len() -> usize {
    let client = get_orm_client_ro().await;
    let len = Entity::find().count(client).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("org_users len error: {e}");
            0
        }
    }
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn is_empty() -> bool {
    len().await == 0
}

/// Removes the membership and, if that leaves the user in no org, the user; returns whether it did.
pub async fn remove_member(org_id: &str, email: &str) -> Result<bool, errors::Error> {
    let db_err = |e: DbErr| Error::DbError(DbError::SeaORMError(e.to_string()));
    let txn = get_orm_client_rw().await.begin().await.map_err(db_err)?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .exec(&txn)
        .await
        .map_err(db_err)?;
    let removed = remove_orphaned_users(&txn, &[email.to_string()])
        .await
        .map_err(db_err)?;
    txn.commit().await.map_err(db_err)?;
    Ok(!removed.is_empty())
}

/// Removes every membership of the org, and each user it leaves in no org, in one transaction.
pub async fn remove_all_members(org_id: &str) -> Result<Vec<RemovedMember>, errors::Error> {
    let db_err = |e: DbErr| Error::DbError(DbError::SeaORMError(e.to_string()));
    let txn = get_orm_client_rw().await.begin().await.map_err(db_err)?;
    let delete = Entity::delete_many().filter(Column::OrgId.eq(org_id));
    let members: Vec<(String, i16)> =
        super::delete_returning(&txn, delete, &[Column::Email, Column::Role])
            .await
            .map_err(db_err)?;
    let emails: Vec<String> = members.iter().map(|(email, _)| email.clone()).collect();
    let removed = remove_orphaned_users(&txn, &emails).await.map_err(db_err)?;
    txn.commit().await.map_err(db_err)?;
    Ok(members
        .into_iter()
        .map(|(email, role)| RemovedMember {
            user_removed: removed.contains(&email.to_lowercase()),
            email,
            role: role.into(),
        })
        .collect())
}

/// Deletes each of `emails` whose user holds no membership any more, then the auth rows it returns.
async fn remove_orphaned_users<C: ConnectionTrait>(
    txn: &C,
    emails: &[String],
) -> Result<Vec<String>, DbErr> {
    if emails.is_empty() {
        return Ok(vec![]);
    }
    let user_email = || {
        Expr::expr(Func::lower(Expr::col((
            users::Entity,
            users::Column::Email,
        ))))
    };
    let lowered: Vec<String> = emails.iter().map(|e| e.to_lowercase()).collect();
    // Waits out an add's foreign-key share lock, so the check below sees its membership.
    if txn.get_database_backend() != sea_orm::DatabaseBackend::Sqlite {
        users::Entity::find()
            .select_only()
            .column(users::Column::Email)
            .filter(user_email().is_in(lowered.clone()))
            .order_by(user_email(), Order::Asc)
            .lock(LockType::Update)
            .into_tuple::<String>()
            .all(txn)
            .await?;
    }
    let membership = Query::select()
        .expr(Expr::val(1))
        .from(Entity)
        .and_where(
            Expr::expr(Func::lower(Expr::col((Entity, Column::Email)))).eq(Func::lower(Expr::col(
                (users::Entity, users::Column::Email),
            ))),
        )
        .to_owned();
    let delete = users::Entity::delete_many()
        .filter(user_email().is_in(lowered))
        .filter(Expr::exists(membership).not());
    let removed: Vec<String> =
        super::delete_returning(txn, delete, &[users::Column::Email]).await?;
    if removed.is_empty() {
        return Ok(vec![]);
    }
    super::user_password_history::delete_all_for_users_on(txn, &removed).await?;
    super::user_auth_state::delete_for_users_on(txn, &removed).await?;
    Ok(removed.into_iter().map(|e| e.to_lowercase()).collect())
}

#[cfg(test)]
mod tests {
    use config::meta::user::UserRole;

    use super::*;

    #[test]
    fn test_org_user_record_new_fields() {
        let r = OrgUserRecord::new(
            "org-1",
            "user@example.com",
            UserRole::Admin,
            "tok-abc",
            None,
        );
        assert_eq!(r.org_id, "org-1");
        assert_eq!(r.email, "user@example.com");
        assert_eq!(r.token, "tok-abc");
        assert!(r.rum_token.is_none());
        assert!(r.allow_static_token);
        assert!(r.created_at > 0);
    }

    #[test]
    fn test_org_user_record_new_with_rum_token() {
        let r = OrgUserRecord::new(
            "org-2",
            "admin@example.com",
            UserRole::Viewer,
            "tok-xyz",
            Some("rum-tok".to_string()),
        );
        assert_eq!(r.rum_token.as_deref(), Some("rum-tok"));
    }

    #[test]
    fn test_org_user_put_fields() {
        let p = OrgUserPut {
            email: "e@x.com".to_string(),
            org_id: "org-3".to_string(),
            role: UserRole::Editor,
            token: "t".to_string(),
            rum_token: None,
        };
        assert_eq!(p.org_id, "org-3");
        assert!(p.rum_token.is_none());
    }

    #[test]
    fn test_from_model_to_org_user_record() {
        use super::super::entity::org_users::Model;
        let model = Model {
            id: "ou-1".to_string(),
            email: "model@example.com".to_string(),
            org_id: "myorg".to_string(),
            role: 0, // maps to some UserRole variant
            token: "tok-xyz".to_string(),
            rum_token: Some("rum-abc".to_string()),
            created_at: 1_000_000,
            updated_at: 2_000_000,
            allow_static_token: true,
        };
        let rec = OrgUserRecord::from(model);
        assert_eq!(rec.email, "model@example.com");
        assert_eq!(rec.org_id, "myorg");
        assert_eq!(rec.token, "tok-xyz");
        assert_eq!(rec.rum_token.as_deref(), Some("rum-abc"));
        assert!(rec.allow_static_token);
        assert_eq!(rec.created_at, 1_000_000);
    }

    /// A users row, then a membership in each of `orgs`.
    async fn member_of(email: &str, orgs: &[&str]) {
        use super::super::entity::users as user_entity;
        user_entity::ActiveModel {
            id: Set(ider::uuid()),
            email: Set(email.to_string()),
            first_name: Set(String::new()),
            last_name: Set(String::new()),
            password: Set(String::new()),
            salt: Set(String::new()),
            is_root: Set(false),
            password_ext: Set(None),
            user_type: Set(UserType::Internal.into()),
            created_at: Set(0),
            updated_at: Set(0),
            must_reset_password: Set(false),
            password_reset_reason: Set(None),
            flagged_at: Set(None),
            password_updated_at: Set(None),
        }
        .insert(get_orm_client_rw().await)
        .await
        .unwrap();
        for org in orgs {
            add(org, email, UserRole::Admin, &ider::uuid(), None)
                .await
                .unwrap();
        }
        let auth = crate::table::user_auth_state::insert_first_failure(email, 1).await;
        assert!(auth.unwrap());
    }

    async fn user_rows(email: &str) -> (bool, bool) {
        let user = crate::table::users::get(email).await.is_ok();
        let auth = crate::table::user_auth_state::get(email).await.unwrap();
        (user, auth.is_some())
    }

    #[tokio::test]
    async fn test_removing_a_member_keeps_a_user_another_org_still_holds() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_rm_member");
        let other = format!("{org}_other");
        for org in [&org, &other] {
            crate::table::organizations::add(org, org, OrganizationType::Custom)
                .await
                .unwrap();
        }
        let (shared, sole) = (
            format!("{org}_shared@example.com"),
            format!("{org}_sole@example.com"),
        );
        member_of(&shared, &[&org, &other]).await;
        member_of(&sole, &[&org]).await;

        let shared_removed = remove_member(&org, &shared.to_uppercase()).await.unwrap();
        let sole_removed = remove_member(&org, &sole).await.unwrap();
        let shared_rows = user_rows(&shared).await;
        let sole_rows = user_rows(&sole).await;
        let kept_membership = get(&other, &shared).await.is_ok();
        let last_removed = remove_member(&other, &shared).await.unwrap();
        let shared_gone = user_rows(&shared).await;
        for org in [&org, &other] {
            crate::table::organizations::remove(org).await.unwrap();
        }

        assert!(
            !shared_removed,
            "a user with a membership in another org was deleted"
        );
        assert_eq!(shared_rows, (true, true));
        assert!(kept_membership);
        assert!(sole_removed);
        assert_eq!(
            sole_rows,
            (false, false),
            "a sole-org user or its auth row survived"
        );
        assert!(last_removed);
        assert_eq!(shared_gone, (false, false));
    }

    #[tokio::test]
    async fn test_removing_all_members_deletes_only_users_left_in_no_org() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_rm_all");
        let other = format!("{org}_other");
        for org in [&org, &other] {
            crate::table::organizations::add(org, org, OrganizationType::Custom)
                .await
                .unwrap();
        }
        let (shared, sole) = (
            format!("{org}_shared@example.com"),
            format!("{org}_sole@example.com"),
        );
        member_of(&shared, &[&org, &other]).await;
        member_of(&sole, &[&org]).await;

        let mut removed: Vec<(String, bool)> = remove_all_members(&org)
            .await
            .unwrap()
            .into_iter()
            .map(|member| (member.email, member.user_removed))
            .collect();
        removed.sort();
        let left = list_users_by_org(&org).await.unwrap();
        let shared_rows = user_rows(&shared).await;
        let sole_rows = user_rows(&sole).await;
        remove_all_members(&other).await.unwrap();
        for org in [&org, &other] {
            crate::table::organizations::remove(org).await.unwrap();
        }

        assert_eq!(removed, [(shared.clone(), false), (sole.clone(), true)]);
        assert!(left.is_empty());
        assert_eq!(shared_rows, (true, true));
        assert_eq!(sole_rows, (false, false));
    }
}
