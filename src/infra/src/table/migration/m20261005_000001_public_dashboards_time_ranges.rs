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

//! A public link's time ranges become a list of relative and absolute ranges, and snapshots are
//! keyed by range key instead of preset seconds.

use sea_orm::{ConnectionTrait, FromQueryResult};
use sea_orm_migration::prelude::*;
use serde_json::json;

const LINKS: &str = "public_dashboards";
const SNAPSHOTS: &str = "public_dashboard_snapshots";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Snapshots are rebuilt by the scheduler, so the table is recreated rather than converted.
        if manager.has_column(SNAPSHOTS, "preset_secs").await? {
            manager.drop_table(drop_snapshots_stmt()).await?;
        }
        manager.create_table(create_snapshots_stmt()).await?;

        if !manager.has_column(LINKS, "time_ranges").await? {
            manager.alter_table(add_time_ranges_stmt()).await?;
            manager.alter_table(add_default_key_stmt()).await?;
        }
        if manager.has_column(LINKS, "allowed_presets_secs").await? {
            backfill(manager).await?;
            // SQLite takes one ALTER option per statement.
            for col in [
                PublicDashboards::TimeRangeEditable,
                PublicDashboards::DefaultRangeSecs,
                PublicDashboards::AllowedPresetsSecs,
            ] {
                manager.alter_table(drop_column_stmt(col)).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // An absolute range has no preset-seconds form to go back to.
        Ok(())
    }
}

#[derive(FromQueryResult)]
struct OldRow {
    id: String,
    default_range_secs: Option<i64>,
    allowed_presets_secs: Option<String>,
}

/// Turn each link's preset seconds into relative ranges and its default into a range key.
async fn backfill(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    let db = manager.get_connection();
    let backend = db.get_database_backend();
    let select = Query::select()
        .columns([
            PublicDashboards::Id,
            PublicDashboards::DefaultRangeSecs,
            PublicDashboards::AllowedPresetsSecs,
        ])
        .from(PublicDashboards::Table)
        .to_owned();
    let rows = OldRow::find_by_statement(backend.build(&select))
        .all(db)
        .await?;
    for row in rows {
        let (ranges, default_key) =
            converted(row.allowed_presets_secs.as_deref(), row.default_range_secs);
        let update = Query::update()
            .table(PublicDashboards::Table)
            .value(PublicDashboards::TimeRanges, ranges)
            .value(PublicDashboards::DefaultRangeKey, default_key)
            .and_where(Expr::col(PublicDashboards::Id).eq(row.id))
            .to_owned();
        db.execute(backend.build(&update)).await?;
    }
    Ok(())
}

/// The new `time_ranges` JSON and `default_range_key` for one link's old preset columns.
fn converted(allowed: Option<&str>, default: Option<i64>) -> (String, String) {
    let mut secs: Vec<i64> = allowed
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    secs.extend(default);
    secs.sort_unstable();
    secs.dedup();
    if secs.is_empty() {
        secs.push(3600);
    }
    let default = default.unwrap_or(secs[0]);
    let ranges: Vec<_> = secs
        .iter()
        .map(|s| json!({ "type": "relative", "secs": s }))
        .collect();
    (
        serde_json::Value::Array(ranges).to_string(),
        format!("r{default}"),
    )
}

fn drop_snapshots_stmt() -> TableDropStatement {
    Table::drop()
        .table(PublicDashboardSnapshots::Table)
        .to_owned()
}

/// One materialized row per (public link, range key); the anonymous plane point-reads `data`.
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
            ColumnDef::new(PublicDashboardSnapshots::RangeKey)
                .string_len(64)
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
                .col(PublicDashboardSnapshots::RangeKey),
        )
        .to_owned()
}

fn add_time_ranges_stmt() -> TableAlterStatement {
    Table::alter()
        .table(PublicDashboards::Table)
        .add_column(ColumnDef::new(PublicDashboards::TimeRanges).text().null())
        .to_owned()
}

fn add_default_key_stmt() -> TableAlterStatement {
    Table::alter()
        .table(PublicDashboards::Table)
        .add_column(
            ColumnDef::new(PublicDashboards::DefaultRangeKey)
                .string_len(64)
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt(col: PublicDashboards) -> TableAlterStatement {
    Table::alter()
        .table(PublicDashboards::Table)
        .drop_column(col)
        .to_owned()
}

#[derive(DeriveIden, Clone, Copy)]
enum PublicDashboards {
    Table,
    Id,
    TimeRangeEditable,
    DefaultRangeSecs,
    AllowedPresetsSecs,
    TimeRanges,
    DefaultRangeKey,
}

#[derive(DeriveIden)]
enum PublicDashboardSnapshots {
    Table,
    PublicDashboardId,
    RangeKey,
    Data,
    BuiltAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_presets_and_keeps_the_default() {
        let (ranges, key) = converted(Some("[86400,3600]"), Some(86400));
        assert_eq!(
            ranges,
            r#"[{"type":"relative","secs":3600},{"type":"relative","secs":86400}]"#
        );
        assert_eq!(key, "r86400");
    }

    #[test]
    fn a_link_with_no_presets_gets_its_default_or_one_hour() {
        assert_eq!(converted(None, Some(900)).1, "r900");
        assert_eq!(
            converted(None, None),
            (
                r#"[{"type":"relative","secs":3600}]"#.to_string(),
                "r3600".to_string()
            )
        );
    }

    /// The statements are only half the migration; this runs it on the old shape.
    #[tokio::test]
    async fn up_converts_links_and_rekeys_snapshots() {
        use sea_orm::{Database, Statement};
        use sea_orm_migration::SchemaManager;

        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE public_dashboards (id varchar(27) NOT NULL PRIMARY KEY, \
             time_range_editable boolean NOT NULL DEFAULT false, default_range_secs bigint NULL, \
             allowed_presets_secs text NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO public_dashboards VALUES ('l1', true, 3600, '[3600,86400]')",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "CREATE TABLE public_dashboard_snapshots (public_dashboard_id varchar(27) NOT NULL, \
             preset_secs bigint NOT NULL, data text NOT NULL, built_at bigint NOT NULL, \
             PRIMARY KEY (public_dashboard_id, preset_secs))",
        )
        .await
        .unwrap();

        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let manager = SchemaManager::new(&db);
        assert!(
            !manager
                .has_column(LINKS, "allowed_presets_secs")
                .await
                .unwrap()
        );
        assert!(manager.has_column(SNAPSHOTS, "range_key").await.unwrap());
        let row = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT time_ranges, default_range_key FROM public_dashboards",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.try_get::<String>("", "time_ranges").unwrap(),
            r#"[{"type":"relative","secs":3600},{"type":"relative","secs":86400}]"#
        );
        assert_eq!(
            row.try_get::<String>("", "default_range_key").unwrap(),
            "r3600"
        );

        // A second run is a no-op.
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
    }
}
