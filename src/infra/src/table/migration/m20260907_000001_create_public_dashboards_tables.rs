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

//! Public (unauthenticated) dashboards — both tables are NEW, so every
//! statement is idempotent for retry and none of the ALTER traps apply.
//!
//! Shape notes that are contracts, not preferences:
//! - `public_dashboards.slug` is the globally unique public identifier; that global uniqueness is
//!   what lets it resolve with no org in the URL.
//! - `public_dashboard_snapshots` holds one materialized row per (public dashboard, time-range
//!   preset). `data` is the serialized rendered result the anonymous plane point-reads — it never
//!   runs a query at view time.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_public_dashboards_stmt())
            .await?;
        manager.create_index(pubdash_slug_idx()).await?;
        manager.create_index(pubdash_org_dashboard_idx()).await?;
        manager.create_table(create_snapshots_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(PublicDashboardSnapshots::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(PublicDashboards::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_public_dashboards_stmt() -> TableCreateStatement {
    Table::create()
        .table(PublicDashboards::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(PublicDashboards::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(PublicDashboards::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboards::FolderId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboards::DashboardId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboards::Slug)
                .string_len(32)
                .not_null(),
        )
        // 0 draft, 1 public.
        .col(
            ColumnDef::new(PublicDashboards::Visibility)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(PublicDashboards::TimeRangeEditable)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(ColumnDef::new(PublicDashboards::DefaultRangeSecs).big_integer().null())
        // JSON array of allowed relative presets in seconds.
        .col(ColumnDef::new(PublicDashboards::AllowedPresetsSecs).text().null())
        // JSON map of variable name -> value captured at publish.
        .col(ColumnDef::new(PublicDashboards::FrozenVariables).text().null())
        .col(
            ColumnDef::new(PublicDashboards::RebuildSecs)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(PublicDashboards::LastRebuiltAt).big_integer().null())
        // 0 pending, 1 ok, 2 error.
        .col(
            ColumnDef::new(PublicDashboards::RebuildState)
                .integer()
                .not_null()
                .default(0),
        )
        // JSON list of referenced streams the publisher cannot read.
        .col(ColumnDef::new(PublicDashboards::UnauthorizedStreams).text().null())
        .col(
            ColumnDef::new(PublicDashboards::DashboardVersion)
                .integer()
                .not_null(),
        )
        // Publisher-of-record: the identity the rebuilder authorizes queries as.
        .col(
            ColumnDef::new(PublicDashboards::PublishedBy)
                .string_len(256)
                .not_null(),
        )
        // JSON list of streams served at the last rebuild.
        .col(ColumnDef::new(PublicDashboards::LastAuthorizedStreams).text().null())
        .col(
            ColumnDef::new(PublicDashboards::Enabled)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(ColumnDef::new(PublicDashboards::ExpiresAt).big_integer().null())
        .col(
            ColumnDef::new(PublicDashboards::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboards::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboards::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(ColumnDef::new(PublicDashboards::LastAccessedAt).big_integer().null())
        .col(
            ColumnDef::new(PublicDashboards::AccessCount)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

/// The slug is the public identifier; global uniqueness is what lets it
/// resolve without an org in the URL.
fn pubdash_slug_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("public_dashboards_slug_idx")
        .table(PublicDashboards::Table)
        .col(PublicDashboards::Slug)
        .unique()
        .to_owned()
}

fn pubdash_org_dashboard_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name("public_dashboards_org_dashboard_idx")
        .table(PublicDashboards::Table)
        .col(PublicDashboards::OrgId)
        .col(PublicDashboards::DashboardId)
        .to_owned()
}

/// One materialized row per (public dashboard, preset). The anonymous plane
/// point-reads `data` by the composite key and never touches the query engine.
fn create_snapshots_stmt() -> TableCreateStatement {
    Table::create()
        .table(PublicDashboardSnapshots::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(PublicDashboardSnapshots::PublicDashboardId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardSnapshots::PresetSecs)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardSnapshots::Data)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardSnapshots::BuiltAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(PublicDashboardSnapshots::PublicDashboardId)
                .col(PublicDashboardSnapshots::PresetSecs),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum PublicDashboards {
    Table,
    Id,
    OrgId,
    FolderId,
    DashboardId,
    Slug,
    Visibility,
    TimeRangeEditable,
    DefaultRangeSecs,
    AllowedPresetsSecs,
    FrozenVariables,
    RebuildSecs,
    LastRebuiltAt,
    RebuildState,
    UnauthorizedStreams,
    DashboardVersion,
    PublishedBy,
    LastAuthorizedStreams,
    Enabled,
    ExpiresAt,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
    LastAccessedAt,
    AccessCount,
}

#[derive(DeriveIden)]
enum PublicDashboardSnapshots {
    Table,
    PublicDashboardId,
    PresetSecs,
    Data,
    BuiltAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_table_builds_on_both_backends() {
        for stmt in [create_public_dashboards_stmt(), create_snapshots_stmt()] {
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
        for idx in [pubdash_slug_idx(), pubdash_org_dashboard_idx()] {
            let sql = idx.to_string(PostgresQueryBuilder);
            assert!(sql.contains("IF NOT EXISTS"), "{sql}");
        }
    }

    /// The public identifier's load-bearing property: globally unique, so it
    /// resolves with no org in the URL.
    #[test]
    fn the_slug_index_is_unique() {
        let sql = pubdash_slug_idx().to_string(PostgresQueryBuilder);
        assert!(sql.contains("UNIQUE"), "{sql}");
    }
}
