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

//! Schedule presets — the four shapes of `architecture/02` §3b, as data.
//!
//! A preset is a **starting point, not a mode**. Applying one produces an
//! ordinary set of [`Rotation`]s and stores nothing else: the result is edited
//! layer by layer afterwards like any other schedule, and nothing anywhere
//! remembers which preset made it. That is deliberate — a "preset schedule"
//! that had to be un-preset before it could be tuned would be a second kind of
//! schedule to reason about, and the whole point of shipping the four shapes
//! centrally is that the UI, the API and the demo harness generate the *same*
//! thing rather than three slightly different things.
//!
//! Everything here is pure: `(inputs, timezone, anchor) -> Vec<ShiftRule>`. No
//! clock is read and nothing is written, which is what lets the no-coverage-gap
//! property below be a test rather than a hope.
//!
//! ## Why every preset ends in an unrestricted layer
//!
//! The engine resolves an instant by taking the highest-priority layer whose
//! restrictions match, and "no layer matches" is a coverage gap — a real answer,
//! and the one nobody wants at 3am. So each preset puts its restricted layers on
//! top of exactly one layer with **no restrictions at all**, which is in force
//! at every instant and therefore fills every hour the layers above it miss.
//! That is the entire mechanism, and it is why a preset can promise a schedule
//! with no holes in it while still letting the operator describe partial cover.
//!
//! ## Why the caller supplies the grouping
//!
//! There is no per-user timezone anywhere in on-call: a schedule has **one**
//! zone — the team's — and every restriction window is read in it. A preset
//! therefore cannot work out who is where; follow-the-sun is expressed the other
//! way round, by the operator putting the right people on the right layer and
//! naming the hours that layer covers *in the team's zone*. So the request says
//! the groups outright, each with its own name, its own members and its own
//! window, rather than the preset guessing geography it has no way to know.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::rotation::{MICROS_PER_DAY, MICROS_PER_WEEK, ShiftRule, TimeWindow};

/// Priority given to every restricted layer a preset generates.
///
/// The restricted layers of one preset never overlap — that is validated — so
/// they can share a number, and sharing it keeps the generated schedule
/// readable: one tier of "when this applies" layers sitting on one catch-all.
pub const RESTRICTED_PRIORITY: i32 = 10;

/// Priority of the unrestricted catch-all, which must lose to everything above
/// it and win against nothing at all.
pub const CATCH_ALL_PRIORITY: i32 = 0;

/// Handover interval used when the caller does not name one. A week is what
/// on-call rotations overwhelmingly are, and it is the one value somebody can
/// change afterwards without re-reasoning about the layers.
pub const DEFAULT_HANDOVER_MICROS: i64 = MICROS_PER_WEEK;

/// Shortest handover a preset will generate. Below an hour the "rotation" is a
/// clock, not a roster, and it is far more likely to be a units mistake.
pub const MIN_HANDOVER_MICROS: i64 = 60 * 60 * 1_000_000;

/// Longest handover a preset will generate. A year of unbroken on-call is not
/// a rotation either, and the bound catches millis-for-micros the other way.
pub const MAX_HANDOVER_MICROS: i64 = 366 * MICROS_PER_DAY;

/// Fewest regions follow-the-sun accepts. One region is not follow-the-sun, it
/// is a single restricted layer — `business_hours_plus_nights` is that shape,
/// and saying so is more useful than generating something misnamed.
pub const MIN_FOLLOW_THE_SUN_GROUPS: usize = 2;

/// Most regions follow-the-sun accepts. Four disjoint windows already divides
/// the day into six-hour blocks; past that the operator wants layers, and the
/// schedule editor is where layers are built.
pub const MAX_FOLLOW_THE_SUN_GROUPS: usize = 4;

/// Cap on one group's roster. A rotation is a handover order somebody reads —
/// a hundred names is already past the point where anybody could — and an
/// unbounded list here is an unbounded list in every response that echoes it.
pub const MAX_GROUP_MEMBERS: usize = 100;

/// Minutes in a day, and therefore the exclusive end of an "all day" window.
const MINUTES_PER_DAY: u32 = 1440;

const DEFAULT_BUSINESS_START_MINUTE: u32 = 9 * 60;
const DEFAULT_BUSINESS_END_MINUTE: u32 = 17 * 60;

fn default_business_days() -> Vec<u8> {
    vec![0, 1, 2, 3, 4]
}

fn default_business_start() -> u32 {
    DEFAULT_BUSINESS_START_MINUTE
}

fn default_business_end() -> u32 {
    DEFAULT_BUSINESS_END_MINUTE
}

/// Which preset. Serialises to the id the catalogue publishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PresetId {
    FollowTheSun,
    WeekdayWeekend,
    SplitTheWeek,
    BusinessHoursPlusNights,
}

impl PresetId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FollowTheSun => "follow_the_sun",
            Self::WeekdayWeekend => "weekday_weekend",
            Self::SplitTheWeek => "split_the_week",
            Self::BusinessHoursPlusNights => "business_hours_plus_nights",
        }
    }
}

impl std::fmt::Display for PresetId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One layer's worth of people, for the presets whose layers are fixed.
///
/// The name is optional because "the weekend layer" already has an obvious
/// label; supplying an empty one is refused rather than defaulted, because a
/// blank name in a form means the field was cleared, not that it was skipped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Group {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Emails, in handover order.
    pub members: Vec<String>,
}

/// One region of a follow-the-sun setup: who, and which hours they hold.
///
/// The name is required here, unlike [`Group`]. A region is the one thing the
/// preset genuinely cannot guess — "APAC" is knowledge the operator has and the
/// system does not — and a calendar showing `Region 2` would be a worse
/// schedule than the one the operator meant to describe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RegionGroup {
    pub name: String,
    /// Emails, in handover order.
    pub members: Vec<String>,
    /// Minutes from midnight **in the team's timezone**, inclusive.
    pub start_minute: u32,
    /// Minutes from midnight in the team's timezone, exclusive. May be less
    /// than `start_minute`, which means the region's window wraps midnight.
    pub end_minute: u32,
}

/// The inputs of one preset, tagged by which preset they are for.
///
/// Internally tagged on `preset`, so the wire shape is the one §C.3 publishes:
/// `{"preset": "weekday_weekend", "weekdays": {...}, "weekend": {...}}`. Each
/// variant names its layers rather than taking a positional array, because
/// "which of these two groups is the weekend one" is exactly the question a
/// positional API leaves open until somebody is paged on a Saturday.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "preset", rename_all = "snake_case")]
pub enum PresetSpec {
    /// Two to four regional layers over one catch-all.
    FollowTheSun {
        groups: Vec<RegionGroup>,
        /// Who covers the hours no region claims. Absent means everybody named
        /// above, in the order they were named — which is what a follow-the-sun
        /// team almost always wants and never has to think about.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        catch_all: Option<Group>,
    },
    /// A Mon–Fri layer over a weekend layer.
    WeekdayWeekend { weekdays: Group, weekend: Group },
    /// The week cut at one boundary, each half to a group.
    SplitTheWeek {
        /// Covers from Monday 00:00 up to the boundary.
        first: Group,
        /// Covers from the boundary to the end of the week.
        second: Group,
        /// 0 = Monday … 6 = Sunday.
        boundary_day: u8,
        /// Minutes from midnight in the team's timezone.
        boundary_minute: u32,
    },
    /// A working-hours layer over an out-of-hours catch-all.
    BusinessHoursPlusNights {
        business_hours: Group,
        after_hours: Group,
        /// 0 = Monday … 6 = Sunday. Defaults to Mon–Fri.
        #[serde(default = "default_business_days")]
        days: Vec<u8>,
        /// Minutes from midnight in the team's timezone, inclusive. 09:00.
        #[serde(default = "default_business_start")]
        start_minute: u32,
        /// Minutes from midnight in the team's timezone, exclusive. 17:00.
        #[serde(default = "default_business_end")]
        end_minute: u32,
    },
}

