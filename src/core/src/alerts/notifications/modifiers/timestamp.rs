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

use std::fmt::Write;

pub(super) fn format(input: &str, args: &str, micros: bool) -> Option<String> {
    let args = if args.is_empty() {
        Vec::new()
    } else {
        let args = args.strip_prefix('(')?.strip_suffix(')')?;
        let args: Vec<String> = serde_json::from_str(&format!("[{args}]")).ok()?;
        if args.is_empty() || args.len() > 2 {
            return None;
        }
        args
    };
    let timestamp = timestamp_value(input, micros)?;
    let reference_micros = timestamp.timestamp_micros();
    let timezone = args.get(1).map(String::as_str).unwrap_or("UTC");
    if !valid_timezone(timezone) {
        return None;
    }
    let offset = config::utils::time::parse_timezone_to_offset_at(timezone, reference_micros)?;
    timestamp
        .naive_utc()
        .checked_add_signed(chrono::Duration::seconds(offset))?;
    let offset = chrono::FixedOffset::east_opt(i32::try_from(offset).ok()?)?;
    let timestamp = timestamp.with_timezone(&offset);
    let Some(format) = args.first() else {
        return Some(timestamp.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true));
    };
    let items = chrono::format::StrftimeItems::new(format).collect::<Vec<_>>();
    if items
        .iter()
        .any(|item| matches!(item, chrono::format::Item::Error))
    {
        return None;
    }
    let mut output = String::new();
    write!(&mut output, "{}", timestamp.format_with_items(items.iter())).ok()?;
    Some(output)
}

fn timestamp_value(input: &str, micros: bool) -> Option<chrono::DateTime<chrono::Utc>> {
    if let Ok(integer) = input.parse::<i64>() {
        return if micros {
            chrono::DateTime::from_timestamp_micros(integer)
        } else {
            chrono::DateTime::from_timestamp(integer, 0)
        };
    }
    if input.contains('.') && !input.contains(['e', 'E']) {
        return decimal_timestamp(input, micros);
    }
    let value = input.parse::<f64>().ok()?;
    let value = if micros { value / 1_000_000.0 } else { value };
    if !value.is_finite() || value.abs() >= i64::MAX as f64 {
        return None;
    }
    let seconds = value.floor();
    let nanos = ((value - seconds) * 1_000_000_000.0).round() as u32;
    let (seconds, nanos) = if nanos == 1_000_000_000 {
        (seconds as i64 + 1, 0)
    } else {
        (seconds as i64, nanos)
    };
    chrono::DateTime::from_timestamp(seconds, nanos)
}

fn decimal_timestamp(input: &str, micros: bool) -> Option<chrono::DateTime<chrono::Utc>> {
    let negative = input.starts_with('-');
    let unsigned = input.strip_prefix(['-', '+']).unwrap_or(input);
    let (whole, fraction) = unsigned.split_once('.')?;
    if (whole.is_empty() && fraction.is_empty())
        || !whole.bytes().all(|c| c.is_ascii_digit())
        || !fraction.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let whole = if whole.is_empty() {
        0
    } else {
        whole.parse::<i128>().ok()?
    };
    let precision = if micros { 3 } else { 9 };
    let fraction = &fraction[..fraction.len().min(precision)];
    let fractional = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<i128>().ok()?
    };
    let scale = 10_i128.pow(precision as u32);
    let nanos = whole
        .checked_mul(scale)?
        .checked_add(fractional * 10_i128.pow((precision - fraction.len()) as u32))?;
    let nanos = if negative { -nanos } else { nanos };
    chrono::DateTime::from_timestamp(
        i64::try_from(nanos.div_euclid(1_000_000_000)).ok()?,
        nanos.rem_euclid(1_000_000_000) as u32,
    )
}

fn valid_timezone(timezone: &str) -> bool {
    // The shared parser aliases CST to China Standard Time, which is ambiguous for users.
    if timezone.is_empty() || timezone.eq_ignore_ascii_case("cst") {
        return false;
    }
    if !timezone.starts_with(['+', '-']) {
        return true;
    }
    let bytes = timezone.as_bytes();
    bytes.len() == 6
        && bytes[3] == b':'
        && [bytes[1], bytes[2], bytes[4], bytes[5]]
            .iter()
            .all(u8::is_ascii_digit)
        && &timezone[1..3] < "24"
        && &timezone[4..6] < "60"
}

#[cfg(test)]
mod tests {
    use super::super::format_modifier;

    #[test]
    fn timestamp_units_precision_timezones_and_formats() {
        for (input, function, expected) in [
            ("0", "formatTimestamp", "1970-01-01T00:00:00Z"),
            ("-0.1", "formatTimestamp", "1969-12-31T23:59:59.900Z"),
            (
                "1700000000.123456",
                "formatTimestamp",
                "2023-11-14T22:13:20.123456Z",
            ),
            (
                "1700000000123456",
                "formatTimestampMicros",
                "2023-11-14T22:13:20.123456Z",
            ),
            ("-1", "formatTimestampMicros", "1969-12-31T23:59:59.999999Z"),
            (
                "1.5",
                "formatTimestampMicros",
                "1970-01-01T00:00:00.000001500Z",
            ),
            (
                "0",
                r#"formatTimestamp("%Y-%m-%d %H:%M:%S %:z", "Asia/Shanghai")"#,
                "1970-01-01 08:00:00 +08:00",
            ),
            (
                "0",
                r#"formatTimestamp("%Y%m%d%H%M%S%z", "-07:30")"#,
                "19691231163000-0730",
            ),
            (
                "1704067200",
                r#"formatTimestamp("%H:%M %:z", "America/New_York")"#,
                "19:00 -05:00",
            ),
            (
                "1719792000",
                r#"formatTimestamp("%H:%M %:z", "America/New_York")"#,
                "20:00 -04:00",
            ),
            ("0", r#"formatTimestamp("%Y")"#, "1970"),
        ] {
            assert_eq!(
                format_modifier(input, function).as_deref(),
                Some(expected),
                "{function}({input})"
            );
        }
    }

    #[test]
    fn timestamp_invalid_inputs_and_arguments() {
        for input in [
            "NaN",
            "+Inf",
            "-Inf",
            "oops",
            "1e100",
            "9223372036854775807",
            " 0 ",
            ".",
            "+.",
        ] {
            assert_eq!(format_modifier(input, "formatTimestamp"), None);
            assert_eq!(format_modifier(input, "formatTimestampMicros"), None);
        }
        let max_timestamp = chrono::NaiveDate::MAX
            .and_hms_opt(23, 59, 59)
            .unwrap()
            .and_utc()
            .timestamp()
            .to_string();
        assert_eq!(
            format_modifier(&max_timestamp, r#"formatTimestamp("%Y", "+23:59")"#),
            None
        );
        for function in [
            "formatTimestamp()",
            "formatTimestampExtra",
            "formatTimestamp(1)",
            r#"formatTimestamp("%Q")"#,
            r#"formatTimestamp("%Y", "Unknown/Zone")"#,
            r#"formatTimestamp("%Y", "CST")"#,
            r#"formatTimestamp("%Y", "cst")"#,
            r#"formatTimestamp("%Y", "+08:99")"#,
            r#"formatTimestamp("%Y", "+8")"#,
            r#"formatTimestamp("%Y", "")"#,
            r#"formatTimestamp("%Y", "UTC", "extra")"#,
            r#"formatTimestamp("%Y", "UTC")suffix"#,
        ] {
            assert_eq!(format_modifier("0", function), None, "{function}");
        }
    }
}
