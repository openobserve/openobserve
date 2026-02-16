use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(IncidentEvents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(IncidentEvents::OrgId)
                            .string_len(256)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentEvents::IncidentId)
                            .char_len(27)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(IncidentEvents::Events)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .primary_key(
                        Index::create()
                            .col(IncidentEvents::OrgId)
                            .col(IncidentEvents::IncidentId),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(IncidentEvents::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum IncidentEvents {
    Table,
    OrgId,
    IncidentId,
    Events,
}
