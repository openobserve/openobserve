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

//! Create `synthetics_locations` — unified location registry for synthetics.
//!
//! Public rows (`org_id` NULL, `kind = "public"`) are o2-operated regions,
//! seeded/managed by ops. Private rows (`kind = "private"`) are created per-org
//! via the Private Locations CRUD. `pool` is the queue routing key consumed by
//! the scheduler and leased by probes/agents.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SyntheticsLocations::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SyntheticsLocations::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SyntheticsLocations::OrgId).string())
                    .col(
                        ColumnDef::new(SyntheticsLocations::Kind)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::Provider)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::Region)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::Label)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::Pool)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsLocations::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .table(SyntheticsLocations::Table)
                    .name("idx_synthetics_locations_org_id")
                    .col(SyntheticsLocations::OrgId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SyntheticsLocations::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SyntheticsLocations {
    Table,
    Id,
    OrgId,
    Kind,
    Provider,
    Region,
    Label,
    Pool,
    Enabled,
    CreatedAt,
    UpdatedAt,
}
