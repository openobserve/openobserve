use sea_orm_migration::prelude::*;

const SERVICE_STREAMS_DIMENSIONS_ORG_DIMENSION_VALUE_HASH_IDX: &str =
    "service_streams_dimensions_org_dimension_value_hash_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_service_streams_dimensions_table_statement())
            .await?;
        manager
            .create_index(create_service_streams_dimensions_org_dimension_value_hash_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SERVICE_STREAMS_DIMENSIONS_ORG_DIMENSION_VALUE_HASH_IDX)
                    .table(ServiceStreamsDimensions::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(ServiceStreamsDimensions::Table)
                    .to_owned(),
            )
            .await
    }
}

fn create_service_streams_dimensions_table_statement() -> TableCreateStatement {
    Table::create()
        .table(ServiceStreamsDimensions::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(ServiceStreamsDimensions::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(ServiceStreamsDimensions::OrgId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreamsDimensions::DimensionName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreamsDimensions::ValueHash)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreamsDimensions::DimensionValue)
                .string_len(512)
                .not_null(),
        )
        .to_owned()
}

fn create_service_streams_dimensions_org_dimension_value_hash_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SERVICE_STREAMS_DIMENSIONS_ORG_DIMENSION_VALUE_HASH_IDX)
        .table(ServiceStreamsDimensions::Table)
        .col(ServiceStreamsDimensions::OrgId)
        .col(ServiceStreamsDimensions::DimensionName)
        .col(ServiceStreamsDimensions::ValueHash)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum ServiceStreamsDimensions {
    Table,
    Id,
    OrgId,
    DimensionName,
    ValueHash,
    DimensionValue,
}
