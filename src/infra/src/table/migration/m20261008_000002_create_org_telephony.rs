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

//! One telephony account per org, its credentials encrypted under the org DEK.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(OrgTelephony::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OrgTelephony {
    Table,
    OrgId,
    Provider,
    Data,
    CreatedAt,
    UpdatedAt,
}

fn create_table() -> TableCreateStatement {
    Table::create()
        .table(OrgTelephony::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(OrgTelephony::OrgId)
                .string()
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(OrgTelephony::Provider).string().not_null())
        .col(
            ColumnDef::new(OrgTelephony::Data)
                .custom(Alias::new(get_text_type()))
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgTelephony::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(OrgTelephony::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait, sea_query::MysqlQueryBuilder};

    use super::*;

    const TABLE: &str = "org_telephony";

    async fn columns(db: &DatabaseConnection) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("SELECT name FROM pragma_table_info('{TABLE}') ORDER BY name"),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    fn insert(org_id: &str) -> Statement {
        Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            format!(
                "INSERT INTO org_telephony (org_id, provider, data, created_at, updated_at) \
                 VALUES ('{org_id}', 'twilio', 'sealed', 1, 1)"
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
            columns(&db).await,
            vec!["created_at", "data", "org_id", "provider", "updated_at"]
        );
        db.execute(insert("acme"))
            .await
            .expect("a row must be insertable");
        assert!(db.execute(insert("acme")).await.is_err(), "one row per org");
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

    /// MySQL refuses a key on a TEXT column without a key length.
    #[test]
    fn test_key_column_is_varchar_on_mysql() {
        let table = create_table().to_string(MysqlQueryBuilder);
        assert!(table.contains("`org_id` varchar("), "{table}");
        assert!(table.contains("`data` text"), "{table}");
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20261008_000002_create_org_telephony");
    }
}
