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
//! Layers, restriction windows and overrides land on top of this in a later
//! phase; they change *which* rotations apply to an instant, not how a single
//! rotation resolves.

use chrono::{Datelike, LocalResult, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;


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
        let minute = local.hour() * 60 + local.minute();
        let day = local.weekday().num_days_from_monday() as u8;

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
        }
    }
}

impl std::error::Error for RotationError {}

impl Rotation {
    /// A weekly rotation handing over at `anchor_micros`.
    pub fn weekly(name: impl Into<String>, members: Vec<String>, anchor_micros: i64) -> Self {
        Self {
            name: name.into(),
            members,
            shift_micros: MICROS_PER_WEEK,
            anchor_micros,
            priority: 0,
            restrictions: Vec::new(),
        }
    }

    /// Whether this rotation is in force at `at`.
    ///
    /// Windows are ORed: a rotation covering "weekday mornings or weekend
    /// afternoons" is two windows, and matching either is enough.
    pub fn applies_at(&self, at_micros: i64, tz: chrono_tz::Tz) -> bool {
        self.restrictions.is_empty() || self.restrictions.iter().any(|w| w.contains(at_micros, tz))
    }

    pub fn validate(&self) -> Result<(), RotationError> {
        if self.name.trim().is_empty() {
            return Err(RotationError::NoName);
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
    /// The rotation that produced this.
    pub rotation: String,
    pub user_email: String,
    /// Who it hands over to. `None` when the rotation has one member, because
    /// then there is nobody else and saying otherwise would be a lie.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_user_email: Option<String>,
}

fn default_rotation_name() -> String {
    "Rotation".to_string()
}

/// The rotation in force for one level at `at`.
///
/// Highest priority among those whose restrictions match wins; ties break on
/// the more specific rotation (one WITH restrictions beats the catch-all), then
/// on level order so the answer is stable across nodes. That last tiebreak
/// matters more than it looks: two equally-specific layers is a configuration
/// mistake, but it must still resolve the same way everywhere rather than
/// depending on row order.
pub fn winning_rotation(
    rotations: &[Rotation],
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<&Rotation> {
    rotations
        .iter()
        .filter(|r| r.validate().is_ok() && r.applies_at(at, tz))
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
pub fn resolve_on_call(rotations: &[Rotation], at: i64, tz: chrono_tz::Tz) -> Vec<OnCallSlot> {
    winning_rotation(rotations, at, tz)
        .and_then(|r| {
            r.member_at(at, tz).map(|m| OnCallSlot {
                rotation: r.name.clone(),
                user_email: m.to_string(),
                next_user_email: (r.members.len() > 1)
                    .then(|| r.member_offset(at, 1, tz).map(str::to_string))
                    .flatten(),
            })
        })
        .into_iter()
        .collect()
}

/// The person on call at `at`.
pub fn on_call_now(rotations: &[Rotation], at: i64, tz: chrono_tz::Tz) -> Option<String> {
    winning_rotation(rotations, at, tz)
        .and_then(|r| r.member_at(at, tz))
        .map(str::to_string)
}

/// The person the rotation in force hands over to next.
///
/// `None` for a single-member rotation: there is no next, and returning the
/// same person would page them twice and call it an escalation.
pub fn next_on_call(rotations: &[Rotation], at: i64, tz: chrono_tz::Tz) -> Option<String> {
    let r = winning_rotation(rotations, at, tz)?;
    if r.members.len() < 2 {
        return None;
    }
    r.member_offset(at, 1, tz).map(str::to_string)
}

/// Everyone in the rotation in force, on shift or not.
pub fn everyone_on_schedule(rotations: &[Rotation], at: i64, tz: chrono_tz::Tz) -> Vec<String> {
    winning_rotation(rotations, at, tz)
        .map(|r| r.members.clone())
        .unwrap_or_default()
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
            members: vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            shift_micros: 8 * MICROS_PER_HOUR,
            anchor_micros: ANCHOR,
            priority: 0,
            restrictions: vec![],
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
            on_call_now(&rotations, ANCHOR, chrono_tz::UTC).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(
            next_on_call(&rotations, ANCHOR, chrono_tz::UTC).as_deref(),
            Some("bob@o2.ai")
        );
        // A week later everyone has moved along by one.
        let later = ANCHOR + MICROS_PER_WEEK;
        assert_eq!(
            on_call_now(&rotations, later, chrono_tz::UTC).as_deref(),
            Some("bob@o2.ai")
        );
        assert_eq!(
            next_on_call(&rotations, later, chrono_tz::UTC).as_deref(),
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
            next_on_call(&rotations, ANCHOR + MICROS_PER_WEEK, chrono_tz::UTC).as_deref(),
            Some("ana@o2.ai")
        );
    }

    /// A one-person rotation has no next. Returning the same person would
    /// page them twice and call the second one an escalation.
    #[test]
    fn test_a_single_member_rotation_has_no_next() {
        let rotations = vec![Rotation::weekly("Primary", vec!["ana@o2.ai".into()], ANCHOR)];

        assert_eq!(
            on_call_now(&rotations, ANCHOR, chrono_tz::UTC).as_deref(),
            Some("ana@o2.ai")
        );
        assert_eq!(next_on_call(&rotations, ANCHOR, chrono_tz::UTC), None);
        assert_eq!(
            resolve_on_call(&rotations, ANCHOR, chrono_tz::UTC)[0].next_user_email,
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
            everyone_on_schedule(&rotations, ANCHOR, chrono_tz::UTC),
            vec!["ana@o2.ai".to_string(), "bob@o2.ai".to_string()]
        );
    }

    /// An unusable rotation resolves to nobody, which is visible, rather than
    /// to `members[0]`, which would page someone the schedule never selected.
    #[test]
    fn test_a_broken_rotation_staffs_nobody() {
        let rotations = vec![Rotation::weekly("Primary", vec![], ANCHOR)];
        assert!(resolve_on_call(&rotations, ANCHOR, chrono_tz::UTC).is_empty());
        assert_eq!(on_call_now(&rotations, ANCHOR, chrono_tz::UTC), None);
        assert_eq!(next_on_call(&rotations, ANCHOR, chrono_tz::UTC), None);
        assert!(everyone_on_schedule(&rotations, ANCHOR, chrono_tz::UTC).is_empty());
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
            members: members.iter().map(|s| s.to_string()).collect(),
            shift_micros: MICROS_PER_WEEK,
            anchor_micros: ANCHOR,
            priority,
            restrictions,
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
            on_call_now(&rotations, office, IST).unwrap(),
            "india@o2.ai"
        );
        assert_eq!(
            on_call_now(&rotations, night, IST).unwrap(),
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
                on_call_now(&rotations, at, IST).unwrap(),
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

        let forward = on_call_now(&[low.clone(), high.clone()], at, IST);
        let reverse = on_call_now(&[high, low], at, IST);
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
            on_call_now(&rotations, local(IST, 2026, 8, 10, 12, 0), IST).unwrap(),
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
        assert!(on_call_now(&rotations, saturday, IST).is_none());
        assert!(resolve_on_call(&rotations, saturday, IST).is_empty());
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
            members: members.iter().map(|s| s.to_string()).collect(),
            shift_micros: MICROS_PER_DAY,
            anchor_micros: anchor,
            priority: 0,
            restrictions: vec![],
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
        assert!(r.applies_at(ANCHOR, IST));
    }
}
