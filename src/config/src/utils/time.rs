// Copyright 2025 OpenObserve Inc.
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

use chrono::{DateTime, Datelike, Duration, NaiveDateTime, TimeZone, Utc};
use once_cell::sync::Lazy;

use crate::utils::json;

// BASE_TIME is the time when the timestamp is 1 year, used to check a timestamp
// is in seconds or milliseconds or microseconds or nanoseconds
pub static BASE_TIME: Lazy<DateTime<Utc>> =
    Lazy::new(|| Utc.with_ymd_and_hms(1971, 1, 1, 0, 0, 0).unwrap());

pub static DAY_MICRO_SECS: i64 = 24 * 3600 * 1_000_000;
pub static HOUR_MICRO_SECS: i64 = 3600 * 1_000_000;

// check format: 1s, 1m, 1h, 1d, 1w, 1y, 1h10m30s
static TIME_UNITS: [(char, u64); 7] = [
    ('!', 1), // ms
    ('s', 1000),
    ('m', 60 * 1000),
    ('h', 3600 * 1000),
    ('d', 24 * 3600 * 1000),
    ('w', 7 * 24 * 3600 * 1000),
    ('y', 365 * 24 * 3600 * 1000),
];

#[inline(always)]
pub fn now() -> DateTime<Utc> {
    Utc::now()
}

#[inline(always)]
pub fn now_micros() -> i64 {
    Utc::now().timestamp_micros()
}

#[inline(always)]
pub fn day_micros(n: i64) -> i64 {
    Duration::try_days(n).unwrap().num_microseconds().unwrap()
}

#[inline(always)]
pub fn hour_micros(n: i64) -> i64 {
    Duration::try_hours(n).unwrap().num_microseconds().unwrap()
}

#[inline(always)]
pub fn second_micros(n: i64) -> i64 {
    Duration::try_seconds(n)
        .unwrap()
        .num_microseconds()
        .unwrap()
}

#[inline(always)]
pub fn get_ymdh_from_micros(n: i64) -> String {
    let n = if n > 0 {
        n
    } else {
        Utc::now().timestamp_micros()
    };
    let t = Utc.timestamp_nanos(n * 1000);
    t.format("%Y/%m/%d/%H").to_string()
}

#[inline(always)]
pub fn parse_i64_to_timestamp_micros(v: i64) -> i64 {
    if v == 0 {
        return Utc::now().timestamp_micros();
    }
    let mut duration = v;
    if duration > BASE_TIME.timestamp_nanos_opt().unwrap_or_default() {
        // nanoseconds
        duration /= 1000;
    } else if duration > BASE_TIME.timestamp_micros() {
        // microseconds
        // noop
    } else if duration > BASE_TIME.timestamp_millis() {
        // milliseconds
        duration *= 1000;
    } else {
        // seconds
        duration *= 1_000_000;
    }
    duration
}

#[inline(always)]
pub fn parse_str_to_timestamp_micros(v: &str) -> Result<i64, anyhow::Error> {
    match v.parse() {
        Ok(i) => Ok(parse_i64_to_timestamp_micros(i)),
        Err(_) => match parse_str_to_time(v) {
            Ok(v) => Ok(v.timestamp_micros()),
            Err(_) => Err(anyhow::anyhow!("invalid time format [string]")),
        },
    }
}

#[inline(always)]
pub fn parse_str_to_time(s: &str) -> Result<DateTime<Utc>, anyhow::Error> {
    if let Ok(v) = s.parse::<f64>() {
        let v = parse_i64_to_timestamp_micros(v as i64);
        return Ok(Utc.timestamp_nanos(v * 1000));
    }

    let ret = if s.contains(' ') && s.len() == 19 {
        let fmt = "%Y-%m-%d %H:%M:%S";
        NaiveDateTime::parse_from_str(s, fmt)?.and_utc()
    } else if s.contains('T') && !s.contains(' ') {
        if s.len() == 19 {
            let fmt = "%Y-%m-%dT%H:%M:%S";
            NaiveDateTime::parse_from_str(s, fmt)?.and_utc()
        } else if s.contains('.') {
            // Handle formats with decimal seconds: "2025-05-14T01:15:25.047"
            // First check if it has milliseconds (3 decimal places)
            if s.split('.').next_back().unwrap_or("").len() == 3 {
                let fmt = "%Y-%m-%dT%H:%M:%S%.3f";
                NaiveDateTime::parse_from_str(s, fmt)?.and_utc()
            } else if s.split('.').next_back().unwrap_or("").len() == 6 {
                // Handle microseconds (6 decimal places)
                let fmt = "%Y-%m-%dT%H:%M:%S%.6f";
                NaiveDateTime::parse_from_str(s, fmt)?.and_utc()
            } else {
                // Fall back to RFC3339 parsing for other decimal formats
                let t = DateTime::parse_from_rfc3339(s)?;
                t.into()
            }
        } else {
            // Other formats with 'T' but no spaces or decimal points
            let t = DateTime::parse_from_rfc3339(s)?;
            t.into()
        }
    } else {
        let t = DateTime::parse_from_rfc2822(s)?;
        t.into()
    };
    Ok(ret)
}

