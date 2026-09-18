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

use config::meta::synthetics_variables::GLOBAL_ENVIRONMENT_NAME;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, Set, SqlErr,
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
    pub is_global: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SyntheticsEnvironmentRecord {
    fn to_active_model(&self) -> ActiveModel {
        ActiveModel {
            id: Set(self.id.clone()),
            org_id: Set(self.org_id.clone()),
            name: Set(self.name.clone()),
            description: Set(self.description.clone()),
            owner: Set(self.owner.clone()),
            is_global: Set(self.is_global),
            created_at: Set(self.created_at),
            updated_at: Set(self.updated_at),
        }
    }
}

impl From<Model> for SyntheticsEnvironmentRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            name: m.name,
            description: m.description,
            owner: m.owner,
            is_global: m.is_global,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

/// The global environment's id, derived from the org so every region and node mints the same row.
pub fn global_environment_id(org_id: &str) -> String {
    format!("{GLOBAL_ENVIRONMENT_NAME}_{org_id}")
}

/// Inserts an environment. A duplicate `(org_id, name)` is reported by name,
/// because that is the identifier the caller used and the one shown in the UI.
pub async fn add<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsEnvironmentRecord,
) -> Result<(), errors::Error> {
    match Entity::insert(record.to_active_model()).exec(conn).await {
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

/// The org's global environment, inserted on first sight; `true` when this call inserted it.
pub async fn get_or_create_global<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    now: i64,
) -> Result<(SyntheticsEnvironmentRecord, bool), errors::Error> {
    if let Some(found) = get_by_name(conn, org_id, GLOBAL_ENVIRONMENT_NAME).await? {
        return Ok((found, false));
    }
    let record = SyntheticsEnvironmentRecord {
        id: global_environment_id(org_id),
        org_id: org_id.to_string(),
        name: GLOBAL_ENVIRONMENT_NAME.to_string(),
        description: String::new(),
        owner: None,
        is_global: true,
        created_at: now,
        updated_at: now,
    };
    match Entity::insert(record.to_active_model()).exec(conn).await {
        Ok(_) => Ok((record, true)),
        // Another node won the race; its row is the one to return.
        Err(e) if matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_))) => {
            get_by_name(conn, org_id, GLOBAL_ENVIRONMENT_NAME)
                .await?
                .map(|found| (found, false))
                .ok_or_else(|| Error::DbError(DbError::SeaORMError(e.to_string())))
        }
        Err(e) => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
    }
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

/// Writes a row exactly as another region has it, creating or replacing by id.
pub async fn apply_upsert<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsEnvironmentRecord,
) -> Result<(), errors::Error> {
    Entity::insert(record.to_active_model())
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(Column::Id)
                .update_columns(<Entity as EntityTrait>::Column::iter())
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

/// Deletes an environment and the variables scoped to it, in one transaction.
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

/// Written to be shown: `DbError` would prefix it with its own type names.
fn duplicate_name(name: &str) -> Error {
    Error::Message(format!("environment '{name}' already exists in this org"))
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();
        db
    }

    #[tokio::test]
    async fn the_global_environment_is_created_once_and_then_returned() {
        let db = db().await;
        assert!(list(&db, "acme").await.unwrap().is_empty());

        let (first, created) = get_or_create_global(&db, "acme", 1).await.unwrap();
        assert!(created);
        assert!(first.is_global);
        assert_eq!(first.name, "global");
        assert_eq!(first.id, global_environment_id("acme"));
        assert_eq!(first.owner, None);

        let (second, created) = get_or_create_global(&db, "acme", 2).await.unwrap();
        assert!(!created, "the second call must not insert");
        assert_eq!(second, first);
        assert_eq!(list(&db, "acme").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn each_org_gets_its_own_global_environment() {
        let db = db().await;
        let (acme, _) = get_or_create_global(&db, "acme", 1).await.unwrap();
        let (zeta, created) = get_or_create_global(&db, "zeta", 1).await.unwrap();
        assert!(created);
        assert_ne!(acme.id, zeta.id);
    }

    #[tokio::test]
    async fn an_update_never_writes_the_global_flag() {
        let db = db().await;
        let (global, _) = get_or_create_global(&db, "acme", 1).await.unwrap();
        assert!(
            update(&db, "acme", &global.id, "global", "shared defaults", 2)
                .await
                .unwrap()
        );
        let stored = get_by_id(&db, "acme", &global.id).await.unwrap().unwrap();
        assert!(stored.is_global);
        assert_eq!(stored.description, "shared defaults");
    }
}
