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

const UNRESOLVED_LAST_ALERT_IDX: &str = "alert_incidents_unresolved_last_alert_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(create_unresolved_last_alert_index())
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(UNRESOLVED_LAST_ALERT_IDX)
                    .table(AlertIncidents::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    Status,
    LastAlertAt,
}

// Must match the status filter in `stale_incidents_query`, or the planner cannot use this index.
fn create_unresolved_last_alert_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(UNRESOLVED_LAST_ALERT_IDX)
        .table(AlertIncidents::Table)
        .col(AlertIncidents::LastAlertAt)
        .and_where(Expr::col(AlertIncidents::Status).ne("resolved"))
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::ConnectionTrait;

    use super::*;

    #[test]
    fn the_partial_index_builds_on_both_backends() {
        let expected = r#"CREATE INDEX IF NOT EXISTS "alert_incidents_unresolved_last_alert_idx" ON "alert_incidents" ("last_alert_at") WHERE "status" <> 'resolved'"#;
        assert_eq!(
            create_unresolved_last_alert_index().to_string(PostgresQueryBuilder),
            expected
        );
        assert_eq!(
            create_unresolved_last_alert_index().to_string(SqliteQueryBuilder),
            expected
        );
    }

    #[tokio::test]
    async fn up_and_down_are_idempotent() {
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = sea_orm::Database::connect(opts).await.unwrap();
        let manager = SchemaManager::new(&db);
        db.execute_unprepared(
            "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY, status TEXT NOT NULL, \
             last_alert_at BIGINT NOT NULL)",
        )
        .await
        .unwrap();
        Migration.up(&manager).await.expect("first up");
        Migration.up(&manager).await.expect("second up");
        assert!(
            manager
                .has_index("alert_incidents", UNRESOLVED_LAST_ALERT_IDX)
                .await
                .unwrap()
        );
        Migration.down(&manager).await.expect("first down");
        Migration.down(&manager).await.expect("second down");
        assert!(
            !manager
                .has_index("alert_incidents", UNRESOLVED_LAST_ALERT_IDX)
                .await
                .unwrap()
        );
    }
}
