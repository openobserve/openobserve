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

const MODEL_PRICING_ORG_NAME_IDX: &str = "model_pricing_org_name_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_model_pricing_table_statement())
            .await?;
        manager
            .create_index(create_model_pricing_org_name_idx())
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(MODEL_PRICING_ORG_NAME_IDX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ModelPricing::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn create_model_pricing_table_statement() -> TableCreateStatement {
    Table::create()
        .table(ModelPricing::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(ModelPricing::Id)
                .char_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(ModelPricing::Org).string_len(100).not_null())
        .col(
            ColumnDef::new(ModelPricing::Name)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(ModelPricing::MatchPattern)
                .string_len(512)
                .not_null(),
        )
        .col(
            ColumnDef::new(ModelPricing::Enabled)
                .boolean()
                .not_null()
                .default(true),
        )
        .col(ColumnDef::new(ModelPricing::Tiers).json().not_null())
        .col(ColumnDef::new(ModelPricing::ValidFrom).big_integer().null())
        .col(
            ColumnDef::new(ModelPricing::SortOrder)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(ModelPricing::CreatedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(ModelPricing::UpdatedAt)
                .big_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

fn create_model_pricing_org_name_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(MODEL_PRICING_ORG_NAME_IDX)
        .table(ModelPricing::Table)
        .col(ModelPricing::Org)
        .col(ModelPricing::Name)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum ModelPricing {
    Table,
    Id,
    Org,
    Name,
    MatchPattern,
    Enabled,
    Tiers,
    ValidFrom,
    SortOrder,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::prelude::*;

    use super::*;

    #[test]
    fn postgres() {
        let stmt = create_model_pricing_table_statement();
        assert_eq!(
            stmt.to_string(PostgresQueryBuilder),
            [
                r#"CREATE TABLE IF NOT EXISTS "model_pricing""#,
                r#" ( "id" char(27) NOT NULL PRIMARY KEY,"#,
                r#" "org" varchar(100) NOT NULL,"#,
                r#" "name" varchar(256) NOT NULL,"#,
                r#" "match_pattern" varchar(512) NOT NULL,"#,
                r#" "enabled" bool NOT NULL DEFAULT TRUE,"#,
                r#" "tiers" json NOT NULL,"#,
                r#" "valid_from" bigint NULL,"#,
                r#" "sort_order" integer NOT NULL DEFAULT 0,"#,
                r#" "created_at" bigint NOT NULL DEFAULT 0,"#,
                r#" "updated_at" bigint NOT NULL DEFAULT 0 )"#,
            ]
            .join("")
        );
    }

    #[test]
    fn sqlite() {
        let stmt = create_model_pricing_table_statement();
        assert_eq!(
            stmt.to_string(SqliteQueryBuilder),
            [
                r#"CREATE TABLE IF NOT EXISTS "model_pricing""#,
                r#" ( "id" char(27) NOT NULL PRIMARY KEY,"#,
                r#" "org" varchar(100) NOT NULL,"#,
                r#" "name" varchar(256) NOT NULL,"#,
                r#" "match_pattern" varchar(512) NOT NULL,"#,
                r#" "enabled" boolean NOT NULL DEFAULT TRUE,"#,
                r#" "tiers" json_text NOT NULL,"#,
                r#" "valid_from" bigint NULL,"#,
                r#" "sort_order" integer NOT NULL DEFAULT 0,"#,
                r#" "created_at" bigint NOT NULL DEFAULT 0,"#,
                r#" "updated_at" bigint NOT NULL DEFAULT 0 )"#,
            ]
            .join("")
        );
    }
}
