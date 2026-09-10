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

//! Ownership rules, and the alert-level routing override.

use sea_orm_migration::prelude::*;

use super::get_text_type;

const ALERTS: &str = "alerts";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallOwnershipRules::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallOwnershipRules::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::TeamId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::Path)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::Dimensions)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallOwnershipRules::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // One claim per path per org. Two teams claiming the same path is a
        // configuration mistake the resolver has to break a tie over; refusing
        // it at write time is cheaper than explaining the tie afterwards.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallOwnershipRules::Table)
                    .name("idx_oncall_ownership_org_path")
                    .col(OncallOwnershipRules::OrgId)
                    .col(OncallOwnershipRules::Path)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Every rule for an org is loaded together on the routing path.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallOwnershipRules::Table)
                    .name("idx_oncall_ownership_org")
                    .col(OncallOwnershipRules::OrgId)
                    .to_owned(),
            )
            .await?;

        // Nullable: most alerts route by ownership, and a null here means
        // "discover it" rather than "no team".
        // Guarded rather than blind: SQLite has no `IF NOT EXISTS` for `ADD
        // COLUMN`, so a re-run would die on the duplicate.
        if !manager.has_column(ALERTS, "oncall_team").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .add_column(ColumnDef::new(Alerts::OncallTeam).string().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(ALERTS, "oncall_team").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .drop_column(Alerts::OncallTeam)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(OncallOwnershipRules::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallOwnershipRules {
    Table,
    Id,
    OrgId,
    TeamId,
    Path,
    Dimensions,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    OncallTeam,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::MigrationTrait;

    use super::*;

    /// A stand-in for the table this migration only ALTERs, so the test does
    /// not have to replay sixty unrelated migrations to reach it.
    async fn stub_alerts(db: &DatabaseConnection) {
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY)".to_owned(),
        ))
        .await
        .unwrap();
    }

    /// A node that died between the CREATE and the ALTER has to be able to
    /// finish the job on restart, so every step is guarded.
    #[tokio::test]
    async fn test_up_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        stub_alerts(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");

        assert!(manager.has_table("oncall_ownership_rules").await.unwrap());
        assert!(manager.has_column(ALERTS, "oncall_team").await.unwrap());
    }

    /// The rollback has to survive a schema where `up` only got halfway, which
    /// is the state the crash it is cleaning up after left behind.
    #[tokio::test]
    async fn test_down_tolerates_a_partially_applied_schema() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        stub_alerts(&db).await;
        let manager = SchemaManager::new(&db);

        Migration
            .down(&manager)
            .await
            .expect("nothing applied yet is still a valid rollback");

        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.expect("full rollback");
        Migration.down(&manager).await.expect("repeated rollback");

        assert!(!manager.has_table("oncall_ownership_rules").await.unwrap());
        assert!(!manager.has_column(ALERTS, "oncall_team").await.unwrap());
    }
}
