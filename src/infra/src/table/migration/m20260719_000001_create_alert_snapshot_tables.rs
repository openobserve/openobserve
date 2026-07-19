use sea_orm_migration::prelude::*;

const ALERT_SNAPSHOTS_OCCURRENCE_IDX: &str = "alert_snapshots_occurrence_idx";
const ALERT_SNAPSHOTS_ORG_SNAPSHOT_IDX: &str = "alert_snapshots_org_snapshot_idx";
const ALERT_SNAPSHOT_FILES_SNAPSHOT_IDX: &str = "alert_snapshot_files_snapshot_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_alert_snapshots_table_statement())
            .await?;
        manager
            .create_index(create_alert_snapshots_occurrence_idx())
            .await?;
        manager
            .create_index(create_alert_snapshots_org_snapshot_idx())
            .await?;

        manager
            .create_table(create_alert_snapshot_files_table_statement())
            .await?;
        manager
            .create_index(create_alert_snapshot_files_snapshot_idx())
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(ALERT_SNAPSHOT_FILES_SNAPSHOT_IDX)
                    .table(AlertSnapshotFiles::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(AlertSnapshotFiles::Table).to_owned())
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name(ALERT_SNAPSHOTS_ORG_SNAPSHOT_IDX)
                    .table(AlertSnapshots::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(ALERT_SNAPSHOTS_OCCURRENCE_IDX)
                    .table(AlertSnapshots::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(AlertSnapshots::Table).to_owned())
            .await
    }
}

fn create_alert_snapshots_table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertSnapshots::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertSnapshots::SnapshotId)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::OrgId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::AlertId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::AlertName)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::TriggerTimestamp)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::WindowStart)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::WindowEnd)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshots::SchemaVersion)
                .small_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_alert_snapshots_occurrence_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .unique()
        .name(ALERT_SNAPSHOTS_OCCURRENCE_IDX)
        .table(AlertSnapshots::Table)
        .col(AlertSnapshots::OrgId)
        .col(AlertSnapshots::AlertId)
        .col(AlertSnapshots::WindowStart)
        .col(AlertSnapshots::WindowEnd)
        .to_owned()
}

fn create_alert_snapshots_org_snapshot_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ALERT_SNAPSHOTS_ORG_SNAPSHOT_IDX)
        .table(AlertSnapshots::Table)
        .col(AlertSnapshots::OrgId)
        .col(AlertSnapshots::SnapshotId)
        .to_owned()
}

fn create_alert_snapshot_files_table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertSnapshotFiles::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertSnapshotFiles::SnapshotId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshotFiles::FileKey)
                .string_len(1024)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshotFiles::StreamType)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshotFiles::StreamName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshotFiles::FileId)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertSnapshotFiles::MinTs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertSnapshotFiles::MaxTs)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AlertSnapshotFiles::SnapshotId)
                .col(AlertSnapshotFiles::FileKey),
        )
        .foreign_key(
            ForeignKey::create()
                .from(AlertSnapshotFiles::Table, AlertSnapshotFiles::SnapshotId)
                .to(AlertSnapshots::Table, AlertSnapshots::SnapshotId)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

fn create_alert_snapshot_files_snapshot_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ALERT_SNAPSHOT_FILES_SNAPSHOT_IDX)
        .table(AlertSnapshotFiles::Table)
        .col(AlertSnapshotFiles::SnapshotId)
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertSnapshots {
    Table,
    SnapshotId,
    OrgId,
    AlertId,
    AlertName,
    TriggerTimestamp,
    WindowStart,
    WindowEnd,
    CreatedAt,
    SchemaVersion,
}

#[derive(DeriveIden)]
enum AlertSnapshotFiles {
    Table,
    SnapshotId,
    FileKey,
    StreamType,
    StreamName,
    FileId,
    MinTs,
    MaxTs,
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_alert_snapshots_table_contains_table_name() {
        let sql = create_alert_snapshots_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("alert_snapshots"));
    }

    #[test]
    fn test_alert_snapshot_files_table_contains_table_name() {
        let sql = create_alert_snapshot_files_table_statement().build(SqliteQueryBuilder);
        assert!(sql.contains("alert_snapshot_files"));
    }

    #[test]
    fn test_occurrence_index_is_unique() {
        let sql = create_alert_snapshots_occurrence_idx().build(SqliteQueryBuilder);
        assert!(sql.contains(ALERT_SNAPSHOTS_OCCURRENCE_IDX));
        assert!(sql.contains("UNIQUE"));
    }

    #[test]
    fn test_org_snapshot_index_name() {
        let sql = create_alert_snapshots_org_snapshot_idx().build(SqliteQueryBuilder);
        assert!(sql.contains(ALERT_SNAPSHOTS_ORG_SNAPSHOT_IDX));
    }

    #[test]
    fn test_snapshot_files_lookup_index_name() {
        let sql = create_alert_snapshot_files_snapshot_idx().build(SqliteQueryBuilder);
        assert!(sql.contains(ALERT_SNAPSHOT_FILES_SNAPSHOT_IDX));
    }

    #[tokio::test]
    async fn test_migration_up_down_on_sqlite() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table("alert_snapshots").await.unwrap());
        assert!(manager.has_table("alert_snapshot_files").await.unwrap());

        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("alert_snapshot_files").await.unwrap());
        assert!(!manager.has_table("alert_snapshots").await.unwrap());
    }

    #[tokio::test]
    async fn test_migration_down_drops_child_before_parent_with_existing_rows() {
        use sea_orm::{ConnectionTrait, DbBackend, Statement};

        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            r#"
INSERT INTO alert_snapshots (
    snapshot_id, org_id, alert_id, alert_name, trigger_timestamp,
    window_start, window_end, created_at, schema_version
) VALUES (
    '2YQphB7Bk1j9vR0fWnQeGxZMbKm', 'org1', '2YQphB7Bk1j9vR0fWnQeGxZMbKn',
    NULL, 20, 10, 20, 21, 1
);
"#
            .to_string(),
        ))
        .await
        .unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            r#"
INSERT INTO alert_snapshot_files (
    snapshot_id, file_key, stream_type, stream_name, file_id, min_ts, max_ts
) VALUES (
    '2YQphB7Bk1j9vR0fWnQeGxZMbKm', 'files/org1/logs/app/a.parquet',
    'logs', 'app', NULL, 10, 20
);
"#
            .to_string(),
        ))
        .await
        .unwrap();

        Migration.down(&manager).await.unwrap();

        assert!(!manager.has_table("alert_snapshot_files").await.unwrap());
        assert!(!manager.has_table("alert_snapshots").await.unwrap());
    }
}
