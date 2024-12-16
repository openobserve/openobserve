// Copyright 2024 OpenObserve Inc.
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

use config::{
    meta::user::{DBUser, UserRole},
    utils::json,
};
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
        // txn.execute()
        let mut meta_pages = meta::Entity::find()
            .filter(meta::Column::Module.eq("user"))
            .order_by_asc(meta::Column::Id)
            .paginate(&txn, 100);

        while let Some(metas) = meta_pages.fetch_and_next().await? {
            let mut users = vec![];
            let mut org_users = vec![];
            for m in metas {
                let json_user: DBUser =
                    json::from_str(&m.value).map_err(|e| DbErr::Migration(e.to_string()))?;
                let all_org_users = json_user.get_all_users();
                let is_root_user = if all_org_users.is_empty() {
                    false
                } else {
                    all_org_users[0].role.eq(&UserRole::Root)
                };

                let now = chrono::Utc::now().timestamp_micros() as u64;
                users.push(users::ActiveModel {
                    email: Set(json_user.email.clone()),
                    first_name: Set(json_user.first_name.clone()),
                    last_name: Set(json_user.last_name.clone()),
                    password: Set(json_user.password.clone()),
                    salt: Set(json_user.salt.clone()),
                    is_root: Set(is_root_user),
                    password_ext: Set(json_user.password_ext.clone()),
                    user_type: Set(json_user.is_external as i16),
                    created_at: Set(now),
                    updated_at: Set(now),
                    ..Default::default()
                });

                for org_user in all_org_users {
                    org_users.push(org_users::ActiveModel {
                        org_id: Set(org_user.org),
                        email: Set(org_user.email),
                        role: Set(org_user.role.into()),
                        token: Set(org_user.token),
                        rum_token: Set(org_user.rum_token),
                        created_at: Set(now),
                        updated_at: Set(now),
                        ..Default::default()
                    });
                }
            }
            users::Entity::insert_many(users).exec(&txn).await?;
            org_users::Entity::insert_many(org_users).exec(&txn).await?;
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        org_users::Entity::delete_many().exec(db).await?;
        users::Entity::delete_many().exec(db).await?;
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

/// Representation of the users table at the time this migration executes.
mod users {
    use sea_orm::entity::prelude::*;

    // define the organizations table
    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "users")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = true)]
        pub id: i64,
        #[sea_orm(column_type = "String(StringLen::N(100))")]
        pub email: String,
        #[sea_orm(column_type = "String(StringLen::N(80))")]
        pub first_name: String,
        #[sea_orm(column_type = "String(StringLen::N(80))")]
        pub last_name: String,
        #[sea_orm(column_type = "Text")]
        pub password: String,
        pub salt: String,
        pub is_root: bool,
        pub password_ext: Option<String>,
        pub user_type: i16,
        pub created_at: u64,
        pub updated_at: u64,
    }

    #[derive(Copy, Clone, Debug, EnumIter)]
    pub enum Relation {}

    impl RelationTrait for Relation {
        fn def(&self) -> RelationDef {
            panic!("No relations defined")
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the org_users table at the time this migration executes.
mod org_users {
    use sea_orm::entity::prelude::*;

    // define the organizations table
    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "org_users")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = true)]
        pub id: i64,
        #[sea_orm(column_type = "String(StringLen::N(256))")]
        pub org_id: String,
        #[sea_orm(column_type = "String(StringLen::N(100))")]
        pub email: String,
        pub role: i16,
        pub token: String,
        pub rum_token: Option<String>,
        pub created_at: u64,
        pub updated_at: u64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
