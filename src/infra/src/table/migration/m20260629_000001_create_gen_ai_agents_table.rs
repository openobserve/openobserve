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
            .create_table(create_gen_ai_agents_table_statement())
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_gen_ai_agents_org_last_seen")
                    .if_not_exists()
                    .table(GenAiAgents::Table)
                    .col(GenAiAgents::OrgId)
                    .col(GenAiAgents::LastSeen)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_gen_ai_agents_org_stream")
                    .if_not_exists()
                    .table(GenAiAgents::Table)
                    .col(GenAiAgents::OrgId)
                    .col(GenAiAgents::StreamType)
                    .col(GenAiAgents::StreamName)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(GenAiAgents::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_gen_ai_agents_table_statement() -> TableCreateStatement {
    Table::create()
        .table(GenAiAgents::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(GenAiAgents::AgentKey)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(GenAiAgents::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(GenAiAgents::StreamType)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(GenAiAgents::StreamName)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(GenAiAgents::AgentId).text().null())
        .col(ColumnDef::new(GenAiAgents::AgentName).text().null())
        .col(
            ColumnDef::new(GenAiAgents::IdentitySource)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(GenAiAgents::FirstSeen)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(GenAiAgents::LastSeen)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(GenAiAgents::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(GenAiAgents::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum GenAiAgents {
    Table,
    AgentKey,
    OrgId,
    StreamType,
    StreamName,
    AgentId,
    AgentName,
    IdentitySource,
    FirstSeen,
    LastSeen,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_gen_ai_agents_table_contains_table_name() {
        let sql = create_gen_ai_agents_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("gen_ai_agents"));
    }

    #[test]
    fn test_create_gen_ai_agents_table_contains_primary_key() {
        let sql = create_gen_ai_agents_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("agent_key"));
        assert!(sql.to_uppercase().contains("PRIMARY KEY"));
    }
}
