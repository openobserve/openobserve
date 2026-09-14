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

use config::meta::folder::DEFAULT_FOLDER;
use sea_orm::{
    ActiveValue::Set, ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter,
    QuerySelect, Statement,
};
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

        // Added nullable and tightened below: NOT NULL up front fails on a
        // populated table, and this one already holds rows.
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

        // SQLite cannot add a foreign key to an existing table and is dev-only
        // here, so it keeps a nullable, unconstrained column.
        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE workflows ALTER COLUMN folder_id SET NOT NULL")
                .await?;
        }

        if backend == sea_orm::DbBackend::Postgres && !fk_exists(manager).await? {
            let conn = manager.get_connection();
            // NOT VALID first: a validated FK holds ACCESS EXCLUSIVE for the
            // whole scan, which on a large table can outlast the dist_lock.
            conn.execute_unprepared(&format!(
                "ALTER TABLE workflows ADD CONSTRAINT {FK_NAME} \
                 FOREIGN KEY (folder_id) REFERENCES folders(id) NOT VALID"
            ))
            .await?;
            conn.execute_unprepared(&format!(
                "ALTER TABLE workflows VALIDATE CONSTRAINT {FK_NAME}"
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

        // The folders this migration created are left in place: they may have
        // been used by hand since.
        Ok(())
    }
}

/// Creates a default Workflows folder per org that owns workflows, then points
/// every workflow with no folder at its org's folder.
async fn backfill_default_folders(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let conn = manager.get_connection();

    let orgs: Vec<String> = workflows::Entity::find()
        .select_only()
        .column(workflows::Column::OrgId)
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

        workflows::Entity::update_many()
            .col_expr(
                workflows::Column::FolderId,
                Expr::value(folder_pk.to_owned()),
            )
            .filter(workflows::Column::OrgId.eq(&org))
            .filter(unfoldered())
            .exec(conn)
            .await?;
    }

    Ok(())
}

/// Matches rows the column was just added to, plus any left blank by a re-run.
fn unfoldered() -> Condition {
    Condition::any()
        .add(workflows::Column::FolderId.is_null())
        .add(workflows::Column::FolderId.eq(""))
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

/// Representation of the workflows table at the time this migration executes,
/// with `folder_id` still nullable.
mod workflows {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "workflows")]
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

    /// Creates the two tables as they stood before this migration: `workflows`
    /// without `folder_id`.
    async fn setup(db: &sea_orm::DatabaseConnection) {
        for stmt in [
            "CREATE TABLE folders (id char(27) NOT NULL PRIMARY KEY, org varchar(100) NOT NULL, \
             folder_id varchar(256) NOT NULL, name varchar(256) NOT NULL, description text, \
             icon varchar(64), type smallint NOT NULL)",
            "CREATE TABLE workflows (id char(27) NOT NULL PRIMARY KEY, org_id varchar(100) NOT NULL, \
             created_at bigint NOT NULL, updated_at bigint NOT NULL, created_by varchar(256) NOT NULL, \
             enabled boolean NOT NULL, name varchar(256) NOT NULL, description text NOT NULL, \
             nodes text NOT NULL, edges text NOT NULL)",
        ] {
            db.execute_unprepared(stmt).await.unwrap();
        }
    }

    async fn insert_workflow(db: &sea_orm::DatabaseConnection, id: &str, org: &str) {
        db.execute_unprepared(&format!(
            "INSERT INTO workflows (id, org_id, created_at, updated_at, created_by, enabled, \
             name, description, nodes, edges) \
             VALUES ('{id}', '{org}', 0, 0, 'tester', true, '{id}', '', '[]', '[]')"
        ))
        .await
        .unwrap();
    }

    async fn folder_ids(db: &sea_orm::DatabaseConnection) -> Vec<(String, String)> {
        workflows::Entity::find()
            .select_only()
            .column(workflows::Column::Id)
            .column(workflows::Column::FolderId)
            .order_by_asc(workflows::Column::Id)
            .into_tuple::<(String, String)>()
            .all(db)
            .await
            .unwrap()
    }

    // The backfill previously wrote a `folders.created_at` column dropped long
    // ago, so up() aborted on any org that already owned a workflow.
    #[tokio::test]
    async fn test_up_backfills_a_populated_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_workflow(&db, "wf1", "orgA").await;
        insert_workflow(&db, "wf2", "orgA").await;
        insert_workflow(&db, "wf3", "orgB").await;

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let rows = folder_ids(&db).await;
        let a = folder_ksuid_from_hash("orgA", WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string();
        let b = folder_ksuid_from_hash("orgB", WORKFLOWS_FOLDER_TYPE, DEFAULT_FOLDER).to_string();
        assert_eq!(
            rows,
            vec![
                ("wf1".to_string(), a.clone()),
                ("wf2".to_string(), a),
                ("wf3".to_string(), b),
            ]
        );
        assert_eq!(
            folders::Entity::find().all(&db).await.unwrap().len(),
            2,
            "one default folder per org that owns workflows"
        );
    }

    // A folder may already exist with a generated (non hash-derived) id.
    #[tokio::test]
    async fn test_up_reuses_an_existing_default_folder() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_workflow(&db, "wf1", "orgA").await;
        db.execute_unprepared(&format!(
            "INSERT INTO folders (id, org, folder_id, name, description, type) \
             VALUES ('preexisting0000000000000000', 'orgA', 'default', 'default', 'default', {WORKFLOWS_FOLDER_TYPE})"
        ))
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        assert_eq!(
            folder_ids(&db).await,
            vec![("wf1".to_string(), "preexisting0000000000000000".to_string())]
        );
        assert_eq!(folders::Entity::find().all(&db).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        setup(&db).await;
        insert_workflow(&db, "wf1", "orgA").await;
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
        insert_workflow(&db, "wf1", "orgA").await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column("workflows", "folder_id").await.unwrap());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column("workflows", "folder_id").await.unwrap());
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column("workflows", "folder_id").await.unwrap());
    }

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
