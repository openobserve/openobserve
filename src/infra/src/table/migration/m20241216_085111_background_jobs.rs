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
            .drop_table(Table::drop().table(BackgroundJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(BackgroundJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(BackgroundJobs::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::TraceId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::UserId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::StreamType)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(BackgroundJobs::Payload).text().not_null())
        .col(
            ColumnDef::new(BackgroundJobs::StartTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::EndTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobs::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(BackgroundJobs::StartedAt).big_integer())
        .col(ColumnDef::new(BackgroundJobs::EndedAt).big_integer())
        .col(ColumnDef::new(BackgroundJobs::Node).string_len(256))
        .col(ColumnDef::new(BackgroundJobs::Status).integer().not_null())
        .col(ColumnDef::new(BackgroundJobs::ResultPath).string_len(512))
        .col(ColumnDef::new(BackgroundJobs::ErrorMessage).text())
        .col(ColumnDef::new(BackgroundJobs::PartitionNum).integer())
        .to_owned()
}

#[derive(DeriveIden)]
enum BackgroundJobs {
    Table,
    Id,
    TraceId,
    OrgId,
    UserId,
    StreamType,
    Payload,
    StartTime,
    EndTime,
    CreatedAt,
    UpdatedAt,
    StartedAt,
    EndedAt,
    Node,
    Status,
    ResultPath,
    ErrorMessage,
    PartitionNum,
}
