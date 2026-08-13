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

//! Rotations — who holds a level, at an instant.
//!
//! A rotation is an ordered list of people and a fixed shift length anchored
//! to a start instant. Resolution is a pure function of `(rotation, at)`: no
//! clock is read here, which is what makes handovers, boundaries and
//! out-of-order replays testable.
//!
//! Layers, restriction windows and overrides all sit on top of that. They
//! change *which* rotation applies to an instant — or replace its answer
//! outright, in the case of an override — but never how a single rotation
//! resolves. Resolution order is `architecture/02` §3b, top down: an override
//! beats every layer, then layers in priority order, then nobody, which is a
//! coverage gap rather than an error.
//!
//! **Slots** cut across all of that. A slot is an independently-resolved
//! position — `primary`, `secondary`, whatever a team names one — and layering
//! happens *within* a slot, never across. Two slots are two answers at the same
//! instant, which is how a senior pool backs a junior pool without the two
//! sharing a handover day. Everything that predates slots reads as
//! [`DEFAULT_SLOT`], so a one-rotation team notices nothing.

use chrono::{Datelike, LocalResult, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The slot every rotation, override and rung belongs to unless it says
/// otherwise.
///
/// It is a stored default rather than an `Option` at every call site because
/// "which slot" has an answer for every rotation that has ever existed — the
/// ones written before slots were a concept are the team's primary, and reading
/// them as anything else would change what stored data means.
pub const DEFAULT_SLOT: &str = "primary";

/// The longest slot name that will be stored. A slot is a label on a screen and
/// a key in a ladder, not a place to put a sentence.
pub const MAX_SLOT_CHARS: usize = 64;

pub(crate) fn default_slot() -> String {
    DEFAULT_SLOT.to_string()
}

fn is_default_slot(slot: &str) -> bool {
    same_slot(slot, DEFAULT_SLOT)
}

/// Whether two slot names mean the same slot.
///
/// Case-insensitive for the same reason member emails are: `Secondary` typed
/// into the schedule editor and `secondary` typed into the ladder are one slot
/// to everybody except a byte comparison, and the failure that produces is a
/// rung that resolves to nobody with no visible cause.
pub fn same_slot(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Microseconds in one hour — shift lengths are stored in micros to match the
/// scheduler's unit (`config::utils::time::now_micros`).
pub const MICROS_PER_MINUTE: i64 = 60_000_000;
pub const MICROS_PER_HOUR: i64 = 60 * MICROS_PER_MINUTE;
pub const MICROS_PER_DAY: i64 = 24 * MICROS_PER_HOUR;
pub const MICROS_PER_WEEK: i64 = 7 * MICROS_PER_DAY;

/// When a rotation applies, in the schedule's own timezone.
///
/// Follow-the-sun is three restricted rotations over one unrestricted
/// catch-all; weekday/weekend is two. The window is expressed in local wall
/// time because that is how people describe their hours — "I cover 09:00 to
/// 17:00" means their 09:00, not UTC's.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct TimeWindow {
    /// 0 = Monday … 6 = Sunday. Empty means every day.
    #[serde(default)]
    pub days: Vec<u8>,
    /// Minutes from local midnight, inclusive.
    pub start_minute: u32,
    /// Minutes from local midnight, exclusive.
    ///
    /// May be LESS than `start_minute`, which means the window wraps midnight
    /// (a 22:00–06:00 night shift). Splitting that into two windows would make
    /// the common case the awkward one.
    pub end_minute: u32,
}

impl TimeWindow {
    pub fn contains(&self, at_micros: i64, tz: chrono_tz::Tz) -> bool {
        let Some(local) = chrono::DateTime::from_timestamp_micros(at_micros)
            .map(|utc| tz.from_utc_datetime(&utc.naive_utc()))
        else {
            return false;
        };
        self.covers_local(
            local.weekday().num_days_from_monday() as u8,
            local.hour() * 60 + local.minute(),
        )
    }

    /// Whether the window covers a wall-clock reading, given as a day of the
    /// week (0 = Monday) and minutes past local midnight.
    ///
    /// Split out from [`TimeWindow::contains`] so that the question "do these
    /// two windows both cover some minute of the week?" can be asked without
    /// inventing instants to ask it with. The schedule presets need exactly
    /// that to refuse two layers that would be equally in force, and a second
    /// copy of this rule would be a second chance for it to drift.
    pub fn covers_local(&self, day: u8, minute: u32) -> bool {
        let in_time = if self.start_minute <= self.end_minute {
            minute >= self.start_minute && minute < self.end_minute
        } else {
            // Wrapped: the window is the two ends of the day joined together.
            minute >= self.start_minute || minute < self.end_minute
        };
        if !in_time {
            return false;
        }
        // A wrapped window's early-morning half belongs to the PREVIOUS day's
        // shift, so that is the day the restriction is judged against.
        let effective_day = if self.start_minute > self.end_minute && minute < self.end_minute {
            (day + 6) % 7
        } else {
            day
        };
        self.days.is_empty() || self.days.contains(&effective_day)
    }
}

/// One level's rotation within a schedule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Rotation {
    /// What this rotation is called. Rotations used to be identified by the
    /// escalation level they filled, which forced one rotation per level; they
    /// are now just named shifts, and the ladder decides who it pages.
    #[serde(default = "default_rotation_name")]
    pub name: String,
    /// Which independently-resolved position this rotation staffs.
    ///
    /// Rotations sharing a slot are **layers**: priority, restrictions and
    /// validity windows decide which of them is in force, exactly as before.
    /// Rotations in different slots do not compete at all — both resolve, at
    /// the same instant, to different people. That is what makes a secondary a
    /// separate pool rather than next week's primary, and it is why the slot is
    /// a property of the rotation rather than of the ladder: the ladder names a
    /// slot, but the slot has to exist whether or not any rung mentions it.
    ///
    /// Absent from the wire when it is the default, so every rotation written
    /// before slots existed serialises back byte-for-byte as it was stored —
    /// which is what makes "nothing preset-specific is stored" (§C.3) still
    /// true, and what stops an upgrade from rewriting every schedule row.
    #[serde(default = "default_slot", skip_serializing_if = "is_default_slot")]
    pub slot: String,
    /// Participants in handover order. Emails, because email is the login and
    /// therefore the one identifier every user is guaranteed to have.
    pub members: Vec<String>,
    /// Length of one shift, in microseconds. Must be > 0.
    pub shift_micros: i64,
    /// Instant at which `members[0]`'s first shift begins, in microseconds.
    ///
    /// Shifts before this instant resolve too — the sequence extends
    /// backwards — so an anchor set in the future is not an error, it just
    /// means the cycle is counted from there.
    pub anchor_micros: i64,
    /// Higher wins when two rotations both apply at the same instant.
    ///
    /// Explicit rather than positional: PagerDuty orders layers by their
    /// position in a list, which means reordering the UI silently changes who
    /// gets paged. A number you can read is worth the extra field.
    #[serde(default)]
    pub priority: i32,
    /// When this rotation applies. Empty means always — the catch-all every
    /// follow-the-sun setup needs underneath the restricted layers.
    #[serde(default)]
    pub restrictions: Vec<TimeWindow>,
    /// The layer is not in effect before this instant. `None` means "since
    /// forever".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starts_at: Option<i64>,
    /// The layer is not in effect at or after this instant. `None` means
    /// "until further notice".
    ///
    /// This is how a layer is **retired** (`architecture/02` §3b). Until it
    /// existed the only way to stop a layer was to delete it, which threw away
    /// the record of who had been covering those hours — so "the weekend
    /// rotation ended in March" was not a thing the schedule could say.
    /// Exclusive, like every other boundary here: the end instant already
    /// belongs to whatever takes over.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
}

/// Why a rotation was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RotationError {
    NoMembers,
    NonPositiveShift(i64),
    /// A person appears twice in the same rotation, which would silently
    /// double their share of the on-call load.
    DuplicateMember(String),
    /// A rotation with no name cannot be told apart from another on a
    /// calendar, which is the only place two of them are ever seen together.
    NoName,
    /// A validity window that ends before it starts is in effect at no instant
    /// at all, so the layer would silently never apply.
    EmptyValidityWindow { starts_at: i64, ends_at: i64 },
    /// A rotation with a blank or over-long slot. Blank is not the default —
    /// the default is applied when the field is *absent*, so a field present
    /// and empty is somebody clearing a box, and a rotation nothing can name is
    /// a rotation no rung can page.
    BadSlot(String),
}

impl std::fmt::Display for RotationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoMembers => f.write_str("rotation must have at least one member"),
            Self::NonPositiveShift(v) => {
                write!(f, "shift length must be positive, got {v} micros")
            }
            Self::DuplicateMember(m) => write!(f, "duplicate rotation member `{m}`"),
            Self::NoName => f.write_str("rotation must have a name"),
            Self::EmptyValidityWindow { starts_at, ends_at } => write!(
                f,
                "rotation ends at {ends_at} but starts at {starts_at}, so it applies at no instant"
            ),
            Self::BadSlot(s) if s.trim().is_empty() => {
                f.write_str("a rotation's slot cannot be blank")
            }
            Self::BadSlot(s) => write!(
                f,
                "slot `{s}` is longer than the {MAX_SLOT_CHARS} characters a slot name may have"
            ),
        }
    }
}

impl std::error::Error for RotationError {}

impl Rotation {
    /// A weekly rotation handing over at `anchor_micros`, in the default slot.
    pub fn weekly(name: impl Into<String>, members: Vec<String>, anchor_micros: i64) -> Self {
        Self {
            name: name.into(),
            slot: default_slot(),
            members,
            shift_micros: MICROS_PER_WEEK,
            anchor_micros,
            priority: 0,
            restrictions: Vec::new(),
            starts_at: None,
            ends_at: None,
        }
    }

    /// The same rotation, staffing a named slot.
    pub fn in_slot(mut self, slot: impl Into<String>) -> Self {
        self.slot = slot.into();
        self
    }

    /// Whether this rotation staffs `slot`.
    pub fn is_in_slot(&self, slot: &str) -> bool {
        same_slot(&self.slot, slot)
    }

    /// Whether the layer itself is live at `at`, ignoring its restrictions.
    ///
    /// Separate from [`Rotation::applies_at`] because the two answer different
    /// questions: the validity window says whether this layer exists at all at
    /// that point in the schedule's life, and the restrictions say which hours
    /// it covers while it does.
    pub fn in_effect_at(&self, at_micros: i64) -> bool {
        self.starts_at.is_none_or(|s| at_micros >= s)
            && self.ends_at.is_none_or(|e| at_micros < e)
    }

    /// Whether this rotation is in force at `at`.
    ///
    /// Windows are ORed: a rotation covering "weekday mornings or weekend
    /// afternoons" is two windows, and matching either is enough. A layer
    /// outside its validity window is not in force whatever its restrictions
    /// say — retiring a layer has to mean retiring it.
    pub fn applies_at(&self, at_micros: i64, tz: chrono_tz::Tz) -> bool {
        self.in_effect_at(at_micros)
            && (self.restrictions.is_empty()
                || self.restrictions.iter().any(|w| w.contains(at_micros, tz)))
    }

    pub fn validate(&self) -> Result<(), RotationError> {
        if self.name.trim().is_empty() {
            return Err(RotationError::NoName);
        }
        if self.slot.trim().is_empty() || self.slot.chars().count() > MAX_SLOT_CHARS {
            return Err(RotationError::BadSlot(self.slot.clone()));
        }
        if self.members.is_empty() {
            return Err(RotationError::NoMembers);
        }
        if self.shift_micros <= 0 {
            return Err(RotationError::NonPositiveShift(self.shift_micros));
        }
        let mut seen = std::collections::HashSet::with_capacity(self.members.len());
        for m in &self.members {
            if !seen.insert(m.to_ascii_lowercase()) {
                return Err(RotationError::DuplicateMember(m.clone()));
            }
        }
        if let (Some(starts_at), Some(ends_at)) = (self.starts_at, self.ends_at)
            && ends_at <= starts_at
        {
            return Err(RotationError::EmptyValidityWindow { starts_at, ends_at });
        }
        Ok(())
    }

    /// Instant at which handover number `index` happens, counted from the
    /// anchor. `index` may be negative: the sequence extends backwards.
    ///
    /// The boundary is a **wall-clock** fact — "Mondays at 09:00" — so it is
    /// computed in the schedule's local calendar and converted back to an
    /// instant afterwards.
    fn boundary(&self, index: i64, tz: chrono_tz::Tz) -> Option<i64> {
        let local_anchor = to_local_micros(self.anchor_micros, tz)?;
        let offset = index.checked_mul(self.shift_micros)?;
        from_local_micros(local_anchor.checked_add(offset)?, tz)
    }

    /// Zero-based index of the shift containing `at`.
    ///
    /// Counted in the schedule's local wall time, not in elapsed micros. A
    /// weekly 09:00 handover has to stay at 09:00 for the people living it,
    /// and elapsed micros move it to 08:00 or 10:00 the moment the zone
    /// changes offset — so the shift straddling a transition is 23 or 25 hours
    /// long, exactly as `architecture/02` §9 says.
    ///
    /// Floor division rather than truncating division, so that instants before
    /// the anchor land on the shift that actually contains them. Truncating
    /// division maps both `-1` and `+1` micros from the anchor to shift 0,
    /// which would make the same person on call for two consecutive shifts.
    fn shift_index(&self, at: i64, tz: chrono_tz::Tz) -> Option<i64> {
        let local_at = to_local_micros(at, tz)?;
        let local_anchor = to_local_micros(self.anchor_micros, tz)?;
        let mut index = local_at
            .checked_sub(local_anchor)?
            .div_euclid(self.shift_micros);

        // The local count can be one out on either side of a transition: the
        // two instants are read against different offsets, and inside a
        // repeated hour the local clock walks backwards. Settle it against the
        // real instants of the boundaries themselves, which are monotonic —
        // that is what stops a fall-back handover from happening twice.
        for _ in 0..MAX_BOUNDARY_CORRECTIONS {
            if self.boundary(index, tz).is_some_and(|b| b > at) {
                index -= 1;
                continue;
            }
            if self.boundary(index + 1, tz).is_some_and(|b| b <= at) {
                index += 1;
                continue;
            }
            break;
        }
        Some(index)
    }

    /// Who holds this level at `at`, or `None` if the rotation is unusable.
    ///
    /// Returning `None` rather than a fallback is deliberate: an unstaffed
    /// level must surface as a coverage gap, never as a silently dropped page.
    pub fn member_at(&self, at: i64, tz: chrono_tz::Tz) -> Option<&str> {
        self.member_offset(at, 0, tz)
    }

    /// The member `offset` handovers after the one on shift at `at`.
    ///
    /// Offset 1 is what a "secondary" is: the person this rotation hands over
    /// to next. Expressing it this way is why a team needs one rotation rather
    /// than one per escalation level.
    pub fn member_offset(&self, at: i64, offset: i64, tz: chrono_tz::Tz) -> Option<&str> {
        if self.validate().is_err() {
            return None;
        }
        let len = self.members.len() as i64;
        let idx = (self.shift_index(at, tz)? + offset).rem_euclid(len);
        self.members.get(idx as usize).map(|s| s.as_str())
    }

    /// The rotation's members in ladder order at `at`: whoever is on shift
    /// first, then the person they hand over to, and so on round the cycle.
    ///
    /// This is the one place the cycle is unrolled, and everything that has to
    /// pick "the next available person" walks this list rather than doing its
    /// own arithmetic on `member_offset`. Two copies of that arithmetic is two
    /// chances for the on-call and the secondary to disagree about whose turn
    /// it is.
    pub fn order_at(&self, at: i64, tz: chrono_tz::Tz) -> Vec<&str> {
        if self.validate().is_err() {
            return Vec::new();
        }
        let Some(index) = self.shift_index(at, tz) else {
            return Vec::new();
        };
        let len = self.members.len() as i64;
        (0..len)
            .filter_map(|offset| {
                self.members
                    .get((index + offset).rem_euclid(len) as usize)
                    .map(String::as_str)
            })
            .collect()
    }

