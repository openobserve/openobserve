use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const TIMED_ANNOTATION_PANELS_ANNOTATION_ID_IDX: &str = "timed_annotation_panels_annotation_id_idx";
const TIMED_ANNOTATION_PANELS_ANNOTATION_ID_PANEL_ID_IDX: &str =
    "timed_annotation_panels_annotation_id_panel_id_idx";
const TIMED_ANNOTATION_PANELS_ANNOTATION_ID_FK: &str = "fk_timed_annotation_panels_annotation_id";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        manager
            .create_index(create_index_annotation_id_stmt())
            .await?;
        manager
            .create_index(create_unique_index_composite_key_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(TIMED_ANNOTATION_PANELS_ANNOTATION_ID_IDX)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(TIMED_ANNOTATION_PANELS_ANNOTATION_ID_PANEL_ID_IDX)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(TimedAnnotationPanels::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the annotation_panels table
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(TimedAnnotationPanels::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(TimedAnnotationPanels::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(TimedAnnotationPanels::TimedAnnotationId)
                .char_len(27)
                .not_null()
        )
        .col(
            ColumnDef::new(TimedAnnotationPanels::PanelId)
                .string_len(256)
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name(TIMED_ANNOTATION_PANELS_ANNOTATION_ID_FK)
                .from(TimedAnnotationPanels::Table, TimedAnnotationPanels::TimedAnnotationId)
                .to(TimedAnnotations::Table, TimedAnnotations::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

/// Statement to create an index on annotation_id
fn create_index_annotation_id_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(TIMED_ANNOTATION_PANELS_ANNOTATION_ID_IDX)
        .table(TimedAnnotationPanels::Table)
        .col(TimedAnnotationPanels::TimedAnnotationId)
        .to_owned()
}

/// Statement to create a unique index on composite key (timed_annotation_id, panel_id)
fn create_unique_index_composite_key_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(TIMED_ANNOTATION_PANELS_ANNOTATION_ID_PANEL_ID_IDX)
        .table(TimedAnnotationPanels::Table)
        .col(TimedAnnotationPanels::TimedAnnotationId)
        .col(TimedAnnotationPanels::PanelId)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum TimedAnnotationPanels {
    Table,
    Id,
    TimedAnnotationId,
    PanelId,
}

#[derive(DeriveIden)]
enum TimedAnnotations {
    Table,
    Id,
}
