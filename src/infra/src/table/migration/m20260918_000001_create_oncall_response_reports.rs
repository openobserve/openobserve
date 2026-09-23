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

//! One row per L0 run, for both subject types — `topology_context` stays the incident's current
//! analysis, this is what the page said when it fired.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallResponseReports::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallResponseReports::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseReports::ResponseId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseReports::Report)
                            .custom(Alias::new(get_text_type()))
                            .not_null(),
                    )
                    .col(ColumnDef::new(OncallResponseReports::Model).string().null())
                    .col(
                        ColumnDef::new(OncallResponseReports::GeneratedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(OncallResponseReports::OrgId)
                            .col(OncallResponseReports::ResponseId),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(OncallResponseReports::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallResponseReports {
    Table,
    OrgId,
    ResponseId,
    Report,
    Model,
    GeneratedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    const TABLE: &str = "oncall_response_reports";

    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("SELECT name FROM pragma_table_info('{table}') ORDER BY name"),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    #[tokio::test]
    async fn test_up_creates_the_table_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        assert!(manager.has_table(TABLE).await.unwrap());
        assert_eq!(
            columns(&db, TABLE).await,
            vec!["generated_at", "model", "org_id", "report", "response_id",]
        );

        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_response_reports \
             (org_id, response_id, report, model, generated_at) \
             VALUES ('default', 'resp_1', '## RCA', 'claude', 1)"
                .to_owned(),
        ))
        .await
        .expect("a report must be insertable");
    }

    #[tokio::test]
    async fn test_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table(TABLE).await.unwrap());
        Migration.down(&manager).await.unwrap();
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260918_000001_create_oncall_response_reports"
        );
    }
}
