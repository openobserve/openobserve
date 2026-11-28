// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseTransaction, Statement, TransactionTrait};
use sea_orm_migration::prelude::*;

use super::m20261229_000003_add_secret_store_columns::TOKEN_SHA256_INDEX;

pub(crate) const TOKEN_SHA256_PARTIAL_INDEX: &str =
    "synthetics_probe_tokens_token_sha256_nonempty_uq";

const PARTIAL_INDEXES: [(&str, &str); 2] = [
    ("synthetics_probe_tokens_token_nonempty_uq", "token"),
    (TOKEN_SHA256_PARTIAL_INDEX, "token_sha256"),
];
const COLUMNS: &str = "id, org_id, token, enabled, created_by, created_at, updated_at, name, is_default, \
     token_sha256, token_ref";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        match txn.get_database_backend() {
            DatabaseBackend::Postgres => {
                txn.execute_unprepared(
                    "ALTER TABLE synthetics_probe_tokens \
                     DROP CONSTRAINT IF EXISTS synthetics_probe_tokens_token_key",
                )
                .await?;
            }
            DatabaseBackend::Sqlite => rebuild_sqlite(&txn, false).await?,
            _ => return Err(DbErr::Migration("unsupported probe-token database".into())),
        }
        for (name, column) in PARTIAL_INDEXES {
            txn.execute_unprepared(&format!(
                "CREATE UNIQUE INDEX IF NOT EXISTS {name} ON synthetics_probe_tokens ({column}) \
                 WHERE {column} <> ''"
            ))
            .await?;
        }
        txn.commit().await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        match txn.get_database_backend() {
            DatabaseBackend::Postgres => {
                txn.execute_unprepared(
                    "LOCK TABLE synthetics_probe_tokens IN ACCESS EXCLUSIVE MODE",
                )
                .await?;
                reject_blanked_rows(&txn).await?;
                for (name, _) in PARTIAL_INDEXES {
                    txn.execute_unprepared(&format!("DROP INDEX IF EXISTS {name}"))
                        .await?;
                }
                txn.execute_unprepared("ALTER TABLE synthetics_probe_tokens ADD UNIQUE (token)")
                    .await?;
            }
            DatabaseBackend::Sqlite => rebuild_sqlite(&txn, true).await?,
            _ => return Err(DbErr::Migration("unsupported probe-token database".into())),
        }
        txn.commit().await
    }
}

async fn reject_blanked_rows(txn: &DatabaseTransaction) -> Result<(), DbErr> {
    let blanked = txn
        .query_one(Statement::from_string(
            txn.get_database_backend(),
            "SELECT 1 FROM synthetics_probe_tokens WHERE token = '' LIMIT 1",
        ))
        .await?;
    if blanked.is_some() {
        return Err(DbErr::Migration(
            "cannot restore probe-token uniqueness while blanked plaintext rows exist".into(),
        ));
    }
    Ok(())
}

