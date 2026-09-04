use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

// GIN indexes are Postgres-specific and not expressible via SeaORM's index builder.
const POSTGRES_GIN_UP: &str = "CREATE INDEX IF NOT EXISTS alert_incidents_group_idx ON alert_incidents USING GIN (group_values)";
const POSTGRES_GIN_DOWN: &str = "DROP INDEX IF EXISTS alert_incidents_group_idx";

// topology_context is intentionally kept — it stores the RCA analysis + alert flow graph,
// unrelated to the old correlation key scheme. Old correlation columns are discarded.
const SQLITE_COPY_SQL: &str = "INSERT OR IGNORE INTO alert_incidents
    (id, org_id, status, severity, group_values, key_type, topology_context,
     first_alert_at, last_alert_at, resolved_at, alert_count,
     title, assigned_to, created_at, updated_at)
 SELECT
    id, org_id, status, severity, '{}', 'AlertId', topology_context,
    first_alert_at, last_alert_at, resolved_at, alert_count,
    title, assigned_to, created_at, updated_at
 FROM alert_incidents_old";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                manager
                    .alter_table(
                        Table::alter()
                            .table(AlertIncidents::Table)
                            .drop_column(Alias::new("correlation_key"))
                            .drop_column(Alias::new("stable_dimensions"))
                            .add_column_if_not_exists(
                                ColumnDef::new(AlertIncidents::GroupValues)
                                    .json_binary()
                                    .not_null()
                                    .default("{}"),
                            )
                            .add_column_if_not_exists(
                                ColumnDef::new(AlertIncidents::KeyType)
                                    .string_len(20)
                                    .not_null()
                                    .default("AlertId"),
                            )
                            .to_owned(),
                    )
                    .await?;
                manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        POSTGRES_GIN_UP.to_string(),
                    ))
                    .await?;
            }
            _ => {
                // SQLite cannot DROP COLUMN or ALTER column constraints.
                // Reconstruct the table to remove correlation_key (NOT NULL, no default)
                // and stable_dimensions, replacing them with group_values + key_type.

                // Step 1: Store alert_incident_alerts data before breaking foreign key
                // Drop temp table if it exists (cleanup from failed previous run)
                let _ = manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        "DROP TABLE IF EXISTS temp_alert_incident_alerts".to_string(),
                    ))
                    .await;

                manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        "CREATE TABLE temp_alert_incident_alerts AS SELECT * FROM alert_incident_alerts".to_string(),
                    ))
                    .await?;

                // Step 2: Drop alert_incident_alerts (has foreign key to alert_incidents)
                manager
                    .drop_table(
                        Table::drop()
                            .table(Alias::new("alert_incident_alerts"))
                            .to_owned(),
                    )
                    .await?;

                // Step 3: Rename alert_incidents to alert_incidents_old
                manager
                    .rename_table(
                        Table::rename()
                            .table(AlertIncidents::Table, Alias::new("alert_incidents_old"))
                            .to_owned(),
                    )
                    .await?;

                // Step 4: Create new alert_incidents table with updated schema
                manager.create_table(create_alert_incidents_table()).await?;

                // Step 5: Copy data from old to new alert_incidents
                manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        SQLITE_COPY_SQL.to_string(),
                    ))
                    .await?;

                // Step 6: Recreate alert_incident_alerts with correct foreign key
                manager
                    .create_table(recreate_alert_incident_alerts_table())
                    .await?;

                // Step 7: Restore alert_incident_alerts data
                manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        "INSERT INTO alert_incident_alerts SELECT * FROM temp_alert_incident_alerts".to_string(),
                    ))
                    .await?;

                // Step 8: Recreate indexes for alert_incident_alerts
                manager
                    .create_index(
                        Index::create()
                            .if_not_exists()
                            .name("alert_incident_alerts_alert_idx")
                            .table(Alias::new("alert_incident_alerts"))
                            .col(Alias::new("alert_id"))
                            .to_owned(),
                    )
                    .await?;

                manager
                    .create_index(
                        Index::create()
                            .if_not_exists()
                            .name("alert_incident_alerts_fired_idx")
                            .table(Alias::new("alert_incident_alerts"))
                            .col(Alias::new("alert_fired_at"))
                            .to_owned(),
                    )
                    .await?;

                // Step 9: Clean up temporary table and old incidents table
                manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        "DROP TABLE temp_alert_incident_alerts".to_string(),
                    ))
                    .await?;

                manager
                    .drop_table(
                        Table::drop()
                            .table(Alias::new("alert_incidents_old"))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                manager
                    .get_connection()
                    .execute(sea_orm::Statement::from_string(
                        backend,
                        POSTGRES_GIN_DOWN.to_string(),
                    ))
                    .await?;
                manager
                    .alter_table(
                        Table::alter()
                            .table(AlertIncidents::Table)
                            .drop_column(AlertIncidents::GroupValues)
                            .drop_column(AlertIncidents::KeyType)
                            .add_column_if_not_exists(
                                ColumnDef::new(Alias::new("correlation_key")).string_len(128),
                            )
                            .add_column_if_not_exists(
                                ColumnDef::new(Alias::new("stable_dimensions")).json_binary(),
                            )
                            .to_owned(),
                    )
                    .await?;
            }
            _ => {
                // Reversing column drops is not supported on SQLite.
            }
        }
        Ok(())
    }
}

