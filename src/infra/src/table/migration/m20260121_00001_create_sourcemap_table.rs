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

const SOURCEMAP_UNIQUE_INDEX: &str = "sourcemap_unique_index";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_sourcemaps_table_statement())
            .await?;
        manager.create_index(create_unique_index()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SourceMaps::Table).to_owned())
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SOURCEMAP_UNIQUE_INDEX)
                    .table(SourceMaps::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

/// Statement to create the sourcemaps table.
fn create_sourcemaps_table_statement() -> TableCreateStatement {
    Table::create()
        .table(SourceMaps::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SourceMaps::Id)
                .integer()
                .primary_key()
                .auto_increment(),
        )
        .col(ColumnDef::new(SourceMaps::Org).string_len(100).not_null())
        .col(ColumnDef::new(SourceMaps::Service).string_len(150).null())
        .col(ColumnDef::new(SourceMaps::Env).string_len(150).null())
        .col(ColumnDef::new(SourceMaps::Version).string_len(150).null())
        .col(
            ColumnDef::new(SourceMaps::SourceFileName)
                .string_len(250)
                .not_null(),
        )
        .col(
            ColumnDef::new(SourceMaps::SourceMapFileName)
                .string_len(250)
                .not_null(),
        )
        .col(
            ColumnDef::new(SourceMaps::FileStoreId)
                .string_len(64)
                .not_null(),
        )
        .col(ColumnDef::new(SourceMaps::FileType).integer().not_null())
        .col(
            ColumnDef::new(SourceMaps::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(SourceMaps::IsLocal).boolean().not_null())
        .to_owned()
}

fn create_unique_index() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SOURCEMAP_UNIQUE_INDEX)
        .table(SourceMaps::Table)
        .col(SourceMaps::Org)
        .col(SourceMaps::Service)
        .col(SourceMaps::Env)
        .col(SourceMaps::Version)
        .col(SourceMaps::SourceFileName)
        .col(SourceMaps::SourceMapFileName)
        .unique()
        .to_owned()
}

/// Identifiers used in queries on the sourcemaps keys table.
#[derive(DeriveIden)]
enum SourceMaps {
    Table,
    Id,
    Org,
    Service,
    Env,
    Version,
    SourceFileName,
    SourceMapFileName,
    FileStoreId,
    FileType,
    CreatedAt,
    IsLocal,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_sourcemaps_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "source_maps" ( 
            "id" serial PRIMARY KEY,
            "org" varchar(100) NOT NULL,
            "service" varchar(150) NULL,
            "env" varchar(150) NULL,
            "version" varchar(150) NULL,
            "source_file_name" varchar(250) NOT NULL,
            "source_map_file_name" varchar(250) NOT NULL, 
            "file_type" integer NOT NULL,
            "created_at" bigint NOT NULL,
            "is_local" bool NOT NULL 
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_sourcemaps_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "source_maps" ( 
            "id" integer PRIMARY KEY AUTOINCREMENT,
            "org" varchar(100) NOT NULL,
            "service" varchar(150) NULL,
            "env" varchar(150) NULL,
            "version" varchar(150) NULL,
            "source_file_name" varchar(250) NOT NULL,
            "source_map_file_name" varchar(250) NOT NULL, 
            "file_type" integer NOT NULL,
            "created_at" bigint NOT NULL,
            "is_local" boolean NOT NULL 
            )"#
        );
    }
}
