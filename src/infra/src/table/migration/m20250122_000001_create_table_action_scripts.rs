// Copyright (c) 2025. OpenObserve Inc.
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
        manager.create_table(create_table_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ActionScripts::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(ActionScripts::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(ActionScripts::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(ActionScripts::Name)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::FilePath)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::FileName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::OrgId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::CreatedBy)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::OriginClusterUrl)
                .text()
                .not_null(),
        )
        .col(ColumnDef::new(ActionScripts::Env).json().not_null())
        .col(
            ColumnDef::new(ActionScripts::ExecutionDetails)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(ActionScripts::CronExpr).string_len(32))
        .col(
            ColumnDef::new(ActionScripts::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::LastModifiedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(ActionScripts::LastExecutedAt).big_integer())
        .col(ColumnDef::new(ActionScripts::LastSuccessfulAt).big_integer())
        .col(ColumnDef::new(ActionScripts::Description).text())
        .col(
            ColumnDef::new(ActionScripts::Status)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(ActionScripts::ServiceAccount)
                .string_len(256)
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum ActionScripts {
    Table,
    Id,
    Name,
    FilePath,
    FileName,
    OrgId,
    CreatedBy,
    OriginClusterUrl,
    Env,
    ExecutionDetails,
    CronExpr,
    CreatedAt,
    LastModifiedAt,
    LastExecutedAt,
    LastSuccessfulAt,
    Description,
    Status,
    ServiceAccount,
}
