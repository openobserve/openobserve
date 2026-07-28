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

/// Escapes a value that is embedded in a single-quoted SQL `LIKE` pattern.
///
/// This does two jobs at once: it escapes the `LIKE` metacharacters (`\`, `%`,
/// `_`) so they match literally, and it doubles `'` so the result is also safe
/// to interpolate into a single-quoted string literal. Callers must therefore
/// not apply their own quote doubling on top of it.
pub fn escape_like(input: impl AsRef<str>) -> String {
    let input = input.as_ref();
    let mut escaped = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' => escaped.push_str(r"\\"),
            '%' => escaped.push_str(r"\%"),
            '_' => escaped.push_str(r"\_"),
            '\'' => escaped.push_str("''"),
            _ => escaped.push(c),
        }
    }
    escaped
}
