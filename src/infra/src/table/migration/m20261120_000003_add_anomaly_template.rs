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

//! `template`: the anomaly config's template override by name; NULL uses the destination's.

use sea_orm_migration::prelude::*;

const TABLE: &str = "anomaly_detection_config";
const COLUMN: &str = "template";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum AnomalyConfig {
    #[sea_orm(iden = "anomaly_detection_config")]
    Table,
    Template,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(add_column_stmt()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager.alter_table(drop_column_stmt()).await?;
        Ok(())
    }
}

fn add_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .add_column(
            ColumnDef::new(AnomalyConfig::Template)
                .string_len(256)
                .null(),
        )
        .to_owned()
}

fn drop_column_stmt() -> TableAlterStatement {
    Table::alter()
        .table(AnomalyConfig::Table)
        .drop_column(AnomalyConfig::Template)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "template" varchar(256) NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" ADD COLUMN "template" varchar(256) NULL"#
        );
    }

    #[test]
    fn down_drops_the_same_column() {
        collapsed_eq!(
            &drop_column_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "anomaly_detection_config" DROP COLUMN "template""#
        );
        assert_eq!(COLUMN, AnomalyConfig::Template.into_iden().to_string());
    }
}
