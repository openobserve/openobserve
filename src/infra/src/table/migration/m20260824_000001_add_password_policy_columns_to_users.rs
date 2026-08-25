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

//! Per-user state for the configurable authentication policies.
//!
//! `password_updated_at` is backfilled from `created_at` rather than left NULL: the rotation
//! check reads it as "when this password was set", so a NULL-everywhere column would mark every
//! pre-existing user as already expired the first time `ZO_PASSWORD_ROTATION_DAYS` is turned on.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Two SQLite constraints shared with every other alter in this directory: ONE alter
        // option per statement, and an explicit `has_column` guard because
        // `add_column_if_not_exists` is not idempotent on SQLite.
        add_column(manager, Users::MustResetPassword, |c| {
            c.boolean().not_null().default(false)
        })
        .await?;
        add_column(manager, Users::PasswordResetReason, |c| {
            c.string_len(32).null()
        })
        .await?;
        add_column(manager, Users::FlaggedAt, |c| c.big_integer().null()).await?;
        add_column(manager, Users::PasswordUpdatedAt, |c| {
            c.big_integer().null()
        })
        .await?;

        manager.exec_stmt(backfill_password_updated_at()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for col in [
            Users::PasswordUpdatedAt,
            Users::FlaggedAt,
            Users::PasswordResetReason,
            Users::MustResetPassword,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Users::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

const USERS: &str = "users";

#[derive(DeriveIden, Clone, Copy)]
enum Users {
    Table,
    CreatedAt,
    MustResetPassword,
    PasswordResetReason,
    FlaggedAt,
    PasswordUpdatedAt,
}

fn backfill_password_updated_at() -> UpdateStatement {
    Query::update()
        .table(Users::Table)
        .value(Users::PasswordUpdatedAt, Expr::col(Users::CreatedAt))
        .and_where(Expr::col(Users::PasswordUpdatedAt).is_null())
        .to_owned()
}

/// Add one column, skipping it if already present.
async fn add_column<F>(manager: &SchemaManager<'_>, column: Users, def: F) -> Result<(), DbErr>
where
    F: FnOnce(&mut ColumnDef) -> &mut ColumnDef,
{
    let name = column.into_iden().to_string();
    if manager.has_column(USERS, &name).await? {
        return Ok(());
    }
    let mut col = ColumnDef::new(column);
    let col = def(&mut col).to_owned();
    manager
        .alter_table(
            Table::alter()
                .table(Users::Table)
                .add_column(col)
                .to_owned(),
        )
        .await
}

#[cfg(test)]
mod tests {
    use sea_query::SqliteQueryBuilder;

    use super::*;

    #[test]
    fn test_backfill_only_touches_null_rows() {
        let sql = backfill_password_updated_at().to_string(SqliteQueryBuilder);
        assert!(sql.contains("\"password_updated_at\" = \"created_at\""));
        assert!(sql.contains("\"password_updated_at\" IS NULL"));
    }
}
