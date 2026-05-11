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
        // Add source column (not null, default 'org')
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPricing::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(ModelPricing::Source)
                            .string_len(20)
                            .not_null()
                            .default("org"),
                    )
                    .to_owned(),
            )
            .await?;

        // Add provider column (nullable)
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPricing::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(ModelPricing::Provider)
                            .string_len(100)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Add description column (nullable)
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPricing::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(ModelPricing::Description)
                            .string_len(1024)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Backfill: set source = 'meta_org' for existing _meta org entries
        let db = manager.get_connection();
        db.execute_unprepared("UPDATE model_pricing SET source = 'meta_org' WHERE org = '_meta'")
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPricing::Table)
                    .drop_column(ModelPricing::Source)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPricing::Table)
                    .drop_column(ModelPricing::Provider)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(ModelPricing::Table)
                    .drop_column(ModelPricing::Description)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ModelPricing {
    Table,
    Source,
    Provider,
    Description,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260415_000002_add_source_to_model_pricing"
        );
    }
}
