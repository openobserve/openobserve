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

/// Add `all_dimensions` JSONB column to `service_streams`.
///
/// This column stores ALL semantic dimensions extracted from the telemetry record
/// (superset of `disambiguation`), enabling analytics to compute cardinality,
/// coverage and co-occurrence even before the user configures disambiguation sets.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ServiceStreams::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(ServiceStreams::AllDimensions)
                            .json_binary()
                            .not_null()
                            .default("{}"),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                manager
                    .alter_table(
                        Table::alter()
                            .table(ServiceStreams::Table)
                            .drop_column(ServiceStreams::AllDimensions)
                            .to_owned(),
                    )
                    .await
            }
            _ => Ok(()), // SQLite: no-op on down
        }
    }
}

#[derive(DeriveIden)]
enum ServiceStreams {
    Table,
    AllDimensions,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260318_000005_add_all_dimensions_to_service_streams"
        );
    }
}