fn create_alert_incidents_table() -> TableCreateStatement {
    Table::create()
        .table(AlertIncidents::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertIncidents::Id)
                .text()
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(AlertIncidents::OrgId).text().not_null())
        .col(
            ColumnDef::new(AlertIncidents::Status)
                .text()
                .not_null()
                .default("open"),
        )
        .col(
            ColumnDef::new(AlertIncidents::Severity)
                .text()
                .not_null()
                .default("P3"),
        )
        .col(
            ColumnDef::new(AlertIncidents::GroupValues)
                .blob()
                .not_null()
                .default("{}"),
        )
        .col(
            ColumnDef::new(AlertIncidents::KeyType)
                .text()
                .not_null()
                .default("AlertId"),
        )
        .col(ColumnDef::new(AlertIncidents::TopologyContext).blob())
        .col(
            ColumnDef::new(AlertIncidents::FirstAlertAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AlertIncidents::LastAlertAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(AlertIncidents::ResolvedAt).big_integer())
        .col(
            ColumnDef::new(AlertIncidents::AlertCount)
                .integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(AlertIncidents::Title).text())
        .col(ColumnDef::new(AlertIncidents::AssignedTo).text())
        .col(
            ColumnDef::new(AlertIncidents::CreatedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(AlertIncidents::UpdatedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

fn recreate_alert_incident_alerts_table() -> TableCreateStatement {
    use sea_orm_migration::prelude::*;

    Table::create()
        .table(Alias::new("alert_incident_alerts"))
        .if_not_exists()
        .col(
            ColumnDef::new(Alias::new("incident_id"))
                .char_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(Alias::new("alert_id"))
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Alias::new("alert_fired_at"))
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(Alias::new("alert_name"))
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(Alias::new("correlation_reason"))
                .string_len(50)
                .null(),
        )
        .col(
            ColumnDef::new(Alias::new("created_at"))
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(Alias::new("incident_id"))
                .col(Alias::new("alert_id"))
                .col(Alias::new("alert_fired_at")),
        )
        .foreign_key(
            ForeignKey::create()
                .from(
                    Alias::new("alert_incident_alerts"),
                    Alias::new("incident_id"),
                )
                .to(AlertIncidents::Table, AlertIncidents::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    Id,
    OrgId,
    Status,
    Severity,
    GroupValues,
    KeyType,
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

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_postgres_gin_up_contains_index_name() {
        assert!(POSTGRES_GIN_UP.contains("alert_incidents_group_idx"));
    }

    #[test]
    fn test_postgres_gin_down_contains_index_name() {
        assert!(POSTGRES_GIN_DOWN.contains("alert_incidents_group_idx"));
    }

    #[test]
    fn test_create_alert_incidents_table_contains_table_name() {
        let sql = create_alert_incidents_table().build(SqliteQueryBuilder);
        assert!(sql.contains("alert_incidents"));
    }

    #[test]
    fn test_recreate_alert_incident_alerts_table_contains_table_name() {
        let sql = recreate_alert_incident_alerts_table().build(SqliteQueryBuilder);
        assert!(sql.contains("alert_incident_alerts"));
    }
}
