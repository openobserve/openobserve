use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        #[cfg(not(feature = "cloud"))]
        _manager
            .drop_table(
                Table::drop()
                    .table(TrialQuotaUsage::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Dropping the table and its usage data cannot be reversed.
        Ok(())
    }
}

#[cfg(not(feature = "cloud"))]
#[derive(DeriveIden)]
enum TrialQuotaUsage {
    Table,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260717_000001_drop_trial_quota_usage_for_non_cloud"
        );
    }

    async fn create_quota_table_with_usage(db: &sea_orm::DatabaseConnection) {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            "CREATE TABLE trial_quota_usage (org_id TEXT NOT NULL, usage_count BIGINT NOT NULL);",
        ))
        .await
        .unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            "INSERT INTO trial_quota_usage (org_id, usage_count) VALUES ('org1', 42);",
        ))
        .await
        .unwrap();
    }

    #[cfg(feature = "cloud")]
    #[tokio::test]
    async fn cloud_migration_preserves_existing_quota_usage() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_quota_table_with_usage(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();

        assert!(manager.has_table("trial_quota_usage").await.unwrap());
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT usage_count FROM trial_quota_usage WHERE org_id = 'org1';",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "usage_count").unwrap(), 42);
    }

    #[cfg(not(feature = "cloud"))]
    #[tokio::test]
    async fn non_cloud_migration_drops_redundant_quota_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_quota_table_with_usage(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();

        assert!(!manager.has_table("trial_quota_usage").await.unwrap());
    }
}
