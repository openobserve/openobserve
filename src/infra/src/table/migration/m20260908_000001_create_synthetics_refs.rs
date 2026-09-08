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
        manager.create_table(refs_statement()).await?;
        manager.create_index(reverse_index_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SyntheticsRefs::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SyntheticsRefs {
    Table,
    ParentId,
    ChildId,
    OrgId,
    Occurrences,
}

#[derive(DeriveIden)]
enum Synthetics {
    Table,
    Id,
}

pub(super) fn refs_statement() -> TableCreateStatement {
    Table::create()
        .table(SyntheticsRefs::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsRefs::ParentId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRefs::ChildId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRefs::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsRefs::Occurrences)
                .integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(SyntheticsRefs::ParentId)
                .col(SyntheticsRefs::ChildId),
        )
        .foreign_key(
            ForeignKey::create()
                .from(SyntheticsRefs::Table, SyntheticsRefs::ParentId)
                .to(Synthetics::Table, Synthetics::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

pub(super) fn reverse_index_statement() -> IndexCreateStatement {
    Index::create()
        .name("idx_synthetics_refs_reverse")
        .table(SyntheticsRefs::Table)
        .col(SyntheticsRefs::OrgId)
        .col(SyntheticsRefs::ChildId)
        .if_not_exists()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &refs_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "synthetics_refs" ( "parent_id" varchar(256) NOT NULL, "child_id" varchar(256) NOT NULL, "org_id" varchar(100) NOT NULL, "occurrences" integer NOT NULL, PRIMARY KEY ("parent_id", "child_id"), FOREIGN KEY ("parent_id") REFERENCES "synthetics" ("id") ON DELETE CASCADE )"#
        );
    }

    #[test]
    fn the_migration_runs_and_runs_after_the_table_it_references() {
        use sea_orm_migration::MigratorTrait as _;

        const ME: &str = "m20260908_000001_create_synthetics_refs";
        const CREATE_TABLE: &str = "m20260707_000001_create_synthetics_monitors";

        let names: Vec<String> = crate::table::migration::Migrator::migrations()
            .into_iter()
            .map(|m| m.name().to_string())
            .collect();
        assert_eq!(names.iter().filter(|n| n.as_str() == ME).count(), 1);
        let create = names.iter().position(|n| n == CREATE_TABLE).unwrap();
        let me = names.iter().position(|n| n == ME).unwrap();
        assert!(me > create, "the FK target must exist first");
    }
}
