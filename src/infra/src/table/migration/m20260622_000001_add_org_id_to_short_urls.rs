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
        // Add org_id column with a default of empty string so existing rows are
        // non-null. Existing short URLs without an org are effectively "legacy"
        // and will be accessible to any org (the service layer treats "" as a
        // wildcard for backwards compatibility).
        manager
            .alter_table(
                Table::alter()
                    .table(ShortUrls::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(ShortUrls::OrgId)
                            .string_len(256)
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ShortUrls::Table)
                    .drop_column(ShortUrls::OrgId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ShortUrls {
    Table,
    OrgId,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260622_000001_add_org_id_to_short_urls"
        );
    }
}