/// Why a preset request was refused.
///
/// Every variant names the field and the bound. An operator who typed the wrong
/// thing has to be told *what* was wrong: the alternative — quietly generating
/// something adjacent to what they asked for — produces a schedule that looks
/// right on the form and pages the wrong person a fortnight later.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetError {
    GroupCount {
        field: &'static str,
        min: usize,
        max: usize,
        got: usize,
    },
    EmptyGroup {
        field: String,
    },
    TooManyMembers {
        field: String,
        max: usize,
        got: usize,
    },
    BlankName {
        field: String,
    },
    DuplicateMember {
        field: String,
        email: String,
    },
    MinuteOutOfRange {
        field: String,
        got: u32,
        max: u32,
    },
    EmptyWindow {
        field: String,
        minute: u32,
    },
    DayOutOfRange {
        field: String,
        got: u8,
    },
    DuplicateDay {
        field: String,
        got: u8,
    },
    NoDays {
        field: String,
    },
    /// Two regional layers claim the same minute of the day. They would be
    /// equally in force with equal priority, and which of them staffed the
    /// hour would be arbitrary.
    OverlappingWindows {
        first: String,
        second: String,
        minute: u32,
    },
    /// A split at Monday 00:00 gives the first group none of the week.
    BoundaryAtWeekStart,
    HandoverOutOfRange {
        got: i64,
        min: i64,
        max: i64,
    },
}

impl std::fmt::Display for PresetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GroupCount {
                field,
                min,
                max,
                got,
            } => write!(
                f,
                "`{field}` must hold between {min} and {max} groups, got {got}"
            ),
            Self::EmptyGroup { field } => write!(
                f,
                "`{field}` has nobody in it, so the layer it builds would page nobody"
            ),
            Self::TooManyMembers { field, max, got } => write!(
                f,
                "`{field}` holds {got} members, which is more than the {max} a rotation may have"
            ),
            Self::BlankName { field } => {
                write!(f, "`{field}` is blank; a layer needs a name to be told apart from the others on a calendar")
            }
            Self::DuplicateMember { field, email } => write!(
                f,
                "`{field}` names `{email}` twice, which would double their share of the on-call load"
            ),
            Self::MinuteOutOfRange { field, got, max } => write!(
                f,
                "`{field}` is {got}; minutes past midnight must be between 0 and {max}"
            ),
            Self::EmptyWindow { field, minute } => write!(
                f,
                "`{field}` starts and ends at minute {minute}, so the layer would apply at no instant at all"
            ),
            Self::DayOutOfRange { field, got } => write!(
                f,
                "`{field}` is {got}; days are 0 (Monday) to 6 (Sunday)"
            ),
            Self::DuplicateDay { field, got } => {
                write!(f, "`{field}` names day {got} twice")
            }
            Self::NoDays { field } => write!(
                f,
                "`{field}` is empty; name at least one day, 0 (Monday) to 6 (Sunday)"
            ),
            Self::OverlappingWindows {
                first,
                second,
                minute,
            } => write!(
                f,
                "`{first}` and `{second}` both cover minute {minute} of the day; regional layers must not overlap, or which of them holds that hour is arbitrary"
            ),
            Self::BoundaryAtWeekStart => f.write_str(
                "`boundary_day` 0 with `boundary_minute` 0 is the start of the week, which gives `first` none of it; split somewhere inside the week",
            ),
            Self::HandoverOutOfRange { got, min, max } => write!(
                f,
                "`handover_micros` is {got}; it must be between {min} and {max} microseconds"
            ),
        }
    }
}

impl std::error::Error for PresetError {}

impl PresetSpec {
    pub fn id(&self) -> PresetId {
        match self {
            Self::FollowTheSun { .. } => PresetId::FollowTheSun,
            Self::WeekdayWeekend { .. } => PresetId::WeekdayWeekend,
            Self::SplitTheWeek { .. } => PresetId::SplitTheWeek,
            Self::BusinessHoursPlusNights { .. } => PresetId::BusinessHoursPlusNights,
        }
    }

    /// Every email named anywhere in the request, in the order they appear.
    ///
    /// The caller checks these against the org before anything is generated:
    /// a preset that put a stranger on a rotation would be a page addressed to
    /// nobody, which is indistinguishable from a page that was never sent.
    pub fn members(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        match self {
            Self::FollowTheSun { groups, catch_all } => {
                for g in groups {
                    out.extend(g.members.iter().map(String::as_str));
                }
                if let Some(c) = catch_all {
                    out.extend(c.members.iter().map(String::as_str));
                }
            }
            Self::WeekdayWeekend { weekdays, weekend } => {
                out.extend(weekdays.members.iter().map(String::as_str));
                out.extend(weekend.members.iter().map(String::as_str));
            }
            Self::SplitTheWeek { first, second, .. } => {
                out.extend(first.members.iter().map(String::as_str));
                out.extend(second.members.iter().map(String::as_str));
            }
            Self::BusinessHoursPlusNights {
                business_hours,
                after_hours,
                ..
            } => {
                out.extend(business_hours.members.iter().map(String::as_str));
                out.extend(after_hours.members.iter().map(String::as_str));
            }
        }
        out
    }

    /// Rewrites every email in place, which is how the caller substitutes the
    /// canonical (trimmed, lowercased) address it just validated. Doing it here
    /// rather than at each call site is what stops `Ana@O2.ai` and `ana@o2.ai`
    /// becoming two people on one rotation.
    pub fn map_members(&mut self, f: impl Fn(&str) -> String) {
        let apply = |members: &mut Vec<String>| {
            for m in members.iter_mut() {
                *m = f(m);
            }
        };
        match self {
            Self::FollowTheSun { groups, catch_all } => {
                for g in groups {
                    apply(&mut g.members);
                }
                if let Some(c) = catch_all {
                    apply(&mut c.members);
                }
            }
            Self::WeekdayWeekend { weekdays, weekend } => {
                apply(&mut weekdays.members);
                apply(&mut weekend.members);
            }
            Self::SplitTheWeek { first, second, .. } => {
                apply(&mut first.members);
                apply(&mut second.members);
            }
            Self::BusinessHoursPlusNights {
                business_hours,
                after_hours,
                ..
            } => {
                apply(&mut business_hours.members);
                apply(&mut after_hours.members);
            }
        }
    }
}