// return timestamp and is_valid micros value
#[inline(always)]
pub fn parse_timestamp_micro_from_value(v: &json::Value) -> Result<(i64, bool), anyhow::Error> {
    let (ts, is_i64) = match v {
        json::Value::String(s) => (parse_str_to_timestamp_micros(s)?, false),
        json::Value::Number(n) => {
            if n.is_i64() {
                (n.as_i64().unwrap(), true)
            } else if n.is_u64() {
                (n.as_u64().unwrap() as i64, true)
            } else if n.is_f64() {
                (n.as_f64().unwrap() as i64, false)
            } else {
                return Err(anyhow::anyhow!("Invalid time format [timestamp]"));
            }
        }
        _ => return Err(anyhow::anyhow!("Invalid time format [type]")),
    };
    let new_ts = parse_i64_to_timestamp_micros(ts);
    let is_valid = is_i64 && new_ts == ts;
    Ok((new_ts, is_valid))
}

pub fn parse_milliseconds(s: &str) -> Result<u64, anyhow::Error> {
    let chars = s.chars().collect::<Vec<char>>();

    // without unit, default is second
    if chars.iter().all(|c| c.is_ascii_digit()) {
        return Ok(s.parse::<u64>().unwrap_or(0) * 1000);
    }

    let mut unit_pos = TIME_UNITS.len();
    let mut start = 0;
    let mut total = 0;

    let chars_count = chars.len();
    let mut i = 0;
    while i < chars_count {
        let c = chars.get(i).unwrap();
        if c.is_ascii_digit() {
            i += 1;
            continue;
        }
        if i == 0 {
            return Err(anyhow::anyhow!("Invalid time format: {c}"));
        }
        let step_value = chars[start..i]
            .iter()
            .collect::<String>()
            .parse::<u64>()
            .unwrap_or(0);
        start = i + 1;
        // check unit
        let pos = TIME_UNITS[..unit_pos].iter().position(|&x| x.0 == *c);
        if pos.is_none() && *c != 'm' {
            return Err(anyhow::anyhow!("Invalid time format: {c}"));
        }
        // check unit: ms
        let cur_unit = if *c == 'm' && i + 1 < chars_count && chars.get(i + 1).unwrap() == &'s' {
            i += 1;
            unit_pos = 0;
            &TIME_UNITS[unit_pos]
        } else {
            unit_pos = pos.unwrap();
            &TIME_UNITS[unit_pos]
        };
        // calc
        total += step_value * cur_unit.1;
        i += 1;
    }
    Ok(total)
}

pub fn parse_timezone_to_offset(offset: &str) -> i64 {
    // let offset = "+08:00"; // or "-07:00" or "UTC"
    let sign: i64;
    let time: &str;

    if let Some(stripped) = offset.strip_prefix('+') {
        sign = 1;
        time = stripped;
    } else if let Some(stripped) = offset.strip_prefix('-') {
        sign = -1;
        time = stripped;
    } else if offset.eq_ignore_ascii_case("cst") {
        sign = 1;
        time = "+08:00";
    } else if offset.eq_ignore_ascii_case("utc") || offset.is_empty() {
        sign = 0;
        time = "00:00";
    } else {
        panic!("Invalid time zone offset");
    }

    // convert time to seconds
    let seconds: i64 = time
        .split(':')
        .map(|val| val.parse::<i64>().unwrap())
        .fold(0, |acc, val| acc * 60 + val * 60);

    sign * seconds
}

