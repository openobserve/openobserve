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

//! Fleet Manager: every fleet table in its slice-4 shape.

use sea_orm_migration::prelude::*;

use super::get_text_type;

const DEFAULT_FLEET: &str = "default";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in tables() {
            manager.create_table(table).await?;
        }
        for index in indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            FleetRolloutMembers::Table.into_iden(),
            FleetRollouts::Table.into_iden(),
            Fleets::Table.into_iden(),
            FleetSettings::Table.into_iden(),
            FleetConfigVersions::Table.into_iden(),
            FleetConfigs::Table.into_iden(),
            FleetTokens::Table.into_iden(),
            FleetCollectors::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum FleetCollectors {
    Table,
    OrgId,
    Id,
    Name,
    Hostname,
    Ip,
    Os,
    Arch,
    Distribution,
    Version,
    Capabilities,
    CapabilitiesAt,
    Healthy,
    Health,
    EffectiveConfig,
    EffectiveHash,
    RemoteStatus,
    RemoteError,
    RemoteHash,
    DescriptionAt,
    HealthAt,
    EffectiveAt,
    RemoteStatusAt,
    EnrolledAt,
    LastSeenAt,
    TokenId,
    AssignmentRev,
    ConfigId,
    ConfigVersion,
    DesiredHash,
    AssignedAt,
    ActiveRolloutId,
    AppliedAt,
    SentRev,
    SentAt,
    EffectiveConfigId,
    EffectiveConfigVersion,
    Heartbeats,
    FleetId,
}

#[derive(DeriveIden)]
enum FleetTokens {
    Table,
    Id,
    OrgId,
    Name,
    Prefix,
    TokenHash,
    Token,
    Scope,
    ExpiresAt,
    MaxUses,
    Uses,
    Revoked,
    CreatedAt,
    CreatedBy,
    FleetId,
}

#[derive(DeriveIden)]
enum FleetConfigs {
    Table,
    OrgId,
    Id,
    Description,
    LatestVersion,
    DraftYaml,
    DraftBy,
    DraftAt,
    UpdatedAt,
    UpdatedBy,
    LiveVersion,
}

#[derive(DeriveIden)]
enum FleetConfigVersions {
    Table,
    OrgId,
    ConfigId,
    Version,
    Yaml,
    Hash,
    Message,
    Author,
    CreatedAt,
}

#[derive(DeriveIden)]
enum FleetSettings {
    Table,
    OrgId,
    RestrictedComponents,
    TargetVersion,
    FleetDefaults,
}

#[derive(DeriveIden)]
enum Fleets {
    Table,
    OrgId,
    FleetId,
    ConfigId,
    ConfigVersion,
    StableConfigId,
    StableConfigVersion,
    UpdatedAt,
    UpdatedBy,
    Settings,
}

#[derive(DeriveIden)]
enum FleetRollouts {
    Table,
    Id,
    OrgId,
    ConfigId,
    FromVersion,
    ToVersion,
    FleetId,
    Strategy,
    Status,
    Phases,
    Failure,
    Events,
    StartedAt,
    StartedBy,
    Rev,
    AutoRollback,
    ScheduledFor,
    Gates,
}

#[derive(DeriveIden)]
enum FleetRolloutMembers {
    Table,
    RolloutId,
    CollectorId,
    OrgId,
    Phase,
    PrevConfigId,
    PrevVersion,
    State,
    AssignedRev,
    HeartbeatBase,
}

fn text() -> Alias {
    Alias::new(get_text_type())
}

fn big(column: impl IntoIden) -> ColumnDef {
    ColumnDef::new(column).big_integer().null().to_owned()
}

fn big_not_null(column: impl IntoIden) -> ColumnDef {
    ColumnDef::new(column).big_integer().not_null().to_owned()
}

fn fleet_column(column: impl IntoIden) -> ColumnDef {
    ColumnDef::new(column)
        .string_len(64)
        .not_null()
        .default(DEFAULT_FLEET)
        .to_owned()
}

