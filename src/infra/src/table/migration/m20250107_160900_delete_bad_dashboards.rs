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

//! Migration stub for m20250107_160900_delete_bad_dashboards.
//!
//! This migration was originally intended to remove dashboards with unparseable
//! JSON data, but was found to incorrectly delete valid dashboards with certain
//! label/legend position configurations. It has been disabled since dashboard
//! schema migrations are handled by the UI layer. The migration remains in the
//! sequence to maintain migration ordering consistency.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // This migration was disabled because it incorrectly deleted valid dashboards
        // that had label/legend position fields that didn't match the v1-v5 schema
        // definitions. Dashboard schema migrations are now handled by the UI layer.
        // See PR #9860 for details.
        // Do nothing
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // The deletion of the invalid dashboards cannot be reversed.
        Ok(())
    }
}
