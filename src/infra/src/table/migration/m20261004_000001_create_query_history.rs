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

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ORG_USER_CREATED_AT_IDX: &str = "query_history_org_user_created_at_idx";
const STARRED_CREATED_AT_IDX: &str = "query_history_starred_created_at_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(QueryHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(QueryHistory::Id)
                            .char_len(27)
                            .primary_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(QueryHistory::OrgId).string().not_null())
                    .col(ColumnDef::new(QueryHistory::UserEmail).string().not_null())
                    .col(
                        ColumnDef::new(QueryHistory::Query)
                            .custom(Alias::new(get_text_type()))
                            .not_null(),
                    )
                    .col(ColumnDef::new(QueryHistory::Context).json().not_null())
                    .col(
                        ColumnDef::new(QueryHistory::Starred)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(QueryHistory::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(ORG_USER_CREATED_AT_IDX)
                    .table(QueryHistory::Table)
                    .col(QueryHistory::OrgId)
                    .col(QueryHistory::UserEmail)
                    .col(QueryHistory::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(STARRED_CREATED_AT_IDX)
                    .table(QueryHistory::Table)
                    .col(QueryHistory::Starred)
                    .col(QueryHistory::CreatedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(STARRED_CREATED_AT_IDX)
                    .table(QueryHistory::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(ORG_USER_CREATED_AT_IDX)
                    .table(QueryHistory::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(QueryHistory::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum QueryHistory {
    Table,
    Id,
    OrgId,
    UserEmail,
    Query,
    Context,
    Starred,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    const TABLE: &str = "query_history";

    async fn names(db: &DatabaseConnection, sql: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                sql.to_owned(),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    #[tokio::test]
    async fn test_up_creates_the_table_and_indexes_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        assert!(manager.has_table(TABLE).await.unwrap());
        assert_eq!(
            names(
                &db,
                "SELECT name FROM pragma_table_info('query_history') ORDER BY name"
            )
            .await,
            vec![
                "context",
                "created_at",
                "id",
                "org_id",
                "query",
                "starred",
                "user_email"
            ]
        );
        assert_eq!(
            names(
                &db,
                "SELECT name FROM pragma_index_info('query_history_org_user_created_at_idx') \
                 ORDER BY seqno"
            )
            .await,
            vec!["org_id", "user_email", "created_at"]
        );
        assert_eq!(
            names(
                &db,
                "SELECT name FROM pragma_index_info('query_history_starred_created_at_idx') \
                 ORDER BY seqno"
            )
            .await,
            vec!["starred", "created_at"]
        );

        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO query_history (id, org_id, user_email, query, context, created_at) \
             VALUES ('k1', 'default', 'a@x.com', 'up', '{}', 1)"
                .to_owned(),
        ))
        .await
        .expect("an entry must be insertable with starred defaulting");
    }

    #[tokio::test]
    async fn test_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table(TABLE).await.unwrap());
        Migration.down(&manager).await.unwrap();
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261004_000001_create_query_history");
    }
}
