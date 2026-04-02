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

/// Add `set_id` column to `service_streams`.
///
/// This column tracks which identity set (e.g. "k8s", "aws") produced each
/// service record, enabling per-set analytics and scoped lookups.
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
                        ColumnDef::new(ServiceStreams::SetId)
                            .string_len(64)
                            .not_null()
                            .default("default"),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite does not support DROP COLUMN in older versions; use raw SQL for
        // cross-backend compatibility.  For SQLite we simply leave the column in
        // place on down() since it carries no data that can't be regenerated.
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                manager
                    .alter_table(
                        Table::alter()
                            .table(ServiceStreams::Table)
                            .drop_column(ServiceStreams::SetId)
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
    SetId,
}
