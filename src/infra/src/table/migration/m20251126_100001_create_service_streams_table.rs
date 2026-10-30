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
        // only the pre-20260318 table has service_key; SQLite would index it as a constant
        if !manager.has_column("service_streams", "service_key").await? {
            return Ok(());
        }
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

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};
    use sea_query::SqliteQueryBuilder;

    use super::*;
    use crate::table::migration::m20260318_000001_recreate_service_streams_schema as rebuild;

    #[test]
    fn test_service_streams_table_contains_table_name() {
        let sql = create_service_streams_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("service_streams"));
    }

    #[test]
    fn test_org_service_key_idx_name() {
        let sql = create_service_streams_org_service_key_idx_stmnt().build(SqliteQueryBuilder);
        assert!(sql.contains(SERVICE_STREAMS_ORG_SERVICE_KEY_IDX));
    }

    #[test]
    fn test_org_service_name_idx_name() {
        let sql = create_service_streams_org_service_name_idx_stmnt().build(SqliteQueryBuilder);
        assert!(sql.contains(SERVICE_STREAMS_ORG_SERVICE_NAME_IDX));
    }

    #[tokio::test]
    async fn test_up_reruns_after_the_rebuild_dropped_service_key() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        let old_indexes = [
            SERVICE_STREAMS_ORG_SERVICE_KEY_IDX,
            SERVICE_STREAMS_ORG_SERVICE_NAME_IDX,
        ];
        for idx in old_indexes {
            assert!(manager.has_index("service_streams", idx).await.unwrap());
        }
        rebuild::Migration.up(&manager).await.unwrap();

        Migration.up(&manager).await.unwrap();
        for idx in old_indexes {
            assert!(
                !manager.has_index("service_streams", idx).await.unwrap(),
                "{idx}"
            );
        }
        // SQLite re-checks every index in the schema on DROP COLUMN
        db.execute_unprepared("CREATE TABLE probe (a INTEGER, b INTEGER)")
            .await
            .unwrap();
        db.execute_unprepared("ALTER TABLE probe DROP COLUMN b")
            .await
            .expect("DROP COLUMN must still work after a re-run");
    }
}
