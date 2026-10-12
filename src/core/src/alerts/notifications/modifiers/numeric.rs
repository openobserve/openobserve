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

pub(super) const DECIMAL_PREFIXES: [&str; 8] = ["k", "M", "G", "T", "P", "E", "Z", "Y"];
pub(super) const FRACTIONAL_PREFIXES: [&str; 8] = ["m", "u", "n", "p", "f", "a", "z", "y"];
pub(super) const BINARY_PREFIXES: [&str; 8] = ["ki", "Mi", "Gi", "Ti", "Pi", "Ei", "Zi", "Yi"];

pub(super) fn humanize(mut value: f64, base: f64, prefixes: &[&str], fractional: bool) -> String {
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

pub(super) fn significant(value: f64) -> String {
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
