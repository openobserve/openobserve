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

use super::step;

/// True when every step is equal, so the body stays empty.
pub(crate) fn fits(ts: &[i64]) -> bool {
    let first = step(ts[0], ts[ts.len().min(2) - 1]);
    ts.windows(2).all(|w| step(w[0], w[1]) == first)
}

/// Appends `rows` evenly spaced timestamps from `min` to `max`.
pub(crate) fn decode(rows: usize, min: i64, max: i64, ts: &mut Vec<i64>) {
    if rows == 1 {
        ts.push(min);
        return;
    }
    let each = step(min, max) / (rows as u64 - 1);
    ts.extend((0..rows as u64).map(|i| min.wrapping_add((each * i) as i64)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(ts: &[i64]) {
        assert!(fits(ts));
        let mut out = Vec::new();
        decode(ts.len(), ts[0], ts[ts.len() - 1], &mut out);
        assert_eq!(out.as_slice(), ts);
    }

    #[test]
    fn evenly_spaced_timestamps_round_trip() {
        roundtrip(&[42]);
        roundtrip(&[-5, 1_000]);
        roundtrip(&[i64::MIN, i64::MAX]);
        roundtrip(&[7, 7, 7, 7]);
        roundtrip(
            &(0..8192)
                .map(|i| 1_790_000_000_000_000 + i * 15_000_000)
                .collect::<Vec<_>>(),
        );
        let span = u64::MAX / 3;
        roundtrip(
            &(0..4u64)
                .map(|i| (i64::MIN as u64).wrapping_add(i * span) as i64)
                .collect::<Vec<_>>(),
        );
    }

    #[test]
    fn uneven_steps_do_not_fit() {
        assert!(!fits(&[0, 15, 45]));
        assert!(!fits(&[0, 0, 1]));
    }
}
