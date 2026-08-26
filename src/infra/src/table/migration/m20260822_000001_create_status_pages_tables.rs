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

//! Public status pages built on synthetics — all NEW tables, so none of the
//! ALTER traps apply and every statement is idempotent for retry.
//!
//! Shape notes that are contracts, not preferences:
//! - `status_page_notices` is ORG-scoped (no page column): one outage is one notice on every page
//!   that shows an affected component; pages derive through `status_page_components` →
//!   `status_page_notice_components`.
//! - `status_page_snapshots` splits hot (`current`, ~1-2KB, rewritten on state change) from cold
//!   (`history`, ~30KB, rewritten on day rollover / notice change) so a status flip never re-WALs
//!   30KB of unchanged history.
//! - The index added to the existing `synthetics` table is the rebuilder's delta-read watermark;
//!   the paired writer change bumps `updated_at` in `update_last_check_status` /
//!   `update_alert_state_if` only.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_pages_stmt()).await?;
        manager.create_index(pages_org_idx()).await?;
        manager.create_index(pages_slug_idx()).await?;
        manager.create_table(create_components_stmt()).await?;
        manager.create_index(components_page_idx()).await?;
        manager.create_table(create_component_checks_stmt()).await?;
        manager.create_index(component_checks_unique_idx()).await?;
        manager.create_index(component_checks_check_idx()).await?;
        manager.create_table(create_notices_stmt()).await?;
        manager.create_index(notices_org_state_idx()).await?;
        manager.create_index(notices_auto_check_idx()).await?;
        manager
            .create_table(create_notice_components_stmt())
            .await?;
        manager.create_index(notice_components_notice_idx()).await?;
        manager
            .create_index(notice_components_component_idx())
            .await?;
        manager.create_table(create_notice_updates_stmt()).await?;
        manager.create_index(notice_updates_notice_idx()).await?;
        manager.create_table(create_check_snoozes_stmt()).await?;
        manager.create_index(check_snoozes_check_idx()).await?;
        manager.create_table(create_audit_log_stmt()).await?;
        manager.create_index(audit_log_org_idx()).await?;
        manager.create_table(create_snapshots_stmt()).await?;
        manager.create_index(synthetics_updated_at_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("synthetics_updated_at_idx")
                    .table(Synthetics::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(StatusPageSnapshots::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(StatusPageAuditLog::Table).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(StatusPageCheckSnoozes::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(StatusPageNoticeUpdates::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(StatusPageNoticeComponents::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(StatusPageNotices::Table).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(StatusPageComponentChecks::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(StatusPageComponents::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(StatusPages::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_pages_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPages::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPages::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(StatusPages::OrgId).string_len(100).not_null())
        .col(ColumnDef::new(StatusPages::Name).string_len(256).not_null())
        .col(ColumnDef::new(StatusPages::Slug).string_len(32).not_null())
        .col(ColumnDef::new(StatusPages::Description).text().null())
        // 0 draft, 1 public, 2 password.
        .col(
            ColumnDef::new(StatusPages::Visibility)
                .integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(StatusPages::PasswordHash).string_len(256).null())
        .col(
            ColumnDef::new(StatusPages::Noindex)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(StatusPages::ShowUptimePercent)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(StatusPages::ShowTimelineBars)
                .boolean()
                .not_null()
                .default(true),
        )
        // Perf fingerprinting is opt-in.
        .col(
            ColumnDef::new(StatusPages::ShowResponseTime)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(StatusPages::ConfirmFailures)
                .integer()
                .not_null()
                .default(2),
        )
        .col(
            ColumnDef::new(StatusPages::ConfirmRecovery)
                .integer()
                .not_null()
                .default(2),
        )
        .col(ColumnDef::new(StatusPages::ConfirmAfterSecs).integer().null())
        .col(ColumnDef::new(StatusPages::BrandName).string_len(256).null())
        .col(ColumnDef::new(StatusPages::AccentColor).string_len(7).null())
        // Base64-encoded image, same encoding as the org-level `custom_logo_img`
        // KV entry; unlike that one this is a per-page column. Enterprise-gated
        // on write only (see `apply_logo_field`).
        .col(ColumnDef::new(StatusPages::LogoImg).text().null())
        .col(ColumnDef::new(StatusPages::TrackingSince).big_integer().null())
        .col(ColumnDef::new(StatusPages::Owner).string_len(256).null())
        .col(ColumnDef::new(StatusPages::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(StatusPages::UpdatedAt).big_integer().not_null())
        .to_owned()
}

fn pages_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_pages_org_idx")
        .table(StatusPages::Table)
        .col(StatusPages::OrgId)
        .to_owned()
}

/// The slug is the public identifier; global uniqueness is what lets it
/// resolve without an org in the URL.
fn pages_slug_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_pages_slug_idx")
        .table(StatusPages::Table)
        .col(StatusPages::Slug)
        .unique()
        .to_owned()
}

fn create_components_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageComponents::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageComponents::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageComponents::StatusPageId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageComponents::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageComponents::Name)
                .string_len(256)
                .not_null(),
        )
        .col(ColumnDef::new(StatusPageComponents::Description).text().null())
        .col(
            ColumnDef::new(StatusPageComponents::SortOrder)
                .integer()
                .not_null()
                .default(0),
        )
        // One-time publish backfill; immutable; janitor-nulled once aged out.
        .col(ColumnDef::new(StatusPageComponents::BackfillDays).text().null())
        .col(
            ColumnDef::new(StatusPageComponents::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageComponents::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn components_page_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_components_page_idx")
        .table(StatusPageComponents::Table)
        .col(StatusPageComponents::StatusPageId)
        .to_owned()
}

fn create_component_checks_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageComponentChecks::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageComponentChecks::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageComponentChecks::ComponentId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageComponentChecks::SyntheticsId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageComponentChecks::OrgId)
                .string_len(100)
                .not_null(),
        )
        .to_owned()
}

fn component_checks_unique_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_component_checks_unique_idx")
        .table(StatusPageComponentChecks::Table)
        .col(StatusPageComponentChecks::ComponentId)
        .col(StatusPageComponentChecks::SyntheticsId)
        .unique()
        .to_owned()
}

fn component_checks_check_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_component_checks_check_idx")
        .table(StatusPageComponentChecks::Table)
        .col(StatusPageComponentChecks::SyntheticsId)
        .to_owned()
}

