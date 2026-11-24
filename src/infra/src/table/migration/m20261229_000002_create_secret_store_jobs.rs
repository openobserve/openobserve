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

//! Creates the secret store job tables: upgrade pre-scan hits and run-once markers.

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

pub(crate) const TABLES: [&str; 2] = ["secret_prescan_hits", "secret_store_job_markers"];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES.iter().rev() {
            manager
                .drop_table(
                    Table::drop()
                        .table(Alias::new(*table))
                        .if_exists()
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretPrescanHits {
    Table,
    OrgId,
    ConsumerType,
    ConsumerId,
    Field,
    Token,
    FoundAt,
}

#[derive(DeriveIden, Clone, Copy)]
enum SecretStoreJobMarkers {
    Table,
    Job,
    OrgId,
    DoneAt,
}

pub(crate) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    conn.execute(backend.build(&prescan_hits())).await?;
    conn.execute(backend.build(&job_markers())).await?;
    Ok(())
}

fn s(col: impl IntoIden, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).not_null().to_owned()
}

fn prescan_hits() -> TableCreateStatement {
    use SecretPrescanHits as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::OrgId, 256))
        .col(s(T::ConsumerType, 64))
        .col(s(T::ConsumerId, 256))
        .col(s(T::Field, 256))
        .col(s(T::Token, 256))
        .col(ColumnDef::new(T::FoundAt).big_integer().not_null())
        .primary_key(
            Index::create()
                .col(T::OrgId)
                .col(T::ConsumerType)
                .col(T::ConsumerId)
                .col(T::Field)
                .col(T::Token),
        )
        .to_owned()
}

fn job_markers() -> TableCreateStatement {
    use SecretStoreJobMarkers as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(s(T::Job, 64))
        .col(s(T::OrgId, 256))
        .col(ColumnDef::new(T::DoneAt).big_integer().not_null())
        .primary_key(Index::create().col(T::Job).col(T::OrgId))
        .to_owned()
}