#[inline(always)]
pub fn parse_str_to_timestamp_micros_as_option(v: &str) -> Option<i64> {
    v.parse()
        .ok()
        .map(parse_i64_to_timestamp_micros)
        .or_else(|| parse_str_to_time(v).map(|t| t.timestamp_micros()).ok())
}

/// Get the end of the day timestamp_micros
pub fn end_of_the_day(timestamp: i64) -> i64 {
    let t = Utc.timestamp_nanos((timestamp + DAY_MICRO_SECS) * 1000);
    let t_next_day_zero = Utc
        .with_ymd_and_hms(t.year(), t.month(), t.day(), 0, 0, 0)
        .unwrap()
        .timestamp_micros();
    t_next_day_zero - 1
}

pub fn format_duration(ms: u64) -> String {
    if ms == 0 {
        return "0s".to_string();
    }
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;
    let remaining_seconds = seconds % 60;
    let remaining_minutes = minutes % 60;
    let remaining_hours = hours % 24;
    let mut parts = Vec::new();
    if days > 0 {
        parts.push(format!("{days}d"));
    }
    if remaining_hours > 0 {
        parts.push(format!("{remaining_hours}h"));
    }
    if remaining_minutes > 0 {
        parts.push(format!("{remaining_minutes}m"));
    }
    if remaining_seconds > 0 {
        parts.push(format!("{remaining_seconds}s"));
    }
    parts.join("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_i64_to_timestamp_micros() {
        let test_fn = parse_i64_to_timestamp_micros;

        let v_exp_arr = [
            (1609459200000000000, 1609459200000000000 / 1000),
            (1609459200000000, 1609459200000000),
            (1609459200000, 1609459200000 * 1000),
            (1609459200, 1609459200 * 1_000_000),
        ];
        for (input, expected) in v_exp_arr {
            assert_eq!(test_fn(input), expected);
        }
    }

    #[test]
    fn test_parse_str_to_time() {
        let test_fn = |v| parse_str_to_time(v).map(|v| v.timestamp_micros());

        assert!(test_fn("2021-01-01T00:00:00").is_ok_and(|v| v == 1609459200000000));
        assert!(test_fn("2021-01-01T00:00:00Z").is_ok_and(|v| v == 1609459200000000));
        assert!(test_fn("2021-01-01T23:59:59Z").is_ok_and(|v| v == 1609545599000000));
        assert!(test_fn("2021-01-01T00:00:00+08:00").is_ok_and(|v| v == 1609430400000000));
        assert!(test_fn("2021-01-01T00:00:00-08:00").is_ok_and(|v| v == 1609488000000000));
        assert!(test_fn("2021-01-01 00:00:00").is_ok_and(|v| v == 1609459200000000));
        assert!(test_fn("2021-01-01T00:00:00.000000Z").is_ok_and(|v| v == 1609459200000000));
        assert!(test_fn("2021-01-01T00:00:00.000000+08:00").is_ok_and(|v| v == 1609430400000000));
        assert!(test_fn("Wed, 8 Mar 2023 16:46:51 CST").is_ok_and(|v| v == 1678315611000000));
        assert!(test_fn("2021-01-01T00:00:00.123").is_ok_and(|v| v == 1609459200123000));
        assert!(test_fn("2021-01-01T00:00:00.123456").is_ok_and(|v| v == 1609459200123456));
        assert!(test_fn("2021-01-01T00:00:00.123456+08:00").is_ok_and(|v| v == 1609430400123456));
        assert!(
            test_fn("2021-01-01T00:00:00.123456789-08:00").is_ok_and(|v| v == 1609488000123456)
        );
        assert!(test_fn("2021-01-01T00:00:00.123Z").is_ok_and(|v| v == 1609459200123000));
        assert!(test_fn("2021-01-01T00:00:00.123456789").is_err());
    }

    #[test]
    fn test_parse_str_to_timestamp_micros() {
        let test_fn = parse_str_to_timestamp_micros;
        let v_exp_arr = [
            (1609459200000000, "2021-01-01T00:00:00"),
            (1609459200000000, "2021-01-01T00:00:00Z"),
            (1609430400000000, "2021-01-01T00:00:00+08:00"),
            (1609488000000000, "2021-01-01T00:00:00-08:00"),
            (1609459200000000, "2021-01-01 00:00:00"),
            (1609459200000000, "2021-01-01T00:00:00.000000Z"),
            (1609430400000000, "2021-01-01T00:00:00.000000+08:00"),
            (1678315611000000, "Wed, 8 Mar 2023 16:46:51 CST"),
            (1609459200123000, "2021-01-01T00:00:00.123"),
            (1609459200123456, "2021-01-01T00:00:00.123456"),
            (1609430400123456, "2021-01-01T00:00:00.123456+08:00"),
            (1609488000123456, "2021-01-01T00:00:00.123456789-08:00"),
        ];

        for (v_exp, input) in v_exp_arr {
            assert!(test_fn(input).is_ok_and(|v| v == v_exp));
        }
    }

    #[test]
    fn test_parse_timestamp_micro_from_value() {
        let v_exp_arr = [
            (1609459200000000, json::json!(1609459200000000i64)),
            (1609459200000000, json::json!("2021-01-01T00:00:00")),
            (1609459200000000, json::json!("2021-01-01T00:00:00Z")),
            (1609430400000000, json::json!("2021-01-01T00:00:00+08:00")),
            (1609488000000000, json::json!("2021-01-01T00:00:00-08:00")),
            (1609459200000000, json::json!("2021-01-01 00:00:00")),
            (1609459200000000, json::json!("2021-01-01T00:00:00.000000Z")),
            (
                1609430400000000,
                json::json!("2021-01-01T00:00:00.000000+08:00"),
            ),
            (
                1678315611000000,
                json::json!("Wed, 8 Mar 2023 16:46:51 CST"),
            ),
            (1609459200123000, json::json!("2021-01-01T00:00:00.123")),
            (1609459200000000, json::json!("2021-01-01T00:00:00Z")),
            (1609430400000000, json::json!("2021-01-01T00:00:00+08:00")),
            (1609488000000000, json::json!("2021-01-01T00:00:00-08:00")),
            (1609459200000000, json::json!("2021-01-01 00:00:00")),
            (1609459200000000, json::json!("2021-01-01T00:00:00.000000Z")),
            (
                1609430400000000,
                json::json!("2021-01-01T00:00:00.000000+08:00"),
            ),
            (
                1678315611000000,
                json::json!("Wed, 8 Mar 2023 16:46:51 CST"),
            ),
            (1609459200123000, json::json!("2021-01-01T00:00:00.123")),
            (1609459200123456, json::json!("2021-01-01T00:00:00.123456")),
        ];

        for (v_exp, input) in v_exp_arr {
            assert!(parse_timestamp_micro_from_value(&input).is_ok_and(|v| v.0 == v_exp));
        }
    }

    #[test]
    fn test_parse_milliseconds_without_unit() {
        assert_eq!(parse_milliseconds("123").unwrap(), 123000);
        assert_eq!(parse_milliseconds("0").unwrap(), 0);
        assert_eq!(parse_milliseconds("").unwrap(), 0);
        assert!(parse_milliseconds("abc").is_err());
    }

    #[test]
    fn test_parse_milliseconds_with_unit() {
        assert_eq!(parse_milliseconds("1s").unwrap(), 1000);
        assert_eq!(parse_milliseconds("1m").unwrap(), 60 * 1000);
        assert_eq!(parse_milliseconds("1h").unwrap(), 3600 * 1000);
        assert_eq!(parse_milliseconds("1d").unwrap(), 24 * 3600 * 1000);
        assert_eq!(parse_milliseconds("1w").unwrap(), 7 * 24 * 3600 * 1000);
        assert_eq!(parse_milliseconds("1y").unwrap(), 365 * 24 * 3600 * 1000);
        assert_eq!(parse_milliseconds("1h10m30s").unwrap(), 4230000);
        assert_eq!(parse_milliseconds("1h10m30s10ms").unwrap(), 4230010);
        assert!(parse_milliseconds("s").is_err());
        assert!(parse_milliseconds("10z").is_err());
    }

    #[test]
    fn test_parse_timezone_to_offset() {
        assert_eq!(parse_timezone_to_offset(""), 0);
        assert_eq!(parse_timezone_to_offset("UTC"), 0);
        assert_eq!(parse_timezone_to_offset("CST"), 28800);
        assert_eq!(parse_timezone_to_offset("+08:00"), 28800);
        assert_eq!(parse_timezone_to_offset("-08:00"), -28800);
    }

    #[test]
    fn test_end_of_the_day() {
        let t_d_arr = [
            (1609545599999999, 1609459200000000),
            (1727827199999999, 1727740800000000),
        ];
        for (d_exp, t) in t_d_arr {
            assert_eq!(end_of_the_day(t), d_exp);
        }
    }

    #[test]
    fn test_get_ymdhms_from_micros() {
        assert_eq!(get_ymdh_from_micros(1609459200000000), "2021/01/01/00");
        assert_eq!(get_ymdh_from_micros(1744077663427000), "2025/04/08/02");

        // Test with input 0 (uses current time, so we can't test the exact value)
        let result = get_ymdh_from_micros(0);
        assert!(!result.is_empty());
    }

    #[test]
    fn test_format_duration() {
        let v_exp_arr = [
            ("0s", 0),              // Zero milliseconds
            ("1s", 1000),           // 1 second
            ("5s", 5000),           // 5 seconds
            ("59s", 59000),         // 59 seconds
            ("1m", 60000),          // 1 minute
            ("5m", 300000),         // 5 minutes
            ("59m", 3540000),       // 59 minutes
            ("1h", 3600000),        // 1 hour
            ("2h", 7200000),        // 2 hours
            ("23h", 82800000),      // 23 hours
            ("1d", 86400000),       // 1 day
            ("2d", 172800000),      // 2 days
            ("30d", 2592000000),    // 30 days
            ("1d1h1m1s", 90061000), // 1 day 1 hour 1 minute 1 second
            ("1d2h3m4s", 93784000), // 1 day 2 hours 3 minutes 4 seconds
            ("1h1m1s", 3661000),
            ("1m1s", 61000),
        ];

        for (v_exp, input) in v_exp_arr {
            assert_eq!(format_duration(input), v_exp);
        }
    }

    #[test]
    fn test_day_micros() {
        assert_eq!(day_micros(1), 86400000000);
        assert_eq!(day_micros(2), 172800000000);
        assert_eq!(day_micros(0), 0);
    }

    #[test]
    fn test_hour_micros() {
        assert_eq!(hour_micros(1), 3600000000);
        assert_eq!(hour_micros(2), 7200000000);
        assert_eq!(hour_micros(0), 0);
    }

    #[test]
    fn test_second_micros() {
        assert_eq!(second_micros(1), 1000000);
        assert_eq!(second_micros(60), 60000000);
        assert_eq!(second_micros(0), 0);
    }

    #[test]
    fn test_parse_str_to_timestamp_micros_as_option_valid() {
        let result = parse_str_to_timestamp_micros_as_option("1609459200000000");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1609459200000000);
    }

    #[test]
    fn test_parse_str_to_timestamp_micros_as_option_invalid() {
        let result = parse_str_to_timestamp_micros_as_option("invalid");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_str_to_timestamp_micros_as_option_date_string() {
        let result = parse_str_to_timestamp_micros_as_option("2021-01-01T00:00:00Z");
        assert!(result.is_some());
        assert_eq!(result.unwrap(), 1609459200000000);
    }

    #[test]
    fn test_parse_i64_to_timestamp_micros_zero() {
        let now = now_micros();
        let result = parse_i64_to_timestamp_micros(0);
        // Result should be close to now (within a few seconds)
        assert!(result > 0);
        assert!((result - now).abs() < 5000000); // Within 5 seconds
    }

    #[test]
    fn test_parse_i64_to_timestamp_micros_negative() {
        // Negative timestamps should be treated as seconds
        let result = parse_i64_to_timestamp_micros(-1);
        assert_eq!(result, -1_000_000);
    }

    #[test]
    fn test_parse_milliseconds_edge_cases() {
        assert_eq!(parse_milliseconds("1ms").unwrap(), 1);
        assert_eq!(parse_milliseconds("100ms").unwrap(), 100);
        assert_eq!(parse_milliseconds("1s1ms").unwrap(), 1001);
        assert_eq!(parse_milliseconds("1m1s1ms").unwrap(), 61001);
    }

    #[test]
    fn test_parse_milliseconds_complex() {
        assert_eq!(parse_milliseconds("2d3h4m5s").unwrap(), 183845000);
        assert_eq!(parse_milliseconds("1w1d").unwrap(), 691200000);
        assert_eq!(parse_milliseconds("1y1w1d").unwrap(), 32227200000);
    }

    #[test]
    fn test_now_micros() {
        let t1 = now_micros();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let t2 = now_micros();
        assert!(t2 > t1);
        assert!(t2 - t1 >= 10000); // At least 10ms difference
    }
}
