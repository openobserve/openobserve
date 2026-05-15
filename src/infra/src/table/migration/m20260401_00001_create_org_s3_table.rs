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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_org_s3_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OrgStorageProviders::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the sourcemaps table.
fn create_org_s3_table_statement() -> TableCreateStatement {
    Table::create()
        .table(OrgStorageProviders::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgStorageProviders::OrgId)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OrgStorageProviders::ProviderType)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgStorageProviders::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgStorageProviders::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgStorageProviders::Data)
                .string_len(2048)
                .not_null(),
        )
        .to_owned()
}

/// Identifiers used in queries on the sourcemaps keys table.
#[derive(DeriveIden)]
enum OrgStorageProviders {
    Table,
    OrgId,
    ProviderType,
    CreatedAt,
    UpdatedAt,
    Data,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_org_s3_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "org_storage_providers" (
            "org_id" varchar(256) NOT NULL PRIMARY KEY,
            "provider_type" varchar(100) NOT NULL,
            "created_at" bigint NOT NULL,
            "updated_at" bigint NOT NULL,
            "data" varchar(2048) NOT NULL
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_org_s3_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "org_storage_providers" (
            "org_id" varchar(256) NOT NULL PRIMARY KEY,
            "provider_type" varchar(100) NOT NULL,
            "created_at" bigint NOT NULL,
            "updated_at" bigint NOT NULL,
            "data" varchar(2048) NOT NULL
            )"#
        );
    }
}
