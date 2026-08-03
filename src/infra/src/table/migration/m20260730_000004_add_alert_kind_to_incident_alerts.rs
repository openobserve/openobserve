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

//! Add `alert_kind` to `alert_incident_alerts` — distinguishes alerts
//! originating internally from those ingested via external alert sources.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(AlertIncidentAlerts::AlertKind)
                            .string()
                            .not_null()
                            .default("internal"),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .drop_column(AlertIncidentAlerts::AlertKind)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AlertIncidentAlerts {
    Table,
    AlertKind,
}
