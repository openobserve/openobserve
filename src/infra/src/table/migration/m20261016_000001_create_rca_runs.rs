// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Creates `rca_runs` (one row per incident analysis run) and adds the run
//! summary of the latest run plus `rca_off_reason` to `alert_incidents`.
//!
//! All new `alert_incidents` columns are nullable: NULL means "never analyzed",
//! which is correct for every row until the backfill migration runs.

use sea_orm_migration::prelude::*;

const ALERT_INCIDENTS: &str = "alert_incidents";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(subject_index()).await?;
        manager.create_index(incident_index()).await?;
        // SQLite allows one alter option per ALTER TABLE (sea-query panics on more), and
        // `add_column_if_not_exists` is not idempotent there. Hence one guarded statement
        // per column.
        for (column, ty) in summary_columns() {
            add_column(manager, column, ty).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (column, _) in summary_columns().into_iter().rev() {
            if manager
                .has_column(ALERT_INCIDENTS, &column.to_string())
                .await?
            {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(ALERT_INCIDENTS))
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        manager
            .drop_table(Table::drop().table(RcaRuns::Table).if_exists().to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum RcaRuns {
    Table,
    RunId,
    OrgId,
    SubjectType,
    SubjectId,
    IncidentId,
    Trigger,
    Mode,
    StartedBy,
    Guidance,
    State,
    StartedAt,
    UpdatedAt,
    EndedAt,
    CancelledBy,
    Outcome,
    Confidence,
    Report,
    Result,
    Error,
    SessionId,
    Stats,
}

// The variants are sea-query column idents, so they keep the columns' shared `rca_` prefix.
#[allow(clippy::enum_variant_names)]
#[derive(DeriveIden, Clone, Copy)]
enum AlertIncidents {
    RcaRunId,
    RcaState,
    RcaStartedAt,
    RcaUpdatedAt,
    RcaOutcome,
    RcaConfidence,
    RcaSummary,
    RcaOffReason,
}

#[derive(Clone, Copy)]
enum ColType {
    String(u32),
    BigInt,
    Json,
}

fn summary_columns() -> [(AlertIncidents, ColType); 8] {
    [
        (AlertIncidents::RcaRunId, ColType::String(27)),
        (AlertIncidents::RcaState, ColType::String(16)),
        (AlertIncidents::RcaStartedAt, ColType::BigInt),
        (AlertIncidents::RcaUpdatedAt, ColType::BigInt),
        (AlertIncidents::RcaOutcome, ColType::String(32)),
        (AlertIncidents::RcaConfidence, ColType::String(8)),
        (AlertIncidents::RcaSummary, ColType::Json),
        (AlertIncidents::RcaOffReason, ColType::String(32)),
    ]
}

/// Add one nullable `alert_incidents` column, skipping it if already present, so a
/// migration interrupted partway can be retried.
async fn add_column(
    manager: &SchemaManager<'_>,
    column: AlertIncidents,
    ty: ColType,
) -> Result<(), DbErr> {
    if manager
        .has_column(ALERT_INCIDENTS, &column.to_string())
        .await?
    {
        return Ok(());
    }
    let mut def = ColumnDef::new(column);
    let def = match ty {
        ColType::String(len) => def.string_len(len),
        ColType::BigInt => def.big_integer(),
        ColType::Json => def.json_binary(),
    }
    .null()
    .to_owned();

    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(ALERT_INCIDENTS))
                .add_column(def)
                .to_owned(),
        )
        .await
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(RcaRuns::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaRuns::RunId)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(RcaRuns::OrgId).string_len(256).not_null())
        .col(
            ColumnDef::new(RcaRuns::SubjectType)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaRuns::SubjectId)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(RcaRuns::IncidentId).string_len(27).null())
        .col(ColumnDef::new(RcaRuns::Trigger).string_len(32).not_null())
        .col(ColumnDef::new(RcaRuns::Mode).string_len(24).not_null())
        .col(
            ColumnDef::new(RcaRuns::StartedBy)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(RcaRuns::Guidance).text().null())
        .col(ColumnDef::new(RcaRuns::State).string_len(16).not_null())
        .col(ColumnDef::new(RcaRuns::StartedAt).big_integer().not_null())
        .col(ColumnDef::new(RcaRuns::UpdatedAt).big_integer().not_null())
        .col(ColumnDef::new(RcaRuns::EndedAt).big_integer().null())
        .col(ColumnDef::new(RcaRuns::CancelledBy).string_len(256).null())
        .col(ColumnDef::new(RcaRuns::Outcome).string_len(32).null())
        .col(ColumnDef::new(RcaRuns::Confidence).string_len(8).null())
        .col(ColumnDef::new(RcaRuns::Report).text().null())
        .col(ColumnDef::new(RcaRuns::Result).json_binary().null())
        .col(ColumnDef::new(RcaRuns::Error).json_binary().null())
        .col(ColumnDef::new(RcaRuns::SessionId).string_len(64).null())
        .col(ColumnDef::new(RcaRuns::Stats).json_binary().null())
        .to_owned()
}

