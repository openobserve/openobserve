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

//! A new migration, not an edit: SeaORM records one as applied by name, so edits never re-run.

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
                    // NOT NULL: a nullable rotation lets a cover claim a position nothing staffed.
                    .col(
                        ColumnDef::new(OncallOverrides::RotationId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOverrides::UserEmail)
                            .string()
                            .not_null(),
                    )
                    // Nullable: "cover tonight" is real even before whose shift it is.
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
                    // `created_at` IS the overlap rule, so it is NOT NULL on every write.
                    .col(
                        ColumnDef::new(OncallOverrides::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Ordered by `end_at`: the paging filter is "has not finished yet", which bounds it.
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
            .drop_table(
                Table::drop()
                    .table(OncallOverrides::Table)
                    .if_exists()
                    .to_owned(),
            )
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
        // `if_not_exists` throughout: a crash between table and indexes must finish on restart.
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

    /// Testing only fresh installs cost two P0s: a table missing on upgrade is "no such table".
    #[tokio::test]
    async fn test_an_upgraded_database_gains_the_table_too() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        // `m20260807` hangs a column off `alerts`; stubbing it avoids replaying sixty others.
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

        // And it is actually writable, which the schema check above cannot prove on its own.
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

    /// Upgrade and fresh install must end in the same schema, or only one path is tested.
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
