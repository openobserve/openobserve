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

//! Creates `rca_feedback`: "Was this the cause?" answers, one per RCA report and user.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(unique_statement()).await?;
        manager.create_index(caller_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RcaFeedback::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum RcaFeedback {
    Table,
    Id,
    OrgId,
    IncidentId,
    ReportId,
    UserEmail,
    Outcome,
    Reason,
    CreatedAt,
    UpdatedAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(RcaFeedback::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaFeedback::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RcaFeedback::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::IncidentId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::ReportId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::UserEmail)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaFeedback::Outcome)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(RcaFeedback::Reason).text().null())
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
        .to_owned()
}

fn unique_statement() -> IndexCreateStatement {
    Index::create()
        .name("uq_rca_feedback_org_report_user")
        .if_not_exists()
        .unique()
        .table(RcaFeedback::Table)
        .col(RcaFeedback::OrgId)
        .col(RcaFeedback::ReportId)
        .col(RcaFeedback::UserEmail)
        .to_owned()
}

/// History reads one caller's answers for one incident.
fn caller_statement() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("idx_rca_feedback_org_incident_user")
        .table(RcaFeedback::Table)
        .col(RcaFeedback::OrgId)
        .col(RcaFeedback::IncidentId)
        .col(RcaFeedback::UserEmail)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;

    #[tokio::test]
    async fn up_is_idempotent_and_down_drops() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table("rca_feedback").await.unwrap());
        assert!(
            manager
                .has_index("rca_feedback", "uq_rca_feedback_org_report_user")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index("rca_feedback", "idx_rca_feedback_org_incident_user")
                .await
                .unwrap()
        );
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("rca_feedback").await.unwrap());
    }
}