/// The rotations a preset builds, top layer first.
///
/// Pure: the timezone decides where the weekly handover falls on the local
/// calendar and nothing else, the anchor is passed in rather than read from a
/// clock, and the result is the `Vec<ShiftRule>` of **one** rotation.
///
/// One rotation, deliberately. Every preset shape is a set of rules over a
/// single position — follow-the-sun is one person on call across three
/// timezones' working hours, not three people at once. A second *position* is a
/// second rotation, and that is a decision only the team can make.
///
/// Validation happens here rather than in a separate call the caller could
/// forget: there is one way in, and it either refuses or returns something the
/// engine can resolve.
pub fn build(
    spec: &PresetSpec,
    tz: chrono_tz::Tz,
    anchor_micros: i64,
    handover_micros: i64,
) -> Result<Vec<ShiftRule>, PresetError> {
    validate(spec, handover_micros)?;
    // Handovers are a wall-clock fact, so the cycle starts at the top of a
    // local week rather than at whatever instant the request happened to
    // arrive. A schedule that hands over at 14:37 on a Wednesday because that
    // is when somebody clicked the button is technically correct and nobody
    // means it.
    let anchor = week_start(anchor_micros, tz);

    let layer = |name: String, members: &[String], priority: i32, restrictions: Vec<TimeWindow>| {
        ShiftRule {
            name,
            members: members.to_vec(),
            shift_micros: handover_micros,
            anchor_micros: anchor,
            priority,
            restrictions,
            starts_at: None,
            ends_at: None,
        }
    };

    Ok(match spec {
        PresetSpec::FollowTheSun { groups, catch_all } => {
            let mut out: Vec<ShiftRule> = groups
                .iter()
                .map(|g| {
                    layer(
                        g.name.trim().to_string(),
                        &g.members,
                        RESTRICTED_PRIORITY,
                        vec![TimeWindow {
                            days: Vec::new(),
                            start_minute: g.start_minute,
                            end_minute: g.end_minute,
                        }],
                    )
                })
                .collect();
            let fallback: Vec<String> = match catch_all {
                Some(c) => c.members.clone(),
                None => everyone(groups.iter().map(|g| g.members.as_slice())),
            };
            out.push(layer(
                group_name(catch_all.as_ref(), "Follow-the-sun catch-all"),
                &fallback,
                CATCH_ALL_PRIORITY,
                Vec::new(),
            ));
            out
        }
        PresetSpec::WeekdayWeekend { weekdays, weekend } => vec![
            layer(
                group_name(Some(weekdays), "Weekdays"),
                &weekdays.members,
                RESTRICTED_PRIORITY,
                vec![TimeWindow {
                    days: default_business_days(),
                    start_minute: 0,
                    end_minute: MINUTES_PER_DAY,
                }],
            ),
            // The weekend layer is the catch-all rather than a second
            // restricted layer. The layer above covers all of Mon–Fri, so an
            // unrestricted layer underneath shows through on exactly Saturday
            // and Sunday — the same schedule, one fewer thing to get wrong,
            // and no third layer needed to close a gap that cannot open.
            layer(
                group_name(Some(weekend), "Weekend"),
                &weekend.members,
                CATCH_ALL_PRIORITY,
                Vec::new(),
            ),
        ],
        PresetSpec::SplitTheWeek {
            first,
            second,
            boundary_day,
            boundary_minute,
        } => vec![
            layer(
                group_name(Some(first), "First half of the week"),
                &first.members,
                RESTRICTED_PRIORITY,
                first_half_windows(*boundary_day, *boundary_minute),
            ),
            // Same trick as weekday/weekend: the second half is everything the
            // first half does not claim, which an unrestricted layer expresses
            // exactly and without a second boundary to keep in step.
            layer(
                group_name(Some(second), "Second half of the week"),
                &second.members,
                CATCH_ALL_PRIORITY,
                Vec::new(),
            ),
        ],
        PresetSpec::BusinessHoursPlusNights {
            business_hours,
            after_hours,
            days,
            start_minute,
            end_minute,
        } => vec![
            layer(
                group_name(Some(business_hours), "Business hours"),
                &business_hours.members,
                RESTRICTED_PRIORITY,
                vec![TimeWindow {
                    days: days.clone(),
                    start_minute: *start_minute,
                    end_minute: *end_minute,
                }],
            ),
            layer(
                group_name(Some(after_hours), "Nights and weekends"),
                &after_hours.members,
                CATCH_ALL_PRIORITY,
                Vec::new(),
            ),
        ],
    })
}

/// The windows covering Monday 00:00 up to `(boundary_day, boundary_minute)`.
///
/// Whole days come out as one window with several `days` entries and the part
/// day as a second — the engine ORs a layer's windows, so two of them say
/// "through Wednesday, plus Thursday morning" without a third concept.
fn first_half_windows(boundary_day: u8, boundary_minute: u32) -> Vec<TimeWindow> {
    let mut out = Vec::new();
    if boundary_day > 0 {
        out.push(TimeWindow {
            days: (0..boundary_day).collect(),
            start_minute: 0,
            end_minute: MINUTES_PER_DAY,
        });
    }
    if boundary_minute > 0 {
        out.push(TimeWindow {
            days: vec![boundary_day],
            start_minute: 0,
            end_minute: boundary_minute,
        });
    }
    out
}

fn group_name(group: Option<&Group>, fallback: &str) -> String {
    group
        .and_then(|g| g.name.as_deref())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

/// Everybody named across the layers, first appearance wins, compared without
/// case so one person spelled two ways does not get two turns.
fn everyone<'a>(groups: impl Iterator<Item = &'a [String]>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for g in groups {
        for m in g {
            if seen.insert(m.trim().to_ascii_lowercase()) {
                out.push(m.clone());
            }
        }
    }
    out
}

/// The instant of the most recent local Monday 00:00 at or before `at`.
///
/// Computed on the local calendar, because "Monday midnight" is a wall-clock
/// fact. If that midnight does not exist — a handful of zones move their clocks
/// at exactly midnight — the caller's own instant is kept rather than invented
/// nearby: an anchor an hour out shifts every handover by an hour, which is
/// worse than an anchor that is merely not tidy.
fn week_start(at: i64, tz: chrono_tz::Tz) -> i64 {
    use chrono::{Datelike, LocalResult, TimeZone};

    let Some(local) = chrono::DateTime::from_timestamp_micros(at)
        .map(|utc| tz.from_utc_datetime(&utc.naive_utc()))
    else {
        return at;
    };
    let monday =
        local.date_naive() - chrono::Duration::days(local.weekday().num_days_from_monday() as i64);
    let Some(midnight) = monday.and_hms_opt(0, 0, 0) else {
        return at;
    };
    match tz.from_local_datetime(&midnight) {
        LocalResult::Single(dt) => dt.timestamp_micros(),
        // A repeated midnight: the earlier reading is the one the week starts
        // at, the same choice the rotation boundaries make.
        LocalResult::Ambiguous(dt, _) => dt.timestamp_micros(),
        LocalResult::None => at,
    }
}

// ── Validation ────────────────────────────────────────────────────────────────

fn validate(spec: &PresetSpec, handover_micros: i64) -> Result<(), PresetError> {
    if !(MIN_HANDOVER_MICROS..=MAX_HANDOVER_MICROS).contains(&handover_micros) {
        return Err(PresetError::HandoverOutOfRange {
            got: handover_micros,
            min: MIN_HANDOVER_MICROS,
            max: MAX_HANDOVER_MICROS,
        });
    }
    match spec {
        PresetSpec::FollowTheSun { groups, catch_all } => {
            if !(MIN_FOLLOW_THE_SUN_GROUPS..=MAX_FOLLOW_THE_SUN_GROUPS).contains(&groups.len()) {
                return Err(PresetError::GroupCount {
                    field: "groups",
                    min: MIN_FOLLOW_THE_SUN_GROUPS,
                    max: MAX_FOLLOW_THE_SUN_GROUPS,
                    got: groups.len(),
                });
            }
            for (i, g) in groups.iter().enumerate() {
                if g.name.trim().is_empty() {
                    return Err(PresetError::BlankName {
                        field: format!("groups[{i}].name"),
                    });
                }
                validate_members(&g.members, &format!("groups[{i}].members"))?;
                validate_window(
                    g.start_minute,
                    g.end_minute,
                    &format!("groups[{i}].start_minute"),
                    &format!("groups[{i}].end_minute"),
                )?;
            }
            validate_no_overlap(groups)?;
            if let Some(c) = catch_all {
                validate_group(c, "catch_all")?;
            }
            Ok(())
        }
        PresetSpec::WeekdayWeekend { weekdays, weekend } => {
            validate_group(weekdays, "weekdays")?;
            validate_group(weekend, "weekend")
        }
        PresetSpec::SplitTheWeek {
            first,
            second,
            boundary_day,
            boundary_minute,
        } => {
            validate_group(first, "first")?;
            validate_group(second, "second")?;
            validate_day(*boundary_day, "boundary_day")?;
            if *boundary_minute >= MINUTES_PER_DAY {
                return Err(PresetError::MinuteOutOfRange {
                    field: "boundary_minute".to_string(),
                    got: *boundary_minute,
                    max: MINUTES_PER_DAY - 1,
                });
            }
            if *boundary_day == 0 && *boundary_minute == 0 {
                return Err(PresetError::BoundaryAtWeekStart);
            }
            Ok(())
        }
        PresetSpec::BusinessHoursPlusNights {
            business_hours,
            after_hours,
            days,
            start_minute,
            end_minute,
        } => {
            validate_group(business_hours, "business_hours")?;
            validate_group(after_hours, "after_hours")?;
            if days.is_empty() {
                return Err(PresetError::NoDays {
                    field: "days".to_string(),
                });
            }
            let mut seen = std::collections::HashSet::new();
            for d in days {
                validate_day(*d, "days")?;
                if !seen.insert(*d) {
                    return Err(PresetError::DuplicateDay {
                        field: "days".to_string(),
                        got: *d,
                    });
                }
            }
            validate_window(*start_minute, *end_minute, "start_minute", "end_minute")
        }
    }
}

