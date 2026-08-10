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

//! On-call schema.
//!
//! The feature is enterprise, but the DDL lives here with every other
//! enterprise feature's (incidents, synthetics, SLO) because `o2_enterprise`
//! carries `sea-orm-migration` only under the `cloud` feature. These tables
//! exist in every deployment and are written to by none of them unless the
//! enterprise build and `ZO_ONCALL_ENABLED` are both on.
//!
//! All ids are ksuids. Their timestamp component has one-second resolution
//! and the rest is random, so `ORDER BY id` is chronological only to the
//! second - anything that must be strictly ordered sorts on an explicit
//! timestamp column and uses the id purely as a tiebreak.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallTeams::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallTeams::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(OncallTeams::OrgId).string().not_null())
                    .col(ColumnDef::new(OncallTeams::Name).string().not_null())
                    .col(
                        ColumnDef::new(OncallTeams::Timezone)
                            .string()
                            .not_null()
                            .default("UTC"),
                    )
                    .col(ColumnDef::new(OncallTeams::Description).string().null())
                    .col(
                        ColumnDef::new(OncallTeams::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallTeams::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Unique (org_id, name) makes get-or-create race-safe across nodes;
        // the app-level find-then-insert cannot close that race by itself.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallTeams::Table)
                    .name("idx_oncall_teams_org_name")
                    .col(OncallTeams::OrgId)
                    .col(OncallTeams::Name)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(OncallTeamMembers::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallTeamMembers::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallTeamMembers::TeamId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallTeamMembers::UserEmail)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallTeamMembers::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Membership is a flat fact: one row per person per team. Which rung
        // somebody covers belongs to the rotation
        // (`oncall_schedules.rotations`), not to belonging to the team.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallTeamMembers::Table)
                    .name("idx_oncall_team_members_team_user")
                    .col(OncallTeamMembers::TeamId)
                    .col(OncallTeamMembers::UserEmail)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(OncallSchedules::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallSchedules::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(OncallSchedules::OrgId).string().not_null())
                    .col(
                        ColumnDef::new(OncallSchedules::TeamId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(OncallSchedules::Timezone)
                            .string()
                            .not_null()
                            .default("UTC"),
                    )
                    .col(
                        ColumnDef::new(OncallSchedules::Rotations)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(OncallSchedules::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallSchedules::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(OncallPolicies::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallPolicies::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(OncallPolicies::OrgId).string().not_null())
                    .col(
                        ColumnDef::new(OncallPolicies::TeamId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(OncallPolicies::Rungs)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("[]"),
                    )
                    // Alert Destination NAMES, not URLs — the org already has
                    // somewhere to store those.
                    .col(
                        ColumnDef::new(OncallPolicies::Destinations)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(OncallPolicies::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallPolicies::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(OncallResponses::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallResponses::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(OncallResponses::OrgId).string().not_null())
                    .col(
                        ColumnDef::new(OncallResponses::SubjectType)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponses::SubjectId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(OncallResponses::TeamId).string().not_null())
                    // What the page says it is about. Stored rather than
                    // re-read from the alert on every tick, and it must
                    // survive the alert being renamed or deleted.
                    .col(ColumnDef::new(OncallResponses::Title).string().null())
                    // Why it happened, captured at resolve. This is what makes
                    // the next firing of the same rule useful history.
                    .col(ColumnDef::new(OncallResponses::Cause).string().null())
                    .col(ColumnDef::new(OncallResponses::CauseNote).string().null())
                    // The instant the escalation ladder measures its step
                    // delays from. Snoozing pushes it forward so a pause does
                    // not turn into every rung firing at once on expiry;
                    // `opened_at` stays put so time-to-resolve stays honest.
                    .col(
                        ColumnDef::new(OncallResponses::LadderAnchor)
                            .big_integer()
                            .null(),
                    )
                    // Quiet until this instant. Distinct from acking: the page
                    // is still nobody's, it is just not shouting.
                    .col(
                        ColumnDef::new(OncallResponses::SnoozedUntil)
                            .big_integer()
                            .null(),
                    )
                    // Owner fixes the cause; impacted contains the blast
                    // radius on their own service. Different jobs, so
                    // different records with their own ack and timeline.
                    .col(
                        ColumnDef::new(OncallResponses::ResponderRole)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    // The owner record this one was opened alongside.
                    .col(
                        ColumnDef::new(OncallResponses::OriginResponseId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponses::Priority)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(OncallResponses::State).integer().not_null())
                    .col(
                        ColumnDef::new(OncallResponses::OpenedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(OncallResponses::AckedBy).string().null())
                    .col(ColumnDef::new(OncallResponses::AckedAt).big_integer().null())
                    .col(
                        ColumnDef::new(OncallResponses::ClosedAt)
                            .big_integer()
                            .null(),
                    )
                    // Nullable and unconstrained: most firings never produce an
                    // incident, and an incident renders a record rather than
                    // owning one.
                    .col(ColumnDef::new(OncallResponses::IncidentId).string().null())
                    .to_owned(),
            )
            .await?;

        // The record is keyed by subject, so this is the lookup the engine
        // does on every firing. Unique because a firing has exactly one
        // record - the firing counter in subject_id is what separates
        // repeats of the same rule.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallResponses::Table)
                    .name("idx_oncall_responses_subject")
                    .col(OncallResponses::OrgId)
                    .col(OncallResponses::SubjectType)
                    .col(OncallResponses::SubjectId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Backs the team's open-response list, which is the on-call
        // engineer's home screen.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallResponses::Table)
                    .name("idx_oncall_responses_team_state")
                    .col(OncallResponses::OrgId)
                    .col(OncallResponses::TeamId)
                    .col(OncallResponses::State)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(OncallResponseEvents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallResponseEvents::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseEvents::ResponseId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseEvents::Kind)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseEvents::At)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseEvents::Actor)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseEvents::Body)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default(""),
                    )
                    // The rung, as its delay from the record opening. This is
                    // the delivery ledger the planner reads back.
                    .col(
                        ColumnDef::new(OncallResponseEvents::RungMicros)
                            .big_integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Timeline read. Sorted on `at` because that is the real ordering;
        // `id` is the tiebreak that makes paging deterministic when two
        // events share a microsecond, which ksuids alone cannot provide -
        // their timestamp resolution is one second.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallResponseEvents::Table)
                    .name("idx_oncall_response_events_response")
                    .col(OncallResponseEvents::ResponseId)
                    .col(OncallResponseEvents::At)
                    .col(OncallResponseEvents::Id)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(OncallResponseEvents::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(OncallResponses::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(OncallPolicies::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(OncallSchedules::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(OncallTeamMembers::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(OncallTeams::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum OncallTeams {
    Table,
    Id,
    OrgId,
    Name,
    Timezone,
    Description,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum OncallTeamMembers {
    Table,
    Id,
    TeamId,
    UserEmail,
    CreatedAt,
}

#[derive(DeriveIden)]
enum OncallSchedules {
    Table,
    Id,
    OrgId,
    TeamId,
    Timezone,
    Rotations,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum OncallPolicies {
    Table,
    Id,
    OrgId,
    TeamId,
    Rungs,
    Destinations,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum OncallResponses {
    Table,
    Id,
    OrgId,
    SubjectType,
    SubjectId,
    TeamId,
    Title,
    Cause,
    CauseNote,
    SnoozedUntil,
    LadderAnchor,
    ResponderRole,
    OriginResponseId,
    Priority,
    State,
    OpenedAt,
    AckedBy,
    AckedAt,
    ClosedAt,
    IncidentId,
}

#[derive(DeriveIden)]
enum OncallResponseEvents {
    Table,
    Id,
    ResponseId,
    Kind,
    At,
    Actor,
    Body,
    RungMicros,
}
