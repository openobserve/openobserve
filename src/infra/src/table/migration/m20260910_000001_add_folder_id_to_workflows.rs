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

//! Adds `workflows.folder_id`, pointing every existing workflow at its org's
//! default Workflows folder.
//!
//! Unlike the other folder-scoped tables, `workflows` already exists and holds
//! rows, so the column is added in place: nullable first, backfilled, and only
//! then constrained. Adding it NOT NULL up front fails on a populated table.
//!
//! Default folder IDs are derived from a hash of (org, folder type, "default")
//! rather than generated, so every node computes the same id and a re-run is
//! idempotent.
//!
//! - SQLite cannot add a FOREIGN KEY to an existing table via ALTER TABLE. It is a dev-only backend
//!   here, so the constraint is Postgres-only; the column, the backfill and the index still apply
//!   to both.
//! - Postgres rejects ADD CONSTRAINT if any row references a missing folder, so the backfill must
//!   leave no unmatched value behind.

use sea_orm::{ConnectionTrait, Statement};
use sea_orm_migration::prelude::*;
use svix_ksuid::{Ksuid, KsuidLike};

const FK_NAME: &str = "workflows_folder_fk";
const IDX_NAME: &str = "workflows_org_folder_idx";
const WORKFLOWS_FOLDER_TYPE: i16 = 4;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();

        if !column_exists(manager).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Workflows::Table)
                        .add_column(ColumnDef::new(Workflows::FolderId).char_len(27).null())
                        .to_owned(),
                )
                .await?;
        }

        backfill_default_folders(manager).await?;

        // Every row is populated now, so the column can be tightened. SQLite
        // rewrites the table for this, which it only tolerates because the
        // column already has no NULLs.
        manager
            .get_connection()
            .execute_unprepared(match backend {
                sea_orm::DbBackend::Postgres => {
                    "ALTER TABLE workflows ALTER COLUMN folder_id SET NOT NULL"
                }
                _ => "SELECT 1",
            })
            .await?;

        if backend == sea_orm::DbBackend::Postgres && !fk_exists(manager).await? {
            manager
                .get_connection()
                .execute_unprepared(&format!(
                    "ALTER TABLE workflows ADD CONSTRAINT {FK_NAME} \
                     FOREIGN KEY (folder_id) REFERENCES folders(id)"
                ))
                .await?;
        }

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(IDX_NAME)
                    .table(Workflows::Table)
                    .col(Workflows::OrgId)
                    .col(Workflows::FolderId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();

        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(IDX_NAME)
                    .table(Workflows::Table)
                    .to_owned(),
            )
            .await?;

        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute_unprepared(&format!(
                    "ALTER TABLE workflows DROP CONSTRAINT IF EXISTS {FK_NAME}"
                ))
                .await?;
        }

        manager
            .alter_table(
                Table::alter()
                    .table(Workflows::Table)
                    .drop_column(Workflows::FolderId)
                    .to_owned(),
            )
            .await?;

        // The folders this migration created are only meaningful while the
        // column exists, but they may since have been used by hand, so they are
        // left in place rather than deleted.
        Ok(())
    }
}

/// Creates a default Workflows folder per org that owns workflows, then points
/// every workflow with no folder at its org's folder.
async fn backfill_default_folders(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let conn = manager.get_connection();
    let backend = manager.get_database_backend();

    let orgs = conn
        .query_all(Statement::from_string(
            backend,
            "SELECT DISTINCT org_id FROM workflows WHERE folder_id IS NULL OR folder_id = ''",
        ))
        .await?;

    for row in orgs {
        let org: String = row.try_get("", "org_id")?;
        let pk = folder_ksuid_from_hash(&org, WORKFLOWS_FOLDER_TYPE, "default").to_string();
        let now = chrono::Utc::now().timestamp_micros();

        conn.execute(Statement::from_sql_and_values(
            backend,
            "INSERT INTO folders (id, org, folder_id, name, description, type, created_at) \
             SELECT $1, $2, 'default', 'default', 'default', $3, $4 \
             WHERE NOT EXISTS (SELECT 1 FROM folders WHERE org = $5 AND folder_id = 'default' AND type = $6)",
            [
                pk.clone().into(),
                org.clone().into(),
                WORKFLOWS_FOLDER_TYPE.into(),
                now.into(),
                org.clone().into(),
                WORKFLOWS_FOLDER_TYPE.into(),
            ],
        ))
        .await?;

        // Re-read rather than reusing `pk`: the folder may already have existed
        // with a different id, in which case the insert above was a no-op.
        let existing = conn
            .query_one(Statement::from_sql_and_values(
                backend,
                "SELECT id FROM folders WHERE org = $1 AND folder_id = 'default' AND type = $2",
                [org.clone().into(), WORKFLOWS_FOLDER_TYPE.into()],
            ))
            .await?
            .ok_or_else(|| {
                DbErr::Migration(format!("default Workflows folder missing for org {org}"))
            })?;
        let folder_pk: String = existing.try_get("", "id")?;

        conn.execute(Statement::from_sql_and_values(
            backend,
            "UPDATE workflows SET folder_id = $1 \
             WHERE org_id = $2 AND (folder_id IS NULL OR folder_id = '')",
            [folder_pk.into(), org.into()],
        ))
        .await?;
    }

    Ok(())
}

/// Derives a folder's primary key from its identity so that every node in a
/// cluster computes the same value and a re-run is a no-op.
fn folder_ksuid_from_hash(org: &str, folder_type: i16, folder_id: &str) -> Ksuid {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(org);
    hasher.update(folder_type.to_string());
    hasher.update(folder_id);
    let hash = hasher.finalize();
    Ksuid::from_bytes(hash.into())
}

async fn column_exists(manager: &SchemaManager<'_>) -> Result<bool, DbErr> {
    manager.has_column("workflows", "folder_id").await
}

async fn fk_exists(manager: &SchemaManager<'_>) -> Result<bool, DbErr> {
    let row = manager
        .get_connection()
        .query_one(Statement::from_string(
            sea_orm::DbBackend::Postgres,
            format!(
                "SELECT COUNT(*) AS cnt FROM information_schema.table_constraints \
                 WHERE constraint_name = '{FK_NAME}' \
                 AND table_name = 'workflows' \
                 AND table_schema = current_schema()"
            ),
        ))
        .await?;
    Ok(row
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0) > 0)
        .unwrap_or(false))
}

#[derive(DeriveIden)]
enum Workflows {
    Table,
    OrgId,
    FolderId,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_ksuid_is_deterministic() {
        let a = folder_ksuid_from_hash("org1", WORKFLOWS_FOLDER_TYPE, "default");
        let b = folder_ksuid_from_hash("org1", WORKFLOWS_FOLDER_TYPE, "default");
        assert_eq!(a, b);
    }

    #[test]
    fn test_folder_ksuid_varies_by_org_and_type() {
        let a = folder_ksuid_from_hash("org1", WORKFLOWS_FOLDER_TYPE, "default");
        let b = folder_ksuid_from_hash("org2", WORKFLOWS_FOLDER_TYPE, "default");
        let c = folder_ksuid_from_hash("org1", 1, "default");
        assert_ne!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn test_folder_ksuid_is_27_chars() {
        let id = folder_ksuid_from_hash("org1", WORKFLOWS_FOLDER_TYPE, "default").to_string();
        assert_eq!(id.len(), 27);
    }
}
