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

//! Adds source, merge key, streams, run count, last run and status to `query_history`.

use sea_orm_migration::prelude::*;

const TABLE: &str = "query_history";
const OLD_ORG_USER_CREATED_AT_IDX: &str = "query_history_org_user_created_at_idx";
const OLD_STARRED_CREATED_AT_IDX: &str = "query_history_starred_created_at_idx";
const ORG_USER_UPDATED_AT_IDX: &str = "query_history_org_user_updated_at_idx";
const ORG_USER_SOURCE_UPDATED_AT_IDX: &str = "query_history_org_user_source_updated_at_idx";
const STARRED_UPDATED_AT_IDX: &str = "query_history_starred_updated_at_idx";
const ORG_USER_SOURCE_KEY_UIDX: &str = "query_history_org_user_source_key_uidx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // NOT NULL DEFAULT keeps v1.1.x nodes inserting during a rolling upgrade.
        for mut def in [
            ColumnDef::new(QueryHistory::Source)
                .text()
                .not_null()
                .default("metrics")
                .to_owned(),
            ColumnDef::new(QueryHistory::QueryKey)
                .char_len(64)
                .null()
                .to_owned(),
            ColumnDef::new(QueryHistory::Streams)
                .text()
                .not_null()
                .default("")
                .to_owned(),
            ColumnDef::new(QueryHistory::RunCount)
                .big_integer()
                .not_null()
                .default(1)
                .to_owned(),
            ColumnDef::new(QueryHistory::UpdatedAt)
                .big_integer()
                .not_null()
                .default(0)
                .to_owned(),
            ColumnDef::new(QueryHistory::Status)
                .text()
                .not_null()
                .default("ok")
                .to_owned(),
        ] {
            add_column(manager, &mut def).await?;
        }
        // v1.1.x stored each row's last run in created_at; the guard makes a rerun a no-op.
        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE query_history SET updated_at = created_at WHERE updated_at < created_at",
            )
            .await?;
        for name in [OLD_ORG_USER_CREATED_AT_IDX, OLD_STARRED_CREATED_AT_IDX] {
            drop_index(manager, name).await?;
        }
        create_index(
            manager,
            ORG_USER_UPDATED_AT_IDX,
            &[
                QueryHistory::OrgId,
                QueryHistory::UserEmail,
                QueryHistory::UpdatedAt,
            ],
            false,
        )
        .await?;
        create_index(
            manager,
            ORG_USER_SOURCE_UPDATED_AT_IDX,
            &[
                QueryHistory::OrgId,
                QueryHistory::UserEmail,
                QueryHistory::Source,
                QueryHistory::UpdatedAt,
            ],
            false,
        )
        .await?;
        create_index(
            manager,
            STARRED_UPDATED_AT_IDX,
            &[QueryHistory::Starred, QueryHistory::UpdatedAt],
            false,
        )
        .await?;
        // NULL keys on v1.1.x rows are distinct, so they never collide here.
        create_index(
            manager,
            ORG_USER_SOURCE_KEY_UIDX,
            &[
                QueryHistory::OrgId,
                QueryHistory::UserEmail,
                QueryHistory::Source,
                QueryHistory::QueryKey,
            ],
            true,
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for name in [
            ORG_USER_SOURCE_KEY_UIDX,
            STARRED_UPDATED_AT_IDX,
            ORG_USER_SOURCE_UPDATED_AT_IDX,
            ORG_USER_UPDATED_AT_IDX,
        ] {
            drop_index(manager, name).await?;
        }
        // A repeated or partial rollback has already dropped updated_at.
        if manager
            .has_column(TABLE, &QueryHistory::UpdatedAt.to_string())
            .await?
        {
            manager
                .get_connection()
                .execute_unprepared(
                    "UPDATE query_history SET created_at = updated_at WHERE updated_at > created_at",
                )
                .await?;
        }
        create_index(
            manager,
            OLD_ORG_USER_CREATED_AT_IDX,
            &[
                QueryHistory::OrgId,
                QueryHistory::UserEmail,
                QueryHistory::CreatedAt,
            ],
            false,
        )
        .await?;
        create_index(
            manager,
            OLD_STARRED_CREATED_AT_IDX,
            &[QueryHistory::Starred, QueryHistory::CreatedAt],
            false,
        )
        .await?;
        for column in [
            QueryHistory::Status,
            QueryHistory::UpdatedAt,
            QueryHistory::RunCount,
            QueryHistory::Streams,
            QueryHistory::QueryKey,
            QueryHistory::Source,
        ] {
            if manager.has_column(TABLE, &column.to_string()).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(QueryHistory::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum QueryHistory {
    Table,
    OrgId,
    UserEmail,
    Starred,
    CreatedAt,
    Source,
    QueryKey,
    Streams,
    RunCount,
    UpdatedAt,
    Status,
}

async fn add_column(manager: &SchemaManager<'_>, def: &mut ColumnDef) -> Result<(), DbErr> {
    if manager.has_column(TABLE, &def.get_column_name()).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(QueryHistory::Table)
                .add_column(def.to_owned())
                .to_owned(),
        )
        .await
}

async fn drop_index(manager: &SchemaManager<'_>, name: &str) -> Result<(), DbErr> {
    manager
        .drop_index(
            Index::drop()
                .if_exists()
                .name(name)
                .table(QueryHistory::Table)
                .to_owned(),
        )
        .await
}

async fn create_index(
    manager: &SchemaManager<'_>,
    name: &str,
    columns: &[QueryHistory],
    unique: bool,
) -> Result<(), DbErr> {
    let mut index = Index::create();
    index.if_not_exists().name(name).table(QueryHistory::Table);
    if unique {
        index.unique();
    }
    for column in columns {
        index.col(*column);
    }
    manager.create_index(index.to_owned()).await
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    type Row = (
        String,
        String,
        Option<String>,
        String,
        i64,
        i64,
        i64,
        String,
    );

    async fn v1_1_table_with_rows() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        seed_v1_1_table(&db).await;
        db
    }

    async fn seed_v1_1_table(db: &DatabaseConnection) {
        super::super::m20261004_000001_create_query_history::Migration
            .up(&SchemaManager::new(db))
            .await
            .unwrap();
        for (id, starred, created_at) in [("old", false, 100), ("star", true, 200)] {
            db.execute_unprepared(&format!(
                "INSERT INTO query_history (id, org_id, user_email, query, context, starred, \
                 created_at) VALUES ('{id}', 'default', 'a@x.com', 'up', '{{\"step\":\"1m\"}}', \
                 {starred}, {created_at})"
            ))
            .await
            .unwrap();
        }
    }

    /// A throwaway schema on the CI Postgres; `None` where none is configured.
    async fn postgres_schema() -> Option<(DatabaseConnection, DatabaseConnection, String)> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        // The SQLite lane sets the variable empty rather than unsetting it.
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!(
            "qh_migration_test_{}",
            config::ider::generate().to_ascii_lowercase()
        );
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut options = sea_orm::ConnectOptions::new(dsn);
        options
            .max_connections(1)
            .set_schema_search_path(schema.clone());
        Some((admin, Database::connect(options).await.unwrap(), schema))
    }

    async fn rows(db: &DatabaseConnection) -> Vec<Row> {
        db.query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT id, source, query_key, streams, run_count, created_at, updated_at, status \
             FROM query_history ORDER BY id",
        ))
        .await
        .unwrap()
        .iter()
        .map(|r| {
            (
                r.try_get_by_index(0).unwrap(),
                r.try_get_by_index(1).unwrap(),
                r.try_get_by_index(2).unwrap(),
                r.try_get_by_index(3).unwrap(),
                r.try_get_by_index(4).unwrap(),
                r.try_get_by_index(5).unwrap(),
                r.try_get_by_index(6).unwrap(),
                r.try_get_by_index(7).unwrap(),
            )
        })
        .collect()
    }

    async fn index_columns(db: &DatabaseConnection, index: &str) -> Vec<Option<String>> {
        db.query_all(Statement::from_string(
            DbBackend::Sqlite,
            format!("SELECT name FROM pragma_index_info('{index}') ORDER BY seqno"),
        ))
        .await
        .unwrap()
        .iter()
        .map(|r| r.try_get::<Option<String>>("", "name").unwrap())
        .collect()
    }

    #[tokio::test]
    async fn test_up_backfills_updated_at_from_created_at_on_a_populated_v1_1_table() {
        let db = v1_1_table_with_rows().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();

        let to_row = |id: &str, created_at: i64, updated_at: i64| -> Row {
            (
                id.to_string(),
                "metrics".to_string(),
                None,
                String::new(),
                1,
                created_at,
                updated_at,
                "ok".to_string(),
            )
        };
        assert_eq!(
            rows(&db).await,
            vec![to_row("old", 100, 100), to_row("star", 200, 200)],
            "every v1.1.x row gets updated_at = created_at"
        );

        db.execute_unprepared("UPDATE query_history SET updated_at = 900 WHERE id = 'old'")
            .await
            .unwrap();
        Migration.up(&manager).await.expect("idempotent");
        assert_eq!(
            rows(&db).await,
            vec![to_row("old", 100, 900), to_row("star", 200, 200)],
            "a rerun leaves a row that ran after the upgrade alone"
        );

        let listed = crate::table::query_history::list_with(
            &db,
            "default",
            "a@x.com",
            &crate::table::query_history::ListFilter {
                sources: vec!["metrics".to_string()],
                ..Default::default()
            },
            10,
            0,
        )
        .await
        .unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|r| (r.id.as_str(), r.updated_at))
                .collect::<Vec<_>>(),
            vec![("old", 900), ("star", 200)]
        );
    }

    #[tokio::test]
    async fn test_up_swaps_indexes() {
        let db = v1_1_table_with_rows().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();

        for old in [OLD_ORG_USER_CREATED_AT_IDX, OLD_STARRED_CREATED_AT_IDX] {
            assert!(!manager.has_index(TABLE, old).await.unwrap(), "{old}");
        }
        let names = |cols: &[Option<&str>]| -> Vec<Option<String>> {
            cols.iter().map(|c| c.map(str::to_string)).collect()
        };
        assert_eq!(
            index_columns(&db, ORG_USER_UPDATED_AT_IDX).await,
            names(&[Some("org_id"), Some("user_email"), Some("updated_at")])
        );
        assert_eq!(
            index_columns(&db, ORG_USER_SOURCE_UPDATED_AT_IDX).await,
            names(&[
                Some("org_id"),
                Some("user_email"),
                Some("source"),
                Some("updated_at")
            ])
        );
        assert_eq!(
            index_columns(&db, STARRED_UPDATED_AT_IDX).await,
            names(&[Some("starred"), Some("updated_at")])
        );
        assert_eq!(
            index_columns(&db, ORG_USER_SOURCE_KEY_UIDX).await,
            names(&[
                Some("org_id"),
                Some("user_email"),
                Some("source"),
                Some("query_key")
            ])
        );
    }

    #[tokio::test]
    async fn test_up_leaves_exactly_the_agreed_index_set() {
        let db = v1_1_table_with_rows().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        let indexes: Vec<(String, bool)> = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT name, \"unique\" FROM pragma_index_list('query_history') \
                 WHERE origin = 'c' ORDER BY name",
            ))
            .await
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r.try_get_by_index(0).unwrap(),
                    r.try_get_by_index::<i64>(1).unwrap() == 1,
                )
            })
            .collect();
        assert_eq!(
            indexes,
            vec![
                (ORG_USER_SOURCE_KEY_UIDX.to_string(), true),
                (ORG_USER_SOURCE_UPDATED_AT_IDX.to_string(), false),
                (ORG_USER_UPDATED_AT_IDX.to_string(), false),
                (STARRED_UPDATED_AT_IDX.to_string(), false),
            ]
        );
    }

    #[tokio::test]
    async fn test_unique_key_allows_null_keys_and_refuses_a_duplicate_key() {
        let db = v1_1_table_with_rows().await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        let insert = |id: &str, key: &str| {
            format!(
                "INSERT INTO query_history (id, org_id, user_email, query, context, created_at, \
                 query_key) VALUES ('{id}', 'default', 'a@x.com', 'up', '{{}}', 1, {key})"
            )
        };
        db.execute_unprepared(&insert("legacy", "NULL"))
            .await
            .expect("a v1.1.x node inserts with no key");
        db.execute_unprepared(&insert("k1", "'abc'")).await.unwrap();
        assert!(db.execute_unprepared(&insert("k2", "'abc'")).await.is_err());
    }

    #[tokio::test]
    async fn test_down_restores_the_v1_1_table() {
        let db = v1_1_table_with_rows().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        for column in [
            "source",
            "query_key",
            "streams",
            "run_count",
            "updated_at",
            "status",
        ] {
            assert!(
                !manager.has_column(TABLE, column).await.unwrap(),
                "{column}"
            );
        }
        assert!(
            manager
                .has_index(TABLE, OLD_ORG_USER_CREATED_AT_IDX)
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index(TABLE, OLD_STARRED_CREATED_AT_IDX)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn test_down_keeps_the_last_run_of_rows_an_old_node_wrote() {
        let db = v1_1_table_with_rows().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        db.execute_unprepared(
            "INSERT INTO query_history (id, org_id, user_email, query, context, created_at) \
             VALUES ('mid', 'default', 'a@x.com', 'up', '{}', 300)",
        )
        .await
        .unwrap();
        db.execute_unprepared("UPDATE query_history SET updated_at = 900 WHERE id = 'old'")
            .await
            .unwrap();
        Migration.down(&manager).await.unwrap();

        let created: Vec<(String, i64)> = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT id, created_at FROM query_history ORDER BY id",
            ))
            .await
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r.try_get_by_index(0).unwrap(),
                    r.try_get_by_index(1).unwrap(),
                )
            })
            .collect();
        assert_eq!(
            created,
            vec![
                ("mid".to_string(), 300),
                ("old".to_string(), 900),
                ("star".to_string(), 200)
            ]
        );
    }

    #[tokio::test]
    async fn test_down_runs_twice() {
        let db = v1_1_table_with_rows().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        Migration
            .down(&manager)
            .await
            .expect("a second rollback is a no-op");
    }

    #[tokio::test]
    async fn test_postgres_up_and_down_on_a_populated_v1_1_table_when_ci_provides_it() {
        let Some((admin, db, schema)) = postgres_schema().await else {
            return;
        };
        seed_v1_1_table(&db).await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.expect("idempotent");

        for index in [
            ORG_USER_UPDATED_AT_IDX,
            ORG_USER_SOURCE_UPDATED_AT_IDX,
            STARRED_UPDATED_AT_IDX,
            ORG_USER_SOURCE_KEY_UIDX,
        ] {
            assert!(manager.has_index(TABLE, index).await.unwrap(), "{index}");
        }
        let listed = crate::table::query_history::list_with(
            &db,
            "default",
            "a@x.com",
            &crate::table::query_history::ListFilter {
                sources: vec!["metrics".to_string()],
                ..Default::default()
            },
            10,
            0,
        )
        .await
        .unwrap();
        // Postgres pads the char(27) id.
        assert_eq!(
            listed
                .iter()
                .map(|r| (r.id.trim(), r.updated_at))
                .collect::<Vec<_>>(),
            vec![("star", 200), ("old", 100)]
        );
        let insert = |id: &str| {
            format!(
                "INSERT INTO query_history (id, org_id, user_email, query, context, created_at, \
                 query_key) VALUES ('{id}', 'default', 'a@x.com', 'up', '{{}}', 1, 'abc')"
            )
        };
        db.execute_unprepared(&insert("k1")).await.unwrap();
        assert!(db.execute_unprepared(&insert("k2")).await.is_err());

        Migration.down(&manager).await.unwrap();
        Migration
            .down(&manager)
            .await
            .expect("a second rollback is a no-op");
        assert!(!manager.has_column(TABLE, "updated_at").await.unwrap());
        assert!(
            manager
                .has_index(TABLE, OLD_ORG_USER_CREATED_AT_IDX)
                .await
                .unwrap()
        );

        db.close().await.unwrap();
        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .await
            .unwrap();
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261027_000001_alter_query_history");
    }
}
