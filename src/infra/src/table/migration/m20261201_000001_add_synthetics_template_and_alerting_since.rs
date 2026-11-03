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

//! `template` (the check's override) and `alerting_since` (episode start) on synthetics.

use sea_orm_migration::prelude::*;

const TABLE: &str = "synthetics";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden, Clone)]
enum Synthetics {
    Table,
    Template,
    AlertingSince,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // The table is created from the entity on a fresh database, so each column is guarded.
        if !manager.has_column(TABLE, "template").await? {
            manager.alter_table(add_template_stmt()).await?;
        }
        if !manager.has_column(TABLE, "alerting_since").await? {
            manager.alter_table(add_alerting_since_stmt()).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (column, iden) in [
            ("template", Synthetics::Template),
            ("alerting_since", Synthetics::AlertingSince),
        ] {
            if manager.has_column(TABLE, column).await? {
                manager.alter_table(drop_stmt(iden)).await?;
            }
        }
        Ok(())
    }
}

fn add_template_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Synthetics::Table)
        .add_column(ColumnDef::new(Synthetics::Template).string_len(256).null())
        .to_owned()
}

/// Not null with a default, so a check that is alerting at upgrade keys its episode on 0.
fn add_alerting_since_stmt() -> TableAlterStatement {
    Table::alter()
        .table(Synthetics::Table)
        .add_column(
            ColumnDef::new(Synthetics::AlertingSince)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

fn drop_stmt(column: Synthetics) -> TableAlterStatement {
    Table::alter()
        .table(Synthetics::Table)
        .drop_column(column)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_template_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics" ADD COLUMN "template" varchar(256) NULL"#
        );
        collapsed_eq!(
            &add_alerting_since_stmt().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics" ADD COLUMN "alerting_since" bigint NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_template_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "synthetics" ADD COLUMN "template" varchar(256) NULL"#
        );
        collapsed_eq!(
            &add_alerting_since_stmt().to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "synthetics" ADD COLUMN "alerting_since" bigint NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn down_drops_each_column() {
        collapsed_eq!(
            &drop_stmt(Synthetics::AlertingSince).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "synthetics" DROP COLUMN "alerting_since""#
        );
    }
}
