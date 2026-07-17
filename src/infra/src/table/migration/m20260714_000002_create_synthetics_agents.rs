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

//! Create `synthetics_agents` — liveness registry of probe agent processes.
//!
//! One row per agent process serving a location (multiple per location for HA).
//! Inserted/updated by `/synthetics/agent/register`; `last_seen_at` is refreshed
//! by register and by every job lease. A location whose agents are all stale is
//! reported "down". `capabilities` is the agent's self-reported check support
//! (`{"types": [...], "icmp": bool, "max_concurrency": n}`), used to compute
//! per-type availability in the locations API.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SyntheticsAgents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SyntheticsAgents::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SyntheticsAgents::OrgId).string().not_null())
                    .col(
                        ColumnDef::new(SyntheticsAgents::LocationId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(SyntheticsAgents::Name).string().not_null())
                    .col(ColumnDef::new(SyntheticsAgents::Version).string())
                    .col(ColumnDef::new(SyntheticsAgents::Capabilities).json())
                    .col(
                        ColumnDef::new(SyntheticsAgents::LastSeenAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsAgents::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .table(SyntheticsAgents::Table)
                    .name("idx_synthetics_agents_location_id")
                    .col(SyntheticsAgents::LocationId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .table(SyntheticsAgents::Table)
                    .name("idx_synthetics_agents_org_id")
                    .col(SyntheticsAgents::OrgId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SyntheticsAgents::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SyntheticsAgents {
    Table,
    Id,
    OrgId,
    LocationId,
    Name,
    Version,
    Capabilities,
    LastSeenAt,
    CreatedAt,
}
