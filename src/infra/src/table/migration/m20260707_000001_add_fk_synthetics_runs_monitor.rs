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

const FK_NAME: &str = "fk_synthetics_runs_synthetics_id";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Remove orphaned runs (monitor already deleted before this FK existed).
        manager
            .get_connection()
            .execute_unprepared(
                r#"DELETE FROM synthetics_runs
                   WHERE synthetics_id NOT IN (SELECT id FROM synthetics_monitors)"#,
            )
            .await?;

        manager
            .create_foreign_key(
                ForeignKey::create()
                    .name(FK_NAME)
                    .from(SyntheticsRuns::Table, SyntheticsRuns::SyntheticsId)
                    .to(SyntheticsMonitors::Table, SyntheticsMonitors::Id)
                    .on_delete(ForeignKeyAction::Cascade)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_foreign_key(
                ForeignKey::drop()
                    .name(FK_NAME)
                    .table(SyntheticsRuns::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SyntheticsRuns {
    Table,
    SyntheticsId,
}

#[derive(DeriveIden)]
enum SyntheticsMonitors {
    Table,
    Id,
}
