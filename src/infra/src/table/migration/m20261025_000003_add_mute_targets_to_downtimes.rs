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

const TABLE: &str = "downtimes";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, statement) in add_column_statements() {
            // SQLite emits a plain ADD COLUMN for add_column_if_not_exists, so guard explicitly.
            if !manager.has_column(TABLE, name).await? {
                manager.alter_table(statement).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, column) in [
            ("alert_groups", Downtimes::AlertGroups),
            ("end_on_clear", Downtimes::EndOnClear),
            ("mute_source", Downtimes::MuteSource),
        ] {
            if manager.has_column(TABLE, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Downtimes::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

fn add_column_statements() -> [(&'static str, TableAlterStatement); 3] {
    let add = |column: Downtimes| {
        Table::alter()
            .table(Downtimes::Table)
            .add_column(ColumnDef::new(column).text().null())
            .to_owned()
    };
    [
        ("alert_groups", add(Downtimes::AlertGroups)),
        ("end_on_clear", add(Downtimes::EndOnClear)),
        ("mute_source", add(Downtimes::MuteSource)),
    ]
}

#[derive(DeriveIden, Clone, Copy)]
enum Downtimes {
    Table,
    AlertGroups,
    EndOnClear,
    MuteSource,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        let sql: Vec<String> = add_column_statements()
            .iter()
            .map(|(_, s)| s.to_string(PostgresQueryBuilder))
            .collect();
        assert_eq!(
            sql,
            [
                r#"ALTER TABLE "downtimes" ADD COLUMN "alert_groups" text NULL"#,
                r#"ALTER TABLE "downtimes" ADD COLUMN "end_on_clear" text NULL"#,
                r#"ALTER TABLE "downtimes" ADD COLUMN "mute_source" text NULL"#,
            ]
        );
    }

    #[tokio::test]
    async fn up_reruns_and_down_removes_every_column() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE downtimes (id varchar(27) PRIMARY KEY)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        for column in ["alert_groups", "end_on_clear", "mute_source"] {
            assert!(manager.has_column(TABLE, column).await.unwrap(), "{column}");
        }
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        for column in ["alert_groups", "end_on_clear", "mute_source"] {
            assert!(
                !manager.has_column(TABLE, column).await.unwrap(),
                "{column}"
            );
        }
    }
}
