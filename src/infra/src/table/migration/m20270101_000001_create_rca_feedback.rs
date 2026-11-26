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

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use RcaFeedback as C;

        manager
            .create_table(
                Table::create()
                    .table(C::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(C::Id)
                            .string_len(27)
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(C::OrgId).string_len(256).not_null())
                    .col(ColumnDef::new(C::IncidentId).string_len(27).not_null())
                    .col(ColumnDef::new(C::RunId).string_len(27).not_null())
                    .col(ColumnDef::new(C::TargetKind).string_len(16).not_null())
                    .col(ColumnDef::new(C::TargetId).string_len(32).not_null())
                    .col(ColumnDef::new(C::Verdict).string_len(16).not_null())
                    .col(ColumnDef::new(C::Band).string_len(8))
                    .col(ColumnDef::new(C::Outcome).string_len(32))
                    .col(ColumnDef::new(C::CauseClass).string_len(32))
                    .col(ColumnDef::new(C::ActualCause).text())
                    .col(ColumnDef::new(C::Note).text())
                    .col(ColumnDef::new(C::AuthorEmail).string_len(256).not_null())
                    .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(C::UpdatedAt).big_integer().not_null())
                    .col(ColumnDef::new(C::DeletedAt).big_integer())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_rca_feedback_author_target")
                    .if_not_exists()
                    .unique()
                    .table(C::Table)
                    .col(C::RunId)
                    .col(C::TargetKind)
                    .col(C::TargetId)
                    .col(C::AuthorEmail)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_rca_feedback_org_incident")
                    .if_not_exists()
                    .table(C::Table)
                    .col(C::OrgId)
                    .col(C::IncidentId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(RcaFeedback::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(Clone, Copy, DeriveIden)]
enum RcaFeedback {
    Table,
    Id,
    OrgId,
    IncidentId,
    RunId,
    TargetKind,
    TargetId,
    Verdict,
    Band,
    Outcome,
    CauseClass,
    ActualCause,
    Note,
    AuthorEmail,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}
