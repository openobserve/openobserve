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

//! Add `destinations` to `incident_integrations` — a typed column for the
//! incident-notification destinations used when this source's alerts create
//! or join an incident. Previously read from the untyped `config` JSON blob
//! (`config["destinations"]`); a dedicated column makes "no destination set"
//! directly queryable for the Alert Sources list-view warning state, instead
//! of requiring a JSON parse per row.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(IncidentIntegrations::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(IncidentIntegrations::Destinations)
                            .text()
                            .null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(IncidentIntegrations::Table)
                    .drop_column(IncidentIntegrations::Destinations)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum IncidentIntegrations {
    Table,
    Destinations,
}
