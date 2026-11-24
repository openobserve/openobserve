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

use config::meta::{secret_store::env_incarnation, synthetics_variables::GLOBAL_ENVIRONMENT_NAME};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Select, Set,
    SqlErr, TransactionTrait, sea_query::Expr,
};

use super::{
    entity::synthetics_environments::{ActiveModel, Column, Entity, Model},
    org_secret_values,
    secret_store_job_markers::{self, ALL_ORGS, FILL_ENV_INCARNATION},
    synthetics_env_retired, synthetics_variables,
};
use crate::errors::{self, DbError, Error};

/// Rows per commit of the incarnation fill.
pub const FILL_PAGE_ROWS: u64 = 200;
const FILL_LOCK_KEY: &str = "/secret_store/maint/fill_env_incarnation";

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
    /// Derived from immutable fields, so it equals the stored column whether or not the fill ran.
    pub fn incarnation(&self) -> String {
        env_incarnation(&self.org_id, &self.id, self.created_at)
    }

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
            incarnation: Set(self.incarnation()),
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

pub async fn add<C: TransactionTrait>(
    conn: &C,
    record: &mut SyntheticsEnvironmentRecord,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    // A concurrent delete may still own the id. Acquire it before reading that delete's watermark.
    Entity::insert(record.to_active_model())
        .exec(&txn)
        .await
        .map_err(|e| match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => duplicate_name(&record.name),
            _ => e.into(),
        })?;
    let mut created_at = record.created_at;
    if let Some(retired) = synthetics_env_retired::get_in(&txn, &record.org_id, &record.id).await?
        && created_at <= retired.retired_created_at
    {
        created_at = retired
            .retired_created_at
            .checked_add(1)
            .ok_or_else(|| Error::Message("environment creation timestamp exhausted".into()))?;
        let incarnation = env_incarnation(&record.org_id, &record.id, created_at);
        Entity::update_many()
            .col_expr(Column::CreatedAt, Expr::value(created_at))
            .col_expr(Column::Incarnation, Expr::value(incarnation))
            .filter(Column::OrgId.eq(&record.org_id))
            .filter(Column::Id.eq(&record.id))
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;
    record.created_at = created_at;
    Ok(())
}

pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<SyntheticsEnvironmentRecord>, errors::Error> {
    Ok(environment_by_id(org_id, id)
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

/// Writes a row as another region has it, unless the stored copy is newer or that life was deleted.
pub async fn apply_upsert<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsEnvironmentRecord,
) -> Result<bool, errors::Error> {
    if synthetics_env_retired::get_in(conn, &record.org_id, &record.id)
        .await?
        .is_some_and(|retired| record.created_at <= retired.retired_created_at)
    {
        return Ok(false);
    }
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

pub async fn delete<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;
    let retired = retire_environment(&txn, org_id, id).await?;
    txn.commit().await?;
    Ok(retired)
}

/// The caller's transaction keeps the watermark, credentials and value heads tied to the same life.
pub async fn retire_environment<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    env_id: &str,
) -> Result<bool, errors::Error> {
    let Some(model) = environment_by_id(org_id, env_id)
        .lock_exclusive()
        .one(txn)
        .await?
    else {
        return Ok(false);
    };
    let record = SyntheticsEnvironmentRecord::from(model);
    synthetics_variables::delete_by_env(txn, org_id, env_id).await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(env_id))
        .exec(txn)
        .await?;
    org_secret_values::retire_environment_in(txn, org_id, env_id, &record.incarnation()).await?;
    synthetics_env_retired::retire_in(txn, org_id, env_id, record.created_at).await?;
    Ok(true)
}

/// Deletes an org's environments; its variables go first (`synthetics_variables_env_fk`).
pub async fn delete_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Fills `''` incarnations page by page, then writes the done marker; returns rows written.
/// Conditional writes make a rerun, a resume or a second worker a no-op on filled rows.
pub async fn fill_incarnation<C: TransactionTrait>(conn: &C) -> Result<u64, errors::Error> {
    let mut after = String::new();
    let mut written = 0;
    loop {
        let txn = conn.begin().await?;
        let (page_written, last) = fill_incarnation_page(&txn, &after).await?;
        txn.commit().await?;
        written += page_written;
        match last {
            Some(id) => after = id,
            None => break,
        }
    }
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();
    secret_store_job_markers::insert_if_absent_in(&txn, ALL_ORGS, FILL_ENV_INCARNATION, now)
        .await?;
    txn.commit().await?;
    Ok(written)
}

