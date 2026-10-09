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

use super::numeric::{DECIMAL_PREFIXES, humanize, significant};

pub(super) fn format(input: &str) -> Option<String> {
    Some(humanize_duration(input.parse::<f64>().ok()?))
}

fn humanize_duration(value: f64) -> String {
    if !value.is_finite() {
        return significant(value);
    }
    if value.abs() < 1.0 {
        return format!("{}s", humanize(value, 1000.0, &DECIMAL_PREFIXES, true));
    }
    // Avoid an overflowing integer conversion for durations outside Prometheus's int64 range.
    if value.abs() >= i64::MAX as f64 {
        return format!("{}s", significant(value));
    }
    let seconds = value.abs() as i64;
    let sign = if value < 0.0 { "-" } else { "" };
    let (days, hours, minutes, seconds) = (
        seconds / 86400,
        seconds / 3600 % 24,
        seconds / 60 % 60,
        seconds % 60,
    );
    if days != 0 {
        format!("{sign}{days}d {hours}h {minutes}m {seconds}s")
    } else if hours != 0 {
        format!("{sign}{hours}h {minutes}m {seconds}s")
    } else if minutes != 0 {
        format!("{sign}{minutes}m {seconds}s")
    } else {
        format!("{}s", significant(value))
    }
}

#[cfg(test)]
mod tests {
    use super::super::format_modifier;

    #[test]
    fn prometheus_numeric_formats() {
        for (input, function, expected) in [
            ("0.000000001", "humanizeDuration", "1ns"),
            ("0.12345", "humanizeDuration", "123.5ms"),
            ("0", "humanizeDuration", "0s"),
            ("-0", "humanizeDuration", "-0s"),
            ("12.3456", "humanizeDuration", "12.35s"),
            ("61.9", "humanizeDuration", "1m 1s"),
            ("-3661.9", "humanizeDuration", "-1h 1m 1s"),
            ("90061", "humanizeDuration", "1d 1h 1m 1s"),
            ("1e100", "humanizeDuration", "1e+100s"),
        ] {
            assert_eq!(
                format_modifier(input, function).as_deref(),
                Some(expected),
                "{function}({input})"
            );
        }
    }

    #[test]
    fn special_and_invalid_numbers() {
        for function in ["humanizeDuration"] {
            for value in ["NaN", "+Inf", "-Inf"] {
                let expected = if function == "humanizePercentage" {
                    format!("{value}%")
                } else {
                    value.to_string()
                };
                assert_eq!(format_modifier(value, function), Some(expected));
            }
            for invalid in ["", "abc", "1, 2", "null", "true", " 12 "] {
                assert_eq!(format_modifier(invalid, function), None);
            }
        }
    }
}
