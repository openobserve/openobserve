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

#[cfg(feature = "cloud")]
use std::collections::HashMap;

use config::{
    ider,
    meta::user::{DBUser, UserRole, UserType},
};
use sea_orm::{
    ColumnTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Schema,
    Set, TransactionTrait,
    entity::prelude::*,
    sea_query::{Func, Query, SimpleExpr},
};
#[cfg(feature = "cloud")]
use sea_orm::{Condition, FromQueryResult, Select, sea_query::LikeExpr};
use serde::{Deserialize, Serialize};

#[cfg(feature = "cloud")]
use super::entity::organizations;
use super::entity::{
    org_users,
    users::{ActiveModel, Column, Entity, Model},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

#[cfg(feature = "cloud")]
const DEFAULT_LIST_PAGE_SIZE: i64 = 20;
#[cfg(feature = "cloud")]
const MAX_LIST_PAGE_SIZE: i64 = 100;
// Keeps the page offset far inside the signed 64-bit OFFSET every backend binds.
#[cfg(feature = "cloud")]
const MAX_LIST_PAGE: i64 = u32::MAX as i64;

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

/// Which users one page of the cross-organization listing holds. Root users are never listed.
#[cfg(feature = "cloud")]
#[derive(Clone, Debug, PartialEq)]
pub struct UserListFilter {
    search: Option<String>,
    org_id: Option<String>,
    page_idx: u64,
    page_size: u64,
}

#[cfg(feature = "cloud")]
impl UserListFilter {
    /// `page` is 1-based. Missing or out-of-range paging values are clamped, never rejected.
    pub fn new(
        search: Option<&str>,
        org_id: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
    ) -> Self {
        let non_empty = |value: Option<&str>| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        let page = page.unwrap_or(1).clamp(1, MAX_LIST_PAGE);
        let page_size = page_size
            .unwrap_or(DEFAULT_LIST_PAGE_SIZE)
            .clamp(1, MAX_LIST_PAGE_SIZE);
        Self {
            search: non_empty(search),
            org_id: non_empty(org_id),
            page_idx: (page - 1).unsigned_abs(),
            page_size: page_size.unsigned_abs(),
        }
    }
}

/// One page of listed users, and how many users match the filter in total.
#[cfg(feature = "cloud")]
#[derive(Clone, Debug, PartialEq, Serialize, utoipa::ToSchema)]
pub struct UserListPage {
    pub data: Vec<ListedUser>,
    pub total: u64,
}

#[cfg(feature = "cloud")]
#[derive(Clone, Debug, PartialEq, Serialize, utoipa::ToSchema)]
pub struct ListedUser {
    /// The `users.id` primary key.
    pub id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub is_external: bool,
    pub created_at: i64,
    pub orgs: Vec<ListedMembership>,
}

#[cfg(feature = "cloud")]
#[derive(Clone, Debug, PartialEq, Serialize, utoipa::ToSchema)]
pub struct ListedMembership {
    pub org_id: String,
    pub org_name: String,
    pub role: UserRole,
}

#[cfg(feature = "cloud")]
#[derive(Debug, FromQueryResult)]
struct ListedUserRow {
    id: String,
    email: String,
    first_name: String,
    last_name: String,
    user_type: i16,
    created_at: i64,
}

#[cfg(feature = "cloud")]
#[derive(Debug, FromQueryResult)]
struct MembershipRow {
    email: String,
    org_id: String,
    org_name: String,
    role: i16,
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
    remove_on(get_orm_client_rw().await, &[email.to_string()], false)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn remove_with_memberships(email: &str) -> Result<(), errors::Error> {
    remove_on(get_orm_client_rw().await, &[email.to_string()], true)
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

/// The stable `users.id` for an email (uncached: a re-registered email gets a new id).
pub async fn get_id_by_email(email: &str) -> Result<Option<String>, errors::Error> {
    get_id_by_email_with(get_orm_client_ro().await, email).await
}

pub async fn get_id_by_email_with<C: ConnectionTrait>(
    conn: &C,
    email: &str,
) -> Result<Option<String>, errors::Error> {
    let db_err = |e: sea_orm::DbErr| Error::DbError(DbError::SeaORMError(e.to_string()));
    let lowered = email.to_lowercase();
    // Exact spellings first, through the unique email index; lower() only for a mixed-case row.
    let id = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::Email.is_in([email.to_string(), lowered.clone()]))
        .order_by_desc(Expr::col(Column::Email).eq(email))
        .into_tuple::<String>()
        .one(conn)
        .await
        .map_err(db_err)?;
    if id.is_some() {
        return Ok(id);
    }
    Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).eq(lowered))
        .into_tuple::<String>()
        .one(conn)
        .await
        .map_err(db_err)
}

