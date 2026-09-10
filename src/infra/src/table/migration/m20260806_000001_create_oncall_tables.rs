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

//! Enterprise DDL lives here: `o2_enterprise` carries `sea-orm-migration` only under `cloud`.

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
                    // Null is not `[]`: null falls back to the policy, `[]` means no channel.
                    .col(
                        ColumnDef::new(OncallTeams::ChannelDestinations)
                            .text()
                            .null(),
                    )
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

        // Unique (org_id, name) is what makes get-or-create race-safe; find-then-insert cannot.
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

        // Membership is flat: which rung somebody covers is `oncall_schedules.rotations`.
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
                    // Destination names, not URLs: the org already stores those.
                    .col(
                        ColumnDef::new(OncallPolicies::Destinations)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("[]"),
                    )
                    // Defaulted, so a team that never opens the screen runs the defaults.
                    .col(
                        ColumnDef::new(OncallPolicies::L0Json)
                            .custom(Alias::new(get_text_type()))
                            .not_null()
                            .default("{}"),
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
                    // Null IS the teamless case; a sentinel would be an unknown invariant.
                    .col(ColumnDef::new(OncallResponses::TeamId).string().null())
                    // Stored, not re-read: it must survive the alert being renamed.
                    .col(ColumnDef::new(OncallResponses::Title).string().null())
                    .col(ColumnDef::new(OncallResponses::Cause).string().null())
                    .col(ColumnDef::new(OncallResponses::CauseNote).string().null())
                    // Snoozing moves this, not `opened_at`, or every rung fires at once.
                    .col(
                        ColumnDef::new(OncallResponses::LadderAnchor)
                            .big_integer()
                            .null(),
                    )
                    // A handoff starts a new run, so its ladder begins at rung one.
                    .col(
                        ColumnDef::new(OncallResponses::LadderRun)
                            .integer()
                            .null(),
                    )
                    // Distinct from acking: the page is still nobody's, it is just not shouting.
                    .col(
                        ColumnDef::new(OncallResponses::SnoozedUntil)
                            .big_integer()
                            .null(),
                    )
                    // Owner and impacted are different jobs, so each gets its own record.
                    .col(
                        ColumnDef::new(OncallResponses::ResponderRole)
                            .integer()
                            .not_null()
                            .default(1),
                    )
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
                    // Nullable: an incident renders a record rather than owning one.
                    .col(ColumnDef::new(OncallResponses::IncidentId).string().null())
                    .to_owned(),
            )
            .await?;

        // Unique because a firing has one record; `subject_id` separates repeats of the rule.
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
                    // Delay and run together are the key: a handoff can restart the ladder.
                    .col(
                        ColumnDef::new(OncallResponseEvents::RungMicros)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallResponseEvents::LadderRun)
                            .integer()
                            .null(),
                    )
                    // Per send, not per rung, so a crash retries only what did not land.
                    .col(
                        ColumnDef::new(OncallResponseEvents::Recipient)
                            .string()
                            .null(),
                    )
                    .col(ColumnDef::new(OncallResponseEvents::Channel).integer().null())
                    .col(
                        ColumnDef::new(OncallResponseEvents::Delivered)
                            .boolean()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // `id` breaks ties inside one microsecond, which ksuids cannot at one-second resolution.
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
            .await?;

        // The engine's dedup is a read then an insert, so only this key stops a double page.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallResponseEvents::Table)
                    .name("idx_oncall_response_events_delivery")
                    .col(OncallResponseEvents::ResponseId)
                    .col(OncallResponseEvents::LadderRun)
                    .col(OncallResponseEvents::RungMicros)
                    .col(OncallResponseEvents::Recipient)
                    .col(OncallResponseEvents::Channel)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(OncallResponseEvents::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OncallResponses::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OncallPolicies::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OncallSchedules::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OncallTeamMembers::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OncallTeams::Table)
                    .if_exists()
                    .to_owned(),
            )
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
    ChannelDestinations,
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
    L0Json,
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
    LadderRun,
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
    LadderRun,
    Recipient,
    Channel,
    Delivered,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement};

    use super::*;

    async fn migrated() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        db
    }

    async fn write_event(
        db: &DatabaseConnection,
        id: &str,
        key: &str,
    ) -> Result<(), sea_orm::DbErr> {
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO oncall_response_events (id, response_id, kind, at, actor, body, \
                 rung_micros, ladder_run, recipient, channel, delivered) VALUES ('{id}', {key})"
            ),
        ))
        .await
        .map(|_| ())
    }

    /// Without the constraint the dedup is a read then an insert, and two interleaving double-page.
    #[tokio::test]
    async fn test_the_ledger_holds_one_row_per_person_per_channel_per_rung() {
        let db = migrated().await;
        let key = "'resp_1', 6, 1000, 'o2-engine', 'email delivered to ana@o2.ai', 0, 1, \
                   'ana@o2.ai', 1, true";
        write_event(&db, "ev_1", key).await.unwrap();
        assert!(write_event(&db, "ev_2", key).await.is_err());
    }

    /// The design rests on null being distinct from null, so non-delivery entries are exempt.
    #[tokio::test]
    async fn test_two_notes_on_one_record_are_not_a_duplicate() {
        let db = migrated().await;
        let key = "'resp_1', 1, 1000, 'ana@o2.ai', 'looking at it', NULL, NULL, NULL, NULL, NULL";
        write_event(&db, "ev_1", key).await.unwrap();
        write_event(&db, "ev_2", key).await.unwrap();
    }
}
