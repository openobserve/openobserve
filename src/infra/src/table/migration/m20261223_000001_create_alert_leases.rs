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

//! Creates `alert_leases`: temporary alerts and timed `creates_incident` values.

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

pub(super) const ALERT_IDX: &str = "alert_leases_org_alert_state_idx";
pub(super) const DUE_IDX: &str = "alert_leases_state_ends_at_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertLeases::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum AlertLeases {
    Table,
    Id,
    OrgId,
    AlertId,
    Kind,
    SetValue,
    PriorEnabled,
    PriorCreatesIncident,
    AlertVersionUs,
    EndVersionUs,
    StartsAtUs,
    EndsAtUs,
    SetBy,
    Reason,
    OriginRef,
    State,
    StateReason,
    EndedAtUs,
    ClaimedAtUs,
    Region,
    CreatedAtUs,
    UpdatedAtUs,
}

/// Creates the table and its indexes; shared by the migration and the tests.
pub(crate) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    conn.execute(backend.build(&table())).await?;
    for index in indexes() {
        conn.execute(backend.build(&index)).await?;
    }
    Ok(())
}

fn table() -> TableCreateStatement {
    use AlertLeases as T;
    let varchar = |col: T, len: u32| ColumnDef::new(col).string_len(len).not_null().to_owned();
    let bigint = |col: T| ColumnDef::new(col).big_integer().not_null().to_owned();
    let nullable_bigint = |col: T| ColumnDef::new(col).big_integer().null().to_owned();
    let nullable_bool = |col: T| ColumnDef::new(col).boolean().null().to_owned();
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(varchar(T::Id, 27).primary_key().to_owned())
        .col(varchar(T::OrgId, 256))
        .col(varchar(T::AlertId, 27))
        .col(varchar(T::Kind, 32))
        .col(ColumnDef::new(T::SetValue).boolean().not_null())
        .col(nullable_bool(T::PriorEnabled))
        .col(nullable_bool(T::PriorCreatesIncident))
        .col(bigint(T::AlertVersionUs))
        .col(nullable_bigint(T::EndVersionUs))
        .col(bigint(T::StartsAtUs))
        .col(bigint(T::EndsAtUs))
        .col(varchar(T::SetBy, 256))
        .col(ColumnDef::new(T::Reason).text().not_null())
        .col(ColumnDef::new(T::OriginRef).string_len(256).null())
        .col(varchar(T::State, 16))
        .col(ColumnDef::new(T::StateReason).text().null())
        .col(nullable_bigint(T::EndedAtUs))
        .col(nullable_bigint(T::ClaimedAtUs))
        .col(varchar(T::Region, 128))
        .col(bigint(T::CreatedAtUs))
        .col(bigint(T::UpdatedAtUs))
        .to_owned()
}

fn indexes() -> [IndexCreateStatement; 2] {
    use AlertLeases as T;
    [
        Index::create()
            .if_not_exists()
            .name(ALERT_IDX)
            .table(T::Table)
            .col(T::OrgId)
            .col(T::AlertId)
            .col(T::State)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(DUE_IDX)
            .table(T::Table)
            .col(T::State)
            .col(T::EndsAtUs)
            .to_owned(),
    ]
}
