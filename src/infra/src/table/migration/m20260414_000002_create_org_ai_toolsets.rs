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

//! Creates the `org_ai_toolsets` table.
//!
//! Stores AI integration configs (MCP servers, CLI tools, skills, generic) per
//! org. The `data` column holds a kind-specific JSON payload encrypted at rest
//! with the org's per-org DEK (envelope encryption).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ORG_AI_TOOLSETS_ORG_NAME_UNIQ_IDX: &str = "org_ai_toolsets_org_name_uniq_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_org_ai_toolsets_table_stmt())
            .await?;
        manager
            .create_index(create_org_name_unique_idx_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ORG_AI_TOOLSETS_ORG_NAME_UNIQ_IDX)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(OrgAiToolsets::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_org_ai_toolsets_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(OrgAiToolsets::Table)
        .if_not_exists()
        // 27-character human-readable KSUID primary key.
        .col(
            ColumnDef::new(OrgAiToolsets::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(OrgAiToolsets::Org).string_len(100).not_null())
        .col(
            ColumnDef::new(OrgAiToolsets::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgAiToolsets::Kind)
                .string_len(50)
                .not_null(),
        )
        .col(ColumnDef::new(OrgAiToolsets::Description).text())
        // Plaintext: kind-specific JSON object.
        // Encrypted at rest: base64(ciphertext). TEXT because base64 is not valid JSON.
        .col(ColumnDef::new(OrgAiToolsets::Data).text())
        .col(
            ColumnDef::new(OrgAiToolsets::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgAiToolsets::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgAiToolsets::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_org_name_unique_idx_stmt() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ORG_AI_TOOLSETS_ORG_NAME_UNIQ_IDX)
        .table(OrgAiToolsets::Table)
        .col(OrgAiToolsets::Org)
        .col(OrgAiToolsets::Name)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum OrgAiToolsets {
    Table,
    Id,
    Org,
    Name,
    Kind,
    Description,
    Data,
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
            &create_org_ai_toolsets_table_stmt().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "org_ai_toolsets" (
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "name" varchar(256) NOT NULL,
                "kind" varchar(50) NOT NULL,
                "description" text,
                "data" text,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        assert_eq!(
            &create_org_name_unique_idx_stmt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "org_ai_toolsets_org_name_uniq_idx" ON "org_ai_toolsets" ("org", "name")"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_org_ai_toolsets_table_stmt().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "org_ai_toolsets" (
                "id" char(27) NOT NULL PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "name" varchar(256) NOT NULL,
                "kind" varchar(50) NOT NULL,
                "description" text,
                "data" text,
                "created_by" varchar(256) NOT NULL,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        assert_eq!(
            &create_org_name_unique_idx_stmt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "org_ai_toolsets_org_name_uniq_idx" ON "org_ai_toolsets" ("org", "name")"#
        );
    }
}
