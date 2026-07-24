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

//! Add nullable `token_id` to `synthetics_agents` — the probe token an agent
//! last authenticated with, stamped at register. Powers "N agents on this
//! token" so an operator can safely disable (revoke) a token only once no agent
//! is still using it, instead of a blind click. Nullable: agents registered
//! before this migration get it on their next register.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsAgents::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(SyntheticsAgents::TokenId).string().null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsAgents::Table)
                    .drop_column(SyntheticsAgents::TokenId)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SyntheticsAgents {
    Table,
    TokenId,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260724_000002_add_token_id_to_synthetics_agents"
        );
    }
}
