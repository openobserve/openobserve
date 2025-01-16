use sea_orm_migration::prelude::*;

const DASHBOARDS_DASHBOARD_ID_INDEX: &str = "dashboards_dashboard_id_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .name(DASHBOARDS_DASHBOARD_ID_INDEX)
                    .table(Dashboards::Table)
                    .col(Dashboards::DashboardId)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(DASHBOARDS_DASHBOARD_ID_INDEX)
                    .table(Dashboards::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(Iden)]
enum Dashboards {
    Table,
    DashboardId,
}
