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

//! The tables behind built-in TLS for custom domains (certificates, challenges, the manager row,
//! listener heartbeats) and the claim's CNAME label with its unique index.

use std::collections::HashSet;

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

use crate::table::status_pages::new_cname_label;

const CLAIMS_TABLE: &str = "status_page_custom_domains";
const LABEL_COLUMN: &str = "cname_label";
const LABEL_INDEX: &str = "status_page_custom_domains_cname_label_uidx";
const CERTS_CLAIM_INDEX: &str = "status_page_domain_certs_claim_idx";
const CERTS_ORG_INDEX: &str = "status_page_domain_certs_org_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_certs_stmt()).await?;
        manager.create_index(certs_claim_idx()).await?;
        manager.create_index(certs_org_idx()).await?;
        manager.create_table(create_challenges_stmt()).await?;
        manager.create_table(create_manager_stmt()).await?;
        manager.create_table(create_listeners_stmt()).await?;
        let db = manager.get_connection();
        db.execute(
            db.get_database_backend()
                .build(&manager_row_stmt(config::utils::time::now_micros())),
        )
        .await?;
        if !manager.has_column(CLAIMS_TABLE, LABEL_COLUMN).await? {
            manager.alter_table(add_label_column_stmt()).await?;
        }
        backfill_labels(db).await?;
        manager.create_index(label_index_stmt()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_index(CLAIMS_TABLE, LABEL_INDEX).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(LABEL_INDEX)
                        .table(StatusPageCustomDomains::Table)
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_column(CLAIMS_TABLE, LABEL_COLUMN).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(StatusPageCustomDomains::Table)
                        .drop_column(StatusPageCustomDomains::CnameLabel)
                        .to_owned(),
                )
                .await?;
        }
        for table in [
            Table::drop()
                .table(StatusPageDomainListeners::Table)
                .to_owned(),
            Table::drop()
                .table(StatusPageDomainManager::Table)
                .to_owned(),
            Table::drop()
                .table(StatusPageDomainChallenges::Table)
                .to_owned(),
            Table::drop().table(StatusPageDomainCerts::Table).to_owned(),
        ] {
            manager.drop_table(table).await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum StatusPageCustomDomains {
    Table,
    Id,
    ReleasedAt,
    ReleaseSeal,
    CnameLabel,
}

#[derive(DeriveIden)]
enum StatusPageDomainCerts {
    Table,
    Hostname,
    ClaimId,
    OrgId,
    CaDirectory,
    CertChain,
    PrivateKey,
    Fingerprint,
    PreviousFingerprint,
    NotBefore,
    NotAfter,
    RenewAt,
    Source,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageDomainChallenges {
    Table,
    Hostname,
    ClaimId,
    Token,
    KeyAuthDigest,
    ExpiresAt,
    CreatedAt,
}

#[derive(DeriveIden)]
enum StatusPageDomainManager {
    Table,
    Id,
    LeaseOwner,
    LeaseExpiresAt,
    KeyCheck,
    Epoch,
    InstallationStatus,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageDomainListeners {
    Table,
    NodeUuid,
    NodeName,
    Address,
    LastSeenAt,
    CertsLoaded,
    LastSyncAt,
    PrivatePeersOnly,
}

fn create_certs_stmt() -> TableCreateStatement {
    use StatusPageDomainCerts as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(C::Hostname)
                .string_len(253)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(C::ClaimId).string_len(27).null())
        .col(ColumnDef::new(C::OrgId).string_len(100).null())
        .col(ColumnDef::new(C::CaDirectory).string_len(512).not_null())
        .col(ColumnDef::new(C::CertChain).text().not_null())
        .col(ColumnDef::new(C::PrivateKey).text().not_null())
        .col(ColumnDef::new(C::Fingerprint).string_len(64).not_null())
        .col(ColumnDef::new(C::PreviousFingerprint).string_len(64).null())
        .col(ColumnDef::new(C::NotBefore).big_integer().not_null())
        .col(ColumnDef::new(C::NotAfter).big_integer().not_null())
        .col(ColumnDef::new(C::RenewAt).big_integer().null())
        .col(ColumnDef::new(C::Source).string_len(16).not_null())
        .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(C::UpdatedAt).big_integer().not_null())
        .to_owned()
}

fn certs_claim_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(CERTS_CLAIM_INDEX)
        .table(StatusPageDomainCerts::Table)
        .col(StatusPageDomainCerts::ClaimId)
        .to_owned()
}

fn certs_org_idx() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(CERTS_ORG_INDEX)
        .table(StatusPageDomainCerts::Table)
        .col(StatusPageDomainCerts::OrgId)
        .to_owned()
}

