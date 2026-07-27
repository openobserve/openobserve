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

//! SLO status and batch manifest — Feature 5 Phase 5a (`alerts_2.md` §6b.8).
//!
//! Two **new tables**, so none of the `ALTER TABLE` traps from §8b apply
//! (SQLite's one-alter-option-per-statement panic, and
//! `add_column_if_not_exists` not being idempotent). `create_table_if_not_exists`
//! is genuinely idempotent, so a partially-applied migration can be retried.
//!
//! The slices themselves are **not** here — they live in the reserved
//! `slo_slices` stream (D32). A 90-day grouped SLO is ~14M slice rows; the
//! meta store is SQLite in local deployments and would be swamped. What lives
//! here is one small row per group, updated in place, plus the commit state
//! that makes the columnar writes safely publishable.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_slo_status_stmt()).await?;
        manager
            .create_table(create_slo_batch_manifest_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SloBatchManifest::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SloStatus::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// `slo_status` — the O(1) read path plus, on the rollup row, the publication
/// barrier.
///
/// No index beyond the primary key: these are mutable columns on the hottest
/// SLO write path, the same discipline `alert_states` follows (`alerts.md`
/// Part IV), and every read is already keyed.
fn create_slo_status_stmt() -> TableCreateStatement {
    Table::create()
        .table(SloStatus::Table)
        .if_not_exists()
        .col(ColumnDef::new(SloStatus::SloId).string_len(27).not_null())
        // `''` is the rollup row (S-9) and owns the commit state.
        .col(ColumnDef::new(SloStatus::GroupKey).string().not_null())
        .col(
            ColumnDef::new(SloStatus::DefinitionGeneration)
                .integer()
                .not_null(),
        )
        // Running window aggregate — target-free by rule (D56).
        .col(ColumnDef::new(SloStatus::Good).double().null())
        .col(ColumnDef::new(SloStatus::Total).double().null())
        .col(ColumnDef::new(SloStatus::CoveredSlices).integer().null())
        .col(ColumnDef::new(SloStatus::Coverage).double().null())
        .col(ColumnDef::new(SloStatus::BurnWindows).json().null())
        .col(ColumnDef::new(SloStatus::TrailingSlices).json().null())
        // Publication barrier (rollup row only).
        .col(ColumnDef::new(SloStatus::WatermarkEnd).big_integer().null())
        .col(ColumnDef::new(SloStatus::ResetTime).big_integer().null())
        .col(
            ColumnDef::new(SloStatus::CommittedBatchRevIncr)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SloStatus::CommittedBatchRevBf)
                .big_integer()
                .null(),
        )
        .col(ColumnDef::new(SloStatus::AbandonedBatchRevs).json().null())
        // Group bookkeeping (S-10).
        .col(ColumnDef::new(SloStatus::GroupsObserved).big_integer().null())
        .col(
            ColumnDef::new(SloStatus::GroupsObservedIsLowerBound)
                .boolean()
                .null(),
        )
        .col(ColumnDef::new(SloStatus::ActiveSet).json().null())
        .col(ColumnDef::new(SloStatus::GroupRoster).json().null())
        .col(ColumnDef::new(SloStatus::GroupLabels).text().null())
        .col(ColumnDef::new(SloStatus::ComputedAt).big_integer().null())
        .primary_key(
            Index::create()
                .name("pk_slo_status")
                .col(SloStatus::SloId)
                .col(SloStatus::GroupKey),
        )
        .to_owned()
}