fn tables() -> [TableCreateStatement; 8] {
    [
        collectors_table(),
        tokens_table(),
        configs_table(),
        versions_table(),
        settings_table(),
        fleets_table(),
        rollouts_table(),
        members_table(),
    ]
}

fn collectors_table() -> TableCreateStatement {
    use FleetCollectors as C;
    let mut table = Table::create();
    table
        .table(C::Table)
        .if_not_exists()
        .col(ColumnDef::new(C::Id).string_len(36).not_null())
        .col(ColumnDef::new(C::OrgId).string().not_null());
    for column in [
        C::Name,
        C::Hostname,
        C::Ip,
        C::Os,
        C::Arch,
        C::Distribution,
        C::Version,
    ] {
        table.col(ColumnDef::new(column).string().null());
    }
    for column in [
        C::Capabilities,
        C::CapabilitiesAt,
        C::DescriptionAt,
        C::HealthAt,
        C::EffectiveAt,
        C::RemoteStatusAt,
    ] {
        table.col(big(column));
    }
    for column in [C::EffectiveConfig, C::RemoteError] {
        table.col(ColumnDef::new(column).custom(text()).null());
    }
    for column in [C::EffectiveHash, C::RemoteHash, C::DesiredHash] {
        table.col(ColumnDef::new(column).binary().null());
    }
    table
        .col(ColumnDef::new(C::Healthy).boolean().null())
        .col(ColumnDef::new(C::Health).custom(text()).null())
        .col(ColumnDef::new(C::RemoteStatus).integer().null())
        .col(big_not_null(C::EnrolledAt))
        .col(big_not_null(C::LastSeenAt))
        .col(ColumnDef::new(C::TokenId).string_len(36).null())
        .col(big_not_null(C::AssignmentRev).default(0).to_owned())
        .col(ColumnDef::new(C::ConfigId).string_len(63).null())
        .col(ColumnDef::new(C::ActiveRolloutId).string().null())
        .col(ColumnDef::new(C::EffectiveConfigId).string_len(63).null())
        .col(big_not_null(C::Heartbeats).default(0).to_owned())
        .col(fleet_column(C::FleetId));
    for column in [
        C::ConfigVersion,
        C::AssignedAt,
        C::AppliedAt,
        C::SentRev,
        C::SentAt,
        C::EffectiveConfigVersion,
    ] {
        table.col(big(column));
    }
    table
        .primary_key(Index::create().col(C::OrgId).col(C::Id))
        .to_owned()
}

fn tokens_table() -> TableCreateStatement {
    use FleetTokens as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(T::Id)
                .string_len(36)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(T::OrgId).string().not_null())
        .col(ColumnDef::new(T::Name).string_len(256).not_null())
        .col(ColumnDef::new(T::Prefix).string_len(9).not_null())
        .col(ColumnDef::new(T::TokenHash).string_len(64).not_null())
        .col(ColumnDef::new(T::Token).string_len(128))
        .col(ColumnDef::new(T::Scope).string_len(32).not_null())
        .col(big(T::ExpiresAt))
        .col(big(T::MaxUses))
        .col(big_not_null(T::Uses).default(0).to_owned())
        .col(
            ColumnDef::new(T::Revoked)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(big_not_null(T::CreatedAt))
        .col(ColumnDef::new(T::CreatedBy).string().not_null())
        .col(fleet_column(T::FleetId))
        .to_owned()
}

fn configs_table() -> TableCreateStatement {
    use FleetConfigs as F;
    Table::create()
        .table(F::Table)
        .if_not_exists()
        .col(ColumnDef::new(F::Id).string_len(63).not_null())
        .col(ColumnDef::new(F::OrgId).string().not_null())
        .col(ColumnDef::new(F::Description).custom(text()).not_null())
        .col(big_not_null(F::LatestVersion).default(0).to_owned())
        .col(ColumnDef::new(F::DraftYaml).custom(text()).null())
        .col(ColumnDef::new(F::DraftBy).string().null())
        .col(big(F::DraftAt))
        .col(big_not_null(F::UpdatedAt))
        .col(ColumnDef::new(F::UpdatedBy).string().not_null())
        .col(big(F::LiveVersion))
        .primary_key(Index::create().col(F::OrgId).col(F::Id))
        .to_owned()
}

