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

//! Adds the composite-alert column to the alerts table:
//!  - `composite_spec` (JSON, nullable): when present, holds the JSONB serialization of a
//!    `CompositeSpec` and marks the alert as a composite.
//!
//! A composite never mutates the alerts it references, so no back-reference is
//! stored on referenced alerts. Legacy rows are `NULL` (ordinary single-query
//! alerts), so the migration is backward compatible. The column exists in all
//! builds but the composite evaluation logic is only available in the
//! enterprise edition.

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
                    .add_column_if_not_exists(ColumnDef::new(Alerts::CompositeSpec).json().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Alerts::Table)
                    .drop_column(Alerts::CompositeSpec)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    CompositeSpec,
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
                .add_column_if_not_exists(ColumnDef::new(Alerts::CompositeSpec).json().null())
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "composite_spec" json NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &Table::alter()
                .table(Alerts::Table)
                .add_column_if_not_exists(ColumnDef::new(Alerts::CompositeSpec).json().null())
                .to_owned()
                .to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN "composite_spec" json_text NULL"#
        );
    }
}
