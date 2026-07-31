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

//! SLO storage — Feature 5 Phase 5a (`alerts_2.md` §6b.8).
//!
//! All **new tables**, so none of the `ALTER TABLE` traps from §8b apply
//! (SQLite's one-alter-option-per-statement panic, and
//! `add_column_if_not_exists` not being idempotent). `create_table_if_not_exists`
//! is genuinely idempotent, so a partially-applied migration can be retried.
//!
//! The slices themselves are **not** here — they live in the reserved
//! `slo_slices` stream (D32). A 90-day grouped SLO is ~14M slice rows; the
//! meta store is SQLite in local deployments and would be swamped. What lives
//! here is one small row per group, updated in place, plus the watermark that
//! keeps readers off the currently-filling slice. There is deliberately no
//! commit-barrier state: slices publish at-least-once like every other stream
//! (D64).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_slos_stmt()).await?;
        manager.create_index(create_slos_org_idx_stmt()).await?;
        manager.create_index(create_slos_name_idx_stmt()).await?;
        manager.create_table(create_slo_status_stmt()).await?;
        manager.create_table(create_slo_budget_stmt()).await?;
        manager
            .create_table(create_slo_budget_charges_stmt())
            .await?;
        manager
            .create_index(create_slo_budget_charges_idx_stmt())
            .await?;
        manager
            .create_table(create_slo_backfill_jobs_stmt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SloBackfillJobs::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SloBudgetCharges::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SloBudget::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SloStatus::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Slos::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// `slo_status` — the O(1) read path plus, on the rollup row, the watermark.
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
        // The watermark (rollup row only) — a forward clamp, not a barrier.
        .col(ColumnDef::new(SloStatus::WatermarkEnd).big_integer().null())
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
    GroupsObserved,
    GroupsObservedIsLowerBound,
    ActiveSet,
    GroupRoster,
    GroupLabels,
    ComputedAt,
}

/// `slos` — the definition. `(org, folder_id, name)` is unique, matching the
/// `alerts` convention: a folder is the namespace a user actually browses.
fn create_slos_stmt() -> TableCreateStatement {
    Table::create()
        .table(Slos::Table)
        .if_not_exists()
        .col(ColumnDef::new(Slos::Id).string_len(27).not_null().primary_key())
        .col(ColumnDef::new(Slos::Org).string_len(100).not_null())
        .col(ColumnDef::new(Slos::FolderId).string_len(27).not_null())
        .col(ColumnDef::new(Slos::Name).string_len(256).not_null())
        .col(ColumnDef::new(Slos::Description).text().null())
        .col(ColumnDef::new(Slos::SliType).integer().not_null())
        .col(ColumnDef::new(Slos::SliConfig).json().not_null())
        .col(ColumnDef::new(Slos::Target).double().not_null())
        .col(ColumnDef::new(Slos::WindowSecs).big_integer().not_null())
        .col(ColumnDef::new(Slos::SliceIntervalSecs).integer().not_null())
        .col(ColumnDef::new(Slos::GroupBy).json().null())
        .col(ColumnDef::new(Slos::Tags).json().null())
        .col(ColumnDef::new(Slos::Enabled).boolean().not_null())
        .col(ColumnDef::new(Slos::Owner).string_len(256).null())
        // Defaults so a row inserted by an older writer still carries a usable
        // epoch — generation 1 with no reset time means "never bumped".
        .col(
            ColumnDef::new(Slos::DefinitionGeneration)
                .integer()
                .not_null()
                .default(1),
        )
        .col(ColumnDef::new(Slos::GenerationResetTime).big_integer().null())
        .col(ColumnDef::new(Slos::GroupsEstimate).big_integer().null())
        .col(
            ColumnDef::new(Slos::GroupsReserved)
                .big_integer()
                .not_null()
                .default(1),
        )
        .col(ColumnDef::new(Slos::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(Slos::UpdatedAt).big_integer().not_null())
        .col(ColumnDef::new(Slos::LastEditedBy).string_len(256).null())
        .to_owned()
}

/// Listing is always org-scoped, and usually folder-scoped within it.
fn create_slos_org_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("slos_org_folder_idx")
        .table(Slos::Table)
        .col(Slos::Org)
        .col(Slos::FolderId)
        .to_owned()
}

