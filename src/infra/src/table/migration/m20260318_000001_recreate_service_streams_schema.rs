use sea_orm_migration::prelude::*;

const SERVICE_STREAMS_NAME_IDX: &str = "service_streams_name_idx";
const SERVICE_STREAMS_UNIQUE_IDX: &str = "service_streams_unique_idx";
const SERVICE_STREAMS_DISAMBIG_GIN_IDX: &str = "service_streams_disambig_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop old table
        manager
            .drop_table(
                Table::drop()
                    .table(ServiceStreams::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        // Create new table
        manager
            .create_table(
                Table::create()
                    .table(ServiceStreams::Table)
                    .if_not_exists()
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
                        ColumnDef::new(ServiceStreams::ServiceName)
                            .string_len(256)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ServiceStreams::Disambiguation)
                            .json_binary()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(ServiceStreams::LogsStreams)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(ServiceStreams::TracesStreams)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(ServiceStreams::MetricsStreams)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(ServiceStreams::LastSeen)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Name index
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(SERVICE_STREAMS_NAME_IDX)
                    .table(ServiceStreams::Table)
                    .col(ServiceStreams::OrgId)
                    .col(ServiceStreams::ServiceName)
                    .to_owned(),
            )
            .await?;

        // Unique index on (org_id, service_name, disambiguation)
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(SERVICE_STREAMS_UNIQUE_IDX)
                    .table(ServiceStreams::Table)
                    .col(ServiceStreams::OrgId)
                    .col(ServiceStreams::ServiceName)
                    .col(ServiceStreams::Disambiguation)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // GIN index on disambiguation (Postgres only; sea-orm doesn't support GIN natively)
        let backend = manager.get_database_backend();
        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute(sea_orm::Statement::from_string(
                    backend,
                    format!(
                        "CREATE INDEX {SERVICE_STREAMS_DISAMBIG_GIN_IDX} ON service_streams USING GIN (disambiguation)"
                    ),
                ))
                .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();

        // Drop GIN index (Postgres only)
        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute(sea_orm::Statement::from_string(
                    backend,
                    format!("DROP INDEX IF EXISTS {SERVICE_STREAMS_DISAMBIG_GIN_IDX}"),
                ))
                .await?;
        }

        // Drop unique index
        manager
            .drop_index(
                Index::drop()
                    .name(SERVICE_STREAMS_UNIQUE_IDX)
                    .table(ServiceStreams::Table)
                    .to_owned(),
            )
            .await?;

        // Drop name index
        manager
            .drop_index(
                Index::drop()
                    .name(SERVICE_STREAMS_NAME_IDX)
                    .table(ServiceStreams::Table)
                    .to_owned(),
            )
            .await?;

        // Drop new table
        manager
            .drop_table(
                Table::drop()
                    .table(ServiceStreams::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        // Recreate old schema
        manager
            .create_table(
                Table::create()
                    .table(ServiceStreams::Table)
                    .if_not_exists()
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
                    .col(ColumnDef::new(ServiceStreams::Dimensions).text().not_null())
                    .col(ColumnDef::new(ServiceStreams::Streams).text().not_null())
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
                    .col(ColumnDef::new(ServiceStreams::Metadata).text().null())
                    .to_owned(),
            )
            .await?;

        // Recreate old name index
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("service_streams_org_service_name_idx")
                    .table(ServiceStreams::Table)
                    .col(ServiceStreams::OrgId)
                    .col(ServiceStreams::ServiceName)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum ServiceStreams {
    Table,
    Id,
    OrgId,
    ServiceKey,
    CorrelationKey,
    ServiceName,
    Disambiguation,
    LogsStreams,
    TracesStreams,
    MetricsStreams,
    Dimensions,
    Streams,
    FirstSeen,
    LastSeen,
    Metadata,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_streams_name_idx_constant() {
        assert_eq!(SERVICE_STREAMS_NAME_IDX, "service_streams_name_idx");
    }

    #[test]
    fn test_service_streams_unique_idx_constant() {
        assert_eq!(SERVICE_STREAMS_UNIQUE_IDX, "service_streams_unique_idx");
    }

    #[test]
    fn test_service_streams_disambig_gin_idx_constant() {
        assert_eq!(
            SERVICE_STREAMS_DISAMBIG_GIN_IDX,
            "service_streams_disambig_idx"
        );
    }
}
