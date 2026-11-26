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

use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};
use sea_orm_migration::{MigrationTrait, SchemaManager};

use crate::table::migration::{
    autoresolve_corrections_migration_for_test as corrections,
    autoresolve_migration_for_test as migration,
    autoresolve_plan_history_migration_for_test as plan_history,
};

/// SQLite, then a fresh Postgres schema when `ZO_META_POSTGRES_DSN` is set; tables created.
pub(crate) async fn backends() -> Vec<(&'static str, DatabaseConnection, Option<String>)> {
    let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
    opts.max_connections(1);
    let mut out = vec![("sqlite", Database::connect(opts).await.unwrap(), None)];
    if let Some(schema) = pg_schema().await {
        out.push(("postgres", pg_connection(&schema).await, Some(schema)));
    }
    for (_, db, _) in &out {
        migration().up(&SchemaManager::new(db)).await.unwrap();
        corrections().up(&SchemaManager::new(db)).await.unwrap();
        plan_history().up(&SchemaManager::new(db)).await.unwrap();
    }
    out
}

pub(crate) async fn drop_schema(schema: Option<String>) {
    let Some(schema) = schema else { return };
    let admin = Database::connect(std::env::var("ZO_META_POSTGRES_DSN").unwrap())
        .await
        .unwrap();
    admin
        .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
        .await
        .unwrap();
}

async fn pg_schema() -> Option<String> {
    let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
    if dsn.trim().is_empty() {
        return None;
    }
    let schema = format!(
        "autoresolve_test_{}",
        config::ider::generate().to_ascii_lowercase()
    );
    let admin = Database::connect(&dsn).await.unwrap();
    admin
        .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
        .await
        .unwrap();
    Some(schema)
}

async fn pg_connection(schema: &str) -> DatabaseConnection {
    let mut options = ConnectOptions::new(std::env::var("ZO_META_POSTGRES_DSN").unwrap());
    options
        .max_connections(1)
        .set_schema_search_path(schema.to_string());
    Database::connect(options).await.unwrap()
}
