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
            .create_table(create_online_eval_jobs_table_statement())
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_online_eval_jobs_org")
                    .table(OnlineEvalJobs::Table)
                    .col(OnlineEvalJobs::OrgId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_online_eval_jobs_status")
                    .table(OnlineEvalJobs::Table)
                    .col(OnlineEvalJobs::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_online_eval_jobs_stream")
                    .table(OnlineEvalJobs::Table)
                    .col(OnlineEvalJobs::OrgId)
                    .col(OnlineEvalJobs::Stream)
                    .col(OnlineEvalJobs::StreamType)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_online_eval_jobs_pipeline")
                    .table(OnlineEvalJobs::Table)
                    .col(OnlineEvalJobs::PipelineId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OnlineEvalJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_online_eval_jobs_table_statement() -> TableCreateStatement {
    Table::create()
        .table(OnlineEvalJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OnlineEvalJobs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::Name)
                .string_len(255)
                .not_null(),
        )
        .col(ColumnDef::new(OnlineEvalJobs::Description).text().null())
        .col(
            ColumnDef::new(OnlineEvalJobs::Stream)
                .string_len(255)
                .not_null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::StreamType)
                .string_len(50)
                .not_null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::FilterCondition)
                .json()
                .not_null(),
        )
        .col(ColumnDef::new(OnlineEvalJobs::Scorers).json().not_null())
        .col(ColumnDef::new(OnlineEvalJobs::InputMapping).json().null())
        .col(
            ColumnDef::new(OnlineEvalJobs::SamplingMode)
                .string_len(50)
                .not_null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::SamplingValue)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::Status)
                .string_len(50)
                .not_null()
                .default("draft"),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::Version)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::PipelineId)
                .string_len(27)
                .null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OnlineEvalJobs::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum OnlineEvalJobs {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    Stream,
    StreamType,
    FilterCondition,
    Scorers,
    InputMapping,
    SamplingMode,
    SamplingValue,
    Status,
    Version,
    PipelineId,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_online_eval_jobs_table_contains_table_name() {
        let sql = create_online_eval_jobs_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("online_eval_jobs"));
    }

    #[test]
    fn test_create_online_eval_jobs_table_contains_if_not_exists() {
        let sql = create_online_eval_jobs_table_statement().build(SqliteQueryBuilder);
        assert!(sql.to_uppercase().contains("IF NOT EXISTS"));
    }
}
