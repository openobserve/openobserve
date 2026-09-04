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
        for statement in add_column_statements() {
            manager.alter_table(statement).await?;
        }

        manager
            .create_index(
                Index::create()
                    .name("idx_online_eval_jobs_scope_stream")
                    .table(OnlineEvalJobs::Table)
                    .col(OnlineEvalJobs::OrgId)
                    .col(OnlineEvalJobs::TargetScope)
                    .col(OnlineEvalJobs::Status)
                    .col(OnlineEvalJobs::Stream)
                    .col(OnlineEvalJobs::StreamType)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing additive eval-job contract columns is not supported.
        Ok(())
    }
}

fn add_column_statements() -> Vec<TableAlterStatement> {
    vec![
        Table::alter()
            .table(OnlineEvalJobs::Table)
            .add_column_if_not_exists(
                ColumnDef::new(OnlineEvalJobs::TargetScope)
                    .string_len(50)
                    .not_null()
                    .default("span"),
            )
            .to_owned(),
        Table::alter()
            .table(OnlineEvalJobs::Table)
            .add_column_if_not_exists(ColumnDef::new(OnlineEvalJobs::TraceConfig).json().null())
            .to_owned(),
        Table::alter()
            .table(OnlineEvalJobs::Table)
            .add_column_if_not_exists(ColumnDef::new(OnlineEvalJobs::SessionConfig).json().null())
            .to_owned(),
        Table::alter()
            .table(OnlineEvalJobs::Table)
            .add_column_if_not_exists(ColumnDef::new(OnlineEvalJobs::SpanSelectors).json().null())
            .to_owned(),
        Table::alter()
            .table(OnlineEvalJobs::Table)
            .add_column_if_not_exists(
                ColumnDef::new(OnlineEvalJobs::SpanSelectorBindings)
                    .json()
                    .null(),
            )
            .to_owned(),
    ]
}

#[derive(DeriveIden)]
enum OnlineEvalJobs {
    Table,
    OrgId,
    Stream,
    StreamType,
    Status,
    TargetScope,
    TraceConfig,
    SessionConfig,
    SpanSelectors,
    SpanSelectorBindings,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260710_000001_add_target_scope_to_online_eval_jobs"
        );
    }

    #[test]
    fn test_add_column_statements_support_sqlite() {
        let statements = add_column_statements();
        assert_eq!(statements.len(), 5);

        for statement in statements {
            statement.build(SqliteQueryBuilder);
        }
    }
}
