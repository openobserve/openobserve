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

//! On-call shared types — in `config` because `infra` and `o2_enterprise` both name them.

pub mod agent;
pub mod confidence;
pub mod contact;
pub mod policy;
pub mod preset;
pub mod rca;
pub mod rca_run;
pub mod response;
pub mod rotation;
pub mod routing;
pub mod subject;
pub mod target;
pub mod team;

pub use agent::{
    AnalysisState, AnalysisStatus, AnalysisVerdict, Confidence, ConfidenceRefusal, GatePlan,
    L0Error, L0Metric, L0Mode, L0Modes, L0Policy, PageAction, PageRecommendation, ProposedAction,
    SeverityDecision, VerdictOutcome, analysis_status_for_start, apply_verdict, confidence_refusal,
    gate_plan, metrics_for, promotion_note, quieter_channels, ratchet, severity_pages,
    update_channels, verdict_lines,
};
pub use confidence::{
    CauseGrade, ConfidenceGrade, GradeReason, SignalClass, ToolCallRecord, UnverifiedCitation,
    UnverifiedReason, apply_outcome, grade_confidence, match_citation, min_band, normalize_key_arg,
    signal_class, stream_type,
};
pub use contact::{
    CODE_MAX_ATTEMPTS, CODE_TTL_MICROS, CodeCheck, CodeRow, Contact, ContactError, SEND_GAP_MICROS,
    SEND_WINDOW_MICROS, SENDS_PER_NUMBER_PER_WINDOW, SENDS_PER_USER_PER_WINDOW, SendDecision,
    WaitLimit, code_check, code_send_decision, next_counts, to_e164, wait_message,
};
pub use policy::{
    Admission, AfterRung, BREAKER_OPEN_MICROS, BREAKER_WINDOW_MICROS, CHANNEL_ORDER, Channel,
    ChannelBreaker, DEFAULT_PAGING_PRIORITY, EscalationPolicy, LadderAction, LadderStep,
    MAX_FANOUT_TEAMS, MAX_SEND_ATTEMPTS, MAX_TRANSPORT_ATTEMPTS, MAX_TRANSPORT_BACKOFF_MICROS,
    PolicyError, PriorityRung, RungOutcome, SEND_LIMIT_MICROS, TRANSPORT_BACKOFF_MICROS,
    after_rung, fanout_capped_note, fanout_note, personal_channels, plan, retry_delay_micros,
};
pub use preset::{
    CATCH_ALL_PRIORITY, DEFAULT_HANDOVER_MICROS, Group, MAX_FOLLOW_THE_SUN_GROUPS,
    MAX_GROUP_MEMBERS, MAX_HANDOVER_MICROS, MIN_FOLLOW_THE_SUN_GROUPS, MIN_HANDOVER_MICROS,
    PresetDescriptor, PresetError, PresetId, PresetInput, PresetInputKind, PresetSpec,
    RESTRICTED_PRIORITY, RegionGroup, build as build_preset, catalogue as preset_catalogue,
};
pub use rca::RcaContext;
pub use response::{
    DEFAULT_FLAP_DAMPENING_SECS, FIRST_LADDER_RUN, NoBlastRadius, PageDecision, ResolutionCause,
    ResponderRole, Response, ResponseEvent, ResponseEventKind, ResponseState, UpstreamRecovery,
    dependents_all_clear, flap_note, next_ladder_run, page_decision, upstream_recovery,
};
pub use rotation::{
    AwayShift, CoverageSegment, DEFAULT_ROTATION_NAME, DEFAULT_SHIFT_RULE_NAME, GridError,
    MAX_AWAY_SHIFTS, MAX_GRID_MICROS, MAX_GRID_SEGMENTS, MAX_ROTATION_NAME_CHARS, MICROS_PER_DAY,
    MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_WEEK, OVERRIDE_ROTATION_NAME, OnCallPosition,
    Rotation, RotationError, SECONDARY_ROTATION_NAME, SOURCE_DEFAULT, ScheduleOverride, ShiftRule,
    ShiftRuleError, TimeWindow, Unavailability, away_assignments, colliding_rotations,
    covering_override, covering_override_for, everyone_on_call, is_unavailable, resolve_on_call,
    resolve_window,
};
pub use routing::{
    DimensionDepth, OwnershipError, OwnershipRule, Routed, RoutingConfig, RoutingDecision,
    RoutingInputs, SERVICE_DIMENSION, UnroutedSignal, canonical_path, outstanding, resolve_owner,
    resolve_owner_ranked, route,
};
pub use subject::{SubjectError, SubjectRef, SubjectType};
pub use target::{EscalationTarget, RotationMode, TargetError};
pub use team::{
    MemberPlacement, MemberRemoval, Schedule, Team, TeamError, TeamMember, place_member,
};
