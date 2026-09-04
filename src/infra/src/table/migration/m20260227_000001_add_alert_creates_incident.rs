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

//! Migration to add `creates_incident` column to alerts table.
//!
//! When true, this alert opts into incident correlation instead of sending
//! direct notifications. Notification is sent only when a new incident is
//! created or a new alert type joins an existing incident.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alerts::CreatesIncident)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::CreatesIncident)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    CreatesIncident,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Alerts::CreatesIncident)
                        .boolean()
                        .not_null()
                        .default(false),
                )
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "creates_incident" bool NOT NULL DEFAULT FALSE"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column_if_not_exists(
                    ColumnDef::new(Alerts::CreatesIncident)
                        .boolean()
                        .not_null()
                        .default(false),
                )
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN "creates_incident" boolean NOT NULL DEFAULT FALSE"#
        );
    }
}
