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
        for (table, column, boolean) in [
            ("alerts", "query_promql_rule_mode", true),
            ("alert_state_transitions", "rule_value", false),
        ] {
            if !manager.has_column(table, column).await? {
                let mut definition = ColumnDef::new(Alias::new(column));
                if boolean {
                    definition.boolean();
                } else {
                    definition.text();
                }
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .add_column(definition.null().to_owned())
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, column) in [
            ("alert_state_transitions", "rule_value"),
            ("alerts", "query_promql_rule_mode"),
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(table))
                        .drop_column(Alias::new(column))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[tokio::test]
    async fn migration_is_additive_nullable_and_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE alerts (id INTEGER PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("CREATE TABLE alert_state_transitions (id INTEGER PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO alerts (id) VALUES (1)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column("alerts", "query_promql_rule_mode")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_column("alert_state_transitions", "rule_value")
                .await
                .unwrap()
        );
        let row = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DatabaseBackend::Sqlite,
                "SELECT query_promql_rule_mode FROM alerts WHERE id=1",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<Option<bool>>("", "query_promql_rule_mode")
                .unwrap(),
            None
        );
    }
}
