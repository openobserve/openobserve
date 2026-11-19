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

use chrono::{DateTime, Datelike, FixedOffset, LocalResult, NaiveDate, TimeDelta, TimeZone, Utc};
use chrono_tz::Tz;

const CALENDAR_PREFIX: &str = "calendar:";
const MAX_OFFSET_DIGITS: usize = 6;
// A DST change at midnight skips at most a few hours of the day's start.
const DST_GAP_SEARCH_MINUTES: i64 = 180;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarUnit {
    Day,
    Week,
    Month,
    Quarter,
    Year,
}

impl CalendarUnit {
    fn parse(unit: &str) -> Option<Self> {
        match unit {
            "day" => Some(Self::Day),
            "week" => Some(Self::Week),
            "month" => Some(Self::Month),
            "quarter" => Some(Self::Quarter),
            "year" => Some(Self::Year),
            _ => None,
        }
    }

    // Weeks start on Monday: the server has no browser locale to take a week start from.
    fn start(self, today: NaiveDate, offset: i32) -> Option<NaiveDate> {
        match self {
            Self::Day => today.checked_add_signed(TimeDelta::try_days(i64::from(offset))?),
            Self::Week => {
                let into_week = i64::from(today.weekday().num_days_from_monday());
                let days = i64::from(offset).checked_mul(7)? - into_week;
                today.checked_add_signed(TimeDelta::try_days(days)?)
            }
            Self::Month => month_start(today.year(), today.month0() as i32 + offset),
            Self::Quarter => {
                let quarter_month0 = today.month0() as i32 / 3 * 3;
                month_start(today.year(), quarter_month0 + offset.checked_mul(3)?)
            }
            Self::Year => NaiveDate::from_ymd_opt(today.year().checked_add(offset)?, 1, 1),
        }
    }
}

/// A calendar token from the time picker, e.g. `calendar:month:-1` for the previous month.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CalendarPeriod {
    pub unit: CalendarUnit,
    pub offset: i32,
}

impl CalendarPeriod {
    /// Accepts exactly the UI's `calendar:<unit>:<0|-n>` form, `n` at most six digits.
    pub fn parse(token: &str) -> Option<Self> {
        let (unit, offset) = token.strip_prefix(CALENDAR_PREFIX)?.split_once(':')?;
        Some(Self {
            unit: CalendarUnit::parse(unit)?,
            offset: parse_offset(offset)?,
        })
    }

    /// `[start, end)` in microseconds in `now`'s zone; the running period (offset 0) ends at now.
    pub fn resolve<T: TimeZone>(&self, now: &DateTime<T>) -> Option<(i64, i64)> {
        let today = now.date_naive();
        let start = self.unit.start(today, self.offset)?;
        if start.year() < 1 {
            return None;
        }
        let zone = now.timezone();
        let start_us = zoned_midnight(&zone, start)?;
        let end_us = if self.offset == 0 {
            now.timestamp_micros()
        } else {
            zoned_midnight(&zone, self.unit.start(today, self.offset + 1)?)?
        };
        Some((start_us, end_us))
    }
}

/// A report's zone: its IANA name, else its fixed offset in minutes east of UTC.
#[derive(Clone, Copy, Debug)]
pub struct ReportZone<'a> {
    pub name: &'a str,
    pub offset_minutes: i32,
}

/// True when the period is a calendar token rather than a rolling `Last N`.
pub fn is_calendar_period(period: &str) -> bool {
    period.starts_with(CALENDAR_PREFIX)
}

/// Resolves a report's relative period (`15m`, `1w`, `calendar:month:-1`) to `[start, end)`
/// microseconds at `now_us`; `None` when the period cannot be read.
pub fn resolve_report_period(period: &str, zone: ReportZone, now_us: i64) -> Option<(i64, i64)> {
    if !is_calendar_period(period) {
        return Some((rolling_start(period, now_us)?, now_us));
    }
    let calendar = CalendarPeriod::parse(period)?;
    let now = DateTime::<Utc>::from_timestamp_micros(now_us)?;
    if let Ok(tz) = zone.name.parse::<Tz>() {
        return calendar.resolve(&now.with_timezone(&tz));
    }
    let fixed = zone
        .offset_minutes
        .checked_mul(60)
        .and_then(FixedOffset::east_opt)
        .unwrap_or(FixedOffset::east_opt(0)?);
    calendar.resolve(&now.with_timezone(&fixed))
}

/// URL params for a relative report range: `(render, email link)`. The email link is always
/// fixed; a calendar period renders fixed too, so the browser's zone never moves it.
pub fn relative_range_params(
    period: &str,
    zone: ReportZone,
    now_us: i64,
) -> Option<(String, String)> {
    let (start, end) = resolve_report_period(period, zone, now_us)?;
    let window = format!("from={start}&to={end}");
    let render = if is_calendar_period(period) {
        window.clone()
    } else {
        format!("period={period}")
    };
    Some((render, window))
}

