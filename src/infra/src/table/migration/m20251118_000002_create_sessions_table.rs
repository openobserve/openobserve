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

const SESSION_ID_IDX: &str = "sessions_session_id_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_sessions_table_statement())
            .await?;
        manager
            .create_index(create_sessions_session_id_idx_stmnt())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(SESSION_ID_IDX).to_owned())
            .await?;
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
            // Auto-increment ID used only as primary key, not for business logic
            // Session lookups use session_id (UUID), not this ID
            ColumnDef::new(Sessions::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(Sessions::SessionId)
                .string_len(36)
                .not_null(),
        )
        .col(
            ColumnDef::new(Sessions::AccessToken)
                .custom(Alias::new(&text_type))
                .not_null(),
        )
        .col(ColumnDef::new(Sessions::CreatedAt).big_integer().not_null())
        .col(ColumnDef::new(Sessions::UpdatedAt).big_integer().not_null())
        .to_owned()
}

/// Statement to create unique index on session_id.
fn create_sessions_session_id_idx_stmnt() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(SESSION_ID_IDX)
        .table(Sessions::Table)
        .unique()
        .col(Sessions::SessionId)
        .to_owned()
}

/// Identifiers used in queries on the sessions table.
#[derive(DeriveIden)]
pub(super) enum Sessions {
    Table,
    Id,
    SessionId,
    AccessToken,
    CreatedAt,
    UpdatedAt,
}
