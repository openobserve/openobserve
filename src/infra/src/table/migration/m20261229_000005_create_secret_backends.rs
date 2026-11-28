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

const VALUE_BACKEND_INDEX: &str = "org_secret_values_org_backend_secret_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            secret_backends(),
            secret_backend_identities(),
            secret_identity_jobs(),
            secret_backend_readiness(),
        ] {
            manager.create_table(table).await?;
        }
        for (table, column, def) in added_columns() {
            if !manager.has_column(table, column).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .add_column(def)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        for index in indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .table(Alias::new("org_secret_values"))
                    .name(VALUE_BACKEND_INDEX)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        for (table, column, _) in added_columns() {
            if manager.has_column(table, column).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .drop_column(Alias::new(column))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        for table in [
            "secret_backend_readiness",
            "secret_identity_jobs",
            "secret_backend_identities",
            "secret_backends",
        ] {
            manager
                .drop_table(
                    Table::drop()
                        .table(Alias::new(table))
                        .if_exists()
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretBackends {
    Table,
    Id,
    OrgId,
    Kind,
    Name,
    Description,
    Config,
    PathPrefixes,
    AuthMode,
    CredRef,
    CredentialRev,
    State,
    BackendRev,
    TtlSecs,
    StaleMaxSecs,
    CreatedBy,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretBackendIdentities {
    Table,
    OrgId,
    Provider,
    Principal,
    Source,
    State,
    Incarnation,
    NextPrincipal,
    NextIncarnation,
    IdAccount,
    PolicyHash,
    DesiredGen,
    AppliedGen,
    RotateRequested,
    DeleteAfter,
    LeaseOwner,
    LeaseUntil,
    LastVerifiedAt,
    LastError,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretIdentityJobs {
    Table,
    Id,
    OrgId,
    Provider,
    Gen,
    Did,
    State,
    Attempts,
    RequestedBy,
    Error,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretBackendReadiness {
    Table,
    OrgId,
    BackendId,
    IdentityRev,
    BackendRev,
    PassedAt,
}

fn s(col: impl IntoIden, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).not_null().to_owned()
}

fn s_nullable(col: impl IntoIden, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).null().to_owned()
}

fn b(col: impl IntoIden) -> ColumnDef {
    ColumnDef::new(col).big_integer().not_null().to_owned()
}

fn secret_backends() -> TableCreateStatement {
    use SecretBackends as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::Id, 27).primary_key())
        .col(s(T::OrgId, 256))
        .col(s(T::Kind, 32))
        .col(s(T::Name, 128))
        .col(ColumnDef::new(T::Description).text().not_null().default(""))
        .col(ColumnDef::new(T::Config).text().not_null())
        .col(ColumnDef::new(T::PathPrefixes).text().not_null())
        .col(s(T::AuthMode, 16))
        .col(s_nullable(T::CredRef, 27))
        .col(s(T::CredentialRev, 27).default(""))
        .col(s(T::State, 16))
        .col(s(T::BackendRev, 27))
        .col(ColumnDef::new(T::TtlSecs).integer().not_null())
        .col(ColumnDef::new(T::StaleMaxSecs).integer().not_null())
        .col(s(T::CreatedBy, 256))
        .col(s(T::UpdatedBy, 256))
        .col(b(T::CreatedAt))
        .col(b(T::UpdatedAt))
        .to_owned()
}

fn secret_backend_identities() -> TableCreateStatement {
    use SecretBackendIdentities as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::Provider, 32))
        .col(s(T::Principal, 512))
        .col(s(T::Source, 16))
        .col(s(T::State, 16))
        .col(s(T::Incarnation, 27))
        .col(s_nullable(T::NextPrincipal, 512))
        .col(s_nullable(T::NextIncarnation, 27))
        .col(s_nullable(T::IdAccount, 64))
        .col(s(T::PolicyHash, 64))
        .col(b(T::DesiredGen))
        .col(b(T::AppliedGen))
        .col(ColumnDef::new(T::RotateRequested).boolean().not_null())
        .col(ColumnDef::new(T::DeleteAfter).big_integer().null())
        .col(s_nullable(T::LeaseOwner, 64))
        .col(ColumnDef::new(T::LeaseUntil).big_integer().null())
        .col(ColumnDef::new(T::LastVerifiedAt).big_integer().null())
        .col(s_nullable(T::LastError, 256))
        .col(s(T::CreatedBy, 256))
        .col(b(T::CreatedAt))
        .col(b(T::UpdatedAt))
        .primary_key(Index::create().col(T::OrgId).col(T::Provider))
        .to_owned()
}

fn secret_identity_jobs() -> TableCreateStatement {
    use SecretIdentityJobs as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::Id, 27).primary_key())
        .col(s(T::OrgId, 256))
        .col(s(T::Provider, 32))
        .col(b(T::Gen))
        .col(s(T::Did, 64))
        .col(s(T::State, 16))
        .col(ColumnDef::new(T::Attempts).integer().not_null())
        .col(s(T::RequestedBy, 256))
        .col(s_nullable(T::Error, 256))
        .col(b(T::CreatedAt))
        .col(b(T::UpdatedAt))
        .to_owned()
}

