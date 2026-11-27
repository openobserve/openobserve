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

//! Adds `incident_id` to `autoresolve_runs`: the incident a run works on, at most one live run
//! per incident.

use config::meta::autoresolve::RunState;
use sea_orm_migration::prelude::*;

const RUNS: &str = "autoresolve_runs";
pub(super) const RUNS_INCIDENT_LIVE_IDX: &str = "autoresolve_runs_org_incident_live_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip the column already added.
        if !manager
            .has_column(RUNS, &AutoresolveRuns::IncidentId.to_string())
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(AutoresolveRuns::Table)
                        .add_column(
                            ColumnDef::new(AutoresolveRuns::IncidentId)
                                .string_len(256)
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        // The same live states as the one-live-run-per-AutoResolve index.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(RUNS_INCIDENT_LIVE_IDX)
                    .table(AutoresolveRuns::Table)
                    .col(AutoresolveRuns::Org)
                    .col(AutoresolveRuns::IncidentId)
                    .unique()
                    .and_where(Expr::col(AutoresolveRuns::IncidentId).is_not_null())
                    .and_where(
                        Expr::col(AutoresolveRuns::State).is_in(
                            [
                                RunState::Investigating,
                                RunState::WaitingApproval,
                                RunState::Proceeding,
                                RunState::Checking,
                            ]
                            .map(|s| s.as_str()),
                        ),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(RUNS_INCIDENT_LIVE_IDX)
                    .table(AutoresolveRuns::Table)
                    .to_owned(),
            )
            .await?;
        if !manager
            .has_column(RUNS, &AutoresolveRuns::IncidentId.to_string())
            .await?
        {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AutoresolveRuns::Table)
                    .drop_column(AutoresolveRuns::IncidentId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveRuns {
    Table,
    Org,
    IncidentId,
    State,
}
