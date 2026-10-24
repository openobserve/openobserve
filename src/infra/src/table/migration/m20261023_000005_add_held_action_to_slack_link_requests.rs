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

const TABLE: &str = "slack_link_requests";
const COLUMN: &str = "held_action";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite emits a plain ADD COLUMN for add_column_if_not_exists, so guard explicitly.
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
                    .table(SlackLinkRequests::Table)
                    .drop_column(SlackLinkRequests::HeldAction)
                    .to_owned(),
            )
            .await
    }
}

/// Adds the column to a freshly created table (test setups that skip the migrator).
pub(crate) async fn add_column<C: sea_orm::ConnectionTrait>(db: &C) -> Result<(), DbErr> {
    let stmt = db.get_database_backend().build(&add_column_statement());
    db.execute(stmt).await.map(|_| ())
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(SlackLinkRequests::Table)
        .add_column(ColumnDef::new(SlackLinkRequests::HeldAction).text().null())
        .to_owned()
}

#[derive(DeriveIden)]
enum SlackLinkRequests {
    Table,
    HeldAction,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_column_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "slack_link_requests" ADD COLUMN "held_action" text NULL"#
        );
    }

    #[tokio::test]
    async fn up_reruns_without_adding_the_column_twice_and_down_removes_it() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared("CREATE TABLE slack_link_requests (id varchar(27) PRIMARY KEY)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(manager.has_column(TABLE, COLUMN).await.unwrap());

        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_column(TABLE, COLUMN).await.unwrap());
    }
}
