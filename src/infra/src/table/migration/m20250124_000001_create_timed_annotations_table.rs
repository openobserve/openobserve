use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ANNOTATIONS_DASHBOARD_ID_IDX: &str = "timed_annotations_dashboard_id_idx";
const TIMED_ANNOTATIONS_DASHBOARDS_FK: &str = "fk_timed_annotation_panels_dashboard_id";

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
            .drop_table(Table::drop().table(TimedAnnotations::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(TimedAnnotations::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(TimedAnnotations::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(TimedAnnotations::DashboardId)
                .char_len(27)
                .not_null()
        )
        .col(
            ColumnDef::new(TimedAnnotations::StartTime)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(TimedAnnotations::EndTime)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(TimedAnnotations::Title)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(TimedAnnotations::Text).text().null())
        .col(
            ColumnDef::new(TimedAnnotations::Tags)
                .json()
                .not_null()
        )
        .col(
            ColumnDef::new(TimedAnnotations::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            sea_query::ForeignKey::create()
                    .name(TIMED_ANNOTATIONS_DASHBOARDS_FK)
                    .from(TimedAnnotations::Table, TimedAnnotations::DashboardId)
                    .to(Dashboards::Table, Dashboards::Id)
                    .on_delete(ForeignKeyAction::Cascade)
        )
        .to_owned()
}

/// Statement to create index on dashboard_id.
fn create_index_dashboard_id_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ANNOTATIONS_DASHBOARD_ID_IDX)
        .table(TimedAnnotations::Table)
        .col(TimedAnnotations::DashboardId)
        .to_owned()
}

#[derive(DeriveIden)]
enum TimedAnnotations {
    Table,
    Id,
    DashboardId,
    StartTime,
    EndTime,
    Title,
    Text,
    Tags,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Dashboards {
    Table,
    Id,
}
