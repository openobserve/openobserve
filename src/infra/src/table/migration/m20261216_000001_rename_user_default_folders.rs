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

//! Renames user folders named `default`, whose name blocks creating the built-in default folder.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect,
};
use sea_orm_migration::prelude::*;

const DEFAULT_FOLDER: &str = "default";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        rename_clashes(manager.get_connection()).await
    }

    /// The old name blocked the built-in folder, so the rename is not undone.
    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

/// Renames every non-built-in folder named `default` to a free `default_<n>`. [weak: some rows
/// may be renamed; a rerun renames only the rest]
async fn rename_clashes<C: ConnectionTrait>(db: &C) -> Result<(), DbErr> {
    let clashes: Vec<(String, String, i16)> = folders::Entity::find()
        .select_only()
        .columns([
            folders::Column::Id,
            folders::Column::Org,
            folders::Column::Type,
        ])
        .filter(folders::Column::Name.eq(DEFAULT_FOLDER))
        .filter(folders::Column::FolderId.ne(DEFAULT_FOLDER))
        .into_tuple()
        .all(db)
        .await?;
    for (id, org, r#type) in clashes {
        let to = free_name(db, &org, r#type).await?;
        log::info!("[FOLDERS] renamed folder {id} in org {org} from '{DEFAULT_FOLDER}' to '{to}'");
        folders::Entity::update_many()
            .col_expr(folders::Column::Name, Expr::value(to))
            .filter(folders::Column::Id.eq(id))
            .exec(db)
            .await?;
    }
    Ok(())
}

/// The first `default_<n>` not yet used in the org's folders of this type.
async fn free_name<C: ConnectionTrait>(db: &C, org: &str, r#type: i16) -> Result<String, DbErr> {
    let mut n = 1;
    loop {
        let candidate = format!("{DEFAULT_FOLDER}_{n}");
        let taken = folders::Entity::find()
            .filter(folders::Column::Org.eq(org))
            .filter(folders::Column::Type.eq(r#type))
            .filter(folders::Column::Name.eq(candidate.as_str()))
            .count(db)
            .await?;
        if taken == 0 {
            return Ok(candidate);
        }
        n += 1;
    }
}

// Frozen view of the folders table, so later schema changes do not alter this migration.
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
        pub r#type: i16,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use config::meta::folder::{Folder, FolderType};
    use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, Schema, Set};

    use super::*;
    use crate::table::{entity::folders as entity, folders::get_or_create_with};

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(entity::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db.execute_unprepared(
            r#"CREATE UNIQUE INDEX "folders_org_type_name_idx" ON "folders" ("org", "type", "name")"#,
        )
        .await
        .unwrap();
        db
    }

    async fn seed(
        db: &DatabaseConnection,
        id: &str,
        org: &str,
        folder_id: &str,
        name: &str,
        ty: i16,
    ) {
        entity::ActiveModel {
            id: Set(id.to_string()),
            org: Set(org.to_string()),
            folder_id: Set(folder_id.to_string()),
            name: Set(name.to_string()),
            description: Set(None),
            icon: Set(None),
            r#type: Set(ty),
        }
        .insert(db)
        .await
        .unwrap();
    }

    async fn name_of(db: &DatabaseConnection, id: &str) -> String {
        entity::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .name
    }

    fn built_in() -> Folder {
        Folder {
            folder_id: DEFAULT_FOLDER.to_string(),
            name: DEFAULT_FOLDER.to_string(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn a_user_folder_named_default_moves_aside_for_the_built_in_one() {
        let db = db().await;
        seed(&db, "1", "o1", "user1", "default", 1).await;
        seed(&db, "2", "o1", "user2", "default_1", 1).await;
        seed(&db, "3", "o1", "user3", "default", 0).await;
        seed(&db, "4", "o2", DEFAULT_FOLDER, "default", 1).await;
        assert!(
            get_or_create_with(&db, "o1", built_in(), FolderType::Alerts)
                .await
                .is_err()
        );

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        assert_eq!(name_of(&db, "1").await, "default_2");
        assert_eq!(name_of(&db, "2").await, "default_1");
        assert_eq!(name_of(&db, "3").await, "default_1");
        assert_eq!(name_of(&db, "4").await, "default");
        let (_, folder, created) = get_or_create_with(&db, "o1", built_in(), FolderType::Alerts)
            .await
            .unwrap();
        assert!(created);
        assert_eq!(folder.folder_id, DEFAULT_FOLDER);
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        assert_eq!(name_of(&db, "4").await, "default");
    }
}
