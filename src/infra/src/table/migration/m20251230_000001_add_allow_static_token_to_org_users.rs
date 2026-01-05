// Copyright 2025 OpenObserve Inc.
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

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Use add_column_if_not_exists for non-MySQL databases
        // For MySQL, catch and ignore "Duplicate column" errors for idempotency
        if matches!(manager.get_database_backend(), sea_orm::DbBackend::MySql) {
            let result = manager
                .alter_table(
                    Table::alter()
                        .table(OrgUsers::Table)
                        .add_column(
                            ColumnDef::new(OrgUsers::AllowStaticToken)
                                .boolean()
                                .not_null()
                                .default(true),
                        )
                        .to_owned(),
                )
                .await;

            // Ignore "Duplicate column" error for idempotency (test retries)
            if let Err(e) = result {
                let err_msg = e.to_string();
                if !err_msg.contains("Duplicate column") {
                    return Err(e);
                }
            }
            Ok(())
        } else {
            manager
                .alter_table(
                    Table::alter()
                        .table(OrgUsers::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(OrgUsers::AllowStaticToken)
                                .boolean()
                                .not_null()
                                .default(true),
                        )
                        .to_owned(),
                )
                .await
        }
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(OrgUsers::Table)
                    .drop_column(OrgUsers::AllowStaticToken)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OrgUsers {
    Table,
    AllowStaticToken,
}
