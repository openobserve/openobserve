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

//! Durable alert run state — Part IV of `alerts.md`.
//!
//! Two tables with deliberately different shapes:
//!
//! * `alert_states` — current state, one row per `(alert_id, group_key)`,
//!   UPDATE-in-place. `group_key = ''` is the per-alert rollup row.
//! * `alert_state_transitions` — append-only change log, deleted by retention.
//!
//! Mixing them would put retention DELETEs on the hottest-updated pages.
//!
//! NOTE: no index is created on the mutable columns of `alert_states`
//! (`last_outcome`, `last_outcome_at`, `since`). Like `scheduled_jobs`, this is
//! a high-churn table and indexing a mutable column defeats HOT updates. Reads
//! are keyed on the primary key or on `alert_id`.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_alert_states_statement()).await?;
        manager
            .create_table(create_alert_state_transitions_statement())
            .await?;
        manager
            .create_index(create_alert_states_alert_id_idx_statement())
            .await?;
        manager
            .create_index(create_transitions_alert_at_idx_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertStateTransitions::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(AlertStates::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_alert_states_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertStates::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertStates::AlertId)
                .string_len(27)
                .not_null(),
        )
        // '' = the per-alert rollup row; non-empty = one grouped series.
        .col(
            ColumnDef::new(AlertStates::GroupKey)
                .string_len(256)
                .not_null()
                .default(""),
        )
        // RunOutcome::to_i32. NULL = never evaluated, which is distinct from
        // every real outcome value.
        .col(ColumnDef::new(AlertStates::LastOutcome).integer().null())
        .col(
            ColumnDef::new(AlertStates::LastOutcomeAt)
                .big_integer()
                .null(),
        )
        // When LastOutcome last CHANGED — stable across repeated same-outcome runs.
        .col(ColumnDef::new(AlertStates::Since).big_integer().null())
        .primary_key(
            Index::create()
                .col(AlertStates::AlertId)
                .col(AlertStates::GroupKey),
        )
        .to_owned()
}

fn create_alert_state_transitions_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertStateTransitions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertStateTransitions::Id)
                .big_integer()
                .primary_key()
                .auto_increment(),
        )
        .col(
            ColumnDef::new(AlertStateTransitions::AlertId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertStateTransitions::GroupKey)
                .string_len(256)
                .not_null()
                .default(""),
        )
        // NULL on the first ever evaluation of an alert.
        .col(
            ColumnDef::new(AlertStateTransitions::FromOutcome)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(AlertStateTransitions::ToOutcome)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertStateTransitions::At)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_alert_states_alert_id_idx_statement() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("alert_states_alert_id_idx")
        .table(AlertStates::Table)
        .col(AlertStates::AlertId)
        .to_owned()
}

/// Transition reads are always "this alert, over this window", and retention
/// deletes by `at`.
fn create_transitions_alert_at_idx_statement() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("alert_state_transitions_alert_at_idx")
        .table(AlertStateTransitions::Table)
        .col(AlertStateTransitions::AlertId)
        .col(AlertStateTransitions::At)
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertStates {
    Table,
    AlertId,
    GroupKey,
    LastOutcome,
    LastOutcomeAt,
    Since,
}

#[derive(DeriveIden)]
enum AlertStateTransitions {
    Table,
    Id,
    AlertId,
    GroupKey,
    FromOutcome,
    ToOutcome,
    At,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn test_postgres_alert_states() {
        collapsed_eq!(
            &create_alert_states_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "alert_states" (
                "alert_id" varchar(27) NOT NULL,
                "group_key" varchar(256) NOT NULL DEFAULT '',
                "last_outcome" integer NULL,
                "last_outcome_at" bigint NULL,
                "since" bigint NULL,
                PRIMARY KEY ("alert_id", "group_key")
            )"#
        );
    }

    #[test]
    fn test_sqlite_alert_states() {
        collapsed_eq!(
            &create_alert_states_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "alert_states" (
                "alert_id" varchar(27) NOT NULL,
                "group_key" varchar(256) NOT NULL DEFAULT '',
                "last_outcome" integer NULL,
                "last_outcome_at" bigint NULL,
                "since" bigint NULL,
                PRIMARY KEY ("alert_id", "group_key")
            )"#
        );
    }

    #[test]
    fn test_postgres_alert_state_transitions() {
        collapsed_eq!(
            &create_alert_state_transitions_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "alert_state_transitions" (
                "id" bigserial PRIMARY KEY,
                "alert_id" varchar(27) NOT NULL,
                "group_key" varchar(256) NOT NULL DEFAULT '',
                "from_outcome" integer NULL,
                "to_outcome" integer NOT NULL,
                "at" bigint NOT NULL
            )"#
        );
    }
}
