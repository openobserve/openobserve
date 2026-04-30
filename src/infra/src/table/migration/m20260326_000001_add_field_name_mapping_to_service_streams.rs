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

/// Add `field_name_mapping` nullable JSONB column to `service_streams`.
///
/// This column stores a map of semantic group ID -> raw field name that produced it,
/// e.g. {"service": "kubernetes_labels_app", "k8s-cluster": "cluster_name"}.
/// Nullable for backward compatibility with rows written before this feature.
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
                        ColumnDef::new(ServiceStreams::FieldNameMapping)
                            .json_binary()
                            .null(),
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
                            .drop_column(ServiceStreams::FieldNameMapping)
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
    FieldNameMapping,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260326_000001_add_field_name_mapping_to_service_streams"
        );
    }
}
