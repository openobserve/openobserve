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

//! Not a `ResponseState`: an exhausted page is still ackable, and the durable ids have no gap.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement, plus a `has_column` guard — see `m20260824_000001`.
        add_column(
            manager,
            ONCALL_RESPONSES,
            OncallResponses::ExhaustedAt,
            ColType::BigInt,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column(ONCALL_RESPONSES, &OncallResponses::ExhaustedAt.to_string())
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(OncallResponses::Table)
                        .drop_column(OncallResponses::ExhaustedAt)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const ONCALL_RESPONSES: &str = "oncall_responses";

#[derive(Clone, Copy)]
enum ColType {
    BigInt,
}

#[derive(DeriveIden, Clone, Copy)]
enum OncallResponses {
    Table,
    ExhaustedAt,
}

/// Genuinely idempotent unlike `add_column_if_not_exists` on SQLite, so a retry is safe.
async fn add_column<C>(
    manager: &SchemaManager<'_>,
    table: &str,
    column: C,
    ty: ColType,
) -> Result<(), DbErr>
where
    C: IntoIden + Clone,
{
    let name = column.clone().into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    let mut def = ColumnDef::new(column);
    let def = match ty {
        ColType::BigInt => def.big_integer(),
    }
    .null()
    .to_owned();

    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(def)
                .to_owned(),
        )
        .await
}
