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

//! Org-level synthetics variable storage.
//!
//! Rows here are the shared tier. The check's own inline variables are stored on
//! the check and merged over these at resolve time, so nothing in this module
//! knows about precedence.

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::{
    RwHashMap,
    meta::synthetics_variables::{SyntheticsVariableView, VariableValueView},
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, Set, SqlErr,
};

use super::entity::synthetics_variables::{ActiveModel, Column, Entity, Model};
use crate::errors::{self, DbError, Error};

/// The stored `kind` for a write-only variable.
pub const KIND_SECRET: &str = "secret";
/// The stored `kind` for a variable whose value has no access boundary of its own.
pub const KIND_PLAIN: &str = "plain";

/// `org_id` → every shared variable in the org, with the time it was loaded.
static VARIABLE_CACHE: LazyLock<RwHashMap<String, (Vec<SyntheticsVariableRecord>, Instant)>> =
    LazyLock::new(Default::default);

const VARIABLE_CACHE_TTL: Duration = Duration::from_secs(15);

/// One shared variable as stored. `value` is ciphertext; decryption happens in
/// the synthetics service, which owns the org DEK.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticsVariableRecord {
    pub id: String,
    pub org_id: String,
    pub env: String,
    pub name: String,
    pub value: String,
    pub kind: String,
    pub description: String,
    pub example: String,
    pub tags: Vec<String>,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for SyntheticsVariableRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            env: m.env,
            name: m.name,
            value: m.value,
            kind: m.kind,
            description: m.description,
            example: m.example,
            tags: serde_json::from_value(m.tags).unwrap_or_default(),
            owner: m.owner,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

impl SyntheticsVariableRecord {
    pub fn is_secret(&self) -> bool {
        self.kind == KIND_SECRET
    }

    /// The read projection, given the plaintext for a plain variable.
    pub fn to_view(&self, plain_value: Option<String>) -> SyntheticsVariableView {
        SyntheticsVariableView {
            id: self.id.clone(),
            name: self.name.clone(),
            value: if self.is_secret() {
                VariableValueView::Secret {
                    has_value: !self.value.is_empty(),
                }
            } else {
                VariableValueView::Plain {
                    value: plain_value.unwrap_or_default(),
                }
            },
            description: self.description.clone(),
            example: self.example.clone(),
            tags: self.tags.clone(),
            // Stamped by the service, which is the only layer that can see
            // checks. Zero here means "not counted yet", never "unused".
            used_by_checks: 0,
            owner: self.owner.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// Drops one org's variables from the cache. Called by the coordinator watcher,
/// which must not re-publish or the event would echo forever.
pub fn invalidate_cache(org_id: &str) {
    VARIABLE_CACHE.remove(org_id);
}

/// Every shared variable in an org, served from [`VARIABLE_CACHE`] when fresh.
pub async fn list_cached<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<SyntheticsVariableRecord>, errors::Error> {
    if let Some(entry) = VARIABLE_CACHE.get(org_id)
        && entry.1.elapsed() < VARIABLE_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }
    let rows = list(conn, org_id).await?;
    VARIABLE_CACHE.insert(org_id.to_string(), (rows.clone(), Instant::now()));
    Ok(rows)
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<SyntheticsVariableRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::Name)
        .all(conn)
        .await?
        .into_iter()
        .map(SyntheticsVariableRecord::from)
        .collect())
}

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<SyntheticsVariableRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
        .map(SyntheticsVariableRecord::from))
}

/// Inserts a variable and invalidates the org's cache.
///
/// Not for use inside a transaction — see [`insert_row`].
pub async fn add<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<(), errors::Error> {
    insert_row(conn, record).await?;
    invalidate_and_publish(&record.org_id).await;
    Ok(())
}

