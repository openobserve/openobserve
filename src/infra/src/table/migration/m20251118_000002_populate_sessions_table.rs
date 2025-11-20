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

use config::utils::json;
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let txn = db.begin().await?;

        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        let mut meta_pages = meta::Entity::find()
            .filter(meta::Column::Module.eq("user_sessions"))
            .order_by_asc(meta::Column::Id)
            .paginate(&txn, 100);

        while let Some(metas) = meta_pages.fetch_and_next().await? {
            let mut sessions = vec![];
            for m in metas {
                // The session_id is stored in key2 after parsing the key
                // Key format is: /user_sessions/{session_id}
                // After parsing: module="user_sessions", key1="", key2="{session_id}"
                let session_id = if m.key2.is_empty() {
                    // Fallback to key1 if key2 is empty (shouldn't happen but be defensive)
                    &m.key1
                } else {
                    &m.key2
                };

                if session_id.is_empty() {
                    log::warn!("Empty session_id found in meta table, skipping");
                    continue;
                }

                // The value is JSON-encoded string, need to deserialize
                let access_token: String = json::from_str(&m.value)
                    .map_err(|e| DbErr::Migration(format!("Failed to parse session value: {}", e)))?;

                if access_token.is_empty() {
                    log::warn!("Empty access_token for session_id: {}, skipping", session_id);
                    continue;
                }

                let now = chrono::Utc::now().timestamp_micros();
                sessions.push(sessions::ActiveModel {
                    id: sea_orm::ActiveValue::NotSet,
                    session_id: Set(session_id.to_string()),
                    access_token: Set(access_token),
                    created_at: Set(now),
                    updated_at: Set(now),
                });
            }

            if !sessions.is_empty() {
                sessions::Entity::insert_many(sessions).exec(&txn).await?;
            }
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        sessions::Entity::delete_many().exec(db).await?;
        Ok(())
    }
}

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

/// Representation of the sessions table at the time this migration executes.
mod sessions {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "sessions")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub session_id: String,
        #[sea_orm(column_type = "Text")]
        pub access_token: String,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
