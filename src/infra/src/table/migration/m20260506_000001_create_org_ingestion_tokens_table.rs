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

const ORG_INGESTION_TOKENS_ORG_ID_IDX: &str = "org_ingestion_tokens_org_id_idx";
const ORG_INGESTION_TOKENS_TOKEN_IDX: &str = "org_ingestion_tokens_token_idx";
const ORG_INGESTION_TOKENS_ORG_NAME_UQ: &str = "org_ingestion_tokens_org_name_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_org_ingestion_tokens_table_statement())
            .await?;
        manager
            .create_index(create_org_id_idx_stmnt())
            .await?;
        manager
            .create_index(create_token_idx_stmnt())
            .await?;
        manager
            .create_index(create_org_name_uq_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ORG_INGESTION_TOKENS_ORG_NAME_UQ)
                    .table(OrgIngestionTokens::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ORG_INGESTION_TOKENS_TOKEN_IDX)
                    .table(OrgIngestionTokens::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ORG_INGESTION_TOKENS_ORG_ID_IDX)
                    .table(OrgIngestionTokens::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OrgIngestionTokens::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn create_org_ingestion_tokens_table_statement() -> TableCreateStatement {
    Table::create()
        .table(OrgIngestionTokens::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgIngestionTokens::Id)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OrgIngestionTokens::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgIngestionTokens::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgIngestionTokens::Token)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(OrgIngestionTokens::Description).text())
        .col(
            ColumnDef::new(OrgIngestionTokens::IsDefault)
                .boolean()
                .not_null()
                .default(SimpleExpr::Value(Value::Bool(Some(false)))),
        )
        .col(
            ColumnDef::new(OrgIngestionTokens::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgIngestionTokens::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgIngestionTokens::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_org_id_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ORG_INGESTION_TOKENS_ORG_ID_IDX)
        .table(OrgIngestionTokens::Table)
        .col(OrgIngestionTokens::OrgId)
        .to_owned()
}

fn create_token_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ORG_INGESTION_TOKENS_TOKEN_IDX)
        .table(OrgIngestionTokens::Table)
        .col(OrgIngestionTokens::Token)
        .to_owned()
}

fn create_org_name_uq_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ORG_INGESTION_TOKENS_ORG_NAME_UQ)
        .table(OrgIngestionTokens::Table)
        .col(OrgIngestionTokens::OrgId)
        .col(OrgIngestionTokens::Name)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum OrgIngestionTokens {
    Table,
    Id,
    OrgId,
    Name,
    Token,
    Description,
    IsDefault,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_org_ingestion_tokens_table_statement().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "org_ingestion_tokens" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "name" varchar(256) NOT NULL,
                "token" varchar(256) NOT NULL,
                "description" text,
                "is_default" bool NOT NULL DEFAULT FALSE,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        assert_eq!(
            &create_org_id_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "org_ingestion_tokens_org_id_idx" ON "org_ingestion_tokens" ("org_id")"#
        );
        assert_eq!(
            &create_token_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "org_ingestion_tokens_token_idx" ON "org_ingestion_tokens" ("token")"#
        );
        assert_eq!(
            &create_org_name_uq_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "org_ingestion_tokens_org_name_uq" ON "org_ingestion_tokens" ("org_id", "name")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_org_ingestion_tokens_table_statement().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "org_ingestion_tokens" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "name" varchar(256) NOT NULL,
                "token" varchar(256) NOT NULL,
                "description" text,
                "is_default" boolean NOT NULL DEFAULT FALSE,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        assert_eq!(
            &create_org_id_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "org_ingestion_tokens_org_id_idx" ON "org_ingestion_tokens" ("org_id")"#
        );
        assert_eq!(
            &create_token_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "org_ingestion_tokens_token_idx" ON "org_ingestion_tokens" ("token")"#
        );
        assert_eq!(
            &create_org_name_uq_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "org_ingestion_tokens_org_name_uq" ON "org_ingestion_tokens" ("org_id", "name")"#
        );
    }
}
