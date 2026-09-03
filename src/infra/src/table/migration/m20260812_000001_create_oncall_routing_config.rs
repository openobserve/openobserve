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

//! The org's routing configuration, and the flag that tells a defaulted signal
//! from an unowned one.
//!
//! Two changes because they are one feature. `oncall_routing_config` holds the
//! team an operator nominated as the catch-all — architecture/01 §8 — and
//! `oncall_unrouted_signals.defaulted_team_id` records, on the queue row that
//! already exists for the gap, that the gap paged that team rather than paging
//! nobody. §4 says the one thing worth surfacing is *"namespaces that paged you
//! and landed on the default team"*, and without the column the queue cannot
//! distinguish the two outcomes it is now recording.
//!
//! `default_team_id` is nullable and there is no seed row. Nothing creates a
//! default team; a fresh org has none until somebody picks one, and until then
//! an unclaimed signal goes on the queue exactly as it did before.
//!
//! §8 also lists a `dimensions` column on this table. It is deliberately not
//! here: the identity dimensions are already owned by Correlation Settings'
//! `distinguish_by`, and a second copy of them would be a second answer to the
//! same question with nothing keeping the two honest.

use sea_orm_migration::prelude::*;

const UNROUTED: &str = "oncall_unrouted_signals";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallRoutingConfig::Table)
                    .if_not_exists()
                    // The org IS the key: there is exactly one routing
                    // configuration per org, so a surrogate id would only
                    // create the possibility of two.
                    .col(
                        ColumnDef::new(OncallRoutingConfig::OrgId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallRoutingConfig::DefaultTeamId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallRoutingConfig::UpdatedAt)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        // Guarded rather than blind: this migration must be re-runnable, and on
        // a database that already went round once the column is there.
        if !manager.has_column(UNROUTED, "defaulted_team_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(OncallUnroutedSignals::Table)
                        .add_column(
                            ColumnDef::new(OncallUnroutedSignals::DefaultedTeamId)
                                .string()
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OncallRoutingConfig::Table).to_owned())
            .await?;
        if manager.has_column(UNROUTED, "defaulted_team_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(OncallUnroutedSignals::Table)
                        .drop_column(OncallUnroutedSignals::DefaultedTeamId)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum OncallRoutingConfig {
    Table,
    OrgId,
    DefaultTeamId,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum OncallUnroutedSignals {
    Table,
    DefaultedTeamId,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    /// Column names of `table`, ordered, as SQLite reports them.
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

    /// The on-call schema as the previous release left it — what a database
    /// upgrading into this migration actually holds.
    ///
    /// `m20260807_000001_create_oncall_ownership` is left out deliberately: the
    /// only part of it this migration could care about is a column it adds to
    /// `alerts`, which would mean standing up the whole alerts schema to test a
    /// table that has nothing to do with it.
    async fn migrate_to_previous_release(manager: &SchemaManager<'_>) {
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(manager)
            .await
            .unwrap();
        super::super::m20260811_000001_create_oncall_unrouted_signals::Migration
            .up(manager)
            .await
            .unwrap();
    }

    /// The case a fresh-install test cannot see: an existing deployment already
    /// has an `oncall_unrouted_signals` full of rows, and has to gain the column
    /// without losing them.
    #[tokio::test]
    async fn test_up_upgrades_an_existing_database() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        migrate_to_previous_release(&manager).await;

        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_unrouted_signals \
             (id, org_id, path, dimensions, occurrences, first_seen_at, last_seen_at) \
             VALUES ('u1', 'default', 'k8s-cluster=prod', '{}', 7, 1, 2)"
                .to_owned(),
        ))
        .await
        .unwrap();

        assert!(!manager.has_table("oncall_routing_config").await.unwrap());
        assert!(
            !manager
                .has_column(UNROUTED, "defaulted_team_id")
                .await
                .unwrap()
        );

        Migration.up(&manager).await.expect("upgrade must apply");

        assert!(manager.has_table("oncall_routing_config").await.unwrap());
        assert!(
            manager
                .has_column(UNROUTED, "defaulted_team_id")
                .await
                .unwrap()
        );

        // The existing row survives, and reads as "paged nobody" — which is
        // exactly what it meant before the column existed.
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "SELECT occurrences, defaulted_team_id FROM oncall_unrouted_signals WHERE id='u1'"
                    .to_owned(),
            ))
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].try_get::<i64>("", "occurrences").unwrap(), 7);
        assert_eq!(
            rows[0]
                .try_get::<Option<String>>("", "defaulted_team_id")
                .unwrap(),
            None
        );

        // No org starts with a default team. If this ever seeds a row, some org
        // begins paging a team nobody nominated.
        let configs = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "SELECT org_id FROM oncall_routing_config".to_owned(),
            ))
            .await
            .unwrap();
        assert!(configs.is_empty());
    }

    /// The migrator may run this twice — a retried startup, a re-registered
    /// migration — and neither the `if_not_exists` table nor the guarded
    /// `ALTER` may fail the second time.
    #[tokio::test]
    async fn test_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        migrate_to_previous_release(&manager).await;
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(
            manager
                .has_column(UNROUTED, "defaulted_team_id")
                .await
                .unwrap()
        );
    }

    /// An upgraded database and a fresh one must end in the same schema, or
    /// only one of the two install paths is being tested anywhere.
    #[tokio::test]
    async fn test_upgraded_schema_matches_fresh_schema() {
        let fresh = Database::connect("sqlite::memory:").await.unwrap();
        let fresh_mgr = SchemaManager::new(&fresh);
        migrate_to_previous_release(&fresh_mgr).await;
        Migration.up(&fresh_mgr).await.unwrap();

        let upgraded = Database::connect("sqlite::memory:").await.unwrap();
        let upgraded_mgr = SchemaManager::new(&upgraded);
        migrate_to_previous_release(&upgraded_mgr).await;
        // The upgrade path is this migration arriving on a database that has
        // already been serving traffic; the extra round is the retry.
        Migration.up(&upgraded_mgr).await.unwrap();
        Migration.up(&upgraded_mgr).await.unwrap();

        for table in ["oncall_routing_config", UNROUTED] {
            assert_eq!(
                columns(&fresh, table).await,
                columns(&upgraded, table).await,
                "{table} differs between a fresh install and an upgrade"
            );
        }
    }

    #[tokio::test]
    async fn test_down_removes_both_changes() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        migrate_to_previous_release(&manager).await;
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("oncall_routing_config").await.unwrap());
        assert!(
            !manager
                .has_column(UNROUTED, "defaulted_team_id")
                .await
                .unwrap()
        );
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260812_000001_create_oncall_routing_config"
        );
    }
}
