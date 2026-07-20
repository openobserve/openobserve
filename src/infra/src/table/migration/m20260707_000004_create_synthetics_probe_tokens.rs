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

//! Create `synthetics_probe_tokens` table and backfill one `o2syn_` token per
//! existing org. New orgs receive their token at creation time.

use config::utils::rand::generate_random_string;
use sea_orm::{EntityTrait, PaginatorTrait, QueryOrder, Set, TransactionTrait};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SYNTHETICS_PROBE_TOKEN_PREFIX: &str = "o2syn_";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── 1. Create table ───────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(SyntheticsProbeTokens::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::Token)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::CreatedBy)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SyntheticsProbeTokens::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .table(SyntheticsProbeTokens::Table)
                    .name("idx_synthetics_probe_tokens_org_id")
                    .col(SyntheticsProbeTokens::OrgId)
                    .to_owned(),
            )
            .await?;

        // ── 2. Backfill one token per existing org ────────────────────────────
        let db = manager.get_connection();
        let txn = db.begin().await?;

        let mut org_pages = organization::Entity::find()
            .order_by_asc(organization::Column::Identifier)
            .paginate(&txn, 100);

        while let Some(orgs) = org_pages.fetch_and_next().await? {
            let mut new_tokens: Vec<synthetics_probe_tokens::ActiveModel> = vec![];

            for org in orgs {
                let now = chrono::Utc::now().timestamp_micros();
                let token = format!(
                    "{}{}",
                    SYNTHETICS_PROBE_TOKEN_PREFIX,
                    generate_random_string(32)
                );

                new_tokens.push(synthetics_probe_tokens::ActiveModel {
                    id: Set(config::ider::uuid()),
                    org_id: Set(org.identifier),
                    token: Set(token),
                    enabled: Set(true),
                    created_by: Set("system".to_owned()),
                    created_at: Set(now),
                    updated_at: Set(now),
                });
            }

            if !new_tokens.is_empty() {
                synthetics_probe_tokens::Entity::insert_many(new_tokens)
                    .exec(&txn)
                    .await?;
            }
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SyntheticsProbeTokens::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SyntheticsProbeTokens {
    Table,
    Id,
    OrgId,
    Token,
    Enabled,
    CreatedBy,
    CreatedAt,
    UpdatedAt,
}

mod organization {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "organizations")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub identifier: String,
        pub org_name: String,
        pub org_type: i16,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod synthetics_probe_tokens {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "synthetics_probe_tokens")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org_id: String,
        pub token: String,
        pub enabled: bool,
        pub created_by: String,
        pub created_at: i64,
        pub updated_at: i64,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
