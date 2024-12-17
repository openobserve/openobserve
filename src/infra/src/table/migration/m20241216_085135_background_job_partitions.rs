use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(BackgroundJobPartitions::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(BackgroundJobPartitions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(BackgroundJobPartitions::JobId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobPartitions::PartitionId)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobPartitions::StartTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobPartitions::EndTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobPartitions::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(BackgroundJobPartitions::StartedAt).big_integer())
        .col(ColumnDef::new(BackgroundJobPartitions::EndedAt).big_integer())
        .col(
            ColumnDef::new(BackgroundJobPartitions::Status)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(BackgroundJobPartitions::ResultPath).string_len(512))
        .col(ColumnDef::new(BackgroundJobPartitions::ErrorMessage).text())
        .primary_key(
            Index::create()
                .name("pk_background_job_partitions")
                .col(BackgroundJobPartitions::JobId)
                .col(BackgroundJobPartitions::PartitionId),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum BackgroundJobPartitions {
    Table,
    JobId,
    PartitionId,
    StartTime,
    EndTime,
    CreatedAt,
    StartedAt,
    EndedAt,
    Status,
    ResultPath,
    ErrorMessage,
}