fn create_challenges_stmt() -> TableCreateStatement {
    use StatusPageDomainChallenges as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(C::Hostname)
                .string_len(253)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(C::ClaimId).string_len(27).null())
        .col(ColumnDef::new(C::Token).string_len(255).not_null())
        .col(ColumnDef::new(C::KeyAuthDigest).string_len(64).not_null())
        .col(ColumnDef::new(C::ExpiresAt).big_integer().not_null())
        .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
        .to_owned()
}

fn create_manager_stmt() -> TableCreateStatement {
    use StatusPageDomainManager as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(ColumnDef::new(C::Id).integer().not_null().primary_key())
        .col(ColumnDef::new(C::LeaseOwner).string_len(64).null())
        .col(ColumnDef::new(C::LeaseExpiresAt).big_integer().null())
        .col(ColumnDef::new(C::KeyCheck).string_len(255).null())
        .col(ColumnDef::new(C::Epoch).big_integer().not_null().default(1))
        .col(ColumnDef::new(C::InstallationStatus).text().null())
        .col(ColumnDef::new(C::UpdatedAt).big_integer().not_null())
        .to_owned()
}

fn create_listeners_stmt() -> TableCreateStatement {
    use StatusPageDomainListeners as C;
    Table::create()
        .table(C::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(C::NodeUuid)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(C::NodeName).string_len(256).not_null())
        .col(ColumnDef::new(C::Address).string_len(255).not_null())
        .col(ColumnDef::new(C::LastSeenAt).big_integer().not_null())
        .col(ColumnDef::new(C::CertsLoaded).integer().not_null())
        .col(ColumnDef::new(C::LastSyncAt).big_integer().not_null())
        .col(
            ColumnDef::new(C::PrivatePeersOnly)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

/// The single manager row; a rerun leaves the stored epoch and key check alone.
fn manager_row_stmt(now: i64) -> InsertStatement {
    use StatusPageDomainManager as C;
    Query::insert()
        .into_table(C::Table)
        .columns([C::Id, C::Epoch, C::UpdatedAt])
        .values_panic([1.into(), 1_i64.into(), now.into()])
        .on_conflict(OnConflict::column(C::Id).do_nothing().to_owned())
        .to_owned()
}

fn add_label_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(StatusPageCustomDomains::Table)
        .add_column(
            ColumnDef::new(StatusPageCustomDomains::CnameLabel)
                .string_len(16)
                .null(),
        )
        .to_owned()
}

/// Both databases allow many NULLs in a unique index, so released rows without a label never
/// collide, and a label kept by a released row still blocks its reuse.
fn label_index_stmt() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(LABEL_INDEX)
        .table(StatusPageCustomDomains::Table)
        .col(StatusPageCustomDomains::CnameLabel)
        .unique()
        .to_owned()
}