fn create_notices_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageNotices::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageNotices::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(StatusPageNotices::OrgId).string_len(100).not_null())
        // 0 incident, 1 maintenance, 2 info.
        .col(ColumnDef::new(StatusPageNotices::Kind).integer().not_null())
        // 0 none, 1 degraded, 2 partial_outage, 3 major_outage.
        .col(ColumnDef::new(StatusPageNotices::Impact).integer().not_null())
        // 0 auto, 1 manual.
        .col(ColumnDef::new(StatusPageNotices::Source).integer().not_null())
        .col(ColumnDef::new(StatusPageNotices::Title).string_len(512).not_null())
        .col(ColumnDef::new(StatusPageNotices::Body).text().not_null())
        // 0 scheduled, 1 active, 2 resolved.
        .col(ColumnDef::new(StatusPageNotices::State).integer().not_null())
        // Backdated to the first failing run of the confirming streak.
        .col(ColumnDef::new(StatusPageNotices::StartsAt).big_integer().not_null())
        .col(ColumnDef::new(StatusPageNotices::ResolvedAt).big_integer().null())
        // JSON [{from,to}] downtime intervals; merge-window re-opens append.
        .col(
            ColumnDef::new(StatusPageNotices::Segments)
                .text()
                .not_null()
                .default("[]"),
        )
        // False-positive mark: out of the math, tombstone stays in history.
        .col(
            ColumnDef::new(StatusPageNotices::ExcludedFromUptime)
                .boolean()
                .not_null()
                .default(false),
        )
        // Soft-delete only; there is deliberately no hard delete.
        .col(ColumnDef::new(StatusPageNotices::DeletedAt).big_integer().null())
        .col(ColumnDef::new(StatusPageNotices::AutoCheckId).string_len(27).null())
        .col(
            ColumnDef::new(StatusPageNotices::AutoRecoveryStreak)
                .integer()
                .not_null()
                .default(0),
        )
        .col(ColumnDef::new(StatusPageNotices::Owner).string_len(256).null())
        .col(ColumnDef::new(StatusPageNotices::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(StatusPageNotices::UpdatedAt).big_integer().not_null())
        .to_owned()
}

