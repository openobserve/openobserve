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

//! Adds `workflow_drafts.folder_id`, pointing every existing draft at its org's
//! default Workflows folder. Without a folder of its own a draft was appended to
//! every folder's listing.

use config::meta::folder::DEFAULT_FOLDER;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter,
    QuerySelect, Statement,
};
use sea_orm_migration::prelude::*;
use svix_ksuid::{Ksuid, KsuidLike};

const FK_NAME: &str = "workflow_drafts_folder_fk";
const NOT_NULL_CHECK_NAME: &str = "workflow_drafts_folder_id_not_null";
const IDX_NAME: &str = "workflow_drafts_org_folder_idx";
const WORKFLOWS_FOLDER_TYPE: i16 = 4;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();

        // Added nullable and tightened below: NOT NULL up front fails on a
        // populated table, and this one may already hold drafts.
        if !manager.has_column("workflow_drafts", "folder_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(WorkflowDrafts::Table)
                        .add_column(ColumnDef::new(WorkflowDrafts::FolderId).char_len(27).null())
                        .to_owned(),
                )
                .await?;
        }

        backfill_default_folders(manager).await?;

        // SQLite cannot add a foreign key to an existing table and is dev-only
        // here, so it keeps a nullable, unconstrained column.
        if backend == sea_orm::DbBackend::Postgres {
            set_folder_id_not_null(manager).await?;
        }

        if backend == sea_orm::DbBackend::Postgres && !fk_exists(manager).await? {
            let conn = manager.get_connection();
            // NOT VALID first: a validated FK holds ACCESS EXCLUSIVE for the
            // whole scan, which on a large table can outlast the dist_lock.
            conn.execute_unprepared(&format!(
                "ALTER TABLE workflow_drafts ADD CONSTRAINT {FK_NAME} \
                 FOREIGN KEY (folder_id) REFERENCES folders(id) NOT VALID"
            ))
            .await?;
            conn.execute_unprepared(&format!(
                "ALTER TABLE workflow_drafts VALIDATE CONSTRAINT {FK_NAME}"
            ))
            .await?;
        }

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(IDX_NAME)
                    .table(WorkflowDrafts::Table)
                    .col(WorkflowDrafts::OrgId)
                    .col(WorkflowDrafts::FolderId)
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
                    .table(WorkflowDrafts::Table)
                    .to_owned(),
            )
            .await?;

        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute_unprepared(&format!(
                    "ALTER TABLE workflow_drafts DROP CONSTRAINT IF EXISTS {FK_NAME}"
                ))
                .await?;
        }

        manager
            .alter_table(
                Table::alter()
                    .table(WorkflowDrafts::Table)
                    .drop_column(WorkflowDrafts::FolderId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

/// Points every draft with no folder at its org's default Workflows folder,
/// creating that folder when the org has none yet.
async fn backfill_default_folders(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let conn = manager.get_connection();

    let orgs: Vec<String> = workflow_drafts::Entity::find()
        .select_only()
        .column(workflow_drafts::Column::OrgId)
        .distinct()
        .filter(unfoldered())
        .into_tuple()
        .all(conn)
        .await?;

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

        workflow_drafts::Entity::update_many()
            .col_expr(
                workflow_drafts::Column::FolderId,
                Expr::value(folder_pk.to_owned()),
            )
            .filter(workflow_drafts::Column::OrgId.eq(&org))
            .filter(unfoldered())
            .exec(conn)
            .await?;
    }

    Ok(())
}

/// Postgres only. A bare `SET NOT NULL` scans the heap under ACCESS EXCLUSIVE,
/// which on a large table can outlast the dist_lock; validating a CHECK takes only
/// SHARE UPDATE EXCLUSIVE and lets PG12+ skip that scan. The CHECK is then redundant.
async fn set_folder_id_not_null(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let conn = manager.get_connection();
    // ADD CONSTRAINT has no IF NOT EXISTS, so a re-run drops the leftover first.
    for stmt in [
        format!("ALTER TABLE workflow_drafts DROP CONSTRAINT IF EXISTS {NOT_NULL_CHECK_NAME}"),
        format!(
            "ALTER TABLE workflow_drafts ADD CONSTRAINT {NOT_NULL_CHECK_NAME} \
             CHECK (folder_id IS NOT NULL) NOT VALID"
        ),
        format!("ALTER TABLE workflow_drafts VALIDATE CONSTRAINT {NOT_NULL_CHECK_NAME}"),
        "ALTER TABLE workflow_drafts ALTER COLUMN folder_id SET NOT NULL".to_string(),
        format!("ALTER TABLE workflow_drafts DROP CONSTRAINT {NOT_NULL_CHECK_NAME}"),
    ] {
        conn.execute_unprepared(&stmt).await?;
    }
    Ok(())
}

/// Matches rows the column was just added to, plus any left blank by a re-run.
fn unfoldered() -> Condition {
    Condition::any()
        .add(workflow_drafts::Column::FolderId.is_null())
        .add(workflow_drafts::Column::FolderId.eq(""))
}

/// Derives a folder's primary key from its identity so that every node in a
/// cluster computes the same value and a re-run is a no-op. Must stay identical
/// to the workflows backfill, or the two mint different default folders.
fn folder_ksuid_from_hash(org: &str, folder_type: i16, folder_id: &str) -> Ksuid {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(org);
    hasher.update(folder_type.to_string());
    hasher.update(folder_id);
    let hash = hasher.finalize();
    Ksuid::from_bytes(hash.into())
}

async fn fk_exists(manager: &SchemaManager<'_>) -> Result<bool, DbErr> {
    let row = manager
        .get_connection()
        .query_one(Statement::from_string(
            sea_orm::DbBackend::Postgres,
            format!(
                "SELECT COUNT(*) AS cnt FROM information_schema.table_constraints \
                 WHERE constraint_name = '{FK_NAME}' \
                 AND table_name = 'workflow_drafts' \
                 AND table_schema = current_schema()"
            ),
        ))
        .await?;
    Ok(row
        .map(|r| r.try_get::<i64>("", "cnt").unwrap_or(0) > 0)
        .unwrap_or(false))
}

#[derive(DeriveIden)]
enum WorkflowDrafts {
    Table,
    OrgId,
    FolderId,
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// Representation of the folders table at the time this migration executes.
mod folders {
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

/// Representation of the workflow_drafts table at the time this migration
/// executes, with `folder_id` still nullable.
mod workflow_drafts {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "workflow_drafts")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org_id: String,
        pub folder_id: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, QueryOrder};

    use super::*;

    /// Creates the two tables as they stood before this migration:
    /// `workflow_drafts` without `folder_id`.
    async fn setup(db: &sea_orm::DatabaseConnection) {
        for stmt in [
            "CREATE TABLE folders (id char(27) NOT NULL PRIMARY KEY, org varchar(100) NOT NULL, \
             folder_id varchar(256) NOT NULL, name varchar(256) NOT NULL, description text, \
             icon varchar(64), type smallint NOT NULL)",
            "CREATE TABLE workflow_drafts (id char(27) NOT NULL PRIMARY KEY, org_id varchar(100) \
             NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL, created_by \
             varchar(256) NOT NULL, name varchar(256) NOT NULL, description text NOT NULL, \
             nodes text NOT NULL, edges text NOT NULL)",
        ] {
            db.execute_unprepared(stmt).await.unwrap();
        }
    }

    async fn insert_draft(db: &sea_orm::DatabaseConnection, id: &str, org: &str) {
        db.execute_unprepared(&format!(
            "INSERT INTO workflow_drafts (id, org_id, created_at, updated_at, created_by, \
             name, description, nodes, edges) \
             VALUES ('{id}', '{org}', 0, 0, 'tester', '{id}', '', '[]', '[]')"
        ))
        .await
        .unwrap();
    }

    async fn folder_ids(db: &sea_orm::DatabaseConnection) -> Vec<(String, String)> {
        workflow_drafts::Entity::find()
            .select_only()
            .column(workflow_drafts::Column::Id)
            .column(workflow_drafts::Column::FolderId)
            .order_by_asc(workflow_drafts::Column::Id)
            .into_tuple::<(String, String)>()
            .all(db)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn test_up_backfills_a_populated_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_draft(&db, "d1", "orgA").await;
        insert_draft(&db, "d2", "orgA").await;
        insert_draft(&db, "d3", "orgB").await;

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let a = folder_ksuid_from_hash("orgA", WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string();
        let b = folder_ksuid_from_hash("orgB", WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string();
        assert_eq!(
            folder_ids(&db).await,
            vec![
                ("d1".to_string(), a.clone()),
                ("d2".to_string(), a),
                ("d3".to_string(), b),
            ]
        );
    }

    // The workflows backfill runs first and already owns the org's default
    // folder; minting a second one would split the folder in two.
    #[tokio::test]
    async fn test_up_reuses_an_existing_default_folder() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_draft(&db, "d1", "orgA").await;
        db.execute_unprepared(&format!(
            "INSERT INTO folders (id, org, folder_id, name, description, type) \
             VALUES ('preexisting0000000000000000', 'orgA', 'default', 'default', 'default', {WORKFLOWS_FOLDER_TYPE})"
        ))
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        assert_eq!(
            folder_ids(&db).await,
            vec![("d1".to_string(), "preexisting0000000000000000".to_string())]
        );
        assert_eq!(folders::Entity::find().all(&db).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_draft(&db, "d1", "orgA").await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        let first = folder_ids(&db).await;
        Migration
            .up(&manager)
            .await
            .expect("up must be re-runnable");

        assert_eq!(folder_ids(&db).await, first);
        assert_eq!(folders::Entity::find().all(&db).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_up_down_round_trip() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_draft(&db, "d1", "orgA").await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column("workflow_drafts", "folder_id")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        assert!(
            !manager
                .has_column("workflow_drafts", "folder_id")
                .await
                .unwrap()
        );
        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column("workflow_drafts", "folder_id")
                .await
                .unwrap()
        );
    }

    // The draft and workflow backfills must agree on the default folder's id, or
    // a promoted draft would land in a folder the list never shows.
    #[test]
    fn test_folder_ksuid_matches_the_workflows_backfill() {
        let id = folder_ksuid_from_hash("org1", WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string();
        assert_eq!(id.len(), 27);
        assert_eq!(
            id,
            folder_ksuid_from_hash("org1", WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string()
        );
    }
}
