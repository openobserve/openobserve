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
//! Adds the Not measured gap state to `synthetics`, so each gap sends one notice pair.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // `has_column` keeps this idempotent.
        for (name, column, big) in columns() {
            if manager.has_column(TABLE, name).await? {
                continue;
            }
            let mut def = ColumnDef::new(column);
            if big {
                def.big_integer();
            } else {
                def.integer();
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Synthetics::Table)
                        .add_column(def.not_null().default(0))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, column, _) in columns() {
            if manager.has_column(TABLE, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Synthetics::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

const TABLE: &str = "synthetics";

#[derive(DeriveIden)]
enum Synthetics {
    Table,
    GapSince,
    GapRuns,
    GapNotifiedAt,
    GapResumedAt,
}

fn columns() -> [(&'static str, Synthetics, bool); 4] {
    [
        ("gap_since", Synthetics::GapSince, true),
        ("gap_runs", Synthetics::GapRuns, false),
        ("gap_notified_at", Synthetics::GapNotifiedAt, true),
        ("gap_resumed_at", Synthetics::GapResumedAt, true),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[tokio::test]
    async fn existing_rows_get_no_gap_and_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE synthetics (id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO synthetics (id) VALUES ('mon-1')")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT gap_since, gap_runs, gap_notified_at, gap_resumed_at FROM synthetics",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "gap_since").unwrap(), 0);
        assert_eq!(row.try_get::<i32>("", "gap_runs").unwrap(), 0);
        assert_eq!(row.try_get::<i64>("", "gap_notified_at").unwrap(), 0);
        assert_eq!(row.try_get::<i64>("", "gap_resumed_at").unwrap(), 0);
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, "gap_since").await.unwrap());
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261103_000003_add_gap_state_to_synthetics"
        );
    }
}
