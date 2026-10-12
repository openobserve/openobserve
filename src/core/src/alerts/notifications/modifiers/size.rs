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
    let mut value = input.parse::<f64>().ok()?;
    if !value.is_finite() {
        return Some(significant(value));
    }
    let mut unit = "B";
    for next in ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"] {
        if value.abs() < 1024.0 {
            break;
        }
        value /= 1024.0;
        unit = next;
    }
    Some(format!("{} {unit}", significant(value)))
}

#[cfg(test)]
mod tests {
    use super::super::format_modifier;

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
}
