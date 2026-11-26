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

//! The tables behind the domain manager (orders, revocations, CA accounts) and the serving
//! columns of a claim, with `proof_notified_at`.

use sea_orm_migration::prelude::*;

const CLAIMS_TABLE: &str = "status_page_custom_domains";
const ORDERS_HOST_INDEX: &str = "status_page_domain_orders_hostname_idx";
const ORDERS_CREATED_INDEX: &str = "status_page_domain_orders_created_idx";
const REVOCATIONS_STATE_INDEX: &str = "status_page_domain_revocations_state_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_orders_stmt()).await?;
        manager.create_index(orders_host_idx()).await?;
        manager.create_index(orders_created_idx()).await?;
        manager.create_table(create_revocations_stmt()).await?;
        manager.create_index(revocations_state_idx()).await?;
        manager.create_table(create_accounts_stmt()).await?;
        for (name, column) in claim_columns() {
            if !manager.has_column(CLAIMS_TABLE, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(StatusPageCustomDomains::Table)
                            .add_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (name, _) in claim_columns() {
            if manager.has_column(CLAIMS_TABLE, name).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(StatusPageCustomDomains::Table)
                            .drop_column(Alias::new(name))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        for table in [
            Table::drop()
                .table(StatusPageDomainAcmeAccounts::Table)
                .to_owned(),
            Table::drop()
                .table(StatusPageDomainRevocations::Table)
                .to_owned(),
            Table::drop()
                .table(StatusPageDomainOrders::Table)
                .to_owned(),
        ] {
            manager.drop_table(table).await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum StatusPageCustomDomains {
    Table,
}

#[derive(DeriveIden)]
enum StatusPageDomainOrders {
    Table,
    Id,
    Hostname,
    RegisteredDomain,
    OrgId,
    ClaimId,
    Kind,
    State,
    OrderUrl,
    Outcome,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageDomainRevocations {
    Table,
    Id,
    Hostname,
    CertChain,
    CaDirectory,
    State,
    Attempts,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageDomainAcmeAccounts {
    Table,
    CaDirectory,
    Credentials,
    CreatedAt,
}

/// The claim's new columns, nullable except the probe failure count.
fn claim_columns() -> Vec<(&'static str, ColumnDef)> {
    let micros = |name: &'static str| {
        let mut column = ColumnDef::new(Alias::new(name));
        column.big_integer().null();
        (name, column)
    };
    let text = |name: &'static str, len: u32| {
        let mut column = ColumnDef::new(Alias::new(name));
        column.string_len(len).null();
        (name, column)
    };
    let mut failures = ColumnDef::new(Alias::new("probe_failures"));
    failures.integer().not_null().default(0);
    vec![
        micros("proof_notified_at"),
        text("serving_state", 16),
        text("serving_reason", 32),
        text("serving_warning", 32),
        micros("warning_at"),
        micros("next_action_at"),
        micros("state_computed_at"),
        micros("dns_checked_at"),
        micros("dns_ok_since"),
        micros("probe_ok_at"),
        text("probe_confirmed_fingerprint", 64),
        micros("ca_validated_at"),
        micros("check_requested_at"),
        ("probe_failures", failures),
    ]
}

fn create_orders_stmt() -> TableCreateStatement {
    use StatusPageDomainOrders as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(C::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(C::Hostname).string_len(253).not_null())
        .col(
            ColumnDef::new(C::RegisteredDomain)
                .string_len(253)
                .not_null(),
        )
        .col(ColumnDef::new(C::OrgId).string_len(100).null())
        .col(ColumnDef::new(C::ClaimId).string_len(27).null())
        .col(ColumnDef::new(C::Kind).string_len(16).not_null())
        .col(ColumnDef::new(C::State).string_len(16).not_null())
        .col(ColumnDef::new(C::OrderUrl).text().null())
        .col(ColumnDef::new(C::Outcome).text().null())
        .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(C::UpdatedAt).big_integer().not_null())
        .to_owned()
}

fn orders_host_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ORDERS_HOST_INDEX)
        .table(StatusPageDomainOrders::Table)
        .col(StatusPageDomainOrders::Hostname)
        .col(StatusPageDomainOrders::CreatedAt)
        .to_owned()
}

fn orders_created_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(ORDERS_CREATED_INDEX)
        .table(StatusPageDomainOrders::Table)
        .col(StatusPageDomainOrders::CreatedAt)
        .to_owned()
}

fn create_revocations_stmt() -> TableCreateStatement {
    use StatusPageDomainRevocations as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(C::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(C::Hostname).string_len(253).not_null())
        .col(ColumnDef::new(C::CertChain).text().not_null())
        .col(ColumnDef::new(C::CaDirectory).string_len(512).not_null())
        .col(ColumnDef::new(C::State).string_len(16).not_null())
        .col(ColumnDef::new(C::Attempts).integer().not_null().default(0))
        .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(C::UpdatedAt).big_integer().not_null())
        .to_owned()
}

fn revocations_state_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(REVOCATIONS_STATE_INDEX)
        .table(StatusPageDomainRevocations::Table)
        .col(StatusPageDomainRevocations::State)
        .col(StatusPageDomainRevocations::UpdatedAt)
        .to_owned()
}

fn create_accounts_stmt() -> TableCreateStatement {
    use StatusPageDomainAcmeAccounts as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(C::CaDirectory)
                .string_len(512)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(C::Credentials).text().not_null())
        .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::{
        m20260825_000001_create_status_page_custom_domains as create_domains,
        m20261225_000001_status_page_domain_holders as holders,
        m20261226_000001_status_page_domain_store as store,
    };

    async fn old_db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let schema = SchemaManager::new(&db);
        create_domains::Migration.up(&schema).await.unwrap();
        holders::Migration.up(&schema).await.unwrap();
        store::Migration.up(&schema).await.unwrap();
        db
    }

    #[tokio::test]
    async fn creates_the_three_tables_and_the_claim_columns() {
        let db = old_db().await;
        db.execute_unprepared(
            "INSERT INTO status_page_custom_domains (id, org_id, status_page_id, domain, \
             verification_token, verification_state, created_at, updated_at) \
             VALUES ('c1', 'o', 'p', 'a.example.com', 't', 0, 1, 1)",
        )
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let schema = SchemaManager::new(&db);
        for table in [
            "status_page_domain_orders",
            "status_page_domain_revocations",
            "status_page_domain_acme_accounts",
        ] {
            assert!(schema.has_table(table).await.unwrap(), "{table}");
        }
        for (name, _) in claim_columns() {
            assert!(
                schema.has_column(CLAIMS_TABLE, name).await.unwrap(),
                "{name}"
            );
        }
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT probe_failures, serving_state FROM status_page_custom_domains",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "probe_failures").unwrap(), 0);
        assert_eq!(
            row.try_get::<Option<String>>("", "serving_state").unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn runs_again_without_error_and_goes_down_cleanly() {
        let db = old_db().await;
        let schema = SchemaManager::new(&db);
        Migration.up(&schema).await.unwrap();

        Migration.up(&schema).await.unwrap();
        Migration.down(&schema).await.unwrap();

        assert!(!schema.has_table("status_page_domain_orders").await.unwrap());
        assert!(
            !schema
                .has_column(CLAIMS_TABLE, "serving_state")
                .await
                .unwrap()
        );
    }
}
