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

use super::numeric::{BINARY_PREFIXES, DECIMAL_PREFIXES, humanize};

pub(super) fn format(input: &str, binary: bool) -> Option<String> {
    let value = input.parse::<f64>().ok()?;
    Some(if binary {
        humanize(value, 1024.0, &BINARY_PREFIXES, false)
    } else {
        humanize(value, 1000.0, &DECIMAL_PREFIXES, true)
    })
}

#[cfg(test)]
mod tests {
    use super::super::format_modifier;

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
            ("1e-30", "humanize", "1e-06y"),
            ("1e30", "humanize", "1e+06Y"),
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
        for function in ["humanize", "humanize1024"] {
            for value in ["NaN", "+Inf", "-Inf"] {
                assert_eq!(format_modifier(value, function), Some(value.to_string()));
            }
            for invalid in ["", "abc", "1, 2", "null", "true", " 12 "] {
                assert_eq!(format_modifier(invalid, function), None);
            }
        }
    }
}
