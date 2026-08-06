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

pub mod level;
pub mod policy;
pub mod response;
pub mod rotation;
pub mod subject;
pub mod team;

pub use level::{EscalationLevel, LevelError};
pub use policy::{
    Channel, EscalationPolicy, LadderAction, LadderStep, PolicyError, PriorityRung, plan,
};
pub use response::{Response, ResponseError, ResponseEvent, ResponseEventKind, ResponseState};
pub use rotation::{
    MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_WEEK, OnCallSlot, Rotation,
    RotationError, resolve_level, resolve_on_call,
};
pub use subject::{SubjectError, SubjectRef, SubjectType};
pub use team::{Schedule, Team, TeamError, TeamMember};
