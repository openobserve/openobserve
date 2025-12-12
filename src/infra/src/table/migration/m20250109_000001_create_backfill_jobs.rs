use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        manager
            .create_index(create_backfill_jobs_org_idx_stmnt())
            .await?;
        manager
            .create_index(create_backfill_jobs_pipeline_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(BACKFILL_JOBS_PIPELINE_IDX)
                    .table(BackfillJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(BACKFILL_JOBS_ORG_IDX)
                    .table(BackfillJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(BackfillJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(BackfillJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(BackfillJobs::Id)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(BackfillJobs::Org).string_len(100).not_null())
        .col(
            ColumnDef::new(BackfillJobs::PipelineId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(BackfillJobs::StartTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackfillJobs::EndTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackfillJobs::ChunkPeriodMinutes)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(BackfillJobs::DelayBetweenChunksSecs)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(BackfillJobs::DeleteBeforeBackfill)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(BackfillJobs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

const BACKFILL_JOBS_ORG_IDX: &str = "backfill_jobs_org_idx";

/// Statement to create index on org.
fn create_backfill_jobs_org_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(BACKFILL_JOBS_ORG_IDX)
        .table(BackfillJobs::Table)
        .col(BackfillJobs::Org)
        .to_owned()
}

const BACKFILL_JOBS_PIPELINE_IDX: &str = "backfill_jobs_pipeline_idx";

/// Statement to create index on pipeline_id.
fn create_backfill_jobs_pipeline_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(BACKFILL_JOBS_PIPELINE_IDX)
        .table(BackfillJobs::Table)
        .col(BackfillJobs::PipelineId)
        .to_owned()
}

#[derive(DeriveIden)]
enum BackfillJobs {
    Table,
    Id,
    Org,
    PipelineId,
    StartTime,
    EndTime,
    ChunkPeriodMinutes,
    DelayBetweenChunksSecs,
    DeleteBeforeBackfill,
    CreatedAt,
}
