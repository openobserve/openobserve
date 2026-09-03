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

//! `oncall_unavailability` — "Ana is away 20 Aug – 3 Sep".
//!
//! Until this table existed the only way to say it was one override per
//! affected shift, written by whoever happened to notice, and the failure mode
//! was a page landing on somebody on a beach.
//!
//! **Keyed on `(org_id, user_email)`, deliberately not on a team.** Being away
//! is a fact about a person: somebody on two teams is away from both, and a
//! per-team row means writing the same window twice and forgetting the second
//! one — which is the very failure this prevents. It is also who enters it: the
//! person going away, once, rather than each of their team leads.
//!
//! Its own table rather than a column anywhere, because an absence has its own
//! lifecycle. It is created weeks ahead, it expires on its own, and it is
//! deleted without touching any schedule it happened to affect.

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
                    .table(OncallUnavailability::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallUnavailability::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallUnavailability::OrgId)
                            .string()
                            .not_null(),
                    )
                    // No team column, and that is the design rather than an
                    // omission — see the module comment.
                    .col(
                        ColumnDef::new(OncallUnavailability::UserEmail)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnavailability::StartAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnavailability::EndAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnavailability::Reason)
                            .custom(Alias::new(get_text_type()))
                            .null(),
                    )
                    // Who recorded it, which is not always whose absence it is:
                    // a team lead entering somebody's leave is a real workflow
                    // and the record has to say which of the two happened.
                    .col(
                        ColumnDef::new(OncallUnavailability::CreatedBy)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUnavailability::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // The query on the paging path: every absence in the org that could
        // still be in force. Filtered on `end_at`, which is what bounds the
        // read, and the resolver narrows to the schedule's members in memory —
        // a rotation has single digits of people on it.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallUnavailability::Table)
                    .name("idx_oncall_unavailability_org_end")
                    .col(OncallUnavailability::OrgId)
                    .col(OncallUnavailability::EndAt)
                    .to_owned(),
            )
            .await?;

        // One person's own windows: the personal view, and the deletes that
        // follow somebody leaving the org.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallUnavailability::Table)
                    .name("idx_oncall_unavailability_org_user_start")
                    .col(OncallUnavailability::OrgId)
                    .col(OncallUnavailability::UserEmail)
                    .col(OncallUnavailability::StartAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(OncallUnavailability::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallUnavailability {
    Table,
    Id,
    OrgId,
    UserEmail,
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

    const TABLE: &str = "oncall_unavailability";

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
                "created_at",
                "created_by",
                "end_at",
                "id",
                "org_id",
                "reason",
                "start_at",
                "user_email",
            ]
        );
        assert!(
            manager
                .has_index(TABLE, "idx_oncall_unavailability_org_end")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index(TABLE, "idx_oncall_unavailability_org_user_start")
                .await
                .unwrap()
        );
    }

    /// The mistake that cost this feature two P0s: testing only a fresh
    /// install. A database that already ran every earlier on-call migration is
    /// the one real upgrades take, and this migration has to add the table
    /// there too — a table that silently never appears is every unavailability
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
        super::super::m20260812_000001_create_oncall_routing_config::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260812_000002_create_oncall_overrides::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260812_000003_create_oncall_contacts_and_reads::Migration
            .up(&manager)
            .await
            .unwrap();
        assert!(
            !manager.has_table(TABLE).await.unwrap(),
            "precondition: the upgraded database has no unavailability table yet"
        );

        Migration
            .up(&manager)
            .await
            .expect("the upgrade must apply");
        assert!(manager.has_table(TABLE).await.unwrap());

        // And it is actually writable, which the schema check above cannot
        // prove on its own.
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_unavailability \
             (id, org_id, user_email, start_at, end_at, created_by, created_at) \
             VALUES ('un_1', 'default', 'ana@o2.ai', 1, 2, 'ana@o2.ai', 1)"
                .to_owned(),
        ))
        .await
        .expect("an absence must be insertable after the upgrade");

        // A cover names the rotation it stands over, folded into the create
        // migration because on-call is unreleased. An upgraded database has to
        // hold it too, or half of this work is inert.
        //
        // It was a nullable `slot` string until 2026-08-20, where NULL meant
        // "the default one" — which let a cover claim a position nothing
        // staffed. NOT NULL now, because a cover over no rotation stands over
        // nothing.
        let override_columns = columns(&db, "oncall_overrides").await;
        assert!(
            override_columns.contains(&"rotation_id".to_string()),
            "{override_columns:?}"
        );
        assert!(
            !override_columns.contains(&"slot".to_string()),
            "the slot column must be gone, not merely unused: {override_columns:?}"
        );
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
        // And dropping a table that is not there converges rather than errors.
        Migration.down(&manager).await.unwrap();
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260813_000001_create_oncall_unavailability"
        );
    }
}
