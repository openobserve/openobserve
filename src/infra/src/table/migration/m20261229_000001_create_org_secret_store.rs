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

//! Creates the org secret store tables. No foreign keys: org cleanup deletes by `org_id`.

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

/// Same text on PostgreSQL and SQLite, so neither backend needs its own arm.
const NAME_LIVE_SQL: &str = "CREATE UNIQUE INDEX IF NOT EXISTS org_secrets_org_name_live_idx ON \
                             org_secrets (org_id, name) WHERE state IN ('active','deleted')";
const KIND_NAME_SQL: &str = "CREATE INDEX IF NOT EXISTS org_secrets_org_kind_name_idx ON \
                             org_secrets (org_id, kind, name, id) WHERE state IN \
                             ('active','deleted')";

pub(crate) const TABLES: [&str; 9] = [
    "org_secrets",
    "org_secret_values",
    "org_secret_consumers",
    "secret_refs",
    "secret_dependencies",
    "secret_consumer_auth",
    "secret_aliases",
    "org_secret_value_status",
    "secret_arrival_pending",
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES.iter().rev() {
            manager
                .drop_table(
                    Table::drop()
                        .table(Alias::new(*table))
                        .if_exists()
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum OrgSecrets {
    Table,
    Id,
    OrgId,
    Name,
    Kind,
    Description,
    AllowedHosts,
    PinMode,
    PinOverrideReason,
    PinOverrideBy,
    PinOverrideAt,
    PrivateLocations,
    PrivateLocationsReason,
    PrivateLocationsBy,
    PrivateLocationsAt,
    State,
    PolicyRev,
    PolicyVersion,
    PolicyStamp,
    OriginRegion,
    CreatedBy,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
    PurgeAfter,
    PurgedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum OrgSecretValues {
    Table,
    Id,
    SecretId,
    OrgId,
    EnvId,
    EnvIncarnation,
    State,
    ValueRef,
    ValueRev,
    ValueVersion,
    UpdatedBy,
}

#[derive(DeriveIden, Clone, Copy)]
enum OrgSecretConsumers {
    Table,
    SecretId,
    OrgId,
    ConsumerType,
    ConsumerId,
    AddedBy,
    AddedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretRefs {
    Table,
    Id,
    OrgId,
    ConsumerType,
    ConsumerId,
    Field,
    SecretId,
    TokenName,
    CreatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretDependencies {
    Table,
    OrgId,
    ConsumerType,
    ConsumerId,
    DepKey,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretConsumerAuth {
    Table,
    OrgId,
    ConsumerType,
    ConsumerId,
    ConsumerName,
    ConsumerRev,
    DeliveryDigest,
    DepDigests,
    AuthorizedBy,
    Via,
    AuthTag,
    AuthState,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretAliases {
    Table,
    OrgId,
    Name,
    SecretId,
    ExpiresAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum OrgSecretValueStatus {
    Table,
    SecretId,
    OrgId,
    EnvId,
    EnvIncarnation,
    Region,
    State,
    Source,
    ValueVersion,
    UpdatedBy,
    UpdatedAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretArrivalPending {
    Table,
    OrgId,
    ConsumerType,
    ConsumerId,
    SavedBy,
    Refs,
    Op,
    RemovedEnvs,
    ArrivalMac,
    Reason,
    Attempts,
    NextAt,
    ReceivedAt,
}

/// Creates every table and index; shared by the migration and the tests.
pub(crate) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    for table in tables() {
        conn.execute(backend.build(&table)).await?;
    }
    for index in indexes() {
        conn.execute(backend.build(&index)).await?;
    }
    conn.execute_unprepared(NAME_LIVE_SQL).await?;
    conn.execute_unprepared(KIND_NAME_SQL).await?;
    Ok(())
}

fn s(col: impl IntoIden, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).not_null().to_owned()
}

fn s_default(col: impl IntoIden, len: u32, default: &str) -> ColumnDef {
    s(col, len).default(default).to_owned()
}

fn t_default(col: impl IntoIden) -> ColumnDef {
    ColumnDef::new(col).text().not_null().default("").to_owned()
}

fn t(col: impl IntoIden) -> ColumnDef {
    ColumnDef::new(col).text().not_null().to_owned()
}

fn b(col: impl IntoIden) -> ColumnDef {
    ColumnDef::new(col).big_integer().not_null().to_owned()
}

fn b_default(col: impl IntoIden) -> ColumnDef {
    b(col).default(0).to_owned()
}

fn tables() -> [TableCreateStatement; 9] {
    [
        org_secrets(),
        org_secret_values(),
        org_secret_consumers(),
        secret_refs(),
        secret_dependencies(),
        secret_consumer_auth(),
        secret_aliases(),
        org_secret_value_status(),
        secret_arrival_pending(),
    ]
}

fn org_secrets() -> TableCreateStatement {
    use OrgSecrets as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::Id, 27).primary_key())
        .col(s(T::OrgId, 256))
        .col(s(T::Name, 128))
        .col(s(T::Kind, 16))
        .col(t_default(T::Description))
        .col(t_default(T::AllowedHosts))
        .col(s_default(T::PinMode, 16, "none"))
        .col(t_default(T::PinOverrideReason))
        .col(s_default(T::PinOverrideBy, 256, ""))
        .col(b_default(T::PinOverrideAt))
        .col(s_default(T::PrivateLocations, 16, "off"))
        .col(t_default(T::PrivateLocationsReason))
        .col(s_default(T::PrivateLocationsBy, 256, ""))
        .col(b_default(T::PrivateLocationsAt))
        .col(s(T::State, 16))
        .col(s(T::PolicyRev, 27))
        .col(b(T::PolicyVersion))
        .col(b_default(T::PolicyStamp))
        .col(s_default(T::OriginRegion, 64, ""))
        .col(s(T::CreatedBy, 256))
        .col(s(T::UpdatedBy, 256))
        .col(b(T::CreatedAt))
        .col(b(T::UpdatedAt))
        .col(b_default(T::DeletedAt))
        .col(b_default(T::PurgeAfter))
        .col(b_default(T::PurgedAt))
        .to_owned()
}

fn org_secret_values() -> TableCreateStatement {
    use OrgSecretValues as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::Id, 27).primary_key())
        .col(s(T::SecretId, 27))
        .col(s(T::OrgId, 256))
        .col(s(T::EnvId, 256))
        .col(s_default(T::EnvIncarnation, 27, ""))
        .col(s(T::State, 16))
        .col(ColumnDef::new(T::ValueRef).string_len(27).null())
        .col(s(T::ValueRev, 27))
        .col(b(T::ValueVersion))
        .col(s(T::UpdatedBy, 256))
        .to_owned()
}

fn org_secret_consumers() -> TableCreateStatement {
    use OrgSecretConsumers as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::SecretId, 27))
        .col(s(T::OrgId, 256))
        .col(s(T::ConsumerType, 64))
        .col(s(T::ConsumerId, 256))
        .col(s(T::AddedBy, 256))
        .col(b(T::AddedAt))
        .primary_key(
            Index::create()
                .col(T::SecretId)
                .col(T::ConsumerType)
                .col(T::ConsumerId),
        )
        .to_owned()
}

fn secret_refs() -> TableCreateStatement {
    use SecretRefs as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::Id, 27).primary_key())
        .col(s(T::OrgId, 256))
        .col(s(T::ConsumerType, 64))
        .col(s(T::ConsumerId, 256))
        .col(s(T::Field, 256))
        .col(s(T::SecretId, 27))
        .col(s(T::TokenName, 128))
        .col(b(T::CreatedAt))
        .to_owned()
}

