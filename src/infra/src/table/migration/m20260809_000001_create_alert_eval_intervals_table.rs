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

//! The alert availability ledger (S-16).
//!
//! `alert_states` records the *last* evaluation and `alert_state_transitions`
//! records every level *change*; neither can say whether an alert was
//! evaluating at all between two changes. An alert that held `Ok` for a week
//! and an alert that was paused for a week write identical rows, and without
//! this table the second reads as uptime — the one failure the SLO subsystem
//! exists to prevent (D34).
//!
//! Run-length encoded: one row per run of constant `(level, frequency_secs)`,
//! so storage is O(state changes) rather than O(evaluations). The single index
//! matches the only read shape there is — one alert, over a time range — and
//! must give that read an index range scan.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_alert_eval_intervals_statement())
            .await?;
        manager
            .create_index(create_alert_from_idx_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AlertEvalIntervals::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_alert_eval_intervals_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertEvalIntervals::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertEvalIntervals::Id)
                .big_integer()
                .primary_key()
                .auto_increment(),
        )
        .col(
            ColumnDef::new(AlertEvalIntervals::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertEvalIntervals::AlertId)
                .string_len(27)
                .not_null(),
        )
        // AlertLevel::to_i32. NOT NULL: a run with no level is not a
        // measurement, so it never reaches this table.
        .col(
            ColumnDef::new(AlertEvalIntervals::Level)
                .integer()
                .not_null(),
        )
        // The cadence in effect for this interval, seconds (§5.3).
        .col(
            ColumnDef::new(AlertEvalIntervals::FrequencySecs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertEvalIntervals::FromUs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertEvalIntervals::ToUs)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Every read is "this alert, over this range", and the write path looks up the
/// alert's newest interval by the same key.
fn create_alert_from_idx_statement() -> IndexCreateStatement {
    Index::create()
        .if_not_exists()
        .name("alert_eval_intervals_alert_from_idx")
        .table(AlertEvalIntervals::Table)
        .col(AlertEvalIntervals::AlertId)
        .col(AlertEvalIntervals::FromUs)
        .to_owned()
}

#[derive(DeriveIden)]
enum AlertEvalIntervals {
    Table,
    Id,
    Org,
    AlertId,
    Level,
    FrequencySecs,
    FromUs,
    ToUs,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn test_postgres_alert_eval_intervals() {
        collapsed_eq!(
            &create_alert_eval_intervals_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "alert_eval_intervals" (
                "id" bigserial PRIMARY KEY,
                "org" varchar(100) NOT NULL,
                "alert_id" varchar(27) NOT NULL,
                "level" integer NOT NULL,
                "frequency_secs" bigint NOT NULL,
                "from_us" bigint NOT NULL,
                "to_us" bigint NOT NULL
            )"#
        );
    }

    #[test]
    fn test_sqlite_alert_eval_intervals() {
        collapsed_eq!(
            &create_alert_eval_intervals_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "alert_eval_intervals" (
                "id" integer PRIMARY KEY AUTOINCREMENT,
                "org" varchar(100) NOT NULL,
                "alert_id" varchar(27) NOT NULL,
                "level" integer NOT NULL,
                "frequency_secs" bigint NOT NULL,
                "from_us" bigint NOT NULL,
                "to_us" bigint NOT NULL
            )"#
        );
    }

    #[test]
    fn test_mysql_alert_eval_intervals() {
        collapsed_eq!(
            &create_alert_eval_intervals_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `alert_eval_intervals` (
                `id` bigint PRIMARY KEY AUTO_INCREMENT,
                `org` varchar(100) NOT NULL,
                `alert_id` varchar(27) NOT NULL,
                `level` int NOT NULL,
                `frequency_secs` bigint NOT NULL,
                `from_us` bigint NOT NULL,
                `to_us` bigint NOT NULL
            )"#
        );
    }

    /// The read plan the design depends on: one alert, ordered by `from_us`.
    /// Losing the second column silently turns every ledger read into a scan of
    /// that alert's entire history.
    #[test]
    fn test_postgres_alert_from_idx() {
        collapsed_eq!(
            &create_alert_from_idx_statement().to_string(PostgresQueryBuilder),
            r#"CREATE INDEX IF NOT EXISTS "alert_eval_intervals_alert_from_idx"
               ON "alert_eval_intervals" ("alert_id", "from_us")"#
        );
    }
}
