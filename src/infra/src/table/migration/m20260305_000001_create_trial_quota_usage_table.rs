use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(TrialQuotaUsage::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TrialQuotaUsage::OrgId)
                            .string_len(256)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TrialQuotaUsage::Feature)
                            .string_len(64)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TrialQuotaUsage::UsageCount)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(TrialQuotaUsage::UsageLimit)
                            .big_integer()
                            .not_null()
                            .default(1000),
                    )
                    .col(
                        ColumnDef::new(TrialQuotaUsage::UpdatedAt)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(TrialQuotaUsage::NotifiedCheckpoint)
                            .small_integer()
                            .not_null()
                            .default(0),
                    )
                    .primary_key(
                        Index::create()
                            .col(TrialQuotaUsage::OrgId)
                            .col(TrialQuotaUsage::Feature),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TrialQuotaUsage::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum TrialQuotaUsage {
    Table,
    OrgId,
    Feature,
    UsageCount,
    UsageLimit,
    UpdatedAt,
    NotifiedCheckpoint,
}
