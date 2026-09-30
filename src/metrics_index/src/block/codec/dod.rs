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

//! Dod: GCD-scaled timestamp steps as a first step and zigzag second differences, SparsePacked.

use anyhow::Result;

use super::{
    next_timestamp,
    pack::{get_sparse, put_sparse},
    read_divisor,
};
use crate::block::compact::{put_varint, unzigzag, zigzag};

/// Writes the steps `quotients * divisor`, as returned by `scaled_steps`.
pub(crate) fn encode(divisor: u64, quotients: &[u64], out: &mut Vec<u8>) {
    put_varint(out, divisor);
    put_sparse(
        std::iter::once(quotients[0]).chain(
            quotients
                .windows(2)
                .map(|w| zigzag(w[1].wrapping_sub(w[0]) as i64)),
        ),
        out,
    );
}

/// Appends `rows` timestamps starting at `min` and returns the last one.
pub(crate) fn decode(
    body: &[u8],
    pos: &mut usize,
    rows: usize,
    min: i64,
    seq: &mut Vec<u64>,
    ts: &mut Vec<i64>,
) -> Result<i64> {
    let divisor = read_divisor(body, pos)?;
    get_sparse(body, pos, rows - 1, seq)?;
    ts.push(min);
    let mut previous = min;
    let mut quotient = 0u64;
    for (k, v) in seq.iter().enumerate() {
        quotient = if k == 0 {
            *v
        } else {
            quotient.wrapping_add(unzigzag(*v) as u64)
        };
        previous = next_timestamp(previous, quotient.wrapping_mul(divisor))?;
        ts.push(previous);
    }
    Ok(previous)
}
