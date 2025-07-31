use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        manager
            .create_index(create_compactor_jobs_module_idx_stmnt())
            .await?;
        manager
            .create_index(create_compactor_jobs_module_key1_idx_stmnt())
            .await?;
        manager
            .create_index(create_compactor_jobs_module_start_dt_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(COMPACTOR_JOBS_MODULE_IDX)
                    .table(CompactorJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(COMPACTOR_JOBS_MODULE_KEY1_IDX)
                    .table(CompactorJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(COMPACTOR_JOBS_MODULE_START_DT_IDX)
                    .table(CompactorJobs::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(CompactorJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(CompactorJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(CompactorJobs::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(CompactorJobs::Module)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(CompactorJobs::Key1)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(CompactorJobs::Key2)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(CompactorJobs::StartDt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(CompactorJobs::EndDt).big_integer())
        .col(
            ColumnDef::new(CompactorJobs::Status)
                .string_len(20)
                .not_null()
                .default("OK"),
        )
        .col(
            ColumnDef::new(CompactorJobs::EventId)
                .string_len(256)
                .not_null(),
        )
        .to_owned()
}

const COMPACTOR_JOBS_MODULE_IDX: &str = "compactor_jobs_module_idx";
const COMPACTOR_JOBS_MODULE_KEY1_IDX: &str = "compactor_jobs_module_key1_idx";
const COMPACTOR_JOBS_MODULE_START_DT_IDX: &str = "compactor_jobs_module_start_dt_idx";

/// Statement to create index on org.
fn create_compactor_jobs_module_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(COMPACTOR_JOBS_MODULE_IDX)
        .table(CompactorJobs::Table)
        .col(CompactorJobs::Module)
        .to_owned()
}

/// Statement to create unique index on org and folder_id.
fn create_compactor_jobs_module_key1_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(COMPACTOR_JOBS_MODULE_KEY1_IDX)
        .table(CompactorJobs::Table)
        .col(CompactorJobs::Module)
        .col(CompactorJobs::Key1)
        .to_owned()
}

/// Statement to create index on org and folder_id.
fn create_compactor_jobs_module_start_dt_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(COMPACTOR_JOBS_MODULE_START_DT_IDX)
        .table(CompactorJobs::Table)
        .col(CompactorJobs::Module)
        .col(CompactorJobs::Key1)
        .col(CompactorJobs::Key2)
        .col(CompactorJobs::StartDt)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum CompactorJobs {
    Table,
    Id,
    Module,
    Key1,
    Key2,
    StartDt,
    EndDt,
    Status,
    EventId,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_table_stmt().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "compactor_jobs" (
                "id" bigserial NOT NULL PRIMARY KEY,
                "module" varchar(100) NOT NULL,
                "key1" varchar(256) NOT NULL,
                "key2" varchar(256) NOT NULL,
                "start_dt" bigint NOT NULL,
                "end_dt" bigint,
                "status" varchar(20) NOT NULL DEFAULT 'OK',
                "event_id" varchar(256) NOT NULL
            )"#
        );
        assert_eq!(
            &create_compactor_jobs_module_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "compactor_jobs_module_idx" ON "compactor_jobs" ("module")"#
        );
        assert_eq!(
            &create_compactor_jobs_module_key1_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "compactor_jobs_module_key1_idx" ON "compactor_jobs" ("module", "key1")"#
        );

        assert_eq!(
            &create_compactor_jobs_module_start_dt_idx_stmnt().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "compactor_jobs_module_start_dt_idx" ON "compactor_jobs" ("module", "key1", "key2", "start_dt")"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_table_stmt().to_string(MysqlQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS `compactor_jobs` (
                `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
                `module` varchar(100) NOT NULL,
                `key1` varchar(256) NOT NULL,
                `key2` varchar(256) NOT NULL,
                `start_dt` bigint NOT NULL,
                `end_dt` bigint,
                `status` varchar(20) NOT NULL DEFAULT 'OK',
                `event_id` varchar(256) NOT NULL
            )"#
        );
        assert_eq!(
            &create_compactor_jobs_module_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE INDEX `compactor_jobs_module_idx` ON `compactor_jobs` (`module`)"#
        );
        assert_eq!(
            &create_compactor_jobs_module_key1_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE INDEX `compactor_jobs_module_key1_idx` ON `compactor_jobs` (`module`, `key1`)"#
        );
        assert_eq!(
            &create_compactor_jobs_module_start_dt_idx_stmnt().to_string(MysqlQueryBuilder),
            r#"CREATE UNIQUE INDEX `compactor_jobs_module_start_dt_idx` ON `compactor_jobs` (`module`, `key1`, `key2`, `start_dt`)"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_table_stmt().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "compactor_jobs" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "module" varchar(100) NOT NULL,
                "key1" varchar(256) NOT NULL,
                "key2" varchar(256) NOT NULL,
                "start_dt" bigint NOT NULL,
                "end_dt" bigint,
                "status" varchar(20) NOT NULL DEFAULT 'OK',
                "event_id" varchar(256) NOT NULL
            )"#
        );
        assert_eq!(
            &create_compactor_jobs_module_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "compactor_jobs_module_idx" ON "compactor_jobs" ("module")"#
        );
        assert_eq!(
            &create_compactor_jobs_module_key1_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "compactor_jobs_module_key1_idx" ON "compactor_jobs" ("module", "key1")"#
        );

        assert_eq!(
            &create_compactor_jobs_module_start_dt_idx_stmnt().to_string(SqliteQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "compactor_jobs_module_start_dt_idx" ON "compactor_jobs" ("module", "key1", "key2", "start_dt")"#
        );
    }
}
