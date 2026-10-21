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

//! The responder's cause correction moves from run feedback (`verdict = 'change'`) to the
//! incident: `rca_cause_corrections` holds one row per incident and author, and
//! `rca_feedback` loses its `change` rows, its `cause` column and its subject index.
//! `change` rows are dropped, not copied: the feature never shipped.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(subject_index()).await?;

        if manager.has_column("rca_feedback", "cause").await? {
            manager
                .exec_stmt(
                    Query::delete()
                        .from_table(RcaFeedback::Table)
                        .and_where(Expr::col(RcaFeedback::Verdict).eq("change"))
                        .to_owned(),
                )
                .await?;
            manager
                .drop_index(
                    Index::drop()
                        .name(FEEDBACK_SUBJECT_INDEX)
                        .table(RcaFeedback::Table)
                        .if_exists()
                        .to_owned(),
                )
                .await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(RcaFeedback::Table)
                        .drop_column(RcaFeedback::Cause)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("rca_feedback", "cause").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(RcaFeedback::Table)
                        .add_column(ColumnDef::new(RcaFeedback::Cause).string_len(48).null())
                        .to_owned(),
                )
                .await?;
            manager
                .create_index(
                    Index::create()
                        .name(FEEDBACK_SUBJECT_INDEX)
                        .if_not_exists()
                        .table(RcaFeedback::Table)
                        .col(RcaFeedback::OrgId)
                        .col(RcaFeedback::SubjectType)
                        .col(RcaFeedback::SubjectId)
                        .col(RcaFeedback::UpdatedAt)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(RcaCauseCorrections::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

const FEEDBACK_SUBJECT_INDEX: &str = "rca_feedback_subject_idx";

#[derive(DeriveIden)]
enum RcaFeedback {
    Table,
    OrgId,
    SubjectType,
    SubjectId,
    Verdict,
    Cause,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RcaCauseCorrections {
    Table,
    OrgId,
    IncidentId,
    AuthorEmail,
    SubjectType,
    SubjectId,
    Cause,
    Note,
    CreatedAt,
    UpdatedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(RcaCauseCorrections::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaCauseCorrections::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaCauseCorrections::IncidentId)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaCauseCorrections::AuthorEmail)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaCauseCorrections::SubjectType)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaCauseCorrections::SubjectId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaCauseCorrections::Cause)
                .string_len(48)
                .not_null(),
        )
        .col(ColumnDef::new(RcaCauseCorrections::Note).text().null())
        .col(
            ColumnDef::new(RcaCauseCorrections::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaCauseCorrections::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(RcaCauseCorrections::OrgId)
                .col(RcaCauseCorrections::IncidentId)
                .col(RcaCauseCorrections::AuthorEmail),
        )
        .to_owned()
}

/// The past-cause read: a subject's corrections, newest first.
fn subject_index() -> IndexCreateStatement {
    Index::create()
        .name("rca_cause_corrections_subject_idx")
        .if_not_exists()
        .table(RcaCauseCorrections::Table)
        .col(RcaCauseCorrections::OrgId)
        .col(RcaCauseCorrections::SubjectType)
        .col(RcaCauseCorrections::SubjectId)
        .col(RcaCauseCorrections::UpdatedAt)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    async fn index_names(db: &sea_orm::DatabaseConnection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                format!(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '{table}' \
                     AND name NOT LIKE 'sqlite_%' ORDER BY name"
                ),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    async fn verdicts(db: &sea_orm::DatabaseConnection) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                "SELECT verdict FROM rca_feedback ORDER BY run_id",
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "verdict").unwrap())
            .collect()
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261021_000001_create_rca_cause_corrections"
        );
    }

    /// Column types, nullability, the primary key and the subject index.
    #[test]
    fn rca_cause_corrections_schema_matches_the_contract() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        for want in [
            "\"org_id\" varchar(256) NOT NULL",
            "\"incident_id\" varchar(32) NOT NULL",
            "\"author_email\" varchar(256) NOT NULL",
            "\"subject_type\" varchar(16) NOT NULL",
            "\"subject_id\" varchar(256) NOT NULL",
            "\"cause\" varchar(48) NOT NULL",
            "\"note\" text NULL",
            "\"created_at\" bigint NOT NULL",
            "\"updated_at\" bigint NOT NULL",
            "PRIMARY KEY (\"org_id\", \"incident_id\", \"author_email\")",
        ] {
            assert!(sql.contains(want), "missing {want} in {sql}");
        }
        let idx = subject_index().to_string(PostgresQueryBuilder);
        assert!(
            idx.contains("\"rca_cause_corrections_subject_idx\"")
                && idx.contains("(\"org_id\", \"subject_type\", \"subject_id\", \"updated_at\")"),
            "{idx}"
        );
        assert!(
            config::meta::oncall::ResolutionCause::ALL
                .iter()
                .all(|c| c.as_str().len() <= 48)
        );
    }

    /// On top of the `rca_feedback` migration: `change` rows, the `cause` column and the subject
    /// index go; up and down are each idempotent.
    #[tokio::test]
    async fn up_moves_corrections_off_feedback_and_down_restores_it_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        super::super::m20261019_000001_create_rca_feedback::Migration
            .up(&manager)
            .await
            .unwrap();
        for (run, verdict, cause) in [
            ("r1", "yes", "NULL"),
            ("r2", "change", "'capacity_or_load'"),
            ("r3", "no", "NULL"),
        ] {
            db.execute_unprepared(&format!(
                "INSERT INTO rca_feedback (org_id, run_id, author_email, subject_type, subject_id, \
                 verdict, cause, created_at, updated_at) VALUES ('acme', '{run}', 'a.rao@acme.io', \
                 'incident', 'inc_1', '{verdict}', {cause}, 1, 1)"
            ))
            .await
            .unwrap();
        }

        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must skip what it did");
        assert!(manager.has_table("rca_cause_corrections").await.unwrap());
        assert_eq!(
            index_names(&db, "rca_cause_corrections").await,
            ["rca_cause_corrections_subject_idx"]
        );
        assert_eq!(verdicts(&db).await, ["yes", "no"], "`change` rows are gone");
        assert!(!manager.has_column("rca_feedback", "cause").await.unwrap());
        assert!(index_names(&db, "rca_feedback").await.is_empty());

        let insert = |incident: &str, author: &str| {
            format!(
                "INSERT INTO rca_cause_corrections (org_id, incident_id, author_email, \
                 subject_type, subject_id, cause, created_at, updated_at) VALUES ('acme', \
                 '{incident}', '{author}', 'incident', '{incident}', 'capacity_or_load', 1, 1)"
            )
        };
        db.execute_unprepared(&insert("inc_1", "a.rao@acme.io"))
            .await
            .unwrap();
        db.execute_unprepared(&insert("inc_1", "b.kim@acme.io"))
            .await
            .expect("another author on the same incident");
        db.execute_unprepared(&insert("inc_2", "a.rao@acme.io"))
            .await
            .expect("the same author on another incident");
        assert!(
            db.execute_unprepared(&insert("inc_1", "a.rao@acme.io"))
                .await
                .is_err(),
            "(org_id, incident_id, author_email) is the primary key"
        );

        Migration.down(&manager).await.unwrap();
        Migration
            .down(&manager)
            .await
            .expect("re-running down must skip what it undid");
        assert!(!manager.has_table("rca_cause_corrections").await.unwrap());
        assert!(manager.has_column("rca_feedback", "cause").await.unwrap());
        assert_eq!(
            index_names(&db, "rca_feedback").await,
            ["rca_feedback_subject_idx"]
        );
    }
}
