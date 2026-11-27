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

//! Creates the AutoResolve tables: definitions, runs, the connections each run chose, and steps.

use config::meta::autoresolve::RunState;
use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

pub(super) const AUTORESOLVE_NAME_IDX: &str = "autoresolve_org_name_idx";
pub(super) const AUTORESOLVE_TRIGGER_IDX: &str = "autoresolve_org_region_trigger_idx";
pub(super) const RUNS_IDEMPOTENCY_IDX: &str = "autoresolve_runs_org_idempotency_idx";
pub(super) const RUNS_CREATED_IDX: &str = "autoresolve_runs_org_created_at_idx";
pub(super) const RUNS_APPROVAL_IDX: &str = "autoresolve_runs_state_approval_deadline_idx";
pub(super) const RUNS_TURN_IDX: &str = "autoresolve_runs_state_turn_deadline_idx";
pub(super) const RUNS_LIVE_IDX: &str = "autoresolve_runs_org_autoresolve_live_idx";
pub(super) const RUN_CONNECTIONS_IDX: &str = "autoresolve_run_connections_org_connection_idx";
pub(super) const STEPS_RUN_IDX: &str = "autoresolve_steps_run_revision_option_seq_idx";
pub(super) const STEPS_CONSUMED_IDX: &str = "autoresolve_steps_state_consumed_at_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        create_all(manager.get_connection()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            Autoresolve::Table.into_iden(),
            AutoresolveRuns::Table.into_iden(),
            AutoresolveRunConnections::Table.into_iden(),
            AutoresolveSteps::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden, Clone, Copy)]
