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

//! Widens `alert_dedup_state.fingerprint`: the level and group suffixes outgrow the bare SHA-256.

use sea_orm_migration::prelude::*;

/// `<sha256>|level:warning|group:<sha256>` is 149 characters; the rest is headroom.
const FINGERPRINT_LEN: u32 = 256;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite does not enforce varchar lengths.
        if manager.get_database_backend() != sea_orm::DbBackend::Postgres {
            return Ok(());
        }
        manager.alter_table(widen_statement()).await
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Narrowing would fail on any stored grouped or multi-level fingerprint.
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AlertDedupState {
    Table,
    Fingerprint,
}

fn widen_statement() -> TableAlterStatement {
    Table::alter()
        .table(AlertDedupState::Table)
        .modify_column(
            ColumnDef::new(AlertDedupState::Fingerprint)
                .string_len(FINGERPRINT_LEN)
                .not_null(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseBackend, Statement};
    use svix_ksuid::{Ksuid, KsuidLike};

    use super::*;

    #[test]
    fn postgres() {
        assert_eq!(
            &widen_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_dedup_state" ALTER COLUMN "fingerprint" TYPE varchar(256), ALTER COLUMN "fingerprint" SET NOT NULL"#
        );
    }

    #[tokio::test]
    async fn sqlite_is_untouched() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
    }

    #[tokio::test]
    async fn postgres_stores_a_grouped_multi_level_fingerprint() {
        let Ok(dsn) = std::env::var("ZO_META_POSTGRES_DSN") else {
            return;
        };
        if dsn.trim().is_empty() {
            return;
        }
        let exec = |sql: String| Statement::from_string(DatabaseBackend::Postgres, sql);
        let schema = format!(
            "dedup_fp_{}",
            Ksuid::new(None, None).to_string().to_ascii_lowercase()
        );
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute(exec(format!(r#"CREATE SCHEMA "{schema}""#)))
            .await
            .unwrap();
        let mut options = ConnectOptions::new(dsn);
        options
            .max_connections(1)
            .set_schema_search_path(schema.clone());
        let db = Database::connect(options).await.unwrap();
        db.execute(exec(
            "CREATE TABLE alert_dedup_state (org_id varchar(100) NOT NULL, \
             fingerprint varchar(64) NOT NULL, PRIMARY KEY (org_id, fingerprint))"
                .to_string(),
        ))
        .await
        .unwrap();
        let fingerprint = format!("{}|level:warning|group:{}", "a".repeat(64), "b".repeat(64));
        let insert = format!("INSERT INTO alert_dedup_state VALUES ('org', '{fingerprint}')");
        assert!(db.execute(exec(insert.clone())).await.is_err());

        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        db.execute(exec(insert)).await.unwrap();

        db.close().await.unwrap();
        admin
            .execute(exec(format!(r#"DROP SCHEMA "{schema}" CASCADE"#)))
            .await
            .unwrap();
    }
}
