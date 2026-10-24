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

//! Public dashboard tables, replacing the draft migrations and resetting draft databases.

use sea_orm::{ConnectionTrait, DatabaseConnection};
use sea_orm_migration::prelude::*;

const LINKS: &str = "public_dashboards";
const SNAPSHOTS: &str = "public_dashboard_snapshots";
const SETTINGS: &str = "public_dashboard_org_settings";
const SLUG_IDX: &str = "public_dashboards_slug_idx";
const ORG_DASHBOARD_IDX: &str = "public_dashboards_org_dashboard_idx";
const DRAFT_MIGRATIONS: [&str; 6] = [
    "m20260907_000001_create_public_dashboards_tables",
    "m20260925_000001_add_name_to_public_dashboards",
    "m20260930_000001_add_updated_by_to_public_dashboards",
    "m20261005_000001_public_dashboards_time_ranges",
    // The two migrations below under their pre-merge dates; both bodies are idempotent.
    "m20261015_000001_create_public_dashboards",
    "m20261015_000002_add_search_type_to_search_queue",
];
const RETIRED_COLUMNS: [&str; 4] = [
    "last_rebuilt_at",
    "rebuild_state",
    "unauthorized_streams",
    "last_authorized_streams",
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_links_stmt()).await?;
        reset_draft_schema(manager).await?;
        // A re-run checks first, as the other migrations do, instead of relying on IF NOT EXISTS.
        for (name, idx) in [
            (SLUG_IDX, slug_idx()),
            (ORG_DASHBOARD_IDX, org_dashboard_idx()),
        ] {
            if !manager.has_index(LINKS, name).await? {
                manager.create_index(idx).await?;
            }
        }
        manager.create_table(create_org_settings_stmt()).await?;
        // A settings table left by the draft migrations predates the limit's setter column.
        if !manager.has_column(SETTINGS, "max_links_set_by").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(PublicDashboardOrgSettings::Table)
                        .add_column(max_links_set_by_col())
                        .to_owned(),
                )
                .await?;
        }
        manager.create_table(create_outbox_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            PublicDashboardOutbox::Table.into_iden(),
            PublicDashboardOrgSettings::Table.into_iden(),
            PublicDashboards::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

/// Drops the draft migrations from the history, which `Migrator::up` refuses to run with.
pub(crate) async fn forget_draft_migrations(db: &DatabaseConnection) -> Result<(), DbErr> {
    if !SchemaManager::new(db).has_table("seaql_migrations").await? {
        return Ok(());
    }
    let stmt = Query::delete()
        .from_table(Alias::new("seaql_migrations"))
        .and_where(Expr::col(Alias::new("version")).is_in(DRAFT_MIGRATIONS))
        .to_owned();
    db.execute(db.get_database_backend().build(&stmt)).await?;
    Ok(())
}

/// Brings a table built by the draft migrations to the current shape; a no-op on a new table.
async fn reset_draft_schema(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    if manager.has_table(SNAPSHOTS).await? {
        manager
            .drop_table(Table::drop().table(Alias::new(SNAPSHOTS)).to_owned())
            .await?;
    }
    // One statement per column: SQLite takes one ALTER option at a time, MySQL rejects IF EXISTS.
    for col in RETIRED_COLUMNS {
        if manager.has_column(LINKS, col).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(PublicDashboards::Table)
                        .drop_column(Alias::new(col))
                        .to_owned(),
                )
                .await?;
        }
    }
    if manager.has_column(LINKS, "rebuild_secs").await? {
        manager
            .alter_table(
                Table::alter()
                    .table(PublicDashboards::Table)
                    .rename_column(Alias::new("rebuild_secs"), PublicDashboards::RefreshSecs)
                    .to_owned(),
            )
            .await?;
    }
    if !manager.has_column(LINKS, "rev").await? {
        manager.alter_table(add_column(rev_col())).await?;
    }
    if !manager.has_column(LINKS, "deleted_at").await? {
        manager.alter_table(add_column(deleted_at_col())).await?;
    }
    Ok(())
}

