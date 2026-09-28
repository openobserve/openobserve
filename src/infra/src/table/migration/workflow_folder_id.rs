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

//! Shared body of the two migrations that give a workflow table its
//! `folder_id`: `m20260910_000001_add_folder_id_to_workflows` and
//! `m20260916_000001_add_folder_id_to_workflow_drafts`.
//!
//! Those two are the ONLY callers, and both shipped together. Like the
//! migrations themselves this is a snapshot: once either has run anywhere,
//! changing what these functions do rewrites history for it. Add a new
//! migration instead.

use config::meta::folder::DEFAULT_FOLDER;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Statement, Value,
};
use sea_orm_migration::prelude::*;
use svix_ksuid::{Ksuid, KsuidLike};

pub(super) const WORKFLOWS_FOLDER_TYPE: i16 = 4;

/// Identifies the table being migrated and the constraints named after it.
pub(super) struct Spec {
    pub table: &'static str,
    pub fk: &'static str,
    pub not_null_check: &'static str,
    pub idx: &'static str,
}

impl Spec {
    fn iden(&self) -> Alias {
        Alias::new(self.table)
    }
}

pub(super) async fn up(manager: &SchemaManager<'_>, spec: &Spec) -> Result<(), DbErr> {
    let backend = manager.get_database_backend();
    let table = spec.table;

    // Added nullable and tightened below: NOT NULL up front fails on a
    // populated table, and these may already hold rows.
    if !manager.has_column(table, "folder_id").await? {
        manager
            .alter_table(
                Table::alter()
                    .table(spec.iden())
                    .add_column(ColumnDef::new(Alias::new("folder_id")).char_len(27).null())
                    .to_owned(),
            )
            .await?;
    }

    backfill_default_folders(manager, spec).await?;

    // SQLite cannot add a foreign key to an existing table and is dev-only
    // here, so it keeps a nullable, unconstrained column.
    if backend == sea_orm::DbBackend::Postgres {
        set_folder_id_not_null(manager, spec).await?;

        if !fk_exists(manager, spec).await? {
            let conn = manager.get_connection();
            let fk = spec.fk;
            // NOT VALID first: a validated FK holds ACCESS EXCLUSIVE for the
            // whole scan, which on a large table can outlast the dist_lock.
            conn.execute_unprepared(&format!(
                "ALTER TABLE {table} ADD CONSTRAINT {fk} \
                 FOREIGN KEY (folder_id) REFERENCES folders(id) NOT VALID"
            ))
            .await?;
            conn.execute_unprepared(&format!("ALTER TABLE {table} VALIDATE CONSTRAINT {fk}"))
                .await?;
        }
    }

    manager
        .create_index(
            Index::create()
                .if_not_exists()
                .name(spec.idx)
                .table(spec.iden())
                .col(Alias::new("org_id"))
                .col(Alias::new("folder_id"))
                .to_owned(),
        )
        .await?;

    Ok(())
}

pub(super) async fn down(manager: &SchemaManager<'_>, spec: &Spec) -> Result<(), DbErr> {
    manager
        .drop_index(
            Index::drop()
                .if_exists()
                .name(spec.idx)
                .table(spec.iden())
                .to_owned(),
        )
        .await?;

    if manager.get_database_backend() == sea_orm::DbBackend::Postgres {
        let (table, fk) = (spec.table, spec.fk);
        manager
            .get_connection()
            .execute_unprepared(&format!(
                "ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {fk}"
            ))
            .await?;
    }

    manager
        .alter_table(
            Table::alter()
                .table(spec.iden())
                .drop_column(Alias::new("folder_id"))
                .to_owned(),
        )
        .await?;

    // The folders this migration created are left in place: they may have
    // been used by hand since.
    Ok(())
}

