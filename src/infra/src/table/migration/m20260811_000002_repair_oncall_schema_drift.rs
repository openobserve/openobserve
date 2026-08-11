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

//! Repair the on-call schema on databases that ran an early
//! `m20260806_000001_create_oncall_tables`.
//!
//! While on-call was unreleased the team's convention was to edit that create
//! migration in place rather than append an alter. That is safe only for a
//! database that has never run it. It was applied to databases that had, and
//! SeaORM records a migration as applied by name: an edited body never
//! re-runs. Every column added to the file after it first landed
//! (`2039cdea64`) is therefore missing on those databases, while the entity
//! definitions select all of them — so every on-call query fails with "no such
//! column", the scheduler's escalation handler fails on every tick and the
//! `oncall_maintenance` reconcile job fails every minute.
//!
//! This migration owns the repair. It is written against the *entity*
//! definitions rather than against any one edit, and every step is guarded by
//! `has_column` / `has_index`, so it is a no-op on a fresh database (where
//! `m20260806` already created the columns) and converges any database stopped
//! anywhere in that chain of edits onto exactly the same schema.
//!
//! What drifted, and why each one matters:
//!
//! `oncall_responses` — `title`, `cause`, `cause_note`, `ladder_anchor`,
//! `ladder_run`, `responder_role`, `origin_response_id`, `snoozed_until`.
//! `ladder_run` is the one that breaks the read path outright: it is selected
//! by every response query. NULL means the first run of the escalation ladder
//! (`FIRST_LADDER_RUN`), which is exactly what a row written before the column
//! existed was, so no backfill is needed or wanted.
//!
//! `oncall_response_events` — `rung_micros`, `ladder_run`, `recipient`,
//! `channel`, `delivered`. `rung_micros` replaced the original `level`:
//! a rung is now identified by its delay from the record opening, not by an
//! index, so the old values cannot be reinterpreted as the new column and are
//! dropped with it.
//!
//! `oncall_policies` — `destinations`. NOT NULL DEFAULT '[]', so existing
//! policies come out of the upgrade with no destinations rather than NULL,
//! which is what "nobody configured any yet" means.
//!
//! `oncall_team_members` — the reverse: `level` was *removed* in place
//! (`047f0820d0`), and which rung somebody covers moved to
//! `oncall_schedules.rotations`. On a drifted database the column survives as
//! NOT NULL with no default, so every membership insert from current code
//! fails. It must go, and its unique index goes with it: the key narrowed from
//! (team_id, user_email, level) to (team_id, user_email). The index is dropped
//! before the column because SQLite refuses to drop an indexed column.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

const RESPONSES: &str = "oncall_responses";
const RESPONSE_EVENTS: &str = "oncall_response_events";
const POLICIES: &str = "oncall_policies";
const TEAM_MEMBERS: &str = "oncall_team_members";

