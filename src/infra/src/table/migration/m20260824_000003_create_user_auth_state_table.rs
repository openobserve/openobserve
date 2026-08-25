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

//! Failed-login counters and lockout windows, one row per native user.
//!
//! Keyed on `users.email`: the credential-checking functions only ever have the email in scope,
//! and a row is created lazily on the first failed attempt, so most users never have one.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_statement()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(UserAuthState::Table).to_owned())
            .await
    }
}

const USERS_FK: &str = "user_auth_state_users_fk";

#[derive(DeriveIden)]
enum UserAuthState {
    Table,
    Email,
    FailedAttempts,
    LockoutLevel,
    LockedUntil,
    LastFailedAt,
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Email,
}

fn create_table_statement() -> TableCreateStatement {
    Table::create()
        .table(UserAuthState::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(UserAuthState::Email)
                .string_len(100)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(UserAuthState::FailedAttempts)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(UserAuthState::LockoutLevel)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(UserAuthState::LockedUntil)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(UserAuthState::LastFailedAt)
                .big_integer()
                .null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name(USERS_FK)
                .from(UserAuthState::Table, UserAuthState::Email)
                .to(Users::Table, Users::Email)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_table_statement() {
        let sql = create_table_statement().to_string(SqliteQueryBuilder);
        assert!(sql.contains("user_auth_state"));
        assert!(sql.contains("\"failed_attempts\""));
        assert!(sql.contains("\"lockout_level\""));
        assert!(sql.to_uppercase().contains("ON DELETE CASCADE"));
    }
}