/// Inserts a variable without touching the cache.
pub async fn insert_row<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<(), errors::Error> {
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        env: Set(record.env.clone()),
        name: Set(record.name.clone()),
        value: Set(record.value.clone()),
        kind: Set(record.kind.clone()),
        description: Set(record.description.clone()),
        example: Set(record.example.clone()),
        tags: Set(serde_json::to_value(&record.tags)?),
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

/// Overwrites the mutable fields of one variable.
pub async fn update<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<bool, errors::Error> {
    let Some(model) = Entity::find()
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::Id.eq(&record.id))
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    let mut am: ActiveModel = model.into();
    am.name = Set(record.name.clone());
    am.value = Set(record.value.clone());
    am.kind = Set(record.kind.clone());
    am.description = Set(record.description.clone());
    am.example = Set(record.example.clone());
    am.tags = Set(serde_json::to_value(&record.tags)?);
    am.updated_at = Set(record.updated_at);
    match Entity::update(am).exec(conn).await {
        Ok(_) => {
            invalidate_and_publish(&record.org_id).await;
            Ok(true)
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(duplicate_name(&record.name)),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

/// Moves one variable to a different scope.
pub async fn set_env<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    env: &str,
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
    am.env = Set(env.to_string());
    am.updated_at = Set(updated_at);
    match Entity::update(am).exec(conn).await {
        Ok(_) => {
            invalidate_and_publish(org_id).await;
            Ok(true)
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(Error::Message(
                "a variable with that name already exists in the destination scope".to_string(),
            )),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

pub async fn delete<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let removed = delete_row(conn, org_id, id).await?;
    invalidate_and_publish(org_id).await;
    Ok(removed)
}

/// Writes a row exactly as another region has it, creating or replacing by id.
pub async fn apply_upsert<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<(), errors::Error> {
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        env: Set(record.env.clone()),
        name: Set(record.name.clone()),
        value: Set(record.value.clone()),
        kind: Set(record.kind.clone()),
        description: Set(record.description.clone()),
        example: Set(record.example.clone()),
        tags: Set(serde_json::to_value(&record.tags)?),
        owner: Set(record.owner.clone()),
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
    };
    // Last write wins by primary key: the queue redelivers, so an apply has to
    // be safe to run twice.
    Entity::insert(model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(Column::Id)
                .update_columns(<Entity as EntityTrait>::Column::iter())
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

/// Deletes a variable without touching the cache. The transactional twin of
/// [`insert_row`], and for the same reason.
pub async fn delete_row<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Removes every variable scoped to one environment. Called inside the
/// environment delete transaction, so it publishes nothing itself — the caller
/// does, once, after the commit.
pub async fn delete_by_env<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Env.eq(env))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Invalidates locally **and** tells every other node.
pub async fn invalidate_and_publish(org_id: &str) {
    invalidate_cache(org_id);
    if let Err(e) = crate::coordinator::synthetics::emit_variables_changed(org_id).await {
        log::error!("[synthetics] emit variable cache event failed for {org_id}: {e}");
    }
}

/// Written to be shown: `DbError` would prefix it with its own type names.
fn duplicate_name(name: &str) -> Error {
    Error::Message(format!("variable '{name}' already exists in this scope"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(kind: &str, value: &str) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            id: "id1".into(),
            org_id: "acme".into(),
            env: "env1".into(),
            name: "TOKEN".into(),
            value: value.into(),
            kind: kind.into(),
            description: "the token".into(),
            example: "sk-...".into(),
            tags: vec!["auth".into()],
            owner: Some("someone@example.com".into()),
            created_at: 1,
            updated_at: 2,
        }
    }

    #[test]
    fn a_secret_view_carries_presence_not_the_value() {
        // Even handed a plaintext, the secret variant has nowhere to put it.
        let view = record(KIND_SECRET, "AESenc:abc").to_view(Some("hunter2".into()));
        assert_eq!(view.value, VariableValueView::Secret { has_value: true });
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("AESenc"), "{json}");
        assert!(!json.contains("hunter2"), "{json}");
        assert!(!json.contains("\"value\""), "{json}");
    }

    #[test]
    fn an_empty_stored_secret_reads_as_absent() {
        assert_eq!(
            record(KIND_SECRET, "").to_view(None).value,
            VariableValueView::Secret { has_value: false }
        );
    }

    #[test]
    fn a_plain_view_carries_the_decrypted_value() {
        assert_eq!(
            record(KIND_PLAIN, "AESenc:abc")
                .to_view(Some("https://shop.test".into()))
                .value,
            VariableValueView::Plain {
                value: "https://shop.test".into()
            }
        );
    }

    #[test]
    fn a_plain_row_that_will_not_decrypt_reads_as_empty() {
        // One corrupt row must not fail the whole list.
        assert_eq!(
            record(KIND_PLAIN, "AESenc:corrupt").to_view(None).value,
            VariableValueView::Plain {
                value: String::new()
            }
        );
    }
}
