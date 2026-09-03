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

//! Schedule overrides — "cover for me".
//!
//! `architecture/02` §5. A named person takes a bounded slice of whoever the
//! rotation would otherwise resolve to. Its own table rather than a column on
//! `oncall_schedules` because an override has its own lifecycle: it is created
//! by one person at 2am, it expires on its own, and it is deleted without
//! touching the rotation it stood over.
//!
//! Keyed by team rather than by schedule and level, which is what §3's sketch
//! says: this codebase dropped per-level rotations — a team has one schedule,
//! and "who is on call" is one question — so `(org_id, team_id)` is the whole
//! of the scoping and matches every other on-call read path.
//!
//! Written as a new migration rather than as an edit to
//! `m20260806_000001_create_oncall_tables`, whatever the unreleased-feature
//! convention says. Editing a create migration in place is what
//! `m20260811_000002_repair_oncall_schema_drift` exists to undo: SeaORM records
//! a migration as applied by name, so an edited body never re-runs and every
//! database that already ran it is left without the new table.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallOverrides::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallOverrides::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(OncallOverrides::OrgId).string().not_null())
                    .col(ColumnDef::new(OncallOverrides::TeamId).string().not_null())
                    // Which rotation the cover stands over. NOT NULL: a cover
                    // is "stand in for this position", and a position is a
                    // rotation. It was a nullable `slot` string, where NULL
                    // meant the default one — which let a cover claim a
                    // position nothing staffed, the same mistake the derived
                    // secondary made in a different place.
                    .col(
                        ColumnDef::new(OncallOverrides::RotationId)
                            .string()
                            .not_null(),
                    )
                    // The covering user: who actually holds the pager.
                    .col(
                        ColumnDef::new(OncallOverrides::UserEmail)
                            .string()
                            .not_null(),
                    )
                    // Who is being covered. Nullable: "cover tonight" is a real
                    // request even when nobody has worked out whose shift
                    // tonight is, and demanding the answer would turn a
                    // ten-second interaction into a lookup.
                    .col(ColumnDef::new(OncallOverrides::CoveringFor).string().null())
                    .col(
                        ColumnDef::new(OncallOverrides::StartAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOverrides::EndAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOverrides::Reason)
                            .custom(Alias::new(get_text_type()))
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallOverrides::CreatedBy)
                            .string()
                            .not_null(),
                    )
                    // Not decoration: `created_at` IS the overlap rule (§5,
                    // "latest created_at wins"), so it is NOT NULL and every
                    // write stamps it.
                    .col(
                        ColumnDef::new(OncallOverrides::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // The one query on the paging path: every override for a team that
        // could still be in force. Ordered by `end_at` because the filter is
        // "has not finished yet", which is what bounds the read.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallOverrides::Table)
                    .name("idx_oncall_overrides_org_team_end")
                    .col(OncallOverrides::OrgId)
                    .col(OncallOverrides::TeamId)
                    .col(OncallOverrides::EndAt)
                    .to_owned(),
            )
            .await?;

        // Listing a window, and the deletes that follow a person leaving.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallOverrides::Table)
                    .name("idx_oncall_overrides_org_team_start")
                    .col(OncallOverrides::OrgId)
                    .col(OncallOverrides::TeamId)
                    .col(OncallOverrides::StartAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OncallOverrides::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum OncallOverrides {
    Table,
    Id,
    OrgId,
    TeamId,
    RotationId,
    UserEmail,
    CoveringFor,
    StartAt,
    EndAt,
    Reason,
    CreatedBy,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    const TABLE: &str = "oncall_overrides";

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

    #[tokio::test]
    async fn test_up_creates_the_table_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        // `if_not_exists` throughout, because a node that crashed between the
        // table and its indexes has to be able to finish the job on restart.
        Migration.up(&manager).await.expect("second run");

        assert!(manager.has_table(TABLE).await.unwrap());
        assert_eq!(
            columns(&db, TABLE).await,
            vec![
                "covering_for",
                "created_at",
                "created_by",
                "end_at",
                "id",
                "org_id",
                "reason",
                "rotation_id",
                "start_at",
                "team_id",
                "user_email",
            ]
        );
        assert!(
            manager
                .has_index(TABLE, "idx_oncall_overrides_org_team_end")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index(TABLE, "idx_oncall_overrides_org_team_start")
                .await
                .unwrap()
        );
    }

    /// The mistake that cost two P0s on this feature: testing only a fresh
    /// install. A database that already ran every earlier on-call migration is
    /// the one real upgrades take, and this migration has to add the table
    /// there too — the migrator's version check is what decides whether it
    /// runs at all, and a table that silently never appears is every on-call
    /// query failing with "no such table" on the next release.
    #[tokio::test]
    async fn test_an_upgraded_database_gains_the_table_too() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        // `m20260807` hangs a column off `alerts`, which is created far
        // earlier in the chain than anything on-call. Stubbing it keeps this
        // test about the on-call migrations without replaying sixty others.
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY)".to_owned(),
        ))
        .await
        .unwrap();
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260807_000001_create_oncall_ownership::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260811_000001_create_oncall_unrouted_signals::Migration
            .up(&manager)
            .await
            .unwrap();
        assert!(
            !manager.has_table(TABLE).await.unwrap(),
            "precondition: the upgraded database has no overrides table yet"
        );

        Migration
            .up(&manager)
            .await
            .expect("the upgrade must apply");
        assert!(manager.has_table(TABLE).await.unwrap());

        // And it is actually writable, which is the thing the schema check
        // above cannot prove on its own.
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_overrides \
             (id, org_id, team_id, rotation_id, user_email, start_at, end_at, created_by, \
              created_at) \
             VALUES ('ov_1', 'default', 'team_1', 'rot_1', 'sam@o2.ai', 1, 2, 'ana@o2.ai', 1)"
                .to_owned(),
        ))
        .await
        .expect("an override must be insertable after the upgrade");
    }

    /// An upgraded database and a fresh one must end in the same schema, or
    /// only one of the two install paths is being tested anywhere.
    #[tokio::test]
    async fn test_upgraded_schema_matches_fresh_schema() {
        let fresh = Database::connect("sqlite::memory:").await.unwrap();
        Migration.up(&SchemaManager::new(&fresh)).await.unwrap();

        let upgraded = Database::connect("sqlite::memory:").await.unwrap();
        let mgr = SchemaManager::new(&upgraded);
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(&mgr)
            .await
            .unwrap();
        Migration.up(&mgr).await.unwrap();

        assert_eq!(
            columns(&fresh, TABLE).await,
            columns(&upgraded, TABLE).await
        );
    }

    #[tokio::test]
    async fn test_down_drops_the_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table(TABLE).await.unwrap());
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(Migration.name(), "m20260812_000002_create_oncall_overrides");
    }
}
