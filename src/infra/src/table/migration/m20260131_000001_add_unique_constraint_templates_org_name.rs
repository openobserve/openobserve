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

const TEMPLATES_ORG_NAME_UNIQUE_IDX: &str = "templates_org_name_unique_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add unique constraint on (org, name) to prevent duplicate templates
        // This prevents race conditions in the ensure_prebuilt_template function
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(TEMPLATES_ORG_NAME_UNIQUE_IDX)
                    .table(Templates::Table)
                    .col(Templates::Org)
                    .col(Templates::Name)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(TEMPLATES_ORG_NAME_UNIQUE_IDX).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Templates {
    Table,
    Org,
    Name,
}
