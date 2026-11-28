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
        use IncidentContexts as C;
        use IncidentDeclareKeys as K;

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
                    .col(ColumnDef::new(C::Role).string_len(8).not_null())
                    .col(ColumnDef::new(C::Kind).string_len(16).not_null())
                    .col(ColumnDef::new(C::Title).string_len(256).not_null())
                    .col(ColumnDef::new(C::Note).text())
                    .col(ColumnDef::new(C::Target).text().not_null())
                    .col(ColumnDef::new(C::Origin).text().not_null())
                    .col(ColumnDef::new(C::StartAt).big_integer().not_null())
                    .col(ColumnDef::new(C::EndAt).big_integer().not_null())
                    .col(ColumnDef::new(C::ResultSummary).text())
                    .col(ColumnDef::new(C::Bytes).integer().not_null())
                    .col(ColumnDef::new(C::ClientKey).string_len(64))
                    .col(ColumnDef::new(C::CreatedBy).string_len(256).not_null())
                    .col(ColumnDef::new(C::DeletedAt).big_integer())
                    .col(ColumnDef::new(C::CreatedAt).big_integer().not_null())
                    .col(ColumnDef::new(C::UpdatedAt).big_integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(C::Table, C::IncidentId)
                            .to(Alias::new("alert_incidents"), Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_incident_contexts_org_incident_created")
                    .if_not_exists()
                    .table(C::Table)
                    .col(C::OrgId)
                    .col(C::IncidentId)
                    .col(C::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_incident_contexts_incident_client_key")
                    .if_not_exists()
                    .unique()
                    .table(C::Table)
                    .col(C::IncidentId)
                    .col(C::ClientKey)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(K::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(K::OrgId).string_len(256).not_null())
                    .col(ColumnDef::new(K::DeclareKey).string_len(64).not_null())
                    .col(ColumnDef::new(K::IncidentId).string_len(27).not_null())
                    .col(ColumnDef::new(K::Created).boolean().not_null())
                    .col(ColumnDef::new(K::CreatedAt).big_integer().not_null())
                    .primary_key(Index::create().col(K::OrgId).col(K::DeclareKey))
                    .foreign_key(
                        ForeignKey::create()
                            .from(K::Table, K::IncidentId)
                            .to(Alias::new("alert_incidents"), Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            Alias::new("incident_contexts"),
            Alias::new("incident_declare_keys"),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum IncidentContexts {
    Table,
    Id,
    OrgId,
    IncidentId,
    Role,
    Kind,
    Title,
    Note,
    Target,
    Origin,
    StartAt,
    EndAt,
    ResultSummary,
    Bytes,
    ClientKey,
    CreatedBy,
    DeletedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum IncidentDeclareKeys {
    Table,
    OrgId,
    DeclareKey,
    IncidentId,
    Created,
    CreatedAt,
}