/// `slo_batch_manifest` — the write-ahead intent (D62/D63).
///
/// One row per `(slo_id, writer)`: a writer must resolve its torn batch before
/// starting another, which is what keeps the abandoned set bounded.
fn create_slo_batch_manifest_stmt() -> TableCreateStatement {
    Table::create()
        .table(SloBatchManifest::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SloBatchManifest::SloId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBatchManifest::Writer)
                .small_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBatchManifest::BatchRev)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBatchManifest::RangeStart)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBatchManifest::RangeEnd)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBatchManifest::DefinitionGeneration)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBatchManifest::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .name("pk_slo_batch_manifest")
                .col(SloBatchManifest::SloId)
                .col(SloBatchManifest::Writer),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum SloStatus {
    Table,
    SloId,
    GroupKey,
    DefinitionGeneration,
    Good,
    Total,
    CoveredSlices,
    Coverage,
    BurnWindows,
    TrailingSlices,
    WatermarkEnd,
    ResetTime,
    CommittedBatchRevIncr,
    CommittedBatchRevBf,
    AbandonedBatchRevs,
    GroupsObserved,
    GroupsObservedIsLowerBound,
    ActiveSet,
    GroupRoster,
    GroupLabels,
    ComputedAt,
}

#[derive(DeriveIden)]
enum SloBatchManifest {
    Table,
    SloId,
    Writer,
    BatchRev,
    RangeStart,
    RangeEnd,
    DefinitionGeneration,
    CreatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_slo_status_stmt().to_string(PostgresQueryBuilder),
            EXPECTED_STATUS_POSTGRES
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_slo_status_stmt().to_string(SqliteQueryBuilder),
            EXPECTED_STATUS_SQLITE
        );
    }

    #[test]
    fn manifest_sqlite() {
        collapsed_eq!(
            &create_slo_batch_manifest_stmt().to_string(SqliteQueryBuilder),
            EXPECTED_MANIFEST_SQLITE
        );
    }

    const EXPECTED_STATUS_POSTGRES: &str = r#"CREATE TABLE IF NOT EXISTS "slo_status" ( "slo_id" varchar(27) NOT NULL, "group_key" varchar NOT NULL, "definition_generation" integer NOT NULL, "good" double precision NULL, "total" double precision NULL, "covered_slices" integer NULL, "coverage" double precision NULL, "burn_windows" json NULL, "trailing_slices" json NULL, "watermark_end" bigint NULL, "reset_time" bigint NULL, "committed_batch_rev_incr" bigint NULL, "committed_batch_rev_bf" bigint NULL, "abandoned_batch_revs" json NULL, "groups_observed" bigint NULL, "groups_observed_is_lower_bound" bool NULL, "active_set" json NULL, "group_roster" json NULL, "group_labels" text NULL, "computed_at" bigint NULL, CONSTRAINT "pk_slo_status" PRIMARY KEY ("slo_id", "group_key") )"#;

    const EXPECTED_STATUS_SQLITE: &str = r#"CREATE TABLE IF NOT EXISTS "slo_status" ( "slo_id" varchar(27) NOT NULL, "group_key" varchar NOT NULL, "definition_generation" integer NOT NULL, "good" double NULL, "total" double NULL, "covered_slices" integer NULL, "coverage" double NULL, "burn_windows" json_text NULL, "trailing_slices" json_text NULL, "watermark_end" bigint NULL, "reset_time" bigint NULL, "committed_batch_rev_incr" bigint NULL, "committed_batch_rev_bf" bigint NULL, "abandoned_batch_revs" json_text NULL, "groups_observed" bigint NULL, "groups_observed_is_lower_bound" boolean NULL, "active_set" json_text NULL, "group_roster" json_text NULL, "group_labels" text NULL, "computed_at" bigint NULL, CONSTRAINT "pk_slo_status" PRIMARY KEY ("slo_id", "group_key") )"#;

    const EXPECTED_MANIFEST_SQLITE: &str = r#"CREATE TABLE IF NOT EXISTS "slo_batch_manifest" ( "slo_id" varchar(27) NOT NULL, "writer" smallint NOT NULL, "batch_rev" bigint NOT NULL, "range_start" bigint NOT NULL, "range_end" bigint NOT NULL, "definition_generation" integer NOT NULL, "created_at" bigint NOT NULL, CONSTRAINT "pk_slo_batch_manifest" PRIMARY KEY ("slo_id", "writer") )"#;
}
