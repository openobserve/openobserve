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

use config::{
    ider,
    meta::user::{DBUser, UserRole, UserType},
};
use sea_orm::{
    ColumnTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Schema,
    Set,
    entity::prelude::*,
    sea_query::{Func, Query, SimpleExpr},
};
use serde::{Deserialize, Serialize};

use super::entity::{
    org_users,
    users::{ActiveModel, Column, Entity, Model},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

impl From<Model> for UserRecord {
    fn from(model: Model) -> Self {
        Self {
            email: model.email,
            first_name: model.first_name,
            last_name: model.last_name,
            password: model.password,
            salt: model.salt,
            is_root: model.is_root,
            password_ext: model.password_ext,
            user_type: model.user_type.into(),
            created_at: model.created_at,
            updated_at: model.updated_at,
            must_reset_password: model.must_reset_password,
            password_reset_reason: model.password_reset_reason,
            flagged_at: model.flagged_at,
            password_updated_at: model.password_updated_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    pub created_at: i64,
    pub updated_at: i64,
    /// Set by the policy sweep; read by the access-time middleware straight from the users cache,
    /// which is why it lives here rather than only on the entity model.
    #[serde(default)]
    pub must_reset_password: bool,
    #[serde(default)]
    pub password_reset_reason: Option<String>,
    #[serde(default)]
    pub flagged_at: Option<i64>,
    /// NULL only between the schema migration and this user's first password change; the rotation
    /// check reads that as never-expired rather than as the epoch.
    #[serde(default)]
    pub password_updated_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserUpdate {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub password: String,
    pub password_ext: Option<String>,
    /// Whether `password` is a new password rather than an unchanged one carried along with an
    /// edit to something else. Defaulted so a message from an older build still deserializes.
    #[serde(default)]
    pub password_changed: bool,
}

impl From<&DBUser> for UserRecord {
    fn from(user: &DBUser) -> Self {
        let is_root = user
            .organizations
            .iter()
            .any(|org| org.role.eq(&UserRole::Root));
        Self {
            email: user.email.clone(),
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            password: user.password.clone(),
            salt: user.salt.clone(),
            is_root,
            password_ext: user.password_ext.clone(),
            user_type: if user.is_external {
                UserType::External
            } else {
                UserType::Internal
            },
            created_at: 0,
            updated_at: 0,
            // DBUser is the API-facing shape and carries no policy state. A record built from one
            // is only ever used to insert or look up, never to overwrite these columns.
            must_reset_password: false,
            password_reset_reason: None,
            flagged_at: None,
            password_updated_at: None,
        }
    }
}

impl From<&UserRecord> for DBUser {
    fn from(user: &UserRecord) -> Self {
        DBUser {
            email: user.email.clone(),
            password: user.password.clone(),
            salt: user.salt.clone(),
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            is_external: user.user_type.is_external(),
            organizations: vec![],
            password_ext: user.password_ext.clone(),
        }
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

pub async fn add(user: UserRecord) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let record = ActiveModel {
        email: Set(user.email),
        first_name: Set(user.first_name.to_string()),
        last_name: Set(user.last_name.to_string()),
        password: Set(user.password.to_string()),
        salt: Set(user.salt.to_string()),
        is_root: Set(user.is_root),
        password_ext: Set(user.password_ext),
        user_type: Set(user.user_type.into()),
        created_at: Set(now),
        updated_at: Set(now),
        id: Set(ider::uuid()),
        must_reset_password: Set(false),
        password_reset_reason: Set(None),
        flagged_at: Set(None),
        password_updated_at: Set(Some(now)),
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

/// Update a user's profile fields.
///
/// `password_changed` says whether `password` is a genuinely new password. When it is, the columns
/// that describe the password — the forced-reset flag and the rotation clock — are rewritten in the
/// same statement, so a user can never hold a compliant password while still flagged for one. It
/// must stay false for edits that merely carry the existing hash along, such as the `password_ext`
/// backfill at login; restarting the rotation clock there would make expiry unreachable.
pub async fn update(
    email: &str,
    first_name: &str,
    last_name: &str,
    password: &str,
    password_ext: Option<String>,
    password_changed: bool,
) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;

    let now = chrono::Utc::now().timestamp_micros();
    let mut stmt = Entity::update_many()
        .col_expr(Column::FirstName, Expr::value(first_name))
        .col_expr(Column::LastName, Expr::value(last_name))
        .col_expr(Column::Password, Expr::value(password))
        .col_expr(Column::PasswordExt, Expr::value(password_ext))
        .col_expr(Column::UpdatedAt, Expr::value(now));

    if password_changed {
        stmt = stmt
            .col_expr(Column::MustResetPassword, Expr::value(false))
            .col_expr(
                Column::PasswordResetReason,
                Expr::value(Option::<String>::None),
            )
            .col_expr(Column::FlaggedAt, Expr::value(Option::<i64>::None))
            .col_expr(Column::PasswordUpdatedAt, Expr::value(now));
    }

    let result = stmt
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

/// Flag every interactive native user for a forced password reset.
///
/// Three groups are left alone: external users authenticate elsewhere, so the local password
/// policy never applies to them; service accounts have no interactive password to reset, so
/// flagging them would only break the automation using their tokens; and root is exempt so a
/// tightened policy can never lock the instance out of its own recovery path.
pub async fn flag_all_for_password_reset(reason: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    let external: i16 = UserType::External.into();
    let result = Entity::update_many()
        .col_expr(Column::MustResetPassword, Expr::value(true))
        .col_expr(Column::PasswordResetReason, Expr::value(reason))
        .col_expr(
            Column::FlaggedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::UserType.ne(external))
        .filter(Column::IsRoot.eq(false))
        .filter(not_a_service_account())
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

pub async fn remove(email: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn get(email: &str) -> Result<UserRecord, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase()))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("User not found".to_string())))?;

    Ok(UserRecord::from(record))
}

pub async fn get_root_user() -> Result<UserRecord, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find()
        .filter(Column::IsRoot.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Root user not found".to_string())))?;

    Ok(UserRecord::from(record))
}

pub async fn list(limit: Option<i64>) -> Result<Vec<UserRecord>, errors::Error> {
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
        .map(UserRecord::from)
        .collect();

    Ok(records)
}

pub async fn len() -> usize {
    let client = get_orm_client_ro().await;
    let len = Entity::find().count(client).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("users len error: {e}");
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

pub async fn batch_remove(emails: Vec<String>) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let lowered_emails: Vec<String> = emails.iter().map(|e| e.to_lowercase()).collect();
    Entity::delete_many()
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).is_in(lowered_emails))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Matches users that hold no service-account role in any organization. The role lives on
/// `org_users`, not `users`, so this has to go through a subquery.
fn not_a_service_account() -> SimpleExpr {
    let service_account_roles: Vec<i16> =
        vec![UserRole::ServiceAccount.into(), UserRole::SreAgent.into()];

    Expr::expr(Func::lower(Expr::col(Column::Email))).not_in_subquery(
        Query::select()
            .expr(Func::lower(Expr::col(org_users::Column::Email)))
            .from(org_users::Entity)
            .and_where(org_users::Column::Role.is_in(service_account_roles))
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use config::meta::user::{DBUser, UserOrg, UserRole, UserType};

    use super::*;

    #[test]
    fn test_not_a_service_account_excludes_both_service_account_roles() {
        let sql = Query::select()
            .column(Column::Email)
            .from(Entity)
            .and_where(not_a_service_account())
            .to_owned()
            .to_string(sea_orm::sea_query::SqliteQueryBuilder);

        assert!(sql.contains("NOT IN"), "{sql}");
        assert!(sql.contains("org_users"), "{sql}");
        // ServiceAccount = 5, SreAgent = 6
        assert!(sql.contains("IN (5, 6)"), "{sql}");
    }

    fn make_db_user(is_external: bool, role: UserRole) -> DBUser {
        DBUser {
            email: "test@example.com".to_string(),
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
            password: "hash123".to_string(),
            salt: "salt".to_string(),
            organizations: vec![UserOrg {
                name: "default".to_string(),
                org_name: "Default".to_string(),
                token: "tok".to_string(),
                rum_token: None,
                role,
            }],
            is_external,
            password_ext: None,
        }
    }

    #[test]
    fn test_from_db_user_internal() {
        let db_user = make_db_user(false, UserRole::Admin);
        let rec = UserRecord::from(&db_user);
        assert_eq!(rec.email, "test@example.com");
        assert_eq!(rec.user_type, UserType::Internal);
        assert!(!rec.is_root);
    }

    #[test]
    fn test_from_db_user_external() {
        let db_user = make_db_user(true, UserRole::Viewer);
        let rec = UserRecord::from(&db_user);
        assert_eq!(rec.user_type, UserType::External);
    }

    #[test]
    fn test_from_db_user_root_role_sets_is_root() {
        let db_user = make_db_user(false, UserRole::Root);
        let rec = UserRecord::from(&db_user);
        assert!(rec.is_root);
    }

    #[test]
    fn test_from_user_record_to_db_user() {
        let db_user = make_db_user(false, UserRole::Admin);
        let rec = UserRecord::from(&db_user);
        let back = DBUser::from(&rec);
        assert_eq!(back.email, "test@example.com");
        assert!(!back.is_external);
        assert!(back.organizations.is_empty());
    }

    #[test]
    fn test_from_model_to_user_record() {
        use super::super::entity::users::Model;
        let model = Model {
            id: "uid-1".to_string(),
            email: "model@example.com".to_string(),
            first_name: "Model".to_string(),
            last_name: "User".to_string(),
            password: "pw".to_string(),
            salt: "salt".to_string(),
            is_root: true,
            password_ext: Some("ext".to_string()),
            user_type: 0, // 0 = Internal
            created_at: 1_000_000,
            updated_at: 2_000_000,
            must_reset_password: false,
            password_reset_reason: None,
            flagged_at: None,
            password_updated_at: Some(1_000_000),
        };
        let rec = UserRecord::from(model);
        assert_eq!(rec.email, "model@example.com");
        assert!(rec.is_root);
        assert_eq!(rec.password_ext, Some("ext".to_string()));
        assert_eq!(rec.created_at, 1_000_000);
        assert_eq!(rec.updated_at, 2_000_000);
    }
}
