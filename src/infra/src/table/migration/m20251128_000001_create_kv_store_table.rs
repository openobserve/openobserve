// Copyright 2025 OpenObserve Inc.
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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(KvStore::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create kv_store table.
fn create_table_stmt() -> TableCreateStatement {
    Table::create()
        .table(KvStore::Table)
        .if_not_exists()
        .col(ColumnDef::new(KvStore::OrgId).string_len(256).not_null())
        .col(ColumnDef::new(KvStore::Key).string_len(256).not_null())
        .col(ColumnDef::new(KvStore::Value).binary().not_null())
        .col(ColumnDef::new(KvStore::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(KvStore::UpdatedAt).big_integer().not_null())
        .primary_key(Index::create().col(KvStore::OrgId).col(KvStore::Key))
        .to_owned()
}

#[derive(DeriveIden)]
enum KvStore {
    Table,
    OrgId,
    Key,
    Value,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_table_stmt().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "kv_store" ( "org_id" varchar(256) NOT NULL, "key" varchar(256) NOT NULL, "value" bytea NOT NULL, "created_at" bigint NOT NULL, "updated_at" bigint NOT NULL, PRIMARY KEY ("org_id", "key") )"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_table_stmt().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `kv_store` ( `org_id` varchar(256) NOT NULL, `key` varchar(256) NOT NULL, `value` binary(1) NOT NULL, `created_at` bigint NOT NULL, `updated_at` bigint NOT NULL, PRIMARY KEY (`org_id`, `key`) )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_table_stmt().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "kv_store" ( "org_id" varchar(256) NOT NULL, "key" varchar(256) NOT NULL, "value" blob(1) NOT NULL, "created_at" bigint NOT NULL, "updated_at" bigint NOT NULL, PRIMARY KEY ("org_id", "key") )"#
        );
    }
}
