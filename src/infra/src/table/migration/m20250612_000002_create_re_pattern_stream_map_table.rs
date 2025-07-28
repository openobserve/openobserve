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

use super::m20250612_000001_create_re_pattern_table::RePatterns;

#[derive(DeriveMigrationName)]
pub struct Migration;

const RE_PATTERN_STREAM_MAP_FOREIGN_KEY: &str = "re_pattern_stream_map_fk";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(create_re_stream_map_table_statement())
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(RePatternStreamMap::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Statement to create the re patterns table.
fn create_re_stream_map_table_statement() -> TableCreateStatement {
    Table::create()
        .table(RePatternStreamMap::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RePatternStreamMap::Id)
                .big_integer()
                .not_null()
                .auto_increment()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RePatternStreamMap::Org)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(RePatternStreamMap::Stream)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RePatternStreamMap::StreamType)
                .string_len(50)
                .not_null(),
        )
        .col(
            ColumnDef::new(RePatternStreamMap::Field)
                .string_len(1024)
                .not_null(),
        )
        .col(
            ColumnDef::new(RePatternStreamMap::PatternId)
                .string_len(100)
                .not_null(),
        )
        .col(ColumnDef::new(RePatternStreamMap::Policy).text().not_null())
        .col(
            ColumnDef::new(RePatternStreamMap::ApplyAt)
                .not_null()
                .string_len(100),
        )
        .foreign_key(
            ForeignKey::create()
                .name(RE_PATTERN_STREAM_MAP_FOREIGN_KEY)
                .from(RePatternStreamMap::Table, RePatternStreamMap::PatternId)
                .to(RePatterns::Table, RePatterns::Id),
        )
        .to_owned()
}

/// Identifiers used in queries on the re pattern stream map table.
#[derive(DeriveIden)]
enum RePatternStreamMap {
    Table,
    Id,
    Org,
    Stream,
    StreamType,
    Field,
    PatternId,
    Policy,
    ApplyAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_re_stream_map_table_statement().to_string(PostgresQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "re_pattern_stream_map" ( 
            "id" bigserial NOT NULL PRIMARY KEY, 
            "org" varchar(100) NOT NULL, 
            "stream" varchar(256) NOT NULL, 
            "stream_type" varchar(50) NOT NULL, 
            "field" varchar(1024) NOT NULL, 
            "pattern_id" varchar(100) NOT NULL, 
            "policy" text NOT NULL, 
            "apply_at" varchar(100) NOT NULL,
            CONSTRAINT "re_pattern_stream_map_fk" FOREIGN KEY ("pattern_id") REFERENCES "re_patterns" ("id") 
            )"#
        );
    }

    #[test]
    fn mysql() {
        collapsed_eq!(
            &create_re_stream_map_table_statement().to_string(MysqlQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS `re_pattern_stream_map` ( 
            `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY, 
            `org` varchar(100) NOT NULL, 
            `stream` varchar(256) NOT NULL, 
            `stream_type` varchar(50) NOT NULL, 
            `field` varchar(1024) NOT NULL, 
            `pattern_id` varchar(100) NOT NULL, 
            `policy` text NOT NULL, 
            `apply_at` varchar(100) NOT NULL,
            CONSTRAINT `re_pattern_stream_map_fk` FOREIGN KEY (`pattern_id`) REFERENCES `re_patterns` (`id`) 
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_re_stream_map_table_statement().to_string(SqliteQueryBuilder),
            r#"CREATE TABLE IF NOT EXISTS "re_pattern_stream_map" ( 
            "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, 
            "org" varchar(100) NOT NULL, 
            "stream" varchar(256) NOT NULL, 
            "stream_type" varchar(50) NOT NULL, 
            "field" varchar(1024) NOT NULL, 
            "pattern_id" varchar(100) NOT NULL, 
            "policy" text NOT NULL, 
            "apply_at" varchar(100) NOT NULL,
            FOREIGN KEY ("pattern_id") REFERENCES "re_patterns" ("id") 
            )"#
        );
    }
}
