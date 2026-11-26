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

//! A counter every write of an incident's timeline raises, so a reader can ask "changed since?".

use sea_orm_migration::prelude::*;

const TABLE: &str = "incident_events";
const COLUMN: &str = "seq";

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
                    .table(IncidentEvents::Table)
                    .drop_column(IncidentEvents::Seq)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum IncidentEvents {
    Table,
    Seq,
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(IncidentEvents::Table)
        .add_column(
            ColumnDef::new(IncidentEvents::Seq)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::ConnectionTrait;

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_column_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "incident_events" ADD COLUMN "seq" bigint NOT NULL DEFAULT 0"#
        );
    }

    #[tokio::test]
    async fn existing_timelines_start_at_zero_and_a_rerun_is_a_no_op() {
        for db in crate::table::migration::sqlite_and_postgres_for_test("iev_seq").await {
            db.execute_unprepared(
                "CREATE TABLE incident_events (org_id TEXT NOT NULL, incident_id TEXT NOT NULL, \
                 events TEXT NOT NULL, PRIMARY KEY (org_id, incident_id))",
            )
            .await
            .unwrap();
            db.execute_unprepared("INSERT INTO incident_events VALUES ('o', 'old', '[]')")
                .await
                .unwrap();
            let manager = SchemaManager::new(&db);
            Migration.up(&manager).await.unwrap();
            Migration.up(&manager).await.unwrap();
            let row = db
                .query_one(sea_orm::Statement::from_string(
                    db.get_database_backend(),
                    "SELECT seq FROM incident_events WHERE incident_id = 'old'",
                ))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.try_get::<i64>("", "seq").unwrap(), 0);
        }
    }
}