enum Autoresolve {
    Table,
    Id,
    Org,
    Region,
    Name,
    Goal,
    ConnectionIds,
    ConnectionNames,
    TriggerKind,
    TriggerAlertId,
    TriggerEnabled,
    TriggerApprovedBy,
    TriggerApprovedAtUs,
    CreatedBy,
    CreatedAtUs,
    UpdatedAtUs,
    FromRunId,
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveRuns {
    Table,
    Id,
    Org,
    Region,
    AutoresolveId,
    Goal,
    ConnectionIds,
    ConnectionNames,
    TriggerKind,
    TriggerContext,
    Requester,
    TurnIdentity,
    SessionId,
    State,
    Revision,
    Plan,
    PlanFingerprint,
    ChosenOptionId,
    ApprovedBy,
    ApprovedAtUs,
    ApprovalChannel,
    ApprovalDeadlineUs,
    TurnDeadlineUs,
    TurnStartedAtUs,
    CheckRetriedAtUs,
    SlackRef,
    OutcomeVerdict,
    OutcomeExplanation,
    PriorVerdict,
    Error,
    IdempotencyKey,
    CreatedAtUs,
    UpdatedAtUs,
    EndedAtUs,
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveRunConnections {
    Table,
    Org,
    RunId,
    ConnectionId,
}

#[derive(DeriveIden, Clone, Copy)]
enum AutoresolveSteps {
    Table,
    Id,
    Org,
    RunId,
    Revision,
    OptionId,
    Seq,
    Kind,
    ConnectionId,
    ConnectionName,
    Tool,
    Arguments,
    Refs,
    ArgsHash,
    Reason,
    Preview,
    ToolDefHash,
    ConnectionFingerprint,
    State,
    Result,
    ResultRaw,
    Error,
    ConsumedAtUs,
    FinishedAtUs,
    CreatedAtUs,
}

/// Creates the tables and their indexes; shared by the migration and the tests.
pub(crate) async fn create_all<C: ConnectionTrait>(conn: &C) -> Result<(), DbErr> {
    let backend = conn.get_database_backend();
    for table in [
        autoresolve_table(),
        runs_table(),
        run_connections_table(),
        steps_table(),
    ] {
        conn.execute(backend.build(&table)).await?;
    }
    for index in indexes() {
        conn.execute(backend.build(&index)).await?;
    }
    Ok(())
}

fn varchar<C: IntoIden>(col: C, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).not_null().to_owned()
}

fn nullable_varchar<C: IntoIden>(col: C, len: u32) -> ColumnDef {
    ColumnDef::new(col).string_len(len).null().to_owned()
}

fn text<C: IntoIden>(col: C) -> ColumnDef {
    ColumnDef::new(col).text().not_null().to_owned()
}

fn text_or<C: IntoIden>(col: C, default: &str) -> ColumnDef {
    ColumnDef::new(col)
        .text()
        .not_null()
        .default(default)
        .to_owned()
}

fn nullable_text<C: IntoIden>(col: C) -> ColumnDef {
    ColumnDef::new(col).text().null().to_owned()
}

fn bigint<C: IntoIden>(col: C) -> ColumnDef {
    ColumnDef::new(col).big_integer().not_null().to_owned()
}

fn nullable_bigint<C: IntoIden>(col: C) -> ColumnDef {
    ColumnDef::new(col).big_integer().null().to_owned()
}

fn int<C: IntoIden>(col: C) -> ColumnDef {
    ColumnDef::new(col).integer().not_null().to_owned()
}

fn autoresolve_table() -> TableCreateStatement {
    use Autoresolve as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(varchar(T::Id, 27).primary_key().to_owned())
        .col(varchar(T::Org, 256))
        .col(varchar(T::Region, 128))
        .col(varchar(T::Name, 256))
        .col(text(T::Goal))
        .col(text(T::ConnectionIds))
        .col(text(T::ConnectionNames))
        .col(varchar(T::TriggerKind, 16))
        .col(nullable_varchar(T::TriggerAlertId, 256))
        .col(ColumnDef::new(T::TriggerEnabled).boolean().not_null())
        .col(nullable_varchar(T::TriggerApprovedBy, 256))
        .col(nullable_bigint(T::TriggerApprovedAtUs))
        .col(varchar(T::CreatedBy, 256))
        .col(bigint(T::CreatedAtUs))
        .col(bigint(T::UpdatedAtUs))
        .col(nullable_varchar(T::FromRunId, 27))
        .to_owned()
}

fn runs_table() -> TableCreateStatement {
    use AutoresolveRuns as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(varchar(T::Id, 27).primary_key().to_owned())
        .col(varchar(T::Org, 256))
        .col(varchar(T::Region, 128))
        .col(nullable_varchar(T::AutoresolveId, 27))
        .col(text(T::Goal))
        .col(text_or(T::ConnectionIds, "[]"))
        .col(text_or(T::ConnectionNames, "{}"))
        .col(varchar(T::TriggerKind, 16))
        .col(nullable_text(T::TriggerContext))
        .col(varchar(T::Requester, 256))
        .col(varchar(T::TurnIdentity, 256))
        .col(varchar(T::SessionId, 64))
        .col(varchar(T::State, 24))
        .col(int(T::Revision))
        .col(nullable_text(T::Plan))
        .col(nullable_varchar(T::PlanFingerprint, 64))
        .col(nullable_varchar(T::ChosenOptionId, 16))
        .col(nullable_varchar(T::ApprovedBy, 256))
        .col(nullable_bigint(T::ApprovedAtUs))
        .col(varchar(T::ApprovalChannel, 16))
        .col(nullable_bigint(T::ApprovalDeadlineUs))
        .col(nullable_bigint(T::TurnDeadlineUs))
        .col(nullable_bigint(T::TurnStartedAtUs))
        .col(nullable_bigint(T::CheckRetriedAtUs))
        .col(nullable_text(T::SlackRef))
        .col(nullable_varchar(T::OutcomeVerdict, 16))
        .col(nullable_text(T::OutcomeExplanation))
        .col(nullable_varchar(T::PriorVerdict, 16))
        .col(nullable_text(T::Error))
        .col(varchar(T::IdempotencyKey, 64))
        .col(bigint(T::CreatedAtUs))
        .col(bigint(T::UpdatedAtUs))
        .col(nullable_bigint(T::EndedAtUs))
        .to_owned()
}

fn run_connections_table() -> TableCreateStatement {
    use AutoresolveRunConnections as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(varchar(T::Org, 256))
        .col(varchar(T::RunId, 27))
        .col(varchar(T::ConnectionId, 64))
        .primary_key(
            Index::create()
                .name("pk_autoresolve_run_connections")
                .col(T::RunId)
                .col(T::ConnectionId),
        )
        .to_owned()
}

fn steps_table() -> TableCreateStatement {
    use AutoresolveSteps as T;
    Table::create()
        .table(T::Table)
        .if_not_exists()
        .col(varchar(T::Id, 27).primary_key().to_owned())
        .col(varchar(T::Org, 256))
        .col(varchar(T::RunId, 27))
        .col(int(T::Revision))
        .col(nullable_varchar(T::OptionId, 16))
        .col(int(T::Seq))
        .col(varchar(T::Kind, 16))
        .col(varchar(T::ConnectionId, 64))
        .col(varchar(T::ConnectionName, 256))
        .col(varchar(T::Tool, 256))
        .col(text(T::Arguments))
        .col(text(T::Refs))
        .col(varchar(T::ArgsHash, 64))
        .col(text(T::Reason))
        .col(nullable_text(T::Preview))
        .col(varchar(T::ToolDefHash, 64))
        .col(nullable_varchar(T::ConnectionFingerprint, 64))
        .col(varchar(T::State, 24))
        .col(nullable_text(T::Result))
        .col(nullable_text(T::ResultRaw))
        .col(nullable_text(T::Error))
        .col(nullable_bigint(T::ConsumedAtUs))
        .col(nullable_bigint(T::FinishedAtUs))
        .col(bigint(T::CreatedAtUs))
        .to_owned()
}

fn indexes() -> [IndexCreateStatement; 10] {
    [
        Index::create()
            .if_not_exists()
            .name(AUTORESOLVE_NAME_IDX)
            .table(Autoresolve::Table)
            .col(Autoresolve::Org)
            .col(Autoresolve::Name)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(AUTORESOLVE_TRIGGER_IDX)
            .table(Autoresolve::Table)
            .col(Autoresolve::Org)
            .col(Autoresolve::Region)
            .col(Autoresolve::TriggerKind)
            .col(Autoresolve::TriggerAlertId)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RUNS_IDEMPOTENCY_IDX)
            .table(AutoresolveRuns::Table)
            .col(AutoresolveRuns::Org)
            .col(AutoresolveRuns::IdempotencyKey)
            .unique()
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RUNS_CREATED_IDX)
            .table(AutoresolveRuns::Table)
            .col(AutoresolveRuns::Org)
            .col(AutoresolveRuns::CreatedAtUs)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RUNS_APPROVAL_IDX)
            .table(AutoresolveRuns::Table)
            .col(AutoresolveRuns::State)
            .col(AutoresolveRuns::ApprovalDeadlineUs)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RUNS_TURN_IDX)
            .table(AutoresolveRuns::Table)
            .col(AutoresolveRuns::State)
            .col(AutoresolveRuns::TurnDeadlineUs)
            .to_owned(),
        // One live run per saved AutoResolve holds across nodes; these are the states that are not
        // ended, `waiting_approval` included.
        Index::create()
            .if_not_exists()
            .name(RUNS_LIVE_IDX)
            .table(AutoresolveRuns::Table)
            .col(AutoresolveRuns::Org)
            .col(AutoresolveRuns::AutoresolveId)
            .unique()
            .and_where(Expr::col(AutoresolveRuns::AutoresolveId).is_not_null())
            .and_where(
                Expr::col(AutoresolveRuns::State).is_in(
                    [
                        RunState::Investigating,
                        RunState::WaitingApproval,
                        RunState::Proceeding,
                        RunState::Checking,
                    ]
                    .map(|s| s.as_str()),
                ),
            )
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(RUN_CONNECTIONS_IDX)
            .table(AutoresolveRunConnections::Table)
            .col(AutoresolveRunConnections::Org)
            .col(AutoresolveRunConnections::ConnectionId)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(STEPS_RUN_IDX)
            .table(AutoresolveSteps::Table)
            .col(AutoresolveSteps::RunId)
            .col(AutoresolveSteps::Revision)
            .col(AutoresolveSteps::OptionId)
            .col(AutoresolveSteps::Seq)
            .to_owned(),
        Index::create()
            .if_not_exists()
            .name(STEPS_CONSUMED_IDX)
            .table(AutoresolveSteps::Table)
            .col(AutoresolveSteps::State)
            .col(AutoresolveSteps::ConsumedAtUs)
            .to_owned(),
    ]
}
