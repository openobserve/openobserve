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

/// Early deletion marker (A2.6).
///
/// Deletion is not a single transaction across PostgreSQL and the streams, so
/// the row has to be able to say "this Experiment is gone, cleanup is still
/// running". Every read filters on this column, which is what stops partially
/// cleaned data from being served as a valid Experiment.
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column(LlmExperiments::Table.to_string(), "deleted_at")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(LlmExperiments::Table)
                        .add_column(
                            ColumnDef::new(LlmExperiments::DeletedAt)
                                .big_integer()
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("llm_experiments_deleted_at_idx")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::DeletedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("llm_experiments_deleted_at_idx")
                    .table(LlmExperiments::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmExperiments::Table)
                    .drop_column(LlmExperiments::DeletedAt)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    DeletedAt,
}
