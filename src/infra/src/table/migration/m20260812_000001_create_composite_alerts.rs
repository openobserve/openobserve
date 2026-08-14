// Copyright 2026 OpenObserve Inc.

//! Composite-alert definitions and the derived child index.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(composites_statement()).await?;
        for index in composite_indexes() {
            manager.create_index(index).await?;
        }
        manager.create_table(children_statement()).await?;
        manager.create_index(reverse_index_statement()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertCompositeChildren::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(AlertComposites::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

pub(super) fn composites_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertComposites::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertComposites::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertComposites::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertComposites::FolderId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertComposites::Name)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(AlertComposites::Description).text().null())
        .col(
            ColumnDef::new(AlertComposites::Expression)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertComposites::WarningCountsAsFiring)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(AlertComposites::StaleChildPolicy)
                .small_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AlertComposites::Destinations)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertComposites::Template)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(AlertComposites::ContextAttributes)
                .json()
                .null(),
        )
        .col(
            ColumnDef::new(AlertComposites::Enabled)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(AlertComposites::SilenceSeconds)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AlertComposites::CreatesIncident)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(ColumnDef::new(AlertComposites::Workflows).json().not_null())
        .col(ColumnDef::new(AlertComposites::Priority).integer().null())
        .col(ColumnDef::new(AlertComposites::Tags).json().null())
        .col(
            ColumnDef::new(AlertComposites::Owner)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(AlertComposites::LastEditedBy)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(AlertComposites::UpdatedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertComposites::EvaluationGeneration)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

pub(super) fn children_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertCompositeChildren::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertCompositeChildren::CompositeId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertCompositeChildren::ChildAlertId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertCompositeChildren::ChildKind)
                .small_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertCompositeChildren::DisplayOrder)
                .integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AlertCompositeChildren::CompositeId)
                .col(AlertCompositeChildren::ChildAlertId),
        )
        .foreign_key(
            ForeignKey::create()
                .from(
                    AlertCompositeChildren::Table,
                    AlertCompositeChildren::CompositeId,
                )
                .to(AlertComposites::Table, AlertComposites::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

pub(super) fn composite_indexes() -> [IndexCreateStatement; 3] {
    [
        Index::create()
            .name("idx_alert_composites_org_folder")
            .table(AlertComposites::Table)
            .col(AlertComposites::Org)
            .col(AlertComposites::FolderId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_alert_composites_org_name")
            .table(AlertComposites::Table)
            .col(AlertComposites::Org)
            .col(AlertComposites::Name)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("idx_alert_composites_org_enabled")
            .table(AlertComposites::Table)
            .col(AlertComposites::Org)
            .col(AlertComposites::Enabled)
            .if_not_exists()
            .to_owned(),
    ]
}

pub(super) fn reverse_index_statement() -> IndexCreateStatement {
    Index::create()
        .name("idx_alert_composite_children_reverse")
        .table(AlertCompositeChildren::Table)
        .col(AlertCompositeChildren::ChildKind)
        .col(AlertCompositeChildren::ChildAlertId)
        .if_not_exists()
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertComposites {
    Table,
    Id,
    Org,
    FolderId,
    Name,
    Description,
    Expression,
    WarningCountsAsFiring,
    StaleChildPolicy,
    Destinations,
    Template,
    ContextAttributes,
    Enabled,
    SilenceSeconds,
    CreatesIncident,
    Workflows,
    Priority,
    Tags,
    Owner,
    LastEditedBy,
    UpdatedAt,
    EvaluationGeneration,
}

#[derive(DeriveIden)]
enum AlertCompositeChildren {
    Table,
    CompositeId,
    ChildAlertId,
    ChildKind,
    DisplayOrder,
}
