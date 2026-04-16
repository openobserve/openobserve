// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! WP-1: Services & Incident Linking schema additions.
//!
//! All changes are additive — two new tables and two new nullable columns on
//! `alert_incidents`. Zero-downtime, no data backfill required.
//!
//! 1. `service_routing_config`   — operator-configured notification routing per service
//! 2. `alert_incident_services`  — join table: which services are linked to which incident
//! 3. `alert_incidents.external_refs`       — opaque external system refs (PD, Slack, Jira, …)
//! 4. `alert_incidents.last_status_source`  — sync-loop-prevention tag (WP-7)

use sea_orm_migration::prelude::*;

// Postgres GIN index on notification_targets for "find all services on channel X" queries.
const PG_SRC_NOTIF_GIN: &str = "CREATE INDEX IF NOT EXISTS idx_src_notification_targets ON service_routing_config USING GIN (notification_targets)";
const PG_SRC_NOTIF_GIN_DOWN: &str = "DROP INDEX IF EXISTS idx_src_notification_targets";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();

        // ── 1. service_routing_config ─────────────────────────────────────────
        manager
            .create_table(create_service_routing_config_table())
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_src_org")
                    .table(ServiceRoutingConfig::Table)
                    .col(ServiceRoutingConfig::OrgId)
                    .to_owned(),
            )
            .await?;

        // Postgres-only GIN index on notification_targets JSON array
        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute(sea_orm::Statement::from_string(
                    backend,
                    PG_SRC_NOTIF_GIN.to_string(),
                ))
                .await?;
        }

        // ── 2. alert_incident_services ────────────────────────────────────────
        manager
            .create_table(create_alert_incident_services_table())
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_ais_incident")
                    .table(AlertIncidentServices::Table)
                    .col(AlertIncidentServices::IncidentId)
                    .col(AlertIncidentServices::Role)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_ais_service")
                    .table(AlertIncidentServices::Table)
                    .col(AlertIncidentServices::ServiceStreamId)
                    .to_owned(),
            )
            .await?;

        // ── 3 & 4. New nullable columns on alert_incidents ────────────────────
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidents::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(AlertIncidents::ExternalRefs)
                            .json_binary()
                            .null(),
                    )
                    .add_column_if_not_exists(
                        ColumnDef::new(AlertIncidents::LastStatusSource)
                            .string_len(32)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();

        // Remove new alert_incidents columns (Postgres only — SQLite can't DROP COLUMN)
        if backend == sea_orm::DbBackend::Postgres {
            manager
                .alter_table(
                    Table::alter()
                        .table(AlertIncidents::Table)
                        .drop_column(AlertIncidents::LastStatusSource)
                        .drop_column(AlertIncidents::ExternalRefs)
                        .to_owned(),
                )
                .await?;
        }

        // Drop alert_incident_services indexes then table
        manager
            .drop_index(
                Index::drop()
                    .name("idx_ais_service")
                    .table(AlertIncidentServices::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name("idx_ais_incident")
                    .table(AlertIncidentServices::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(AlertIncidentServices::Table).to_owned())
            .await?;

        // Drop service_routing_config GIN index (Postgres only) then table
        if backend == sea_orm::DbBackend::Postgres {
            manager
                .get_connection()
                .execute(sea_orm::Statement::from_string(
                    backend,
                    PG_SRC_NOTIF_GIN_DOWN.to_string(),
                ))
                .await?;
        }
        manager
            .drop_index(
                Index::drop()
                    .name("idx_src_org")
                    .table(ServiceRoutingConfig::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(ServiceRoutingConfig::Table).to_owned())
            .await?;

        Ok(())
    }
}

fn create_service_routing_config_table() -> TableCreateStatement {
    Table::create()
        .table(ServiceRoutingConfig::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(ServiceRoutingConfig::Id)
                .char_len(27) // KSUID
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(ServiceRoutingConfig::OrgId)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceRoutingConfig::ServiceStreamId)
                .char_len(27) // KSUID
                .not_null(),
        )
        // Vec<String> — validated against org users at the application layer
        .col(
            ColumnDef::new(ServiceRoutingConfig::OwnerEmails)
                .json_binary()
                .not_null()
                .default("[]"),
        )
        // Nullable until WP-3 ships; any value accepted and stored, FK added later
        .col(
            ColumnDef::new(ServiceRoutingConfig::OncallScheduleId)
                .char_len(27)
                .null(),
        )
        // Nullable until WP-4 ships; any value accepted and stored, FK added later
        .col(
            ColumnDef::new(ServiceRoutingConfig::EscalationPolicyId)
                .char_len(27)
                .null(),
        )
        // Vec<{kind, ref}> — extensible at runtime, no migration needed for new kinds
        .col(
            ColumnDef::new(ServiceRoutingConfig::NotificationTargets)
                .json_binary()
                .not_null()
                .default("[]"),
        )
        .col(
            ColumnDef::new(ServiceRoutingConfig::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(ServiceRoutingConfig::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        // FK → service_streams.id; enforced here since service_streams rows are stable KSUIDs
        .foreign_key(
            ForeignKey::create()
                .from(
                    ServiceRoutingConfig::Table,
                    ServiceRoutingConfig::ServiceStreamId,
                )
                .to(ServiceStreams::Table, ServiceStreams::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        // At most one routing config per service per org
        .index(
            Index::create()
                .unique()
                .name("uq_src_org_service")
                .col(ServiceRoutingConfig::OrgId)
                .col(ServiceRoutingConfig::ServiceStreamId),
        )
        .to_owned()
}

fn create_alert_incident_services_table() -> TableCreateStatement {
    Table::create()
        .table(AlertIncidentServices::Table)
        .if_not_exists()
        // No FK on incident_id: cascading deletes handled at app layer during batch resolution
        .col(
            ColumnDef::new(AlertIncidentServices::IncidentId)
                .char_len(27)
                .not_null(),
        )
        // No FK on service_stream_id: service_streams.put() can delete subset rows;
        // stale refs displayed as "Unknown service" at read time
        .col(
            ColumnDef::new(AlertIncidentServices::ServiceStreamId)
                .char_len(27)
                .not_null(),
        )
        // 'responsible' | 'impacted'
        .col(
            ColumnDef::new(AlertIncidentServices::Role)
                .string_len(16)
                .not_null()
                .default("impacted"),
        )
        // 'system' | 'user'
        .col(
            ColumnDef::new(AlertIncidentServices::AddedBy)
                .string_len(16)
                .not_null()
                .default("system"),
        )
        .col(
            ColumnDef::new(AlertIncidentServices::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AlertIncidentServices::IncidentId)
                .col(AlertIncidentServices::ServiceStreamId),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum ServiceRoutingConfig {
    Table,
    Id,
    OrgId,
    ServiceStreamId,
    OwnerEmails,
    OncallScheduleId,
    EscalationPolicyId,
    NotificationTargets,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum AlertIncidentServices {
    Table,
    IncidentId,
    ServiceStreamId,
    Role,
    AddedBy,
    CreatedAt,
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    ExternalRefs,
    LastStatusSource,
}

#[derive(DeriveIden)]
enum ServiceStreams {
    Table,
    Id,
}
