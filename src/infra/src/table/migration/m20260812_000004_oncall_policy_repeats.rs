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

//! `oncall_policies.repeat_count` and `oncall_policies.final_action`
//! (04-escalation-engine §3).
//!
//! A ladder that ran out used to write one event and drop the job. §3 lets a
//! policy say how many times the ladder runs and what happens at the end, and
//! both of those are per-team configuration, so they are columns on the policy
//! rather than another JSON blob inside `rungs`: they are the two fields the
//! edit screen exposes, and a screen cannot bind to a field it has to parse out
//! of somebody else's document.
//!
//! An **alter**, not an edit to `m20260806_000001_create_oncall_tables`. That
//! migration has been applied to databases that exist; SeaORM records a
//! migration as applied by name and never re-runs an edited body, so an
//! in-place addition would leave every one of them without the columns while
//! the entity selects them — which is the exact failure
//! `m20260811_000002_repair_oncall_schema_drift` exists to undo.
//!
//! The defaults are the point: `1` and `'stop'` are what the engine has always
//! done, so a policy that comes through the upgrade escalates precisely as it
//! did the day before.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

const POLICIES: &str = "oncall_policies";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement: SQLite does not support several in a
        // single ALTER TABLE and sea-query panics rather than erroring, which
        // would take the node down mid-upgrade.
        add_column(
            manager,
            POLICIES,
            OncallPolicies::RepeatCount,
            ColumnDef::new(OncallPolicies::RepeatCount)
                .integer()
                .not_null()
                .default(1),
        )
        .await?;
        add_column(
            manager,
            POLICIES,
            OncallPolicies::FinalAction,
            ColumnDef::new(OncallPolicies::FinalAction)
                .custom(Alias::new(get_text_type()))
                .not_null()
                .default("stop"),
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        drop_column_if_exists(manager, POLICIES, OncallPolicies::FinalAction, "final_action")
            .await?;
        drop_column_if_exists(manager, POLICIES, OncallPolicies::RepeatCount, "repeat_count").await
    }
}

/// Add one column, skipping it if the table already has it.
///
/// The explicit `has_column` guard rather than `add_column_if_not_exists`: the
/// latter is not idempotent on SQLite, which has no `IF NOT EXISTS` for `ADD
/// COLUMN` and errors with "duplicate column name".
async fn add_column<C>(
    manager: &SchemaManager<'_>,
    table: &str,
    column: C,
    def: &mut ColumnDef,
) -> Result<(), DbErr>
where
    C: IntoIden,
{
    let name = column.into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(def)
                .to_owned(),
        )
        .await
}

async fn drop_column_if_exists<C>(
    manager: &SchemaManager<'_>,
    table: &str,
    column: C,
    name: &str,
) -> Result<(), DbErr>
where
    C: IntoIden,
{
    if !manager.has_column(table, name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .drop_column(column)
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden)]
enum OncallPolicies {
    RepeatCount,
    FinalAction,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::MigrationTrait;

    use super::*;

    /// `oncall_policies` as an already-upgraded database holds it — i.e. after
    /// `m20260811_000002` — which is the shape this migration has to alter.
    async fn existing_policies_table(db: &DatabaseConnection) {
        db.execute(Statement::from_string(
            db.get_database_backend(),
            "CREATE TABLE oncall_policies (id TEXT NOT NULL PRIMARY KEY, org_id TEXT NOT NULL, \
             team_id TEXT NOT NULL UNIQUE, rungs text NOT NULL DEFAULT '[]', \
             destinations text NOT NULL DEFAULT '[]', l0_json text NOT NULL DEFAULT '{}', \
             created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)"
                .to_string(),
        ))
        .await
        .unwrap();
    }

    async fn columns(db: &DatabaseConnection) -> Vec<String> {
        db.query_all(Statement::from_string(
            db.get_database_backend(),
            "SELECT name FROM pragma_table_info('oncall_policies')".to_string(),
        ))
        .await
        .unwrap()
        .iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect()
    }

    /// The upgrade path, which is the one a fresh-install test cannot see at
    /// all: a database that already ran every on-call migration must come out
    /// of this one holding both columns.
    #[tokio::test]
    async fn test_an_existing_database_gains_both_columns() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        existing_policies_table(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        let cols = columns(&db).await;
        assert!(cols.contains(&"repeat_count".to_string()), "{cols:?}");
        assert!(cols.contains(&"final_action".to_string()), "{cols:?}");
    }

    /// Re-running it must be a no-op: a redelivered migration, or a database
    /// stopped part-way through, has to converge rather than error.
    #[tokio::test]
    async fn test_running_it_twice_changes_nothing() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        existing_policies_table(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.unwrap();
        let first = columns(&db).await;
        Migration.up(&manager).await.unwrap();
        assert_eq!(columns(&db).await, first);
    }

    /// The defaults are what make the upgrade invisible: a policy written
    /// before these columns existed has to escalate exactly as it did — one
    /// pass, then say nobody answered.
    #[tokio::test]
    async fn test_a_policy_from_before_the_upgrade_keeps_todays_behaviour() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        existing_policies_table(&db).await;
        db.execute(Statement::from_string(
            db.get_database_backend(),
            "INSERT INTO oncall_policies (id, org_id, team_id, rungs, destinations, l0_json, \
             created_at, updated_at) VALUES ('p1', 'default', 't1', '[]', '[]', '{}', 1, 1)"
                .to_string(),
        ))
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT repeat_count, final_action FROM oncall_policies WHERE id = 'p1'"
                    .to_string(),
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "repeat_count").unwrap(), 1);
        assert_eq!(
            row.try_get::<String>("", "final_action").unwrap(),
            config::meta::oncall::FinalAction::Stop.as_str()
        );
    }
}