fn versions_table() -> TableCreateStatement {
    use FleetConfigVersions as V;
    Table::create()
        .table(V::Table)
        .if_not_exists()
        .col(ColumnDef::new(V::ConfigId).string_len(63).not_null())
        .col(big_not_null(V::Version))
        .col(ColumnDef::new(V::OrgId).string().not_null())
        .col(ColumnDef::new(V::Yaml).custom(text()).not_null())
        .col(ColumnDef::new(V::Hash).binary().not_null())
        .col(ColumnDef::new(V::Message).custom(text()).not_null())
        .col(ColumnDef::new(V::Author).string().not_null())
        .col(big_not_null(V::CreatedAt))
        .primary_key(
            Index::create()
                .col(V::OrgId)
                .col(V::ConfigId)
                .col(V::Version),
        )
        .to_owned()
}

fn settings_table() -> TableCreateStatement {
    use FleetSettings as S;
    Table::create()
        .table(S::Table)
        .if_not_exists()
        .col(ColumnDef::new(S::OrgId).string().not_null().primary_key())
        .col(
            ColumnDef::new(S::RestrictedComponents)
                .custom(text())
                .not_null(),
        )
        .col(ColumnDef::new(S::TargetVersion).string_len(32).null())
        .col(ColumnDef::new(S::FleetDefaults).custom(text()).null())
        .to_owned()
}

fn fleets_table() -> TableCreateStatement {
    use Fleets as F;
    Table::create()
        .table(F::Table)
        .if_not_exists()
        .col(ColumnDef::new(F::FleetId).string_len(64).not_null())
        .col(ColumnDef::new(F::OrgId).string().not_null())
        .col(ColumnDef::new(F::ConfigId).string_len(63).null())
        .col(big(F::ConfigVersion))
        .col(ColumnDef::new(F::StableConfigId).string_len(63).null())
        .col(big(F::StableConfigVersion))
        .col(big_not_null(F::UpdatedAt))
        .col(ColumnDef::new(F::UpdatedBy).string().not_null())
        .col(ColumnDef::new(F::Settings).custom(text()).null())
        .primary_key(Index::create().col(F::OrgId).col(F::FleetId))
        .to_owned()
}

