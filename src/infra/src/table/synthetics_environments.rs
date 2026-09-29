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

use config::meta::synthetics_variables::GLOBAL_ENVIRONMENT_NAME;
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

/// Deterministic per `(org, name)`; `/` fits neither an org id (a URL segment) nor a name.
pub fn environment_id(org_id: &str, name: &str) -> String {
    format!("{org_id}/{name}")
}

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
        // Zero in every region, so no region's copy ever wins a replication race over another's.
        created_at: 0,
        updated_at: 0,
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
        // A case-insensitive collation matches `Prod` to `prod`; grants key on the exact name.
        .filter(|m| m.name == name)
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

/// Writes a row as another region has it, unless the stored copy is newer.
pub async fn apply_upsert<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsEnvironmentRecord,
) -> Result<bool, errors::Error> {
    let updated = Entity::update_many()
        .set(record.to_active_model())
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::Id.eq(&record.id))
        .filter(Column::UpdatedAt.lte(record.updated_at))
        .exec(conn)
        .await?;
    if updated.rows_affected > 0 {
        return Ok(true);
    }
    let inserted = Entity::insert(record.to_active_model())
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(Column::Id)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(inserted > 0)
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
    Error::DuplicateName(format!("environment '{name}' already exists in this org"))
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

        let (first, created) = get_or_create_global(&db, "acme").await.unwrap();
        assert!(created);
        assert!(first.is_global);
        assert_eq!(first.name, "global");
        assert_eq!(first.id, global_environment_id("acme"));
        assert_eq!(first.owner, None);
        assert_eq!((first.created_at, first.updated_at), (0, 0));

        let (second, created) = get_or_create_global(&db, "acme").await.unwrap();
        assert!(!created, "the second call must not insert");
        assert_eq!(second, first);
        assert_eq!(list(&db, "acme").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn each_org_gets_its_own_global_environment() {
        let db = db().await;
        let (acme, _) = get_or_create_global(&db, "acme").await.unwrap();
        let (zeta, created) = get_or_create_global(&db, "zeta").await.unwrap();
        assert!(created);
        assert_ne!(acme.id, zeta.id);
    }

    #[tokio::test]
    async fn an_update_never_writes_the_global_flag() {
        let db = db().await;
        let (global, _) = get_or_create_global(&db, "acme").await.unwrap();
        assert!(
            update(&db, "acme", &global.id, "global", "shared defaults", 2)
                .await
                .unwrap()
        );
        let stored = get_by_id(&db, "acme", &global.id).await.unwrap().unwrap();
        assert!(stored.is_global);
        assert_eq!(stored.description, "shared defaults");
    }

    fn env(id: &str, description: &str, updated_at: i64) -> SyntheticsEnvironmentRecord {
        SyntheticsEnvironmentRecord {
            id: id.to_string(),
            org_id: "acme".to_string(),
            name: "staging".to_string(),
            description: description.to_string(),
            owner: None,
            is_global: false,
            created_at: 1,
            updated_at,
        }
    }

    #[tokio::test]
    async fn an_older_replicated_environment_never_overwrites_a_newer_one() {
        let db = db().await;
        assert!(
            apply_upsert(&db, &env("acme/staging", "new", 5))
                .await
                .unwrap()
        );
        assert!(
            !apply_upsert(&db, &env("acme/staging", "old", 3))
                .await
                .unwrap()
        );
        assert!(
            apply_upsert(&db, &env("acme/staging", "same", 5))
                .await
                .unwrap()
        );
        let stored = get_by_id(&db, "acme", "acme/staging")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.description, "same");
    }

    #[test]
    fn environment_ids_are_deterministic_and_never_collide() {
        assert_eq!(
            environment_id("acme", "prod"),
            environment_id("acme", "prod")
        );
        assert_ne!(environment_id("a_b", "c"), environment_id("a", "b_c"));
        assert_ne!(
            environment_id("acme", "prod"),
            environment_id("acme2", "prod")
        );
        assert_ne!(environment_id("acme", "x"), global_environment_id("acme"));
        assert!(!global_environment_id("acme").contains('/'));
    }
}
