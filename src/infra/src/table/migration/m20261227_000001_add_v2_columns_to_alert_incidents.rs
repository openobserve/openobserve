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

//! The Phase 1 Incidents v2 columns of `alert_incidents` and the indexes their readers use.

use sea_orm_migration::prelude::*;

const TABLE: &str = "alert_incidents";

/// Index name and its columns after `org_id`.
const INDEXES: &[(&str, &[AlertIncidents])] = &[
    (
        "alert_incidents_org_status_severity_first_idx",
        &[
            AlertIncidents::Status,
            AlertIncidents::Severity,
            AlertIncidents::FirstAlertAt,
        ],
    ),
    (
        "alert_incidents_org_owner_team_status_idx",
        &[AlertIncidents::OwnerTeamId, AlertIncidents::Status],
    ),
    (
        "alert_incidents_org_not_recovering_idx",
        &[AlertIncidents::NotRecoveringAt],
    ),
    (
        "alert_incidents_org_fingerprint_first_idx",
        &[
            AlertIncidents::GroupFingerprint,
            AlertIncidents::FirstAlertAt,
        ],
    ),
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in columns() {
            let name = column.get_column_name();
            // SQLite drops IF NOT EXISTS, so a retry must skip the columns already added.
            if manager.has_column(TABLE, &name).await? {
                continue;
            }
            manager.alter_table(add_column_statement(column)).await?;
        }
        for index in index_statements() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, _) in INDEXES {
            manager
                .drop_index(Index::drop().if_exists().name(*name).to_owned())
                .await?;
        }
        for column in columns() {
            let name = column.get_column_name();
            if !manager.has_column(TABLE, &name).await? {
                continue;
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(AlertIncidents::Table)
                        .drop_column(Alias::new(name))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AlertIncidents {
    Table,
    OrgId,
    Status,
    Severity,
    FirstAlertAt,
    OwnerTeamId,
    CommsOwner,
    FirstOpenedAt,
    FixAppliedAt,
    FixAppliedBy,
    FixAttemptId,
    NotRecoveringAt,
    RecoveryDueAt,
    MitigatedAt,
    RecoveredAt,
    ImpactStartAt,
    ImpactEndAt,
    CustomerImpact,
    ResolutionCause,
    ResolutionNote,
    ResolvedBy,
    CauseReviewedBy,
    CauseReviewedAt,
    ImpactHeadline,
    CauseLine,
    GroupFingerprint,
    MergedIntoId,
    ReopenCount,
}

fn string(column: AlertIncidents, len: u32) -> ColumnDef {
    ColumnDef::new(column).string_len(len).null().to_owned()
}

fn micros(column: AlertIncidents) -> ColumnDef {
    ColumnDef::new(column).big_integer().null().to_owned()
}

/// The 23 Phase 1 columns of design 6.1, in its order.
fn columns() -> Vec<ColumnDef> {
    use AlertIncidents as C;
    vec![
        string(C::OwnerTeamId, 64),
        string(C::CommsOwner, 256),
        micros(C::FirstOpenedAt),
        micros(C::FixAppliedAt),
        string(C::FixAppliedBy, 256),
        string(C::FixAttemptId, 27),
        micros(C::NotRecoveringAt),
        micros(C::RecoveryDueAt),
        micros(C::MitigatedAt),
        micros(C::RecoveredAt),
        micros(C::ImpactStartAt),
        micros(C::ImpactEndAt),
        string(C::CustomerImpact, 16),
        string(C::ResolutionCause, 32),
        ColumnDef::new(C::ResolutionNote).text().null().to_owned(),
        string(C::ResolvedBy, 256),
        string(C::CauseReviewedBy, 256),
        micros(C::CauseReviewedAt),
        string(C::ImpactHeadline, 256),
        string(C::CauseLine, 256),
        string(C::GroupFingerprint, 64),
        string(C::MergedIntoId, 27),
        ColumnDef::new(C::ReopenCount)
            .integer()
            .not_null()
            .default(0)
            .to_owned(),
    ]
}

fn add_column_statement(mut column: ColumnDef) -> TableAlterStatement {
    Table::alter()
        .table(AlertIncidents::Table)
        .add_column(&mut column)
        .to_owned()
}

fn index_statements() -> Vec<IndexCreateStatement> {
    INDEXES
        .iter()
        .map(|(name, rest)| {
            let mut index = Index::create();
            index
                .if_not_exists()
                .name(*name)
                .table(AlertIncidents::Table)
                .col(AlertIncidents::OrgId);
            for column in *rest {
                index.col(*column);
            }
            index.to_owned()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use sea_orm::ConnectionTrait;

    use super::*;

    #[test]
    fn exactly_the_phase_one_columns_and_no_phase_two_one() {
        let names: Vec<String> = columns().iter().map(|c| c.get_column_name()).collect();
        assert_eq!(names.len(), 23);
        for p2 in [
            "home_region",
            "home_seq",
            "fields_version",
            "published_version",
            "declare_key",
        ] {
            assert!(!names.iter().any(|n| n == p2), "{p2} is not Phase 1");
        }
        assert_eq!(
            &add_column_statement(columns().pop().unwrap()).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_incidents" ADD COLUMN "reopen_count" integer NOT NULL DEFAULT 0"#
        );
        assert_eq!(
            &add_column_statement(columns().remove(0)).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_incidents" ADD COLUMN "owner_team_id" varchar(64) NULL"#
        );
    }

    #[tokio::test]
    async fn existing_rows_keep_their_values_and_a_rerun_is_a_no_op() {
        for db in crate::table::migration::sqlite_and_postgres_for_test("ai_v2_cols").await {
            db.execute_unprepared(
                "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, \
                 status TEXT NOT NULL, severity TEXT NOT NULL, first_alert_at BIGINT NOT NULL)",
            )
            .await
            .unwrap();
            db.execute_unprepared(
                "INSERT INTO alert_incidents VALUES ('old', 'o', 'open', 'P2', 42)",
            )
            .await
            .unwrap();
            let manager = SchemaManager::new(&db);
            Migration.up(&manager).await.unwrap();
            Migration.up(&manager).await.unwrap();
            let row = db
                .query_one(sea_orm::Statement::from_string(
                    db.get_database_backend(),
                    "SELECT status, first_alert_at, reopen_count, owner_team_id, \
                     impact_start_at FROM alert_incidents WHERE id = 'old'",
                ))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.try_get::<String>("", "status").unwrap(), "open");
            assert_eq!(row.try_get::<i64>("", "first_alert_at").unwrap(), 42);
            assert_eq!(row.try_get::<i32>("", "reopen_count").unwrap(), 0);
            assert_eq!(
                row.try_get::<Option<String>>("", "owner_team_id").unwrap(),
                None
            );
            assert_eq!(
                row.try_get::<Option<i64>>("", "impact_start_at").unwrap(),
                None
            );
            for (name, _) in INDEXES {
                assert!(manager.has_index(TABLE, name).await.unwrap(), "{name}");
            }
            Migration.down(&manager).await.unwrap();
            assert!(!manager.has_column(TABLE, "reopen_count").await.unwrap());
        }
    }
}
