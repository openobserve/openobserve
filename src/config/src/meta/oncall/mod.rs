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
pub mod contact;
pub mod policy;
pub mod preset;
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
pub use contact::{Contact, ContactError, normalize_phone};
pub use target::{EscalationTarget, TargetError};
pub use policy::{
    AfterRung, BREAKER_OPEN_MICROS, BREAKER_WINDOW_MICROS, Channel, ChannelBreaker,
    DEFAULT_PAGING_PRIORITY, DEFAULT_REPEAT_COUNT, EscalationPolicy, FALLBACK_ORDER, FinalAction,
    LadderAction, LadderEnd, LadderStep, MAX_REPEAT_COUNT, MAX_SEND_ATTEMPTS,
    MAX_TRANSPORT_ATTEMPTS, MAX_TRANSPORT_BACKOFF_MICROS, PolicyError, PriorityRung, RungOutcome,
    TRANSPORT_BACKOFF_MICROS, after_rung, fallback_chain, ladder_end, plan, retry_delay_micros,
};
pub use preset::{
    CATCH_ALL_PRIORITY, DEFAULT_HANDOVER_MICROS, Group, MAX_FOLLOW_THE_SUN_GROUPS,
    MAX_GROUP_MEMBERS, MAX_HANDOVER_MICROS, MIN_FOLLOW_THE_SUN_GROUPS, MIN_HANDOVER_MICROS,
    PresetDescriptor, PresetError, PresetId, PresetInput, PresetInputKind, PresetSpec,
    RESTRICTED_PRIORITY, RegionGroup, build as build_preset, catalogue as preset_catalogue,
};
pub use response::{
    FIRST_LADDER_RUN, ResolutionCause, ResponderRole, Response, ResponseError, ResponseEvent,
    ResponseEventKind, ResponseState, UpstreamRecovery, dependents_all_clear, next_ladder_run,
    upstream_recovery,
};
pub use rotation::{
    AwayShift, CoverageSegment, DEFAULT_SLOT, GridError, MAX_AWAY_SHIFTS, MAX_GRID_MICROS,
    MAX_GRID_SEGMENTS, MAX_SLOT_CHARS, MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_MINUTE,
    MICROS_PER_WEEK, OVERRIDE_ROTATION_NAME, OnCallSlot, Rotation, RotationError, ScheduleOverride,
    TimeWindow, Unavailability, away_assignments, covering_override, covering_override_in_slot,
    everyone_in_slot, everyone_on_schedule, is_unavailable, next_on_call, next_on_call_in_slot,
    on_call_in_slot, on_call_now, resolve_on_call, resolve_window, resolve_window_in_slot,
    same_slot, slots, winning_rotation, winning_rotation_in_slot,
};
pub use routing::{
    ContextTeam, OwnershipError, OwnershipRule, Routed, RoutingConfig, RoutingDecision,
    RoutingInputs, UnroutedSignal, canonical_path, outstanding, resolve_owner, route,
};
pub use subject::{SubjectError, SubjectRef, SubjectType};
pub use team::{
    MemberPlacement, MemberRemoval, Schedule, Team, TeamError, TeamMember, place_member,
};
