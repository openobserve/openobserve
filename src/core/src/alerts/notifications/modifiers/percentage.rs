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

use super::numeric::significant;

pub(super) fn format(input: &str) -> Option<String> {
    Some(format!(
        "{}%",
        significant(input.parse::<f64>().ok()? * 100.0)
    ))
}

#[cfg(test)]
mod tests {
    use super::super::format_modifier;

    #[test]
    fn prometheus_numeric_formats() {
        for (input, function, expected) in [
            ("0.9123", "humanizePercentage", "91.23%"),
            ("-0.25", "humanizePercentage", "-25%"),
            ("0", "humanizePercentage", "0%"),
            ("123.4567", "humanizePercentage", "1.235e+04%"),
            ("1e308", "humanizePercentage", "+Inf%"),
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
        for function in ["humanizePercentage"] {
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