/// The pre-`047f0820d0` unique key, which included the rung.
const TEAM_MEMBERS_IDX_OLD: &str = "idx_oncall_team_members_team_user_level";
/// The key membership actually has: one row per person per team.
const TEAM_MEMBERS_IDX_NEW: &str = "idx_oncall_team_members_team_user";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // One alter option per statement throughout: SQLite does not support
        // several operations in a single ALTER TABLE and sea-query panics
        // rather than erroring, which would take the node down mid-upgrade.

        // -- oncall_responses ------------------------------------------------
        add_column(
            manager,
            RESPONSES,
            OncallResponses::Title,
            ColumnDef::new(OncallResponses::Title).string().null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSES,
            OncallResponses::Cause,
            ColumnDef::new(OncallResponses::Cause).string().null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSES,
            OncallResponses::CauseNote,
            ColumnDef::new(OncallResponses::CauseNote).string().null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSES,
            OncallResponses::SnoozedUntil,
            ColumnDef::new(OncallResponses::SnoozedUntil)
                .big_integer()
                .null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSES,
            OncallResponses::LadderAnchor,
            ColumnDef::new(OncallResponses::LadderAnchor)
                .big_integer()
                .null(),
        )
        .await?;
        // Null means the first run, so rows written before the column existed
        // read back correctly without a backfill.
        add_column(
            manager,
            RESPONSES,
            OncallResponses::LadderRun,
            ColumnDef::new(OncallResponses::LadderRun).integer().null(),
        )
        .await?;
        // NOT NULL with a default: every pre-existing record was an owner
        // record, which is role 1.
        add_column(
            manager,
            RESPONSES,
            OncallResponses::ResponderRole,
            ColumnDef::new(OncallResponses::ResponderRole)
                .integer()
                .not_null()
                .default(1),
        )
        .await?;
        add_column(
            manager,
            RESPONSES,
            OncallResponses::OriginResponseId,
            ColumnDef::new(OncallResponses::OriginResponseId)
                .string()
                .null(),
        )
        .await?;

        // -- oncall_response_events ------------------------------------------
        add_column(
            manager,
            RESPONSE_EVENTS,
            OncallResponseEvents::RungMicros,
            ColumnDef::new(OncallResponseEvents::RungMicros)
                .big_integer()
                .null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSE_EVENTS,
            OncallResponseEvents::LadderRun,
            ColumnDef::new(OncallResponseEvents::LadderRun)
                .integer()
                .null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSE_EVENTS,
            OncallResponseEvents::Recipient,
            ColumnDef::new(OncallResponseEvents::Recipient).string().null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSE_EVENTS,
            OncallResponseEvents::Channel,
            ColumnDef::new(OncallResponseEvents::Channel).integer().null(),
        )
        .await?;
        add_column(
            manager,
            RESPONSE_EVENTS,
            OncallResponseEvents::Delivered,
            ColumnDef::new(OncallResponseEvents::Delivered).boolean().null(),
        )
        .await?;
        // The rung index `rung_micros` replaced. Dropped rather than left in
        // place so an upgraded database holds the same columns as a fresh one
        // — a dead column that no current code can interpret is drift too.
        drop_column_if_exists(
            manager,
            RESPONSE_EVENTS,
            OncallResponseEvents::Level,
            "level",
        )
        .await?;

        // -- oncall_policies --------------------------------------------------
        add_column(
            manager,
            POLICIES,
            OncallPolicies::Destinations,
            ColumnDef::new(OncallPolicies::Destinations)
                .custom(Alias::new(get_text_type()))
                .not_null()
                .default("[]"),
        )
        .await?;

        // -- oncall_team_members ----------------------------------------------
        // Index first: SQLite will not drop a column an index references.
        if manager.has_index(TEAM_MEMBERS, TEAM_MEMBERS_IDX_OLD).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(TEAM_MEMBERS_IDX_OLD)
                        .table(Alias::new(TEAM_MEMBERS))
                        .to_owned(),
                )
                .await?;
        }
        drop_column_if_exists(manager, TEAM_MEMBERS, OncallTeamMembers::Level, "level").await?;
        if !manager.has_index(TEAM_MEMBERS, TEAM_MEMBERS_IDX_NEW).await? {
            manager
                .create_index(
                    Index::create()
                        .if_not_exists()
                        .table(Alias::new(TEAM_MEMBERS))
                        .name(TEAM_MEMBERS_IDX_NEW)
                        .col(OncallTeamMembers::TeamId)
                        .col(OncallTeamMembers::UserEmail)
                        .unique()
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }

    /// Deliberately a no-op.
    ///
    /// On a fresh database every column this migration guards was created by
    /// `m20260806`, which owns dropping them. A `down` here that dropped them
    /// would leave the schema inconsistent with the migration that created it,
    /// which is the same class of mistake this file exists to repair.
    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}

/// Add one column, skipping it if the table already has it.
///
/// The explicit `has_column` guard rather than `add_column_if_not_exists`:
/// the latter is not idempotent on SQLite, which has no `IF NOT EXISTS` for
/// `ADD COLUMN` and errors with "duplicate column name".
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
enum OncallTeamMembers {
    TeamId,
    UserEmail,
    Level,
}

#[derive(DeriveIden)]
enum OncallPolicies {
    Destinations,
}

#[derive(DeriveIden)]
enum OncallResponses {
    Title,
    Cause,
    CauseNote,
    SnoozedUntil,
    LadderAnchor,
    LadderRun,
    ResponderRole,
    OriginResponseId,
}

