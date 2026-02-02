// Copyright 2025 OpenObserve Inc.
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

use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;

        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        let mut meta_pages = meta::Entity::find()
            .filter(meta::Column::Module.eq("kv"))
            .order_by_asc(meta::Column::Id)
            .paginate(&txn, 100);

        while let Some(metas) = meta_pages.fetch_and_next().await? {
            let new_kv_entries: Vec<_> = metas
                .into_iter()
                .map(|meta| {
                    // In meta table:
                    // - key1 is org_id (or 'o2_pkce_state' for PKCE)
                    // - key2 is the actual key
                    // - value is the stored value (UTF-8 text stored as String)
                    // - start_dt is the creation timestamp
                    //
                    // The new kv_store table stores values as binary Vec<u8>
                    // to support arbitrary binary data. Convert existing text to bytes.
                    kv_store::ActiveModel {
                        org_id: Set(meta.key1),
                        key: Set(meta.key2),
                        value: Set(meta.value.into_bytes()),
                        created_at: Set(meta.start_dt),
                        updated_at: Set(meta.start_dt), // Use same as created_at for migrated data
                    }
                })
                .collect();

            if !new_kv_entries.is_empty() {
                kv_store::Entity::insert_many(new_kv_entries)
                    .exec(&txn)
                    .await?;
            }
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        kv_store::Entity::delete_many().exec(db).await?;
        Ok(())
    }
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
        #[sea_orm(column_type = "Text")]
        pub value: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the kv_store table at the time this migration executes.
mod kv_store {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "kv_store")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub org_id: String,
        #[sea_orm(primary_key, auto_increment = false)]
        pub key: String,
        pub value: Vec<u8>,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
