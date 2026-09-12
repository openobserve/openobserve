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

//! Past password hashes, for reuse prevention.
//!
//! Keyed on `users.email` rather than `users.id` because every password-set path already carries
//! the email and none of them carry the KSUID. The cascade only fires where the backend enforces
//! foreign keys (SQLite ships with `PRAGMA foreign_keys` off), so deletion is also done
//! explicitly at the application layer.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_table_statement()).await?;
        manager
            .create_index(create_email_created_at_index())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(EMAIL_CREATED_AT_IDX)
                    .table(UserPasswordHistory::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(UserPasswordHistory::Table).to_owned())
            .await
    }
}

const EMAIL_CREATED_AT_IDX: &str = "idx_user_password_history_email_created_at";
const USERS_FK: &str = "user_password_history_users_fk";

#[derive(DeriveIden)]
enum UserPasswordHistory {
    Table,
    Id,
    Email,
    PasswordHash,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Email,
}

fn create_table_statement() -> TableCreateStatement {
    Table::create()
        .table(UserPasswordHistory::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(UserPasswordHistory::Id)
                .big_integer()
                .auto_increment()
                .primary_key()
                .not_null(),
        )
        .col(
            ColumnDef::new(UserPasswordHistory::Email)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(UserPasswordHistory::PasswordHash)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(UserPasswordHistory::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name(USERS_FK)
                .from(UserPasswordHistory::Table, UserPasswordHistory::Email)
                .to(Users::Table, Users::Email)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

/// Covers both the `WHERE email = ?` prune and the `ORDER BY created_at DESC` reuse lookup, so no
/// separate single-column index on `email` is needed.
fn create_email_created_at_index() -> IndexCreateStatement {
    Index::create()
        .name(EMAIL_CREATED_AT_IDX)
        .table(UserPasswordHistory::Table)
        .col(UserPasswordHistory::Email)
        .col(UserPasswordHistory::CreatedAt)
        .to_owned()
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_create_table_statement() {
        let sql = create_table_statement().to_string(SqliteQueryBuilder);
        assert!(sql.contains("user_password_history"));
        assert!(sql.contains("\"password_hash\""));
        assert!(sql.to_uppercase().contains("ON DELETE CASCADE"));
    }

    #[test]
    fn test_create_email_created_at_index() {
        let sql = create_email_created_at_index().to_string(SqliteQueryBuilder);
        assert!(sql.contains(EMAIL_CREATED_AT_IDX));
        assert!(sql.contains("\"email\""));
        assert!(sql.contains("\"created_at\""));
    }
}
