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

//! Adds what super-cluster replication of `org_ai_toolsets` needs: the "this region only" switch,
//! the region a row's last write came from, and 30-day delete tombstones.

use sea_orm_migration::prelude::*;

const TABLE: &str = "org_ai_toolsets";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS on columns, so a retry must skip a column already added.
        for (column, statement) in add_column_statements() {
            if !manager.has_column(TABLE, column).await? {
                manager.alter_table(statement).await?;
            }
        }
        manager.create_table(create_tombstones_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AiToolsetTombstones::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        for column in [OrgAiToolsets::RegionOnly, OrgAiToolsets::OriginRegion] {
            if manager.has_column(TABLE, &column.to_string()).await? {
                let drop = Table::alter()
                    .table(OrgAiToolsets::Table)
                    .drop_column(column)
                    .to_owned();
                manager.alter_table(drop).await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum OrgAiToolsets {
    Table,
    RegionOnly,
    OriginRegion,
}

#[derive(DeriveIden)]
enum AiToolsetTombstones {
    Table,
    Org,
    Key,
    DeletedAt,
    Region,
}

fn add_column_statements() -> [(&'static str, TableAlterStatement); 2] {
    let alter = |column: ColumnDef| {
        Table::alter()
            .table(OrgAiToolsets::Table)
            .add_column(column)
            .to_owned()
    };
    [
        (
            "region_only",
            alter(
                ColumnDef::new(OrgAiToolsets::RegionOnly)
                    .boolean()
                    .not_null()
                    .default(false)
                    .to_owned(),
            ),
        ),
        (
            "origin_region",
            alter(
                ColumnDef::new(OrgAiToolsets::OriginRegion)
                    .string_len(256)
                    .null()
                    .to_owned(),
            ),
        ),
    ]
}

fn create_tombstones_statement() -> TableCreateStatement {
    Table::create()
        .table(AiToolsetTombstones::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AiToolsetTombstones::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiToolsetTombstones::Key)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AiToolsetTombstones::DeletedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(AiToolsetTombstones::Region)
                .string_len(256)
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AiToolsetTombstones::Org)
                .col(AiToolsetTombstones::Key),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_the_switch_and_region_and_creates_the_tombstones() {
        let [(_, switch), (_, region)] = add_column_statements();
        assert_eq!(
            switch.to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "org_ai_toolsets" ADD COLUMN "region_only" bool NOT NULL DEFAULT FALSE"#
        );
        assert_eq!(
            region.to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "org_ai_toolsets" ADD COLUMN "origin_region" varchar(256) NULL"#
        );
        let sql = create_tombstones_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains(r#"PRIMARY KEY ("org", "key")"#), "{sql}");
    }
}
