// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! `oncall_responses.requested_by`: who triggered a page by hand, re-checked at every send.

use sea_orm_migration::prelude::*;

const ONCALL_RESPONSES: &str = "oncall_responses";
const REQUESTED_BY: &str = "requested_by";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(ONCALL_RESPONSES, REQUESTED_BY).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new(ONCALL_RESPONSES))
                    .add_column(ColumnDef::new(Alias::new(REQUESTED_BY)).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(ONCALL_RESPONSES, REQUESTED_BY).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(Alias::new(ONCALL_RESPONSES))
                    .drop_column(Alias::new(REQUESTED_BY))
                    .to_owned(),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::testing::meta_store;

    #[test]
    fn postgres_statement_adds_a_nullable_text_column() {
        assert_eq!(
            Table::alter()
                .table(Alias::new(ONCALL_RESPONSES))
                .add_column(ColumnDef::new(Alias::new(REQUESTED_BY)).text().null())
                .to_owned()
                .to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "oncall_responses" ADD COLUMN "requested_by" text NULL"#
        );
    }

    #[tokio::test]
    async fn up_down_up_on_the_meta_store() {
        if !meta_store().await {
            return;
        }
        let manager = SchemaManager::new(crate::db::get_orm_client_ddl().await);
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(
            !manager
                .has_column(ONCALL_RESPONSES, REQUESTED_BY)
                .await
                .unwrap()
        );
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(
            manager
                .has_column(ONCALL_RESPONSES, REQUESTED_BY)
                .await
                .unwrap()
        );
    }
}
