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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_providers_table_statement())
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_providers_org")
                    .table(Providers::Table)
                    .col(Providers::OrgId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_providers_org_name")
                    .table(Providers::Table)
                    .col(Providers::OrgId)
                    .col(Providers::Name)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_providers_type")
                    .table(Providers::Table)
                    .col(Providers::ProviderType)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_providers_is_default")
                    .table(Providers::Table)
                    .col(Providers::OrgId)
                    .col(Providers::IsDefault)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Providers::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_providers_table_statement() -> TableCreateStatement {
    Table::create()
        .table(Providers::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(Providers::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(Providers::OrgId).string_len(256).not_null())
        .col(ColumnDef::new(Providers::Name).string_len(255).not_null())
        .col(
            ColumnDef::new(Providers::ProviderType)
                .string_len(50)
                .not_null(),
        )
        .col(ColumnDef::new(Providers::Endpoint).text().null())
        .col(
            ColumnDef::new(Providers::DefaultModel)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(Providers::AvailableModels).json().not_null())
        .col(ColumnDef::new(Providers::AuthConfig).text().null())
        .col(
            ColumnDef::new(Providers::IsDefault)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(Providers::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(Providers::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum Providers {
    Table,
    Id,
    OrgId,
    Name,
    ProviderType,
    Endpoint,
    DefaultModel,
    AvailableModels,
    AuthConfig,
    IsDefault,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_providers_table_contains_table_name() {
        let sql = create_providers_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("providers"));
    }

    #[test]
    fn test_create_providers_table_contains_if_not_exists() {
        let sql = create_providers_table_statement().build(SqliteQueryBuilder);
        assert!(sql.to_uppercase().contains("IF NOT EXISTS"));
    }
}
