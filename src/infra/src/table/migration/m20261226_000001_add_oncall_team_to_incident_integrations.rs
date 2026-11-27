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

//! The on-call team an external alert source pages, overriding routing.

use sea_orm_migration::prelude::*;

const TABLE: &str = "incident_integrations";
const COLUMN: &str = "oncall_team";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip the column already added.
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(IncidentIntegrations::Table)
                    .drop_column(IncidentIntegrations::OncallTeam)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum IncidentIntegrations {
    Table,
    OncallTeam,
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(IncidentIntegrations::Table)
        .add_column(
            ColumnDef::new(IncidentIntegrations::OncallTeam)
                .string()
                .null(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_column_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "incident_integrations" ADD COLUMN "oncall_team" varchar NULL"#
        );
    }

    #[tokio::test]
    async fn existing_integrations_name_no_team_and_up_down_up_round_trips() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE incident_integrations (id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO incident_integrations VALUES ('old')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT oncall_team FROM incident_integrations WHERE id = 'old'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<Option<String>>("", COLUMN).unwrap(), None);
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, COLUMN).await.unwrap());
        Migration.down(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_column(TABLE, COLUMN).await.unwrap());
    }
}
