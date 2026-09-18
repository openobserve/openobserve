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
//!
//! The body is shared with the sibling migration that does this for the other
//! workflow table — see [`super::workflow_folder_id`].

#[cfg(test)]
use config::meta::folder::DEFAULT_FOLDER;
#[cfg(test)]
use sea_orm::{ConnectionTrait, EntityTrait, QuerySelect};
use sea_orm_migration::prelude::*;

use super::workflow_folder_id::{self, Spec};
#[cfg(test)]
use super::workflow_folder_id::{WORKFLOWS_FOLDER_TYPE, folder_ksuid_from_hash, folders};

const SPEC: Spec = Spec {
    table: "workflow_drafts",
    fk: "workflow_drafts_folder_fk",
    not_null_check: "workflow_drafts_folder_id_not_null",
    idx: "workflow_drafts_org_folder_idx",
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        workflow_folder_id::up(manager, &SPEC).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        workflow_folder_id::down(manager, &SPEC).await
    }
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// Representation of the workflow_drafts table at the time this migration executes,
/// with `folder_id` still nullable.
#[cfg(test)]
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