fn rollouts_table() -> TableCreateStatement {
    use FleetRollouts as R;
    Table::create()
        .table(R::Table)
        .if_not_exists()
        .col(ColumnDef::new(R::Id).string().not_null().primary_key())
        .col(ColumnDef::new(R::OrgId).string().not_null())
        .col(ColumnDef::new(R::ConfigId).string_len(63).not_null())
        .col(big(R::FromVersion))
        .col(big_not_null(R::ToVersion))
        .col(ColumnDef::new(R::FleetId).string_len(64).not_null())
        .col(ColumnDef::new(R::Strategy).string_len(16).not_null())
        .col(ColumnDef::new(R::Status).string_len(16).not_null())
        .col(ColumnDef::new(R::Phases).custom(text()).not_null())
        .col(ColumnDef::new(R::Failure).custom(text()).null())
        .col(ColumnDef::new(R::Events).custom(text()).not_null())
        .col(big_not_null(R::StartedAt))
        .col(ColumnDef::new(R::StartedBy).string().not_null())
        .col(big_not_null(R::Rev).default(0).to_owned())
        .col(
            ColumnDef::new(R::AutoRollback)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(big(R::ScheduledFor))
        .col(ColumnDef::new(R::Gates).custom(text()).null())
        .to_owned()
}

fn members_table() -> TableCreateStatement {
    use FleetRolloutMembers as M;
    Table::create()
        .table(M::Table)
        .if_not_exists()
        .col(ColumnDef::new(M::RolloutId).string().not_null())
        .col(ColumnDef::new(M::CollectorId).string_len(36).not_null())
        .col(ColumnDef::new(M::OrgId).string().not_null())
        .col(ColumnDef::new(M::Phase).integer().not_null())
        .col(ColumnDef::new(M::PrevConfigId).string_len(63).null())
        .col(big(M::PrevVersion))
        .col(ColumnDef::new(M::State).string_len(16).not_null())
        .col(big_not_null(M::AssignedRev))
        .col(big(M::HeartbeatBase))
        .primary_key(Index::create().col(M::RolloutId).col(M::CollectorId))
        .to_owned()
}

fn indexes() -> Vec<IndexCreateStatement> {
    let index = |name: &str| Index::create().if_not_exists().name(name).to_owned();
    vec![
        index("idx_fleet_collectors_org_last_seen")
            .table(FleetCollectors::Table)
            .col(FleetCollectors::OrgId)
            .col(FleetCollectors::LastSeenAt)
            .to_owned(),
        index("idx_fleet_collectors_org_version")
            .table(FleetCollectors::Table)
            .col(FleetCollectors::OrgId)
            .col(FleetCollectors::Version)
            .to_owned(),
        index("idx_fleet_collectors_org_config")
            .table(FleetCollectors::Table)
            .col(FleetCollectors::OrgId)
            .col(FleetCollectors::ConfigId)
            .to_owned(),
        index("idx_fleet_collectors_org_rollout")
            .table(FleetCollectors::Table)
            .col(FleetCollectors::OrgId)
            .col(FleetCollectors::ActiveRolloutId)
            .to_owned(),
        index("idx_fleet_collectors_org_fleet")
            .table(FleetCollectors::Table)
            .col(FleetCollectors::OrgId)
            .col(FleetCollectors::FleetId)
            .to_owned(),
        index("fleet_tokens_org_name_uq")
            .table(FleetTokens::Table)
            .unique()
            .col(FleetTokens::OrgId)
            .col(FleetTokens::Name)
            .to_owned(),
        index("fleet_tokens_hash_uq")
            .table(FleetTokens::Table)
            .unique()
            .col(FleetTokens::TokenHash)
            .to_owned(),
        index("idx_fleet_rollouts_org_started")
            .table(FleetRollouts::Table)
            .col(FleetRollouts::OrgId)
            .col(FleetRollouts::StartedAt)
            .to_owned(),
        index("idx_fleet_rollouts_org_config")
            .table(FleetRollouts::Table)
            .col(FleetRollouts::OrgId)
            .col(FleetRollouts::ConfigId)
            .to_owned(),
        index("idx_fleet_rollouts_org_fleet")
            .table(FleetRollouts::Table)
            .col(FleetRollouts::OrgId)
            .col(FleetRollouts::FleetId)
            .to_owned(),
        index("idx_fleet_rollout_members_org")
            .table(FleetRolloutMembers::Table)
            .col(FleetRolloutMembers::OrgId)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::MigrationName;

    use super::*;

    const TABLES: [&str; 8] = [
        "fleet_collectors",
        "fleet_tokens",
        "fleet_configs",
        "fleet_config_versions",
        "fleet_settings",
        "fleets",
        "fleet_rollouts",
        "fleet_rollout_members",
    ];
    const COLUMNS: [(&str, &str); 14] = [
        ("fleet_collectors", "fleet_id"),
        ("fleet_collectors", "heartbeats"),
        ("fleet_collectors", "assignment_rev"),
        ("fleet_collectors", "effective_config_version"),
        ("fleet_tokens", "fleet_id"),
        ("fleet_tokens", "token"),
        ("fleet_configs", "live_version"),
        ("fleets", "stable_config_id"),
        ("fleets", "stable_config_version"),
        ("fleets", "config_version"),
        ("fleet_rollouts", "fleet_id"),
        ("fleet_rollouts", "auto_rollback"),
        ("fleet_rollouts", "gates"),
        ("fleet_rollout_members", "heartbeat_base"),
    ];
    const GONE: [(&str, &str); 5] = [
        ("fleet_collectors", "labels"),
        ("fleet_tokens", "labels"),
        ("fleet_rollouts", "target_kind"),
        ("fleet_rollout_members", "rollback_rev"),
        ("fleet_rollout_members", "rolled_back_at"),
    ];

    async fn one(db: &DatabaseConnection, sql: &str) -> sea_orm::QueryResult {
        db.query_one(Statement::from_string(db.get_database_backend(), sql))
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn up_twice_creates_the_slice_4_schema() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        for table in TABLES {
            assert!(manager.has_table(table).await.unwrap(), "{table}");
        }
        for (table, column) in COLUMNS {
            assert!(
                manager.has_column(table, column).await.unwrap(),
                "{table}.{column}"
            );
        }
        for (table, column) in GONE {
            assert!(
                !manager.has_column(table, column).await.unwrap(),
                "{table}.{column}"
            );
        }
        for (table, index) in [
            ("fleet_collectors", "idx_fleet_collectors_org_fleet"),
            ("fleet_rollouts", "idx_fleet_rollouts_org_fleet"),
            ("fleet_tokens", "fleet_tokens_org_name_uq"),
        ] {
            assert!(manager.has_index(table, index).await.unwrap(), "{index}");
        }

        db.execute_unprepared(
            "INSERT INTO fleet_collectors (org_id, id, enrolled_at, last_seen_at) \
             VALUES ('o1', 'a', 1, 1)",
        )
        .await
        .unwrap();
        let row = one(
            &db,
            "SELECT fleet_id, assignment_rev, heartbeats FROM fleet_collectors",
        )
        .await;
        assert_eq!(row.try_get::<String>("", "fleet_id").unwrap(), "default");
        assert_eq!(row.try_get::<i64>("", "assignment_rev").unwrap(), 0);
        assert_eq!(row.try_get::<i64>("", "heartbeats").unwrap(), 0);
        db.execute_unprepared(
            "INSERT INTO fleet_tokens (id, org_id, name, prefix, token_hash, scope, created_at, \
             created_by) VALUES ('t', 'o1', 'n', 'o2ft_abcd', 'h', 'fleet_agent', 1, 'u')",
        )
        .await
        .unwrap();
        let token = one(&db, "SELECT fleet_id FROM fleet_tokens").await;
        assert_eq!(token.try_get::<String>("", "fleet_id").unwrap(), "default");
        db.execute_unprepared(
            "INSERT INTO fleet_rollouts (id, org_id, config_id, to_version, fleet_id, strategy, \
             status, phases, events, started_at, started_by) VALUES ('r', 'o1', 'edge', 1, 'f', \
             'immediate', 'in_progress', '[]', '[]', 1, 'u')",
        )
        .await
        .unwrap();
        let rollout = one(&db, "SELECT auto_rollback, rev FROM fleet_rollouts").await;
        assert!(!rollout.try_get::<bool>("", "auto_rollback").unwrap());
        db.execute_unprepared(
            "INSERT INTO fleets (org_id, fleet_id, updated_at, updated_by) \
             VALUES ('o1', 'f', 1, 'u')",
        )
        .await
        .unwrap();
        assert!(
            db.execute_unprepared(
                "INSERT INTO fleets (org_id, fleet_id, updated_at, updated_by) \
                 VALUES ('o1', 'f', 2, 'u')",
            )
            .await
            .is_err(),
            "one row per fleet"
        );
    }

    #[tokio::test]
    async fn down_twice_drops_every_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        for table in TABLES {
            assert!(!manager.has_table(table).await.unwrap(), "{table}");
        }
        Migration.down(&manager).await.expect("second run");
    }

    #[test]
    fn migration_name() {
        assert_eq!(Migration.name(), "m20261005_000001_create_fleet");
    }
}
