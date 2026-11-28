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

//! Secret store columns on the synthetics tables, plus `synthetics_env_retired`.

use sea_orm_migration::prelude::*;

use super::m20261229_000006_probe_token_partial_unique::TOKEN_SHA256_PARTIAL_INDEX;

pub(crate) const TOKEN_SHA256_INDEX: &str = "synthetics_probe_tokens_token_sha256_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, column, def) in added_columns() {
            // SQLite drops IF NOT EXISTS on ADD COLUMN, so a retry must skip a column already
            // added.
            if manager.has_column(table, column).await? {
                continue;
            }
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(table))
                        .add_column(def)
                        .to_owned(),
                )
                .await?;
        }
        manager.create_index(token_sha256_index()).await?;
        manager.create_table(env_retired_table()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SyntheticsEnvRetired::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(TOKEN_SHA256_INDEX)
                    .table(Alias::new("synthetics_probe_tokens"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        // A later migration's partial index on token_sha256 blocks SQLite's DROP COLUMN.
        manager
            .drop_index(
                Index::drop()
                    .name(TOKEN_SHA256_PARTIAL_INDEX)
                    .table(Alias::new("synthetics_probe_tokens"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        for (table, column, _) in added_columns().into_iter().rev() {
            if !manager.has_column(table, column).await? {
                continue;
            }
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

#[derive(DeriveIden, Clone, Copy)]
enum SyntheticsEnvRetired {
    Table,
    OrgId,
    EnvId,
    RetiredCreatedAt,
}

/// One column per statement: SQLite's `ALTER TABLE` takes a single change at a time.
fn added_columns() -> Vec<(&'static str, &'static str, ColumnDef)> {
    let text = |name: &'static str, len: u32| {
        ColumnDef::new(Alias::new(name))
            .string_len(len)
            .not_null()
            .default("")
            .to_owned()
    };
    let nullable = |name: &'static str, len: u32| {
        ColumnDef::new(Alias::new(name))
            .string_len(len)
            .null()
            .to_owned()
    };
    vec![
        (
            "synthetics_environments",
            "incarnation",
            text("incarnation", 27),
        ),
        (
            "synthetics_probe_tokens",
            "token_sha256",
            text("token_sha256", 64),
        ),
        (
            "synthetics_probe_tokens",
            "token_ref",
            nullable("token_ref", 27),
        ),
        (
            "synthetics_jobs",
            "lease_token_sha256",
            nullable("lease_token_sha256", 64),
        ),
        (
            "synthetics_jobs",
            "lease_issuer",
            nullable("lease_issuer", 16),
        ),
        (
            "synthetics_jobs",
            "env_incarnation",
            nullable("env_incarnation", 27),
        ),
        (
            "synthetics_agents",
            "last_tokenless_credential_resolve_at",
            ColumnDef::new(Alias::new("last_tokenless_credential_resolve_at"))
                .big_integer()
                .null()
                .to_owned(),
        ),
    ]
}

/// Non-unique until P1-11 makes it partial unique over non-blank hashes.
fn token_sha256_index() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(TOKEN_SHA256_INDEX)
        .table(Alias::new("synthetics_probe_tokens"))
        .col(Alias::new("token_sha256"))
        .to_owned()
}

fn env_retired_table() -> TableCreateStatement {
    use SyntheticsEnvRetired as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(ColumnDef::new(T::OrgId).string_len(256).not_null())
        .col(ColumnDef::new(T::EnvId).string_len(256).not_null())
        .col(ColumnDef::new(T::RetiredCreatedAt).big_integer().not_null())
        .primary_key(Index::create().col(T::OrgId).col(T::EnvId))
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement, TransactionTrait};

    use super::*;
    use crate::table::testing::meta_store;

    async fn seeded() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE synthetics_environments (id TEXT PRIMARY KEY, org_id TEXT NOT NULL)",
            "CREATE TABLE synthetics_probe_tokens (id TEXT PRIMARY KEY, token TEXT NOT NULL)",
            "CREATE TABLE synthetics_jobs (id TEXT PRIMARY KEY)",
            "CREATE TABLE synthetics_agents (id TEXT PRIMARY KEY)",
            "INSERT INTO synthetics_environments VALUES ('acme/prod', 'acme')",
            "INSERT INTO synthetics_probe_tokens VALUES ('t1', 'o2syn_x')",
            "INSERT INTO synthetics_jobs VALUES ('j1')",
            "INSERT INTO synthetics_agents VALUES ('a1')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        db
    }

    async fn one(db: &DatabaseConnection, sql: &str) -> Option<sea_orm::QueryResult> {
        db.query_one(Statement::from_string(db.get_database_backend(), sql))
            .await
            .unwrap()
    }

    #[test]
    fn postgres_statements() {
        assert_eq!(
            token_sha256_index().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "synthetics_probe_tokens_token_sha256_idx" ON "synthetics_probe_tokens" ("token_sha256")"#
        );
        let (_, _, def) = added_columns().remove(0);
        assert_eq!(
            Table::alter()
                .table(Alias::new("synthetics_environments"))
                .add_column(def)
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics_environments" ADD COLUMN "incarnation" varchar(27) NOT NULL DEFAULT ''"#
        );
    }

    #[tokio::test]
    async fn seeded_rows_get_blank_or_null_columns_and_up_down_up_round_trips() {
        let db = seeded().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        let env = one(&db, "SELECT incarnation FROM synthetics_environments")
            .await
            .unwrap();
        assert_eq!(env.try_get::<String>("", "incarnation").unwrap(), "");
        let token = one(
            &db,
            "SELECT token_sha256, token_ref, token FROM synthetics_probe_tokens",
        )
        .await
        .unwrap();
        assert_eq!(token.try_get::<String>("", "token_sha256").unwrap(), "");
        assert_eq!(
            token.try_get::<Option<String>>("", "token_ref").unwrap(),
            None
        );
        assert_eq!(token.try_get::<String>("", "token").unwrap(), "o2syn_x");
        let job = one(
            &db,
            "SELECT lease_token_sha256, lease_issuer, env_incarnation FROM synthetics_jobs",
        )
        .await
        .unwrap();
        for col in ["lease_token_sha256", "lease_issuer", "env_incarnation"] {
            assert_eq!(job.try_get::<Option<String>>("", col).unwrap(), None);
        }
        assert!(
            one(&db, "SELECT * FROM synthetics_env_retired")
                .await
                .is_none()
        );

        Migration.down(&manager).await.unwrap();
        assert!(
            !manager
                .has_column("synthetics_probe_tokens", "token_sha256")
                .await
                .unwrap()
        );
        assert!(!manager.has_table("synthetics_env_retired").await.unwrap());
        assert!(
            !manager
                .has_index("synthetics_probe_tokens", TOKEN_SHA256_INDEX)
                .await
                .unwrap()
        );
        let still = one(&db, "SELECT token FROM synthetics_probe_tokens")
            .await
            .unwrap();
        assert_eq!(still.try_get::<String>("", "token").unwrap(), "o2syn_x");

        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column("synthetics_agents", "last_tokenless_credential_resolve_at")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index("synthetics_probe_tokens", TOKEN_SHA256_INDEX)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn down_drops_the_later_partial_hash_index() {
        let db = seeded().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        db.execute_unprepared(&format!(
            "CREATE UNIQUE INDEX {TOKEN_SHA256_PARTIAL_INDEX} \
             ON synthetics_probe_tokens (token_sha256) WHERE token_sha256 <> ''"
        ))
        .await
        .unwrap();

        Migration.down(&manager).await.unwrap();
        assert!(
            !manager
                .has_index("synthetics_probe_tokens", TOKEN_SHA256_PARTIAL_INDEX)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn up_down_up_on_the_meta_store() {
        if !meta_store().await {
            return;
        }
        let txn = crate::db::get_orm_client_ddl().await.begin().await.unwrap();
        let manager = SchemaManager::new(&txn);
        Migration.down(&manager).await.unwrap();
        for (table, column, _) in added_columns() {
            assert!(
                !manager.has_column(table, column).await.unwrap(),
                "{column}"
            );
        }
        assert!(!manager.has_table("synthetics_env_retired").await.unwrap());
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        for (table, column, _) in added_columns() {
            assert!(manager.has_column(table, column).await.unwrap(), "{column}");
        }
        assert!(manager.has_table("synthetics_env_retired").await.unwrap());
        assert!(
            manager
                .has_index("synthetics_probe_tokens", TOKEN_SHA256_INDEX)
                .await
                .unwrap()
        );
        // Other tests share the meta store, so restore its schema and later migration indexes.
        txn.rollback().await.unwrap();
    }
}