fn add_column(col: ColumnDef) -> TableAlterStatement {
    Table::alter()
        .table(PublicDashboards::Table)
        .add_column(col)
        .to_owned()
}

fn max_links_set_by_col() -> ColumnDef {
    ColumnDef::new(PublicDashboardOrgSettings::MaxLinksSetBy)
        .string_len(256)
        .null()
        .to_owned()
}

fn rev_col() -> ColumnDef {
    ColumnDef::new(PublicDashboards::Rev)
        .big_integer()
        .not_null()
        .default(0)
        .to_owned()
}

fn deleted_at_col() -> ColumnDef {
    ColumnDef::new(PublicDashboards::DeletedAt)
        .big_integer()
        .null()
        .to_owned()
}

fn create_links_stmt() -> TableCreateStatement {
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
        .col(
            ColumnDef::new(PublicDashboards::Name)
                .string_len(256)
                .not_null()
                .default(""),
        )
        // 0 draft, 1 public.
        .col(
            ColumnDef::new(PublicDashboards::Visibility)
                .integer()
                .not_null()
                .default(0),
        )
        // JSON list of relative and absolute ranges.
        .col(ColumnDef::new(PublicDashboards::TimeRanges).text().null())
        .col(
            ColumnDef::new(PublicDashboards::DefaultRangeKey)
                .string_len(64)
                .null(),
        )
        // JSON map of variable key to the value captured at publish.
        .col(ColumnDef::new(PublicDashboards::FrozenVariables).text().null())
        .col(
            ColumnDef::new(PublicDashboards::RefreshSecs)
                .integer()
                .not_null()
                .default(300),
        )
        .col(
            ColumnDef::new(PublicDashboards::DashboardVersion)
                .integer()
                .not_null(),
        )
        // The identity whose stream access the built queries are checked against.
        .col(
            ColumnDef::new(PublicDashboards::PublishedBy)
                .string_len(256)
                .not_null(),
        )
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
            ColumnDef::new(PublicDashboards::UpdatedBy)
                .string_len(256)
                .null(),
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
        .col(rev_col())
        .col(deleted_at_col())
        .col(ColumnDef::new(PublicDashboards::LastAccessedAt).big_integer().null())
        .col(
            ColumnDef::new(PublicDashboards::AccessCount)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

/// Global uniqueness is what lets the slug resolve without an org in the URL.
fn slug_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SLUG_IDX)
        .table(PublicDashboards::Table)
        .col(PublicDashboards::Slug)
        .unique()
        .to_owned()
}

fn org_dashboard_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ORG_DASHBOARD_IDX)
        .table(PublicDashboards::Table)
        .col(PublicDashboards::OrgId)
        .col(PublicDashboards::DashboardId)
        .to_owned()
}