fn secret_dependencies() -> TableCreateStatement {
    use SecretDependencies as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::ConsumerType, 64))
        .col(s(T::ConsumerId, 256))
        .col(s(T::DepKey, 256))
        .primary_key(
            Index::create()
                .col(T::OrgId)
                .col(T::ConsumerType)
                .col(T::ConsumerId)
                .col(T::DepKey),
        )
        .to_owned()
}

fn secret_consumer_auth() -> TableCreateStatement {
    use SecretConsumerAuth as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::ConsumerType, 64))
        .col(s(T::ConsumerId, 256))
        .col(s(T::ConsumerName, 256))
        .col(b(T::ConsumerRev))
        .col(s(T::DeliveryDigest, 64))
        .col(t(T::DepDigests))
        .col(s(T::AuthorizedBy, 256))
        .col(s(T::Via, 32))
        .col(s(T::AuthTag, 64))
        .col(s_default(T::AuthState, 32, "ok"))
        .col(b(T::UpdatedAt))
        .primary_key(
            Index::create()
                .col(T::OrgId)
                .col(T::ConsumerType)
                .col(T::ConsumerId),
        )
        .to_owned()
}

fn secret_aliases() -> TableCreateStatement {
    use SecretAliases as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::Name, 128))
        .col(s(T::SecretId, 27))
        .col(b(T::ExpiresAt))
        .primary_key(Index::create().col(T::OrgId).col(T::Name))
        .to_owned()
}

