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
        // Add `image_preview` boolean column to `reports` (default false).
        manager
            .alter_table(
                Table::alter()
                    .table(Reports::Table)
                    .add_column(
                        ColumnDef::new(Reports::ImagePreview)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;

        // Add `report_type` small-integer column to `report_dashboards`
        // (0 = PDF, 1 = PNG; default 0).
        manager
            .alter_table(
                Table::alter()
                    .table(ReportDashboards::Table)
                    .add_column(
                        ColumnDef::new(ReportDashboards::ReportType)
                            .small_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        // Add `email_attachment_type` small-integer column to `report_dashboards`
        // (0 = Standard, 1 = Inline; default 0).
        manager
            .alter_table(
                Table::alter()
                    .table(ReportDashboards::Table)
                    .add_column(
                        ColumnDef::new(ReportDashboards::EmailAttachmentType)
                            .small_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        // Add `attachment_dimensions` nullable JSON column to `report_dashboards`.
        // NULL means "use the report server's configured defaults".
        manager
            .alter_table(
                Table::alter()
                    .table(ReportDashboards::Table)
                    .add_column(
                        ColumnDef::new(ReportDashboards::AttachmentDimensions)
                            .json()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ReportDashboards::Table)
                    .drop_column(ReportDashboards::AttachmentDimensions)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(ReportDashboards::Table)
                    .drop_column(ReportDashboards::EmailAttachmentType)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(ReportDashboards::Table)
                    .drop_column(ReportDashboards::ReportType)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Reports::Table)
                    .drop_column(Reports::ImagePreview)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum Reports {
    Table,
    ImagePreview,
}

#[derive(DeriveIden)]
enum ReportDashboards {
    Table,
    ReportType,
    EmailAttachmentType,
    AttachmentDimensions,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260402_000001_reports_add_image_fields"
        );
    }
}