/// Gives every unreleased claim without a label one no row has; released rows stay without.
/// SQLite cannot add a NOT NULL column with distinct values, so the column stays nullable.
async fn backfill_labels<C: ConnectionTrait>(db: &C) -> Result<(), DbErr> {
    let backend = db.get_database_backend();
    let used = Query::select()
        .column(StatusPageCustomDomains::CnameLabel)
        .from(StatusPageCustomDomains::Table)
        .and_where(Expr::col(StatusPageCustomDomains::CnameLabel).is_not_null())
        .to_owned();
    let mut taken = HashSet::new();
    for row in db.query_all(backend.build(&used)).await? {
        taken.insert(row.try_get::<String>("", LABEL_COLUMN)?);
    }
    let unlabeled = Query::select()
        .column(StatusPageCustomDomains::Id)
        .from(StatusPageCustomDomains::Table)
        .and_where(Expr::col(StatusPageCustomDomains::CnameLabel).is_null())
        .and_where(Expr::col(StatusPageCustomDomains::ReleasedAt).is_null())
        .and_where(Expr::col(StatusPageCustomDomains::ReleaseSeal).is_null())
        .to_owned();
    for row in db.query_all(backend.build(&unlabeled)).await? {
        let id: String = row.try_get("", "id")?;
        let label = std::iter::repeat_with(new_cname_label)
            .find(|label| taken.insert(label.clone()))
            .expect("an endless iterator");
        let set = Query::update()
            .table(StatusPageCustomDomains::Table)
            .value(StatusPageCustomDomains::CnameLabel, label)
            .and_where(Expr::col(StatusPageCustomDomains::Id).eq(id))
            .and_where(Expr::col(StatusPageCustomDomains::CnameLabel).is_null())
            .to_owned();
        db.execute(backend.build(&set)).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, EntityTrait};

    use super::*;
    use crate::table::{
        entity::{status_page_custom_domains as claims, status_page_domain_manager as manager},
        migration::{
            m20260825_000001_create_status_page_custom_domains as create_domains,
            m20261225_000001_status_page_domain_holders as holders,
            m20261227_000001_status_page_domain_manager as manager_migration,
        },
    };

    /// The claim table as the release before this one left it.
    async fn old_db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let schema = SchemaManager::new(&db);
        create_domains::Migration.up(&schema).await.unwrap();
        holders::Migration.up(&schema).await.unwrap();
        // The current entity reads the columns the manager migration adds, so the schema must too.
        manager_migration::Migration.up(&schema).await.unwrap();
        db
    }

    async fn old_row(db: &DatabaseConnection, id: &str, released: bool) {
        let released_at = if released { "5" } else { "NULL" };
        db.execute_unprepared(&format!(
            "INSERT INTO status_page_custom_domains (id, org_id, status_page_id, domain, \
             verification_token, verification_state, released_at, release_seal, created_at, \
             updated_at) VALUES ('{id}', 'org-{id}', 'page-{id}', '{id}.example.com', 'o2v_{id}', \
             0, {released_at}, {released_at}, 1, 1)"
        ))
        .await
        .unwrap();
    }

    async fn migrate(db: &DatabaseConnection) {
        Migration.up(&SchemaManager::new(db)).await.unwrap();
    }

    async fn label_of(db: &DatabaseConnection, id: &str) -> Option<String> {
        claims::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .cname_label
    }

    #[tokio::test]
    async fn creates_the_four_tables_and_the_single_manager_row() {
        let db = old_db().await;

        migrate(&db).await;

        let schema = SchemaManager::new(&db);
        for table in [
            "status_page_domain_certs",
            "status_page_domain_challenges",
            "status_page_domain_manager",
            "status_page_domain_listeners",
        ] {
            assert!(schema.has_table(table).await.unwrap(), "{table}");
        }
        let rows = manager::Entity::find().all(&db).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].id, rows[0].epoch), (1, 1));
        assert_eq!(rows[0].key_check, None);
        assert_eq!(rows[0].lease_owner, None);
    }

    #[tokio::test]
    async fn a_rerun_keeps_the_manager_row_and_every_label() {
        let db = old_db().await;
        old_row(&db, "a", false).await;
        migrate(&db).await;
        let label = label_of(&db, "a").await;
        db.execute_unprepared(
            "UPDATE status_page_domain_manager SET epoch = 7, key_check = 'kept' WHERE id = 1",
        )
        .await
        .unwrap();

        migrate(&db).await;

        let row = manager::Entity::find_by_id(1)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!((row.epoch, row.key_check.as_deref()), (7, Some("kept")));
        assert_eq!(label_of(&db, "a").await, label);
    }

    #[tokio::test]
    async fn every_unreleased_claim_gets_a_distinct_label_and_released_rows_get_none() {
        let db = old_db().await;
        for id in ["a", "b", "c", "d"] {
            old_row(&db, id, false).await;
        }
        old_row(&db, "gone", true).await;

        migrate(&db).await;

        let mut labels = Vec::new();
        for id in ["a", "b", "c", "d"] {
            let label = label_of(&db, id)
                .await
                .expect("an unreleased claim has one");
            assert_eq!(label.len(), 16, "{label}");
            assert!(
                label
                    .bytes()
                    .all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7')),
                "{label}"
            );
            labels.push(label);
        }
        labels.sort();
        labels.dedup();
        assert_eq!(labels.len(), 4, "labels must be distinct");
        assert_eq!(label_of(&db, "gone").await, None);
    }

    #[tokio::test]
    async fn the_unique_index_refuses_a_duplicate_label_also_against_a_released_row() {
        let db = old_db().await;
        old_row(&db, "a", false).await;
        old_row(&db, "gone", true).await;
        old_row(&db, "b", false).await;
        migrate(&db).await;
        let label = label_of(&db, "a").await.unwrap();
        let set = |id: &str, label: &str| {
            format!(
                "UPDATE status_page_custom_domains SET cname_label = '{label}' WHERE id = '{id}'"
            )
        };

        let live = db.execute_unprepared(&set("b", &label)).await;
        assert!(live.is_err(), "a second live claim cannot take the label");
        db.execute_unprepared(&set("gone", "zzzzzzzzzzzzzzzz"))
            .await
            .unwrap();
        let against_released = db.execute_unprepared(&set("b", "zzzzzzzzzzzzzzzz")).await;
        assert!(
            against_released.is_err(),
            "a released row keeps its label, so nobody reuses it"
        );
    }

    #[tokio::test]
    async fn down_removes_the_tables_and_the_label() {
        let db = old_db().await;
        old_row(&db, "a", false).await;
        migrate(&db).await;

        Migration.down(&SchemaManager::new(&db)).await.unwrap();

        let schema = SchemaManager::new(&db);
        assert!(!schema.has_table("status_page_domain_certs").await.unwrap());
        assert!(!schema.has_column(CLAIMS_TABLE, LABEL_COLUMN).await.unwrap());
    }
}