fn notices_org_state_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_notices_org_state_idx")
        .table(StatusPageNotices::Table)
        .col(StatusPageNotices::OrgId)
        .col(StatusPageNotices::State)
        .to_owned()
}

/// Non-unique: "one auto-incident per check outage" is enforced by the engine
/// (a partial unique index over open rows is not portable to SQLite).
fn notices_auto_check_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_notices_auto_check_idx")
        .table(StatusPageNotices::Table)
        .col(StatusPageNotices::AutoCheckId)
        .to_owned()
}

fn create_notice_components_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageNoticeComponents::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageNoticeComponents::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeComponents::NoticeId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeComponents::ComponentId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeComponents::OrgId)
                .string_len(100)
                .not_null(),
        )
        .to_owned()
}

fn notice_components_notice_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_notice_components_notice_idx")
        .table(StatusPageNoticeComponents::Table)
        .col(StatusPageNoticeComponents::NoticeId)
        .to_owned()
}

fn notice_components_component_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_notice_components_component_idx")
        .table(StatusPageNoticeComponents::Table)
        .col(StatusPageNoticeComponents::ComponentId)
        .to_owned()
}

fn create_notice_updates_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageNoticeUpdates::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageNoticeUpdates::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeUpdates::NoticeId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeUpdates::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeUpdates::Body)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeUpdates::Owner)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(StatusPageNoticeUpdates::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn notice_updates_notice_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_notice_updates_notice_idx")
        .table(StatusPageNoticeUpdates::Table)
        .col(StatusPageNoticeUpdates::NoticeId)
        .to_owned()
}

/// Org-wide per-check snooze: silencing a 3am false positive must silence it
/// on every page, not one.
fn create_check_snoozes_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageCheckSnoozes::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageCheckSnoozes::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageCheckSnoozes::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageCheckSnoozes::SyntheticsId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageCheckSnoozes::SnoozedUntil)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageCheckSnoozes::Owner)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(StatusPageCheckSnoozes::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn check_snoozes_check_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_check_snoozes_check_idx")
        .table(StatusPageCheckSnoozes::Table)
        .col(StatusPageCheckSnoozes::SyntheticsId)
        .unique()
        .to_owned()
}

/// Append-only ledger of uptime-affecting mutations. No delete endpoint; the
/// janitor prunes past the stated retention (2 years).
fn create_audit_log_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageAuditLog::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageAuditLog::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageAuditLog::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageAuditLog::NoticeId)
                .string_len(27)
                .null(),
        )
        .col(
            ColumnDef::new(StatusPageAuditLog::Action)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageAuditLog::Actor)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageAuditLog::At)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(StatusPageAuditLog::Detail).text().null())
        .to_owned()
}

fn audit_log_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("status_page_audit_log_org_idx")
        .table(StatusPageAuditLog::Table)
        .col(StatusPageAuditLog::OrgId)
        .to_owned()
}

