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

use sea_orm::DbBackend;
use sea_orm_migration::prelude::*;

const RESOURCE_KEY_OLD: &str = "rkey_idx";
const RESOURCE_KEY_NEW: &str = "rkey_idx_with_interval";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add stat_interval_ms column with default value of 1000 (1 second)
        manager
            .alter_table(
                Table::alter()
                    .table(RateLimitRules::Table)
                    .add_column(
                        ColumnDef::new(RateLimitRules::StatIntervalMs)
                            .big_integer()
                            .not_null()
                            .default(1000),
                    )
                    .to_owned(),
            )
            .await?;

        // Drop the old unique index
        let old_index_exists = manager
            .has_index(RateLimitRules::Table.to_string().as_str(), RESOURCE_KEY_OLD)
            .await?;

        if old_index_exists {
            manager
                .drop_index(
                    Index::drop()
                        .name(RESOURCE_KEY_OLD)
                        .table(RateLimitRules::Table)
                        .to_owned(),
                )
                .await?;
        }

        // Create new unique index with stat_interval_ms included
        match manager.get_database_backend() {
            DbBackend::MySql => {
                manager
                    .create_index(create_ratelimit_resource_key_idx_stmnt_mysql())
                    .await?;
            }
            _ => {
                manager
                    .create_index(create_ratelimit_resource_key_idx_stmnt())
                    .await?;
            }
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the new unique index
        let new_index_exists = manager
            .has_index(RateLimitRules::Table.to_string().as_str(), RESOURCE_KEY_NEW)
            .await?;

        if new_index_exists {
            manager
                .drop_index(
                    Index::drop()
                        .name(RESOURCE_KEY_NEW)
                        .table(RateLimitRules::Table)
                        .to_owned(),
                )
                .await?;
        }

        // Drop stat_interval_ms column
        manager
            .alter_table(
                Table::alter()
                    .table(RateLimitRules::Table)
                    .drop_column(RateLimitRules::StatIntervalMs)
                    .to_owned(),
            )
            .await
    }
}

fn create_ratelimit_resource_key_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .name(RESOURCE_KEY_NEW)
        .table(RateLimitRules::Table)
        .col(RateLimitRules::Org)
        .col(RateLimitRules::UserRole)
        .col(RateLimitRules::UserId)
        .col(RateLimitRules::ApiGroupName)
        .col(RateLimitRules::ApiGroupOperation)
        .col(RateLimitRules::StatIntervalMs)
        .unique()
        .to_owned()
}

fn create_ratelimit_resource_key_idx_stmnt_mysql() -> IndexCreateStatement {
    sea_query::Index::create()
        .name(RESOURCE_KEY_NEW)
        .table(RateLimitRules::Table)
        .col(RateLimitRules::Org)
        .col(RateLimitRules::UserRole)
        .col(RateLimitRules::UserId)
        .col(RateLimitRules::StatIntervalMs)
        .to_owned()
}

#[derive(DeriveIden)]
enum RateLimitRules {
    Table,
    Org,
    UserRole,
    UserId,
    ApiGroupName,
    ApiGroupOperation,
    StatIntervalMs,
}
