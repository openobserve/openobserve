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

const DECIMAL_PREFIXES: [&str; 8] = ["k", "M", "G", "T", "P", "E", "Z", "Y"];
const FRACTIONAL_PREFIXES: [&str; 8] = ["m", "u", "n", "p", "f", "a", "z", "y"];
const BINARY_PREFIXES: [&str; 8] = ["ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi", "Yi"];

pub(crate) struct PreparedTemplate {
    pub(crate) template: String,
    replacements: Vec<(String, String)>,
}

impl PreparedTemplate {
    pub(crate) fn plain(template: String) -> Self {
        Self {
            template,
            replacements: Vec::new(),
        }
    }

    pub(crate) fn finish(&self, mut rendered: String) -> String {
        for (marker, output) in &self.replacements {
            rendered = rendered.replace(marker, output);
        }
        rendered
    }
}

pub(crate) fn prepare_modifiers(
    tpl: &str,
    mut lookup: impl FnMut(&str) -> Option<String>,
    mut literal_field_exists: impl FnMut(&str) -> bool,
    is_email: bool,
) -> PreparedTemplate {
    let mut prepared = PreparedTemplate::plain(String::with_capacity(tpl.len()));
    let mut cursor = 0;
    while let Some((start, end)) = next_placeholder(tpl, cursor) {
        prepared.template.push_str(&tpl[cursor..start]);
        let expression = &tpl[start + 1..end - 1];
        let replacement = expression.split_once('|').and_then(|(field, function)| {
            if field.is_empty() || tpl[..start].ends_with('{') || literal_field_exists(expression) {
                return None;
            }
            format_modifier(&lookup(field)?, function)
        });
        if let Some(output) = replacement {
            // Opaque markers keep formatted braces inert until substitution ends.
            let marker = format!("\u{e000}{:032x}\u{e001}", rand::random::<u128>());
            let output = if is_email {
                output
            } else {
                super::custom::format_variable_value(output)
            };
            prepared.template.push_str(&marker);
            prepared.replacements.push((marker, output));
        } else {
            prepared.template.push_str(&tpl[start..end]);
        }
        cursor = end;
    }
    prepared.template.push_str(&tpl[cursor..]);
    prepared
}

fn next_placeholder(tpl: &str, cursor: usize) -> Option<(usize, usize)> {
    let mut start = None;
    let mut modifier = false;
    let mut quoted = false;
    let mut escaped = false;
    for (index, ch) in tpl[cursor..].char_indices() {
        let index = cursor + index;
        if quoted {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        match ch {
            '{' => {
                start = Some(index);
                modifier = false;
            }
            '|' if start.is_some() => modifier = true,
            '"' if modifier => quoted = true,
            '}' => {
                if let Some(start) = start {
                    return Some((start, index + 1));
                }
            }
            _ => {}
        }
    }
    None
}

fn format_modifier(input: &str, function: &str) -> Option<String> {
    if let Some(args) = function.strip_prefix("formatTimestampMicros") {
        return format_timestamp(input, args, true);
    }
    if let Some(args) = function.strip_prefix("formatTimestamp") {
        return format_timestamp(input, args, false);
    }
    if function == "humanSize" {
        let value = input.parse::<f64>().ok()?;
        if !value.is_finite() {
            return Some(significant(value));
        }
        let mut value = value;
        let mut unit = "B";
        for next in ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"] {
            if value.abs() < 1024.0 {
                break;
            }
            value /= 1024.0;
            unit = next;
        }
        return Some(format!("{} {unit}", significant(value)));
    }
    format_number(input, function)
}