    /// Who holds this rotation at `at`, **skipping anybody who is away**.
    ///
    /// The skip rule, stated once because everything else follows from it: the
    /// shift passes to the next person in the handover order who is not away at
    /// that instant, and to nobody else. It is a pure function of the rotation,
    /// the instant, and the absence windows — so it gives the same answer on
    /// every node, on every call, and after any number of replays.
    ///
    /// **Whose turn does it move?** Only the away person's. The alternative —
    /// re-dealing the whole cycle so that everybody after the skipped shift
    /// slides along — is the model a reader first imagines, and it is the wrong
    /// one: it makes today's answer depend on every absence ever recorded
    /// before it, so adding one holiday in October reshuffles the grid for
    /// November, and the schedule somebody agreed to is not the schedule they
    /// get. Here, marking Ana away changes exactly the shifts Ana would have
    /// held, and nobody else's row on the calendar moves.
    ///
    /// `None` when every member is away, which is a coverage gap — the same
    /// answer an empty rotation gives, reported by the same sweep. Bounded by
    /// the member count, so it can neither loop nor spin on the paging path.
    pub fn available_member_at(
        &self,
        at: i64,
        tz: chrono_tz::Tz,
        unavailability: &[Unavailability],
    ) -> Option<&str> {
        self.order_at(at, tz)
            .into_iter()
            .find(|m| !is_unavailable(unavailability, m, at))
    }

    /// Instant at which the shift containing `at` began.
    pub fn shift_start(&self, at: i64, tz: chrono_tz::Tz) -> Option<i64> {
        if self.validate().is_err() {
            return None;
        }
        self.boundary(self.shift_index(at, tz)?, tz)
    }

    /// Instant at which the shift containing `at` ends — i.e. the next
    /// handover. Exclusive: the returned instant belongs to the next shift.
    pub fn next_handover(&self, at: i64, tz: chrono_tz::Tz) -> Option<i64> {
        if self.validate().is_err() {
            return None;
        }
        self.boundary(self.shift_index(at, tz)? + 1, tz)
    }
}

/// How many times the local estimate is allowed to be walked towards the real
/// boundary. A DST transition moves one boundary by at most a couple of hours,
/// so the estimate is never more than one shift out; the bound exists so that
/// a pathological zone cannot spin here on the paging path.
const MAX_BOUNDARY_CORRECTIONS: u8 = 4;

/// The widest DST gap any zone has ever used is an hour; the loop is bounded
/// well past that so a future rule change cannot land a handover in a hole
/// this code refuses to climb out of.
const MAX_GAP_MINUTES: i64 = 180;

/// What the wall clock in `tz` reads at instant `at`, as micros on the local
/// calendar. Local readings are what handovers are expressed in, and
/// subtracting two of them is what makes a shift 23 or 25 hours across a
/// transition instead of always exactly 24.
fn to_local_micros(at: i64, tz: chrono_tz::Tz) -> Option<i64> {
    let utc = chrono::DateTime::from_timestamp_micros(at)?;
    Some(
        tz.from_utc_datetime(&utc.naive_utc())
            .naive_local()
            .and_utc()
            .timestamp_micros(),
    )
}

/// The instant at which the wall clock in `tz` reads `local`.
///
/// Two readings have no single answer, and both are handover times somebody
/// will really be woken by:
///
/// - **Fall back.** The clock reads 01:30 twice. The handover is the *first*
///   of them; taking the second would leave the outgoing engineer on call for
///   an extra hour, and taking both would hand over twice.
/// - **Spring forward.** The clock never reads 02:30 at all. The handover is
///   the first instant the clock does reach — 03:00 — rather than being
///   skipped, which would silently extend a shift by a whole cycle.
fn from_local_micros(local: i64, tz: chrono_tz::Tz) -> Option<i64> {
    let naive = chrono::DateTime::from_timestamp_micros(local)?.naive_utc();
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Some(dt.timestamp_micros()),
        LocalResult::Ambiguous(first, _) => Some(first.timestamp_micros()),
        LocalResult::None => (1..=MAX_GAP_MINUTES).find_map(|minutes| {
            match tz.from_local_datetime(&(naive + chrono::Duration::minutes(minutes))) {
                LocalResult::Single(dt) => Some(dt.timestamp_micros()),
                LocalResult::Ambiguous(first, _) => Some(first.timestamp_micros()),
                LocalResult::None => None,
            }
        }),
    }
}

/// Everyone on call for a team at an instant, one entry per staffed level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OnCallSlot {
    /// Which slot this staffs — `primary`, `secondary`, or whatever the team
    /// named one. One entry per slot in force, so a team running a senior pool
    /// behind a junior one gets two, resolved independently and at the same
    /// instant.
    #[serde(default = "default_slot")]
    pub slot: String,
    /// The rotation that produced this.
    pub rotation: String,
    pub user_email: String,
    /// Who it hands over to. `None` when the rotation has one member, because
    /// then there is nobody else and saying otherwise would be a lie.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_user_email: Option<String>,
    /// The override that put this person on call, if one did.
    ///
    /// Present so a page — and the schedule screen — can say *why* somebody
    /// who is not on the rotation is holding the pager. Without it a cover
    /// looks identical to a rotation somebody edited by hand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_id: Option<String>,
}

fn default_rotation_name() -> String {
    "Rotation".to_string()
}

/// What the resolved schedule calls a slot an override produced when no layer
/// was in force underneath it — a cover over a coverage gap.
pub const OVERRIDE_ROTATION_NAME: &str = "Override";

/// One person taking a bounded slice of somebody else's on-call.
///
/// `architecture/02` §5: absolute ranges, no recurrence, stored in micros. An
/// override never mutates the rotation — deleting it restores the computed
/// result — which is why it is a separate record rather than an edit to the
/// member list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ScheduleOverride {
    pub id: String,
    pub org_id: String,
    pub team_id: String,
    /// Which slot is being covered. `None` is the default slot, which is what
    /// every override written before slots existed meant.
    ///
    /// A cover has to name a slot for the same reason a rung does: without one,
    /// arranging cover for the primary would silently put the same person in
    /// the secondary as well, and the ladder would page them twice and call the
    /// second one an escalation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    /// Who is actually holding the pager for this window.
    pub user_email: String,
    /// Inclusive.
    pub start_at: i64,
    /// Exclusive, so two back-to-back overrides never both cover the instant
    /// between them — the same rule the handover boundary follows.
    pub end_at: i64,
    /// Who is being covered. Optional: "cover tonight" is a real request even
    /// when nobody has worked out whose shift tonight is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub covering_for: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub created_by: String,
    pub created_at: i64,
}

impl ScheduleOverride {
    /// Which slot this cover stands over. An absent one means the default.
    pub fn slot(&self) -> &str {
        match self.slot.as_deref() {
            Some(s) if !s.trim().is_empty() => s,
            _ => DEFAULT_SLOT,
        }
    }

    /// Whether this override is the one in force at `at`.
    pub fn covers(&self, at: i64) -> bool {
        at >= self.start_at && at < self.end_at
    }

    /// Whether the override touches `[from, to)` at all — the predicate the
    /// window list and the resolved grid both filter on.
    pub fn overlaps(&self, from: i64, to: i64) -> bool {
        self.start_at < to && self.end_at > from
    }
}

/// One stretch during which a person is not to be given a shift.
///
/// **Org-wide, not per team.** Being on holiday is a fact about a person, and a
/// person who is on two teams is away from both. Storing it per team means the
/// same window has to be written twice, and the failure mode of forgetting the
/// second one is the exact failure this exists to prevent: a page landing on
/// somebody who is on a beach. It is also who enters it — the person going
/// away, once, not each of their team leads.
///
/// Absolute instants in micros, like an override, and for the same reason:
/// recurrence is a calendar feature and a schedule that guesses which Fridays
/// somebody meant is a schedule that guesses wrong at 3am.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Unavailability {
    pub id: String,
    pub org_id: String,
    /// Whose absence. Email, because email is the login.
    pub user_email: String,
    /// Inclusive.
    pub start_at: i64,
    /// Exclusive, matching every other boundary here: the end instant already
    /// belongs to the shift they are back for.
    pub end_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub created_by: String,
    pub created_at: i64,
}

impl Unavailability {
    /// Whether this window is in force at `at`.
    pub fn covers(&self, at: i64) -> bool {
        at >= self.start_at && at < self.end_at
    }

    /// Whether the window touches `[from, to)` at all.
    pub fn overlaps(&self, from: i64, to: i64) -> bool {
        self.start_at < to && self.end_at > from
    }

    pub fn is(&self, user_email: &str) -> bool {
        self.user_email.trim().eq_ignore_ascii_case(user_email.trim())
    }
}

/// Whether `user_email` is away at `at`.
///
/// Stated once, here, so that the resolver, the calendar and the edit-time
/// warning cannot come to different conclusions about the same window — which
/// is how a screen ends up promising that somebody will be skipped while the
/// paging path still reaches them.
pub fn is_unavailable(unavailability: &[Unavailability], user_email: &str, at: i64) -> bool {
    unavailability
        .iter()
        .any(|u| u.covers(at) && u.is(user_email))
}

/// The override in force at `at`, or `None`.
///
/// **The overlap rule.** Overrides are allowed to overlap — refusing the second
/// one would mean somebody arranging cover at 2am has to work out what the
/// first one said before they can arrange the second, and the answer they want
/// is always "mine, I just agreed it". So the winner is the one created last:
/// `created_at` descending, and `id` descending to break a tie, because two
/// rows can share a microsecond and the answer still has to be the same on
/// every node. Ksuids are monotonic, so the id tiebreak is "created last" as
/// well rather than an arbitrary lexical pick.
///
/// This is `architecture/02` §5's rule — "latest `created_at` wins for the
/// overlapping interval" — stated once, here, so nothing else has to decide it.
pub fn covering_override(overrides: &[ScheduleOverride], at: i64) -> Option<&ScheduleOverride> {
    covering_override_in_slot(overrides, DEFAULT_SLOT, at)
}

/// The override in force over one slot at `at`.
///
/// Covers do not cross slots: arranging cover for the primary says nothing
/// about who backs them up, and letting one cover claim every slot at once
/// would collapse a two-pool team into one person for the length of the window.
pub fn covering_override_in_slot<'a>(
    overrides: &'a [ScheduleOverride],
    slot: &str,
    at: i64,
) -> Option<&'a ScheduleOverride> {
    overrides
        .iter()
        .filter(|o| o.covers(at) && same_slot(o.slot(), slot))
        .max_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)))
}

/// Every slot a schedule staffs, the default one first and the rest in the
/// order they appear.
///
/// The default leads because it is the one a screen reads first and the one
/// every rung means when it does not say; the rest keep the stored order so
/// that reordering the array in the editor is the only thing that reorders the
/// calendar.
pub fn slots(rotations: &[Rotation]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in rotations.iter().filter(|r| r.validate().is_ok()) {
        if !out.iter().any(|s| same_slot(s, &r.slot)) {
            out.push(r.slot.clone());
        }
    }
    if let Some(pos) = out.iter().position(|s| same_slot(s, DEFAULT_SLOT))
        && pos > 0
    {
        let default = out.remove(pos);
        out.insert(0, default);
    }
    out
}

/// The rotation in force for one level at `at`.
///
/// Only layers inside their validity window are considered — a retired layer
/// is not a layer — and then the highest priority among those whose
/// restrictions match wins; ties break on the more specific rotation (one WITH
/// restrictions beats the catch-all), then on anchor order so the answer is
/// stable across nodes. That last tiebreak
/// matters more than it looks: two equally-specific layers is a configuration
/// mistake, but it must still resolve the same way everywhere rather than
/// depending on row order.
pub fn winning_rotation(
    rotations: &[Rotation],
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<&Rotation> {
    winning_rotation_in_slot(rotations, DEFAULT_SLOT, at, tz)
}

/// The rotation in force for one **slot** at `at`.
///
/// Layering is a within-slot question and this is where that is enforced: the
/// candidates are filtered to the slot first, and the priority/restriction
/// contest is run over those alone. A follow-the-sun team whose layers all sit
/// in the default slot therefore resolves exactly as it did before slots
/// existed — the filter admits all of them — while a secondary slot beside it
/// runs its own, separate contest at the same instant.
pub fn winning_rotation_in_slot<'a>(
    rotations: &'a [Rotation],
    slot: &str,
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<&'a Rotation> {
    rotations
        .iter()
        .filter(|r| r.is_in_slot(slot) && r.validate().is_ok() && r.applies_at(at, tz))
        .max_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then_with(|| a.restrictions.len().cmp(&b.restrictions.len()))
                .then_with(|| b.anchor_micros.cmp(&a.anchor_micros))
        })
}

/// Who is on call at `at`, one slot per rotation in force.
///
/// Rotations that fail validation are skipped rather than defaulted, so a
/// broken one shows up as nobody on call — which is visible — instead of
/// silently paging the wrong person.
///
/// Step 1 of §3b's resolution is the override, so it is step 1 here: a cover
/// standing over a coverage gap still staffs the slot, and the slot names the
/// rotation underneath it when there is one so the screen can say what the
/// override displaced.
pub fn resolve_on_call(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    at: i64,
    tz: chrono_tz::Tz,
) -> Vec<OnCallSlot> {
    let mut names = slots(rotations);
    // A cover can staff a slot that has no rotation underneath it at all —
    // somebody taking the pager for a weekend the schedule does not cover. That
    // slot has to appear, or the one person actually holding it is invisible.
    for ov in overrides.iter().filter(|o| o.covers(at)) {
        if !names.iter().any(|s| same_slot(s, ov.slot())) {
            names.push(ov.slot().to_string());
        }
    }
    names
        .into_iter()
        .filter_map(|slot| {
            let winner = winning_rotation_in_slot(rotations, &slot, at, tz);
            if let Some(ov) = covering_override_in_slot(overrides, &slot, at) {
                return Some(OnCallSlot {
                    rotation: winner
                        .map(|r| r.name.clone())
                        .unwrap_or_else(|| OVERRIDE_ROTATION_NAME.to_string()),
                    user_email: ov.user_email.clone(),
                    next_user_email: next_on_call_in_slot(
                        rotations,
                        overrides,
                        unavailability,
                        &slot,
                        at,
                        tz,
                    ),
                    override_id: Some(ov.id.clone()),
                    slot,
                });
            }
            let r = winner?;
            let holder = r.available_member_at(at, tz, unavailability)?;
            Some(OnCallSlot {
                rotation: r.name.clone(),
                user_email: holder.to_string(),
                next_user_email: next_on_call_in_slot(
                    rotations,
                    overrides,
                    unavailability,
                    &slot,
                    at,
                    tz,
                ),
                override_id: None,
                slot,
            })
        })
        .collect()
}

