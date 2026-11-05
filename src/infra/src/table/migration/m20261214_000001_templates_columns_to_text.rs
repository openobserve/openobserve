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

//! Turns a `templates` column an earlier build of 141 or 142 created as json into text.

use sea_orm::{ConnectionTrait, DatabaseBackend};
use sea_orm_migration::prelude::*;

const COLUMNS: [(&str, &str); 2] = [
    ("downtime_notifications", "templates"),
    ("oncall_response_events", "templates"),
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite stores json as text already; only Postgres has a json column type.
        if manager.get_database_backend() != DatabaseBackend::Postgres {
            return Ok(());
        }
        for (table, column) in COLUMNS {
            if manager.has_column(table, column).await? {
                manager
                    .get_connection()
                    .execute_unprepared(&alter_sql(table, column))
                    .await?;
            }
        }
        Ok(())
    }

    /// The column stays text: that is what 141 and 142 create now.
    async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

fn alter_sql(table: &str, column: &str) -> String {
    format!(r#"ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE TEXT USING "{column}"::text"#)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_alter_casts_the_column_to_text() {
        assert_eq!(
            alter_sql("oncall_response_events", "templates"),
            r#"ALTER TABLE "oncall_response_events" ALTER COLUMN "templates" TYPE TEXT USING "templates"::text"#
        );
    }
}
