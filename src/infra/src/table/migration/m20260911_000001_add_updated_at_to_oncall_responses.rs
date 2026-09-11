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

//! The revision a replica orders response snapshots by, so a redelivered older
//! one cannot un-acknowledge a page.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column(ONCALL_RESPONSES, &OncallResponses::UpdatedAt.to_string())
            .await?
        {
            return Ok(());
        }
        // NOT NULL with a default rather than nullable: a NULL would fail the
        // `updated_at <= incoming` filter for ever, freezing the replica's row.
        manager
            .alter_table(
                Table::alter()
                    .table(OncallResponses::Table)
                    .add_column(
                        ColumnDef::new(OncallResponses::UpdatedAt)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column(ONCALL_RESPONSES, &OncallResponses::UpdatedAt.to_string())
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(OncallResponses::Table)
                        .drop_column(OncallResponses::UpdatedAt)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const ONCALL_RESPONSES: &str = "oncall_responses";

#[derive(DeriveIden, Clone, Copy)]
enum OncallResponses {
    Table,
    UpdatedAt,
}