#[derive(DeriveIden)]
enum OncallResponseEvents {
    RungMicros,
    LadderRun,
    Recipient,
    Channel,
    Delivered,
    Level,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    /// The on-call tables exactly as `m20260806_000001` created them when it
    /// first landed in `2039cdea64` — i.e. what a database that ran the
    /// migration before any of the in-place edits actually holds. Hand-written
    /// rather than generated, because the code that produced it no longer
    /// exists in the tree; `git show 2039cdea64:$MIGRATION` is the source.
    async fn create_pre_edit_oncall_tables(db: &DatabaseConnection) {
        for sql in [
            "CREATE TABLE oncall_teams (id TEXT NOT NULL PRIMARY KEY, org_id TEXT NOT NULL, \
             name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC', description TEXT NULL, \
             created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)",
            "CREATE TABLE oncall_team_members (id TEXT NOT NULL PRIMARY KEY, team_id TEXT NOT NULL, \
             user_email TEXT NOT NULL, level INTEGER NOT NULL, created_at BIGINT NOT NULL)",
            "CREATE UNIQUE INDEX idx_oncall_team_members_team_user_level \
             ON oncall_team_members (team_id, user_email, level)",
            "CREATE TABLE oncall_schedules (id TEXT NOT NULL PRIMARY KEY, org_id TEXT NOT NULL, \
             team_id TEXT NOT NULL UNIQUE, timezone TEXT NOT NULL DEFAULT 'UTC', \
             rotations text NOT NULL DEFAULT '[]', created_at BIGINT NOT NULL, \
             updated_at BIGINT NOT NULL)",
            "CREATE TABLE oncall_policies (id TEXT NOT NULL PRIMARY KEY, org_id TEXT NOT NULL, \
             team_id TEXT NOT NULL UNIQUE, rungs text NOT NULL DEFAULT '[]', \
             created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)",
            "CREATE TABLE oncall_responses (id TEXT NOT NULL PRIMARY KEY, org_id TEXT NOT NULL, \
             subject_type INTEGER NOT NULL, subject_id TEXT NOT NULL, team_id TEXT NOT NULL, \
             priority INTEGER NOT NULL, state INTEGER NOT NULL, opened_at BIGINT NOT NULL, \
             acked_by TEXT NULL, acked_at BIGINT NULL, closed_at BIGINT NULL, \
             incident_id TEXT NULL)",
            "CREATE UNIQUE INDEX idx_oncall_responses_subject \
             ON oncall_responses (org_id, subject_type, subject_id)",
            "CREATE INDEX idx_oncall_responses_team_state \
             ON oncall_responses (org_id, team_id, state)",
            "CREATE TABLE oncall_response_events (id TEXT NOT NULL PRIMARY KEY, \
             response_id TEXT NOT NULL, kind INTEGER NOT NULL, at BIGINT NOT NULL, \
             actor TEXT NOT NULL, body text NOT NULL DEFAULT '', level INTEGER NULL)",
            "CREATE INDEX idx_oncall_response_events_response \
             ON oncall_response_events (response_id, at, id)",
        ] {
            db.execute(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                sql.to_owned(),
            ))
            .await
            .unwrap();
        }
    }

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

    /// A database that ran the pre-edit migration: the drifted columns must
    /// appear, the removed ones must go. This is the case a fresh-install test
    /// cannot see, and the one that broke every on-call query in production.
    #[tokio::test]
    async fn test_up_repairs_a_pre_edit_database() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_pre_edit_oncall_tables(&db).await;
        let manager = SchemaManager::new(&db);

        assert!(!manager.has_column(RESPONSES, "ladder_run").await.unwrap());
        assert!(
            !manager
                .has_column(RESPONSE_EVENTS, "ladder_run")
                .await
                .unwrap()
        );
        assert!(manager.has_column(TEAM_MEMBERS, "level").await.unwrap());

        Migration.up(&manager).await.expect("repair must apply");

        for col in [
            "title",
            "cause",
            "cause_note",
            "snoozed_until",
            "ladder_anchor",
            "ladder_run",
            "responder_role",
            "origin_response_id",
        ] {
            assert!(
                manager.has_column(RESPONSES, col).await.unwrap(),
                "oncall_responses.{col} missing after repair"
            );
        }
        for col in [
            "rung_micros",
            "ladder_run",
            "recipient",
            "channel",
            "delivered",
        ] {
            assert!(
                manager.has_column(RESPONSE_EVENTS, col).await.unwrap(),
                "oncall_response_events.{col} missing after repair"
            );
        }
        assert!(manager.has_column(POLICIES, "destinations").await.unwrap());
        // The rung index and the NOT NULL membership level are gone, so
        // membership inserts from current code succeed again.
        assert!(!manager.has_column(RESPONSE_EVENTS, "level").await.unwrap());
        assert!(!manager.has_column(TEAM_MEMBERS, "level").await.unwrap());
        assert!(
            !manager
                .has_index(TEAM_MEMBERS, TEAM_MEMBERS_IDX_OLD)
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index(TEAM_MEMBERS, TEAM_MEMBERS_IDX_NEW)
                .await
                .unwrap()
        );
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_team_members (id, team_id, user_email, created_at) \
             VALUES ('a', 't', 'e@o.ai', 1)"
                .to_owned(),
        ))
        .await
        .expect("membership insert must work after the level column is gone");
    }

    /// A fresh database already has every column from `m20260806`, so the
    /// repair must not fail — and running it twice must not either.
    #[tokio::test]
    async fn test_up_is_noop_and_idempotent_on_a_fresh_database() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(&manager)
            .await
            .unwrap();
        Migration.up(&manager).await.expect("first run");
        Migration.up(&manager).await.expect("second run");
        assert!(manager.has_column(RESPONSES, "ladder_run").await.unwrap());
    }

    /// The property that matters: an upgraded database and a fresh one end in
    /// exactly the same schema. If this ever fails, the two install paths have
    /// diverged and only one of them is being tested anywhere else.
    #[tokio::test]
    async fn test_upgraded_schema_matches_fresh_schema() {
        let fresh = Database::connect("sqlite::memory:").await.unwrap();
        let fresh_mgr = SchemaManager::new(&fresh);
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(&fresh_mgr)
            .await
            .unwrap();
        Migration.up(&fresh_mgr).await.unwrap();

        let upgraded = Database::connect("sqlite::memory:").await.unwrap();
        create_pre_edit_oncall_tables(&upgraded).await;
        Migration
            .up(&SchemaManager::new(&upgraded))
            .await
            .unwrap();

        for table in [
            "oncall_teams",
            TEAM_MEMBERS,
            "oncall_schedules",
            POLICIES,
            RESPONSES,
            RESPONSE_EVENTS,
        ] {
            assert_eq!(
                columns(&fresh, table).await,
                columns(&upgraded, table).await,
                "{table} differs between a fresh install and an upgrade"
            );
        }
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260811_000002_repair_oncall_schema_drift"
        );
    }
}
