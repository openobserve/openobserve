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
            .drop_table(Table::drop().table(BackgroundJobResults::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(BackgroundJobResults::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(BackgroundJobResults::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(BackgroundJobResults::JobId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(BackgroundJobResults::TraceId)
                .string_len(64)
                .not_null(),
        )
        .col(ColumnDef::new(BackgroundJobResults::StartedAt).big_integer())
        .col(ColumnDef::new(BackgroundJobResults::EndedAt).big_integer())
        .col(ColumnDef::new(BackgroundJobResults::ResultPath).string_len(512))
        .col(ColumnDef::new(BackgroundJobResults::ErrorMessage).text())
        .to_owned()
}

#[derive(DeriveIden)]
enum BackgroundJobResults {
    Table,
    Id,
    JobId,
    TraceId,
    StartedAt,
    EndedAt,
    ResultPath,
    ErrorMessage,
}
