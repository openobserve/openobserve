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
        manager.create_index(domains_page_idx()).await?;
        manager.create_index(domains_domain_live_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(StatusPageCustomDomains::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn create_domains_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageCustomDomains::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageCustomDomains::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageCustomDomains::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageCustomDomains::StatusPageId)
                .string_len(27)
                .not_null(),
        )
        // Lowercased/punycode at the app layer before insert.
        .col(
            ColumnDef::new(StatusPageCustomDomains::Domain)
                .string_len(253)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageCustomDomains::VerificationToken)
                .string_len(64)
                .not_null(),
        )
        // 0 pending, 1 verified, 2 failed.
        .col(
            ColumnDef::new(StatusPageCustomDomains::VerificationState)
                .integer()
                .not_null()
                .default(0),
        )
        // 0 record-missing, 1 value-mismatch, 2 dns-resolution-failed.
        .col(
            ColumnDef::new(StatusPageCustomDomains::VerificationFailureReason)
                .integer()
                .null(),
        )
        .col(ColumnDef::new(StatusPageCustomDomains::VerifiedAt).big_integer().null())
        // Released (deleted) domains are tombstoned, not row-deleted, so a
        // different org re-claiming the same string is distinguishable from
        // the original owner returning; the live-uniqueness index below
        // excludes tombstoned rows via the WHERE released_at IS NULL clause
        // (see the migration's raw-SQL note if the target DB needs one) —
        // for v1 the partial-uniqueness enforcement lives in the app layer
        // (insert-then-check) rather than a DB-level partial index, since
        // sea-orm's cross-backend index builder does not support WHERE
        // clauses portably across Postgres/MySQL/SQLite.
        .col(ColumnDef::new(StatusPageCustomDomains::ReleasedAt).big_integer().null())
        .col(ColumnDef::new(StatusPageCustomDomains::LastCheckedAt).big_integer().null())
        .col(
            ColumnDef::new(StatusPageCustomDomains::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageCustomDomains::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn domains_page_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_custom_domains_page_idx")
        .table(StatusPageCustomDomains::Table)
        .col(StatusPageCustomDomains::StatusPageId)
        .to_owned()
}

/// Not a DB-level unique constraint (tombstoned rows must be excludable, and a
/// portable partial index isn't available across every supported backend) —
/// the app layer enforces live-uniqueness on write. This index just makes the
/// point-read hot path (`get_page_by_domain`) an index seek instead of a scan.
fn domains_domain_live_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_custom_domains_domain_idx")
        .table(StatusPageCustomDomains::Table)
        .col(StatusPageCustomDomains::Domain)
        .to_owned()
}

#[derive(DeriveIden)]
enum StatusPageCustomDomains {
    Table,
    Id,
    OrgId,
    StatusPageId,
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
