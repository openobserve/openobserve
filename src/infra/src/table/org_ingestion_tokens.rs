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

use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, entity::prelude::*,
};

use super::entity::org_ingestion_tokens::{ActiveModel, Column, Entity, Model};
use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

pub const ORG_INGESTION_TOKEN_PREFIX: &str = "o2oi_";

#[derive(Debug, Clone)]
pub struct OrgIngestionTokenRecord {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub token: String,
    pub description: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for OrgIngestionTokenRecord {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org_id: model.org_id,
            name: model.name,
            token: model.token,
            description: model.description,
            is_default: model.is_default,
            enabled: model.enabled,
            created_by: model.created_by,
            created_at: model.created_at,
            updated_at: model.updated_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub struct OrgIngestionTokenListRecord {
    pub name: String,
    pub token: String,
    pub description: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
}

/// Generate a new org ingestion token with the `o2oi_` prefix.
pub fn generate_token() -> String {
    let random_part = config::utils::rand::generate_random_string(32);
    format!("{}{}", ORG_INGESTION_TOKEN_PREFIX, random_part)
}

/// Insert a new org ingestion token row.
pub async fn add(record: &OrgIngestionTokenRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        token: Set(record.token.clone()),
        description: Set(record.description.clone()),
        is_default: Set(record.is_default),
        enabled: Set(record.enabled),
        created_by: Set(record.created_by.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match Entity::insert(model).exec(client).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                Err(Error::DbError(DbError::SeaORMError(format!(
                    "Token with name '{}' already exists in org",
                    record.name
                ))))
            }
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Find a token by org_id and token value. Only returns enabled tokens.
pub async fn find_enabled_token(
    org_id: &str,
    token: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Token.eq(token))
        .filter(Column::Enabled.eq(true))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// List all tokens for an org (token values masked).
pub async fn list_by_org(org_id: &str) -> Result<Vec<OrgIngestionTokenListRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::IsDefault, Order::Desc)
        .order_by(Column::CreatedAt, Order::Desc)
        .select_only()
        .column(Column::Name)
        .column(Column::Token)
        .column(Column::Description)
        .column(Column::IsDefault)
        .column(Column::Enabled)
        .column(Column::CreatedBy)
        .column(Column::CreatedAt)
        .into_model::<OrgIngestionTokenListRecord>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

/// Get a single token record by org_id and name.
pub async fn get_by_name(
    org_id: &str,
    name: &str,
) -> Result<Option<OrgIngestionTokenRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(OrgIngestionTokenRecord::from))
}

/// Rotate (regenerate) a token's value. Returns the new token.
pub async fn rotate_token(org_id: &str, name: &str) -> Result<String, errors::Error> {
    let new_token = generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::update_many()
        .col_expr(Column::Token, Expr::value(new_token.clone()))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(new_token)
}

/// Delete all tokens for an org (cascade on org deletion).
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Count tokens for an org.
pub async fn count_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let count = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(count)
}

/// Enable or disable a token by org_id and name.
pub async fn set_enabled(
    org_id: &str,
    name: &str,
    enabled: bool,
) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// List all enabled tokens (for cache bootstrapping). Returns (org_id, token, name) tuples.
pub async fn list_all_enabled() -> Result<Vec<(String, String, String)>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let records = Entity::find()
        .filter(Column::Enabled.eq(true))
        .select_only()
        .column(Column::OrgId)
        .column(Column::Token)
        .column(Column::Name)
        .into_tuple::<(String, String, String)>()
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_token_prefix() {
        let token = generate_token();
        assert!(token.starts_with("o2oi_"));
        assert_eq!(token.len(), 37); // "o2oi_" + 32 alphanumeric
    }

    #[test]
    fn test_generate_token_unique() {
        let t1 = generate_token();
        let t2 = generate_token();
        assert_ne!(t1, t2);
    }

    #[test]
    fn test_org_ingestion_token_prefix_constant() {
        assert_eq!(ORG_INGESTION_TOKEN_PREFIX, "o2oi_");
    }

    #[test]
    fn test_generate_token_is_ascii_alphanumeric() {
        let token = generate_token();
        let random_part = token.strip_prefix("o2oi_").unwrap();
        assert_eq!(random_part.len(), 32);
        assert!(random_part.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_record_from_model() {
        use super::super::entity::org_ingestion_tokens::Model;
        let model = Model {
            id: "id-1".to_string(),
            org_id: "org-1".to_string(),
            name: "default".to_string(),
            token: "o2oi_test".to_string(),
            description: "desc".to_string(),
            is_default: true,
            enabled: true,
            created_by: "admin@test.com".to_string(),
            created_at: 1000,
            updated_at: 2000,
        };
        let record = OrgIngestionTokenRecord::from(model);
        assert_eq!(record.id, "id-1");
        assert_eq!(record.org_id, "org-1");
        assert_eq!(record.name, "default");
        assert!(record.is_default);
        assert!(record.enabled);
    }

    #[test]
    fn test_record_from_model_disabled() {
        use super::super::entity::org_ingestion_tokens::Model;
        let model = Model {
            id: "id-2".to_string(),
            org_id: "org-2".to_string(),
            name: "disabled-token".to_string(),
            token: "o2oi_disabled".to_string(),
            description: String::new(),
            is_default: false,
            enabled: false,
            created_by: "system".to_string(),
            created_at: 5000,
            updated_at: 6000,
        };
        let record = OrgIngestionTokenRecord::from(model);
        assert_eq!(record.id, "id-2");
        assert!(!record.is_default);
        assert!(!record.enabled);
        assert_eq!(record.description, "");
    }
}
