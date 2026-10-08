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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES {
            manager.alter_table(add_column(table)).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES {
            manager
                .alter_table(
                    Table::alter()
                        .table(table)
                        .drop_column(IncidentTitleTemplate)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const TABLES: [Tables; 2] = [Tables::Alerts, Tables::AlertComposites];

#[derive(DeriveIden, Clone, Copy)]
enum Tables {
    Alerts,
    AlertComposites,
}

#[derive(DeriveIden)]
struct IncidentTitleTemplate;

#[cfg(test)]
pub(super) fn get_update_stmt_composites() -> TableAlterStatement {
    add_column(Tables::AlertComposites)
}

fn add_column(table: Tables) -> TableAlterStatement {
    Table::alter()
        .table(table)
        .add_column_if_not_exists(ColumnDef::new(IncidentTitleTemplate).text().null())
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &add_column(Tables::Alerts).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "incident_title_template" text NULL"#
        );
        collapsed_eq!(
            &add_column(Tables::AlertComposites).to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_composites" ADD COLUMN IF NOT EXISTS "incident_title_template" text NULL"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &add_column(Tables::Alerts).to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alerts" ADD COLUMN "incident_title_template" text NULL"#
        );
        collapsed_eq!(
            &add_column(Tables::AlertComposites).to_string(SqliteQueryBuilder),
            r#"ALTER TABLE "alert_composites" ADD COLUMN "incident_title_template" text NULL"#
        );
    }
}
