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
        manager.create_table(create_domaim_req_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OrgDomainRequests::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_domaim_req_stmt() -> TableCreateStatement {
    Table::create()
        .table(OrgDomainRequests::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgDomainRequests::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OrgDomainRequests::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainRequests::Domain)
                .string_len(253)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainRequests::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainRequests::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainRequests::RequestedBy)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainRequests::AnsweredBy)
                .string_len(100)
                .not_null(),
        )
        .col(ColumnDef::new(OrgDomainRequests::Reason).string().null())
        .col(
            ColumnDef::new(OrgDomainRequests::Status)
                .small_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum OrgDomainRequests {
    Table,
    Id,
    OrgId,
    Domain,
    CreatedAt,
    UpdatedAt,
    RequestedBy,
    AnsweredBy,
    Reason,
    Status,
}