/// The person on call at `at` in the default slot.
///
/// An override beats every layer, including a layer somebody set to the
/// highest priority in the schedule. That is the whole point of a cover: it is
/// the last word, and it is the reason it does not need an approval workflow.
pub fn on_call_now(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<String> {
    on_call_in_slot(rotations, overrides, unavailability, DEFAULT_SLOT, at, tz)
}

/// The person on call at `at` in one slot.
///
/// **An override outranks an absence.** Somebody who claims a window has said
/// out loud that they will take it, and the product must not decide it knows
/// better because their leave calendar disagrees — the commonest reason for the
/// two to overlap is precisely that they cut a holiday short to cover. An
/// absence is a default about who *should* be given a shift; a cover is a
/// statement about who *has* one.
pub fn on_call_in_slot(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    slot: &str,
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<String> {
    if let Some(ov) = covering_override_in_slot(overrides, slot, at) {
        return Some(ov.user_email.clone());
    }
    winning_rotation_in_slot(rotations, slot, at, tz)
        .and_then(|r| r.available_member_at(at, tz, unavailability))
        .map(str::to_string)
}

/// The person the rotation in force hands over to next.
///
/// `None` for a single-member rotation: there is no next, and returning the
/// same person would page them twice and call it an escalation.
///
/// An override does not change who the *rotation* hands over to — it takes a
/// slot, it does not reorder the roster — with one exception: the next must
/// never be the person already covering. Otherwise a two-person rotation with
/// a cover on it would page the same engineer on rung one and rung two, and
/// call the second one an escalation. When the roster's next is the coverer,
/// the one after them is used.
/// It stays a **within-slot** question once slots exist: `NextOnCall` is the
/// person this slot's rotation hands over to next, not the person holding some
/// other slot. Reading it as "whoever staffs the secondary slot" would have
/// rewritten every stored ladder the moment a team added a second slot —
/// silently, and in the direction of paging somebody who had never agreed to
/// be second. A rung that wants the other pool says so, by naming it.
pub fn next_on_call(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<String> {
    next_on_call_in_slot(
        rotations,
        overrides,
        unavailability,
        DEFAULT_SLOT,
        at,
        tz,
    )
}

/// The person one slot's rotation hands over to next.
///
/// Skips the covering engineer (they already hold rung one) and skips anybody
/// away — the second rung is no better a place to wake somebody on a beach than
/// the first.
pub fn next_on_call_in_slot(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    slot: &str,
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<String> {
    let r = winning_rotation_in_slot(rotations, slot, at, tz)?;
    if r.members.len() < 2 {
        return None;
    }
    let order = r.order_at(at, tz);
    // Where the roster's own handover order has actually got to. Normally the
    // person on shift; one further along for each consecutive member at the
    // front who is away. A cover does NOT move it — a coverer takes a slot, it
    // does not reorder the roster — which is why this is computed from the
    // rotation alone and the cover is only excluded below.
    let held_by = order
        .iter()
        .position(|m| !is_unavailable(unavailability, m, at))?;
    let covering =
        covering_override_in_slot(overrides, slot, at).map(|o| o.user_email.to_ascii_lowercase());
    // Bounded by the rotation length: walking further would wrap back onto
    // somebody already considered.
    order
        .into_iter()
        .skip(held_by + 1)
        .find(|candidate| {
            covering.as_deref() != Some(candidate.to_ascii_lowercase().as_str())
                && !is_unavailable(unavailability, candidate, at)
        })
        .map(str::to_string)
}

/// Everyone in force **across every slot**, on shift or not.
///
/// Once a team runs a senior pool behind a junior one, "everyone on the
/// schedule" that means only the junior pool is a broadcast of last resort with
/// half the room left out. So it is the union, slot by slot, deduplicated, in
/// slot order — which for a team with one slot is byte-for-byte the answer it
/// gave before slots existed. The one rung that widens is the last one, and
/// widening the last rung can add a person, never remove one.
///
/// A rung that means one pool says so with `EveryoneInSlot`.
pub fn everyone_on_schedule(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    at: i64,
    tz: chrono_tz::Tz,
) -> Vec<String> {
    let mut names = slots(rotations);
    for ov in overrides.iter().filter(|o| o.covers(at)) {
        if !names.iter().any(|s| same_slot(s, ov.slot())) {
            names.push(ov.slot().to_string());
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for slot in names {
        for m in everyone_in_slot(rotations, overrides, unavailability, &slot, at, tz) {
            if seen.insert(m.to_ascii_lowercase()) {
                out.push(m);
            }
        }
    }
    out
}

/// Everyone in one slot's rotation in force, on shift or not.
///
/// The covering person is appended when they are not already on the roster.
/// This list is the broadcast of last resort (§7's level 3), and a last resort
/// that leaves out the one person actually holding the pager is not one. The
/// covered engineer is *not* removed for the same reason: they are still on the
/// team, and shrinking the final rung to arrange a night off is how a page
/// reaches an empty room.
///
/// The **away** are removed, and that is a different judgement from the one
/// above: a cover is a night off from a shift, an absence is not being there at
/// all, and a broadcast that wakes somebody in another timezone on annual leave
/// is the failure this feature exists to stop. When it empties the rung the
/// ladder advances immediately and the team's coverage gap is already being
/// reported a week ahead by the sweep — and `WholeTeam`, which is the rung
/// below this one in every shipped ladder, ignores absence entirely, so a page
/// still has somewhere to go.
pub fn everyone_in_slot(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    slot: &str,
    at: i64,
    tz: chrono_tz::Tz,
) -> Vec<String> {
    let mut members: Vec<String> = winning_rotation_in_slot(rotations, slot, at, tz)
        .map(|r| {
            r.members
                .iter()
                .filter(|m| !is_unavailable(unavailability, m, at))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if let Some(ov) = covering_override_in_slot(overrides, slot, at)
        && !members
            .iter()
            .any(|m| m.eq_ignore_ascii_case(&ov.user_email))
    {
        members.push(ov.user_email.clone());
    }
    members
}

// ── The resolved schedule ────────────────────────────────────────────────────
//
// `architecture/02` §3b: "Layers are an input. What a human needs to see is the
// resolved result." Point-in-time resolution answers "who is on call now";
// nobody can answer "who is on call at 3 AM on Sunday" from it without running
// the precedence rules in their head, which is exactly what the layer model
// was supposed to stop them doing.
//
// So: one function that walks a window and returns the sequence of holders,
// overrides applied, gaps included rather than omitted. Computed on read, never
// materialised, so it cannot drift from the layers that produced it.

/// One stretch of time with one answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CoverageSegment {
    /// Which slot this stretch resolves. A grid is drawn one slot at a time —
    /// two rows, not one row with two answers in it.
    #[serde(default = "default_slot")]
    pub slot: String,
    /// Inclusive.
    pub from: i64,
    /// Exclusive.
    pub to: i64,
    /// `None` is a **coverage gap** — nobody is on call for this stretch. It
    /// is a segment rather than a hole in the list because a gap the caller
    /// has to infer from missing rows is a gap nobody notices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    /// The layer that produced the holder, so the grid can colour by layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<String>,
    /// Set when an override produced the holder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub override_id: Option<String>,
}

impl CoverageSegment {
    pub fn is_gap(&self) -> bool {
        self.user_email.is_none()
    }
}

/// Why a window could not be resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GridError {
    /// `to` is not after `from`. An empty window is a caller mistake, not an
    /// empty answer, because the usual cause is two swapped parameters.
    InvertedWindow { from: i64, to: i64 },
    /// A caller asking for a year gets an error, not a million rows.
    WindowTooLong { micros: i64, max: i64 },
    /// A schedule shredded finely enough to blow the segment budget — dozens
    /// of restriction windows over a month. Refused rather than truncated: a
    /// truncated schedule looks like a schedule that ends.
    TooManySegments { max: usize },
}

impl std::fmt::Display for GridError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvertedWindow { from, to } => {
                write!(f, "window end {to} is not after its start {from}")
            }
            Self::WindowTooLong { micros, max } => write!(
                f,
                "window of {micros} micros is longer than the {max} micros this endpoint resolves"
            ),
            Self::TooManySegments { max } => write!(
                f,
                "this schedule resolves to more than {max} segments over that window; ask for a shorter one"
            ),
        }
    }
}

impl std::error::Error for GridError {}

/// The longest window the resolver will walk. Thirty-one days covers "this
/// month" for the calendar view and every 7×24 grid the UI draws; a year is a
/// report, not a schedule preview.
pub const MAX_GRID_MICROS: i64 = 31 * MICROS_PER_DAY;

/// The segment budget. A week of hourly restriction edges is under 400, so
/// this is loose enough that no honest schedule meets it.
pub const MAX_GRID_SEGMENTS: usize = 2_000;

/// How many handovers one rotation may contribute before the walk gives up.
/// A minute-long shift over a month would otherwise enumerate 44,640 of them
/// on the way to a `TooManySegments` it could have reached sooner.
const MAX_HANDOVERS_PER_ROTATION: usize = MAX_GRID_SEGMENTS;

/// The resolved holder across `[from, to)`, in order, with no holes.
///
/// Pure, like everything else here: `from` and `to` are passed in, no clock is
/// read, and the same inputs give the same segments on every node.
///
/// The walk is over *candidate boundaries* rather than a fixed step, so a
/// half-hour cover and a 30-second one are both exact and a quiet week is a
/// handful of rows rather than 168 identical ones. The candidates are every
/// instant at which the answer could possibly change: a handover, the edge of
/// a restriction window in local time, a layer starting or being retired, or
/// an override beginning or ending. Between two consecutive candidates the
/// answer is constant by construction, so it is resolved once and adjacent
/// stretches with the same answer are merged.
pub fn resolve_window(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    from: i64,
    to: i64,
    tz: chrono_tz::Tz,
) -> Result<Vec<CoverageSegment>, GridError> {
    resolve_window_in_slot(
        rotations,
        overrides,
        unavailability,
        DEFAULT_SLOT,
        from,
        to,
        tz,
    )
}

/// The resolved holder of one slot across `[from, to)`.
///
/// One slot at a time rather than all of them interleaved: a grid with two
/// answers in the same row is not a grid, and the caller that wants both draws
/// two rows. [`slots`] says which to ask for.
pub fn resolve_window_in_slot(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    slot: &str,
    from: i64,
    to: i64,
    tz: chrono_tz::Tz,
) -> Result<Vec<CoverageSegment>, GridError> {
    if to <= from {
        return Err(GridError::InvertedWindow { from, to });
    }
    let span = to.checked_sub(from).unwrap_or(i64::MAX);
    if span > MAX_GRID_MICROS {
        return Err(GridError::WindowTooLong {
            micros: span,
            max: MAX_GRID_MICROS,
        });
    }

    let marks = candidate_boundaries(rotations, overrides, unavailability, slot, from, to, tz);
    let mut segments: Vec<CoverageSegment> = Vec::new();
    for (i, &start) in marks.iter().enumerate() {
        let end = marks.get(i + 1).copied().unwrap_or(to);
        if end <= start {
            continue;
        }
        let (user_email, rotation, override_id) =
            holder_at(rotations, overrides, unavailability, slot, start, tz);
        match segments.last_mut() {
            // Two candidates that resolve the same way were not really a
            // boundary — a restriction edge on a layer that was losing anyway,
            // most often. Merging keeps the grid readable.
            Some(last)
                if last.user_email == user_email
                    && last.rotation == rotation
                    && last.override_id == override_id =>
            {
                last.to = end;
            }
            _ => {
                if segments.len() >= MAX_GRID_SEGMENTS {
                    return Err(GridError::TooManySegments {
                        max: MAX_GRID_SEGMENTS,
                    });
                }
                segments.push(CoverageSegment {
                    slot: slot.to_string(),
                    from: start,
                    to: end,
                    user_email,
                    rotation,
                    override_id,
                });
            }
        }
    }
    Ok(segments)
}

/// Who holds one slot's pager at `at`, and what put them there.
fn holder_at(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    slot: &str,
    at: i64,
    tz: chrono_tz::Tz,
) -> (Option<String>, Option<String>, Option<String>) {
    let winner = winning_rotation_in_slot(rotations, slot, at, tz);
    if let Some(ov) = covering_override_in_slot(overrides, slot, at) {
        return (
            Some(ov.user_email.clone()),
            winner.map(|r| r.name.clone()),
            Some(ov.id.clone()),
        );
    }
    match winner.and_then(|r| {
        r.available_member_at(at, tz, unavailability)
            .map(|m| (r.name.clone(), m.to_string()))
    }) {
        Some((rotation, member)) => (Some(member), Some(rotation), None),
        None => (None, None, None),
    }
}

/// Every instant in `[from, to)` at which the answer could change, sorted and
/// deduplicated, always beginning with `from`.
fn candidate_boundaries(
    rotations: &[Rotation],
    overrides: &[ScheduleOverride],
    unavailability: &[Unavailability],
    slot: &str,
    from: i64,
    to: i64,
    tz: chrono_tz::Tz,
) -> Vec<i64> {
    let mut marks = vec![from];
    let push = |m: i64, marks: &mut Vec<i64>| {
        if m > from && m < to {
            marks.push(m);
        }
    };

    for ov in overrides {
        if !ov.overlaps(from, to) || !same_slot(ov.slot(), slot) {
            continue;
        }
        push(ov.start_at, &mut marks);
        push(ov.end_at, &mut marks);
    }

    // An absence beginning or ending mid-shift hands the pager over and takes
    // it back, so both edges are instants the answer changes at. Omitting them
    // is how the grid would claim somebody covered a week they left halfway
    // through.
    for u in unavailability {
        if !u.overlaps(from, to) {
            continue;
        }
        push(u.start_at, &mut marks);
        push(u.end_at, &mut marks);
    }

    for r in rotations {
        if r.validate().is_err() || !r.is_in_slot(slot) {
            continue;
        }
        if let Some(s) = r.starts_at {
            push(s, &mut marks);
        }
        if let Some(e) = r.ends_at {
            push(e, &mut marks);
        }
        // Handovers. Walk forwards from the shift containing `from`; the
        // boundaries are monotonic (see `shift_index`), so this terminates.
        let mut cursor = from;
        for _ in 0..MAX_HANDOVERS_PER_ROTATION {
            let Some(next) = r.next_handover(cursor, tz) else {
                break;
            };
            if next >= to || next <= cursor {
                break;
            }
            marks.push(next);
            cursor = next;
        }
        restriction_boundaries(r, from, to, tz, &mut marks);
    }

    marks.sort_unstable();
    marks.dedup();
    marks
}

/// The local-wall-clock edges of a rotation's restriction windows.
///
/// Computed per local day rather than by stepping in elapsed micros, for the
/// same reason handovers are (§9): "09:00" is a wall-clock fact, and a day
/// that gains or loses an hour must still have its window open at 09:00.
fn restriction_boundaries(
    r: &Rotation,
    from: i64,
    to: i64,
    tz: chrono_tz::Tz,
    marks: &mut Vec<i64>,
) {
    if r.restrictions.is_empty() {
        return;
    }
    let Some(local_from) = to_local_micros(from, tz) else {
        return;
    };
    // Start a day early: a window that wraps midnight opens on the previous
    // local day and its closing edge lands inside the requested window.
    let first_midnight = local_from.div_euclid(MICROS_PER_DAY) * MICROS_PER_DAY - MICROS_PER_DAY;
    // `MAX_GRID_MICROS` bounds the span, so the day count is bounded too; the
    // +3 covers the leading day, the trailing partial day and an offset that
    // pushes local midnight across the boundary.
    let days = (to - from).div_euclid(MICROS_PER_DAY) + 3;
    for day in 0..days {
        let midnight = first_midnight + day * MICROS_PER_DAY;
        for w in &r.restrictions {
            for minute in [w.start_minute as i64, w.end_minute as i64] {
                if let Some(edge) = from_local_micros(midnight + minute * MICROS_PER_MINUTE, tz)
                    && edge > from
                    && edge < to
                {
                    marks.push(edge);
                }
            }
        }
    }
}

// ── The edit-time warning ────────────────────────────────────────────────────
//
// The resolver already refuses to page somebody who is away. That is the safety
// net, and a safety net is not the feature: by the time it catches anything,
// somebody has built a rota that quietly hands a colleague a week they are not
// there for, and the first anybody hears of it is a different name on the
// calendar. Catching it while the rotation is being edited is the entire value,
// so the question "would this hand somebody a shift they are away for" is asked
// here, over a horizon, and answered without a clock.

/// One shift a rotation's own order would give to somebody who is away.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AwayShift {
    pub slot: String,
    pub rotation: String,
    /// Who the handover order names.
    pub user_email: String,
    /// The stretch of their shift that lands inside the absence. Inclusive.
    pub from: i64,
    /// Exclusive.
    pub to: i64,
    /// Who the skip passes it to. `None` means everybody in that rotation is
    /// away for it, which is a coverage gap and is reported as one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub covered_by: Option<String>,
}

/// How many away shifts one look-ahead will report. A rota that trips this many
/// has one problem, not forty, and the caller wants the first few.
pub const MAX_AWAY_SHIFTS: usize = 50;

/// Shifts in `[from, to)` that a rotation would hand to somebody who is away.
///
/// Reported even though the resolver would skip them, because the two answer
/// different questions: the resolver says who gets paged tonight, and this says
/// that the schedule somebody just saved does not mean what they think it does.
///
/// Only counted where the layer would actually be in force — a restricted layer
/// that loses the slot at that instant hands nobody anything, and warning about
/// it would train people to ignore the warning.
pub fn away_assignments(
    rotations: &[Rotation],
    unavailability: &[Unavailability],
    from: i64,
    to: i64,
    tz: chrono_tz::Tz,
    limit: usize,
) -> Vec<AwayShift> {
    let mut out = Vec::new();
    if to <= from || limit == 0 || unavailability.is_empty() {
        return out;
    }
    for r in rotations.iter().filter(|r| r.validate().is_ok()) {
        let mut cursor = from;
        for _ in 0..MAX_HANDOVERS_PER_ROTATION {
            if cursor >= to || out.len() >= limit {
                break;
            }
            let Some(shift_end) = r.next_handover(cursor, tz) else {
                break;
            };
            let (start, end) = (cursor.max(from), shift_end.min(to));
            // Monotonic by construction (see `shift_index`); the guard is here
            // so a pathological zone cannot pin the loop on one instant.
            if shift_end <= cursor {
                break;
            }
            cursor = shift_end;
            if end <= start {
                continue;
            }
            let Some(holder) = r.member_at(start, tz) else {
                continue;
            };
            for u in unavailability
                .iter()
                .filter(|u| u.is(holder) && u.overlaps(start, end))
            {
                let (overlap_from, overlap_to) = (u.start_at.max(start), u.end_at.min(end));
                // In force here? A layer that is losing the slot at this
                // instant is not handing anybody anything.
                if winning_rotation_in_slot(rotations, &r.slot, overlap_from, tz)
                    .is_none_or(|w| w.name != r.name || w.slot != r.slot)
                {
                    continue;
                }
                if out.len() >= limit {
                    break;
                }
                out.push(AwayShift {
                    slot: r.slot.clone(),
                    rotation: r.name.clone(),
                    user_email: holder.to_string(),
                    from: overlap_from,
                    to: overlap_to,
                    covered_by: r
                        .available_member_at(overlap_from, tz, unavailability)
                        .map(str::to_string),
                });
            }
        }
    }
    // Soonest first: the one that matters is the one about to happen. Stable
    // beyond that so two reads of an unchanged schedule agree.
    out.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then_with(|| a.slot.cmp(&b.slot))
            .then_with(|| a.rotation.cmp(&b.rotation))
            .then_with(|| a.user_email.cmp(&b.user_email))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANCHOR: i64 = 1_700_000_000_000_000;
    /// The zone the plain-rotation tests use; DST cases name their own.
    const TZ: chrono_tz::Tz = chrono_tz::UTC;

    fn weekly(members: &[&str]) -> Rotation {
        Rotation::weekly(
            "Primary",
            members.iter().map(|s| s.to_string()).collect(),
            ANCHOR,
        )
    }

    #[test]
    fn test_first_shift_belongs_to_the_first_member() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR, TZ), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_DAY, TZ), Some("ana@o2.ai"));
    }

    /// The handover instant belongs to the INCOMING person. An inclusive
    /// upper bound would leave the outgoing engineer on call for one extra
    /// microsecond, and both of them paged for the same alert.
    #[test]
    fn test_handover_boundary_is_exclusive() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_WEEK - 1, TZ), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_WEEK, TZ), Some("bob@o2.ai"));
    }

    #[test]
    fn test_rotation_wraps_around() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"]);
        let expected = ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"];
        for week in 0..9i64 {
            assert_eq!(
                r.member_at(ANCHOR + week * MICROS_PER_WEEK, TZ),
                Some(expected[(week % 3) as usize]),
                "week {week}"
            );
        }
    }

    /// Truncating division would map -1 micros and +1 micros to the same
    /// shift, putting one person on call for two consecutive shifts.
    #[test]
    fn test_instants_before_the_anchor_walk_backwards() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR - 1, TZ), Some("bob@o2.ai"));
        assert_eq!(r.member_at(ANCHOR - MICROS_PER_WEEK, TZ), Some("bob@o2.ai"));
        assert_eq!(r.member_at(ANCHOR - MICROS_PER_WEEK - 1, TZ), Some("ana@o2.ai"));
    }

    #[test]
    fn test_single_member_is_always_on_call() {
        let r = weekly(&["ana@o2.ai"]);
        for offset in [-MICROS_PER_WEEK, 0, MICROS_PER_DAY, 99 * MICROS_PER_WEEK] {
            assert_eq!(r.member_at(ANCHOR + offset, TZ), Some("ana@o2.ai"));
        }
    }

    #[test]
    fn test_shift_start_and_next_handover_bracket_the_instant() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let at = ANCHOR + MICROS_PER_WEEK + 3 * MICROS_PER_HOUR;
        let start = r.shift_start(at, TZ).unwrap();
        let end = r.next_handover(at, TZ).unwrap();
        assert_eq!(start, ANCHOR + MICROS_PER_WEEK);
        assert_eq!(end, ANCHOR + 2 * MICROS_PER_WEEK);
        assert!(start <= at && at < end);
    }

    #[test]
    fn test_next_handover_hands_over_to_the_next_member() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let at = ANCHOR + MICROS_PER_DAY;
        let handover = r.next_handover(at, TZ).unwrap();
        assert_eq!(r.member_at(handover - 1, TZ), Some("ana@o2.ai"));
        assert_eq!(r.member_at(handover, TZ), Some("bob@o2.ai"));
    }

    #[test]
    fn test_arbitrary_shift_lengths_resolve() {
        let r = Rotation {
            name: "Primary".into(),
            slot: DEFAULT_SLOT.to_string(),
            members: vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            shift_micros: 8 * MICROS_PER_HOUR,
            anchor_micros: ANCHOR,
            priority: 0,
            restrictions: vec![],
            starts_at: None,
            ends_at: None,
        };
        assert_eq!(r.member_at(ANCHOR, TZ), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + 8 * MICROS_PER_HOUR, TZ), Some("bob@o2.ai"));
        assert_eq!(
            r.member_at(ANCHOR + 16 * MICROS_PER_HOUR, TZ),
            Some("ana@o2.ai")
        );
    }

    #[test]
    fn test_validate_rejects_unusable_rotations() {
        let mut r = weekly(&[]);
        assert_eq!(r.validate(), Err(RotationError::NoMembers));

        r = weekly(&["ana@o2.ai"]);
        r.shift_micros = 0;
        assert_eq!(r.validate(), Err(RotationError::NonPositiveShift(0)));
        r.shift_micros = -1;
        assert_eq!(r.validate(), Err(RotationError::NonPositiveShift(-1)));

        r = weekly(&["ana@o2.ai", "ANA@o2.ai"]);
        assert_eq!(
            r.validate(),
            Err(RotationError::DuplicateMember("ANA@o2.ai".into())),
            "duplicates must be caught case-insensitively"
        );

        r = weekly(&["ana@o2.ai"]);
        r.name = "  ".into();
        assert_eq!(r.validate(), Err(RotationError::NoName));
    }

    /// An unusable rotation must resolve to nobody. Falling back to
    /// `members[0]` would page a person the schedule never selected.
    #[test]
    fn test_invalid_rotation_resolves_to_nobody() {
        let empty = weekly(&[]);
        assert_eq!(empty.member_at(ANCHOR, TZ), None);
        assert_eq!(empty.shift_start(ANCHOR, TZ), None);
        assert_eq!(empty.next_handover(ANCHOR, TZ), None);

        let mut zero = weekly(&["ana@o2.ai"]);
        zero.shift_micros = 0;
        assert_eq!(zero.member_at(ANCHOR, TZ), None, "must not divide by zero");
    }

    /// One rotation is all a team needs. "Secondary" is this rotation's next
    /// handover, not a second schedule somebody has to staff.
    #[test]
    fn test_the_ladder_walks_one_rotation() {
        let rotations = vec![Rotation::weekly(
            "Primary",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into(), "cara@o2.ai".into()],
            ANCHOR,
        )];

        assert_eq!(
            on_call_now(&rotations, &[], &[], ANCHOR, chrono_tz::UTC).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(
            next_on_call(&rotations, &[], &[], ANCHOR, chrono_tz::UTC).as_deref(),
            Some("bob@o2.ai")
        );
        // A week later everyone has moved along by one.
        let later = ANCHOR + MICROS_PER_WEEK;
        assert_eq!(
            on_call_now(&rotations, &[], &[], later, chrono_tz::UTC).as_deref(),
            Some("bob@o2.ai")
        );
        assert_eq!(
            next_on_call(&rotations, &[], &[], later, chrono_tz::UTC).as_deref(),
            Some("cara@o2.ai")
        );
    }

    /// The next handover wraps, so the last member hands back to the first.
    #[test]
    fn test_next_on_call_wraps_around_the_rotation() {
        let rotations = vec![Rotation::weekly(
            "Primary",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        assert_eq!(
            next_on_call(&rotations, &[], &[], ANCHOR + MICROS_PER_WEEK, chrono_tz::UTC).as_deref(),
            Some("ana@o2.ai")
        );
    }

    /// A one-person rotation has no next. Returning the same person would
    /// page them twice and call the second one an escalation.
    #[test]
    fn test_a_single_member_rotation_has_no_next() {
        let rotations = vec![Rotation::weekly("Primary", vec!["ana@o2.ai".into()], ANCHOR)];

        assert_eq!(
            on_call_now(&rotations, &[], &[], ANCHOR, chrono_tz::UTC).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(next_on_call(&rotations, &[], &[], ANCHOR, chrono_tz::UTC), None);
        assert_eq!(
            resolve_on_call(&rotations, &[], &[], ANCHOR, chrono_tz::UTC)[0].next_user_email,
            None
        );
    }

    #[test]
    fn test_everyone_on_schedule_is_the_whole_rotation() {
        let rotations = vec![Rotation::weekly(
            "Primary",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        assert_eq!(
            everyone_on_schedule(&rotations, &[], &[], ANCHOR, chrono_tz::UTC),
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()]
        );
    }

    /// An unusable rotation resolves to nobody, which is visible, rather than
    /// to `members[0]`, which would page someone the schedule never selected.
    #[test]
    fn test_a_broken_rotation_staffs_nobody() {
        let rotations = vec![Rotation::weekly("Primary", vec![], ANCHOR)];
        assert!(resolve_on_call(&rotations, &[], &[], ANCHOR, chrono_tz::UTC).is_empty());
        assert_eq!(on_call_now(&rotations, &[], &[], ANCHOR, chrono_tz::UTC), None);
        assert_eq!(next_on_call(&rotations, &[], &[], ANCHOR, chrono_tz::UTC), None);
        assert!(everyone_on_schedule(&rotations, &[], &[], ANCHOR, chrono_tz::UTC).is_empty());
    }

    #[test]
    fn test_round_trips_through_json() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let json = serde_json::to_string(&r).unwrap();
        let back: Rotation = serde_json::from_str(&json).unwrap();
        assert_eq!(back, r);
    }

    // ── Layers ──────────────────────────────────────────────────────────────

    const IST: chrono_tz::Tz = chrono_tz::Asia::Kolkata;

    /// Micros for a local wall-clock instant in `tz`.
    fn local(tz: chrono_tz::Tz, y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        use chrono::TimeZone;
        tz.with_ymd_and_hms(y, m, d, h, min, 0)
            .unwrap()
            .timestamp_micros()
    }

    fn window(days: &[u8], start: u32, end: u32) -> TimeWindow {
        TimeWindow {
            days: days.to_vec(),
            start_minute: start,
            end_minute: end,
        }
    }

    fn layer(
        name: &str,
        members: &[&str],
        priority: i32,
        restrictions: Vec<TimeWindow>,
    ) -> Rotation {
        Rotation {
            name: name.to_string(),
            slot: DEFAULT_SLOT.to_string(),
            members: members.iter().map(|s| s.to_string()).collect(),
            shift_micros: MICROS_PER_WEEK,
            anchor_micros: ANCHOR,
            priority,
            restrictions,
            starts_at: None,
            ends_at: None,
        }
    }

    /// 2026-08-10 is a Monday; 2026-08-15 a Saturday.
    #[test]
    fn test_window_matches_local_days_and_hours() {
        let weekday_office = window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60);
        assert!(weekday_office.contains(local(IST, 2026, 8, 10, 10, 0), IST));
        assert!(!weekday_office.contains(local(IST, 2026, 8, 10, 8, 59), IST));
        assert!(
            !weekday_office.contains(local(IST, 2026, 8, 10, 17, 0), IST),
            "end is exclusive"
        );
        assert!(
            !weekday_office.contains(local(IST, 2026, 8, 15, 10, 0), IST),
            "Saturday"
        );
    }

    /// The window is local wall time, so the same instant matches or not
    /// depending on the schedule's zone — that is the entire point of
    /// follow-the-sun.
    #[test]
    fn test_window_is_evaluated_in_the_schedules_timezone() {
        let office = window(&[], 9 * 60, 17 * 60);
        let at = local(IST, 2026, 8, 10, 10, 0); // 10:00 IST == 04:30 UTC
        assert!(office.contains(at, IST));
        assert!(!office.contains(at, chrono_tz::UTC));
    }

    /// A 22:00–06:00 night shift is one window, not two. Splitting it would
    /// make the common case the awkward one.
    #[test]
    fn test_window_can_wrap_midnight() {
        let night = window(&[], 22 * 60, 6 * 60);
        assert!(night.contains(local(IST, 2026, 8, 10, 23, 30), IST));
        assert!(night.contains(local(IST, 2026, 8, 11, 2, 0), IST));
        assert!(!night.contains(local(IST, 2026, 8, 11, 7, 0), IST));
    }

    /// The early-morning half of a wrapped window belongs to the PREVIOUS
    /// day's shift: somebody covering "Friday nights" is still on at 02:00 on
    /// Saturday.
    #[test]
    fn test_wrapped_window_counts_the_shifts_starting_day() {
        let friday_night = window(&[4], 22 * 60, 6 * 60);
        assert!(
            friday_night.contains(local(IST, 2026, 8, 14, 23, 0), IST),
            "Fri 23:00"
        );
        assert!(
            friday_night.contains(local(IST, 2026, 8, 15, 2, 0), IST),
            "Sat 02:00 is Fri's shift"
        );
        assert!(
            !friday_night.contains(local(IST, 2026, 8, 15, 23, 0), IST),
            "Sat 23:00 is not"
        );
    }

    #[test]
    fn test_a_rotation_with_no_restrictions_always_applies() {
        let r = weekly(&["ana@o2.ai"]);
        assert!(r.applies_at(local(IST, 2026, 8, 15, 3, 0), IST));
    }

    /// Follow-the-sun: a restricted layer covers its hours, and the
    /// unrestricted catch-all covers everything nobody claimed.
    #[test]
    fn test_restricted_layer_wins_inside_its_window_and_yields_outside() {
        let rotations = vec![
            layer("Primary", &["catchall@o2.ai"], 0, vec![]),
            layer(
                "Primary",
                &["india@o2.ai"],
                10,
                vec![window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60)],
            ),
        ];
        let office = local(IST, 2026, 8, 10, 11, 0);
        let night = local(IST, 2026, 8, 10, 23, 0);

        assert_eq!(
            on_call_now(&rotations, &[], &[], office, IST).unwrap(),
            "india@o2.ai"
        );
        assert_eq!(
            on_call_now(&rotations, &[], &[], night, IST).unwrap(),
            "catchall@o2.ai"
        );
    }

    /// Three restricted layers over one catch-all, which is what
    /// follow-the-sun actually is.
    #[test]
    fn test_three_region_follow_the_sun() {
        let rotations = vec![
            layer("Primary", &["catchall@o2.ai"], 0, vec![]),
            layer(
                "Primary",
                &["apac@o2.ai"],
                10,
                vec![window(&[], 6 * 60, 14 * 60)],
            ),
            layer(
                "Primary",
                &["emea@o2.ai"],
                10,
                vec![window(&[], 14 * 60, 22 * 60)],
            ),
            layer(
                "Primary",
                &["amer@o2.ai"],
                10,
                vec![window(&[], 22 * 60, 6 * 60)],
            ),
        ];
        for (hour, expected) in [
            (8, "apac@o2.ai"),
            (16, "emea@o2.ai"),
            (23, "amer@o2.ai"),
            (3, "amer@o2.ai"),
        ] {
            let at = local(IST, 2026, 8, 10, hour, 0);
            assert_eq!(
                on_call_now(&rotations, &[], &[], at, IST).unwrap(),
                expected,
                "hour {hour}"
            );
        }
    }

    /// Priority is explicit, not positional: reordering the list must not
    /// change who is paged.
    #[test]
    fn test_priority_decides_not_list_order() {
        let low = layer(
                "Primary",
            &["low@o2.ai"],
            1,
            vec![window(&[], 0, 1440)],
        );
        let high = layer(
                "Primary",
            &["high@o2.ai"],
            5,
            vec![window(&[], 0, 1440)],
        );
        let at = local(IST, 2026, 8, 10, 12, 0);

        let forward = on_call_now(&[low.clone(), high.clone()], &[], &[], at, IST);
        let reverse = on_call_now(&[high, low], &[], &[], at, IST);
        assert_eq!(forward.as_deref(), Some("high@o2.ai"));
        assert_eq!(forward, reverse);
    }

    /// At equal priority the more specific rotation wins, so a catch-all
    /// never shadows a layer somebody deliberately restricted.
    #[test]
    fn test_a_restricted_layer_beats_the_catch_all_at_equal_priority() {
        let rotations = vec![
            layer("Primary", &["catchall@o2.ai"], 0, vec![]),
            layer(
                "Primary",
                &["office@o2.ai"],
                0,
                vec![window(&[], 9 * 60, 17 * 60)],
            ),
        ];
        assert_eq!(
            on_call_now(&rotations, &[], &[], local(IST, 2026, 8, 10, 12, 0), IST).unwrap(),
            "office@o2.ai"
        );
    }

    /// Restrictions are ORed: "weekday mornings or weekend afternoons" is two
    /// windows and matching either is enough.
    #[test]
    fn test_multiple_windows_are_ored() {
        let r = layer(
                "Primary",
            &["ana@o2.ai"],
            0,
            vec![
                window(&[0, 1, 2, 3, 4], 9 * 60, 12 * 60),
                window(&[5, 6], 13 * 60, 18 * 60),
            ],
        );
        assert!(
            r.applies_at(local(IST, 2026, 8, 10, 10, 0), IST),
            "weekday morning"
        );
        assert!(
            r.applies_at(local(IST, 2026, 8, 15, 14, 0), IST),
            "weekend afternoon"
        );
        assert!(
            !r.applies_at(local(IST, 2026, 8, 10, 14, 0), IST),
            "weekday afternoon"
        );
    }

    /// A level whose every layer is out of window is a coverage gap, not a
    /// silent fallback to somebody else's rotation.
    #[test]
    fn test_a_level_with_no_applicable_layer_is_absent() {
        let rotations = vec![layer(
            "Primary",
            &["office@o2.ai"],
            0,
            vec![window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60)],
        )];
        let saturday = local(IST, 2026, 8, 15, 12, 0);
        assert!(on_call_now(&rotations, &[], &[], saturday, IST).is_none());
        assert!(resolve_on_call(&rotations, &[], &[], saturday, IST).is_empty());
    }

    /// DST: New York moves its clock, and a 09:00-local window must still be
    /// 09:00 local on both sides of the transition rather than drifting by an
    /// hour in UTC.
    #[test]
    fn test_window_follows_local_time_across_dst() {
        let ny = chrono_tz::America::New_York;
        let office = window(&[], 9 * 60, 17 * 60);
        // 2026-03-08 is the US spring-forward date.
        assert!(
            office.contains(local(ny, 2026, 3, 7, 10, 0), ny),
            "before DST"
        );
        assert!(
            office.contains(local(ny, 2026, 3, 9, 10, 0), ny),
            "after DST"
        );
        assert!(!office.contains(local(ny, 2026, 3, 9, 8, 0), ny));
    }

    #[test]
    fn test_layer_round_trips_through_json() {
        let r = layer(
                "Primary",
            &["ana@o2.ai"],
            7,
            vec![window(&[0, 4], 540, 1020)],
        );
        let back: Rotation = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r);
    }

    // ── DST ─────────────────────────────────────────────────────────────────
    //
    // `architecture/02` §9: a handover is anchored to local wall-clock time. A
    // weekly Monday 09:00 handover stays at 09:00 local across a transition,
    // and the shift that straddles it is 23 or 25 hours long. Counting pure
    // elapsed micros instead moves the handover to 08:00 or 10:00 — an hour
    // either side of when the two engineers agreed to swap.

    const NY: chrono_tz::Tz = chrono_tz::America::New_York;
    /// US spring forward: 2026-03-08, 02:00 → 03:00 local.
    /// US fall back: 2026-11-01, 02:00 → 01:00 local.
    const HOUR: i64 = MICROS_PER_HOUR;

    fn daily(members: &[&str], anchor: i64) -> Rotation {
        Rotation {
            name: "On-call rotation".into(),
            slot: DEFAULT_SLOT.to_string(),
            members: members.iter().map(|s| s.to_string()).collect(),
            shift_micros: MICROS_PER_DAY,
            anchor_micros: anchor,
            priority: 0,
            restrictions: vec![],
            starts_at: None,
            ends_at: None,
        }
    }

    /// The handover keeps its local hour, so the week containing the
    /// spring-forward Sunday is 167 hours rather than 168.
    #[test]
    fn test_a_weekly_handover_keeps_its_local_hour_across_spring_forward() {
        let anchor = local(NY, 2026, 3, 2, 9, 0);
        let r = Rotation::weekly("On-call rotation", vec!["ana@o2.ai".into(), "bob@o2.ai".into()], anchor);

        let handover = r.next_handover(anchor + HOUR, NY).unwrap();
        assert_eq!(
            handover,
            local(NY, 2026, 3, 9, 9, 0),
            "the Monday handover must still be at 09:00 local, not 08:00"
        );
        assert_eq!(
            handover - anchor,
            167 * HOUR,
            "the week that loses an hour is 167 hours long"
        );
        assert_eq!(r.member_at(handover - 1, NY), Some("ana@o2.ai"));
        assert_eq!(r.member_at(handover, NY), Some("bob@o2.ai"));
    }

    /// The mirror case: the week containing the fall-back Sunday is 169 hours,
    /// and the handover is still at 09:00 local.
    #[test]
    fn test_a_weekly_handover_keeps_its_local_hour_across_fall_back() {
        let anchor = local(NY, 2026, 10, 26, 9, 0);
        let r = Rotation::weekly("On-call rotation", vec!["ana@o2.ai".into(), "bob@o2.ai".into()], anchor);

        let handover = r.next_handover(anchor + HOUR, NY).unwrap();
        assert_eq!(
            handover,
            local(NY, 2026, 11, 2, 9, 0),
            "the Monday handover must still be at 09:00 local, not 10:00"
        );
        assert_eq!(
            handover - anchor,
            169 * HOUR,
            "the week that gains an hour is 169 hours long"
        );
        assert_eq!(r.member_at(handover - 1, NY), Some("ana@o2.ai"));
        assert_eq!(r.member_at(handover, NY), Some("bob@o2.ai"));
    }

    /// A 02:30 handover on the spring-forward morning names a time the clock
    /// never reads. It happens when the clock reaches 03:00 — skipping it
    /// would silently hand a person an extra day of on-call.
    #[test]
    fn test_a_handover_inside_the_skipped_hour_fires_when_the_clock_reaches_it() {
        let anchor = local(NY, 2026, 3, 5, 2, 30);
        let r = daily(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], anchor);

        // The shift that began on the 7th ends on the 8th, at the first
        // instant the local clock exists again.
        let at = local(NY, 2026, 3, 7, 12, 0);
        let handover = r.next_handover(at, NY).unwrap();
        assert_eq!(handover, local(NY, 2026, 3, 8, 3, 0));
        assert_eq!(
            handover - r.shift_start(at, NY).unwrap(),
            23 * HOUR + 30 * MICROS_PER_MINUTE,
            "the shift across the gap is half an hour short of a day"
        );

        let before = r.member_at(handover - 1, NY).unwrap().to_string();
        assert_ne!(
            r.member_at(handover, NY).unwrap(),
            before,
            "the handover must still happen exactly once, at that instant"
        );
    }

    /// A 01:30 handover on the fall-back morning names a time the clock reads
    /// twice. It happens at the first of them, once — handing over again an
    /// hour later would page the outgoing engineer for somebody else's shift.
    #[test]
    fn test_a_handover_inside_the_repeated_hour_happens_only_once() {
        let anchor = local(NY, 2026, 10, 30, 1, 30);
        let r = daily(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], anchor);

        let at = local(NY, 2026, 10, 31, 12, 0);
        let handover = r.next_handover(at, NY).unwrap();
        // 01:30 EDT, the first time the clock reads it.
        assert_eq!(handover, anchor + 2 * MICROS_PER_DAY);

        let incoming = r.member_at(handover, NY).unwrap().to_string();
        // Walk the repeated hour minute by minute: the local clock goes
        // backwards through it, and the person on call must not go with it.
        for minutes in 0..120i64 {
            assert_eq!(
                r.member_at(handover + minutes * MICROS_PER_MINUTE, NY),
                Some(incoming.as_str()),
                "{minutes} minutes after the handover the rotation stepped back"
            );
        }
        assert_eq!(
            r.next_handover(handover, NY).unwrap() - handover,
            25 * HOUR,
            "the day that gains an hour is 25 hours long"
        );
    }

    /// Shift boundaries have to keep advancing even while the local clock is
    /// repeating itself, or a page lands on whoever the reversal happens to
    /// select.
    #[test]
    fn test_shift_boundaries_are_monotonic_through_both_transitions() {
        for (anchor, from, hours) in [
            (local(NY, 2026, 3, 5, 2, 30), local(NY, 2026, 3, 6, 0, 0), 96),
            (
                local(NY, 2026, 10, 30, 1, 30),
                local(NY, 2026, 10, 31, 0, 0),
                96,
            ),
        ] {
            let r = daily(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], anchor);
            let mut last_start = i64::MIN;
            for hour in 0..hours {
                let at = from + hour * HOUR;
                let start = r.shift_start(at, NY).unwrap();
                let end = r.next_handover(at, NY).unwrap();
                assert!(start <= at && at < end, "hour {hour} is outside its shift");
                assert!(start >= last_start, "hour {hour} moved a boundary backwards");
                last_start = start;
            }
        }
    }

    /// Old schedules carry neither field; they must load as unrestricted
    /// rather than failing to parse.
    #[test]
    fn test_a_rotation_without_layer_fields_still_parses() {
        let json = r#"{"level":"primary","members":["ana@o2.ai"],"shift_micros":604800000000,"anchor_micros":0}"#;
        let r: Rotation = serde_json::from_str(json).unwrap();
        assert_eq!(r.priority, 0);
        assert!(r.restrictions.is_empty());
        assert!(r.starts_at.is_none() && r.ends_at.is_none());
        assert!(r.applies_at(ANCHOR, IST));
    }

    // ── Layer validity windows (§3b) ────────────────────────────────────────
    //
    // A layer used to have only one way to stop: deletion. "The weekend
    // rotation ended in March" was therefore unsayable, and a team wanting to
    // wind a layer down had to delete the record of who had been covering
    // those hours.

    fn retirable(name: &str, member: &str, priority: i32) -> Rotation {
        Rotation {
            name: name.into(),
            slot: DEFAULT_SLOT.to_string(),
            members: vec![member.into()],
            shift_micros: MICROS_PER_WEEK,
            anchor_micros: ANCHOR,
            priority,
            restrictions: vec![],
            starts_at: None,
            ends_at: None,
        }
    }

    #[test]
    fn test_a_layer_outside_its_validity_window_does_not_apply() {
        let mut r = retirable("Weekends", "bob@o2.ai", 0);
        r.starts_at = Some(ANCHOR);
        r.ends_at = Some(ANCHOR + 4 * MICROS_PER_WEEK);

        assert!(!r.in_effect_at(ANCHOR - 1), "before it starts");
        assert!(r.in_effect_at(ANCHOR), "the start instant is inside");
        assert!(r.in_effect_at(ANCHOR + 4 * MICROS_PER_WEEK - 1));
        assert!(
            !r.in_effect_at(ANCHOR + 4 * MICROS_PER_WEEK),
            "the end instant already belongs to whatever takes over"
        );
        // And the restriction check agrees, which is what the resolver reads.
        assert!(!r.applies_at(ANCHOR - 1, TZ));
        assert!(r.applies_at(ANCHOR, TZ));
    }

    #[test]
    fn test_an_open_ended_validity_window_is_always_in_effect() {
        let r = retirable("Base", "ana@o2.ai", 0);
        for at in [i64::MIN / 2, 0, ANCHOR, i64::MAX / 2] {
            assert!(r.in_effect_at(at), "{at}");
        }
    }

    /// The point of the field: a retired layer stops paging, and the layer
    /// underneath takes the hours back rather than the shift falling into a
    /// gap. Retiring must not be a coverage gap in disguise.
    #[test]
    fn test_retiring_a_layer_hands_its_hours_back_to_the_one_underneath() {
        let retired_at = ANCHOR + 4 * MICROS_PER_WEEK;
        let mut weekend = retirable("Weekends", "bob@o2.ai", 10);
        weekend.ends_at = Some(retired_at);
        let rotations = vec![retirable("Base", "ana@o2.ai", 0), weekend];

        assert_eq!(
            on_call_now(&rotations, &[], &[], retired_at - 1, TZ).as_deref(),
            Some("bob@o2.ai")
        );
        assert_eq!(
            on_call_now(&rotations, &[], &[], retired_at, TZ).as_deref(),
            Some("ana@o2.ai"),
            "the base layer takes the hours back the moment the top one retires"
        );
    }

    /// Precedence is unchanged by the new field: the highest priority still
    /// wins among the layers that are actually live.
    #[test]
    fn test_validity_windows_do_not_disturb_priority() {
        let mut early = retirable("Early", "early@o2.ai", 5);
        early.ends_at = Some(ANCHOR + MICROS_PER_WEEK);
        let mut late = retirable("Late", "late@o2.ai", 5);
        late.starts_at = Some(ANCHOR + MICROS_PER_WEEK);
        let rotations = vec![retirable("Base", "base@o2.ai", 0), early, late];

        for (at, expected) in [
            (ANCHOR, "early@o2.ai"),
            (ANCHOR + MICROS_PER_WEEK, "late@o2.ai"),
        ] {
            assert_eq!(on_call_now(&rotations, &[], &[], at, TZ).as_deref(), Some(expected));
        }
    }

    /// Both layers retired and nothing underneath: a coverage gap, surfaced,
    /// not a silent fallback to whoever used to be on the retired layer.
    #[test]
    fn test_a_schedule_of_only_retired_layers_staffs_nobody() {
        let mut r = retirable("Old", "ana@o2.ai", 0);
        r.ends_at = Some(ANCHOR);
        assert_eq!(on_call_now(&[r], &[], &[], ANCHOR, TZ), None);
    }

    #[test]
    fn test_a_validity_window_that_ends_before_it_starts_is_refused() {
        let mut r = retirable("Impossible", "ana@o2.ai", 0);
        r.starts_at = Some(ANCHOR);
        r.ends_at = Some(ANCHOR);
        assert_eq!(
            r.validate(),
            Err(RotationError::EmptyValidityWindow {
                starts_at: ANCHOR,
                ends_at: ANCHOR
            }),
            "a zero-length window applies at no instant, so it is a mistake"
        );
        r.ends_at = Some(ANCHOR - 1);
        assert!(r.validate().is_err());
        // One-sided bounds are ordinary.
        r.ends_at = None;
        r.validate().unwrap();
        r.starts_at = None;
        r.ends_at = Some(ANCHOR);
        r.validate().unwrap();
    }

    #[test]
    fn test_validity_window_round_trips_and_is_omitted_when_absent() {
        let plain = retirable("Base", "ana@o2.ai", 0);
        let json = serde_json::to_string(&plain).unwrap();
        assert!(!json.contains("starts_at"), "absent bounds add no noise: {json}");
        assert_eq!(serde_json::from_str::<Rotation>(&json).unwrap(), plain);

        let mut bounded = plain.clone();
        bounded.starts_at = Some(1);
        bounded.ends_at = Some(2);
        let back: Rotation =
            serde_json::from_str(&serde_json::to_string(&bounded).unwrap()).unwrap();
        assert_eq!(back, bounded);
    }

    // ── Overrides / cover requests (§5) ─────────────────────────────────────

    fn cover(id: &str, user: &str, start: i64, end: i64, created_at: i64) -> ScheduleOverride {
        ScheduleOverride {
            id: id.into(),
            slot: None,
            org_id: "default".into(),
            team_id: "team_1".into(),
            user_email: user.into(),
            start_at: start,
            end_at: end,
            covering_for: None,
            reason: None,
            created_by: "ana@o2.ai".into(),
            created_at,
        }
    }

    #[test]
    fn test_an_override_bound_is_inclusive_at_the_start_and_exclusive_at_the_end() {
        let o = cover("ov_1", "bob@o2.ai", 100, 200, 1);
        assert!(!o.covers(99));
        assert!(o.covers(100));
        assert!(o.covers(199));
        assert!(!o.covers(200), "back-to-back covers must not both apply");
    }

    /// §5 step 1: an override beats every layer, including one somebody set to
    /// the highest priority in the schedule. That is what makes a cover the
    /// last word and why it needs no approval workflow.
    #[test]
    fn test_an_override_beats_every_layer() {
        let mut top = retirable("Top", "top@o2.ai", i32::MAX);
        top.restrictions = vec![window(&[], 0, 1440)];
        let rotations = vec![retirable("Base", "base@o2.ai", 0), top];
        let overrides = vec![cover("ov_1", "cover@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1)];

        assert_eq!(
            on_call_now(&rotations, &overrides, &[], ANCHOR, TZ).as_deref(),
            Some("cover@o2.ai")
        );
        // And outside the window the layers are untouched: an override never
        // mutates the rotation.
        assert_eq!(
            on_call_now(&rotations, &overrides, &[], ANCHOR + MICROS_PER_DAY, TZ).as_deref(),
            Some("top@o2.ai")
        );
    }

    /// An override standing over hours no layer covers is still coverage. This
    /// is the "cover tonight" case for a schedule with a weekday-only layer.
    #[test]
    fn test_an_override_can_stand_over_a_coverage_gap() {
        let rotations = vec![layer(
            "Office hours",
            &["office@o2.ai"],
            0,
            vec![window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60)],
        )];
        let saturday = local(IST, 2026, 8, 15, 12, 0);
        let overrides = vec![cover("ov_1", "sam@o2.ai", saturday - 1, saturday + 1, 1)];

        assert_eq!(
            on_call_now(&rotations, &overrides, &[], saturday, IST).as_deref(),
            Some("sam@o2.ai")
        );
        let slots = resolve_on_call(&rotations, &overrides, &[], saturday, IST);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].override_id.as_deref(), Some("ov_1"));
        assert_eq!(
            slots[0].rotation, OVERRIDE_ROTATION_NAME,
            "no layer was displaced, so the slot says so"
        );
    }

    /// The overlap rule, stated in `covering_override`: latest `created_at`
    /// wins, `id` breaks a tie. Deterministic on every node, and explainable
    /// in one sentence — which is why there is no approval workflow.
    #[test]
    fn test_the_latest_created_override_wins_the_overlap() {
        let first = cover("ov_a", "first@o2.ai", 0, 1000, 10);
        let second = cover("ov_b", "second@o2.ai", 500, 1500, 20);

        // Before the second one starts, the first still holds.
        assert_eq!(
            covering_override(&[first.clone(), second.clone()], 400)
                .unwrap()
                .user_email,
            "first@o2.ai"
        );
        // In the overlap, the one created later.
        for order in [
            vec![first.clone(), second.clone()],
            vec![second.clone(), first.clone()],
        ] {
            assert_eq!(
                covering_override(&order, 700).unwrap().user_email,
                "second@o2.ai",
                "list order must not decide the winner"
            );
        }
        // After the first ends, only the second is left.
        assert_eq!(
            covering_override(&[first, second], 1200).unwrap().user_email,
            "second@o2.ai"
        );
    }

    /// Two rows can share a microsecond — a bulk create, or a coarse clock.
    /// The answer still has to be the same on every node, so the id decides.
    #[test]
    fn test_overrides_created_in_the_same_microsecond_still_resolve_deterministically() {
        let a = cover("ov_a", "a@o2.ai", 0, 1000, 50);
        let b = cover("ov_b", "b@o2.ai", 0, 1000, 50);
        assert_eq!(covering_override(&[a.clone(), b.clone()], 10).unwrap().id, "ov_b");
        assert_eq!(covering_override(&[b, a], 10).unwrap().id, "ov_b");
    }

    /// Deleting the override restores the computed result — §5. Nothing about
    /// the rotation was changed while it stood.
    #[test]
    fn test_removing_an_override_restores_the_rotation() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let overrides = vec![cover("ov_1", "cara@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1)];
        assert_eq!(
            on_call_now(&rotations, &overrides, &[], ANCHOR, TZ).as_deref(),
            Some("cara@o2.ai")
        );
        assert_eq!(
            on_call_now(&rotations, &[], &[], ANCHOR, TZ).as_deref(),
            Some("ana@o2.ai")
        );
    }

    /// A rung that pages the same engineer twice is not an escalation. With a
    /// two-person rotation and a cover taken by the other member, the roster's
    /// "next" IS the coverer, so the next-but-one is used.
    #[test]
    fn test_the_next_on_call_is_never_the_person_already_covering() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into(), "cara@o2.ai".into()],
            ANCHOR,
        )];
        // ana is rostered at ANCHOR, bob is next. bob takes the cover.
        let overrides = vec![cover("ov_1", "bob@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1)];

        assert_eq!(
            on_call_now(&rotations, &overrides, &[], ANCHOR, TZ).as_deref(),
            Some("bob@o2.ai")
        );
        assert_eq!(
            next_on_call(&rotations, &overrides, &[], ANCHOR, TZ).as_deref(),
            Some("cara@o2.ai"),
            "rung two must reach somebody else"
        );
        // Matching is case-insensitive; membership is stored lowercased but a
        // hand-written override may not be.
        let shouty = vec![cover("ov_1", "BOB@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1)];
        assert_eq!(
            next_on_call(&rotations, &shouty, &[], ANCHOR, TZ).as_deref(),
            Some("cara@o2.ai")
        );
    }

    /// Somebody from outside the rotation covering does not reorder it: rung
    /// two is still the roster's next.
    #[test]
    fn test_an_outside_coverer_leaves_the_handover_order_alone() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let overrides = vec![cover("ov_1", "dev@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1)];
        assert_eq!(
            next_on_call(&rotations, &overrides, &[], ANCHOR, TZ).as_deref(),
            Some("bob@o2.ai")
        );
    }

    /// §7's level 3 is the broadcast of last resort. One that leaves out the
    /// person actually holding the pager is not one — and nobody is removed,
    /// because shrinking the final rung to arrange a night off is how a page
    /// reaches an empty room.
    #[test]
    fn test_everyone_on_schedule_includes_the_coverer_and_drops_nobody() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let outside = vec![cover("ov_1", "dev@o2.ai", ANCHOR, ANCHOR + 10, 1)];
        assert_eq!(
            everyone_on_schedule(&rotations, &outside, &[], ANCHOR, TZ),
            vec![
                "ana@o2.ai".to_string(),
                "bob@o2.ai".to_string(),
                "dev@o2.ai".to_string()
            ]
        );
        // A coverer already on the roster is not listed twice.
        let inside = vec![cover("ov_1", "BOB@o2.ai", ANCHOR, ANCHOR + 10, 1)];
        assert_eq!(
            everyone_on_schedule(&rotations, &inside, &[], ANCHOR, TZ),
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()]
        );
    }

    /// A cover from 18:00 to 09:00 the next morning is the commonest one there
    /// is, and it has to mean the same wall-clock hours in the two zones a
    /// distributed team reads it in. Stored in absolute micros, so it does.
    #[test]
    fn test_a_cover_spanning_midnight_means_the_same_hours_in_every_zone() {
        let ny = chrono_tz::America::New_York;
        let start = local(IST, 2026, 8, 10, 18, 0);
        let end = local(IST, 2026, 8, 11, 9, 0);
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into()],
            ANCHOR,
        )];
        let overrides = vec![cover("ov_1", "sam@o2.ai", start, end, 1)];

        for tz in [IST, ny, chrono_tz::UTC] {
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], start, tz).as_deref(),
                Some("sam@o2.ai"),
                "{tz}"
            );
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], local(IST, 2026, 8, 11, 2, 0), tz)
                    .as_deref(),
                Some("sam@o2.ai"),
                "{tz} across local midnight"
            );
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], end, tz).as_deref(),
                Some("ana@o2.ai"),
                "{tz} after it ends"
            );
        }
    }

    /// A partial-day cover is exact to the microsecond, not rounded to a
    /// shift. "Take my afternoon" is the whole point of §5's one interaction.
    #[test]
    fn test_a_partial_day_cover_takes_exactly_its_hours() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into()],
            ANCHOR,
        )];
        let start = local(IST, 2026, 8, 10, 13, 0);
        let end = local(IST, 2026, 8, 10, 17, 30);
        let overrides = vec![cover("ov_1", "sam@o2.ai", start, end, 1)];

        for (at, expected) in [
            (start - 1, "ana@o2.ai"),
            (start, "sam@o2.ai"),
            (end - 1, "sam@o2.ai"),
            (end, "ana@o2.ai"),
        ] {
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], at, IST).as_deref(),
                Some(expected)
            );
        }
    }

    // ── Overrides and DST (§9) ──────────────────────────────────────────────
    //
    // Overrides are absolute instants, so a transition inside one must not
    // change who holds the pager or how long they hold it for. The failure
    // this guards is an implementation that re-derives the bounds in local
    // time and hands an hour of the cover back to the rostered engineer.

    /// A cover across the spring-forward. The clock skips an hour; the cover
    /// is still continuous, and it is an hour shorter in wall time than it
    /// looks — which is what an absolute range means.
    #[test]
    fn test_a_cover_spanning_the_spring_forward_is_continuous() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            local(NY, 2026, 3, 2, 9, 0),
        )];
        // 2026-03-08 02:00 → 03:00 local.
        let start = local(NY, 2026, 3, 7, 20, 0);
        let end = local(NY, 2026, 3, 8, 12, 0);
        let overrides = vec![cover("ov_1", "sam@o2.ai", start, end, 1)];

        assert_eq!(
            end - start,
            15 * HOUR,
            "the night that loses an hour is 15 real hours from 20:00 to 12:00"
        );
        // Every hour of it, including the two either side of the hole.
        let mut at = start;
        while at < end {
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], at, NY).as_deref(),
                Some("sam@o2.ai"),
                "{at} fell out of the cover"
            );
            at += HOUR;
        }
        assert_eq!(
            on_call_now(&rotations, &overrides, &[], end, NY).as_deref(),
            Some("ana@o2.ai")
        );
    }

    /// The mirror: a cover across the fall-back. The repeated hour is inside
    /// it exactly once as far as the pager is concerned — the local clock goes
    /// backwards and the holder must not go with it.
    #[test]
    fn test_a_cover_spanning_the_fall_back_holds_through_the_repeated_hour() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            local(NY, 2026, 10, 26, 9, 0),
        )];
        // 2026-11-01 02:00 → 01:00 local.
        let start = local(NY, 2026, 10, 31, 20, 0);
        let end = local(NY, 2026, 11, 1, 12, 0);
        let overrides = vec![cover("ov_1", "sam@o2.ai", start, end, 1)];

        assert_eq!(end - start, 17 * HOUR, "the night that gains an hour");
        for minutes in 0..(17 * 60) {
            let at = start + minutes * MICROS_PER_MINUTE;
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], at, NY).as_deref(),
                Some("sam@o2.ai"),
                "minute {minutes} fell out of the cover"
            );
        }
        assert_eq!(
            on_call_now(&rotations, &overrides, &[], end, NY).as_deref(),
            Some("ana@o2.ai")
        );
    }

    /// A cover whose end lands inside the hour the clock never reads. It is an
    /// absolute instant, so it simply ends there — the hole in the local
    /// calendar is not a hole in the timeline.
    #[test]
    fn test_a_cover_ending_inside_the_skipped_hour_still_ends() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into()],
            local(NY, 2026, 3, 2, 9, 0),
        )];
        // 02:30 EST on the spring-forward morning is the first instant after
        // the clock jumps: 03:30 EDT.
        let skipped = local(NY, 2026, 3, 8, 1, 30) + HOUR;
        let overrides = vec![cover("ov_1", "sam@o2.ai", skipped - HOUR, skipped, 1)];

        assert_eq!(
            on_call_now(&rotations, &overrides, &[], skipped - 1, NY).as_deref(),
            Some("sam@o2.ai")
        );
        assert_eq!(
            on_call_now(&rotations, &overrides, &[], skipped, NY).as_deref(),
            Some("ana@o2.ai")
        );
    }

    /// A handover landing inside the skipped hour, with a cover standing over
    /// it: the cover wins on both sides, and the handover underneath still
    /// happens exactly once when the cover lifts.
    #[test]
    fn test_a_cover_over_a_handover_in_the_skipped_hour() {
        let anchor = local(NY, 2026, 3, 5, 2, 30);
        let rotations = vec![daily(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"], anchor)];
        // The handover the clock cannot read: it fires at 03:00 on the 8th.
        let handover = rotations[0]
            .next_handover(local(NY, 2026, 3, 7, 12, 0), NY)
            .unwrap();
        assert_eq!(handover, local(NY, 2026, 3, 8, 3, 0));

        let overrides = vec![cover("ov_1", "sam@o2.ai", handover - HOUR, handover + HOUR, 1)];
        for at in [handover - HOUR, handover - 1, handover, handover + HOUR - 1] {
            assert_eq!(
                on_call_now(&rotations, &overrides, &[], at, NY).as_deref(),
                Some("sam@o2.ai"),
                "{at}"
            );
        }
        // The rotation underneath is untouched: it handed over once, at the
        // instant the clock reached it.
        assert_ne!(
            on_call_now(&rotations, &[], &[], handover - 1, NY),
            on_call_now(&rotations, &[], &[], handover, NY)
        );
        assert_eq!(
            on_call_now(&rotations, &overrides, &[], handover + HOUR, NY),
            on_call_now(&rotations, &[], &[], handover + HOUR, NY),
            "when the cover lifts, the rotation's own answer comes back"
        );
    }

    #[test]
    fn test_an_override_round_trips_through_json() {
        let mut o = cover("ov_1", "sam@o2.ai", 100, 200, 5);
        let json = serde_json::to_string(&o).unwrap();
        assert!(!json.contains("covering_for"), "absent fields add no noise");
        assert_eq!(serde_json::from_str::<ScheduleOverride>(&json).unwrap(), o);

        o.covering_for = Some("ana@o2.ai".into());
        o.reason = Some("dentist".into());
        let back: ScheduleOverride =
            serde_json::from_str(&serde_json::to_string(&o).unwrap()).unwrap();
        assert_eq!(back, o);
    }

    // ── The resolved schedule (§3b) ─────────────────────────────────────────

    /// The segments have to tile the window exactly: no holes, no overlaps,
    /// starting at `from` and ending at `to`. Everything else the grid says is
    /// worthless if this is not true.
    fn assert_tiles(segments: &[CoverageSegment], from: i64, to: i64) {
        assert!(!segments.is_empty(), "a window always resolves to something");
        assert_eq!(segments[0].from, from);
        assert_eq!(segments[segments.len() - 1].to, to);
        for pair in segments.windows(2) {
            assert_eq!(pair[0].to, pair[1].from, "segments must be contiguous");
        }
        for s in segments {
            assert!(s.from < s.to, "a segment must have width");
        }
    }

    #[test]
    fn test_a_quiet_week_resolves_to_one_segment() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let (from, to) = (ANCHOR, ANCHOR + MICROS_PER_WEEK);
        let segments = resolve_window(&rotations, &[], &[], from, to, TZ).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(segments.len(), 1, "one shift, one row — not 168 identical ones");
        assert_eq!(segments[0].user_email.as_deref(), Some("ana@o2.ai"));
        assert_eq!(segments[0].rotation.as_deref(), Some("On-call rotation"));
    }

    #[test]
    fn test_the_grid_breaks_at_every_handover() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let (from, to) = (ANCHOR, ANCHOR + 3 * MICROS_PER_WEEK);
        let segments = resolve_window(&rotations, &[], &[], from, to, TZ).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(
            segments
                .iter()
                .map(|s| s.user_email.clone().unwrap())
                .collect::<Vec<_>>(),
            vec!["ana@o2.ai", "bob@o2.ai", "ana@o2.ai"]
        );
        assert_eq!(segments[1].from, ANCHOR + MICROS_PER_WEEK);
    }

    /// §3b: a gap is a segment, not a missing row. A caller that has to infer
    /// a hole from what is absent never notices it.
    #[test]
    fn test_coverage_gaps_are_marked_not_omitted() {
        let rotations = vec![layer(
            "Office hours",
            &["office@o2.ai"],
            0,
            vec![window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60)],
        )];
        let from = local(IST, 2026, 8, 10, 0, 0); // Monday 00:00
        let to = from + MICROS_PER_DAY;
        let segments = resolve_window(&rotations, &[], &[], from, to, IST).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(segments.len(), 3, "gap, office hours, gap");
        assert!(segments[0].is_gap());
        assert_eq!(segments[1].user_email.as_deref(), Some("office@o2.ai"));
        assert_eq!(segments[1].from, local(IST, 2026, 8, 10, 9, 0));
        assert_eq!(segments[1].to, local(IST, 2026, 8, 10, 17, 0));
        assert!(segments[2].is_gap());
    }

    /// The grid is the resolved schedule, so a cover appears in it as a cover
    /// — marked, and splitting the shift it took a slice out of.
    #[test]
    fn test_an_override_splits_the_segment_it_covers() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into()],
            ANCHOR,
        )];
        let (from, to) = (ANCHOR, ANCHOR + MICROS_PER_DAY);
        let overrides = vec![cover(
            "ov_1",
            "sam@o2.ai",
            ANCHOR + 6 * MICROS_PER_HOUR,
            ANCHOR + 9 * MICROS_PER_HOUR,
            1,
        )];
        let segments = resolve_window(&rotations, &overrides, &[], from, to, TZ).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[1].user_email.as_deref(), Some("sam@o2.ai"));
        assert_eq!(segments[1].override_id.as_deref(), Some("ov_1"));
        assert_eq!(
            segments[1].rotation.as_deref(),
            Some("On-call rotation"),
            "the grid says which layer the cover displaced"
        );
        assert_eq!(segments[0].override_id, None);
        assert_eq!(segments[2].user_email.as_deref(), Some("ana@o2.ai"));
    }

    /// A retired layer shows up in the grid as the moment its hours went back
    /// to the layer underneath.
    #[test]
    fn test_the_grid_shows_a_layer_retiring() {
        let retired_at = ANCHOR + 2 * MICROS_PER_DAY;
        let mut weekend = retirable("Weekends", "bob@o2.ai", 10);
        weekend.ends_at = Some(retired_at);
        let rotations = vec![retirable("Base", "ana@o2.ai", 0), weekend];
        let (from, to) = (ANCHOR, ANCHOR + 4 * MICROS_PER_DAY);

        let segments = resolve_window(&rotations, &[], &[], from, to, TZ).unwrap();
        assert_tiles(&segments, from, to);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].rotation.as_deref(), Some("Weekends"));
        assert_eq!(segments[1].from, retired_at);
        assert_eq!(segments[1].rotation.as_deref(), Some("Base"));
    }

    /// Follow-the-sun resolved: three restricted layers and a catch-all, over a
    /// day, read as the handover sequence a human would draw.
    #[test]
    fn test_the_grid_resolves_follow_the_sun_without_the_layer_maths() {
        let rotations = vec![
            layer("Catch-all", &["catchall@o2.ai"], 0, vec![]),
            layer("APAC", &["apac@o2.ai"], 10, vec![window(&[], 6 * 60, 14 * 60)]),
            layer("EMEA", &["emea@o2.ai"], 10, vec![window(&[], 14 * 60, 22 * 60)]),
        ];
        let from = local(IST, 2026, 8, 10, 0, 0);
        let to = from + MICROS_PER_DAY;
        let segments = resolve_window(&rotations, &[], &[], from, to, IST).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(
            segments
                .iter()
                .map(|s| s.user_email.clone().unwrap())
                .collect::<Vec<_>>(),
            vec!["catchall@o2.ai", "apac@o2.ai", "emea@o2.ai", "catchall@o2.ai"]
        );
        assert_eq!(segments[1].from, local(IST, 2026, 8, 10, 6, 0));
        assert_eq!(segments[2].from, local(IST, 2026, 8, 10, 14, 0));
        assert_eq!(segments[3].from, local(IST, 2026, 8, 10, 22, 0));
    }

    /// A restriction window is wall-clock, so the grid over a DST weekend has
    /// to keep opening it at 09:00 local rather than drifting an hour.
    #[test]
    fn test_the_grid_keeps_restriction_edges_on_local_time_across_dst() {
        let rotations = vec![layer(
            "Office hours",
            &["office@o2.ai"],
            0,
            vec![window(&[], 9 * 60, 17 * 60)],
        )];
        let from = local(NY, 2026, 3, 7, 0, 0);
        let to = local(NY, 2026, 3, 10, 0, 0);
        let segments = resolve_window(&rotations, &[], &[], from, to, NY).unwrap();

        assert_tiles(&segments, from, to);
        let opens: Vec<i64> = segments
            .iter()
            .filter(|s| !s.is_gap())
            .map(|s| s.from)
            .collect();
        assert_eq!(
            opens,
            vec![
                local(NY, 2026, 3, 7, 9, 0),
                local(NY, 2026, 3, 8, 9, 0),
                local(NY, 2026, 3, 9, 9, 0),
            ],
            "09:00 local on all three days, including the one that lost an hour"
        );
    }

    /// A caller asking for a year gets an error, not a million rows.
    #[test]
    fn test_the_window_is_bounded() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into()],
            ANCHOR,
        )];
        let err = resolve_window(&rotations, &[], &[], ANCHOR, ANCHOR + 365 * MICROS_PER_DAY, TZ)
            .unwrap_err();
        assert!(
            matches!(err, GridError::WindowTooLong { .. }),
            "a year must be refused: {err}"
        );
        assert!(err.to_string().contains(&MAX_GRID_MICROS.to_string()));

        // The bound itself is usable.
        resolve_window(&rotations, &[], &[], ANCHOR, ANCHOR + MAX_GRID_MICROS, TZ).unwrap();
        // And an inverted window is a caller mistake, not an empty answer.
        assert!(matches!(
            resolve_window(&rotations, &[], &[], ANCHOR, ANCHOR, TZ).unwrap_err(),
            GridError::InvertedWindow { .. }
        ));
    }

    /// The segment budget, so a pathological schedule cannot return a
    /// truncated grid that looks like a schedule which ends.
    #[test]
    fn test_a_schedule_that_shreds_the_window_is_refused_rather_than_truncated() {
        let mut r = Rotation::weekly(
            "Flapping",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        );
        // A one-minute shift over a month is far past any honest schedule.
        r.shift_micros = MICROS_PER_MINUTE;
        let err = resolve_window(&[r], &[], &[], ANCHOR, ANCHOR + MAX_GRID_MICROS, TZ).unwrap_err();
        assert!(
            matches!(err, GridError::TooManySegments { .. }),
            "expected a segment-budget refusal, got {err}"
        );
    }

    /// The mirror: a rotation that hands over constantly but always to the
    /// same person is one row, because the ANSWER never changes. Merging is
    /// what keeps the honest cases small.
    #[test]
    fn test_a_one_person_rotation_is_one_segment_however_often_it_hands_over() {
        let mut r = Rotation::weekly("Solo", vec!["ana@o2.ai".into()], ANCHOR);
        r.shift_micros = MICROS_PER_MINUTE;
        let segments = resolve_window(&[r], &[], &[], ANCHOR, ANCHOR + MICROS_PER_DAY, TZ).unwrap();
        assert_eq!(segments.len(), 1);
    }

    /// Overlapping covers in the grid follow the same rule as at a point:
    /// latest created wins, and the grid shows the handover between them.
    #[test]
    fn test_the_grid_applies_the_overlap_rule() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into()],
            ANCHOR,
        )];
        let overrides = vec![
            cover("ov_a", "first@o2.ai", ANCHOR + 1000, ANCHOR + 5000, 10),
            cover("ov_b", "second@o2.ai", ANCHOR + 3000, ANCHOR + 7000, 20),
        ];
        let (from, to) = (ANCHOR, ANCHOR + 10_000);
        let segments = resolve_window(&rotations, &overrides, &[], from, to, TZ).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(
            segments
                .iter()
                .map(|s| (s.from, s.user_email.clone().unwrap()))
                .collect::<Vec<_>>(),
            vec![
                (ANCHOR, "ana@o2.ai".to_string()),
                (ANCHOR + 1000, "first@o2.ai".to_string()),
                (ANCHOR + 3000, "second@o2.ai".to_string()),
                (ANCHOR + 7000, "ana@o2.ai".to_string()),
            ],
            "the later cover takes the overlap from 3000, not from 5000"
        );
    }

    /// An override that starts before the window and ends after it covers the
    /// whole of it, without contributing boundaries outside it.
    #[test]
    fn test_an_override_enclosing_the_whole_window_is_one_segment() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let (from, to) = (ANCHOR, ANCHOR + 2 * MICROS_PER_WEEK);
        let overrides = vec![cover("ov_1", "sam@o2.ai", from - MICROS_PER_DAY, to + MICROS_PER_DAY, 1)];
        let segments = resolve_window(&rotations, &overrides, &[], from, to, TZ).unwrap();

        assert_tiles(&segments, from, to);
        assert_eq!(
            segments.len(),
            1,
            "the handover underneath is invisible while one person covers both shifts"
        );
        assert_eq!(segments[0].user_email.as_deref(), Some("sam@o2.ai"));
    }

    // ── Slots (GAP 1) ───────────────────────────────────────────────────────
    //
    // A slot is an independently-resolved position. Everything below is about
    // one of two claims: two slots answer at the same instant without
    // interfering, and a schedule that predates slots keeps meaning exactly
    // what it meant.

    /// The gap in one test. A junior pool and a senior pool, different people,
    /// different handover days, both resolving at the same instant — and the
    /// secondary is emphatically NOT next week's primary.
    #[test]
    fn test_two_slots_resolve_simultaneously_and_independently() {
        let rotations = vec![
            Rotation::weekly(
                "Juniors",
                vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
                ANCHOR,
            ),
            // Handing over three days later: separate slots do not have to
            // share a handover day, which one flat cycle forced on them.
            Rotation::weekly(
                "Seniors",
                vec!["eve@o2.ai".into(), "fay@o2.ai".into()],
                ANCHOR - 4 * MICROS_PER_DAY,
            )
            .in_slot("secondary"),
        ];

        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], DEFAULT_SLOT, ANCHOR, TZ).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], "secondary", ANCHOR, TZ).as_deref(),
            Some("eve@o2.ai"),
            "the secondary is a different person from a different pool"
        );

        // Four days on, the senior rotation has handed over and the junior one
        // has not. Neither move disturbed the other.
        let later = ANCHOR + 4 * MICROS_PER_DAY;
        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], DEFAULT_SLOT, later, TZ).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], "secondary", later, TZ).as_deref(),
            Some("fay@o2.ai")
        );

        // And this week's secondary never becomes next week's primary.
        let next_week = ANCHOR + MICROS_PER_WEEK;
        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], DEFAULT_SLOT, next_week, TZ).as_deref(),
            Some("bob@o2.ai")
        );
        assert!(
            !["eve@o2.ai", "fay@o2.ai"]
                .contains(&on_call_in_slot(&rotations, &[], &[], DEFAULT_SLOT, next_week, TZ).unwrap().as_str()),
            "a senior must never be promoted into the junior rotation by the calendar"
        );
    }

    /// `resolve_on_call` answers for every slot at once, which is what the
    /// team header reads. One entry per slot, default first.
    #[test]
    fn test_on_call_lists_one_entry_per_slot_default_first() {
        let rotations = vec![
            Rotation::weekly("Seniors", vec!["eve@o2.ai".into()], ANCHOR).in_slot("secondary"),
            Rotation::weekly("Juniors", vec!["ana@o2.ai".into()], ANCHOR),
        ];
        let slots = resolve_on_call(&rotations, &[], &[], ANCHOR, TZ);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].slot, DEFAULT_SLOT, "the primary reads first");
        assert_eq!(slots[0].user_email, "ana@o2.ai");
        assert_eq!(slots[1].slot, "secondary");
        assert_eq!(slots[1].user_email, "eve@o2.ai");
    }

    /// Layering is a within-slot contest, so follow-the-sun must be untouched
    /// by the arrival of a second slot beside it. Three restricted layers over
    /// a catch-all, checked hour by hour, with a secondary running alongside.
    #[test]
    fn test_follow_the_sun_still_resolves_inside_one_slot() {
        let window = |start_hour: u32, end_hour: u32| TimeWindow {
            days: vec![],
            start_minute: start_hour * 60,
            end_minute: end_hour * 60,
        };
        let layer = |name: &str, member: &str, priority: i32, w: Option<TimeWindow>| Rotation {
            name: name.into(),
            slot: DEFAULT_SLOT.to_string(),
            members: vec![member.into()],
            shift_micros: MICROS_PER_WEEK,
            anchor_micros: ANCHOR,
            priority,
            restrictions: w.into_iter().collect(),
            starts_at: None,
            ends_at: None,
        };
        let rotations = vec![
            layer("APAC", "apac@o2.ai", 30, Some(window(0, 8))),
            layer("EMEA", "emea@o2.ai", 30, Some(window(8, 16))),
            layer("AMER", "amer@o2.ai", 30, Some(window(16, 24))),
            layer("Catch-all", "cat@o2.ai", 10, None),
            // A senior slot beside them, unrestricted and higher priority than
            // any of the layers — it must not steal a single hour, because it
            // is not in the contest at all.
            Rotation::weekly("Seniors", vec!["eve@o2.ai".into()], ANCHOR)
                .in_slot("secondary"),
        ];

        // Counted from a local midnight, because the layers are described in
        // wall-clock hours and `ANCHOR` is an arbitrary instant.
        let midnight = local(TZ, 2026, 3, 2, 0, 0);
        for hour in 0..24i64 {
            let at = midnight + hour * MICROS_PER_HOUR;
            let expected = match hour {
                0..=7 => "apac@o2.ai",
                8..=15 => "emea@o2.ai",
                _ => "amer@o2.ai",
            };
            assert_eq!(
                on_call_now(&rotations, &[], &[], at, TZ).as_deref(),
                Some(expected),
                "hour {hour}"
            );
            assert_eq!(
                on_call_in_slot(&rotations, &[], &[], "secondary", at, TZ).as_deref(),
                Some("eve@o2.ai"),
                "hour {hour}: the senior slot resolves regardless of the layer in force"
            );
        }
    }

    /// The upgrade path, which is the whole compatibility argument: JSON
    /// stored before slots existed parses as the default slot, resolves
    /// identically, and serialises back with no `slot` key — so a stored row is
    /// not rewritten by being read.
    #[test]
    fn test_a_stored_rotation_with_no_slot_is_the_default_slot() {
        let stored = r#"{
            "name": "On-call rotation",
            "members": ["ana@o2.ai", "bob@o2.ai"],
            "shift_micros": 604800000000,
            "anchor_micros": 1700000000000000,
            "priority": 0,
            "restrictions": []
        }"#;
        let r: Rotation = serde_json::from_str(stored).unwrap();
        assert_eq!(r.slot, DEFAULT_SLOT);
        r.validate().unwrap();

        let rotations = vec![r.clone()];
        assert_eq!(
            on_call_now(&rotations, &[], &[], ANCHOR, TZ).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], DEFAULT_SLOT, ANCHOR, TZ).as_deref(),
            Some("ana@o2.ai"),
            "naming the default slot explicitly is the same question"
        );
        assert_eq!(slots(&rotations), vec![DEFAULT_SLOT.to_string()]);

        let json = serde_json::to_string(&r).unwrap();
        assert!(
            !json.contains("slot"),
            "a default-slot rotation must go back on the wire as it came off it: {json}"
        );
        assert_eq!(serde_json::from_str::<Rotation>(&json).unwrap(), r);

        // A named slot does appear, or the field would be unusable.
        let named = r.in_slot("secondary");
        let json = serde_json::to_string(&named).unwrap();
        assert!(json.contains(r#""slot":"secondary""#), "{json}");
        assert_eq!(serde_json::from_str::<Rotation>(&json).unwrap(), named);
    }

    /// Two slots are two answers, so an override has to say which one it
    /// stands over. Otherwise arranging cover for the primary would silently
    /// take the secondary too, and the ladder would page one person twice.
    #[test]
    fn test_a_cover_only_takes_the_slot_it_names() {
        let rotations = vec![
            Rotation::weekly("Juniors", vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly("Seniors", vec!["eve@o2.ai".into()], ANCHOR).in_slot("secondary"),
        ];
        let mut ov = cover("ov_1", "sam@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1);
        ov.slot = Some("secondary".into());
        let overrides = vec![ov];

        assert_eq!(
            on_call_now(&rotations, &overrides, &[], ANCHOR, TZ).as_deref(),
            Some("ana@o2.ai"),
            "the primary is untouched by a cover on another slot"
        );
        assert_eq!(
            on_call_in_slot(&rotations, &overrides, &[], "secondary", ANCHOR, TZ).as_deref(),
            Some("sam@o2.ai")
        );
    }

    /// A stored cover with no slot means the default one, for the same reason
    /// a stored rotation does.
    #[test]
    fn test_a_cover_with_no_slot_is_the_default_slot() {
        let stored = cover("ov_1", "sam@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1);
        assert_eq!(stored.slot(), DEFAULT_SLOT);
        assert!(!serde_json::to_string(&stored).unwrap().contains("slot"));
        assert_eq!(
            covering_override(&[stored.clone()], ANCHOR).map(|o| o.id.as_str()),
            Some("ov_1")
        );
        assert!(covering_override_in_slot(&[stored], "secondary", ANCHOR).is_none());
    }

    /// The broadcast of last resort is the union across slots: a senior pool
    /// left out of the final rung is half the room not woken. A one-slot team
    /// gets exactly what it got before.
    #[test]
    fn test_everyone_on_schedule_unions_the_slots() {
        let juniors = Rotation::weekly(
            "Juniors",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        );
        assert_eq!(
            everyone_on_schedule(&[juniors.clone()], &[], &[], ANCHOR, TZ),
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()],
            "one slot resolves exactly as it did before slots existed"
        );

        let rotations = vec![
            juniors,
            Rotation::weekly("Seniors", vec!["eve@o2.ai".into(), "bob@o2.ai".into()], ANCHOR)
                .in_slot("secondary"),
        ];
        assert_eq!(
            everyone_on_schedule(&rotations, &[], &[], ANCHOR, TZ),
            vec![
                "ana@o2.ai".to_string(),
                "bob@o2.ai".to_string(),
                "eve@o2.ai".to_string()
            ],
            "deduplicated: somebody on both pools is one person to a page"
        );
        assert_eq!(
            everyone_in_slot(&rotations, &[], &[], "secondary", ANCHOR, TZ),
            vec!["eve@o2.ai".to_string(), "bob@o2.ai".to_string()],
            "and one slot can still be named on its own"
        );
    }

    /// Slot names are operator text, so two spellings of one slot must be one
    /// slot — a rung that says `Secondary` has to reach the rotation that says
    /// `secondary`, or it reaches nobody with no visible cause.
    #[test]
    fn test_slot_names_are_matched_case_insensitively() {
        let rotations =
            vec![Rotation::weekly("Seniors", vec!["eve@o2.ai".into()], ANCHOR).in_slot("Secondary")];
        assert_eq!(
            on_call_in_slot(&rotations, &[], &[], "secondary", ANCHOR, TZ).as_deref(),
            Some("eve@o2.ai")
        );
        assert_eq!(slots(&rotations), vec!["Secondary".to_string()]);
    }

    /// A rotation nothing can name is a rotation no rung can page.
    #[test]
    fn test_a_blank_or_overlong_slot_is_refused() {
        let mut r = Rotation::weekly("Primary", vec!["ana@o2.ai".into()], ANCHOR);
        r.slot = "   ".into();
        assert_eq!(r.validate(), Err(RotationError::BadSlot("   ".into())));
        r.slot = "x".repeat(MAX_SLOT_CHARS + 1);
        assert!(matches!(r.validate(), Err(RotationError::BadSlot(_))));
        r.slot = "x".repeat(MAX_SLOT_CHARS);
        r.validate().unwrap();
    }

    /// The grid is drawn one slot at a time, and each row carries the slot it
    /// answers for.
    #[test]
    fn test_the_grid_resolves_one_slot_at_a_time() {
        let rotations = vec![
            Rotation::weekly(
                "Juniors",
                vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
                ANCHOR,
            ),
            Rotation::weekly("Seniors", vec!["eve@o2.ai".into()], ANCHOR).in_slot("secondary"),
        ];
        let (from, to) = (ANCHOR, ANCHOR + 2 * MICROS_PER_WEEK);

        let primary = resolve_window(&rotations, &[], &[], from, to, TZ).unwrap();
        assert_tiles(&primary, from, to);
        assert_eq!(primary.len(), 2, "one handover in the window");
        assert!(primary.iter().all(|s| s.slot == DEFAULT_SLOT));
        assert_eq!(primary[0].user_email.as_deref(), Some("ana@o2.ai"));
        assert_eq!(primary[1].user_email.as_deref(), Some("bob@o2.ai"));

        let secondary =
            resolve_window_in_slot(&rotations, &[], &[], "secondary", from, to, TZ).unwrap();
        assert_tiles(&secondary, from, to);
        assert_eq!(
            secondary.len(),
            1,
            "a one-person rotation is one stretch, whatever the other slot does"
        );
        assert_eq!(secondary[0].slot, "secondary");
        assert_eq!(secondary[0].user_email.as_deref(), Some("eve@o2.ai"));
    }

    // ── Unavailability (GAP 2) ──────────────────────────────────────────────

    fn away(user: &str, start: i64, end: i64) -> Unavailability {
        Unavailability {
            id: format!("un_{user}_{start}"),
            org_id: "default".into(),
            user_email: user.into(),
            start_at: start,
            end_at: end,
            reason: Some("annual leave".into()),
            created_by: user.into(),
            created_at: 1,
        }
    }

    /// The headline: Ana is away for the week the rotation would give her, so
    /// it passes to the next person and nobody is woken on a beach.
    #[test]
    fn test_an_away_member_is_skipped_and_the_shift_passes_along() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into(), "cara@o2.ai".into()],
            ANCHOR,
        )];
        let unavailability = vec![away("ana@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK)];

        assert_eq!(
            on_call_now(&rotations, &[], &unavailability, ANCHOR, TZ).as_deref(),
            Some("bob@o2.ai"),
            "the shift passes to the next eligible member"
        );
        assert_eq!(
            next_on_call(&rotations, &[], &unavailability, ANCHOR, TZ).as_deref(),
            Some("cara@o2.ai"),
            "and rung two moves along with it rather than doubling up on bob"
        );

        // Nobody else's turn moved. Bob's own week is still Bob's, and Cara's
        // is still Cara's — which is the property that makes this safe to
        // recompute at any instant.
        assert_eq!(
            on_call_now(&rotations, &[], &unavailability, ANCHOR + MICROS_PER_WEEK, TZ).as_deref(),
            Some("bob@o2.ai")
        );
        assert_eq!(
            on_call_now(
                &rotations,
                &[],
                &unavailability,
                ANCHOR + 2 * MICROS_PER_WEEK,
                TZ
            )
            .as_deref(),
            Some("cara@o2.ai")
        );
    }

    /// The skip wraps: away at the end of the order hands back to the top,
    /// and consecutive absences are walked through rather than stopping at the
    /// first one.
    #[test]
    fn test_the_skip_wraps_round_the_cycle() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into(), "cara@o2.ai".into()],
            ANCHOR,
        )];
        // Cara's week, and both Cara and Ana — the next along — are away, so
        // it wraps past the end of the list and lands on Bob.
        let at = ANCHOR + 2 * MICROS_PER_WEEK;
        let unavailability = vec![
            away("cara@o2.ai", at, at + MICROS_PER_WEEK),
            away("ana@o2.ai", at, at + MICROS_PER_WEEK),
        ];
        assert_eq!(
            on_call_now(&rotations, &[], &unavailability, at, TZ).as_deref(),
            Some("bob@o2.ai")
        );
        assert_eq!(
            next_on_call(&rotations, &[], &unavailability, at, TZ),
            None,
            "there is nobody else left, and saying otherwise would be a lie"
        );
    }

    /// Everybody away is a coverage gap — the same answer an empty rotation
    /// gives, reported by the same sweep. Never a loop, never a panic, and
    /// never the away person.
    #[test]
    fn test_everybody_away_degrades_to_a_coverage_gap() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let unavailability = vec![
            away("ana@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK),
            away("bob@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK),
        ];

        assert_eq!(on_call_now(&rotations, &[], &unavailability, ANCHOR, TZ), None);
        assert_eq!(next_on_call(&rotations, &[], &unavailability, ANCHOR, TZ), None);
        assert!(resolve_on_call(&rotations, &[], &unavailability, ANCHOR, TZ).is_empty());
        assert!(everyone_on_schedule(&rotations, &[], &unavailability, ANCHOR, TZ).is_empty());

        // And the grid says so out loud rather than leaving a hole in the list.
        let segments = resolve_window(
            &rotations,
            &[],
            &unavailability,
            ANCHOR,
            ANCHOR + MICROS_PER_WEEK,
            TZ,
        )
        .unwrap();
        assert_tiles(&segments, ANCHOR, ANCHOR + MICROS_PER_WEEK);
        assert!(segments.iter().all(|s| s.is_gap()), "{segments:?}");
    }

    /// Claiming a window is a statement of intent, and the product must not
    /// decide it knows better. The commonest reason for a cover to overlap
    /// somebody's own leave is that they cut it short to take the shift.
    #[test]
    fn test_an_override_outranks_an_absence() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let overrides = vec![cover("ov_1", "sam@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY, 1)];
        // Sam is on record as away for exactly the window Sam just claimed.
        let unavailability = vec![away("sam@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK)];

        assert_eq!(
            on_call_now(&rotations, &overrides, &unavailability, ANCHOR, TZ).as_deref(),
            Some("sam@o2.ai")
        );
        assert_eq!(
            resolve_on_call(&rotations, &overrides, &unavailability, ANCHOR, TZ)[0].user_email,
            "sam@o2.ai"
        );
        // The layer underneath is still skipped normally once the cover ends.
        let after = ANCHOR + MICROS_PER_DAY;
        let unavailability = vec![away("ana@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK)];
        assert_eq!(
            on_call_now(&rotations, &overrides, &unavailability, after, TZ).as_deref(),
            Some("bob@o2.ai")
        );
    }

    /// Determinism, which is the property the whole skip rule stands on.
    ///
    /// Two things are asserted, and they are different. **Repeatability**: the
    /// same inputs give the same answer however many times they are asked, and
    /// however the absence rows are ordered — they arrive from a database with
    /// no promised order, and a resolution that depended on it would page a
    /// different person on each node. **Stability**: adding an absence for one
    /// person changes only the shifts that person would have held. Every other
    /// stretch of the grid is byte-identical, so the calendar does not reshuffle
    /// under somebody who was only marking a Tuesday off.
    #[test]
    fn test_the_skip_is_deterministic_and_does_not_reshuffle_the_grid() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec![
                "ana@o2.ai".into(),
                "bob@o2.ai".into(),
                "cara@o2.ai".into(),
                "dev@o2.ai".into(),
            ],
            ANCHOR,
        )];
        let (from, to) = (ANCHOR, ANCHOR + 4 * MICROS_PER_WEEK);
        let before = resolve_window(&rotations, &[], &[], from, to, TZ).unwrap();

        // Cara is away for her own week — the third one — and for nothing else.
        let cara_week = ANCHOR + 2 * MICROS_PER_WEEK;
        let unavailability = vec![
            away("cara@o2.ai", cara_week, cara_week + MICROS_PER_WEEK),
            // A second window, for somebody whose shift it never touches.
            away("dev@o2.ai", ANCHOR, ANCHOR + MICROS_PER_DAY),
        ];

        // Repeatable: ten reads, and a reversed row order, all agree.
        let first = resolve_window(&rotations, &[], &unavailability, from, to, TZ).unwrap();
        for _ in 0..10 {
            assert_eq!(
                resolve_window(&rotations, &[], &unavailability, from, to, TZ).unwrap(),
                first
            );
        }
        let reversed: Vec<_> = unavailability.iter().rev().cloned().collect();
        assert_eq!(
            resolve_window(&rotations, &[], &reversed, from, to, TZ).unwrap(),
            first,
            "the answer must not depend on the order the rows came back in"
        );

        // Stable: only Cara's week changed hands, and it went to the next
        // person in the order rather than re-dealing the cycle.
        let holder_at = |segments: &[CoverageSegment], at: i64| -> Option<String> {
            segments
                .iter()
                .find(|s| at >= s.from && at < s.to)
                .and_then(|s| s.user_email.clone())
        };
        for week in 0..4i64 {
            let at = ANCHOR + week * MICROS_PER_WEEK + MICROS_PER_DAY;
            let (was, now) = (holder_at(&before, at), holder_at(&first, at));
            if week == 2 {
                assert_eq!(was.as_deref(), Some("cara@o2.ai"));
                assert_eq!(now.as_deref(), Some("dev@o2.ai"), "passed to the next along");
            } else {
                assert_eq!(was, now, "week {week} must not move");
            }
        }
    }

    /// An absence starting mid-shift hands the pager over and takes it back,
    /// so both edges are boundaries the grid has to show.
    #[test]
    fn test_an_absence_inside_a_shift_splits_the_segment() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let (start, end) = (ANCHOR + 2 * MICROS_PER_DAY, ANCHOR + 4 * MICROS_PER_DAY);
        let unavailability = vec![away("ana@o2.ai", start, end)];
        let segments = resolve_window(
            &rotations,
            &[],
            &unavailability,
            ANCHOR,
            ANCHOR + MICROS_PER_WEEK,
            TZ,
        )
        .unwrap();

        assert_tiles(&segments, ANCHOR, ANCHOR + MICROS_PER_WEEK);
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].user_email.as_deref(), Some("ana@o2.ai"));
        assert_eq!(segments[1].user_email.as_deref(), Some("bob@o2.ai"));
        assert_eq!((segments[1].from, segments[1].to), (start, end));
        assert_eq!(segments[2].user_email.as_deref(), Some("ana@o2.ai"));
    }

    /// A skip across a spring-forward week. The handover is a wall-clock fact
    /// and stays one; the absence is an absolute window and stays one; and the
    /// two together must not lose or duplicate an hour of cover.
    #[test]
    fn test_a_skip_across_a_dst_week_keeps_the_wall_clock_handover() {
        // US spring forward is 2026-03-08. Hand over Sundays at 09:00 local.
        let anchor = local(NY, 2026, 3, 1, 9, 0);
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into(), "cara@o2.ai".into()],
            anchor,
        )];
        // Bob holds the week containing the transition; he is away for all of
        // it, so it passes to Cara.
        let bob_week = local(NY, 2026, 3, 8, 9, 0);
        let unavailability = vec![away("bob@o2.ai", bob_week, local(NY, 2026, 3, 15, 9, 0))];

        assert_eq!(
            on_call_now(&rotations, &[], &[], bob_week, NY).as_deref(),
            Some("bob@o2.ai"),
            "precondition: it is bob's week"
        );
        // Handover lands exactly at 09:00 local on both sides of the jump.
        assert_eq!(
            on_call_now(&rotations, &[], &unavailability, bob_week - 1, NY).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(
            on_call_now(&rotations, &[], &unavailability, bob_week, NY).as_deref(),
            Some("cara@o2.ai")
        );
        // Through the transition itself, hour by hour, the answer is stable.
        for hour in 0..(24 * 7) {
            let at = bob_week + hour * MICROS_PER_HOUR;
            if at >= local(NY, 2026, 3, 15, 9, 0) {
                break;
            }
            assert_eq!(
                on_call_now(&rotations, &[], &unavailability, at, NY).as_deref(),
                Some("cara@o2.ai"),
                "hour {hour} of a 167-hour week"
            );
        }
        // And the following week is Cara's own, unmoved by the skip.
        assert_eq!(
            on_call_now(
                &rotations,
                &[],
                &unavailability,
                local(NY, 2026, 3, 15, 9, 0),
                NY
            )
            .as_deref(),
            Some("cara@o2.ai")
        );
    }

    /// The edit-time warning: the rota would hand Ana a week she is away for.
    /// The resolver would skip it, and that is exactly why it has to be said
    /// out loud — otherwise the first anybody hears of it is a different name
    /// on the calendar.
    #[test]
    fn test_away_assignments_name_the_shift_the_rota_would_hand_over() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into(), "cara@o2.ai".into()],
            ANCHOR,
        )];
        // Ana's next turn is three weeks out; she is away across it.
        let ana_week = ANCHOR + 3 * MICROS_PER_WEEK;
        let unavailability = vec![away(
            "ana@o2.ai",
            ana_week - MICROS_PER_DAY,
            ana_week + 2 * MICROS_PER_DAY,
        )];

        let found = away_assignments(
            &rotations,
            &unavailability,
            ANCHOR,
            ANCHOR + 4 * MICROS_PER_WEEK,
            TZ,
            MAX_AWAY_SHIFTS,
        );
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].user_email, "ana@o2.ai");
        assert_eq!(found[0].rotation, "On-call rotation");
        assert_eq!(found[0].slot, DEFAULT_SLOT);
        assert_eq!(
            (found[0].from, found[0].to),
            (ana_week, ana_week + 2 * MICROS_PER_DAY),
            "reported for the overlap, not for the whole shift"
        );
        assert_eq!(
            found[0].covered_by.as_deref(),
            Some("bob@o2.ai"),
            "and it says who actually ends up with it"
        );

        // Nothing to say when nobody is away, and nothing to say about a week
        // outside the horizon.
        assert!(away_assignments(&rotations, &[], ANCHOR, ANCHOR + MICROS_PER_WEEK, TZ, 50).is_empty());
        assert!(
            away_assignments(
                &rotations,
                &unavailability,
                ANCHOR,
                ANCHOR + MICROS_PER_WEEK,
                TZ,
                50
            )
            .is_empty()
        );
    }

    /// When everybody in the rotation is away for a shift, the warning says
    /// nobody picks it up — which is the coverage gap, named at edit time.
    #[test]
    fn test_an_away_assignment_with_no_taker_says_so() {
        let rotations = vec![Rotation::weekly(
            "On-call rotation",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            ANCHOR,
        )];
        let unavailability = vec![
            away("ana@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK),
            away("bob@o2.ai", ANCHOR, ANCHOR + MICROS_PER_WEEK),
        ];
        let found = away_assignments(
            &rotations,
            &unavailability,
            ANCHOR,
            ANCHOR + MICROS_PER_WEEK,
            TZ,
            MAX_AWAY_SHIFTS,
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].covered_by, None);
    }

    /// Absences are per person and per instant, and the comparison is
    /// case-insensitive because a rotation written by hand may not be
    /// lowercased.
    #[test]
    fn test_is_unavailable_is_bounded_and_case_insensitive() {
        let windows = vec![away("ana@o2.ai", 100, 200)];
        assert!(is_unavailable(&windows, "ana@o2.ai", 100));
        assert!(is_unavailable(&windows, "ANA@o2.ai", 150));
        assert!(!is_unavailable(&windows, "ana@o2.ai", 200), "the end is exclusive");
        assert!(!is_unavailable(&windows, "ana@o2.ai", 99));
        assert!(!is_unavailable(&windows, "bob@o2.ai", 150));
    }

}