fn org_secret_value_status() -> TableCreateStatement {
    use OrgSecretValueStatus as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::SecretId, 27))
        .col(s(T::OrgId, 256))
        .col(s(T::EnvId, 256))
        .col(s_default(T::EnvIncarnation, 27, ""))
        .col(s(T::Region, 64))
        .col(s(T::State, 16))
        .col(s(T::Source, 16))
        .col(b(T::ValueVersion))
        .col(s(T::UpdatedBy, 256))
        .col(b(T::UpdatedAt))
        .primary_key(
            Index::create()
                .col(T::SecretId)
                .col(T::EnvId)
                .col(T::EnvIncarnation)
                .col(T::Region),
        )
        .to_owned()
}

fn secret_arrival_pending() -> TableCreateStatement {
    use SecretArrivalPending as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::ConsumerType, 64))
        .col(s(T::ConsumerId, 256))
        .col(s(T::SavedBy, 256))
        .col(t(T::Refs))
        .col(s(T::Op, 8))
        .col(t(T::RemovedEnvs))
        .col(s(T::ArrivalMac, 64))
        .col(s(T::Reason, 64))
        .col(ColumnDef::new(T::Attempts).integer().not_null().default(0))
        .col(b(T::NextAt))
        .col(b(T::ReceivedAt))
        .primary_key(
            Index::create()
                .col(T::OrgId)
                .col(T::ConsumerType)
                .col(T::ConsumerId),
        )
        .to_owned()
}

fn index(name: &str, table: impl IntoIden + 'static) -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name(name)
        .table(table)
        .to_owned()
}

