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

//! Anomaly band settings: every column is nullable and NULL means today's behaviour.

use sea_orm_migration::prelude::*;

const TABLE: &str = "anomaly_detection_config";
const COLUMNS: [AnomalyConfig; 7] = [
    AnomalyConfig::BandWidth,
    AnomalyConfig::AlertDirection,
    AnomalyConfig::AlertWindowBuckets,
    AnomalyConfig::AlertWindowFirePct,
    AnomalyConfig::AlertWindowRecoverPct,
    AnomalyConfig::BandGrouping,
    AnomalyConfig::BandK,
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS {
            // add_column_if_not_exists renders IF NOT EXISTS, which MySQL rejects.
            if manager.has_column(TABLE, &column_name(&column)).await? {
                continue;
            }
            manager.alter_table(add_column_stmt(column)).await?;
        }
        Ok(())
    }

    /// Lossless: dropping the columns returns every config to the behaviour NULL already means.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for column in COLUMNS.into_iter().rev() {
            // Symmetric with up(): a down on a schema that never got the column must not error.
            if !manager.has_column(TABLE, &column_name(&column)).await? {
                continue;
            }
            manager.alter_table(drop_column_stmt(column)).await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone)]
enum AnomalyConfig {
    #[sea_orm(iden = "anomaly_detection_config")]
    Table,
    BandWidth,
    AlertDirection,
    AlertWindowBuckets,
    AlertWindowFirePct,
    AlertWindowRecoverPct,
    BandGrouping,
    BandK,
}

fn column_name(column: &AnomalyConfig) -> String {
    column.clone().into_iden().to_string()
}

/// One column per ALTER: SQLite panics on an ALTER carrying more than one option.
fn add_column_stmt(column: AnomalyConfig) -> TableAlterStatement {
    let mut def = ColumnDef::new(column.clone());
    match column {
        AnomalyConfig::AlertDirection | AnomalyConfig::BandGrouping => def.string_len(16),
        AnomalyConfig::AlertWindowBuckets => def.integer(),
        _ => def.double(),
    };
    Table::alter()
        .table(AnomalyConfig::Table)
        .add_column(def.null())
        .to_owned()
}

fn drop_column_stmt(column: AnomalyConfig) -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .drop_column(column)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    fn up_sql<B: SchemaBuilder + Default>() -> Vec<String> {
        COLUMNS
            .into_iter()
            .map(|column| add_column_stmt(column).to_string(B::default()))
            .collect()
    }

    fn down_sql<B: SchemaBuilder + Default>() -> Vec<String> {
        COLUMNS
            .into_iter()
            .rev()
            .map(|column| drop_column_stmt(column).to_string(B::default()))
            .collect()
    }

    #[test]
    fn postgres() {
        let sql = up_sql::<PostgresQueryBuilder>();
        collapsed_eq!(
            &sql[0],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "band_width" double precision NULL"#
        );
        collapsed_eq!(
            &sql[1],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_direction" varchar(16) NULL"#
        );
        collapsed_eq!(
            &sql[2],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_window_buckets" integer NULL"#
        );
        collapsed_eq!(
            &sql[3],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_window_fire_pct" double precision NULL"#
        );
        collapsed_eq!(
            &sql[4],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_window_recover_pct" double precision NULL"#
        );
        collapsed_eq!(
            &sql[5],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "band_grouping" varchar(16) NULL"#
        );
        collapsed_eq!(
            &sql[6],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "band_k" double precision NULL"#
        );
    }

    #[test]
    fn mysql() {
        let sql = up_sql::<MysqlQueryBuilder>();
        collapsed_eq!(
            &sql[0],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `band_width` double NULL"#
        );
        collapsed_eq!(
            &sql[1],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `alert_direction` varchar(16) NULL"#
        );
        collapsed_eq!(
            &sql[2],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `alert_window_buckets` int NULL"#
        );
        collapsed_eq!(
            &sql[3],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `alert_window_fire_pct` double NULL"#
        );
        collapsed_eq!(
            &sql[4],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `alert_window_recover_pct` double NULL"#
        );
        collapsed_eq!(
            &sql[5],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `band_grouping` varchar(16) NULL"#
        );
        collapsed_eq!(
            &sql[6],
            r#"ALTER TABLE `anomaly_detection_config` ADD COLUMN `band_k` double NULL"#
        );
    }

    #[test]
    fn sqlite() {
        let sql = up_sql::<SqliteQueryBuilder>();
        collapsed_eq!(
            &sql[0],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "band_width" double NULL"#
        );
        collapsed_eq!(
            &sql[1],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_direction" varchar(16) NULL"#
        );
        collapsed_eq!(
            &sql[2],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_window_buckets" integer NULL"#
        );
        collapsed_eq!(
            &sql[3],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_window_fire_pct" double NULL"#
        );
        collapsed_eq!(
            &sql[4],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "alert_window_recover_pct" double NULL"#
        );
        collapsed_eq!(
            &sql[5],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "band_grouping" varchar(16) NULL"#
        );
        collapsed_eq!(
            &sql[6],
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "band_k" double NULL"#
        );
    }

    #[test]
    fn postgres_down() {
        let sql = down_sql::<PostgresQueryBuilder>();
        collapsed_eq!(
            &sql[0],
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "band_k""#
        );
        collapsed_eq!(
            &sql[6],
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "band_width""#
        );
    }

    #[test]
    fn mysql_down() {
        let sql = down_sql::<MysqlQueryBuilder>();
        collapsed_eq!(
            &sql[0],
            r#"ALTER TABLE `anomaly_detection_config` DROP COLUMN `band_k`"#
        );
        collapsed_eq!(
            &sql[6],
            r#"ALTER TABLE `anomaly_detection_config` DROP COLUMN `band_width`"#
        );
    }

    #[test]
    fn sqlite_down() {
        let sql = down_sql::<SqliteQueryBuilder>();
        collapsed_eq!(
            &sql[0],
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "band_k""#
        );
        collapsed_eq!(
            &sql[6],
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "band_width""#
        );
    }

    /// up() and down() must name the same columns, or a rollback silently drops the wrong one.
    #[test]
    fn up_and_down_agree_on_the_columns() {
        let up = up_sql::<SqliteQueryBuilder>();
        let mut down = down_sql::<SqliteQueryBuilder>();
        down.reverse();
        assert_eq!(up.len(), down.len());
        for (column, (add, drop)) in COLUMNS.iter().zip(up.iter().zip(down.iter())) {
            let name = format!("\"{}\"", column_name(column));
            assert!(add.contains(&name), "{add}");
            assert!(drop.contains(&name), "{drop}");
            assert_eq!(drop.matches("DROP COLUMN").count(), 1);
        }
    }

    #[test]
    fn adds_exactly_one_column_per_statement() {
        for sql in up_sql::<SqliteQueryBuilder>() {
            assert_eq!(sql.matches("ADD COLUMN").count(), 1, "{sql}");
        }
    }

    /// The entity reads these names, so a renamed iden would leave a column nothing reads.
    #[test]
    fn column_names_match_the_entity() {
        let names: Vec<String> = COLUMNS.iter().map(column_name).collect();
        assert_eq!(
            names,
            [
                "band_width",
                "alert_direction",
                "alert_window_buckets",
                "alert_window_fire_pct",
                "alert_window_recover_pct",
                "band_grouping",
                "band_k",
            ]
        );
    }
}