async fn rebuild_sqlite(txn: &DatabaseTransaction, restore_unique: bool) -> Result<(), DbErr> {
    let unique = if restore_unique { " UNIQUE" } else { "" };
    txn.execute_unprepared(&format!(
        "CREATE TABLE synthetics_probe_tokens_rebuild (
            id varchar NOT NULL PRIMARY KEY,
            org_id varchar NOT NULL,
            token varchar NOT NULL{unique},
            enabled boolean NOT NULL DEFAULT TRUE,
            created_by varchar NOT NULL,
            created_at bigint NOT NULL,
            updated_at bigint NOT NULL,
            name varchar NOT NULL DEFAULT 'default',
            is_default boolean NOT NULL DEFAULT FALSE,
            token_sha256 varchar(64) NOT NULL DEFAULT '',
            token_ref varchar(27)
        )"
    ))
    .await?;
    // The CREATE acquires SQLite's write lock before the rollback checks for blanks.
    if restore_unique {
        reject_blanked_rows(txn).await?;
    }
    txn.execute_unprepared(&format!(
        "INSERT INTO synthetics_probe_tokens_rebuild ({COLUMNS}) \
         SELECT {COLUMNS} FROM synthetics_probe_tokens"
    ))
    .await?;
    for sql in [
        "DROP TABLE synthetics_probe_tokens",
        "ALTER TABLE synthetics_probe_tokens_rebuild RENAME TO synthetics_probe_tokens",
        "CREATE INDEX idx_synthetics_probe_tokens_org_id ON synthetics_probe_tokens (org_id)",
        "CREATE UNIQUE INDEX idx_synthetics_probe_tokens_org_name_uq \
         ON synthetics_probe_tokens (org_id, name)",
    ] {
        txn.execute_unprepared(sql).await?;
    }
    // The bound hash lookup also serves legacy rows with empty hashes.
    txn.execute_unprepared(&format!(
        "CREATE INDEX {TOKEN_SHA256_INDEX} ON synthetics_probe_tokens (token_sha256)"
    ))
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::{
        meta::cluster::{Node, NodeStatus},
        utils::time::now_micros,
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, EntityTrait, Schema, SqlErr};

    use super::*;
    use crate::{
        db::sqlite::SqliteDb,
        secret_store::{
            capability::{self, CapabilityRecord, FgaMode, LEVEL_P1_11, STORE_FLOOR_VERSION},
            gate::{self, tests::isolated_store_test},
        },
        table::{
            cipher,
            entity::{cipher_keys, credential_values, synthetics_probe_tokens::Entity},
            migration::{
                m20241227_000001_create_organizations_table as organizations,
                m20260707_000004_create_synthetics_probe_tokens as probe_tokens,
                m20260724_000001_add_name_is_default_to_synthetics_probe_tokens as named_tokens,
                m20261229_000003_add_secret_store_columns as secret_columns,
            },
            synthetics_probe_tokens,
        },
    };

    async fn seeded_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_probe_tables(&db).await;
        insert(&db, "seed", "acme", "default", "o2syn_seed", "seed_hash")
            .await
            .unwrap();
        db
    }

    async fn create_probe_tables(db: &DatabaseConnection) {
        let manager = SchemaManager::new(db);
        organizations::Migration.up(&manager).await.unwrap();
        probe_tokens::Migration.up(&manager).await.unwrap();
        named_tokens::Migration.up(&manager).await.unwrap();
        for sql in [
            "CREATE TABLE synthetics_environments (id TEXT PRIMARY KEY)",
            "CREATE TABLE synthetics_jobs (id TEXT PRIMARY KEY)",
            "CREATE TABLE synthetics_agents (id TEXT PRIMARY KEY)",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        secret_columns::Migration.up(&manager).await.unwrap();
    }

    async fn postgres_producer_db() -> Option<(DatabaseConnection, String, DatabaseConnection)> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!(
            "probe_rollback_{}",
            config::ider::ksuid().to_ascii_lowercase()
        );
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut options = ConnectOptions::new(dsn);
        options
            .max_connections(1)
            .min_connections(1)
            .set_schema_search_path(schema.clone());
        let db = Database::connect(options).await.unwrap();
        create_probe_tables(&db).await;
        let builder = Schema::new(DatabaseBackend::Postgres);
        for table in [
            builder.create_table_from_entity(cipher_keys::Entity),
            builder.create_table_from_entity(credential_values::Entity),
        ] {
            db.execute(DatabaseBackend::Postgres.build(&table))
                .await
                .unwrap();
        }
        Some((admin, schema, db))
    }

    async fn insert(
        db: &DatabaseConnection,
        id: &str,
        org: &str,
        name: &str,
        token: &str,
        hash: &str,
    ) -> Result<(), DbErr> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "INSERT INTO synthetics_probe_tokens \
             (id, org_id, name, token, token_sha256, token_ref, enabled, is_default, created_by, \
              created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'owned', FALSE, TRUE, 'fixture', 1, 2)",
            [id.into(), org.into(), name.into(), token.into(), hash.into()],
        ))
        .await?;
        Ok(())
    }

    fn assert_unique_violation(error: DbErr) {
        assert!(matches!(
            error.sql_err(),
            Some(SqlErr::UniqueConstraintViolation(_))
        ));
    }

    #[test]
    fn postgres_real_add_before_latch_preserves_plaintext_and_allows_down() {
        isolated_store_test(
            "table::migration::m20261229_000006_probe_token_partial_unique::tests::postgres_real_add_before_latch_preserves_plaintext_and_allows_down",
            async {
                let Some((admin, schema, db)) = postgres_producer_db().await else {
                    return;
                };
                assert!(crate::db::ORM_CLIENT_RW.set(db).is_ok());
                let db = crate::db::ORM_CLIENT_RW.get().unwrap();
                crate::db::create_table().await.unwrap();
                cipher::boot(None).await.unwrap();
                let coordinator = SqliteDb::default();
                let now = now_micros();
                let node = Node {
                    uuid: "probe-rollback-node".to_owned(),
                    name: "probe-rollback-node".to_owned(),
                    version: STORE_FLOOR_VERSION.to_owned(),
                    status: NodeStatus::Online,
                    ..Node::default()
                };
                capability::write_record_in(
                    &coordinator,
                    &node.uuid,
                    &CapabilityRecord {
                        level: LEVEL_P1_11,
                        binary_version: STORE_FLOOR_VERSION.to_owned(),
                        booted_at: now,
                        refs_enabled: false,
                        fga_mode: FgaMode::On,
                        renewed_at: now,
                    },
                )
                .await
                .unwrap();
                gate::evaluate_once_in(&coordinator, vec![node], now)
                    .await
                    .unwrap();
                assert!(gate::all_live_nodes_at_level(LEVEL_P1_11));
                assert!(!gate::durably_latched().await.unwrap());

                let manager = SchemaManager::new(db);
                Migration.up(&manager).await.unwrap();
                for org in ["rollback-a", "rollback-b"] {
                    let minted = synthetics_probe_tokens::create_for_org(org, "system")
                        .await
                        .unwrap();
                    let stored = Entity::find_by_id(&minted.id)
                        .one(db)
                        .await
                        .unwrap()
                        .unwrap();
                    assert!(stored.token == minted.token);
                    assert!(
                        stored.token_sha256 == synthetics_probe_tokens::token_sha256(&minted.token)
                    );
                }
                assert_eq!(
                    synthetics_probe_tokens::blank_plaintext_pass()
                        .await
                        .unwrap()
                        .blanked,
                    0
                );
                Migration.down(&manager).await.unwrap();
                admin
                    .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
                    .await
                    .unwrap();
            },
        );
    }

    #[tokio::test]
    async fn sqlite_up_down_up_preserves_rows_and_indexes() {
        let db = seeded_db().await;
        let manager = SchemaManager::new(&db);
        let seed = Entity::find_by_id("seed").one(&db).await.unwrap().unwrap();
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        for (name, _) in PARTIAL_INDEXES {
            assert!(
                !manager
                    .has_index("synthetics_probe_tokens", name)
                    .await
                    .unwrap()
            );
        }
        insert(
            &db,
            "same_hash",
            "other",
            "default",
            "o2syn_other",
            "seed_hash",
        )
        .await
        .unwrap();
        assert_unique_violation(
            insert(
                &db,
                "same_token",
                "different",
                "default",
                "o2syn_seed",
                "other_hash",
            )
            .await
            .unwrap_err(),
        );
        db.execute_unprepared("DELETE FROM synthetics_probe_tokens WHERE id = 'same_hash'")
            .await
            .unwrap();
        Migration.up(&manager).await.unwrap();

        for name in [
            "idx_synthetics_probe_tokens_org_id",
            "idx_synthetics_probe_tokens_org_name_uq",
            TOKEN_SHA256_INDEX,
        ] {
            assert!(
                manager
                    .has_index("synthetics_probe_tokens", name)
                    .await
                    .unwrap()
            );
        }
        assert_eq!(
            Entity::find_by_id("seed").one(&db).await.unwrap(),
            Some(seed)
        );
    }

    #[tokio::test]
    async fn sqlite_unique_indexes_allow_blanks_and_block_nonempty_duplicates() {
        let db = seeded_db().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();

        insert(&db, "blank_a", "a", "default", "", "")
            .await
            .unwrap();
        let error = Migration.down(&manager).await.unwrap_err();
        assert!(error.to_string().contains("blanked plaintext rows exist"));
        insert(&db, "blank_b", "b", "default", "", "")
            .await
            .unwrap();
        for (org, token, hash) in [
            ("c", "o2syn_seed", "other_hash"),
            ("c", "o2syn_other", "seed_hash"),
            ("acme", "o2syn_other", "other_hash"),
        ] {
            assert_unique_violation(
                insert(&db, "duplicate", org, "default", token, hash)
                    .await
                    .unwrap_err(),
            );
        }
    }
}