/// The post-boot fill under the cluster lock; skips the pass once the marker exists.
pub async fn run_incarnation_fill() -> Result<u64, errors::Error> {
    let conn = crate::db::get_orm_client_rw().await;
    if fill_marker_done(conn).await? {
        return Ok(0);
    }
    let locker = crate::dist_lock::lock(FILL_LOCK_KEY, 0).await?;
    let result = match fill_marker_done(conn).await {
        Ok(true) => Ok(0),
        Ok(false) => fill_incarnation(conn).await,
        Err(e) => Err(e),
    };
    crate::dist_lock::unlock(&locker).await?;
    result
}

fn environment_by_id(org_id: &str, id: &str) -> Select<Entity> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
}

/// Written to be shown: `DbError` would prefix it with its own type names.
fn duplicate_name(name: &str) -> Error {
    Error::DuplicateName(format!("environment '{name}' already exists in this org"))
}

async fn fill_marker_done<C: ConnectionTrait>(conn: &C) -> Result<bool, errors::Error> {
    Ok(
        secret_store_job_markers::get_marker_in(conn, ALL_ORGS, FILL_ENV_INCARNATION)
            .await?
            .is_some(),
    )
}

/// One keyset page after `after`; the last id is `None` once a page comes back short.
async fn fill_incarnation_page<C: ConnectionTrait>(
    conn: &C,
    after: &str,
) -> Result<(u64, Option<String>), errors::Error> {
    let rows: Vec<(String, String, i64)> = Entity::find()
        .select_only()
        .column(Column::Id)
        .column(Column::OrgId)
        .column(Column::CreatedAt)
        .filter(Column::Incarnation.eq(""))
        .filter(Column::Id.gt(after))
        .order_by_asc(Column::Id)
        .limit(FILL_PAGE_ROWS)
        .into_tuple()
        .all(conn)
        .await?;
    let mut written = 0;
    for (id, org_id, created_at) in &rows {
        let res = Entity::update_many()
            .col_expr(
                Column::Incarnation,
                Expr::value(env_incarnation(org_id, id, *created_at)),
            )
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::Id.eq(id))
            .filter(Column::CreatedAt.eq(*created_at))
            .filter(Column::Incarnation.eq(""))
            .exec(conn)
            .await?;
        written += res.rows_affected;
    }
    let last = if (rows.len() as u64) < FILL_PAGE_ROWS {
        None
    } else {
        rows.last().map(|(id, ..)| id.clone())
    };
    Ok((written, last))
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::table::{
        credential_values,
        entity::credential_values as credentials,
        testing::{meta_store, unique},
    };

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
        db.execute(
            backend.build(&schema.create_table_from_entity(secret_store_job_markers::Entity)),
        )
        .await
        .unwrap();
        db.execute(backend.build(&schema.create_table_from_entity(synthetics_env_retired::Entity)))
            .await
            .unwrap();
        db
    }

    async fn stored_incarnation(
        db: &DatabaseConnection,
        record: &SyntheticsEnvironmentRecord,
    ) -> String {
        environment_by_id(&record.org_id, &record.id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .incarnation
    }

    /// Rows as an older node writes them: no incarnation.
    async fn seed_blank(db: &DatabaseConnection, count: usize) -> Vec<SyntheticsEnvironmentRecord> {
        let mut seeded = vec![];
        for i in 0..count {
            let mut record = env(&format!("acme/e{i:04}"), "", 1);
            record.name = format!("e{i:04}");
            record.created_at = 1_000 + i as i64;
            add(db, &mut record).await.unwrap();
            seeded.push(record);
        }
        Entity::update_many()
            .col_expr(Column::Incarnation, Expr::value(""))
            .exec(db)
            .await
            .unwrap();
        seeded
    }

    async fn marker_done(db: &DatabaseConnection) -> bool {
        fill_marker_done(db).await.unwrap()
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

    #[tokio::test]
    async fn every_writer_stores_the_derived_incarnation() {
        let db = db().await;
        let (global, _) = get_or_create_global(&db, "acme").await.unwrap();
        assert_eq!(
            stored_incarnation(&db, &global).await,
            env_incarnation("acme", &global.id, 0)
        );
        let mut local = env("acme/staging", "", 1);
        add(&db, &mut local).await.unwrap();
        assert_eq!(stored_incarnation(&db, &local).await, local.incarnation());
        let mut replicated = env("acme/qa", "", 9);
        replicated.name = "qa".to_string();
        replicated.created_at = 7;
        assert!(apply_upsert(&db, &replicated).await.unwrap());
        assert_eq!(
            stored_incarnation(&db, &replicated).await,
            env_incarnation("acme", "acme/qa", 7)
        );
        assert_eq!(local.incarnation().len(), 27);
    }

    #[tokio::test]
    async fn the_fill_writes_what_readers_already_compute_and_a_rerun_changes_nothing() {
        let db = db().await;
        let seeded = seed_blank(&db, 450).await;
        let before: Vec<String> = seeded.iter().map(|r| r.incarnation()).collect();
        assert!(!marker_done(&db).await);

        assert_eq!(fill_incarnation(&db).await.unwrap(), 450);
        assert!(marker_done(&db).await);
        for (record, expected) in seeded.iter().zip(&before) {
            assert_eq!(&stored_incarnation(&db, record).await, expected);
            let read = get_by_id(&db, "acme", &record.id).await.unwrap().unwrap();
            assert_eq!(&read.incarnation(), expected);
        }
        assert_eq!(fill_incarnation(&db).await.unwrap(), 0);
        assert_eq!(stored_incarnation(&db, &seeded[0]).await, before[0]);
    }

    #[tokio::test]
    async fn an_interrupted_fill_resumes_and_two_workers_write_each_row_once() {
        let db = db().await;
        let seeded = seed_blank(&db, 230).await;
        let (first, last) = fill_incarnation_page(&db, "").await.unwrap();
        assert_eq!(first, FILL_PAGE_ROWS);
        assert!(last.is_some());
        assert!(!marker_done(&db).await, "no marker until the last page");

        let (a, b) = tokio::join!(fill_incarnation(&db), fill_incarnation(&db));
        assert_eq!(first + a.unwrap() + b.unwrap(), 230);
        for record in &seeded {
            assert_eq!(stored_incarnation(&db, record).await, record.incarnation());
        }
        assert!(marker_done(&db).await);
    }

    async fn seed_value(
        db: &DatabaseConnection,
        org_id: &str,
        env_id: &str,
        incarnation: &str,
    ) -> org_secret_values::Model {
        let value = org_secret_values::Model {
            id: config::ider::ksuid(),
            org_id: org_id.into(),
            secret_id: "secret".into(),
            env_id: env_id.into(),
            env_incarnation: incarnation.into(),
            state: "active".into(),
            value_ref: Some(config::ider::ksuid()),
            backend_id: None,
            value_rev: config::ider::ksuid(),
            value_version: 1,
            updated_by: "tester".into(),
        };
        org_secret_values::insert_in(db, value.into())
            .await
            .unwrap()
    }

    async fn read_value(
        db: &DatabaseConnection,
        value: &org_secret_values::Model,
    ) -> org_secret_values::Model {
        org_secret_values::get_value_in(
            db,
            &value.org_id,
            &value.secret_id,
            &value.env_id,
            &value.env_incarnation,
        )
        .await
        .unwrap()
        .unwrap()
    }

    #[tokio::test]
    async fn retirement_commits_or_rolls_back_the_whole_environment_incarnation() {
        if !meta_store().await {
            return;
        }
        let db = crate::db::get_orm_client_rw().await;
        let org = unique("retire_env");
        let mut record = env(&environment_id(&org, "staging"), "", 10);
        record.org_id = org.clone();
        record.created_at = 10;
        add(db, &mut record).await.unwrap();
        let current = seed_value(db, &org, &record.id, &record.incarnation()).await;
        let older = seed_value(db, &org, &record.id, &env_incarnation(&org, &record.id, 9)).await;
        let other = seed_value(
            db,
            &org,
            &environment_id(&org, "other"),
            &record.incarnation(),
        )
        .await;
        let credential = credentials::Model {
            id: config::ider::ksuid(),
            secret_ref: current.value_ref.clone().unwrap(),
            org_id: org.clone(),
            owner_kind: credential_values::OWNER_KIND_ORG_SECRET.into(),
            owner_id: current.id.clone(),
            purpose: "value".into(),
            key_id: None,
            state: "current".into(),
            ciphertext: "ciphertext".into(),
            last_verified_at: None,
            grace_expires_at: None,
            created_at: 10,
            updated_at: 10,
        };
        credential_values::insert(db, credential.clone().into())
            .await
            .unwrap();
        let pointer = org_secret_values::insert_in(
            db,
            org_secret_values::Model {
                id: config::ider::ksuid(),
                secret_id: "pointer".into(),
                value_ref: Some(config::ider::ksuid()),
                backend_id: Some(config::ider::ksuid()),
                ..current.clone()
            }
            .into(),
        )
        .await
        .unwrap();
        let pointer_credential = credentials::Model {
            id: config::ider::ksuid(),
            secret_ref: pointer.value_ref.clone().unwrap(),
            owner_kind: credential_values::OWNER_KIND_ORG_SECRET_POINTER.into(),
            owner_id: pointer.id.clone(),
            ..credential.clone()
        };
        credential_values::insert(db, pointer_credential.clone().into())
            .await
            .unwrap();
        let variable = synthetics_variables::SyntheticsVariableRecord {
            id: config::ider::ksuid(),
            org_id: org.clone(),
            env: record.id.clone(),
            name: "url".into(),
            value: "test".into(),
            kind: "plain".into(),
            description: String::new(),
            example: String::new(),
            tags: vec![],
            owner: None,
            created_at: 10,
            updated_at: 10,
        };
        synthetics_variables::insert_row(db, &variable)
            .await
            .unwrap();

        let txn = db.begin().await.unwrap();
        assert!(retire_environment(&txn, &org, &record.id).await.unwrap());
        txn.rollback().await.unwrap();
        assert_eq!(
            get_by_id(db, &org, &record.id).await.unwrap().unwrap(),
            record
        );
        assert_eq!(
            synthetics_variables::get(db, &org, &variable.id)
                .await
                .unwrap()
                .unwrap(),
            variable
        );
        for value in [&current, &pointer, &older, &other] {
            assert_eq!(&read_value(db, value).await, value);
        }
        for owned in [&credential, &pointer_credential] {
            assert_eq!(
                &credential_values::find_state(db, &org, &owned.secret_ref, "current")
                    .await
                    .unwrap()
                    .unwrap(),
                owned
            );
        }
        assert!(
            synthetics_env_retired::get_in(db, &org, &record.id)
                .await
                .unwrap()
                .is_none()
        );

        let before = chrono::Utc::now().timestamp_millis();
        assert!(delete(db, &org, &record.id).await.unwrap());
        assert!(!delete(db, &org, &record.id).await.unwrap());
        assert!(get_by_id(db, &org, &record.id).await.unwrap().is_none());
        assert!(
            synthetics_variables::get(db, &org, &variable.id)
                .await
                .unwrap()
                .is_none()
        );
        for value in [&current, &pointer] {
            let deleted = read_value(db, value).await;
            assert_eq!(deleted.state, "deleted");
            assert!(deleted.value_ref.is_none() && deleted.backend_id.is_none());
        }
        for value in [&older, &other] {
            assert_eq!(&read_value(db, value).await, value);
        }
        for owned in [&credential, &pointer_credential] {
            let retired = credential_values::find_state(db, &org, &owned.secret_ref, "retired")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(retired.id, owned.id);
            assert!(
                (before..=chrono::Utc::now().timestamp_millis())
                    .contains(&retired.grace_expires_at.unwrap())
            );
        }
        assert_eq!(
            synthetics_env_retired::get_in(db, &org, &record.id)
                .await
                .unwrap()
                .unwrap()
                .retired_created_at,
            record.created_at
        );
        org_secret_values::delete_by_org(&org).await.unwrap();
        credential_values::delete_by_org(&org).await.unwrap();
        synthetics_env_retired::delete_by_org(&org).await.unwrap();
    }

    #[tokio::test]
    async fn recreating_an_environment_stamps_its_new_life_after_the_watermark() {
        if !meta_store().await {
            return;
        }
        let db = crate::db::get_orm_client_rw().await;
        let org = unique("recreate_env");
        let mut record = env(&environment_id(&org, "staging"), "", 10);
        record.org_id = org.clone();
        record.created_at = 10;
        add(db, &mut record).await.unwrap();
        for (requested, expected) in [(9, 11), (11, 12), (25, 25)] {
            let old = record.incarnation();
            let mut stale = record.clone();
            assert!(delete(db, &org, &record.id).await.unwrap());
            stale.updated_at += 1;
            assert!(!apply_upsert(db, &stale).await.unwrap());
            assert!(get_by_id(db, &org, &record.id).await.unwrap().is_none());
            record.created_at = requested;
            add(db, &mut record).await.unwrap();
            assert_eq!(record.created_at, expected);
            assert_ne!(record.incarnation(), old);
            assert_eq!(
                get_by_id(db, &org, &record.id).await.unwrap().unwrap(),
                record
            );
            assert_eq!(stored_incarnation(db, &record).await, record.incarnation());
        }
        delete_by_org(db, &org).await.unwrap();
        synthetics_env_retired::delete_by_org(&org).await.unwrap();
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
