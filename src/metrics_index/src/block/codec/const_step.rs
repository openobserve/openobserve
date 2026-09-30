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

//! ConstStep: evenly spaced timestamps, rebuilt from the directory's min, max and row count.

use anyhow::{Result, ensure};

use super::step;

/// True when every step is equal, so the body stays empty.
pub(crate) fn fits(ts: &[i64]) -> bool {
    let first = step(ts[0], ts[ts.len().min(2) - 1]);
    ts.windows(2).all(|w| step(w[0], w[1]) == first)
}

/// Appends `rows` timestamps from `min` to `max` and returns the last one.
pub(crate) fn decode(rows: usize, min: i64, max: i64, ts: &mut Vec<i64>) -> Result<i64> {
    if rows == 1 {
        ts.push(min);
        return Ok(min);
    }
    let span = step(min, max);
    let steps = rows as u64 - 1;
    ensure!(
        span.is_multiple_of(steps),
        "inexact constant timestamp step"
    );
    let each = span / steps;
    ts.extend((0..rows as u64).map(|i| min.wrapping_add((each * i) as i64)));
    Ok(max)
}
