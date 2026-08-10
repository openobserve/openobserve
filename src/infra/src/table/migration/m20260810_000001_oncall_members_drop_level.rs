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

//! Team membership is a flat list of people; the level belongs to the rotation.
//!
//! The original table pinned a level onto each membership row, which forced the
//! same person to be added once per level they cover and asked "what level is
//! this person?" at a point where the answer is meaningless — somebody is on
//! the team, and the *schedule* says which rung they rotate through. It also
//! split one fact across two places: `oncall_schedules.rotations` already
//! carries `{level, members[]}` and is what the engine actually reads.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // The old unique key included the level, so dropping the column would
        // leave a constraint over a column that no longer exists.
        manager
            .drop_index(
                Index::drop()
                    .name("idx_oncall_team_members_team_user_level")
                    .table(OncallTeamMembers::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(OncallTeamMembers::Table)
                    .drop_column(OncallTeamMembers::Level)
                    .to_owned(),
            )
            .await?;

        // One row per person per team now.
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
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_oncall_team_members_team_user")
                    .table(OncallTeamMembers::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(OncallTeamMembers::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(OncallTeamMembers::Level)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum OncallTeamMembers {
    Table,
    TeamId,
    UserEmail,
    Level,
}
