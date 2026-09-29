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

        // One claim per path: refusing at write time beats making the resolver break a tie.
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

        // Guarded: SQLite has no `IF NOT EXISTS` for `ADD COLUMN`, so a re-run dies on it.
        if !manager.has_column(ALERTS, "oncall_team").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        // Null means "discover the team from the ownership rules", never "no team".
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

    /// A stand-in for the ALTERed table, so the test need not replay sixty migrations.
    async fn stub_alerts(db: &DatabaseConnection) {
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY)".to_owned(),
        ))
        .await
        .unwrap();
    }

    /// A node that died between the CREATE and the ALTER must finish on restart.
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

    /// The rollback has to survive a schema where `up` only got halfway.
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
