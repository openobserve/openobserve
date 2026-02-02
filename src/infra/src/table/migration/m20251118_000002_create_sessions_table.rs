// Copyright 2025 OpenObserve Inc.
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

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_sessions_table_statement())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Sessions::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the sessions table.
fn create_sessions_table_statement() -> TableCreateStatement {
    let text_type = get_text_type();
    Table::create()
        .table(Sessions::Table)
        .if_not_exists()
        .col(
            // session_id is the primary key - enforces uniqueness without extra index
            ColumnDef::new(Sessions::SessionId)
                .string_len(36)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(Sessions::AccessToken)
                .custom(Alias::new(text_type))
                .not_null(),
        )
        .col(ColumnDef::new(Sessions::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(Sessions::UpdatedAt).big_integer().not_null())
        .to_owned()
}

/// Identifiers used in queries on the sessions table.
#[derive(DeriveIden)]
pub(super) enum Sessions {
    Table,
    SessionId,
    AccessToken,
    CreatedAt,
    UpdatedAt,
}
