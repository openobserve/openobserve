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

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_score_configs_table_statement())
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_score_configs_org")
                    .table(ScoreConfigs::Table)
                    .col(ScoreConfigs::OrgId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_score_configs_org_entity")
                    .table(ScoreConfigs::Table)
                    .col(ScoreConfigs::OrgId)
                    .col(ScoreConfigs::EntityId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_score_configs_org_name")
                    .table(ScoreConfigs::Table)
                    .col(ScoreConfigs::OrgId)
                    .col(ScoreConfigs::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_score_configs_data_type")
                    .table(ScoreConfigs::Table)
                    .col(ScoreConfigs::DataType)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_score_configs_active")
                    .table(ScoreConfigs::Table)
                    .col(ScoreConfigs::IsActive)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ScoreConfigs::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_score_configs_table_statement() -> TableCreateStatement {
    Table::create()
        .table(ScoreConfigs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(ScoreConfigs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(ScoreConfigs::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(ScoreConfigs::EntityId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(ScoreConfigs::Name)
                .string_len(255)
                .not_null(),
        )
        .col(
            ColumnDef::new(ScoreConfigs::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(ScoreConfigs::DataType)
                .string_len(50)
                .not_null(),
        )
        .col(ColumnDef::new(ScoreConfigs::Description).text().null())
        .col(ColumnDef::new(ScoreConfigs::NumericRange).json().null())
        .col(ColumnDef::new(ScoreConfigs::Categories).json().null())
        .col(ColumnDef::new(ScoreConfigs::HealthyThreshold).json().null())
        .col(
            ColumnDef::new(ScoreConfigs::IsActive)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(ScoreConfigs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(ScoreConfigs::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum ScoreConfigs {
    Table,
    Id,
    OrgId,
    EntityId,
    Name,
    Version,
    DataType,
    Description,
    NumericRange,
    Categories,
    HealthyThreshold,
    IsActive,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_score_configs_table_contains_table_name() {
        let sql = create_score_configs_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("score_configs"));
    }

    #[test]
    fn test_create_score_configs_table_contains_if_not_exists() {
        let sql = create_score_configs_table_statement().build(SqliteQueryBuilder);
        assert!(sql.to_uppercase().contains("IF NOT EXISTS"));
    }
}