fn validate_group(group: &Group, field: &str) -> Result<(), PresetError> {
    if let Some(name) = &group.name
        && name.trim().is_empty()
    {
        return Err(PresetError::BlankName {
            field: format!("{field}.name"),
        });
    }
    validate_members(&group.members, &format!("{field}.members"))
}

fn validate_members(members: &[String], field: &str) -> Result<(), PresetError> {
    if members.is_empty() {
        return Err(PresetError::EmptyGroup {
            field: field.to_string(),
        });
    }
    if members.len() > MAX_GROUP_MEMBERS {
        return Err(PresetError::TooManyMembers {
            field: field.to_string(),
            max: MAX_GROUP_MEMBERS,
            got: members.len(),
        });
    }
    let mut seen = std::collections::HashSet::with_capacity(members.len());
    for m in members {
        if !seen.insert(m.trim().to_ascii_lowercase()) {
            return Err(PresetError::DuplicateMember {
                field: field.to_string(),
                email: m.clone(),
            });
        }
    }
    Ok(())
}

fn validate_day(day: u8, field: &str) -> Result<(), PresetError> {
    if day > 6 {
        return Err(PresetError::DayOutOfRange {
            field: field.to_string(),
            got: day,
        });
    }
    Ok(())
}

/// A window has to name a real span of the day, and a non-empty one.
///
/// `end_minute` may be 1440 — midnight at the far end — and may be less than
/// `start_minute`, which is a window that wraps midnight. Equal is refused:
/// the engine reads that as "no minutes at all", so the layer would exist,
/// look configured, and never apply.
fn validate_window(
    start_minute: u32,
    end_minute: u32,
    start_field: &str,
    end_field: &str,
) -> Result<(), PresetError> {
    if start_minute >= MINUTES_PER_DAY {
        return Err(PresetError::MinuteOutOfRange {
            field: start_field.to_string(),
            got: start_minute,
            max: MINUTES_PER_DAY - 1,
        });
    }
    if end_minute > MINUTES_PER_DAY {
        return Err(PresetError::MinuteOutOfRange {
            field: end_field.to_string(),
            got: end_minute,
            max: MINUTES_PER_DAY,
        });
    }
    if start_minute == end_minute {
        return Err(PresetError::EmptyWindow {
            field: start_field.to_string(),
            minute: start_minute,
        });
    }
    Ok(())
}

/// Refuses two regions that claim the same minute of the day.
///
/// They come out at the same priority, so an overlap is not a preference, it is
/// a coin toss run once per resolution. Walking the 1440 minutes is the honest
/// way to ask the question — the windows may wrap midnight, and interval
/// arithmetic that forgets that is exactly the bug this catches.
fn validate_no_overlap(groups: &[RegionGroup]) -> Result<(), PresetError> {
    for minute in 0..MINUTES_PER_DAY {
        let mut holder: Option<&str> = None;
        for g in groups {
            let w = TimeWindow {
                days: Vec::new(),
                start_minute: g.start_minute,
                end_minute: g.end_minute,
            };
            // Day 0 is as good as any: these windows do not restrict days.
            if !w.covers_local(0, minute) {
                continue;
            }
            match holder {
                None => holder = Some(&g.name),
                Some(first) => {
                    return Err(PresetError::OverlappingWindows {
                        first: first.to_string(),
                        second: g.name.clone(),
                        minute,
                    });
                }
            }
        }
    }
    Ok(())
}

// ── The catalogue ─────────────────────────────────────────────────────────────

/// What kind of control a field is. Enough for a form to be generated rather
/// than hardcoded — the UI should not have to know that `follow_the_sun` wants
/// between two and four groups, because then it would have to be told twice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PresetInputKind {
    /// One layer: a name and an ordered list of members.
    Group,
    /// Several layers, `min`..`max` of them.
    GroupList,
    /// 0 = Monday … 6 = Sunday.
    DayOfWeek,
    /// A set of days of the week.
    DayList,
    /// Minutes past midnight in the team's timezone.
    MinuteOfDay,
    /// An IANA timezone name.
    Timezone,
    /// A duration in microseconds.
    DurationMicros,
    /// An instant, in microseconds since the epoch.
    ///
    /// Distinct from [`Self::DurationMicros`] because the controls are not
    /// interchangeable: a length is a number and a unit, an instant is a date
    /// and a time read in some zone. `anchor_micros` was declared a duration
    /// while labelled "First shift begins", so a form generated from this
    /// catalogue offered "every N hours" for a field that wanted a Tuesday.
    TimestampMicros,
    /// Free text.
    Text,
    /// An ordered list of member emails.
    MemberList,
}

/// One field of a preset's request body.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PresetInput {
    /// The JSON key, exactly as the request body spells it.
    pub field: String,
    pub kind: PresetInputKind,
    /// What to put beside the control.
    pub label: String,
    /// One line of help.
    pub description: String,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
    /// What the server uses when the field is absent, already in wire shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    /// For `group` and `group_list`: the fields each group carries.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fields: Vec<PresetInput>,
}

impl PresetInput {
    fn new(field: &str, kind: PresetInputKind, label: &str, description: &str) -> Self {
        Self {
            field: field.to_string(),
            kind,
            label: label.to_string(),
            description: description.to_string(),
            required: true,
            min: None,
            max: None,
            default: None,
            fields: Vec::new(),
        }
    }

    fn optional(mut self) -> Self {
        self.required = false;
        self
    }

    fn bounded(mut self, min: i64, max: i64) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self
    }

    fn defaulting(mut self, value: serde_json::Value) -> Self {
        self.default = Some(value);
        self.required = false;
        self
    }

    fn with_fields(mut self, fields: Vec<PresetInput>) -> Self {
        self.fields = fields;
        self
    }
}

/// One entry of the catalogue.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PresetDescriptor {
    pub id: PresetId,
    /// What to call it on a button.
    pub name: String,
    /// One line: what applying it builds.
    pub description: String,
    /// The layers it generates, highest priority first, in the same words the
    /// generated schedule will use.
    pub layers: Vec<String>,
    pub inputs: Vec<PresetInput>,
}