/// Creates a default Workflows folder per org that owns rows in `spec.table`,
/// then points every row with no folder at its org's folder.
async fn backfill_default_folders(manager: &SchemaManager<'_>, spec: &Spec) -> Result<(), DbErr> {
    let conn = manager.get_connection();
    let backend = manager.get_database_backend();
    let table = spec.table;

    // Raw SQL rather than an ORM entity because the two tables differ only by
    // name here; `table` is a compile-time constant, never user input.
    let orgs: Vec<String> = conn
        .query_all(Statement::from_string(
            backend,
            format!("SELECT DISTINCT org_id FROM {table} WHERE {UNFOLDERED}"),
        ))
        .await?
        .into_iter()
        .map(|row| row.try_get::<String>("", "org_id"))
        .collect::<Result<_, _>>()?;

    for org in orgs {
        let existing = folders::Entity::find()
            .filter(folders::Column::Org.eq(&org))
            .filter(folders::Column::FolderId.eq(DEFAULT_FOLDER))
            .filter(folders::Column::Type.eq(WORKFLOWS_FOLDER_TYPE))
            .one(conn)
            .await?;

        let folder_pk = match existing {
            Some(folder) => folder.id,
            None => {
                let pk =
                    folder_ksuid_from_hash(&org, WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string();
                folders::Entity::insert(folders::ActiveModel {
                    id: Set(pk.clone()),
                    org: Set(org.clone()),
                    folder_id: Set(DEFAULT_FOLDER.to_string()),
                    name: Set(DEFAULT_FOLDER.to_string()),
                    description: Set(Some(DEFAULT_FOLDER.to_string())),
                    r#type: Set(WORKFLOWS_FOLDER_TYPE),
                })
                .exec(conn)
                .await?;
                pk
            }
        };

        conn.execute(Statement::from_sql_and_values(
            backend,
            format!("UPDATE {table} SET folder_id = $1 WHERE org_id = $2 AND ({UNFOLDERED})"),
            [Value::from(folder_pk), Value::from(org)],
        ))
        .await?;
    }

    Ok(())
}

/// Matches rows the column was just added to, plus any left blank by a re-run.
const UNFOLDERED: &str = "folder_id IS NULL OR folder_id = ''";

/// Postgres only. A bare `SET NOT NULL` scans the heap under ACCESS EXCLUSIVE,
/// which on a large table can outlast the dist_lock; validating a CHECK takes only
/// SHARE UPDATE EXCLUSIVE and lets PG12+ skip that scan. The CHECK is then redundant.
async fn set_folder_id_not_null(manager: &SchemaManager<'_>, spec: &Spec) -> Result<(), DbErr> {
    let conn = manager.get_connection();
    let (table, check) = (spec.table, spec.not_null_check);
    // ADD CONSTRAINT has no IF NOT EXISTS, so a re-run drops the leftover first.
    for stmt in [
        format!("ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {check}"),
        format!(
            "ALTER TABLE {table} ADD CONSTRAINT {check} \
             CHECK (folder_id IS NOT NULL) NOT VALID"
        ),
        format!("ALTER TABLE {table} VALIDATE CONSTRAINT {check}"),
        format!("ALTER TABLE {table} ALTER COLUMN folder_id SET NOT NULL"),
        format!("ALTER TABLE {table} DROP CONSTRAINT {check}"),
    ] {
        conn.execute_unprepared(&stmt).await?;
    }
    Ok(())
}

async fn fk_exists(manager: &SchemaManager<'_>, spec: &Spec) -> Result<bool, DbErr> {
    let (table, fk) = (spec.table, spec.fk);
    let row = manager
        .get_connection()
        .query_one(Statement::from_string(
            sea_orm::DbBackend::Postgres,
            format!(
                "SELECT COUNT(*) AS cnt FROM information_schema.table_constraints \
                 WHERE constraint_name = '{fk}' \
                 AND table_name = '{table}' \
                 AND table_schema = current_schema()"
            ),
        ))
        .await?;
    Ok(row
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0) > 0)
        .unwrap_or(false))
}

/// Derives a folder's primary key from its identity so that every node in a
/// cluster computes the same value and a re-run is a no-op.
pub(super) fn folder_ksuid_from_hash(org: &str, folder_type: i16, folder_id: &str) -> Ksuid {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(org);
    hasher.update(folder_type.to_string());
    hasher.update(folder_id);
    let hash = hasher.finalize();
    Ksuid::from_bytes(hash.into())
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// Representation of the folders table at the time these migrations execute.
pub(super) mod folders {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "folders")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        pub description: Option<String>,
        pub r#type: i16,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