fn indexes() -> Vec<IndexCreateStatement> {
    vec![
        index("org_secrets_state_purge_after_idx", OrgSecrets::Table)
            .col(OrgSecrets::State)
            .col(OrgSecrets::PurgeAfter)
            .to_owned(),
        index("org_secrets_org_id_idx", OrgSecrets::Table)
            .col(OrgSecrets::OrgId)
            .to_owned(),
        index("org_secrets_org_state_id_idx", OrgSecrets::Table)
            .col(OrgSecrets::OrgId)
            .col(OrgSecrets::State)
            .col(OrgSecrets::Id)
            .to_owned(),
        // Respell windows scan every org at once, so the timestamp leads alone.
        index("org_secrets_updated_at_idx", OrgSecrets::Table)
            .col(OrgSecrets::UpdatedAt)
            .to_owned(),
        index(
            "org_secret_values_secret_env_inc_idx",
            OrgSecretValues::Table,
        )
        .col(OrgSecretValues::SecretId)
        .col(OrgSecretValues::EnvId)
        .col(OrgSecretValues::EnvIncarnation)
        .unique()
        .to_owned(),
        index("org_secret_values_org_id_idx", OrgSecretValues::Table)
            .col(OrgSecretValues::OrgId)
            .to_owned(),
        index(
            "org_secret_values_org_id_env_id_idx",
            OrgSecretValues::Table,
        )
        .col(OrgSecretValues::OrgId)
        .col(OrgSecretValues::EnvId)
        .to_owned(),
        index("org_secret_consumers_org_id_idx", OrgSecretConsumers::Table)
            .col(OrgSecretConsumers::OrgId)
            .to_owned(),
        index(
            "secret_refs_org_consumer_field_secret_idx",
            SecretRefs::Table,
        )
        .col(SecretRefs::OrgId)
        .col(SecretRefs::ConsumerType)
        .col(SecretRefs::ConsumerId)
        .col(SecretRefs::Field)
        .col(SecretRefs::SecretId)
        .unique()
        .to_owned(),
        index("secret_refs_org_id_secret_id_idx", SecretRefs::Table)
            .col(SecretRefs::OrgId)
            .col(SecretRefs::SecretId)
            .to_owned(),
        index("secret_refs_created_at_idx", SecretRefs::Table)
            .col(SecretRefs::CreatedAt)
            .to_owned(),
        index(
            "secret_dependencies_org_id_dep_key_idx",
            SecretDependencies::Table,
        )
        .col(SecretDependencies::OrgId)
        .col(SecretDependencies::DepKey)
        .to_owned(),
        index("secret_aliases_secret_id_idx", SecretAliases::Table)
            .col(SecretAliases::SecretId)
            .to_owned(),
        index(
            "org_secret_value_status_org_id_secret_id_idx",
            OrgSecretValueStatus::Table,
        )
        .col(OrgSecretValueStatus::OrgId)
        .col(OrgSecretValueStatus::SecretId)
        .to_owned(),
        index(
            "secret_arrival_pending_next_at_idx",
            SecretArrivalPending::Table,
        )
        .col(SecretArrivalPending::NextAt)
        .to_owned(),
        index(
            "secret_arrival_pending_org_id_idx",
            SecretArrivalPending::Table,
        )
        .col(SecretArrivalPending::OrgId)
        .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
    use sea_orm_migration::MigratorTrait;

    use super::*;
    use crate::table::{
        entity::{
            org_secret_values, org_secrets,
            org_secrets::{PinMode, PrivateLocations},
            secret_consumer_auth::AuthState,
        },
        testing::{meta_store, unique},
    };

    const PERF_INDEXES: [(&str, &str); 3] = [
        ("org_secrets", "org_secrets_org_state_id_idx"),
        ("org_secrets", "org_secrets_updated_at_idx"),
        ("secret_refs", "secret_refs_created_at_idx"),
    ];

    struct MigratorWithoutStore;

    #[async_trait::async_trait]
    impl MigratorTrait for MigratorWithoutStore {
        fn migrations() -> Vec<Box<dyn MigrationTrait>> {
            crate::table::migration::Migrator::migrations()
                .into_iter()
                .filter(|m| !m.name().starts_with("m20261226_"))
                .collect()
        }
    }

    async fn conn() -> &'static DatabaseConnection {
        crate::db::get_orm_client_rw().await
    }

    fn secret(org: &str, name: &str, state: &str) -> org_secrets::ActiveModel {
        org_secrets::ActiveModel {
            id: Set(config::ider::ksuid()),
            org_id: Set(org.to_string()),
            name: Set(name.to_string()),
            kind: Set("secret".to_string()),
            state: Set(state.to_string()),
            policy_rev: Set(config::ider::ksuid()),
            policy_version: Set(1),
            created_by: Set("u".to_string()),
            updated_by: Set("u".to_string()),
            created_at: Set(1),
            updated_at: Set(1),
            ..Default::default()
        }
    }

    async fn insert(org: &str, name: &str, state: &str) -> Result<org_secrets::Model, DbErr> {
        secret(org, name, state).insert(conn().await).await
    }

    fn value(secret_id: &str, org: &str, incarnation: &str) -> org_secret_values::ActiveModel {
        org_secret_values::ActiveModel {
            id: Set(config::ider::ksuid()),
            secret_id: Set(secret_id.to_string()),
            org_id: Set(org.to_string()),
            env_id: Set(format!("{org}/prod")),
            env_incarnation: Set(incarnation.to_string()),
            state: Set("set".to_string()),
            value_ref: Set(None),
            value_rev: Set(config::ider::ksuid()),
            value_version: Set(1),
            updated_by: Set("u".to_string()),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn live_names_are_unique_per_org_and_tombstones_are_not() {
        if !meta_store().await {
            return;
        }
        let org = unique("sec_uq");
        insert(&org, "TOKEN", "active").await.unwrap();
        assert!(insert(&org, "TOKEN", "active").await.is_err());
        assert!(insert(&org, "TOKEN", "deleted").await.is_err());
        insert(&org, "TOKEN", "conflict").await.unwrap();
        insert(&org, "", "purged").await.unwrap();
        insert(&org, "", "purged").await.unwrap();
        insert(&org, "token", "active").await.unwrap();
        insert(&unique("sec_uq_b"), "TOKEN", "active")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_minimal_tombstone_gets_defaults_for_every_policy_column() {
        if !meta_store().await {
            return;
        }
        let row = insert(&unique("sec_tomb"), "", "purged").await.unwrap();
        let row = org_secrets::Entity::find_by_id(row.id)
            .one(conn().await)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.pin_mode, PinMode::None);
        assert_eq!(row.private_locations, PrivateLocations::Off);
        assert_eq!(
            (
                row.private_locations_reason.as_str(),
                row.private_locations_at
            ),
            ("", 0)
        );
        assert_eq!((row.policy_stamp, row.origin_region.as_str()), (0, ""));
        assert_eq!((row.deleted_at, row.purge_after, row.purged_at), (0, 0, 0));
        assert_eq!(row.description, "");
    }

    #[tokio::test]
    async fn two_incarnations_of_one_env_coexist_but_not_twice() {
        if !meta_store().await {
            return;
        }
        let org = unique("sec_inc");
        let sid = config::ider::ksuid();
        value(&sid, &org, "inc1")
            .insert(conn().await)
            .await
            .unwrap();
        value(&sid, &org, "inc2")
            .insert(conn().await)
            .await
            .unwrap();
        assert!(
            value(&sid, &org, "inc1")
                .insert(conn().await)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn up_down_up_restores_every_table() {
        if !meta_store().await {
            return;
        }
        let ddl = crate::db::get_orm_client_ddl().await;
        let manager = SchemaManager::new(ddl);
        Migration.down(&manager).await.unwrap();
        for table in TABLES {
            assert!(!manager.has_table(table).await.unwrap(), "{table}");
        }
        for (table, index) in PERF_INDEXES {
            assert!(!manager.has_index(table, index).await.unwrap(), "{index}");
        }
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        // Later 160 migrations add columns to these tables; the shared meta store needs them back.
        super::super::m20261229_000003_add_secret_store_columns::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20261229_000005_create_secret_backends::Migration
            .up(&manager)
            .await
            .unwrap();
        for table in TABLES {
            assert!(manager.has_table(table).await.unwrap(), "{table}");
        }
        assert!(
            manager
                .has_index("org_secrets", "org_secrets_org_name_live_idx")
                .await
                .unwrap()
        );
        for (table, index) in PERF_INDEXES {
            assert!(manager.has_index(table, index).await.unwrap(), "{index}");
        }
    }

    #[tokio::test]
    async fn a_binary_without_these_migrations_refuses_the_upgraded_db() {
        if !meta_store().await {
            return;
        }
        let err = MigratorWithoutStore::up(crate::db::get_orm_client_ddl().await, None)
            .await
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("m20261229_000001_create_org_secret_store"),
            "{err}"
        );
        assert!(err.contains("is missing"), "{err}");
    }

    #[test]
    fn policy_enums_accept_only_their_values() {
        use sea_orm::{ActiveEnum, Iterable};
        let pins: Vec<String> = PinMode::iter().map(|v| v.to_value()).collect();
        assert_eq!(pins, ["none", "hosts", "any", "legacy"]);
        let locs: Vec<String> = PrivateLocations::iter().map(|v| v.to_value()).collect();
        assert_eq!(locs, ["off", "on", "legacy"]);
        let auth: Vec<String> = AuthState::iter().map(|v| v.to_value()).collect();
        assert_eq!(auth, ["ok", "stale"]);
        assert!(AuthState::try_from_value(&"pending".to_string()).is_err());
        assert!(PrivateLocations::try_from_value(&"maybe".to_string()).is_err());
    }

    #[test]
    fn region_columns_live_only_where_the_design_puts_them() {
        use sea_orm::Iterable;

        use crate::table::entity::*;
        fn cols<E: EntityTrait>() -> (String, Vec<String>) {
            let names = E::Column::iter()
                .map(|c| sea_orm::IdenStatic::as_str(&c).to_string())
                .collect();
            (E::default().table_name().to_string(), names)
        }
        let all = [
            cols::<org_secrets::Entity>(),
            cols::<org_secret_values::Entity>(),
            cols::<org_secret_consumers::Entity>(),
            cols::<secret_refs::Entity>(),
            cols::<secret_dependencies::Entity>(),
            cols::<secret_consumer_auth::Entity>(),
            cols::<secret_aliases::Entity>(),
            cols::<org_secret_value_status::Entity>(),
            cols::<secret_arrival_pending::Entity>(),
            cols::<secret_prescan_hits::Entity>(),
            cols::<secret_store_job_markers::Entity>(),
        ];
        for (table, columns) in &all {
            assert!(table != "secret_reveal_log");
            assert!(!columns.iter().any(|c| c == "origin_cluster"), "{table}");
            let has = |c: &str| columns.iter().any(|x| x == c);
            assert_eq!(has("region"), table == "org_secret_value_status", "{table}");
            assert_eq!(has("origin_region"), table == "org_secrets", "{table}");
        }
        let tables: Vec<&str> = all.iter().map(|(t, _)| t.as_str()).collect();
        let mut expected: Vec<&str> = TABLES.to_vec();
        expected.extend(super::super::m20261229_000002_create_secret_store_jobs::TABLES);
        assert_eq!(tables, expected);
    }
}
