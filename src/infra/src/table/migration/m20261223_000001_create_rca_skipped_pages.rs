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

use sea_orm_migration::prelude::*;

const RCA_RUNS: &str = "rca_runs";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(skipped_pages_table()).await?;
        for index in skipped_pages_indexes() {
            manager.create_index(index).await?;
        }
        manager.create_table(delivery_obligations_table()).await?;
        for index in delivery_obligations_indexes() {
            manager.create_index(index).await?;
        }
        // SQLite drops IF NOT EXISTS on columns, so retries must check each addition.
        if !manager.has_column(RCA_RUNS, "run_number").await? {
            manager.alter_table(run_number_column()).await?;
        }
        if !manager.has_column(RCA_RUNS, "fenced").await? {
            manager.alter_table(fenced_column()).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in [RcaRuns::Fenced, RcaRuns::RunNumber] {
            if manager.has_column(RCA_RUNS, &column.to_string()).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(RcaRuns::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        manager
            .drop_table(
                Table::drop()
                    .table(RcaDeliveryObligations::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(RcaSkippedPages::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RcaSkippedPages {
    Table,
    Id,
    OrgId,
    SubjectType,
    SubjectId,
    IncidentId,
    ResponseId,
    Reason,
    CoveringRunId,
    CoveringRunNumber,
    RetryAfterUs,
    CooldownUs,
    AtUs,
}

#[derive(DeriveIden)]
enum RcaDeliveryObligations {
    Table,
    Id,
    OrgId,
    RunId,
    ResponseId,
    Subject,
    LadderRun,
    Kind,
    State,
    Attempts,
    NextAttemptAt,
    Outcome,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RcaRuns {
    Table,
    RunNumber,
    Fenced,
}

fn skipped_pages_table() -> TableCreateStatement {
    Table::create()
        .table(RcaSkippedPages::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaSkippedPages::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::SubjectType)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::SubjectId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::IncidentId)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::ResponseId)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::Reason)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::CoveringRunId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::CoveringRunNumber)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::RetryAfterUs)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::CooldownUs)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::AtUs)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn skipped_pages_indexes() -> [IndexCreateStatement; 4] {
    [
        Index::create()
            .name("rca_skipped_pages_incident_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::IncidentId)
            .col(RcaSkippedPages::AtUs)
            .to_owned(),
        Index::create()
            .name("rca_skipped_pages_response_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::ResponseId)
            .to_owned(),
        Index::create()
            .name("rca_skipped_pages_covering_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::CoveringRunId)
            .to_owned(),
        Index::create()
            .name("rca_skipped_pages_subject_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::SubjectType)
            .col(RcaSkippedPages::SubjectId)
            .col(RcaSkippedPages::AtUs)
            .to_owned(),
    ]
}

fn delivery_obligations_table() -> TableCreateStatement {
    Table::create()
        .table(RcaDeliveryObligations::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaDeliveryObligations::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::RunId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::ResponseId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Subject)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::LadderRun)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Kind)
                .string_len(16)
                .null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::State)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Attempts)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::NextAttemptAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Outcome)
                .string_len(32)
                .null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn delivery_obligations_indexes() -> [IndexCreateStatement; 2] {
    [
        Index::create()
            .name("rca_delivery_obligations_due_idx")
            .if_not_exists()
            .table(RcaDeliveryObligations::Table)
            .col(RcaDeliveryObligations::State)
            .col(RcaDeliveryObligations::NextAttemptAt)
            .to_owned(),
        Index::create()
            .name("rca_delivery_obligations_run_idx")
            .if_not_exists()
            .table(RcaDeliveryObligations::Table)
            .col(RcaDeliveryObligations::OrgId)
            .col(RcaDeliveryObligations::RunId)
            .to_owned(),
    ]
}

fn run_number_column() -> TableAlterStatement {
    Table::alter()
        .table(RcaRuns::Table)
        .add_column(ColumnDef::new(RcaRuns::RunNumber).integer().null())
        .to_owned()
}

fn fenced_column() -> TableAlterStatement {
    Table::alter()
        .table(RcaRuns::Table)
        .add_column(
            ColumnDef::new(RcaRuns::Fenced)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres_statements_preserve_column_types_and_defaults() {
        assert_eq!(
            skipped_pages_table().to_string(PostgresQueryBuilder),
            concat!(
                "CREATE TABLE IF NOT EXISTS \"rca_skipped_pages\" ( ",
                "\"id\" varchar(64) NOT NULL PRIMARY KEY, ",
                "\"org_id\" varchar(256) NOT NULL, ",
                "\"subject_type\" varchar(16) NOT NULL, ",
                "\"subject_id\" varchar(256) NOT NULL, ",
                "\"incident_id\" varchar(256) NULL, ",
                "\"response_id\" varchar(256) NULL, ",
                "\"reason\" varchar(16) NOT NULL, ",
                "\"covering_run_id\" varchar(64) NOT NULL, ",
                "\"covering_run_number\" integer NULL, ",
                "\"retry_after_us\" bigint NULL, ",
                "\"cooldown_us\" bigint NULL, ",
                "\"at_us\" bigint NOT NULL )"
            )
        );
        assert_eq!(
            run_number_column().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "rca_runs" ADD COLUMN "run_number" integer NULL"#
        );
        assert_eq!(
            fenced_column().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "rca_runs" ADD COLUMN "fenced" bool NOT NULL DEFAULT FALSE"#
        );
    }

    #[tokio::test]
    async fn up_twice_preserves_existing_runs_and_down_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        up_and_down(&db).await;
    }

    /// The same on a fresh PostgreSQL database when `ZO_META_POSTGRES_DSN` is set.
    #[tokio::test]
    async fn up_and_down_on_postgres_when_configured() {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if dsn.trim().is_empty() {
            println!("ZO_META_POSTGRES_DSN unset; postgres arm skipped");
            return;
        }
        let name = format!(
            "rca_migration_{}",
            config::ider::generate().to_ascii_lowercase()
        );
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE DATABASE "{name}""#))
            .await
            .unwrap();
        let base = dsn.split('?').next().unwrap();
        let (server, _) = base.rsplit_once('/').unwrap();
        let db = Database::connect(format!("{server}/{name}")).await.unwrap();
        up_and_down(&db).await;
        db.close().await.unwrap();
        admin
            .execute_unprepared(&format!(r#"DROP DATABASE "{name}""#))
            .await
            .unwrap();
        println!("postgres arm ran");
    }

    async fn up_and_down(db: &sea_orm::DatabaseConnection) {
        db.execute_unprepared("CREATE TABLE rca_runs (run_id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO rca_runs VALUES ('old')")
            .await
            .unwrap();
        let manager = SchemaManager::new(db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT run_number, fenced FROM rca_runs WHERE run_id = 'old'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<Option<i32>>("", "run_number").unwrap(), None);
        assert!(!row.try_get::<bool>("", "fenced").unwrap());
        for (table, index) in [
            ("rca_skipped_pages", "rca_skipped_pages_incident_idx"),
            ("rca_skipped_pages", "rca_skipped_pages_response_idx"),
            ("rca_skipped_pages", "rca_skipped_pages_covering_idx"),
            ("rca_skipped_pages", "rca_skipped_pages_subject_idx"),
            (
                "rca_delivery_obligations",
                "rca_delivery_obligations_due_idx",
            ),
            (
                "rca_delivery_obligations",
                "rca_delivery_obligations_run_idx",
            ),
        ] {
            assert!(manager.has_index(table, index).await.unwrap(), "{index}");
        }
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(RCA_RUNS, "run_number").await.unwrap());
        assert!(!manager.has_column(RCA_RUNS, "fenced").await.unwrap());
        assert!(manager.has_column(RCA_RUNS, "run_id").await.unwrap());
        assert!(!manager.has_table("rca_skipped_pages").await.unwrap());
        assert!(!manager.has_table("rca_delivery_obligations").await.unwrap());
    }
}
