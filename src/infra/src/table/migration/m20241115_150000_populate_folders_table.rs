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

//! Populates the folders table by transforming unstructured folder records from
//! the meta table.

use config::utils::json;
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;
use serde::{self, Deserialize};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let txn = db.begin().await?;

        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        // txn.execute()
        let mut meta_pages = meta::Entity::find()
            .filter(meta::Column::Module.eq("folders"))
            .order_by_asc(meta::Column::Id)
            .paginate(&txn, 100);

        while let Some(metas) = meta_pages.fetch_and_next().await? {
            let folders_rslt: Result<Vec<_>, DbErr> = metas
                .into_iter()
                .map(|m| {
                    // Transform unstructured JSON from the meta record.
                    let json: MetaFolder =
                        json::from_str(&m.value).map_err(|e| DbErr::Migration(e.to_string()))?;
                    let description = if json.description.is_empty() {
                        None
                    } else {
                        Some(json.description)
                    };
                    Ok(folder::ActiveModel {
                        org: Set(m.key1),
                        folder_id: Set(m.key2),
                        name: Set(json.name),
                        description: Set(description),
                        r#type: Set(0), // 0 indicates the dashboard folder type.
                        ..Default::default()
                    })
                })
                .collect();
            let folders = folders_rslt?;
            folder::Entity::insert_many(folders).exec(&txn).await?;
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        folder::Entity::delete_many().exec(db).await?;
        Ok(())
    }
}

/// Representation of a folder in the meta table.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaFolder {
    #[serde(default)]
    pub folder_id: String,
    pub name: String,
    pub description: String,
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// Representation of the meta table at the time this migration executes.
mod meta {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "meta")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub module: String,
        pub key1: String,
        pub key2: String,
        pub start_dt: i64,
        pub value: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the folder table at the time this migration executes.
mod folder {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "folders")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        pub description: Option<String>,
        pub r#type: i16,
        pub created_at: DateTime,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meta_folder_deserialize() {
        let json = r#"{"folderId":"f1","name":"My Folder","description":"A test folder"}"#;
        let folder: MetaFolder = serde_json::from_str(json).unwrap();
        assert_eq!(folder.folder_id, "f1");
        assert_eq!(folder.name, "My Folder");
        assert_eq!(folder.description, "A test folder");
    }

    #[test]
    fn test_meta_folder_default_folder_id() {
        let json = r#"{"name":"No ID Folder","description":""}"#;
        let folder: MetaFolder = serde_json::from_str(json).unwrap();
        assert!(folder.folder_id.is_empty());
        assert_eq!(folder.name, "No ID Folder");
    }

    #[test]
    fn test_meta_folder_equality() {
        let json = r#"{"folderId":"x","name":"Test","description":"desc"}"#;
        let f1: MetaFolder = serde_json::from_str(json).unwrap();
        let f2 = f1.clone();
        assert_eq!(f1, f2);
    }

    #[test]
    fn test_meta_folder_empty_description_stays_empty() {
        let json = r#"{"name":"My Folder","description":""}"#;
        let folder: MetaFolder = serde_json::from_str(json).unwrap();
        assert!(folder.description.is_empty());
    }
}
