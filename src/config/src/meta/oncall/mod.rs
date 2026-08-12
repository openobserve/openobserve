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

//! On-call — shared types.
//!
//! Lives in `config` because `infra` must name what it stores and
//! `o2_enterprise` must name what it operates on; `config` is the crate both
//! depend on. The behaviour that makes on-call an enterprise feature lives in
//! `o2_enterprise::enterprise::oncall`.
//!
//! Everything here is data plus pure functions over it — no I/O, no clock.
//! Instants are passed in as microseconds, matching
//! `config::utils::time::now_micros`.

pub mod agent;
pub mod policy;
pub mod response;
pub mod rotation;
pub mod routing;
pub mod subject;
pub mod target;
pub mod team;

pub use agent::{
    AnalysisState, AnalysisStatus, AnalysisVerdict, Confidence, GatePlan, L0Error, L0Metric,
    L0Mode, L0Modes, L0Policy, PageAction, PageRecommendation, ParsedReport, ProposedAction,
    SeverityDecision, VerdictOutcome, analysis_status_for_start, apply_verdict, first_page_at,
    gate_plan, metrics_for, parse_report, promotion_note, quieter_channels, ratchet,
    severity_pages, update_channels, verdict_lines,
};
pub use target::{EscalationTarget, TargetError};
pub use policy::{
    Channel, DEFAULT_PAGING_PRIORITY, EscalationPolicy, LadderAction, LadderStep, PolicyError,
    PriorityRung, plan,
};
pub use response::{
    FIRST_LADDER_RUN, ResolutionCause, ResponderRole, Response, ResponseError, ResponseEvent,
    ResponseEventKind, ResponseState, next_ladder_run,
};
pub use rotation::{
    CoverageSegment, GridError, MAX_GRID_MICROS, MAX_GRID_SEGMENTS, MICROS_PER_DAY,
    MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_WEEK, OVERRIDE_ROTATION_NAME, OnCallSlot,
    Rotation, RotationError, ScheduleOverride, TimeWindow, covering_override,
    everyone_on_schedule, next_on_call, on_call_now, resolve_on_call, resolve_window,
    winning_rotation,
};
pub use routing::{
    ContextTeam, OwnershipError, OwnershipRule, Routed, RoutingConfig, RoutingDecision,
    RoutingInputs, UnroutedSignal, canonical_path, outstanding, resolve_owner, route,
};
pub use subject::{SubjectError, SubjectRef, SubjectType};
pub use team::{
    MemberPlacement, MemberRemoval, Schedule, Team, TeamError, TeamMember, place_member,
};
