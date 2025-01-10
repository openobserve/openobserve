use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ANNOTATIONS_DASHBOARD_ID_IDX: &str = "annotations_dashboard_id_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        manager
            .create_index(create_index_dashboard_id_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(ANNOTATIONS_DASHBOARD_ID_IDX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Annotations::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(Annotations::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(Annotations::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(Annotations::DashboardId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Annotations::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Annotations::StartTime)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(Annotations::EndTime).big_integer().null())
        .col(
            ColumnDef::new(Annotations::Title)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(Annotations::Text).text().null())
        .col(ColumnDef::new(Annotations::Tags).string_len(512).not_null())
        .col(ColumnDef::new(Annotations::Panels).string_len(512).null())
        .col(
            ColumnDef::new(Annotations::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Statement to create index on dashboard_id.
fn create_index_dashboard_id_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANNOTATIONS_DASHBOARD_ID_IDX)
        .table(Annotations::Table)
        .col(Annotations::DashboardId)
        .to_owned()
}

#[derive(DeriveIden)]
enum Annotations {
    Table,
    Id,
    DashboardId,
    OrgId,
    StartTime,
    EndTime,
    Title,
    Text,
    Tags,
    Panels,
    CreatedAt,
}