/// The uniqueness constraint, as an index rather than a table constraint so
/// SQLite and Postgres agree on the name it reports on violation.
fn create_slos_name_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("slos_org_folder_name_idx")
        .table(Slos::Table)
        .col(Slos::Org)
        .col(Slos::FolderId)
        .col(Slos::Name)
        .unique()
        .to_owned()
}

/// `slo_budget` — one row per org. `version` is the CAS token that stops two
/// concurrent creates from each reserving the last of the headroom (S-14d).
fn create_slo_budget_stmt() -> TableCreateStatement {
    Table::create()
        .table(SloBudget::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SloBudget::Org)
                .string_len(100)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(SloBudget::Version).big_integer().not_null())
        .col(
            ColumnDef::new(SloBudget::ActiveRows)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(SloBudget::ResidualRows)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

/// `slo_budget_charges` — the detail the totals cannot reconstruct (S-14c).
fn create_slo_budget_charges_stmt() -> TableCreateStatement {
    Table::create()
        .table(SloBudgetCharges::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SloBudgetCharges::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBudgetCharges::SloId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBudgetCharges::Generation)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBudgetCharges::RowsCharged)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(SloBudgetCharges::State).integer().not_null())
        .col(
            ColumnDef::new(SloBudgetCharges::ExpiresAt)
                .big_integer()
                .null(),
        )
        .primary_key(
            Index::create()
                .name("pk_slo_budget_charges")
                .col(SloBudgetCharges::Org)
                .col(SloBudgetCharges::SloId)
                .col(SloBudgetCharges::Generation),
        )
        .to_owned()
}

/// The expiry sweep scans `(org, state, expires_at)` — every column it filters
/// on, in the order it filters them.
fn create_slo_budget_charges_idx_stmt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("slo_budget_charges_expiry_idx")
        .table(SloBudgetCharges::Table)
        .col(SloBudgetCharges::Org)
        .col(SloBudgetCharges::State)
        .col(SloBudgetCharges::ExpiresAt)
        .to_owned()
}

