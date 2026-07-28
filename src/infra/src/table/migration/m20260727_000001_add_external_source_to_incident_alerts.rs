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

//! Migration to record where an incident's alerts came from.
//!
//! Alerts pushed in over the external ingest webhook have no row in the
//! `alerts` table, so `get_incident_with_alerts` cannot resolve their details
//! the way it does for native alerts. These columns let the junction row carry
//! everything needed to render an external alert on its own.
//!
//! `source` NULL means a native OpenObserve alert — every pre-existing row.

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
                        ColumnDef::new(AlertIncidentAlerts::Source)
                            .string_len(128)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(AlertIncidentAlerts::ExternalUrl)
                            .string_len(2048)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(AlertIncidentAlerts::Annotations)
                            .text()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(AlertIncidentAlerts::ResolvedAt)
                            .big_integer()
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
                    .table(AlertIncidentAlerts::Table)
                    .drop_column(AlertIncidentAlerts::ResolvedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .drop_column(AlertIncidentAlerts::Annotations)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .drop_column(AlertIncidentAlerts::ExternalUrl)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .drop_column(AlertIncidentAlerts::Source)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AlertIncidentAlerts {
    Table,
    Source,
    ExternalUrl,
    Annotations,
    /// When the originating system reported this alert resolved. An incident
    /// auto-resolves once every distinct alert in it has a value here.
    ResolvedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &Table::alter()
                .table(AlertIncidentAlerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(AlertIncidentAlerts::Source)
                        .string_len(128)
                        .null(),
                )
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_incident_alerts" ADD COLUMN IF NOT EXISTS "source" varchar(128) NULL"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &Table::alter()
                .table(AlertIncidentAlerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(AlertIncidentAlerts::Source)
                        .string_len(128)
                        .null(),
                )
                .to_owned()
                .to_string(MysqlQueryBuilder),
            r#"ALTER TABLE `alert_incident_alerts` ADD COLUMN IF NOT EXISTS `source` varchar(128) NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &Table::alter()
                .table(AlertIncidentAlerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(AlertIncidentAlerts::Source)
                        .string_len(128)
                        .null(),
                )
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alert_incident_alerts" ADD COLUMN "source" varchar(128) NULL"#
        );
    }
}