fn secret_backend_readiness() -> TableCreateStatement {
    use SecretBackendReadiness as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::BackendId, 27))
        .col(s(T::IdentityRev, 64))
        .col(s(T::BackendRev, 27))
        .col(b(T::PassedAt))
        .primary_key(
            Index::create()
                .col(T::OrgId)
                .col(T::BackendId)
                .col(T::IdentityRev),
        )
        .to_owned()
}

fn added_columns() -> [(&'static str, &'static str, ColumnDef); 2] {
    [
        (
            "org_secret_values",
            "backend_id",
            s_nullable(Alias::new("backend_id"), 27),
        ),
        (
            "organizations",
            "org_incarnation",
            s(Alias::new("org_incarnation"), 27).default("").to_owned(),
        ),
    ]
}

fn indexes() -> [IndexCreateStatement; 4] {
    use SecretBackends as B;
    use SecretIdentityJobs as J;
    [
        Index::create()
            .name("secret_backends_org_name_idx")
            .table(B::Table)
            .col(B::OrgId)
            .col(B::Name)
            .unique()
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("secret_backends_org_id_idx")
            .table(B::Table)
            .col(B::OrgId)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name("secret_identity_jobs_org_provider_idx")
            .table(J::Table)
            .col(J::OrgId)
            .col(J::Provider)
            .if_not_exists()
            .to_owned(),
        Index::create()
            .name(VALUE_BACKEND_INDEX)
            .table(Alias::new("org_secret_values"))
            .col(Alias::new("org_id"))
            .col(Alias::new("backend_id"))
            .col(Alias::new("secret_id"))
            .if_not_exists()
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, EntityTrait, IdenStatic, Iterable, Statement};

    use super::*;
    use crate::table::{
        entity::{
            secret_backend_identities, secret_backend_readiness, secret_backends,
            secret_identity_jobs,
        },
        testing::meta_store,
    };

    async fn check_entity<E: EntityTrait>(manager: &SchemaManager<'_>, entity: E) {
        let table = entity.table_name();
        assert!(manager.has_table(table).await.unwrap(), "{table}");
        for column in E::Column::iter() {
            let name = column.as_str();
            assert!(
                manager.has_column(table, name).await.unwrap(),
                "{table}.{name}"
            );
        }
    }

    #[tokio::test]
    async fn migrated_schema_has_backend_tables_columns_and_indexes() {
        if !meta_store().await {
            return;
        }
        let manager = SchemaManager::new(crate::db::get_orm_client_rw().await);
        check_entity(&manager, secret_backends::Entity).await;
        check_entity(&manager, secret_backend_identities::Entity).await;
        check_entity(&manager, secret_identity_jobs::Entity).await;
        check_entity(&manager, secret_backend_readiness::Entity).await;
        for (table, column, _) in added_columns() {
            assert!(
                manager.has_column(table, column).await.unwrap(),
                "{table}.{column}"
            );
        }
        for (table, idx) in [
            ("secret_backends", "secret_backends_org_name_idx"),
            ("secret_backends", "secret_backends_org_id_idx"),
            (
                "secret_identity_jobs",
                "secret_identity_jobs_org_provider_idx",
            ),
            ("org_secret_values", VALUE_BACKEND_INDEX),
        ] {
            assert!(manager.has_index(table, idx).await.unwrap(), "{idx}");
        }
    }

    #[tokio::test]
    async fn rollback_preserves_legacy_rows_and_allows_reapplication() {
        if !meta_store().await {
            return;
        }
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        for sql in [
            "CREATE TABLE organizations (identifier TEXT PRIMARY KEY)",
            "CREATE TABLE org_secret_values (org_id TEXT, secret_id TEXT)",
            "INSERT INTO organizations VALUES ('legacy')",
            "INSERT INTO org_secret_values VALUES ('legacy', 'secret')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        for _ in 0..2 {
            Migration.up(&manager).await.unwrap();
            Migration.up(&manager).await.unwrap();
            let query = "SELECT o.org_incarnation, v.backend_id FROM organizations o \
                         JOIN org_secret_values v ON v.org_id = o.identifier \
                         WHERE v.secret_id = 'secret'";
            let row = db
                .query_one(Statement::from_string(db.get_database_backend(), query))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.try_get::<String>("", "org_incarnation").unwrap(), "");
            assert_eq!(
                row.try_get::<Option<String>>("", "backend_id").unwrap(),
                None
            );
            Migration.down(&manager).await.unwrap();
            for (table, column, _) in added_columns() {
                assert!(
                    !manager.has_column(table, column).await.unwrap(),
                    "{column}"
                );
            }
            for table in [
                "secret_backends",
                "secret_backend_identities",
                "secret_identity_jobs",
                "secret_backend_readiness",
            ] {
                assert!(!manager.has_table(table).await.unwrap(), "{table}");
            }
        }
    }
}
