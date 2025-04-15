use sea_orm::DbBackend;
use sea_orm_migration::prelude::*;

const RESOURCE_KEY: &str = "rkey_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_ratelimit_table_statement())
            .await?;

        let index_exists = manager
            .has_index(RateLimitRules::Table.to_string().as_str(), RESOURCE_KEY)
            .await?;
        if index_exists {
            manager
                .drop_index(
                    Index::drop()
                        .name(RESOURCE_KEY)
                        .table(RateLimitRules::Table)
                        .to_owned(),
                )
                .await?;
        }

        match manager.get_database_backend() {
            DbBackend::MySql => {
                manager
                    .create_index(create_ratelimit_resource_key_idx_stmnt_mysql())
                    .await?;
            }
            _ => {
                manager
                    .create_index(create_ratelimit_resource_key_idx_stmnt())
                    .await?;
            }
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(RESOURCE_KEY)
                    .table(RateLimitRules::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(RateLimitRules::Table).to_owned())
            .await
    }
}

fn create_ratelimit_table_statement() -> TableCreateStatement {
    Table::create()
        .table(RateLimitRules::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RateLimitRules::RuleId)
                .string_len(64)
                .primary_key()
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::RuleType)
                .string_len(50)
                .extra("DEFAULT 'exact'")
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::UserRole)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::UserId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::ApiGroupName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::ApiGroupOperation)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::Threshold)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RateLimitRules::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_ratelimit_resource_key_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .name(RESOURCE_KEY)
        .table(RateLimitRules::Table)
        .col(RateLimitRules::Org)
        .col(RateLimitRules::UserRole)
        .col(RateLimitRules::UserId)
        .col(RateLimitRules::ApiGroupName)
        .col(RateLimitRules::ApiGroupOperation)
        .unique()
        .to_owned()
}

fn create_ratelimit_resource_key_idx_stmnt_mysql() -> IndexCreateStatement {
    sea_query::Index::create()
        .name(RESOURCE_KEY)
        .table(RateLimitRules::Table)
        .col(RateLimitRules::Org)
        .col(RateLimitRules::UserRole)
        .col(RateLimitRules::UserId)
        .to_owned()
}

#[derive(DeriveIden)]
enum RateLimitRules {
    Table,
    Org,
    RuleId,
    RuleType,
    UserRole,
    UserId,
    ApiGroupName,
    ApiGroupOperation,
    Threshold,
    CreatedAt,
}
