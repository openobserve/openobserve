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
        use IncidentRecoveryChecks as C;

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
                    .col(ColumnDef::new(C::AttemptId).string_len(27).not_null())
                    .col(ColumnDef::new(C::Source).string_len(16).not_null())
                    .col(ColumnDef::new(C::SourceRef).string_len(128))
                    .col(ColumnDef::new(C::Target).text().not_null())
                    .col(ColumnDef::new(C::Measure).text().not_null())
                    .col(ColumnDef::new(C::BaselineVolume).double())
                    .col(
                        ColumnDef::new(C::VolumeFloorPct)
                            .integer()
                            .not_null()
                            .default(50),
                    )
                    .col(ColumnDef::new(C::Scope).text())
                    .col(ColumnDef::new(C::Comparator).string_len(4).not_null())
                    .col(ColumnDef::new(C::AlertThreshold).double().not_null())
                    .col(ColumnDef::new(C::RecoverThreshold).double().not_null())
                    .col(ColumnDef::new(C::Baseline).double())
                    .col(ColumnDef::new(C::PassWindowSecs).integer().not_null())
                    .col(ColumnDef::new(C::Passes).integer().not_null())
                    .col(ColumnDef::new(C::PassStartedAt).big_integer())
                    .col(ColumnDef::new(C::FlapPeriodSecs).integer())
                    .col(ColumnDef::new(C::SoakSecs).integer().not_null())
                    .col(ColumnDef::new(C::State).string_len(16).not_null())
                    .col(ColumnDef::new(C::StateReason).string_len(256))
                    .col(ColumnDef::new(C::TriggerAt).big_integer().not_null())
                    .col(ColumnDef::new(C::ExpectEffectSecs).integer().not_null())
                    .col(ColumnDef::new(C::EffectFromAt).big_integer().not_null())
                    .col(ColumnDef::new(C::DeadlineAt).big_integer().not_null())
                    .col(ColumnDef::new(C::VerifiedAt).big_integer())
                    .col(ColumnDef::new(C::SoakUntil).big_integer())
                    .col(ColumnDef::new(C::LastValue).double())
                    .col(ColumnDef::new(C::LastCheckedAt).big_integer())
                    .col(ColumnDef::new(C::RecentSamples).text().not_null())
                    .col(ColumnDef::new(C::CreatedBy).string_len(256).not_null())
                    .col(ColumnDef::new(C::Generation).big_integer().not_null())
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
        for (name, columns) in [
            (
                "idx_incident_recovery_checks_attempt",
                &[C::IncidentId, C::AttemptId][..],
            ),
            ("idx_incident_recovery_checks_state", &[C::State][..]),
        ] {
            let mut index = Index::create();
            index
                .name(name)
                .if_not_exists()
                .table(C::Table)
                .col(C::OrgId);
            for &column in columns {
                index.col(column);
            }
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(IncidentRecoveryChecks::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(Clone, Copy, DeriveIden)]
enum IncidentRecoveryChecks {
    Table,
    Id,
    OrgId,
    IncidentId,
    AttemptId,
    Source,
    SourceRef,
    Target,
    Measure,
    BaselineVolume,
    VolumeFloorPct,
    Scope,
    Comparator,
    AlertThreshold,
    RecoverThreshold,
    Baseline,
    PassWindowSecs,
    Passes,
    PassStartedAt,
    FlapPeriodSecs,
    SoakSecs,
    State,
    StateReason,
    TriggerAt,
    ExpectEffectSecs,
    EffectFromAt,
    DeadlineAt,
    VerifiedAt,
    SoakUntil,
    LastValue,
    LastCheckedAt,
    RecentSamples,
    CreatedBy,
    Generation,
    DeletedAt,
    CreatedAt,
    UpdatedAt,
}
