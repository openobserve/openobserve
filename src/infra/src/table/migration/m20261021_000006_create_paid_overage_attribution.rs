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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(PaidOverageAttribution::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum PaidOverageAttribution {
    Table,
    OrgId,
    Pool,
    EnabledByEmail,
    EnabledAt,
    DisabledByEmail,
    DisabledAt,
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(PaidOverageAttribution::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(PaidOverageAttribution::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(PaidOverageAttribution::Pool)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(PaidOverageAttribution::EnabledByEmail)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(PaidOverageAttribution::EnabledAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(PaidOverageAttribution::DisabledByEmail)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(PaidOverageAttribution::DisabledAt)
                .big_integer()
                .null(),
        )
        .primary_key(
            Index::create()
                .col(PaidOverageAttribution::OrgId)
                .col(PaidOverageAttribution::Pool),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261021_000006_create_paid_overage_attribution"
        );
    }

    #[tokio::test]
    async fn up_is_idempotent_keys_one_row_per_org_and_pool_and_down_drops() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        for column in [
            "enabled_by_email",
            "enabled_at",
            "disabled_by_email",
            "disabled_at",
        ] {
            assert!(
                manager
                    .has_column("paid_overage_attribution", column)
                    .await
                    .unwrap(),
                "{column}"
            );
        }
        let insert =
            "INSERT INTO paid_overage_attribution (org_id, pool) VALUES ('o', 'ai_credits')";
        db.execute_unprepared(insert).await.unwrap();
        assert!(db.execute_unprepared(insert).await.is_err());
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("paid_overage_attribution").await.unwrap());
    }
}
