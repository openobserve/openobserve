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

pub use sea_orm_migration::prelude::*;

mod m20241114_000001_create_folders_table;
mod m20241115_150000_populate_folders_table;
mod m20241116_000001_delete_metas;
mod m20241116_000002_drop_folders_created_at_column;
mod m20241119_000001_create_dashboards_table;
mod m20241119_000002_populate_dashboards_table;
mod m20241119_000003_delete_metas;
mod m20241121_000001_create_organizations_table;
mod m20241122_000001_populate_organizations_table;
mod m20241122_130000_create_users_table;
mod m20241122_150000_create_org_users_table;
mod m20241122_163000_populate_users_table;

/// Representation of the meta table at the time this migration executes.
pub(super) mod meta {
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

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20241114_000001_create_folders_table::Migration),
            Box::new(m20241115_150000_populate_folders_table::Migration),
            Box::new(m20241116_000001_delete_metas::Migration),
            Box::new(m20241116_000002_drop_folders_created_at_column::Migration),
            Box::new(m20241119_000001_create_dashboards_table::Migration),
            Box::new(m20241119_000002_populate_dashboards_table::Migration),
            Box::new(m20241119_000003_delete_metas::Migration),
            Box::new(m20241121_000001_create_organizations_table::Migration),
            Box::new(m20241122_000001_populate_organizations_table::Migration),
            Box::new(m20241122_130000_create_users_table::Migration),
            Box::new(m20241122_150000_create_org_users_table::Migration),
            Box::new(m20241122_163000_populate_users_table::Migration),
        ]
    }
}