/// History list, prune (RR-25) and cooldown (RR-8).
fn subject_index() -> IndexCreateStatement {
    Index::create()
        .name("rca_runs_subject_idx")
        .if_not_exists()
        .table(RcaRuns::Table)
        .col(RcaRuns::OrgId)
        .col(RcaRuns::SubjectType)
        .col(RcaRuns::SubjectId)
        .col(RcaRuns::StartedAt)
        .to_owned()
}

/// Incident history that includes the page runs that came before the incident.
fn incident_index() -> IndexCreateStatement {
    Index::create()
        .name("rca_runs_incident_idx")
        .if_not_exists()
        .table(RcaRuns::Table)
        .col(RcaRuns::OrgId)
        .col(RcaRuns::IncidentId)
        .col(RcaRuns::StartedAt)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    const COLUMNS: [&str; 8] = [
        "rca_run_id",
        "rca_state",
        "rca_started_at",
        "rca_updated_at",
        "rca_outcome",
        "rca_confidence",
        "rca_summary",
        "rca_off_reason",
    ];

    #[test]
    fn rca_runs_schema_matches_the_design() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(
            sql.contains("\"run_id\" varchar(27) NOT NULL PRIMARY KEY"),
            "{sql}"
        );
        assert!(sql.contains("\"incident_id\" varchar(27) NULL"), "{sql}");
        assert!(sql.contains("\"state\" varchar(16) NOT NULL"), "{sql}");
        assert!(sql.contains("\"ended_at\" bigint NULL"), "{sql}");
        for json in ["result", "error", "stats"] {
            assert!(sql.contains(&format!("\"{json}\" jsonb NULL")), "{sql}");
        }
        let sql = subject_index().to_string(PostgresQueryBuilder);
        assert!(
            sql.contains(
                "\"rca_runs_subject_idx\" ON \"rca_runs\" (\"org_id\", \"subject_type\", \
                 \"subject_id\", \"started_at\")"
            ),
            "{sql}"
        );
        let sql = incident_index().to_string(PostgresQueryBuilder);
        assert!(
            sql.contains(
                "\"rca_runs_incident_idx\" ON \"rca_runs\" (\"org_id\", \"incident_id\", \
                 \"started_at\")"
            ),
            "{sql}"
        );
    }

    /// RR-24 migration A: `up` twice is idempotent; `down` drops the columns and the table.
    #[tokio::test]
    async fn up_twice_is_idempotent_and_down_removes_everything_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared("INSERT INTO alert_incidents (id, org_id) VALUES ('i1', 'acme')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        assert!(manager.has_table("rca_runs").await.unwrap());
        for index in ["rca_runs_subject_idx", "rca_runs_incident_idx"] {
            assert!(
                manager.has_index("rca_runs", index).await.unwrap(),
                "{index}"
            );
        }
        for column in COLUMNS {
            assert!(
                manager.has_column(ALERT_INCIDENTS, column).await.unwrap(),
                "{column}"
            );
        }
        // Existing rows read as never analyzed.
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT rca_run_id, rca_summary FROM alert_incidents WHERE id = 'i1'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<Option<String>>("", "rca_run_id").unwrap(),
            None
        );

        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("rca_runs").await.unwrap());
        for column in COLUMNS {
            assert!(
                !manager.has_column(ALERT_INCIDENTS, column).await.unwrap(),
                "{column}"
            );
        }
        assert!(manager.has_column(ALERT_INCIDENTS, "org_id").await.unwrap());
        Migration.down(&manager).await.unwrap();
    }
}