/// `slo_backfill_jobs` — keyed by generation, because a bump starts a
/// different job whose progress must not inherit the old one's.
fn create_slo_backfill_jobs_stmt() -> TableCreateStatement {
    Table::create()
        .table(SloBackfillJobs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SloBackfillJobs::SloId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBackfillJobs::DefinitionGeneration)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(SloBackfillJobs::State).integer().not_null())
        .col(
            ColumnDef::new(SloBackfillJobs::RangeStart)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBackfillJobs::RangeEnd)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SloBackfillJobs::DoneThrough)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(SloBackfillJobs::RowsWritten)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(SloBackfillJobs::Error).text().null())
        .col(
            ColumnDef::new(SloBackfillJobs::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .name("pk_slo_backfill_jobs")
                .col(SloBackfillJobs::SloId)
                .col(SloBackfillJobs::DefinitionGeneration),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum Slos {
    Table,
    Id,
    Org,
    FolderId,
    Name,
    Description,
    SliType,
    SliConfig,
    Target,
    WindowSecs,
    SliceIntervalSecs,
    GroupBy,
    Tags,
    Enabled,
    Owner,
    DefinitionGeneration,
    GenerationResetTime,
    GroupsEstimate,
    GroupsReserved,
    CreatedAt,
    UpdatedAt,
    LastEditedBy,
}

#[derive(DeriveIden)]
enum SloBudget {
    Table,
    Org,
    Version,
    ActiveRows,
    ResidualRows,
}

#[derive(DeriveIden)]
enum SloBudgetCharges {
    Table,
    Org,
    SloId,
    Generation,
    RowsCharged,
    State,
    ExpiresAt,
}

#[derive(DeriveIden)]
enum SloBackfillJobs {
    Table,
    SloId,
    DefinitionGeneration,
    State,
    RangeStart,
    RangeEnd,
    DoneThrough,
    RowsWritten,
    Error,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    /// Snapshots for every statement, both backends. These catch the class of
    /// bug that only shows up on the backend you did not develop against —
    /// SQLite silently accepting a type Postgres rejects, most often.
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
    fn new_tables_build_on_both_backends() {
        // Asserted as a smoke test rather than a full snapshot: these five
        // statements are long, and what matters is that every column type
        // resolves on both builders.
        for stmt in [
            create_slos_stmt().to_string(PostgresQueryBuilder),
            create_slos_stmt().to_string(SqliteQueryBuilder),
            create_slo_budget_stmt().to_string(PostgresQueryBuilder),
            create_slo_budget_stmt().to_string(SqliteQueryBuilder),
            create_slo_budget_charges_stmt().to_string(PostgresQueryBuilder),
            create_slo_budget_charges_stmt().to_string(SqliteQueryBuilder),
            create_slo_backfill_jobs_stmt().to_string(PostgresQueryBuilder),
            create_slo_backfill_jobs_stmt().to_string(SqliteQueryBuilder),
        ] {
            assert!(stmt.starts_with("CREATE TABLE IF NOT EXISTS"), "{stmt}");
        }
    }

    /// The uniqueness rule a user actually feels: two SLOs may share a name
    /// across folders or orgs, never within one.
    #[test]
    fn the_name_index_is_unique_and_scoped_to_org_and_folder() {
        let sql = create_slos_name_idx_stmt().to_string(PostgresQueryBuilder);
        assert!(sql.contains("UNIQUE"), "{sql}");
        assert!(sql.contains("\"org\""), "{sql}");
        assert!(sql.contains("\"folder_id\""), "{sql}");
        assert!(sql.contains("\"name\""), "{sql}");
    }

    /// A retried migration must not fail on the index (§8b trap 3). The tables
    /// get this from `create_table_if_not_exists`; indexes need it asked for.
    #[test]
    fn every_index_is_idempotent() {
        for sql in [
            create_slos_org_idx_stmt().to_string(PostgresQueryBuilder),
            create_slos_name_idx_stmt().to_string(PostgresQueryBuilder),
            create_slo_budget_charges_idx_stmt().to_string(PostgresQueryBuilder),
        ] {
            assert!(sql.contains("IF NOT EXISTS"), "{sql}");
        }
    }

    const EXPECTED_STATUS_POSTGRES: &str = r#"CREATE TABLE IF NOT EXISTS "slo_status" ( "slo_id" varchar(27) NOT NULL, "group_key" varchar NOT NULL, "definition_generation" integer NOT NULL, "good" double precision NULL, "total" double precision NULL, "covered_slices" integer NULL, "coverage" double precision NULL, "burn_windows" json NULL, "trailing_slices" json NULL, "watermark_end" bigint NULL, "groups_observed" bigint NULL, "groups_observed_is_lower_bound" bool NULL, "active_set" json NULL, "group_roster" json NULL, "group_labels" text NULL, "computed_at" bigint NULL, CONSTRAINT "pk_slo_status" PRIMARY KEY ("slo_id", "group_key") )"#;

    const EXPECTED_STATUS_SQLITE: &str = r#"CREATE TABLE IF NOT EXISTS "slo_status" ( "slo_id" varchar(27) NOT NULL, "group_key" varchar NOT NULL, "definition_generation" integer NOT NULL, "good" double NULL, "total" double NULL, "covered_slices" integer NULL, "coverage" double NULL, "burn_windows" json_text NULL, "trailing_slices" json_text NULL, "watermark_end" bigint NULL, "groups_observed" bigint NULL, "groups_observed_is_lower_bound" boolean NULL, "active_set" json_text NULL, "group_roster" json_text NULL, "group_labels" text NULL, "computed_at" bigint NULL, CONSTRAINT "pk_slo_status" PRIMARY KEY ("slo_id", "group_key") )"#;
}
