use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        manager
            .create_index(create_compactor_manual_jobs_key_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(COMPACTOR_MANUAL_JOBS_KEY_IDX)
                    .table(CompactorManualJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(CompactorManualJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(CompactorManualJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(CompactorManualJobs::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(CompactorManualJobs::Key)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(CompactorManualJobs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(CompactorManualJobs::EndedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(CompactorManualJobs::Status)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

const COMPACTOR_MANUAL_JOBS_KEY_IDX: &str = "compactor_manual_jobs_key_idx";

/// Statement to create index on key.
fn create_compactor_manual_jobs_key_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(COMPACTOR_MANUAL_JOBS_KEY_IDX)
        .table(CompactorManualJobs::Table)
        .col(CompactorManualJobs::Key)
        .to_owned()
}

#[derive(DeriveIden)]
enum CompactorManualJobs {
    Table,
    Id,
    Key,
    CreatedAt,
    EndedAt,
    Status,
}
