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

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(subject_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(RcaFeedback::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RcaFeedback {
    Table,
    OrgId,
    RunId,
    AuthorEmail,
    IncidentId,
    SubjectType,
    SubjectId,
    Verdict,
    Cause,
    Note,
    Reasons,
    CreatedAt,
    UpdatedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(RcaFeedback::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaFeedback::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(RcaFeedback::RunId).string_len(32).not_null())
        .col(
            ColumnDef::new(RcaFeedback::AuthorEmail)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::IncidentId)
                .string_len(32)
                .null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::SubjectType)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::SubjectId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::Verdict)
                .string_len(8)
                .not_null(),
        )
        .col(ColumnDef::new(RcaFeedback::Cause).string_len(48).null())
        .col(ColumnDef::new(RcaFeedback::Note).text().null())
        .col(ColumnDef::new(RcaFeedback::Reasons).json_binary().null())
        .col(
            ColumnDef::new(RcaFeedback::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(RcaFeedback::OrgId)
                .col(RcaFeedback::RunId)
                .col(RcaFeedback::AuthorEmail),
        )
        .to_owned()
}

/// The past-cause read: a subject's corrections, newest first.
fn subject_index() -> IndexCreateStatement {
    Index::create()
        .name("rca_feedback_subject_idx")
        .if_not_exists()
        .table(RcaFeedback::Table)
        .col(RcaFeedback::OrgId)
        .col(RcaFeedback::SubjectType)
        .col(RcaFeedback::SubjectId)
        .col(RcaFeedback::UpdatedAt)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    async fn index_names(db: &sea_orm::DatabaseConnection) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rca_feedback' \
                 AND name NOT LIKE 'sqlite_%' ORDER BY name",
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261019_000001_create_rca_feedback");
    }

    /// Column types, nullability, the primary key and the subject index.
    #[test]
    fn rca_feedback_schema_matches_the_contract() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        for want in [
            "\"org_id\" varchar(256) NOT NULL",
            "\"run_id\" varchar(32) NOT NULL",
            "\"author_email\" varchar(256) NOT NULL",
            "\"incident_id\" varchar(32) NULL",
            "\"subject_type\" varchar(16) NOT NULL",
            "\"subject_id\" varchar(256) NOT NULL",
            "\"verdict\" varchar(8) NOT NULL",
            "\"cause\" varchar(48) NULL",
            "\"note\" text NULL",
            "\"reasons\" jsonb NULL",
            "\"created_at\" bigint NOT NULL",
            "\"updated_at\" bigint NOT NULL",
            "PRIMARY KEY (\"org_id\", \"run_id\", \"author_email\")",
        ] {
            assert!(sql.contains(want), "missing {want} in {sql}");
        }
        let idx = subject_index().to_string(PostgresQueryBuilder);
        assert!(
            idx.contains("\"rca_feedback_subject_idx\"")
                && idx.contains("(\"org_id\", \"subject_type\", \"subject_id\", \"updated_at\")"),
            "{idx}"
        );
        // The longest wire values fit their columns.
        use config::meta::alerts::rca_feedback::FeedbackVerdict;
        assert!(
            [FeedbackVerdict::Yes, FeedbackVerdict::No]
                .iter()
                .all(|v| v.as_str().len() <= 8)
        );
        assert!(
            config::meta::oncall::ResolutionCause::ALL
                .iter()
                .all(|c| c.as_str().len() <= 48)
        );
    }

    /// Up twice is idempotent; the primary key holds; down drops the table, also twice.
    #[tokio::test]
    async fn up_twice_is_idempotent_and_down_removes_the_table_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        assert!(!manager.has_table("rca_feedback").await.unwrap());

        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("re-running must skip what it created");
        assert!(manager.has_table("rca_feedback").await.unwrap());
        assert_eq!(index_names(&db).await, ["rca_feedback_subject_idx"]);

        let insert = |run: &str, author: &str| {
            format!(
                "INSERT INTO rca_feedback (org_id, run_id, author_email, subject_type, subject_id, \
                 verdict, reasons, created_at, updated_at) VALUES ('acme', '{run}', '{author}', \
                 'alert', 'alert_1', 'no', '[\"wrong_service\"]', 1, 1)"
            )
        };
        db.execute_unprepared(&insert("r1", "a.rao@acme.io"))
            .await
            .unwrap();
        db.execute_unprepared(&insert("r1", "b.kim@acme.io"))
            .await
            .expect("another author on the same run");
        db.execute_unprepared(&insert("r2", "a.rao@acme.io"))
            .await
            .expect("the same author on another run");
        assert!(
            db.execute_unprepared(&insert("r1", "a.rao@acme.io"))
                .await
                .is_err(),
            "(org_id, run_id, author_email) is the primary key"
        );

        Migration.down(&manager).await.unwrap();
        Migration
            .down(&manager)
            .await
            .expect("re-running down must skip what it dropped");
        assert!(!manager.has_table("rca_feedback").await.unwrap());
    }
}
