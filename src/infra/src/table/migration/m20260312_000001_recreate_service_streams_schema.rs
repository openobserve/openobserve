use sea_orm_migration::prelude::*;

const SERVICE_STREAMS_NAME_IDX: &str = "service_streams_name_idx";
#[allow(dead_code)]
const SERVICE_STREAMS_DISAMBIG_IDX: &str = "service_streams_disambig_idx";
const SERVICE_STREAMS_UNIQUE_IDX: &str = "service_streams_unique_idx";

// Raw SQL for Postgres: uses JSONB, GIN index, and native IF EXISTS clauses.
const POSTGRES_UP_SQL: &[&str] = &[
    "DROP TABLE IF EXISTS service_streams",
    "CREATE TABLE service_streams (
  id CHAR(27) NOT NULL PRIMARY KEY,
  org_id VARCHAR(128) NOT NULL,
  service_name VARCHAR(256) NOT NULL,
  disambiguation JSONB NOT NULL DEFAULT '{}',
  logs_streams JSONB NOT NULL DEFAULT '[]',
  traces_streams JSONB NOT NULL DEFAULT '[]',
  metrics_streams JSONB NOT NULL DEFAULT '[]',
  last_seen BIGINT NOT NULL,
  UNIQUE (org_id, service_name, disambiguation)
)",
    "CREATE INDEX service_streams_name_idx ON service_streams (org_id, service_name)",
    "CREATE INDEX service_streams_disambig_idx ON service_streams USING GIN (disambiguation)",
];

// Old schema SQL used by Postgres down() to restore the previous table.
const POSTGRES_DOWN_SQL: &[&str] = &[
    "DROP TABLE IF EXISTS service_streams",
    "CREATE TABLE service_streams (
  id CHAR(27) NOT NULL PRIMARY KEY,
  org_id VARCHAR(128) NOT NULL,
  service_key VARCHAR(512) NOT NULL,
  correlation_key VARCHAR(64) NOT NULL DEFAULT '',
  service_name VARCHAR(256) NOT NULL,
  dimensions TEXT NOT NULL,
  streams TEXT NOT NULL,
  first_seen BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  metadata TEXT
)",
    "CREATE UNIQUE INDEX service_streams_org_service_key_idx ON service_streams (org_id, service_key)",
    "CREATE INDEX service_streams_org_service_name_idx ON service_streams (org_id, service_name)",
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                let db = manager.get_connection();
                for sql in POSTGRES_UP_SQL {
                    db.execute(sea_orm::Statement::from_string(backend, (*sql).to_string()))
                        .await?;
                }
            }
            _ => {
                // SQLite: use SeaORM DSL (no JSONB, no GIN index, no IF EXISTS on DROP).
                manager
                    .drop_table(
                        Table::drop()
                            .table(ServiceStreams::Table)
                            .if_exists()
                            .to_owned(),
                    )
                    .await?;

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

                // SQLite doesn't support GIN; create a plain index for disambiguation
                // and use it as the uniqueness guard too.
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
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                let db = manager.get_connection();
                for sql in POSTGRES_DOWN_SQL {
                    db.execute(sea_orm::Statement::from_string(backend, (*sql).to_string()))
                        .await?;
                }
            }
            _ => {
                // SQLite cannot DROP COLUMN, so drop and recreate.
                manager
                    .drop_index(
                        Index::drop()
                            .name(SERVICE_STREAMS_UNIQUE_IDX)
                            .table(ServiceStreams::Table)
                            .to_owned(),
                    )
                    .await?;
                manager
                    .drop_index(
                        Index::drop()
                            .name(SERVICE_STREAMS_NAME_IDX)
                            .table(ServiceStreams::Table)
                            .to_owned(),
                    )
                    .await?;
                manager
                    .drop_table(
                        Table::drop()
                            .table(ServiceStreams::Table)
                            .if_exists()
                            .to_owned(),
                    )
                    .await?;

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

                manager
                    .create_index(
                        Index::create()
                            .if_not_exists()
                            .name("service_streams_org_service_key_idx")
                            .table(ServiceStreams::Table)
                            .col(ServiceStreams::OrgId)
                            .col(ServiceStreams::ServiceKey)
                            .unique()
                            .to_owned(),
                    )
                    .await?;

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
            }
        }
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