fn format_timestamp(input: &str, args: &str, micros: bool) -> Option<String> {
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
    if timezone.is_empty() || !valid_timezone_offset(timezone) {
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
    use std::fmt::Write;
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

fn valid_timezone_offset(timezone: &str) -> bool {
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

fn format_number(input: &str, function: &str) -> Option<String> {
    if !matches!(
        function,
        "humanize" | "humanize1024" | "humanizeDuration" | "humanizePercentage"
    ) {
        return None;
    }
    let value = input.parse::<f64>().ok()?;
    Some(match function {
        "humanize" => humanize(value, 1000.0, &DECIMAL_PREFIXES, true),
        "humanize1024" => humanize(value, 1024.0, &BINARY_PREFIXES, false),
        "humanizeDuration" => humanize_duration(value),
        "humanizePercentage" => format!("{}%", significant(value * 100.0)),
        _ => unreachable!(),
    })
}

fn humanize(mut value: f64, base: f64, prefixes: &[&str], fractional: bool) -> String {
    if value == 0.0 || !value.is_finite() {
        return significant(value);
    }
    let mut prefix = "";
    if fractional && value.abs() < 1.0 {
        for next in FRACTIONAL_PREFIXES {
            if value.abs() >= 1.0 {
                break;
            }
            prefix = next;
            value *= 1000.0;
        }
    } else {
        for next in prefixes {
            if value.abs() < base {
                break;
            }
            prefix = next;
            value /= base;
        }
    }
    format!("{}{prefix}", significant(value))
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

fn significant(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-Inf"
        } else {
            "+Inf"
        }
        .into();
    }
    let scientific = format!("{value:.3e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let exponent = exponent.parse::<i32>().unwrap();
    if !(-4..4).contains(&exponent) {
        format!("{}e{exponent:+03}", trim_fraction(mantissa))
    } else {
        trim_fraction(&format!("{:.*}", (3 - exponent) as usize, value)).to_string()
    }
}

fn trim_fraction(value: &str) -> &str {
    if value.contains('.') {
        value.trim_end_matches('0').trim_end_matches('.')
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render_modifiers(tpl: &str, lookup: impl FnMut(&str) -> Option<String>) -> String {
        let lookup = std::cell::RefCell::new(lookup);
        let prepared = prepare_modifiers(
            tpl,
            |field| lookup.borrow_mut()(field),
            |field| lookup.borrow_mut()(field).is_some(),
            true,
        );
        prepared.finish(prepared.template.clone())
    }

    #[test]
    fn prometheus_numeric_formats() {
        for (input, function, expected) in [
            ("1234567", "humanize", "1.235M"),
            ("-1234567", "humanize", "-1.235M"),
            ("0.00000123", "humanize", "1.23u"),
            ("0", "humanize", "0"),
            ("1048576", "humanize1024", "1Mi"),
            ("-1536", "humanize1024", "-1.5ki"),
            ("0.000012345", "humanize1024", "1.234e-05"),
            ("0.9123", "humanizePercentage", "91.23%"),
            ("-0.25", "humanizePercentage", "-25%"),
            ("0", "humanizePercentage", "0%"),
            ("123.4567", "humanizePercentage", "1.235e+04%"),
            ("0.000000001", "humanizeDuration", "1ns"),
            ("0.12345", "humanizeDuration", "123.5ms"),
            ("0", "humanizeDuration", "0s"),
            ("-0", "humanizeDuration", "-0s"),
            ("12.3456", "humanizeDuration", "12.35s"),
            ("61.9", "humanizeDuration", "1m 1s"),
            ("-3661.9", "humanizeDuration", "-1h 1m 1s"),
            ("90061", "humanizeDuration", "1d 1h 1m 1s"),
            ("1e100", "humanizeDuration", "1e+100s"),
            ("1e308", "humanizePercentage", "+Inf%"),
            ("1e-30", "humanize", "1e-06y"),
            ("1e30", "humanize", "1e+06Y"),
        ] {
            assert_eq!(
                format_number(input, function).as_deref(),
                Some(expected),
                "{function}({input})"
            );
        }
    }

    #[test]
    fn special_and_invalid_numbers() {
        for function in [
            "humanize",
            "humanize1024",
            "humanizeDuration",
            "humanizePercentage",
        ] {
            for value in ["NaN", "+Inf", "-Inf"] {
                let expected = if function == "humanizePercentage" {
                    format!("{value}%")
                } else {
                    value.to_string()
                };
                assert_eq!(format_number(value, function), Some(expected));
            }
            for invalid in ["", "abc", "1, 2", "null", "true", " 12 "] {
                assert_eq!(format_number(invalid, function), None);
            }
        }
    }

    #[test]
    fn parser_preserves_unsupported_and_literal_fields() {
        let tpl = "{v} {v|unknown} {missing|humanize} {v|} {|humanize} {v|humanize|humanize} {v|humanize:2} {{v|humanize}} {v|humanize";
        assert_eq!(
            render_modifiers(tpl, |field| (field == "v").then(|| "1200".into())),
            tpl
        );
        assert_eq!(
            render_modifiers("{v|humanize}", |field| match field {
                "v" => Some("1200".into()),
                "v|humanize" => Some("literal".into()),
                _ => None,
            }),
            "{v|humanize}"
        );
        assert_eq!(
            render_modifiers(r#"{"value":"{v|humanize}"}"#, |field| (field == "v")
                .then(|| "1200".into())),
            r#"{"value":"1.2k"}"#
        );
    }

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
            r#"formatTimestamp("%Y", "+08:99")"#,
            r#"formatTimestamp("%Y", "+8")"#,
            r#"formatTimestamp("%Y", "")"#,
            r#"formatTimestamp("%Y", "UTC", "extra")"#,
            r#"formatTimestamp("%Y", "UTC")suffix"#,
        ] {
            assert_eq!(format_modifier("0", function), None, "{function}");
        }
    }

    #[test]
    fn human_size_bytes() {
        for (input, expected) in [
            ("0", "0 B"),
            ("1", "1 B"),
            ("1536", "1.5 KiB"),
            ("1048576", "1 MiB"),
            ("-1536", "-1.5 KiB"),
            ("NaN", "NaN"),
            ("+Inf", "+Inf"),
            ("-Inf", "-Inf"),
        ] {
            assert_eq!(
                format_modifier(input, "humanSize").as_deref(),
                Some(expected)
            );
        }
        assert_eq!(format_modifier("bad", "humanSize"), None);
        assert_eq!(format_modifier("1536", "humanSize()"), None);
    }

    #[test]
    fn quoted_format_braces_stay_inert() {
        let tpl = r#"{t|formatTimestamp("{alert_count} %Y \"quoted\"", "UTC")}"#;
        let prepared = prepare_modifiers(
            tpl,
            |field| (field == "t").then(|| "0".into()),
            |_| false,
            false,
        );
        let plain = prepared.template.replace("{alert_count}", "99");
        assert_eq!(prepared.finish(plain), r#"{alert_count} 1970 \"quoted\""#);
    }
}
