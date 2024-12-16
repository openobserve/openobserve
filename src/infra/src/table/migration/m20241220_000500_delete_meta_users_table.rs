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

//! Deletes user records from the meta table.

use std::collections::HashMap;

use config::meta::user::{DBUser, UserOrg};
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, TransactionTrait,
};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        meta::Entity::delete_many()
            .filter(meta::Column::Module.eq("user"))
            .exec(&txn)
            .await?;
        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // The deletion of records from the meta table is not reversable.
        let db = manager.get_connection();
        let txn = db.begin().await?;
        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        // txn.execute()
        let mut db_users = HashMap::new();
        let mut user_pages = users::Entity::find()
            .order_by_asc(users::Column::Id)
            .paginate(&txn, 100);

        while let Some(users) = user_pages.fetch_and_next().await? {
            for u in users {
                let db_user = DBUser {
                    email: u.email.clone(),
                    first_name: u.first_name.clone(),
                    last_name: u.last_name.clone(),
                    password: u.password.clone(),
                    salt: u.salt.clone(),
                    password_ext: u.password_ext.clone(),
                    is_external: u.user_type != 0,
                    organizations: vec![],
                };
                db_users.insert(u.email.clone(), db_user);
            }
        }

        let mut org_user_pages = org_users::Entity::find()
            .order_by_asc(org_users::Column::Id)
            .paginate(&txn, 100);

        while let Some(org_users) = org_user_pages.fetch_and_next().await? {
            for ou in org_users {
                let db_user = db_users
                    .get_mut(&ou.email)
                    .ok_or_else(|| DbErr::Migration("User not found".to_string()))?;
                db_user.organizations.push(UserOrg {
                    name: ou.org_id.clone(),
                    role: ou.role.into(),
                    token: ou.token.clone(),
                    rum_token: ou.rum_token.clone(),
                });
            }
        }

        txn.commit().await?;
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

mod users {
    use sea_orm::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "users")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        #[sea_orm(unique)]
        pub email: String,
        pub first_name: String,
        pub last_name: String,
        #[sea_orm(column_type = "Text")]
        pub password: String,
        pub salt: String,
        pub is_root: bool,
        pub password_ext: Option<String>,
        pub user_type: i16,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod org_users {
    use sea_orm::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "org_users")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub email: String,
        pub org_id: String,
        pub role: i16,
        pub token: String,
        pub rum_token: Option<String>,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
