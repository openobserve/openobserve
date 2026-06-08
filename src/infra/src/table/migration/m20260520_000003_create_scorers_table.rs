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
            .create_table(create_scorers_table_statement())
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_scorers_org")
                    .table(Scorers::Table)
                    .col(Scorers::OrgId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_scorers_org_entity")
                    .table(Scorers::Table)
                    .col(Scorers::OrgId)
                    .col(Scorers::EntityId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_scorers_org_name")
                    .table(Scorers::Table)
                    .col(Scorers::OrgId)
                    .col(Scorers::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_scorers_type")
                    .table(Scorers::Table)
                    .col(Scorers::ScorerType)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_scorers_active")
                    .table(Scorers::Table)
                    .col(Scorers::IsActive)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_scorers_produces_score_config")
                    .table(Scorers::Table)
                    .col(Scorers::ProducesScoreConfigId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Scorers::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_scorers_table_statement() -> TableCreateStatement {
    Table::create()
        .table(Scorers::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(Scorers::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(Scorers::OrgId).string_len(256).not_null())
        .col(ColumnDef::new(Scorers::EntityId).string_len(27).not_null())
        .col(ColumnDef::new(Scorers::Name).string_len(255).not_null())
        .col(
            ColumnDef::new(Scorers::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(Scorers::ScorerType)
                .string_len(50)
                .not_null(),
        )
        .col(ColumnDef::new(Scorers::Description).text().null())
        .col(
            ColumnDef::new(Scorers::ProducesScoreConfigId)
                .string_len(27)
                .null(),
        )
        .col(
            ColumnDef::new(Scorers::ProducesScoreConfigVersion)
                .integer()
                .null(),
        )
        .col(ColumnDef::new(Scorers::Template).text().not_null())
        .col(ColumnDef::new(Scorers::OutputSchema).json().null())
        .col(ColumnDef::new(Scorers::Params).json().not_null())
        .col(
            ColumnDef::new(Scorers::IsActive)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(ColumnDef::new(Scorers::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(Scorers::UpdatedAt).big_integer().not_null())
        .to_owned()
}

#[derive(DeriveIden)]
enum Scorers {
    Table,
    Id,
    OrgId,
    EntityId,
    Name,
    Version,
    ScorerType,
    Description,
    ProducesScoreConfigId,
    ProducesScoreConfigVersion,
    Template,
    OutputSchema,
    Params,
    IsActive,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_scorers_table_contains_table_name() {
        let sql = create_scorers_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("scorers"));
    }

    #[test]
    fn test_create_scorers_table_contains_if_not_exists() {
        let sql = create_scorers_table_statement().build(SqliteQueryBuilder);
        assert!(sql.to_uppercase().contains("IF NOT EXISTS"));
    }
}
