use sea_orm_migration::prelude::*;

const INCIDENTS_ORG_STATUS_IDX: &str = "alert_incidents_org_status_idx";
const INCIDENTS_ORG_CORRELATION_IDX: &str = "alert_incidents_org_correlation_idx";
const INCIDENTS_FIRST_ALERT_IDX: &str = "alert_incidents_first_alert_idx";
const INCIDENTS_LAST_ALERT_IDX: &str = "alert_incidents_last_alert_idx";
const INCIDENT_ALERTS_ALERT_IDX: &str = "alert_incident_alerts_alert_idx";
const INCIDENT_ALERTS_FIRED_IDX: &str = "alert_incident_alerts_fired_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Create alert_incidents table
        manager
            .create_table(create_incidents_table_statement())
            .await?;
        manager
            .create_index(create_incidents_org_status_idx())
            .await?;
        manager
            .create_index(create_incidents_org_correlation_idx())
            .await?;
        manager
            .create_index(create_incidents_first_alert_idx())
            .await?;
        manager
            .create_index(create_incidents_last_alert_idx())
            .await?;

        // Create alert_incident_alerts junction table
        manager
            .create_table(create_incident_alerts_table_statement())
            .await?;
        manager
            .create_index(create_incident_alerts_alert_idx())
            .await?;
        manager
            .create_index(create_incident_alerts_fired_idx())
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop junction table indexes
        manager
            .drop_index(
                Index::drop()
                    .name(INCIDENT_ALERTS_FIRED_IDX)
                    .table(AlertIncidentAlerts::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(INCIDENT_ALERTS_ALERT_IDX)
                    .table(AlertIncidentAlerts::Table)
                    .to_owned(),
            )
            .await?;

        // Drop junction table
        manager
            .drop_table(Table::drop().table(AlertIncidentAlerts::Table).to_owned())
            .await?;

        // Drop incidents indexes
        manager
            .drop_index(
                Index::drop()
                    .name(INCIDENTS_LAST_ALERT_IDX)
                    .table(AlertIncidents::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(INCIDENTS_FIRST_ALERT_IDX)
                    .table(AlertIncidents::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(INCIDENTS_ORG_CORRELATION_IDX)
                    .table(AlertIncidents::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(INCIDENTS_ORG_STATUS_IDX)
                    .table(AlertIncidents::Table)
                    .to_owned(),
            )
            .await?;

        // Drop incidents table
        manager
            .drop_table(Table::drop().table(AlertIncidents::Table).to_owned())
            .await
    }
}

fn create_incidents_table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertIncidents::Table)
        .if_not_exists()
        // KSUID (27 chars)
        .col(
            ColumnDef::new(AlertIncidents::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(AlertIncidents::OrgId)
                .string_len(128)
                .not_null(),
        )
        // blake3 hash (64 chars)
        .col(
            ColumnDef::new(AlertIncidents::CorrelationKey)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::Status)
                .string_len(20)
                .not_null()
                .default("open"),
        )
        .col(
            ColumnDef::new(AlertIncidents::Severity)
                .string_len(10)
                .not_null()
                .default("P3"),
        )
        // JSON for stable dimensions
        .col(
            ColumnDef::new(AlertIncidents::StableDimensions)
                .json_binary()
                .not_null(),
        )
        // JSON for topology context (optional)
        .col(
            ColumnDef::new(AlertIncidents::TopologyContext)
                .json_binary()
                .null(),
        )
        // Timestamps in microseconds
        .col(
            ColumnDef::new(AlertIncidents::FirstAlertAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::LastAlertAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::ResolvedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::AlertCount)
                .integer()
                .not_null()
                .default(1),
        )
        .col(
            ColumnDef::new(AlertIncidents::Title)
                .string_len(500)
                .null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::AssignedTo)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidents::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_incidents_org_status_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(INCIDENTS_ORG_STATUS_IDX)
        .table(AlertIncidents::Table)
        .col(AlertIncidents::OrgId)
        .col(AlertIncidents::Status)
        .to_owned()
}

fn create_incidents_org_correlation_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(INCIDENTS_ORG_CORRELATION_IDX)
        .table(AlertIncidents::Table)
        .col(AlertIncidents::OrgId)
        .col(AlertIncidents::CorrelationKey)
        .to_owned()
}

fn create_incidents_first_alert_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(INCIDENTS_FIRST_ALERT_IDX)
        .table(AlertIncidents::Table)
        .col(AlertIncidents::FirstAlertAt)
        .to_owned()
}

fn create_incidents_last_alert_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(INCIDENTS_LAST_ALERT_IDX)
        .table(AlertIncidents::Table)
        .col(AlertIncidents::LastAlertAt)
        .to_owned()
}

fn create_incident_alerts_table_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertIncidentAlerts::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertIncidentAlerts::IncidentId)
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidentAlerts::AlertId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidentAlerts::AlertFiredAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidentAlerts::AlertName)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertIncidentAlerts::CorrelationReason)
                .string_len(50)
                .null(),
        )
        .col(
            ColumnDef::new(AlertIncidentAlerts::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AlertIncidentAlerts::IncidentId)
                .col(AlertIncidentAlerts::AlertId)
                .col(AlertIncidentAlerts::AlertFiredAt),
        )
        .foreign_key(
            ForeignKey::create()
                .from(AlertIncidentAlerts::Table, AlertIncidentAlerts::IncidentId)
                .to(AlertIncidents::Table, AlertIncidents::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

fn create_incident_alerts_alert_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(INCIDENT_ALERTS_ALERT_IDX)
        .table(AlertIncidentAlerts::Table)
        .col(AlertIncidentAlerts::AlertId)
        .to_owned()
}

fn create_incident_alerts_fired_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(INCIDENT_ALERTS_FIRED_IDX)
        .table(AlertIncidentAlerts::Table)
        .col(AlertIncidentAlerts::AlertFiredAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    Id,
    OrgId,
    CorrelationKey,
    Status,
    Severity,
    StableDimensions,
    TopologyContext,
    FirstAlertAt,
    LastAlertAt,
    ResolvedAt,
    AlertCount,
    Title,
    AssignedTo,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum AlertIncidentAlerts {
    Table,
    IncidentId,
    AlertId,
    AlertFiredAt,
    AlertName,
    CorrelationReason,
    CreatedAt,
}
