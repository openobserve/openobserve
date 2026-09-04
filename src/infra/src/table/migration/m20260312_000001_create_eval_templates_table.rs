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
            .create_table(create_eval_templates_table_statement())
            .await?;
        // Create indexes
        manager
            .create_index(
                Index::create()
                    .name("idx_eval_templates_org")
                    .table(EvalTemplates::Table)
                    .col(EvalTemplates::OrgId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_eval_templates_response_type")
                    .table(EvalTemplates::Table)
                    .col(EvalTemplates::ResponseType)
                    .col(EvalTemplates::IsActive)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_eval_templates_version")
                    .table(EvalTemplates::Table)
                    .col(EvalTemplates::Version)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_eval_templates_created_at")
                    .table(EvalTemplates::Table)
                    .col(EvalTemplates::CreatedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(EvalTemplates::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the eval_templates table.
fn create_eval_templates_table_statement() -> TableCreateStatement {
    Table::create()
        .table(EvalTemplates::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(EvalTemplates::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(EvalTemplates::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalTemplates::ResponseType)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalTemplates::Name)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(EvalTemplates::Description).text().null())
        .col(ColumnDef::new(EvalTemplates::Content).text().not_null())
        .col(ColumnDef::new(EvalTemplates::Dimensions).json().not_null())
        .col(
            ColumnDef::new(EvalTemplates::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(EvalTemplates::IsActive)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(EvalTemplates::CreatedBy)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(EvalTemplates::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(EvalTemplates::UpdatedBy)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(EvalTemplates::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Identifiers used in queries on the eval_templates table.
#[derive(DeriveIden)]
enum EvalTemplates {
    Table,
    #[sea_orm(rename = "id")]
    Id,
    #[sea_orm(rename = "org_id")]
    OrgId,
    #[sea_orm(rename = "response_type")]
    ResponseType,
    #[sea_orm(rename = "name")]
    Name,
    #[sea_orm(rename = "description")]
    Description,
    #[sea_orm(rename = "content")]
    Content,
    #[sea_orm(rename = "dimensions")]
    Dimensions,
    #[sea_orm(rename = "version")]
    Version,
    #[sea_orm(rename = "is_active")]
    IsActive,
    #[sea_orm(rename = "created_by")]
    CreatedBy,
    #[sea_orm(rename = "created_at")]
    CreatedAt,
    #[sea_orm(rename = "updated_by")]
    UpdatedBy,
    #[sea_orm(rename = "updated_at")]
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_eval_templates_table_contains_table_name() {
        let sql = create_eval_templates_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("eval_templates"));
    }

    #[test]
    fn test_create_eval_templates_table_contains_if_not_exists() {
        let sql = create_eval_templates_table_statement().build(SqliteQueryBuilder);
        assert!(sql.to_uppercase().contains("IF NOT EXISTS"));
    }
}