/// Region-local derived data; hot/cold split so a status flip never rewrites
/// the TOASTed history column.
fn create_snapshots_stmt() -> TableCreateStatement {
    Table::create()
        .table(StatusPageSnapshots::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(StatusPageSnapshots::StatusPageId)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(StatusPageSnapshots::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageSnapshots::History)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageSnapshots::Current)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageSnapshots::HistoryGeneratedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(StatusPageSnapshots::CurrentGeneratedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// The rebuilder's delta-read watermark over the EXISTING synthetics table.
/// Meaningful only because `update_last_check_status` and
/// `update_alert_state_if` now bump `updated_at` on genuine state changes.
fn synthetics_updated_at_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("synthetics_updated_at_idx")
        .table(Synthetics::Table)
        .col(Synthetics::UpdatedAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum StatusPages {
    Table,
    Id,
    OrgId,
    Name,
    Slug,
    Description,
    Visibility,
    PasswordHash,
    Noindex,
    ShowUptimePercent,
    ShowTimelineBars,
    ShowResponseTime,
    ConfirmFailures,
    ConfirmRecovery,
    ConfirmAfterSecs,
    BrandName,
    AccentColor,
    LogoImg,
    TrackingSince,
    Owner,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageComponents {
    Table,
    Id,
    StatusPageId,
    OrgId,
    Name,
    Description,
    SortOrder,
    BackfillDays,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageComponentChecks {
    Table,
    Id,
    ComponentId,
    SyntheticsId,
    OrgId,
}

#[derive(DeriveIden)]
enum StatusPageNotices {
    Table,
    Id,
    OrgId,
    Kind,
    Impact,
    Source,
    Title,
    Body,
    State,
    StartsAt,
    ResolvedAt,
    Segments,
    ExcludedFromUptime,
    DeletedAt,
    AutoCheckId,
    AutoRecoveryStreak,
    Owner,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum StatusPageNoticeComponents {
    Table,
    Id,
    NoticeId,
    ComponentId,
    OrgId,
}

#[derive(DeriveIden)]
enum StatusPageNoticeUpdates {
    Table,
    Id,
    NoticeId,
    OrgId,
    Body,
    Owner,
    CreatedAt,
}

#[derive(DeriveIden)]
enum StatusPageCheckSnoozes {
    Table,
    Id,
    OrgId,
    SyntheticsId,
    SnoozedUntil,
    Owner,
    CreatedAt,
}

#[derive(DeriveIden)]
enum StatusPageAuditLog {
    Table,
    Id,
    OrgId,
    NoticeId,
    Action,
    Actor,
    At,
    Detail,
}

#[derive(DeriveIden)]
enum StatusPageSnapshots {
    Table,
    StatusPageId,
    OrgId,
    History,
    Current,
    HistoryGeneratedAt,
    CurrentGeneratedAt,
}

#[derive(DeriveIden)]
enum Synthetics {
    Table,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_table_builds_on_both_backends() {
        for stmt in [
            create_pages_stmt(),
            create_components_stmt(),
            create_component_checks_stmt(),
            create_notices_stmt(),
            create_notice_components_stmt(),
            create_notice_updates_stmt(),
            create_check_snoozes_stmt(),
            create_audit_log_stmt(),
            create_snapshots_stmt(),
        ] {
            for sql in [
                stmt.to_string(PostgresQueryBuilder),
                stmt.to_string(SqliteQueryBuilder),
            ] {
                assert!(sql.starts_with("CREATE TABLE IF NOT EXISTS"), "{sql}");
            }
        }
    }

    #[test]
    fn every_index_is_idempotent() {
        for idx in [
            pages_org_idx(),
            pages_slug_idx(),
            components_page_idx(),
            component_checks_unique_idx(),
            component_checks_check_idx(),
            notices_org_state_idx(),
            notices_auto_check_idx(),
            notice_components_notice_idx(),
            notice_components_component_idx(),
            notice_updates_notice_idx(),
            check_snoozes_check_idx(),
            audit_log_org_idx(),
            synthetics_updated_at_idx(),
        ] {
            let sql = idx.to_string(PostgresQueryBuilder);
            assert!(sql.contains("IF NOT EXISTS"), "{sql}");
        }
    }

    /// The public identifier's load-bearing property: globally unique, so it
    /// resolves with no org in the URL.
    #[test]
    fn the_slug_index_is_unique() {
        let sql = pages_slug_idx().to_string(PostgresQueryBuilder);
        assert!(sql.contains("UNIQUE"), "{sql}");
    }

    /// Org-scoped notices: the table must NOT carry a page column — pages
    /// derive through the component join, which is what makes one outage one
    /// notice everywhere.
    #[test]
    fn notices_are_org_scoped_not_page_scoped() {
        let sql = create_notices_stmt().to_string(PostgresQueryBuilder);
        assert!(!sql.contains("status_page_id"), "{sql}");
        assert!(sql.contains("\"org_id\""), "{sql}");
    }
}
