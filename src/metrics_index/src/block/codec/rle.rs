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

//! Rle: GCD-scaled timestamp steps as `(quotient, run)` varint pairs.

use anyhow::{Result, ensure};

use super::{next_timestamp, read_divisor};
use crate::block::compact::{get_varint, put_varint};

/// Byte length [`encode`] would write, so the caller can compare it without encoding.
pub(crate) fn encoded_len(divisor: u64, quotients: &[u64]) -> usize {
    let mut len = varint_len(divisor);
    for_each_run(quotients, |quotient, run| {
        len += varint_len(quotient) + varint_len(run)
    });
    len
}

/// Writes the steps `quotients * divisor`, as returned by `scaled_steps`.
pub(crate) fn encode(divisor: u64, quotients: &[u64], out: &mut Vec<u8>) {
    put_varint(out, divisor);
    for_each_run(quotients, |quotient, run| {
        put_varint(out, quotient);
        put_varint(out, run);
    });
}

/// Appends `rows` timestamps starting at `min` and returns the last one.
pub(crate) fn decode(
    body: &[u8],
    pos: &mut usize,
    rows: usize,
    min: i64,
    ts: &mut Vec<i64>,
) -> Result<i64> {
    let divisor = read_divisor(body, pos)?;
    ts.push(min);
    let mut previous = min;
    let mut left = rows - 1;
    while left > 0 {
        let step = get_varint(body, pos)?.wrapping_mul(divisor);
        let run = get_varint(body, pos)?;
        ensure!(run > 0 && run <= left as u64, "invalid timestamp run");
        for _ in 0..run {
            previous = next_timestamp(previous, step)?;
            ts.push(previous);
        }
        left -= run as usize;
    }
    Ok(previous)
}

fn for_each_run(quotients: &[u64], mut f: impl FnMut(u64, u64)) {
    let mut run = (quotients[0], 0u64);
    for quotient in quotients {
        if *quotient != run.0 {
            f(run.0, run.1);
            run = (*quotient, 0);
        }
        run.1 += 1;
    }
    f(run.0, run.1);
}

fn varint_len(value: u64) -> usize {
    (64 - (value | 1).leading_zeros() as usize).div_ceil(7)
}
