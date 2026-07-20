use sea_orm_migration::prelude::*;

const ALERT_OCCURRENCES_ORG_ALERT_CREATED_IDX: &str = "alert_occurrences_org_alert_created_idx";
const ALERT_OCCURRENCES_ORG_OCCURRENCE_IDX: &str = "alert_occurrences_org_occurrence_idx";
const ALERT_OCCURRENCES_CREATED_IDX: &str = "alert_occurrences_created_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_alert_occurrences_table_statement())
            .await?;
        manager
            .create_index(create_alert_occurrences_org_alert_created_idx())
            .await?;
        manager
            .create_index(create_alert_occurrences_org_occurrence_idx())
            .await?;
        manager
            .create_index(create_alert_occurrences_created_idx())
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ALERT_OCCURRENCES_CREATED_IDX)
                    .table(AlertOccurrences::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ALERT_OCCURRENCES_ORG_OCCURRENCE_IDX)
                    .table(AlertOccurrences::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ALERT_OCCURRENCES_ORG_ALERT_CREATED_IDX)
                    .table(AlertOccurrences::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(AlertOccurrences::Table).to_owned())
            .await
    }
}

fn create_alert_occurrences_table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertOccurrences::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertOccurrences::OccurrenceId)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::OrgId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::AlertId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::AlertName)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::AlertUpdatedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::ConfigHash)
                .string_len(40)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::WindowStart)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::WindowEnd)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::TriggerTimestamp)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::QueryType)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::ConditionOperator)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::ThresholdValue)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::MatchedCount)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::ResultPreview)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::ResultTruncated)
                .boolean()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::QueryTook)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::TraceId)
                .string_len(128)
                .null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertOccurrences::SchemaVersion)
                .small_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_alert_occurrences_org_alert_created_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ALERT_OCCURRENCES_ORG_ALERT_CREATED_IDX)
        .table(AlertOccurrences::Table)
        .col(AlertOccurrences::OrgId)
        .col(AlertOccurrences::AlertId)
        .col(AlertOccurrences::CreatedAt)
        .to_owned()
}

fn create_alert_occurrences_org_occurrence_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ALERT_OCCURRENCES_ORG_OCCURRENCE_IDX)
        .table(AlertOccurrences::Table)
        .col(AlertOccurrences::OrgId)
        .col(AlertOccurrences::OccurrenceId)
        .to_owned()
}

fn create_alert_occurrences_created_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ALERT_OCCURRENCES_CREATED_IDX)
        .table(AlertOccurrences::Table)
        .col(AlertOccurrences::CreatedAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertOccurrences {
    Table,
    OccurrenceId,
    OrgId,
    AlertId,
    AlertName,
    AlertUpdatedAt,
    ConfigHash,
    WindowStart,
    WindowEnd,
    TriggerTimestamp,
    QueryType,
    ConditionOperator,
    ThresholdValue,
    MatchedCount,
    ResultPreview,
    ResultTruncated,
    QueryTook,
    TraceId,
    CreatedAt,
    SchemaVersion,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_alert_occurrences_table_contains_table_name() {
        let sql = create_alert_occurrences_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("alert_occurrences"));
    }

    #[test]
    fn test_org_alert_created_index_name() {
        let sql = create_alert_occurrences_org_alert_created_idx().build(SqliteQueryBuilder);
        assert!(sql.contains(ALERT_OCCURRENCES_ORG_ALERT_CREATED_IDX));
        assert!(!sql.contains("UNIQUE"));
    }

    #[test]
    fn test_org_occurrence_index_name() {
        let sql = create_alert_occurrences_org_occurrence_idx().build(SqliteQueryBuilder);
        assert!(sql.contains(ALERT_OCCURRENCES_ORG_OCCURRENCE_IDX));
    }

    #[tokio::test]
    async fn test_migration_up_down_on_sqlite() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table("alert_occurrences").await.unwrap());

        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("alert_occurrences").await.unwrap());
    }
}
