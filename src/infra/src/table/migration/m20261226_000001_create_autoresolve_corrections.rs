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

//! Creates `autoresolve_corrections` and adds the corrections, verdict and added-connection
//! columns to `autoresolve_runs`.

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

pub(super) const CORRECTIONS_ACTIVE_IDX: &str =
    "autoresolve_corrections_org_autoresolve_active_idx";
pub(super) const CORRECTIONS_RUN_IDX: &str = "autoresolve_corrections_org_run_idx";
const RUNS: &str = "autoresolve_runs";
const RUN_COLUMNS: [AutoresolveRuns; 3] = [
    AutoresolveRuns::PlanCorrections,
    AutoresolveRuns::PersonVerdict,
    AutoresolveRuns::AddedConnections,
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        let backend = conn.get_database_backend();
        conn.execute(backend.build(&corrections_table())).await?;
        for index in indexes() {
            conn.execute(backend.build(&index)).await?;
        }
        for column in RUN_COLUMNS {
            // SQLite drops IF NOT EXISTS, so a retry must skip the column already added.
            if manager.has_column(RUNS, &column.to_string()).await? {
                continue;
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(AutoresolveRuns::Table)
                        .add_column(ColumnDef::new(column).text().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in RUN_COLUMNS {
            if !manager.has_column(RUNS, &column.to_string()).await? {
                continue;
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(AutoresolveRuns::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(AutoresolveCorrections::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveCorrections {
    Table,
    Id,
    Org,
    AutoresolveId,
    RunId,
    Revision,
    Kind,
    Note,
    OptionTitle,
    CreatedBy,
    CreatedAtUs,
    Active,
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveRuns {
    Table,
    PlanCorrections,
    PersonVerdict,
    AddedConnections,
}

fn corrections_table() -> TableCreateStatement {
    use AutoresolveCorrections as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(T::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(T::Org).string_len(256).not_null())
        .col(ColumnDef::new(T::AutoresolveId).string_len(27).null())
        .col(ColumnDef::new(T::RunId).string_len(27).not_null())
        .col(ColumnDef::new(T::Revision).integer().not_null())
        .col(ColumnDef::new(T::Kind).string_len(16).not_null())
        .col(ColumnDef::new(T::Note).text().not_null())
        .col(ColumnDef::new(T::OptionTitle).text().null())
        .col(ColumnDef::new(T::CreatedBy).string_len(256).not_null())
        .col(ColumnDef::new(T::CreatedAtUs).big_integer().not_null())
        .col(ColumnDef::new(T::Active).boolean().not_null())
        .to_owned()
}

fn indexes() -> [IndexCreateStatement; 2] {
    use AutoresolveCorrections as T;
    [
        Index::create()
            .if_not_exists()
            .name(CORRECTIONS_ACTIVE_IDX)
            .table(T::Table)
            .col(T::Org)
            .col(T::AutoresolveId)
            .col(T::Active)
            .col(T::CreatedAtUs)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(CORRECTIONS_RUN_IDX)
            .table(T::Table)
            .col(T::Org)
            .col(T::RunId)
            .to_owned(),
    ]
}
