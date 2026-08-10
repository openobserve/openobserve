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

use chrono::{Datelike, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::level::EscalationLevel;

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
    pub level: EscalationLevel,
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
    /// Higher wins when two rotations for the same level both apply.
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
    /// L0 is the agent's rung; no human is ever scheduled into it.
    NotAHumanSlot(EscalationLevel),
}

impl std::fmt::Display for RotationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoMembers => f.write_str("rotation must have at least one member"),
            Self::NonPositiveShift(v) => {
                write!(f, "shift length must be positive, got {v} micros")
            }
            Self::DuplicateMember(m) => write!(f, "duplicate rotation member `{m}`"),
            Self::NotAHumanSlot(l) => write!(f, "level `{l}` cannot hold a human rotation"),
        }
    }
}

impl std::error::Error for RotationError {}

impl Rotation {
    /// A weekly rotation handing over at `anchor_micros`.
    pub fn weekly(level: EscalationLevel, members: Vec<String>, anchor_micros: i64) -> Self {
        Self {
            level,
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
        if !self.level.is_human_slot() {
            return Err(RotationError::NotAHumanSlot(self.level));
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

    /// Zero-based index of the shift containing `at`.
    ///
    /// Uses floor division rather than truncating division so that instants
    /// before the anchor land on the shift that actually contains them.
    /// Truncating division maps both `-1` and `+1` micros from the anchor to
    /// shift 0, which would make the same person on call for two consecutive
    /// shifts across the anchor.
    fn shift_index(&self, at: i64) -> i64 {
        let elapsed = at - self.anchor_micros;
        elapsed.div_euclid(self.shift_micros)
    }

    /// Who holds this level at `at`, or `None` if the rotation is unusable.
    ///
    /// Returning `None` rather than a fallback is deliberate: an unstaffed
    /// level must surface as a coverage gap, never as a silently dropped page.
    pub fn member_at(&self, at: i64) -> Option<&str> {
        if self.validate().is_err() {
            return None;
        }
        let idx = self.shift_index(at).rem_euclid(self.members.len() as i64);
        self.members.get(idx as usize).map(|s| s.as_str())
    }

    /// Instant at which the shift containing `at` began.
    pub fn shift_start(&self, at: i64) -> Option<i64> {
        if self.validate().is_err() {
            return None;
        }
        Some(self.anchor_micros + self.shift_index(at) * self.shift_micros)
    }

    /// Instant at which the shift containing `at` ends — i.e. the next
    /// handover. Exclusive: the returned instant belongs to the next shift.
    pub fn next_handover(&self, at: i64) -> Option<i64> {
        Some(self.shift_start(at)? + self.shift_micros)
    }
}

/// Everyone on call for a team at an instant, one entry per staffed level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OnCallSlot {
    pub level: EscalationLevel,
    pub user_email: String,
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
    level: EscalationLevel,
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<&Rotation> {
    rotations
        .iter()
        .filter(|r| r.level == level && r.validate().is_ok() && r.applies_at(at, tz))
        .max_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then_with(|| a.restrictions.len().cmp(&b.restrictions.len()))
                .then_with(|| b.anchor_micros.cmp(&a.anchor_micros))
        })
}

/// Resolve every level's holder at `at`, in ladder order.
///
/// Rotations that fail validation are skipped rather than defaulted, so a
/// misconfigured level shows up as an absent rung the caller can report.
pub fn resolve_on_call(rotations: &[Rotation], at: i64, tz: chrono_tz::Tz) -> Vec<OnCallSlot> {
    let mut levels: Vec<EscalationLevel> = rotations.iter().map(|r| r.level).collect();
    levels.sort_by_key(|l| l.to_i32());
    levels.dedup();

    levels
        .into_iter()
        .filter_map(|level| {
            winning_rotation(rotations, level, at, tz)
                .and_then(|r| r.member_at(at))
                .map(|m| OnCallSlot {
                    level,
                    user_email: m.to_string(),
                })
        })
        .collect()
}

/// The holder of one specific level at `at`.
pub fn resolve_level(
    rotations: &[Rotation],
    level: EscalationLevel,
    at: i64,
    tz: chrono_tz::Tz,
) -> Option<String> {
    winning_rotation(rotations, level, at, tz)
        .and_then(|r| r.member_at(at))
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANCHOR: i64 = 1_700_000_000_000_000;

    fn weekly(members: &[&str]) -> Rotation {
        Rotation::weekly(
            EscalationLevel::Primary,
            members.iter().map(|s| s.to_string()).collect(),
            ANCHOR,
        )
    }

    #[test]
    fn test_first_shift_belongs_to_the_first_member() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_DAY), Some("ana@o2.ai"));
    }

    /// The handover instant belongs to the INCOMING person. An inclusive
    /// upper bound would leave the outgoing engineer on call for one extra
    /// microsecond, and both of them paged for the same alert.
    #[test]
    fn test_handover_boundary_is_exclusive() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_WEEK - 1), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + MICROS_PER_WEEK), Some("bob@o2.ai"));
    }

    #[test]
    fn test_rotation_wraps_around() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"]);
        let expected = ["ana@o2.ai", "bob@o2.ai", "cara@o2.ai"];
        for week in 0..9i64 {
            assert_eq!(
                r.member_at(ANCHOR + week * MICROS_PER_WEEK),
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
        assert_eq!(r.member_at(ANCHOR - 1), Some("bob@o2.ai"));
        assert_eq!(r.member_at(ANCHOR - MICROS_PER_WEEK), Some("bob@o2.ai"));
        assert_eq!(r.member_at(ANCHOR - MICROS_PER_WEEK - 1), Some("ana@o2.ai"));
    }

    #[test]
    fn test_single_member_is_always_on_call() {
        let r = weekly(&["ana@o2.ai"]);
        for offset in [-MICROS_PER_WEEK, 0, MICROS_PER_DAY, 99 * MICROS_PER_WEEK] {
            assert_eq!(r.member_at(ANCHOR + offset), Some("ana@o2.ai"));
        }
    }

    #[test]
    fn test_shift_start_and_next_handover_bracket_the_instant() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let at = ANCHOR + MICROS_PER_WEEK + 3 * MICROS_PER_HOUR;
        let start = r.shift_start(at).unwrap();
        let end = r.next_handover(at).unwrap();
        assert_eq!(start, ANCHOR + MICROS_PER_WEEK);
        assert_eq!(end, ANCHOR + 2 * MICROS_PER_WEEK);
        assert!(start <= at && at < end);
    }

    #[test]
    fn test_next_handover_hands_over_to_the_next_member() {
        let r = weekly(&["ana@o2.ai", "bob@o2.ai"]);
        let at = ANCHOR + MICROS_PER_DAY;
        let handover = r.next_handover(at).unwrap();
        assert_eq!(r.member_at(handover - 1), Some("ana@o2.ai"));
        assert_eq!(r.member_at(handover), Some("bob@o2.ai"));
    }

    #[test]
    fn test_arbitrary_shift_lengths_resolve() {
        let r = Rotation {
            level: EscalationLevel::Primary,
            members: vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            shift_micros: 8 * MICROS_PER_HOUR,
            anchor_micros: ANCHOR,
            priority: 0,
            restrictions: vec![],
        };
        assert_eq!(r.member_at(ANCHOR), Some("ana@o2.ai"));
        assert_eq!(r.member_at(ANCHOR + 8 * MICROS_PER_HOUR), Some("bob@o2.ai"));
        assert_eq!(
            r.member_at(ANCHOR + 16 * MICROS_PER_HOUR),
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
        r.level = EscalationLevel::L0;
        assert_eq!(
            r.validate(),
            Err(RotationError::NotAHumanSlot(EscalationLevel::L0))
        );
    }

    /// An unusable rotation must resolve to nobody. Falling back to
    /// `members[0]` would page a person the schedule never selected.
    #[test]
    fn test_invalid_rotation_resolves_to_nobody() {
        let empty = weekly(&[]);
        assert_eq!(empty.member_at(ANCHOR), None);
        assert_eq!(empty.shift_start(ANCHOR), None);
        assert_eq!(empty.next_handover(ANCHOR), None);

        let mut zero = weekly(&["ana@o2.ai"]);
        zero.shift_micros = 0;
        assert_eq!(zero.member_at(ANCHOR), None, "must not divide by zero");
    }

    #[test]
    fn test_resolve_on_call_returns_levels_in_ladder_order() {
        let rotations = vec![
            Rotation::weekly(EscalationLevel::L2, vec!["eve@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::Primary, vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::Secondary, vec!["bob@o2.ai".into()], ANCHOR),
        ];
        let slots = resolve_on_call(&rotations, ANCHOR, chrono_tz::UTC);
        assert_eq!(
            slots.iter().map(|s| s.level).collect::<Vec<_>>(),
            vec![
                EscalationLevel::Primary,
                EscalationLevel::Secondary,
                EscalationLevel::L2
            ]
        );
        assert_eq!(slots[0].user_email, "ana@o2.ai");
    }

    /// A team that only staffs Primary is valid — the unstaffed rungs are
    /// absent from the result, not filled with a placeholder.
    #[test]
    fn test_unstaffed_levels_are_absent_not_defaulted() {
        let rotations = vec![
            Rotation::weekly(EscalationLevel::Primary, vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::L1, vec![], ANCHOR),
        ];
        let slots = resolve_on_call(&rotations, ANCHOR, chrono_tz::UTC);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].level, EscalationLevel::Primary);
    }

    #[test]
    fn test_resolve_level_picks_the_matching_rotation() {
        let rotations = vec![
            Rotation::weekly(EscalationLevel::Primary, vec!["ana@o2.ai".into()], ANCHOR),
            Rotation::weekly(EscalationLevel::Secondary, vec!["bob@o2.ai".into()], ANCHOR),
        ];
        assert_eq!(
            resolve_level(
                &rotations,
                EscalationLevel::Secondary,
                ANCHOR,
                chrono_tz::UTC
            ),
            Some("bob@o2.ai".to_string())
        );
        assert_eq!(
            resolve_level(&rotations, EscalationLevel::L4, ANCHOR, chrono_tz::UTC),
            None
        );
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
        level: EscalationLevel,
        members: &[&str],
        priority: i32,
        restrictions: Vec<TimeWindow>,
    ) -> Rotation {
        Rotation {
            level,
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
            layer(EscalationLevel::Primary, &["catchall@o2.ai"], 0, vec![]),
            layer(
                EscalationLevel::Primary,
                &["india@o2.ai"],
                10,
                vec![window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60)],
            ),
        ];
        let office = local(IST, 2026, 8, 10, 11, 0);
        let night = local(IST, 2026, 8, 10, 23, 0);

        assert_eq!(
            resolve_level(&rotations, EscalationLevel::Primary, office, IST).unwrap(),
            "india@o2.ai"
        );
        assert_eq!(
            resolve_level(&rotations, EscalationLevel::Primary, night, IST).unwrap(),
            "catchall@o2.ai"
        );
    }

    /// Three restricted layers over one catch-all, which is what
    /// follow-the-sun actually is.
    #[test]
    fn test_three_region_follow_the_sun() {
        let rotations = vec![
            layer(EscalationLevel::Primary, &["catchall@o2.ai"], 0, vec![]),
            layer(
                EscalationLevel::Primary,
                &["apac@o2.ai"],
                10,
                vec![window(&[], 6 * 60, 14 * 60)],
            ),
            layer(
                EscalationLevel::Primary,
                &["emea@o2.ai"],
                10,
                vec![window(&[], 14 * 60, 22 * 60)],
            ),
            layer(
                EscalationLevel::Primary,
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
                resolve_level(&rotations, EscalationLevel::Primary, at, IST).unwrap(),
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
            EscalationLevel::Primary,
            &["low@o2.ai"],
            1,
            vec![window(&[], 0, 1440)],
        );
        let high = layer(
            EscalationLevel::Primary,
            &["high@o2.ai"],
            5,
            vec![window(&[], 0, 1440)],
        );
        let at = local(IST, 2026, 8, 10, 12, 0);

        let forward = resolve_level(
            &[low.clone(), high.clone()],
            EscalationLevel::Primary,
            at,
            IST,
        );
        let reverse = resolve_level(&[high, low], EscalationLevel::Primary, at, IST);
        assert_eq!(forward.as_deref(), Some("high@o2.ai"));
        assert_eq!(forward, reverse);
    }

    /// At equal priority the more specific rotation wins, so a catch-all
    /// never shadows a layer somebody deliberately restricted.
    #[test]
    fn test_a_restricted_layer_beats_the_catch_all_at_equal_priority() {
        let rotations = vec![
            layer(EscalationLevel::Primary, &["catchall@o2.ai"], 0, vec![]),
            layer(
                EscalationLevel::Primary,
                &["office@o2.ai"],
                0,
                vec![window(&[], 9 * 60, 17 * 60)],
            ),
        ];
        assert_eq!(
            resolve_level(
                &rotations,
                EscalationLevel::Primary,
                local(IST, 2026, 8, 10, 12, 0),
                IST
            )
            .unwrap(),
            "office@o2.ai"
        );
    }

    /// Restrictions are ORed: "weekday mornings or weekend afternoons" is two
    /// windows and matching either is enough.
    #[test]
    fn test_multiple_windows_are_ored() {
        let r = layer(
            EscalationLevel::Primary,
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
            EscalationLevel::Primary,
            &["office@o2.ai"],
            0,
            vec![window(&[0, 1, 2, 3, 4], 9 * 60, 17 * 60)],
        )];
        let saturday = local(IST, 2026, 8, 15, 12, 0);
        assert!(resolve_level(&rotations, EscalationLevel::Primary, saturday, IST).is_none());
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
            EscalationLevel::Primary,
            &["ana@o2.ai"],
            7,
            vec![window(&[0, 4], 540, 1020)],
        );
        let back: Rotation = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r);
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
