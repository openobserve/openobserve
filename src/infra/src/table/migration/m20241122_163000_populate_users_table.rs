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
use hashbrown::HashSet;
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;
use serde::{self, Deserialize};

#[derive(DeriveMigrationName)]
pub struct Migration;

const DEFAULT_ORG: &str = "default";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let txn = db.begin().await?;
        let org_set = HashSet::new();
        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        // txn.execute()
        let mut meta_pages = super::meta::Entity::find()
            .filter(super::meta::Column::Module.eq("user"))
            .order_by_asc(super::meta::Column::Id)
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
                        email: Set(json_user.email),
                        role: Set(org_user.role),
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

    // define the organizations type
    #[derive(Clone, Copy, Debug, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
    #[sea_orm(rs_type = "i32", db_type = "Integer")]
    pub enum UserRole {
        Admin = 0,
        Root = 1,
        Viewer = 2,
        User = 3,
        Editor = 4,
        ServiceAccount = 5,
    }

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
        pub role: UserRole,
        pub token: String,
        pub rum_token: Option<String>,
        pub created_at: u64,
        pub updated_at: u64,
    }

    #[derive(Copy, Clone, Debug, EnumIter)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_folders_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "folders" (
                "id" bigserial NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "folder_id" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "description" text,
                "type" smallint NOT NULL,
                "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_folders_org_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "folders_org_idx" ON "folders" ("org")"#
        );
        assert_eq!(
            &create_folders_org_folder_id_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "folders_org_folder_id_idx" ON "folders" ("org", "folder_id")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_folders_table_statement().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `folders` (
                `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `org` varchar(100) NOT NULL,
                `folder_id` varchar(256) NOT NULL,
                `name` varchar(256) NOT NULL,
                `description` text,
                `type` smallint NOT NULL,
                `created_at` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_folders_org_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE INDEX `folders_org_idx` ON `folders` (`org`)"#
        );
        assert_eq!(
            &create_folders_org_folder_id_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `folders_org_folder_id_idx` ON `folders` (`org`, `folder_id`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_folders_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "folders" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "org" varchar(100) NOT NULL,
                "folder_id" varchar(256) NOT NULL,
                "name" varchar(256) NOT NULL,
                "description" text,
                "type" smallint NOT NULL,
                "created_at" timestamp_text DEFAULT CURRENT_TIMESTAMP NOT NULL
            )"#
        );
        assert_eq!(
            &create_folders_org_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "folders_org_idx" ON "folders" ("org")"#
        );
        assert_eq!(
            &create_folders_org_folder_id_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "folders_org_folder_id_idx" ON "folders" ("org", "folder_id")"#
        );
    }
}
