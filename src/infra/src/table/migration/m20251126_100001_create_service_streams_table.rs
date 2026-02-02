use sea_orm_migration::prelude::*;

use crate::table::migration::get_text_type;

const SERVICE_STREAMS_ORG_SERVICE_KEY_IDX: &str = "service_streams_org_service_key_idx";
const SERVICE_STREAMS_ORG_SERVICE_NAME_IDX: &str = "service_streams_org_service_name_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_service_streams_table_statement())
            .await?;
        manager
            .create_index(create_service_streams_org_service_key_idx_stmnt())
            .await?;
        manager
            .create_index(create_service_streams_org_service_name_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SERVICE_STREAMS_ORG_SERVICE_NAME_IDX)
                    .table(ServiceStreams::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(SERVICE_STREAMS_ORG_SERVICE_KEY_IDX)
                    .table(ServiceStreams::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(ServiceStreams::Table).to_owned())
            .await
    }
}

fn create_service_streams_table_statement() -> TableCreateStatement {
    let text_type = get_text_type();
    Table::create()
        .table(ServiceStreams::Table)
        .if_not_exists()
        // The ID is 27-character human readable KSUID.
        .col(
            ColumnDef::new(ServiceStreams::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(ServiceStreams::OrgId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::ServiceKey)
                .string_len(512)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::CorrelationKey)
                .string_len(64)
                .not_null()
                .default(""),
        )
        .col(
            ColumnDef::new(ServiceStreams::ServiceName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::Dimensions)
                .custom(Alias::new(text_type))
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::Streams)
                .custom(Alias::new(text_type))
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::FirstSeen)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::LastSeen)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceStreams::Metadata)
                .custom(Alias::new(text_type))
                .null(),
        )
        .to_owned()
}

fn create_service_streams_org_service_key_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SERVICE_STREAMS_ORG_SERVICE_KEY_IDX)
        .table(ServiceStreams::Table)
        .col(ServiceStreams::OrgId)
        .col(ServiceStreams::ServiceKey)
        .unique()
        .to_owned()
}

fn create_service_streams_org_service_name_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SERVICE_STREAMS_ORG_SERVICE_NAME_IDX)
        .table(ServiceStreams::Table)
        .col(ServiceStreams::OrgId)
        .col(ServiceStreams::ServiceName)
        .to_owned()
}

#[derive(DeriveIden)]
enum ServiceStreams {
    Table,
    Id,
    OrgId,
    ServiceKey,
    CorrelationKey,
    ServiceName,
    Dimensions,
    Streams,
    FirstSeen,
    LastSeen,
    Metadata,
}
