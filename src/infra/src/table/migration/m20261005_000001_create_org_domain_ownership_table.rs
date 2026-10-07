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

//! Custom (vanity) domains for status pages — DNS ownership verification and
//! Host→page routing only. TLS termination is deliberately out of scope: an
//! operator's own reverse proxy / CDN handles HTTPS for the vanity host and
//! forwards plain requests here with the original `Host` header intact.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_domains_stmt()).await?;
        manager.create_index(domain_org_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OrgDomainOwnership::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_domains_stmt() -> TableCreateStatement {
    Table::create()
        .table(OrgDomainOwnership::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgDomainOwnership::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OrgDomainOwnership::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainOwnership::Domain)
                .string_len(253)
                .not_null()
        )
        .col(
            ColumnDef::new(OrgDomainOwnership::VerificationToken)
                .string_len(128)
                .not_null(),
        )
        // 0 pending, 1 verified, 2 failed.
        .col(
            ColumnDef::new(OrgDomainOwnership::VerificationState)
                .integer()
                .not_null()
                .default(0),
        )
        // 0 record-missing, 1 value-mismatch, 2 dns-resolution-failed.
        .col(
            ColumnDef::new(OrgDomainOwnership::VerificationFailureReason)
                .integer()
                .null(),
        )
        .col(ColumnDef::new(OrgDomainOwnership::VerifiedAt).big_integer().null())

        .col(ColumnDef::new(OrgDomainOwnership::ReleasedAt).big_integer().null())
        .col(ColumnDef::new(OrgDomainOwnership::LastCheckedAt).big_integer().null())
        .col(
            ColumnDef::new(OrgDomainOwnership::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgDomainOwnership::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn domain_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("org_domain_ownership_org_domain_idx")
        .table(OrgDomainOwnership::Table)
        .col(OrgDomainOwnership::OrgId)
        .col(OrgDomainOwnership::Domain)
        .col(OrgDomainOwnership::VerificationState)
        .to_owned()
}

#[derive(DeriveIden)]
enum OrgDomainOwnership {
    Table,
    Id,
    OrgId,
    Domain,
    VerificationToken,
    VerificationState,
    VerificationFailureReason,
    VerifiedAt,
    ReleasedAt,
    LastCheckedAt,
    CreatedAt,
    UpdatedAt,
}