fn parse_offset(offset: &str) -> Option<i32> {
    if offset == "0" {
        return Some(0);
    }
    let digits = offset.strip_prefix('-')?;
    let well_formed = !digits.is_empty()
        && digits.len() <= MAX_OFFSET_DIGITS
        && !digits.starts_with('0')
        && digits.bytes().all(|b| b.is_ascii_digit());
    if !well_formed {
        return None;
    }
    digits.parse::<i32>().ok().map(|n| -n)
}

fn month_start(year: i32, month0: i32) -> Option<NaiveDate> {
    let months = year.checked_mul(12)?.checked_add(month0)?;
    NaiveDate::from_ymd_opt(months.div_euclid(12), months.rem_euclid(12) as u32 + 1, 1)
}

// The first instant of the civil day: a DST change at midnight skips or repeats 00:00.
fn zoned_midnight<T: TimeZone>(zone: &T, date: NaiveDate) -> Option<i64> {
    let midnight = date.and_hms_opt(0, 0, 0)?;
    for minute in 0..=DST_GAP_SEARCH_MINUTES {
        match zone.from_local_datetime(&(midnight + TimeDelta::try_minutes(minute)?)) {
            LocalResult::Single(t) => return Some(t.timestamp_micros()),
            LocalResult::Ambiguous(earliest, _) => return Some(earliest.timestamp_micros()),
            LocalResult::None => continue,
        }
    }
    None
}