/// The four shapes, with everything needed to render a form for each.
///
/// A closed set rather than a page of a list: these are the four §3b names, they
/// are compiled in, and a caller can hold all of them. Nothing here reads the
/// database, so the endpoint that serves it costs a serialisation.
pub fn catalogue() -> Vec<PresetDescriptor> {
    vec![
        PresetDescriptor {
            id: PresetId::FollowTheSun,
            name: "Follow the sun".to_string(),
            description:
                "Two to four regional layers, each covering its own hours of the team's day, over one layer that covers everything they miss."
                    .to_string(),
            layers: vec![
                "one layer per group, restricted to that group's hours".to_string(),
                "Follow-the-sun catch-all — no restriction, so no hour is uncovered".to_string(),
            ],
            inputs: with_common(vec![
                PresetInput::new(
                    "groups",
                    PresetInputKind::GroupList,
                    "Regions",
                    "One per region. The hours are read in the team's timezone — there is no per-user timezone, so this is where the geography is encoded.",
                )
                .bounded(
                    MIN_FOLLOW_THE_SUN_GROUPS as i64,
                    MAX_FOLLOW_THE_SUN_GROUPS as i64,
                )
                .with_fields(vec![
                    PresetInput::new("name", PresetInputKind::Text, "Region", "APAC, EMEA, AMER…"),
                    members_input("Who covers this region"),
                    minute_input("start_minute", "Covers from"),
                    minute_input("end_minute", "Covers until"),
                ]),
                PresetInput::new(
                    "catch_all",
                    PresetInputKind::Group,
                    "Everything else",
                    "Who covers the hours no region claims. Leave it out and everybody named above covers them, in the order they were named.",
                )
                .optional()
                .with_fields(group_fields("Who covers the rest")),
            ]),
        },
        PresetDescriptor {
            id: PresetId::WeekdayWeekend,
            name: "Weekdays and weekend".to_string(),
            description:
                "A Monday-to-Friday layer over a weekend layer, so the two halves of the week rotate independently."
                    .to_string(),
            layers: vec![
                "Weekdays — Mon–Fri, all day".to_string(),
                "Weekend — no restriction, so it holds every hour Mon–Fri does not".to_string(),
            ],
            inputs: with_common(vec![
                PresetInput::new(
                    "weekdays",
                    PresetInputKind::Group,
                    "Weekdays",
                    "Who is on call Monday to Friday.",
                )
                .with_fields(group_fields("Who covers weekdays")),
                PresetInput::new(
                    "weekend",
                    PresetInputKind::Group,
                    "Weekend",
                    "Who is on call Saturday and Sunday.",
                )
                .with_fields(group_fields("Who covers the weekend")),
            ]),
        },
        PresetDescriptor {
            id: PresetId::SplitTheWeek,
            name: "Split the week".to_string(),
            description:
                "The week cut at one boundary you choose, each half to a different group."
                    .to_string(),
            layers: vec![
                "First half of the week — Monday 00:00 up to the boundary".to_string(),
                "Second half of the week — no restriction, so it holds the rest".to_string(),
            ],
            inputs: with_common(vec![
                PresetInput::new(
                    "first",
                    PresetInputKind::Group,
                    "Start of the week",
                    "Who covers Monday 00:00 up to the boundary.",
                )
                .with_fields(group_fields("Who covers the first half")),
                PresetInput::new(
                    "second",
                    PresetInputKind::Group,
                    "Rest of the week",
                    "Who covers the boundary to the end of the week.",
                )
                .with_fields(group_fields("Who covers the second half")),
                PresetInput::new(
                    "boundary_day",
                    PresetInputKind::DayOfWeek,
                    "Hand over on",
                    "0 = Monday … 6 = Sunday. Monday 00:00 is refused: it would give the first group none of the week.",
                )
                .bounded(0, 6),
                minute_input("boundary_minute", "Hand over at"),
            ]),
        },
        PresetDescriptor {
            id: PresetId::BusinessHoursPlusNights,
            name: "Business hours plus nights".to_string(),
            description:
                "A working-hours layer over an out-of-hours layer that takes every other hour, nights and weekends included."
                    .to_string(),
            layers: vec![
                "Business hours — the chosen days and window".to_string(),
                "Nights and weekends — no restriction, so it holds everything else".to_string(),
            ],
            inputs: with_common(vec![
                PresetInput::new(
                    "business_hours",
                    PresetInputKind::Group,
                    "Working hours",
                    "Who is on call during the window below.",
                )
                .with_fields(group_fields("Who covers working hours")),
                PresetInput::new(
                    "after_hours",
                    PresetInputKind::Group,
                    "Out of hours",
                    "Who is on call the rest of the time.",
                )
                .with_fields(group_fields("Who covers out of hours")),
                PresetInput::new(
                    "days",
                    PresetInputKind::DayList,
                    "Working days",
                    "0 = Monday … 6 = Sunday.",
                )
                .bounded(0, 6)
                .defaulting(serde_json::json!(default_business_days())),
                minute_input("start_minute", "Working hours from")
                    .defaulting(serde_json::json!(DEFAULT_BUSINESS_START_MINUTE)),
                minute_input("end_minute", "Working hours until")
                    .defaulting(serde_json::json!(DEFAULT_BUSINESS_END_MINUTE)),
            ]),
        },
    ]
}

/// The three fields every preset takes, appended to each descriptor so the UI
/// can build a whole form from one entry instead of remembering a preamble.
fn with_common(mut inputs: Vec<PresetInput>) -> Vec<PresetInput> {
    inputs.push(
        PresetInput::new(
            "timezone",
            PresetInputKind::Timezone,
            "Timezone",
            "The one zone every window below is read in. Absent means the team's own zone — never UTC.",
        )
        .optional(),
    );
    inputs.push(
        PresetInput::new(
            "handover_micros",
            PresetInputKind::DurationMicros,
            "Hand over every",
            "How long one shift lasts, for every layer this builds.",
        )
        .bounded(MIN_HANDOVER_MICROS, MAX_HANDOVER_MICROS)
        .defaulting(serde_json::json!(DEFAULT_HANDOVER_MICROS)),
    );
    inputs.push(
        PresetInput::new(
            "anchor_micros",
            PresetInputKind::TimestampMicros,
            "First shift begins",
            "Absent means now, snapped back to the most recent local Monday 00:00 so handovers land on a week boundary.",
        )
        .optional(),
    );
    inputs
}

fn group_fields(members_help: &str) -> Vec<PresetInput> {
    vec![
        PresetInput::new(
            "name",
            PresetInputKind::Text,
            "Layer name",
            "What this layer is called on the calendar. Absent takes a sensible default.",
        )
        .optional(),
        members_input(members_help),
    ]
}

fn members_input(description: &str) -> PresetInput {
    PresetInput::new(
        "members",
        PresetInputKind::MemberList,
        "Members, in handover order",
        description,
    )
    .bounded(1, MAX_GROUP_MEMBERS as i64)
}

