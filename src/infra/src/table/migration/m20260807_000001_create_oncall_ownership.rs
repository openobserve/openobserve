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

//! Ownership rules, and the alert-level routing override.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallOwnershipRules::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallOwnershipRules::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::TeamId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::Path)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::Dimensions)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // One claim per path per org. Two teams claiming the same path is a
        // configuration mistake the resolver has to break a tie over; refusing
        // it at write time is cheaper than explaining the tie afterwards.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallOwnershipRules::Table)
                    .name("idx_oncall_ownership_org_path")
                    .col(OncallOwnershipRules::OrgId)
                    .col(OncallOwnershipRules::Path)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Every rule for an org is loaded together on the routing path.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallOwnershipRules::Table)
                    .name("idx_oncall_ownership_org")
                    .col(OncallOwnershipRules::OrgId)
                    .to_owned(),
            )
            .await?;

        // Nullable: most alerts route by ownership, and a null here means
        // "discover it" rather than "no team".
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(ColumnDef::new(Alerts::OncallTeam).string().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::OncallTeam)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(OncallOwnershipRules::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum OncallOwnershipRules {
    Table,
    Id,
    OrgId,
    TeamId,
    Path,
    Dimensions,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    OncallTeam,
}
