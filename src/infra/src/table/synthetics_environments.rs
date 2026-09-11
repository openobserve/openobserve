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

//! Synthetics environment storage.
//!
//! An environment is an entity rather than a free-form label because it gates
//! credentials: its `name` is the OpenFGA object id that decides who may rotate
//! the secrets scoped to it.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set, SqlErr,
    TransactionTrait,
};

use super::entity::synthetics_environments::{ActiveModel, Column, Entity, Model};
use crate::errors::{self, DbError, Error};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticsEnvironmentRecord {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: String,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for SyntheticsEnvironmentRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            name: m.name,
            description: m.description,
            owner: m.owner,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

/// Inserts an environment. A duplicate `(org_id, name)` is reported by name,
/// because that is the identifier the caller used and the one shown in the UI.
pub async fn add<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsEnvironmentRecord,
) -> Result<(), errors::Error> {
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        description: Set(record.description.clone()),
        owner: Set(record.owner.clone()),
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
    };
    match Entity::insert(model).exec(conn).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(duplicate_name(&record.name)),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<SyntheticsEnvironmentRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
        .map(SyntheticsEnvironmentRecord::from))
}

/// Looks an environment up by the name the URL and OpenFGA both use.
pub async fn get_by_name<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<SyntheticsEnvironmentRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(conn)
        .await?
        .map(SyntheticsEnvironmentRecord::from))
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<SyntheticsEnvironmentRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::Name)
        .all(conn)
        .await?
        .into_iter()
        .map(SyntheticsEnvironmentRecord::from)
        .collect())
}

/// Updates name and description. `owner` and `created_at` are set once at
/// create and never rewritten, so an edit cannot reassign authorship.
pub async fn update<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    name: &str,
    description: &str,
    updated_at: i64,
) -> Result<bool, errors::Error> {
    let Some(model) = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    let mut am: ActiveModel = model.into();
    am.name = Set(name.to_string());
    am.description = Set(description.to_string());
    am.updated_at = Set(updated_at);
    match Entity::update(am).exec(conn).await {
        Ok(_) => Ok(true),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(duplicate_name(name)),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Deletes an environment and the variables scoped to it, in one transaction.
///
/// The variables go first because of the foreign key, and both go together
/// because the alternative — refusing to delete a non-empty environment —
/// leaves the caller no way to remove one without emptying it by hand, and a
/// half-completed delete would strand rows the FK then blocks forever.
pub async fn delete<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;
    super::synthetics_variables::delete_by_env(&txn, org_id, id).await?;
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(res.rows_affected > 0)
}

fn duplicate_name(name: &str) -> Error {
    Error::DbError(DbError::SeaORMError(format!(
        "environment '{name}' already exists in this org"
    )))
}
