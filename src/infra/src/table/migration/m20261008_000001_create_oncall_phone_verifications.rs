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

//! One row per (user, phone number) being verified; region-local, never replicated.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table()).await?;
        manager.create_index(create_user_target_idx()).await?;
        manager.create_index(create_target_idx()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(OncallPhoneVerifications::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallPhoneVerifications {
    Table,
    Id,
    UserEmail,
    Target,
    CodeHash,
    Attempts,
    SentAt,
    SendsToday,
    DayStartedAt,
    CreatedAt,
    UpdatedAt,
}

fn create_table() -> TableCreateStatement {
    Table::create()
        .table(OncallPhoneVerifications::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OncallPhoneVerifications::Id)
                .string()
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::UserEmail)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::Target)
                .string()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::CodeHash)
                .custom(Alias::new(get_text_type()))
                .null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::Attempts)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::SentAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::SendsToday)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::DayStartedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OncallPhoneVerifications::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_user_target_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .table(OncallPhoneVerifications::Table)
        .name("idx_oncall_phone_verifications_user_target")
        .col(OncallPhoneVerifications::UserEmail)
        .col(OncallPhoneVerifications::Target)
        .unique()
        .to_owned()
}

fn create_target_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .table(OncallPhoneVerifications::Table)
        .name("idx_oncall_phone_verifications_target")
        .col(OncallPhoneVerifications::Target)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait, sea_query::MysqlQueryBuilder};

    use super::*;

    const TABLE: &str = "oncall_phone_verifications";

    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("SELECT name FROM pragma_table_info('{table}') ORDER BY name"),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    fn insert(id: &str, email: &str, target: &str) -> Statement {
        Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!(
                "INSERT INTO oncall_phone_verifications \
                 (id, user_email, target, code_hash, attempts, sent_at, sends_today, \
                 day_started_at, created_at, updated_at) \
                 VALUES ('{id}', '{email}', '{target}', NULL, 0, 1, 1, 1, 1, 1)"
            ),
        )
    }

    #[tokio::test]
    async fn test_up_creates_the_table_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        assert!(manager.has_table(TABLE).await.unwrap());
        assert_eq!(
            columns(&db, TABLE).await,
            vec![
                "attempts",
                "code_hash",
                "created_at",
                "day_started_at",
                "id",
                "sends_today",
                "sent_at",
                "target",
                "updated_at",
                "user_email",
            ]
        );
        assert!(
            manager
                .has_index(TABLE, "idx_oncall_phone_verifications_target")
                .await
                .unwrap()
        );

        db.execute(insert("v_1", "ana@o2.ai", "+15550100"))
            .await
            .expect("a row must be insertable");
        db.execute(insert("v_2", "bo@o2.ai", "+15550100"))
            .await
            .expect("two people may verify the same number");
        assert!(
            db.execute(insert("v_3", "ana@o2.ai", "+15550100"))
                .await
                .is_err(),
            "one row per (user, number)"
        );
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

    /// MySQL refuses an index on a TEXT column without a key length.
    #[test]
    fn test_indexed_columns_are_varchar_on_mysql() {
        let table = create_table().to_string(MysqlQueryBuilder);
        assert!(table.contains("`user_email` varchar("), "{table}");
        assert!(table.contains("`target` varchar("), "{table}");
        assert_eq!(
            create_user_target_idx().to_string(MysqlQueryBuilder),
            "CREATE UNIQUE INDEX `idx_oncall_phone_verifications_user_target` ON \
             `oncall_phone_verifications` (`user_email`, `target`)"
        );
        assert_eq!(
            create_target_idx().to_string(MysqlQueryBuilder),
            "CREATE INDEX `idx_oncall_phone_verifications_target` ON \
             `oncall_phone_verifications` (`target`)"
        );
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261008_000001_create_oncall_phone_verifications"
        );
    }
}
