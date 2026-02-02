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

use sea_orm::DbBackend;
use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_system_settings_table(manager.get_database_backend()))
            .await?;

        // Create indexes
        manager.create_index(create_scope_index()).await?;

        manager.create_index(create_org_index()).await?;

        manager.create_index(create_user_index()).await?;

        manager.create_index(create_key_index()).await?;

        manager.create_index(create_category_index()).await?;

        // Create unique constraint index
        manager.create_index(create_unique_setting_index()).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_system_settings_unique")
                    .table(SystemSettings::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_system_settings_category")
                    .table(SystemSettings::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_system_settings_key")
                    .table(SystemSettings::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_system_settings_user")
                    .table(SystemSettings::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_system_settings_org")
                    .table(SystemSettings::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_system_settings_scope")
                    .table(SystemSettings::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(SystemSettings::Table).to_owned())
            .await
    }
}

fn create_system_settings_table(backend: DbBackend) -> TableCreateStatement {
    let text_type = get_text_type();

    let mut table = Table::create()
        .table(SystemSettings::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SystemSettings::Id)
                .big_integer()
                .auto_increment()
                .primary_key()
                .not_null(),
        )
        .col(
            ColumnDef::new(SystemSettings::Scope)
                .string_len(20)
                .not_null(),
        )
        .col(ColumnDef::new(SystemSettings::OrgId).string_len(100).null())
        .col(
            ColumnDef::new(SystemSettings::UserId)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(SystemSettings::SettingKey)
                .string_len(255)
                .not_null(),
        )
        .col(
            ColumnDef::new(SystemSettings::SettingCategory)
                .string_len(100)
                .null(),
        )
        .col(
            ColumnDef::new(SystemSettings::Description)
                .custom(Alias::new(text_type))
                .null(),
        )
        .col(
            ColumnDef::new(SystemSettings::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SystemSettings::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SystemSettings::CreatedBy)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(SystemSettings::UpdatedBy)
                .string_len(256)
                .null(),
        )
        .to_owned();

    // Use JSON type for PostgreSQL, TEXT for others
    match backend {
        DbBackend::Postgres => {
            table.col(
                ColumnDef::new(SystemSettings::SettingValue)
                    .json_binary()
                    .not_null(),
            );
        }
        _ => {
            table.col(
                ColumnDef::new(SystemSettings::SettingValue)
                    .custom(Alias::new(text_type))
                    .not_null(),
            );
        }
    }

    table
}

fn create_scope_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_system_settings_scope")
        .table(SystemSettings::Table)
        .col(SystemSettings::Scope)
        .to_owned()
}

fn create_org_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_system_settings_org")
        .table(SystemSettings::Table)
        .col(SystemSettings::OrgId)
        .to_owned()
}

fn create_user_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_system_settings_user")
        .table(SystemSettings::Table)
        .col(SystemSettings::OrgId)
        .col(SystemSettings::UserId)
        .to_owned()
}

fn create_key_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_system_settings_key")
        .table(SystemSettings::Table)
        .col(SystemSettings::SettingKey)
        .to_owned()
}

fn create_category_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_system_settings_category")
        .table(SystemSettings::Table)
        .col(SystemSettings::SettingCategory)
        .to_owned()
}

fn create_unique_setting_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_system_settings_unique")
        .table(SystemSettings::Table)
        .col(SystemSettings::Scope)
        .col(SystemSettings::OrgId)
        .col(SystemSettings::UserId)
        .col(SystemSettings::SettingKey)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum SystemSettings {
    Table,
    Id,
    Scope,
    OrgId,
    UserId,
    SettingKey,
    SettingCategory,
    SettingValue,
    Description,
    CreatedAt,
    UpdatedAt,
    CreatedBy,
    UpdatedBy,
}
