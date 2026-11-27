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

//! Adds `plan_history` to `autoresolve_runs`: every plan a run's agent proposed, oldest first.

use sea_orm_migration::prelude::*;

const RUNS: &str = "autoresolve_runs";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip the column already added.
        if manager
            .has_column(RUNS, &AutoresolveRuns::PlanHistory.to_string())
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AutoresolveRuns::Table)
                    .add_column(ColumnDef::new(AutoresolveRuns::PlanHistory).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column(RUNS, &AutoresolveRuns::PlanHistory.to_string())
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AutoresolveRuns::Table)
                    .drop_column(AutoresolveRuns::PlanHistory)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveRuns {
    Table,
    PlanHistory,
}
