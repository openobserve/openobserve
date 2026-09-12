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

const ORG_INGESTION_TOKENS_SPLUNK_TOKEN_UQ: &str = "org_ingestion_tokens_splunk_token_uq";

#[derive(DeriveIden)]
enum OrgIngestionTokens {
    Table,
    SplunkToken,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.alter_table(add_splunk_token_statement()).await?;
        manager.create_index(create_splunk_token_uq_stmnt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ORG_INGESTION_TOKENS_SPLUNK_TOKEN_UQ)
                    .table(OrgIngestionTokens::Table)
                    .to_owned(),
            )
            .await?;
        manager.alter_table(drop_splunk_token_statement()).await?;
        Ok(())
    }
}

fn add_splunk_token_statement() -> TableAlterStatement {
    Table::alter()
        .table(OrgIngestionTokens::Table)
        .add_column_if_not_exists(
            ColumnDef::new(OrgIngestionTokens::SplunkToken)
                .string_len(36)
                .null(),
        )
        .to_owned()
}

fn drop_splunk_token_statement() -> TableAlterStatement {
    Table::alter()
        .table(OrgIngestionTokens::Table)
        .drop_column(OrgIngestionTokens::SplunkToken)
        .to_owned()
}

fn create_splunk_token_uq_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ORG_INGESTION_TOKENS_SPLUNK_TOKEN_UQ)
        .table(OrgIngestionTokens::Table)
        .col(OrgIngestionTokens::SplunkToken)
        .unique()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_splunk_token_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "org_ingestion_tokens" ADD COLUMN IF NOT EXISTS "splunk_token" varchar(36) NULL"#
        );
        assert_eq!(
            &create_splunk_token_uq_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "org_ingestion_tokens_splunk_token_uq" ON "org_ingestion_tokens" ("splunk_token")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_splunk_token_statement().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "org_ingestion_tokens" ADD COLUMN "splunk_token" varchar(36) NULL"#
        );
        assert_eq!(
            &create_splunk_token_uq_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "org_ingestion_tokens_splunk_token_uq" ON "org_ingestion_tokens" ("splunk_token")"#
        );
    }
}