fn minute_input(field: &str, label: &str) -> PresetInput {
    PresetInput::new(
        field,
        PresetInputKind::MinuteOfDay,
        label,
        "Minutes past midnight in the team's timezone.",
    )
    .bounded(0, MINUTES_PER_DAY as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A preset builds the rules of ONE rotation, so the tests wrap them in one
    /// to ask who is on call. Which rule won is what they assert on — that is
    /// the question a preset answers.
    fn of(rules: &[ShiftRule]) -> crate::meta::oncall::Rotation {
        crate::meta::oncall::Rotation {
            id: "rot_1".to_string(),
            name: "Primary".to_string(),
            shift_rules: rules.to_vec(),
            source: None,
        }
    }
    use crate::meta::oncall::rotation::{MICROS_PER_HOUR, resolve_on_call};

    /// Monday 2026-01-05 00:00:00 UTC — a Monday, so a week of hours walked
    /// from here lines up with the day numbering the windows use.
    const MONDAY: i64 = 1_767_571_200_000_000;

    fn g(name: Option<&str>, members: &[&str]) -> Group {
        Group {
            name: name.map(str::to_string),
            members: members.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn region(name: &str, members: &[&str], start_minute: u32, end_minute: u32) -> RegionGroup {
        RegionGroup {
            name: name.to_string(),
            members: members.iter().map(|s| s.to_string()).collect(),
            start_minute,
            end_minute,
        }
    }

    fn follow_the_sun() -> PresetSpec {
        PresetSpec::FollowTheSun {
            groups: vec![
                region("APAC", &["naoto@o2.ai", "mei@o2.ai"], 0, 8 * 60),
                region("EMEA", &["lars@o2.ai", "marie@o2.ai"], 8 * 60, 16 * 60),
                region("AMER", &["john@o2.ai", "kelly@o2.ai"], 16 * 60, 1440),
            ],
            catch_all: None,
        }
    }

    fn weekday_weekend() -> PresetSpec {
        PresetSpec::WeekdayWeekend {
            weekdays: g(None, &["ana@o2.ai", "bo@o2.ai"]),
            weekend: g(None, &["sam@o2.ai", "priya@o2.ai"]),
        }
    }

    fn split_the_week() -> PresetSpec {
        PresetSpec::SplitTheWeek {
            first: g(None, &["ana@o2.ai"]),
            second: g(None, &["bo@o2.ai"]),
            boundary_day: 3,
            boundary_minute: 12 * 60,
        }
    }

    fn business_hours() -> PresetSpec {
        PresetSpec::BusinessHoursPlusNights {
            business_hours: g(None, &["ana@o2.ai", "bo@o2.ai"]),
            after_hours: g(None, &["chen@o2.ai", "dee@o2.ai"]),
            days: default_business_days(),
            start_minute: 9 * 60,
            end_minute: 17 * 60,
        }
    }

    /// Every preset, so the properties below are asserted about all four rather
    /// than about whichever one somebody remembered.
    fn every_preset() -> Vec<(&'static str, PresetSpec)> {
        vec![
            ("follow_the_sun", follow_the_sun()),
            ("weekday_weekend", weekday_weekend()),
            ("split_the_week", split_the_week()),
            ("business_hours_plus_nights", business_hours()),
        ]
    }

    /// The property that justifies the feature: a preset produces a schedule
    /// with nobody uncovered, at any hour of any day.
    #[test]
    fn test_every_preset_covers_every_hour_of_the_week() {
        for tz in [
            chrono_tz::UTC,
            chrono_tz::Asia::Kolkata,
            chrono_tz::America::New_York,
        ] {
            for (id, spec) in every_preset() {
                let rotations = build(&spec, tz, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
                for hour in 0..(7 * 24) {
                    let at = MONDAY + hour * MICROS_PER_HOUR;
                    let slots = resolve_on_call(&[of(&rotations)], &[], &[], at, tz);
                    assert!(
                        !slots.is_empty(),
                        "{id} in {tz} left hour {hour} of the week uncovered"
                    );
                }
            }
        }
    }

    /// The same walk over a spring-forward week and an autumn fall-back week.
    /// Restriction evaluation is already wall-clock correct; this asserts a
    /// preset does not undo that by anchoring somewhere a DST shift moves.
    #[test]
    fn test_a_dst_week_still_has_no_gaps() {
        // 2026-03-08 02:00 America/New_York does not exist; 2026-11-01 01:00
        // happens twice. Both weeks start on the Monday before.
        let weeks = [
            (chrono_tz::America::New_York, 1_772_600_400_000_000i64), // Mon 2026-03-02 00:00 EST
            (chrono_tz::America::New_York, 1_793_764_800_000_000i64), // Mon 2026-10-26 00:00 EDT
        ];
        for (tz, monday) in weeks {
            for (id, spec) in every_preset() {
                let rotations = build(&spec, tz, monday, DEFAULT_HANDOVER_MICROS).unwrap();
                // Quarter-hour steps, because a transition lands mid-hour in
                // some zones and an hourly walk can step straight over it.
                for step in 0..(7 * 24 * 4) {
                    let at = monday + step * (MICROS_PER_HOUR / 4);
                    assert!(
                        !resolve_on_call(&[of(&rotations)], &[], &[], at, tz).is_empty(),
                        "{id} left a gap at step {step} of a DST week"
                    );
                }
            }
        }
    }

    /// A business-hours window still starts at 09:00 local on both sides of a
    /// transition — the preset must not turn a wall-clock window into an
    /// elapsed-micros one.
    #[test]
    fn test_business_hours_stay_at_nine_across_a_dst_transition() {
        use chrono::TimeZone;
        let tz = chrono_tz::America::New_York;
        let rotations = build(
            &business_hours(),
            tz,
            1_772_600_400_000_000,
            DEFAULT_HANDOVER_MICROS,
        )
        .unwrap();
        // The Friday before the transition and the Monday after it.
        for (y, m, d) in [(2026, 3, 6), (2026, 3, 9)] {
            let at = |h, min| {
                tz.with_ymd_and_hms(y, m, d, h, min, 0)
                    .unwrap()
                    .timestamp_micros()
            };
            let who = |t| {
                resolve_on_call(&[of(&rotations)], &[], &[], t, tz)
                    .first()
                    .map(|s| s.rule.clone())
                    .unwrap()
            };
            assert_eq!(who(at(8, 59)), "Nights and weekends", "{y}-{m}-{d} 08:59");
            assert_eq!(who(at(9, 0)), "Business hours", "{y}-{m}-{d} 09:00");
            assert_eq!(who(at(16, 59)), "Business hours", "{y}-{m}-{d} 16:59");
            assert_eq!(who(at(17, 0)), "Nights and weekends", "{y}-{m}-{d} 17:00");
        }
    }

    /// Sample instants, one per layer per preset, resolving to the group the
    /// operator meant. A schedule with no gaps that pages the wrong region is
    /// no better than one with gaps.
    #[test]
    fn test_sample_instants_resolve_to_the_intended_layer() {
        let tz = chrono_tz::UTC;
        // (preset, hours past Monday 00:00, expected layer name)
        let cases: Vec<(PresetSpec, &[(i64, &str)])> = vec![
            (
                follow_the_sun(),
                &[
                    (3, "APAC"),
                    (10, "EMEA"),
                    (20, "AMER"),
                    // Sunday is covered by the regions too: their windows are
                    // day-agnostic, so the catch-all only ever fills a gap the
                    // operator left on purpose.
                    (6 * 24 + 3, "APAC"),
                ],
            ),
            (
                weekday_weekend(),
                &[
                    (0, "Weekdays"),
                    (4 * 24 + 23, "Weekdays"),
                    (5 * 24, "Weekend"),
                    (6 * 24 + 12, "Weekend"),
                ],
            ),
            (
                split_the_week(),
                &[
                    (0, "First half of the week"),
                    (3 * 24 + 11, "First half of the week"),
                    (3 * 24 + 12, "Second half of the week"),
                    (6 * 24 + 23, "Second half of the week"),
                ],
            ),
            (
                business_hours(),
                &[
                    (8, "Nights and weekends"),
                    (9, "Business hours"),
                    (16, "Business hours"),
                    (17, "Nights and weekends"),
                    (5 * 24 + 10, "Nights and weekends"),
                ],
            ),
        ];
        for (spec, samples) in cases {
            let id = spec.id();
            let rotations = build(&spec, tz, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
            for (hour, expected) in samples {
                let slots = resolve_on_call(
                    &[of(&rotations)],
                    &[],
                    &[],
                    MONDAY + hour * MICROS_PER_HOUR,
                    tz,
                );
                assert_eq!(
                    slots.first().map(|s| s.rule.as_str()),
                    Some(*expected),
                    "{id} at hour {hour}"
                );
            }
        }
    }

    /// The catch-all's roster, when the caller does not name one, is everybody
    /// named above in the order they were named.
    #[test]
    fn test_follow_the_sun_catch_all_defaults_to_everybody() {
        let rotations = build(
            &follow_the_sun(),
            chrono_tz::UTC,
            MONDAY,
            DEFAULT_HANDOVER_MICROS,
        )
        .unwrap();
        let catch_all = rotations.last().unwrap();
        assert_eq!(catch_all.restrictions, Vec::new());
        assert_eq!(catch_all.priority, CATCH_ALL_PRIORITY);
        assert_eq!(
            catch_all.members,
            vec![
                "naoto@o2.ai",
                "mei@o2.ai",
                "lars@o2.ai",
                "marie@o2.ai",
                "john@o2.ai",
                "kelly@o2.ai"
            ]
        );
    }

    /// Regions that leave part of the day unclaimed are legal — that hole is
    /// what the catch-all is for — and the catch-all really does fill it.
    #[test]
    fn test_a_region_gap_falls_through_to_the_catch_all() {
        let spec = PresetSpec::FollowTheSun {
            groups: vec![
                region("APAC", &["naoto@o2.ai"], 0, 8 * 60),
                region("AMER", &["kelly@o2.ai"], 16 * 60, 1440),
            ],
            catch_all: Some(g(Some("Everyone"), &["dee@o2.ai"])),
        };
        let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
        let at = |h: i64| MONDAY + h * MICROS_PER_HOUR;
        for (hour, expected) in [(2, "naoto@o2.ai"), (12, "dee@o2.ai"), (20, "kelly@o2.ai")] {
            assert_eq!(
                resolve_on_call(&[of(&rotations)], &[], &[], at(hour), chrono_tz::UTC)
                    .first()
                    .map(|s| s.user_email.as_str()),
                Some(expected),
                "hour {hour}"
            );
        }
    }

    /// Every preset generates exactly one layer with no restrictions. This is
    /// the structural statement of the no-gap property, and it is worth
    /// asserting separately from the hour walk: the walk proves the schedules
    /// tested have no holes, this proves the *reason* they cannot.
    #[test]
    fn test_every_preset_generates_exactly_one_unrestricted_layer() {
        for (id, spec) in every_preset() {
            let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
            let unrestricted: Vec<_> = rotations
                .iter()
                .filter(|r| r.restrictions.is_empty())
                .collect();
            assert_eq!(unrestricted.len(), 1, "{id}");
            assert_eq!(unrestricted[0].priority, CATCH_ALL_PRIORITY, "{id}");
            assert!(
                rotations
                    .iter()
                    .filter(|r| !r.restrictions.is_empty())
                    .all(|r| r.priority > CATCH_ALL_PRIORITY),
                "{id} has a restricted layer that cannot beat the catch-all"
            );
        }
    }

    /// Nothing preset-specific is stored: what comes out is a plain rotation
    /// with the fields §C.3 documents and no others, so it round-trips through
    /// the same JSON `PUT /schedule` accepts.
    #[test]
    fn test_generated_rotations_are_ordinary_rotations() {
        for (id, spec) in every_preset() {
            let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
            for r in &rotations {
                r.validate().unwrap_or_else(|e| panic!("{id}: {e}"));
                let json = serde_json::to_value(r).unwrap();
                let mut keys: Vec<&str> = json
                    .as_object()
                    .unwrap()
                    .keys()
                    .map(|k| k.as_str())
                    .collect();
                keys.sort_unstable();
                assert_eq!(
                    keys,
                    vec![
                        "anchor_micros",
                        "members",
                        "name",
                        "priority",
                        "restrictions",
                        "shift_micros"
                    ],
                    "{id} rotation carries a field the schedule API does not know"
                );
                let back: ShiftRule = serde_json::from_value(json).unwrap();
                assert_eq!(&back, r, "{id}");
            }
        }
    }

    /// Two layers equally in force with equal priority and equal restrictions
    /// is what `set_schedule` refuses; no preset may generate one.
    #[test]
    fn test_no_preset_generates_two_equally_ranked_layers() {
        for (id, spec) in every_preset() {
            let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
            let mut seen = std::collections::HashSet::new();
            for r in &rotations {
                assert!(
                    seen.insert((r.priority, r.restrictions.clone())),
                    "{id} generated two layers with the same priority and restrictions"
                );
            }
        }
    }

    /// The handover lands on a local Monday midnight, not on whenever the
    /// request happened to arrive.
    #[test]
    fn test_the_anchor_snaps_back_to_a_local_week_boundary() {
        use chrono::{Datelike, TimeZone, Timelike};
        let tz = chrono_tz::Asia::Kolkata;
        // A Wednesday afternoon, in the middle of everything.
        let requested = tz
            .with_ymd_and_hms(2026, 1, 7, 14, 37, 12)
            .unwrap()
            .timestamp_micros();
        let rotations = build(&weekday_weekend(), tz, requested, DEFAULT_HANDOVER_MICROS).unwrap();
        for r in &rotations {
            let local = tz.from_utc_datetime(
                &chrono::DateTime::from_timestamp_micros(r.anchor_micros)
                    .unwrap()
                    .naive_utc(),
            );
            assert_eq!(local.weekday().num_days_from_monday(), 0);
            assert_eq!((local.hour(), local.minute(), local.second()), (0, 0, 0));
        }
    }

    /// Refuse rather than guess. One row per way somebody can get it wrong,
    /// each asserting the message names the field or the bound.
    #[test]
    fn test_input_validation_matrix() {
        let cases: Vec<(&str, PresetSpec, i64, &str)> = vec![
            (
                "one region is not follow-the-sun",
                PresetSpec::FollowTheSun {
                    groups: vec![region("APAC", &["naoto@o2.ai"], 0, 720)],
                    catch_all: None,
                },
                DEFAULT_HANDOVER_MICROS,
                "`groups` must hold between 2 and 4 groups, got 1",
            ),
            (
                "five regions is too many",
                PresetSpec::FollowTheSun {
                    groups: (0..5)
                        .map(|i| region(&format!("R{i}"), &["a@o2.ai"], i * 100, i * 100 + 50))
                        .collect(),
                    catch_all: None,
                },
                DEFAULT_HANDOVER_MICROS,
                "got 5",
            ),
            (
                "a region with nobody in it",
                PresetSpec::FollowTheSun {
                    groups: vec![
                        region("APAC", &[], 0, 720),
                        region("AMER", &["kelly@o2.ai"], 720, 1440),
                    ],
                    catch_all: None,
                },
                DEFAULT_HANDOVER_MICROS,
                "`groups[0].members` has nobody in it",
            ),
            (
                "a region with no name",
                PresetSpec::FollowTheSun {
                    groups: vec![
                        region("  ", &["naoto@o2.ai"], 0, 720),
                        region("AMER", &["kelly@o2.ai"], 720, 1440),
                    ],
                    catch_all: None,
                },
                DEFAULT_HANDOVER_MICROS,
                "`groups[0].name` is blank",
            ),
            (
                "the same person twice on one layer",
                PresetSpec::WeekdayWeekend {
                    weekdays: g(None, &["ana@o2.ai", "Ana@o2.ai"]),
                    weekend: g(None, &["sam@o2.ai"]),
                },
                DEFAULT_HANDOVER_MICROS,
                "`weekdays.members` names `Ana@o2.ai` twice",
            ),
            (
                "regions that overlap",
                PresetSpec::FollowTheSun {
                    groups: vec![
                        region("APAC", &["naoto@o2.ai"], 0, 10 * 60),
                        region("EMEA", &["lars@o2.ai"], 8 * 60, 16 * 60),
                    ],
                    catch_all: None,
                },
                DEFAULT_HANDOVER_MICROS,
                "`APAC` and `EMEA` both cover minute 480",
            ),
            (
                "a window that is no window at all",
                PresetSpec::FollowTheSun {
                    groups: vec![
                        region("APAC", &["naoto@o2.ai"], 600, 600),
                        region("AMER", &["kelly@o2.ai"], 0, 300),
                    ],
                    catch_all: None,
                },
                DEFAULT_HANDOVER_MICROS,
                "so the layer would apply at no instant at all",
            ),
            (
                "a minute past the end of the day",
                PresetSpec::BusinessHoursPlusNights {
                    business_hours: g(None, &["ana@o2.ai"]),
                    after_hours: g(None, &["bo@o2.ai"]),
                    days: default_business_days(),
                    start_minute: 5000,
                    end_minute: 1080,
                },
                DEFAULT_HANDOVER_MICROS,
                "`start_minute` is 5000",
            ),
            (
                "a day that is not a day",
                PresetSpec::BusinessHoursPlusNights {
                    business_hours: g(None, &["ana@o2.ai"]),
                    after_hours: g(None, &["bo@o2.ai"]),
                    days: vec![0, 9],
                    start_minute: 540,
                    end_minute: 1080,
                },
                DEFAULT_HANDOVER_MICROS,
                "`days` is 9; days are 0 (Monday) to 6 (Sunday)",
            ),
            (
                "no working days at all",
                PresetSpec::BusinessHoursPlusNights {
                    business_hours: g(None, &["ana@o2.ai"]),
                    after_hours: g(None, &["bo@o2.ai"]),
                    days: vec![],
                    start_minute: 540,
                    end_minute: 1080,
                },
                DEFAULT_HANDOVER_MICROS,
                "`days` is empty",
            ),
            (
                "a split at the very start of the week",
                PresetSpec::SplitTheWeek {
                    first: g(None, &["ana@o2.ai"]),
                    second: g(None, &["bo@o2.ai"]),
                    boundary_day: 0,
                    boundary_minute: 0,
                },
                DEFAULT_HANDOVER_MICROS,
                "gives `first` none of it",
            ),
            (
                "a boundary on an eighth day",
                PresetSpec::SplitTheWeek {
                    first: g(None, &["ana@o2.ai"]),
                    second: g(None, &["bo@o2.ai"]),
                    boundary_day: 7,
                    boundary_minute: 0,
                },
                DEFAULT_HANDOVER_MICROS,
                "`boundary_day` is 7",
            ),
            (
                "a handover of no time at all",
                weekday_weekend(),
                0,
                "`handover_micros` is 0",
            ),
            (
                "a handover in milliseconds by mistake",
                weekday_weekend(),
                MICROS_PER_WEEK * 1000,
                "`handover_micros` is 604800000000000",
            ),
        ];

        for (why, spec, handover, expected) in cases {
            let err = build(&spec, chrono_tz::UTC, MONDAY, handover)
                .expect_err(&format!("{why} must be refused"));
            let msg = err.to_string();
            assert!(
                msg.contains(expected),
                "{why}: expected `{expected}` in `{msg}`"
            );
        }
    }

    /// The catalogue has to be enough to render a form without the UI knowing
    /// anything the server has not told it.
    #[test]
    fn test_catalogue_describes_every_preset() {
        let entries = catalogue();
        assert_eq!(entries.len(), 4);
        let ids: Vec<PresetId> = entries.iter().map(|e| e.id).collect();
        assert_eq!(
            ids,
            vec![
                PresetId::FollowTheSun,
                PresetId::WeekdayWeekend,
                PresetId::SplitTheWeek,
                PresetId::BusinessHoursPlusNights
            ]
        );
        for e in &entries {
            assert!(!e.name.is_empty(), "{} has no name", e.id);
            assert!(!e.description.is_empty(), "{} has no description", e.id);
            assert!(!e.layers.is_empty(), "{} describes no layers", e.id);
            // Every preset takes the three common fields plus its own.
            for common in ["timezone", "handover_micros", "anchor_micros"] {
                assert!(
                    e.inputs.iter().any(|i| i.field == common),
                    "{} does not advertise `{common}`",
                    e.id
                );
            }
            for input in &e.inputs {
                assert!(!input.label.is_empty(), "{}.{}", e.id, input.field);
                assert!(!input.description.is_empty(), "{}.{}", e.id, input.field);
                if matches!(
                    input.kind,
                    PresetInputKind::Group | PresetInputKind::GroupList
                ) {
                    assert!(
                        input.fields.iter().any(|f| f.field == "members"),
                        "{}.{} does not say a group needs members",
                        e.id,
                        input.field
                    );
                }
            }
        }
        // The one bound §C.3 says the UI must not hardcode.
        let fts = entries
            .iter()
            .find(|e| e.id == PresetId::FollowTheSun)
            .unwrap();
        let groups = fts.inputs.iter().find(|i| i.field == "groups").unwrap();
        assert_eq!(groups.min, Some(MIN_FOLLOW_THE_SUN_GROUPS as i64));
        assert_eq!(groups.max, Some(MAX_FOLLOW_THE_SUN_GROUPS as i64));
    }

    /// A length and an instant are not the same control, and this catalogue is
    /// the only thing that tells a generated form which to draw.
    ///
    /// `anchor_micros` shipped as `DurationMicros` while labelled "First shift
    /// begins", so a form built from `inputs` — which is the whole point of
    /// publishing them — offered "every N hours" for a field that wanted a date.
    /// Nothing caught it because both fields end in `_micros` and both are i64
    /// on the wire: the bug lived entirely in the kind.
    #[test]
    fn test_the_anchor_is_an_instant_and_the_handover_is_a_length() {
        for e in catalogue() {
            let kind = |field: &str| e.inputs.iter().find(|i| i.field == field).unwrap().kind;
            assert_eq!(
                kind("anchor_micros"),
                PresetInputKind::TimestampMicros,
                "{} describes the anchor as something other than an instant",
                e.id
            );
            assert_eq!(
                kind("handover_micros"),
                PresetInputKind::DurationMicros,
                "{} describes the handover as something other than a length",
                e.id
            );
        }
    }

    /// The wire shape §C.3 publishes: the preset id sits beside its inputs
    /// rather than wrapping them.
    #[test]
    fn test_spec_decodes_the_published_wire_shape() {
        let spec: PresetSpec = serde_json::from_str(
            r#"{"preset":"weekday_weekend",
                "weekdays":{"members":["ana@o2.ai"]},
                "weekend":{"name":"Saturdays and Sundays","members":["sam@o2.ai"]}}"#,
        )
        .unwrap();
        assert_eq!(spec.id(), PresetId::WeekdayWeekend);
        assert_eq!(spec.members(), vec!["ana@o2.ai", "sam@o2.ai"]);
        let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
        assert_eq!(rotations[1].name, "Saturdays and Sundays");
    }

    /// Business hours default to Mon–Fri 09:00–17:00, so the smallest possible
    /// request still builds the shape the name promises.
    #[test]
    fn test_business_hours_defaults_are_nine_to_five_on_weekdays() {
        let spec: PresetSpec = serde_json::from_str(
            r#"{"preset":"business_hours_plus_nights",
                "business_hours":{"members":["ana@o2.ai"]},
                "after_hours":{"members":["bo@o2.ai"]}}"#,
        )
        .unwrap();
        let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
        assert_eq!(
            rotations[0].restrictions,
            vec![TimeWindow {
                days: vec![0, 1, 2, 3, 4],
                start_minute: 540,
                end_minute: 1020,
            }]
        );
    }

    /// A region whose hours straddle local midnight is a normal thing to
    /// describe, and it must not be mistaken for an empty window.
    #[test]
    fn test_a_region_may_wrap_midnight() {
        let spec = PresetSpec::FollowTheSun {
            groups: vec![
                region("Night", &["naoto@o2.ai"], 22 * 60, 6 * 60),
                region("Day", &["kelly@o2.ai"], 6 * 60, 22 * 60),
            ],
            catch_all: None,
        };
        let rotations = build(&spec, chrono_tz::UTC, MONDAY, DEFAULT_HANDOVER_MICROS).unwrap();
        for (hour, expected) in [(0, "Night"), (7, "Day"), (23, "Night")] {
            assert_eq!(
                resolve_on_call(
                    &[of(&rotations)],
                    &[],
                    &[],
                    MONDAY + hour * MICROS_PER_HOUR,
                    chrono_tz::UTC
                )
                .first()
                .map(|s| s.rule.as_str()),
                Some(expected),
                "hour {hour}"
            );
        }
    }

    #[test]
    fn test_map_members_rewrites_every_layer() {
        let mut spec = follow_the_sun();
        spec.map_members(|m| m.to_ascii_uppercase());
        assert!(spec.members().iter().all(|m| m.ends_with("O2.AI")));
    }
}