/// The `(first_name, last_name)` of the user with stable id `id`, if any.
pub async fn get_name_by_id(id: &str) -> Result<Option<(String, String)>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .select_only()
        .column(Column::FirstName)
        .column(Column::LastName)
        .filter(Column::Id.eq(id))
        .into_tuple::<(String, String)>()
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
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

/// One page of non-root users, newest first, each with every organization they belong to.
#[cfg(feature = "cloud")]
pub async fn list_page(filter: &UserListFilter) -> Result<UserListPage, errors::Error> {
    list_page_with(get_orm_client_ro().await, filter)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
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
    remove_on(get_orm_client_rw().await, &emails, false)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

async fn remove_on<C: TransactionTrait>(
    client: &C,
    emails: &[String],
    with_memberships: bool,
) -> Result<(), sea_orm::DbErr> {
    let lowered: Vec<String> = emails.iter().map(|e| e.to_lowercase()).collect();
    let txn = client.begin().await?;
    // In the user's transaction: once the users row is gone, no retry can find these by email.
    super::user_password_history::delete_all_for_users_on(&txn, emails).await?;
    super::user_auth_state::delete_for_users_on(&txn, emails).await?;
    if with_memberships {
        org_users::Entity::delete_many()
            .filter(
                Expr::expr(Func::lower(Expr::col(org_users::Column::Email))).is_in(lowered.clone()),
            )
            .exec(&txn)
            .await?;
    }
    Entity::delete_many()
        .filter(Expr::expr(Func::lower(Expr::col(Column::Email))).is_in(lowered))
        .exec(&txn)
        .await?;
    txn.commit().await
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

#[cfg(feature = "cloud")]
async fn list_page_with<C: ConnectionTrait>(
    conn: &C,
    filter: &UserListFilter,
) -> Result<UserListPage, sea_orm::DbErr> {
    let paginator = listed_users_query(filter)
        .into_model::<ListedUserRow>()
        .paginate(conn, filter.page_size);
    let total = paginator.num_items().await?;
    let rows = paginator.fetch_page(filter.page_idx).await?;
    let memberships = if rows.is_empty() {
        vec![]
    } else {
        let emails = rows.iter().map(|row| row.email.clone()).collect();
        memberships_query(emails)
            .into_model::<MembershipRow>()
            .all(conn)
            .await?
    };
    Ok(UserListPage {
        data: attach_memberships(rows, memberships),
        total,
    })
}

#[cfg(feature = "cloud")]
fn listed_users_query(filter: &UserListFilter) -> Select<Entity> {
    let lowered_email = || Expr::expr(Func::lower(Expr::col((Entity, Column::Email))));
    let mut query = Entity::find()
        .select_only()
        .columns([
            Column::Id,
            Column::Email,
            Column::FirstName,
            Column::LastName,
            Column::UserType,
            Column::CreatedAt,
        ])
        .filter(Column::IsRoot.eq(false));
    if let Some(term) = &filter.search {
        let pattern = format!("%{}%", crate::db::escape_like_prefix(&term.to_lowercase()));
        query = query.filter(
            Condition::any()
                .add(Column::Id.eq(term.as_str()))
                .add(lowered_email().like(LikeExpr::new(pattern).escape('\\'))),
        );
    }
    // The org_users.email foreign key keeps the users.email spelling, so exact matches use the
    // index.
    if let Some(org_id) = &filter.org_id {
        query = query.filter(
            Column::Email.in_subquery(
                Query::select()
                    .column((org_users::Entity, org_users::Column::Email))
                    .from(org_users::Entity)
                    .and_where(org_users::Column::OrgId.eq(org_id.as_str()))
                    .to_owned(),
            ),
        );
    }
    query
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
}

/// Every membership of the given `users.email` values, with the organization's name.
#[cfg(feature = "cloud")]
fn memberships_query(emails: Vec<String>) -> Select<org_users::Entity> {
    org_users::Entity::find()
        .select_only()
        .column(org_users::Column::Email)
        .column(org_users::Column::OrgId)
        .column(organizations::Column::OrgName)
        .column(org_users::Column::Role)
        .inner_join(organizations::Entity)
        .filter(org_users::Column::Email.is_in(emails))
        .order_by_asc(organizations::Column::OrgName)
        .order_by_asc(org_users::Column::OrgId)
}

#[cfg(feature = "cloud")]
fn attach_memberships(
    rows: Vec<ListedUserRow>,
    memberships: Vec<MembershipRow>,
) -> Vec<ListedUser> {
    let mut by_email: HashMap<String, Vec<ListedMembership>> = HashMap::new();
    for membership in memberships {
        by_email
            .entry(membership.email)
            .or_default()
            .push(ListedMembership {
                org_id: membership.org_id,
                org_name: membership.org_name,
                role: membership.role.into(),
            });
    }
    rows.into_iter()
        .map(|row| ListedUser {
            orgs: by_email.remove(&row.email).unwrap_or_default(),
            id: row.id,
            email: row.email,
            first_name: row.first_name,
            last_name: row.last_name,
            is_external: UserType::from(row.user_type).is_external(),
            created_at: row.created_at,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::user::{DBUser, UserOrg, UserRole, UserType};

    use super::*;
    use crate::table::entity::{user_auth_state, user_password_history};

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

    async fn user_and_membership_db(email: &str) -> sea_orm::DatabaseConnection {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let schema = Schema::new(db.get_database_backend());
        db.execute_unprepared("PRAGMA foreign_keys = OFF")
            .await
            .unwrap();
        for stmt in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(org_users::Entity),
            schema.create_table_from_entity(user_auth_state::Entity),
            schema.create_table_from_entity(user_password_history::Entity),
        ] {
            db.execute(db.get_database_backend().build(&stmt))
                .await
                .unwrap();
        }
        ActiveModel {
            id: Set("u1".to_string()),
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
        .insert(&db)
        .await
        .unwrap();
        org_users::ActiveModel {
            id: Set("m1".to_string()),
            email: Set(email.to_string()),
            org_id: Set("org1".to_string()),
            role: Set(UserRole::Admin.into()),
            token: Set(String::new()),
            rum_token: Set(None),
            created_at: Set(0),
            updated_at: Set(0),
            allow_static_token: Set(false),
        }
        .insert(&db)
        .await
        .unwrap();
        db
    }

    #[tokio::test]
    async fn test_remove_with_memberships_rolls_back_when_the_user_delete_fails() {
        let db = user_and_membership_db("Member@Example.com").await;
        db.execute_unprepared(
            "CREATE TRIGGER users_delete_fails BEFORE DELETE ON users \
             BEGIN SELECT RAISE(ABORT, 'injected'); END",
        )
        .await
        .unwrap();

        assert!(
            remove_on(&db, &["member@example.com".to_string()], true)
                .await
                .is_err()
        );
        assert_eq!(org_users::Entity::find().count(&db).await.unwrap(), 1);
        assert_eq!(Entity::find().count(&db).await.unwrap(), 1);

        db.execute_unprepared("DROP TRIGGER users_delete_fails")
            .await
            .unwrap();
        remove_on(&db, &["member@example.com".to_string()], true)
            .await
            .unwrap();
        assert_eq!(org_users::Entity::find().count(&db).await.unwrap(), 0);
        assert_eq!(Entity::find().count(&db).await.unwrap(), 0);
    }

    async fn user_with_auth_side_rows_db(email: &str) -> sea_orm::DatabaseConnection {
        let db = user_and_membership_db(email).await;
        user_auth_state::ActiveModel {
            email: Set(email.to_lowercase()),
            failed_attempts: Set(3),
            lockout_level: Set(1),
            locked_until: Set(None),
            last_failed_at: Set(Some(0)),
        }
        .insert(&db)
        .await
        .unwrap();
        user_password_history::ActiveModel {
            id: Set("h1".to_string()),
            email: Set(email.to_string()),
            password_hash: Set(String::new()),
            created_at: Set(0),
        }
        .insert(&db)
        .await
        .unwrap();
        db
    }

    async fn side_row_counts(db: &sea_orm::DatabaseConnection) -> [u64; 4] {
        [
            Entity::find().count(db).await.unwrap(),
            org_users::Entity::find().count(db).await.unwrap(),
            user_auth_state::Entity::find().count(db).await.unwrap(),
            user_password_history::Entity::find()
                .count(db)
                .await
                .unwrap(),
        ]
    }

    #[tokio::test]
    async fn test_removing_a_user_deletes_its_auth_side_rows() {
        for with_memberships in [true, false] {
            let db = user_with_auth_side_rows_db("Member@Example.com").await;

            remove_on(&db, &["member@example.com".to_string()], with_memberships)
                .await
                .unwrap();

            let memberships_left = u64::from(!with_memberships);
            assert_eq!(
                side_row_counts(&db).await,
                [0, memberships_left, 0, 0],
                "with_memberships={with_memberships}"
            );
        }
    }

    #[tokio::test]
    async fn test_a_failed_auth_side_delete_keeps_the_user_for_the_retry() {
        for side_table in ["user_auth_state", "user_password_history"] {
            for with_memberships in [true, false] {
                let db = user_with_auth_side_rows_db("Member@Example.com").await;
                db.execute_unprepared(&format!(
                    "CREATE TRIGGER side_delete_fails BEFORE DELETE ON {side_table} \
                     BEGIN SELECT RAISE(ABORT, 'injected'); END"
                ))
                .await
                .unwrap();

                let case = format!("{side_table}, with_memberships={with_memberships}");
                assert!(
                    remove_on(&db, &["member@example.com".to_string()], with_memberships)
                        .await
                        .is_err(),
                    "a failed side delete must fail the removal: {case}"
                );
                assert_eq!(side_row_counts(&db).await, [1, 1, 1, 1], "{case}");

                db.execute_unprepared("DROP TRIGGER side_delete_fails")
                    .await
                    .unwrap();
                remove_on(&db, &["member@example.com".to_string()], with_memberships)
                    .await
                    .unwrap();
                let memberships_left = u64::from(!with_memberships);
                assert_eq!(
                    side_row_counts(&db).await,
                    [0, memberships_left, 0, 0],
                    "{case}"
                );
            }
        }
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

    async fn users_db(emails: &[(&str, &str)]) -> sea_orm::DatabaseConnection {
        use sea_orm::{ActiveModelTrait, Database, Schema, Set};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        for (id, email) in emails {
            ActiveModel {
                id: Set((*id).to_owned()),
                email: Set((*email).to_owned()),
                first_name: Set(String::new()),
                last_name: Set(String::new()),
                password: Set(String::new()),
                salt: Set(String::new()),
                is_root: Set(false),
                password_ext: Set(None),
                user_type: Set(0),
                created_at: Set(0),
                updated_at: Set(0),
                must_reset_password: Set(false),
                password_reset_reason: Set(None),
                flagged_at: Set(None),
                password_updated_at: Set(None),
            }
            .insert(&db)
            .await
            .unwrap();
        }
        db
    }

    #[tokio::test]
    async fn an_email_resolves_to_its_id_whatever_its_case() {
        let db = users_db(&[("a", "alice@x.com"), ("b", "Bob@X.com")]).await;
        for (email, id) in [
            ("alice@x.com", Some("a")),
            ("ALICE@x.com", Some("a")),
            ("Bob@X.com", Some("b")),
            ("bob@x.com", Some("b")),
            ("carol@x.com", None),
        ] {
            assert_eq!(
                get_id_by_email_with(&db, email).await.unwrap().as_deref(),
                id,
                "{email}"
            );
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

    #[cfg(feature = "cloud")]
    mod listing {
        use sea_orm::{DbBackend, QueryTrait};

        use super::*;
        use crate::table::entity::organizations;

        const USERS: [(&str, &str, i64, bool, UserType); 6] = [
            ("u-root", "root@acme.com", 60, true, UserType::Internal),
            ("u-alice", "Alice@Acme.com", 40, false, UserType::External),
            ("u-bob", "bob@acme.com", 30, false, UserType::Internal),
            ("u-carol", "carol@other.io", 30, false, UserType::Internal),
            ("u-dave", "dave_x@other.io", 10, false, UserType::Internal),
            ("u-jane", "jane.x@other.io", 5, false, UserType::Internal),
        ];
        const MEMBERSHIPS: [(&str, &str, UserRole); 5] = [
            ("root@acme.com", "acme", UserRole::Root),
            ("Alice@Acme.com", "other", UserRole::Viewer),
            ("Alice@Acme.com", "acme", UserRole::Admin),
            ("bob@acme.com", "acme", UserRole::Editor),
            ("carol@other.io", "other", UserRole::Admin),
        ];

        async fn listing_db() -> sea_orm::DatabaseConnection {
            let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
            let backend = db.get_database_backend();
            let schema = Schema::new(backend);
            for stmt in [
                schema.create_table_from_entity(Entity),
                schema.create_table_from_entity(org_users::Entity),
                schema.create_table_from_entity(organizations::Entity),
            ] {
                db.execute(backend.build(&stmt)).await.unwrap();
            }
            for (identifier, name) in [("acme", "Acme Corp"), ("other", "Other Inc")] {
                organizations::ActiveModel {
                    identifier: Set(identifier.to_string()),
                    org_name: Set(name.to_string()),
                    org_type: Set(0),
                    status: Set("active".to_string()),
                    created_at: Set(0),
                    updated_at: Set(0),
                    deleted_at: Set(None),
                    trial_ends_at: Set(0),
                }
                .insert(&db)
                .await
                .unwrap();
            }
            for (id, email, created_at, is_root, user_type) in USERS {
                ActiveModel {
                    id: Set(id.to_string()),
                    email: Set(email.to_string()),
                    first_name: Set(String::new()),
                    last_name: Set(String::new()),
                    password: Set(String::new()),
                    salt: Set(String::new()),
                    is_root: Set(is_root),
                    password_ext: Set(None),
                    user_type: Set(user_type.into()),
                    created_at: Set(created_at),
                    updated_at: Set(created_at),
                    must_reset_password: Set(false),
                    password_reset_reason: Set(None),
                    flagged_at: Set(None),
                    password_updated_at: Set(None),
                }
                .insert(&db)
                .await
                .unwrap();
            }
            for (i, (email, org_id, role)) in MEMBERSHIPS.into_iter().enumerate() {
                org_users::ActiveModel {
                    id: Set(format!("m{i}")),
                    email: Set(email.to_string()),
                    org_id: Set(org_id.to_string()),
                    role: Set(role.into()),
                    token: Set(String::new()),
                    rum_token: Set(None),
                    created_at: Set(0),
                    updated_at: Set(0),
                    allow_static_token: Set(false),
                }
                .insert(&db)
                .await
                .unwrap();
            }
            db
        }

        async fn listed(
            db: &sea_orm::DatabaseConnection,
            search: Option<&str>,
            org_id: Option<&str>,
            page: Option<i64>,
            page_size: Option<i64>,
        ) -> (Vec<String>, u64) {
            let filter = UserListFilter::new(search, org_id, page, page_size);
            let page = list_page_with(db, &filter).await.unwrap();
            (
                page.data.into_iter().map(|user| user.id).collect(),
                page.total,
            )
        }

        #[test]
        fn paging_values_are_clamped_not_rejected() {
            for (page, page_size, expected_idx, expected_size) in [
                (None, None, 0, 20),
                (Some(3), Some(50), 2, 50),
                (Some(0), Some(0), 0, 1),
                (Some(-4), Some(1_000), 0, 100),
                (Some(i64::MAX), Some(-1), u64::from(u32::MAX) - 1, 1),
            ] {
                let filter = UserListFilter::new(None, None, page, page_size);
                assert_eq!(
                    (filter.page_idx, filter.page_size),
                    (expected_idx, expected_size),
                    "page={page:?} page_size={page_size:?}"
                );
            }
        }

        #[test]
        fn blank_search_and_org_filter_nothing() {
            let filter = UserListFilter::new(Some("  "), Some(""), None, None);
            assert_eq!((filter.search, filter.org_id), (None, None));
        }

        #[tokio::test]
        async fn listing_is_newest_first_paged_and_never_returns_root() {
            let db = listing_db().await;
            for (page, page_size, expected) in [
                (
                    None,
                    None,
                    vec!["u-alice", "u-carol", "u-bob", "u-dave", "u-jane"],
                ),
                (Some(1), Some(2), vec!["u-alice", "u-carol"]),
                (Some(2), Some(2), vec!["u-bob", "u-dave"]),
                (Some(3), Some(2), vec!["u-jane"]),
                (Some(9), Some(2), vec![]),
            ] {
                let (ids, total) = listed(&db, None, None, page, page_size).await;
                assert_eq!(ids, expected, "page={page:?} page_size={page_size:?}");
                assert_eq!(total, 5, "page={page:?} page_size={page_size:?}");
            }
        }

        #[tokio::test]
        async fn search_matches_an_exact_id_or_an_email_substring_in_any_case() {
            let db = listing_db().await;
            for (search, expected) in [
                ("ACME", vec!["u-alice", "u-bob"]),
                ("u-bob", vec!["u-bob"]),
                ("U-BOB", vec![]),
                ("u-bo", vec![]),
                ("e_x", vec!["u-dave"]),
                ("%", vec![]),
                ("root", vec![]),
                ("", vec!["u-alice", "u-carol", "u-bob", "u-dave", "u-jane"]),
            ] {
                let (ids, total) = listed(&db, Some(search), None, None, None).await;
                assert_eq!(ids, expected, "{search}");
                assert_eq!(total, expected.len() as u64, "{search}");
            }
        }

        #[tokio::test]
        async fn org_filter_keeps_members_only_and_combines_with_search() {
            let db = listing_db().await;
            for (org_id, search, expected) in [
                ("acme", None, vec!["u-alice", "u-bob"]),
                ("other", None, vec!["u-alice", "u-carol"]),
                ("acme", Some("bob"), vec!["u-bob"]),
                ("other", Some("bob"), vec![]),
                ("missing", None, vec![]),
            ] {
                let (ids, total) = listed(&db, search, Some(org_id), None, None).await;
                assert_eq!(ids, expected, "{org_id} {search:?}");
                assert_eq!(total, expected.len() as u64, "{org_id} {search:?}");
            }
        }

        #[tokio::test]
        async fn each_user_carries_every_membership_with_org_name_and_role() {
            let db = listing_db().await;
            let filter = UserListFilter::new(None, None, None, None);
            let page = list_page_with(&db, &filter).await.unwrap();
            let alice = &page.data[0];
            assert_eq!(alice.email, "Alice@Acme.com");
            assert!(alice.is_external);
            assert_eq!(alice.created_at, 40);
            assert_eq!(
                alice.orgs,
                vec![
                    ListedMembership {
                        org_id: "acme".to_string(),
                        org_name: "Acme Corp".to_string(),
                        role: UserRole::Admin,
                    },
                    ListedMembership {
                        org_id: "other".to_string(),
                        org_name: "Other Inc".to_string(),
                        role: UserRole::Viewer,
                    },
                ]
            );
            let dave = page.data.iter().find(|user| user.id == "u-dave").unwrap();
            assert!(!dave.is_external);
            assert!(dave.orgs.is_empty());
        }

        #[test]
        fn memberships_are_read_for_the_given_emails_only() {
            let sql = memberships_query(vec!["Alice@Acme.com".to_string()])
                .build(DbBackend::Sqlite)
                .to_string();
            // The org_users.email foreign key keeps the users.email spelling, so the index applies.
            assert!(
                sql.contains(r#"WHERE "org_users"."email" IN ('Alice@Acme.com')"#),
                "{sql}"
            );
        }

        #[test]
        fn the_org_filter_matches_stored_emails_exactly() {
            let filter = UserListFilter::new(None, Some("acme"), None, None);
            let sql = listed_users_query(&filter)
                .build(DbBackend::Sqlite)
                .to_string();
            assert!(
                sql.contains(
                    r#""users"."email" IN (SELECT "org_users"."email" FROM "org_users" WHERE "org_users"."org_id" = 'acme')"#
                ),
                "{sql}"
            );
        }
    }
}
