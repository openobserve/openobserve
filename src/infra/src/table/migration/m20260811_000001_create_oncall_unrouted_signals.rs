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

//! The unrouted queue: an unroutable page must never be a silent drop.

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
                    .table(OncallUnroutedSignals::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::Path)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::Dimensions)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::Occurrences)
                            .big_integer()
                            .not_null()
                            .default(1),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::FirstSeenAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::LastSeenAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::LastSubjectType)
                            .integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::LastSourceId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::LastTitle)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::LastPriority)
                            .integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnroutedSignals::DismissedAt)
                            .big_integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // One row per path per org: a repeat bumps a counter instead of adding another line.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallUnroutedSignals::Table)
                    .name("idx_oncall_unrouted_org_path")
                    .col(OncallUnroutedSignals::OrgId)
                    .col(OncallUnroutedSignals::Path)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallUnroutedSignals::Table)
                    .name("idx_oncall_unrouted_org_last_seen")
                    .col(OncallUnroutedSignals::OrgId)
                    .col(OncallUnroutedSignals::LastSeenAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(OncallUnroutedSignals::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallUnroutedSignals {
    Table,
    Id,
    OrgId,
    Path,
    Dimensions,
    Occurrences,
    FirstSeenAt,
    LastSeenAt,
    LastSubjectType,
    LastSourceId,
    LastTitle,
    LastPriority,
    DismissedAt,
}
