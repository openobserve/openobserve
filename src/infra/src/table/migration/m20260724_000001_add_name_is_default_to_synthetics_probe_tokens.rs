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

//! Add `name` + `is_default` to `synthetics_probe_tokens` and a unique
//! `(org_id, name)` index — bringing the table to parity with
//! `org_ingestion_tokens` so an org can hold multiple named probe tokens
//! (rotate = create-new + disable-old, revoke = disable), per the synthetics
//! design (`designs/synthetics/01-server-architecture.md` §7.2).
//!
//! Backfill: the single per-org token every org already has (created by
//! `m20260707_000004`) becomes `name='default'`, `is_default=true`, so existing
//! agents keep authenticating unchanged after the upgrade.

use sea_orm::sea_query::Query;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SYNTHETICS_PROBE_TOKENS_ORG_NAME_UQ: &str = "idx_synthetics_probe_tokens_org_name_uq";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // NOTE: one column per alter_table statement — SQLite does not support
        // multiple ALTER operations in a single ALTER TABLE (sea-query panics).
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsProbeTokens::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(SyntheticsProbeTokens::Name)
                            .string()
                            .not_null()
                            .default("default"),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsProbeTokens::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(SyntheticsProbeTokens::IsDefault)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;

        // Backfill: every existing row is the org's sole (default) token. `name`
        // already defaulted to 'default' via the column default; flip is_default.
        let db = manager.get_connection();
        let builder = db.get_database_backend();
        let stmt = Query::update()
            .table(SyntheticsProbeTokens::Table)
            .value(SyntheticsProbeTokens::IsDefault, true)
            .to_owned();
        db.execute(builder.build(&stmt)).await?;

        // Unique (org_id, name) so named tokens can't collide within an org.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(SYNTHETICS_PROBE_TOKENS_ORG_NAME_UQ)
                    .table(SyntheticsProbeTokens::Table)
                    .col(SyntheticsProbeTokens::OrgId)
                    .col(SyntheticsProbeTokens::Name)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(SYNTHETICS_PROBE_TOKENS_ORG_NAME_UQ)
                    .table(SyntheticsProbeTokens::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsProbeTokens::Table)
                    .drop_column(SyntheticsProbeTokens::IsDefault)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SyntheticsProbeTokens::Table)
                    .drop_column(SyntheticsProbeTokens::Name)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SyntheticsProbeTokens {
    Table,
    OrgId,
    Name,
    IsDefault,
}

#[cfg(test)]
mod tests {
    use sea_orm_migration::MigrationName;

    use super::*;

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260724_000001_add_name_is_default_to_synthetics_probe_tokens"
        );
    }
}