// Units other than m, h, d and w count as 30-day months, as reports always have.
fn rolling_start(period: &str, now_us: i64) -> Option<i64> {
    let unit_at = period.char_indices().last()?.0;
    let (count, unit) = period.split_at(unit_at);
    let count: i64 = count.parse().ok()?;
    let span = match unit {
        "m" => TimeDelta::try_minutes(count),
        "h" => TimeDelta::try_hours(count),
        "d" => TimeDelta::try_days(count),
        "w" => TimeDelta::try_weeks(count),
        _ => TimeDelta::try_days(count.checked_mul(30)?),
    }?;
    now_us.checked_sub(span.num_microseconds()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UTC_ZONE: ReportZone = ReportZone {
        name: "UTC",
        offset_minutes: 0,
    };

    fn us(rfc3339: &str) -> i64 {
        DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .timestamp_micros()
    }

    fn zone(name: &str) -> ReportZone<'_> {
        ReportZone {
            name,
            offset_minutes: 0,
        }
    }

    #[test]
    fn parse_accepts_only_the_ui_token_form() {
        assert_eq!(
            CalendarPeriod::parse("calendar:month:-1"),
            Some(CalendarPeriod {
                unit: CalendarUnit::Month,
                offset: -1
            })
        );
        assert_eq!(
            CalendarPeriod::parse("calendar:day:0").map(|p| p.offset),
            Some(0)
        );
        assert_eq!(
            CalendarPeriod::parse("calendar:year:-999999").map(|p| p.offset),
            Some(-999_999)
        );
        for bad in [
            "calendar:month:1",
            "calendar:month:-0",
            "calendar:month:-01",
            "calendar:month:-1234567",
            "calendar:month:",
            "calendar:fortnight:0",
            "calendar:month",
            "1w",
            "",
        ] {
            assert_eq!(CalendarPeriod::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn previous_month_resolves_in_the_report_zone_with_an_exclusive_end() {
        let now = us("2026-11-13T10:00:00Z");
        let got = resolve_report_period("calendar:month:-1", zone("Asia/Kolkata"), now);
        assert_eq!(
            got,
            Some((
                us("2026-10-01T00:00:00+05:30"),
                us("2026-11-01T00:00:00+05:30")
            ))
        );
    }

    #[test]
    fn a_running_period_ends_at_now() {
        let now = us("2026-11-13T10:00:00Z");
        assert_eq!(
            resolve_report_period("calendar:month:0", UTC_ZONE, now),
            Some((us("2026-11-01T00:00:00Z"), now))
        );
        assert_eq!(
            resolve_report_period("calendar:day:0", zone("America/New_York"), now),
            Some((us("2026-11-13T00:00:00-05:00"), now))
        );
    }

    #[test]
    fn the_zone_decides_which_day_is_yesterday() {
        let now = us("2026-11-13T02:00:00Z");
        assert_eq!(
            resolve_report_period("calendar:day:-1", UTC_ZONE, now),
            Some((us("2026-11-12T00:00:00Z"), us("2026-11-13T00:00:00Z")))
        );
        assert_eq!(
            resolve_report_period("calendar:day:-1", zone("America/Los_Angeles"), now),
            Some((
                us("2026-11-11T00:00:00-08:00"),
                us("2026-11-12T00:00:00-08:00")
            ))
        );
    }

    #[test]
    fn weeks_start_on_monday() {
        let thursday = us("2026-11-12T12:00:00Z");
        assert_eq!(
            resolve_report_period("calendar:week:0", UTC_ZONE, thursday),
            Some((us("2026-11-09T00:00:00Z"), thursday))
        );
        assert_eq!(
            resolve_report_period("calendar:week:-1", UTC_ZONE, thursday),
            Some((us("2026-11-02T00:00:00Z"), us("2026-11-09T00:00:00Z")))
        );
    }

    #[test]
    fn previous_quarter_and_year_cross_the_year_boundary() {
        let now = us("2026-02-10T12:00:00Z");
        assert_eq!(
            resolve_report_period("calendar:quarter:-1", UTC_ZONE, now),
            Some((us("2025-10-01T00:00:00Z"), us("2026-01-01T00:00:00Z")))
        );
        assert_eq!(
            resolve_report_period("calendar:year:-1", UTC_ZONE, now),
            Some((us("2025-01-01T00:00:00Z"), us("2026-01-01T00:00:00Z")))
        );
        assert_eq!(
            resolve_report_period("calendar:month:-2", UTC_ZONE, now),
            Some((us("2025-12-01T00:00:00Z"), us("2026-01-01T00:00:00Z")))
        );
    }

    #[test]
    fn a_day_whose_midnight_is_skipped_starts_at_its_first_instant() {
        // America/Santiago moves 00:00 to 01:00 on 2026-09-06.
        let now = us("2026-09-07T12:00:00Z");
        assert_eq!(
            resolve_report_period("calendar:day:-1", zone("America/Santiago"), now),
            Some((
                us("2026-09-06T01:00:00-03:00"),
                us("2026-09-07T00:00:00-03:00")
            ))
        );
    }

    #[test]
    fn an_unknown_zone_name_falls_back_to_the_fixed_offset() {
        let now = us("2026-11-13T10:00:00Z");
        let fixed = ReportZone {
            name: "",
            offset_minutes: 330,
        };
        assert_eq!(
            resolve_report_period("calendar:day:-1", fixed, now),
            Some((
                us("2026-11-12T00:00:00+05:30"),
                us("2026-11-13T00:00:00+05:30")
            ))
        );
        let bad = ReportZone {
            name: "Browser Time (Asia/Kolkata)",
            offset_minutes: i32::MAX,
        };
        assert_eq!(
            resolve_report_period("calendar:day:-1", bad, now),
            Some((us("2026-11-12T00:00:00Z"), us("2026-11-13T00:00:00Z")))
        );
    }

    #[test]
    fn a_period_before_year_one_is_refused() {
        let now = us("2026-11-13T10:00:00Z");
        assert_eq!(
            resolve_report_period("calendar:year:-999999", UTC_ZONE, now),
            None
        );
        assert_eq!(
            resolve_report_period("calendar:month:1", UTC_ZONE, now),
            None
        );
    }

    #[test]
    fn range_params_render_calendar_periods_as_fixed_instants() {
        let now = us("2026-11-13T10:00:00Z");
        let (render, email) = relative_range_params("calendar:day:-1", UTC_ZONE, now).unwrap();
        let window = format!(
            "from={}&to={}",
            us("2026-11-12T00:00:00Z"),
            us("2026-11-13T00:00:00Z")
        );
        assert_eq!(
            (render.as_str(), email.as_str()),
            (window.as_str(), window.as_str())
        );

        let (render, email) = relative_range_params("1w", UTC_ZONE, now).unwrap();
        assert_eq!(render, "period=1w");
        assert_eq!(
            email,
            format!("from={}&to={now}", us("2026-11-06T10:00:00Z"))
        );
        assert_eq!(relative_range_params("calendar:day:1", UTC_ZONE, now), None);
    }

    #[test]
    fn rolling_periods_keep_their_meaning() {
        let now = us("2026-11-13T10:00:00Z");
        let start = |period| resolve_report_period(period, UTC_ZONE, now).map(|(s, _)| s);
        assert_eq!(start("15m"), Some(us("2026-11-13T09:45:00Z")));
        assert_eq!(start("2h"), Some(us("2026-11-13T08:00:00Z")));
        assert_eq!(start("1d"), Some(us("2026-11-12T10:00:00Z")));
        assert_eq!(start("1w"), Some(us("2026-11-06T10:00:00Z")));
        assert_eq!(start("1M"), Some(us("2026-10-14T10:00:00Z")));
        assert_eq!(
            resolve_report_period("1w", UTC_ZONE, now).map(|(_, e)| e),
            Some(now)
        );
        for bad in ["", "w", "xw", "9999999999999999999w"] {
            assert_eq!(start(bad), None, "{bad}");
        }
    }
}
