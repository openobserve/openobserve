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

//! Retypes `alerts.recovery_destinations` from text to json on Postgres to match the entity.

use sea_orm_migration::prelude::*;

const POSTGRES_ALTER_SQL: &str = "ALTER TABLE alerts ALTER COLUMN recovery_destinations TYPE json USING recovery_destinations::json";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        match backend {
            sea_orm::DbBackend::Postgres => {
                let db = manager.get_connection();
                db.execute(sea_orm::Statement::from_string(
                    backend,
                    POSTGRES_ALTER_SQL.to_string(),
                ))
                .await?;
            }
            _ => {
                // SQLite stores Json as text, so the existing column already decodes, no-op
            }
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverting to text would bring back the decode failure.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            POSTGRES_ALTER_SQL,
            "ALTER TABLE alerts ALTER COLUMN recovery_destinations TYPE json USING recovery_destinations::json"
        );
    }

    #[tokio::test]
    async fn postgres_text_column_becomes_json_when_ci_provides_postgres() {
        let Ok(dsn) = std::env::var("ZO_META_POSTGRES_DSN") else {
            return;
        };
        // The SQLite lane sets the variable to an empty string rather than leaving it unset.
        if dsn.trim().is_empty() {
            return;
        }
        let admin = Database::connect(&dsn).await.unwrap();
        let schema_name = format!(
            "recovery_destinations_test_{}",
            config::ider::uuid().to_ascii_lowercase()
        );
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema_name}""#))
            .await
            .unwrap();

        let mut options = ConnectOptions::new(dsn);
        options.max_connections(1).min_connections(1);
        let db = Database::connect(options).await.unwrap();
        db.execute_unprepared(&format!(r#"SET search_path TO "{schema_name}""#))
            .await
            .unwrap();
        db.execute_unprepared("CREATE TABLE alerts (id VARCHAR PRIMARY KEY)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        super::super::m20260928_000001_add_alert_recovery_destinations::Migration
            .up(&manager)
            .await
            .unwrap();
        assert_eq!(column_type(&db).await, "text");
        db.execute_unprepared(
            r#"INSERT INTO alerts (id, recovery_destinations) VALUES ('a', '["dest_recover"]')"#,
        )
        .await
        .unwrap();

        Migration.up(&manager).await.unwrap();

        assert_eq!(column_type(&db).await, "json");
        let row = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Postgres,
                "SELECT recovery_destinations FROM alerts WHERE id = 'a'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<Option<serde_json::Value>>("", "recovery_destinations")
                .unwrap(),
            Some(serde_json::json!(["dest_recover"]))
        );

        db.close().await.unwrap();
        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema_name}" CASCADE"#))
            .await
            .unwrap();
    }

    async fn column_type(db: &DatabaseConnection) -> String {
        let row = db
            .query_one(sea_orm::Statement::from_string(
                sea_orm::DbBackend::Postgres,
                "SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'alerts' AND column_name = 'recovery_destinations'",
            ))
            .await
            .unwrap()
            .unwrap();
        row.try_get("", "data_type").unwrap()
    }
}
