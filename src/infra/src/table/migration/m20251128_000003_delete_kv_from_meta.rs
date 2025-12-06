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

//! Deletes all KV records from the meta table.
//!
//! This migration cleans up all KV-related data from the meta table after migrating
//! to the dedicated kv_store table. This includes:
//! - Legacy KV data (user data, PKCE states, etc.)
//! - Event notification markers (written by the coordinator for watch synchronization)
//!
//! After this migration, the coordinator/meta table will continue to store minimal
//! event markers ("__kv_marker__") for cluster synchronization, but actual KV data
//! resides only in the kv_store table.

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        // Delete all KV entries from the meta table
        // All KV data (including PKCE states and user KV) are stored with module='kv'
        meta::Entity::delete_many()
            .filter(meta::Column::Module.eq("kv"))
            .exec(&txn)
            .await?;
        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        // The deletion of KV data from the meta table is not reversible.
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
