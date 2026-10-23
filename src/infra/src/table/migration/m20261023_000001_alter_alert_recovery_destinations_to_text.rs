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

//! Turns a manually retyped json/jsonb `alerts.recovery_destinations` back into text on Postgres.

use sea_orm::{ConnectionTrait, Statement};
use sea_orm_migration::prelude::*;

const POSTGRES_COLUMN_TYPE_SQL: &str = "SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'alerts' AND column_name = 'recovery_destinations'";
const POSTGRES_ALTER_SQL: &str = "ALTER TABLE alerts ALTER COLUMN recovery_destinations TYPE text USING recovery_destinations::text";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        if backend != sea_orm::DbBackend::Postgres {
            return Ok(());
        }
        let db = manager.get_connection();
        let data_type: Option<String> = db
            .query_one(Statement::from_string(
                backend,
                POSTGRES_COLUMN_TYPE_SQL.to_string(),
            ))
            .await?
            .map(|row| row.try_get("", "data_type"))
            .transpose()?;
        // Skipping a text column avoids taking an ACCESS EXCLUSIVE lock on alerts for nothing.
        if !matches!(data_type.as_deref(), Some("json" | "jsonb")) {
            return Ok(());
        }
        db.execute(Statement::from_string(
            backend,
            POSTGRES_ALTER_SQL.to_string(),
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Going back to json would break decoding into the text entity field.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            POSTGRES_COLUMN_TYPE_SQL,
            "SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'alerts' AND column_name = 'recovery_destinations'"
        );
        assert_eq!(
            POSTGRES_ALTER_SQL,
            "ALTER TABLE alerts ALTER COLUMN recovery_destinations TYPE text USING recovery_destinations::text"
        );
    }
}