fn create_org_settings_stmt() -> TableCreateStatement {
    Table::create()
        .table(PublicDashboardOrgSettings::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(PublicDashboardOrgSettings::OrgId)
                .string_len(100)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(PublicDashboardOrgSettings::Rev)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardOrgSettings::Enabled)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(
            ColumnDef::new(PublicDashboardOrgSettings::MaxLinks)
                .integer()
                .null(),
        )
        .col(max_links_set_by_col())
        .col(
            ColumnDef::new(PublicDashboardOrgSettings::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardOrgSettings::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .to_owned()
}

fn create_outbox_stmt() -> TableCreateStatement {
    Table::create()
        .table(PublicDashboardOutbox::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(PublicDashboardOutbox::LinkId)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(PublicDashboardOutbox::Rev)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardOutbox::Attempts)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(PublicDashboardOutbox::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(PublicDashboardOutbox::UpdatedAt)
                .big_integer()
                .not_null(),
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
    Name,
    Visibility,
    TimeRanges,
    DefaultRangeKey,
    FrozenVariables,
    RefreshSecs,
    DashboardVersion,
    PublishedBy,
    Enabled,
    ExpiresAt,
    CreatedBy,
    UpdatedBy,
    CreatedAt,
    UpdatedAt,
    Rev,
    DeletedAt,
    LastAccessedAt,
    AccessCount,
}

#[derive(DeriveIden)]
enum PublicDashboardOrgSettings {
    Table,
    OrgId,
    Rev,
    Enabled,
    MaxLinks,
    MaxLinksSetBy,
    UpdatedAt,
    UpdatedBy,
}

#[derive(DeriveIden)]
enum PublicDashboardOutbox {
    Table,
    LinkId,
    Rev,
    Attempts,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, Statement};

    use super::*;
    use crate::table::migration::Migrator;

    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                db.get_database_backend(),
                format!("SELECT name FROM pragma_table_info('{table}') ORDER BY cid"),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    #[test]
    fn every_statement_is_idempotent_on_both_backends() {
        for stmt in [
            create_links_stmt(),
            create_org_settings_stmt(),
            create_outbox_stmt(),
        ] {
            for sql in [
                stmt.to_string(PostgresQueryBuilder),
                stmt.to_string(SqliteQueryBuilder),
            ] {
                assert!(sql.starts_with("CREATE TABLE IF NOT EXISTS"), "{sql}");
            }
        }
        for idx in [slug_idx(), org_dashboard_idx()] {
            let sql = idx.to_string(PostgresQueryBuilder);
            assert!(sql.contains("IF NOT EXISTS"), "{sql}");
        }
        assert!(
            slug_idx()
                .to_string(PostgresQueryBuilder)
                .contains("UNIQUE")
        );
    }

    #[tokio::test]
    async fn up_creates_the_v2_schema_and_runs_twice() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        let links = columns(&db, LINKS).await;
        for col in [
            "refresh_secs",
            "rev",
            "deleted_at",
            "access_count",
            "name",
            "updated_by",
        ] {
            assert!(links.iter().any(|c| c == col), "{col} missing: {links:?}");
        }
        assert!(!links.iter().any(|c| c == "rebuild_secs"), "{links:?}");
        assert!(
            manager
                .has_table("public_dashboard_org_settings")
                .await
                .unwrap()
        );
        assert!(
            columns(&db, "public_dashboard_org_settings")
                .await
                .iter()
                .any(|c| c == "max_links_set_by")
        );
        assert!(manager.has_table("public_dashboard_outbox").await.unwrap());
        assert!(!manager.has_table(SNAPSHOTS).await.unwrap());
        for idx in [SLUG_IDX, ORG_DASHBOARD_IDX] {
            assert!(manager.has_index(LINKS, idx).await.unwrap(), "{idx}");
        }
    }

    /// A database that ran the four draft migrations keeps its links and loses only their results.
    #[tokio::test]
    async fn up_adds_the_limit_setter_to_a_draft_settings_table() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE public_dashboard_org_settings (org_id varchar(100) NOT NULL PRIMARY KEY, \
             rev bigint NOT NULL, enabled boolean NOT NULL DEFAULT true, max_links integer NULL, \
             updated_at bigint NOT NULL, updated_by varchar(256) NOT NULL)",
            "INSERT INTO public_dashboard_org_settings VALUES ('o', 3, true, 5, 1, 'a@b.c')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }

        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        assert!(
            columns(&db, SETTINGS)
                .await
                .iter()
                .any(|c| c == "max_links_set_by")
        );
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT max_links, max_links_set_by FROM public_dashboard_org_settings",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "max_links").unwrap(), 5);
        assert_eq!(
            row.try_get::<Option<String>>("", "max_links_set_by")
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn up_resets_a_database_built_by_the_draft_migrations() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE public_dashboards (id varchar(27) NOT NULL PRIMARY KEY, \
             org_id varchar(100) NOT NULL, folder_id varchar(100) NOT NULL, \
             dashboard_id varchar(100) NOT NULL, slug varchar(32) NOT NULL, \
             visibility integer NOT NULL DEFAULT 0, frozen_variables text NULL, \
             rebuild_secs integer NOT NULL, last_rebuilt_at bigint NULL, \
             rebuild_state integer NOT NULL DEFAULT 0, unauthorized_streams text NULL, \
             dashboard_version integer NOT NULL, published_by varchar(256) NOT NULL, \
             last_authorized_streams text NULL, enabled boolean NOT NULL DEFAULT true, \
             expires_at bigint NULL, created_by varchar(256) NOT NULL, \
             created_at bigint NOT NULL, updated_at bigint NOT NULL, \
             last_accessed_at bigint NULL, access_count bigint NOT NULL DEFAULT 0, \
             name varchar(256) NOT NULL DEFAULT '', updated_by varchar(256) NULL, \
             time_ranges text NULL, default_range_key varchar(64) NULL)",
            "CREATE UNIQUE INDEX public_dashboards_slug_idx ON public_dashboards (slug)",
            "CREATE TABLE public_dashboard_snapshots (public_dashboard_id varchar(27) NOT NULL, \
             range_key varchar(64) NOT NULL, data text NOT NULL, built_at bigint NOT NULL, \
             PRIMARY KEY (public_dashboard_id, range_key))",
            "INSERT INTO public_dashboards (id, org_id, folder_id, dashboard_id, slug, \
             rebuild_secs, last_rebuilt_at, rebuild_state, dashboard_version, published_by, \
             created_by, created_at, updated_at, name, time_ranges, default_range_key) VALUES \
             ('l1', 'o', 'f', 'd', 's', 900, 5, 1, 8, 'p', 'p', 1, 2, 'wall', \
             '[{\"type\":\"relative\",\"secs\":3600}]', 'r3600')",
            "INSERT INTO public_dashboard_snapshots VALUES ('l1', 'r3600', '{}', 5)",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }

        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        assert!(!manager.has_table(SNAPSHOTS).await.unwrap());
        let links = columns(&db, LINKS).await;
        for col in RETIRED_COLUMNS.iter().chain(&["rebuild_secs"]) {
            assert!(!links.iter().any(|c| c == col), "{col} kept: {links:?}");
        }
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT name, refresh_secs, rev, deleted_at, time_ranges FROM public_dashboards",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<String>("", "name").unwrap(), "wall");
        assert_eq!(row.try_get::<i32>("", "refresh_secs").unwrap(), 900);
        assert_eq!(row.try_get::<i64>("", "rev").unwrap(), 0);
        assert_eq!(row.try_get::<Option<i64>>("", "deleted_at").unwrap(), None);
        assert!(
            row.try_get::<String>("", "time_ranges")
                .unwrap()
                .contains("3600")
        );
        assert!(
            manager
                .has_table("public_dashboard_org_settings")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn forgetting_the_draft_migrations_lets_the_migrator_run() {
        for name in [
            "m20261015_000001_create_public_dashboards",
            "m20261015_000002_add_search_type_to_search_queue",
        ] {
            assert!(DRAFT_MIGRATIONS.contains(&name), "{name} is not forgotten");
        }
        let db = Database::connect("sqlite::memory:").await.unwrap();
        forget_draft_migrations(&db).await.unwrap();
        Migrator::install(&db).await.unwrap();
        for name in DRAFT_MIGRATIONS {
            db.execute_unprepared(&format!(
                "INSERT INTO seaql_migrations (version, applied_at) VALUES ('{name}', 1)"
            ))
            .await
            .unwrap();
        }
        let Err(err) = Migrator::get_pending_migrations(&db).await else {
            panic!("the migrator ran with draft migrations in its history");
        };
        assert!(err.to_string().contains("is missing"), "{err}");

        forget_draft_migrations(&db).await.unwrap();
        assert!(
            !Migrator::get_pending_migrations(&db)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            Migrator::get_applied_migrations(&db)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
