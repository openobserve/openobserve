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

#[cfg(test)]
mod tests {
    use super::{
        super::{assert_truncations_fail, random, scaled_steps},
        *,
    };

    const BASE: i64 = 1_790_000_000_000_000;
    const STEP: i64 = 15_000_000;

    fn roundtrip(ts: &[i64]) -> Vec<u8> {
        let mut quotients = Vec::new();
        let divisor = scaled_steps(ts, &mut quotients);
        let mut body = Vec::new();
        encode(divisor, &quotients, &mut body);
        let (mut pos, mut seq, mut out) = (0, Vec::new(), Vec::new());
        let last = decode(&body, &mut pos, ts.len(), ts[0], &mut seq, &mut out).unwrap();
        assert_eq!(
            (out.as_slice(), last, pos),
            (ts, ts[ts.len() - 1], body.len())
        );
        assert_truncations_fail(&body, |bytes| {
            decode(
                bytes,
                &mut 0,
                ts.len(),
                ts[0],
                &mut Vec::new(),
                &mut Vec::new(),
            )
            .map(|_| ())
        });
        body
    }

    fn get_divisor(body: &[u8]) -> u64 {
        crate::block::compact::get_varint(body, &mut 0).unwrap()
    }

    fn jitter(n: i64, unit: i64, seed: u64) -> Vec<i64> {
        (0..n)
            .zip(random(seed))
            .map(|(i, r)| BASE + i * STEP + (r % 1000) as i64 * unit)
            .collect()
    }

    #[test]
    fn irregular_timestamps_round_trip() {
        roundtrip(&[0, 10, 30]);
        roundtrip(&[i64::MIN, i64::MIN + 1, -1, 0, 0, i64::MAX]);
        roundtrip(&[0, 0, 15, 15, 30, 60, 60, 60, 75]);
        roundtrip(
            &(0..300)
                .map(|i| BASE + (i + i / 7) * STEP)
                .collect::<Vec<_>>(),
        );
        roundtrip(&jitter(300, 1, 2));
        let millis = roundtrip(&jitter(200, 1000, 1));
        assert_eq!(get_divisor(&millis), 1000);
    }

    #[test]
    fn zero_divisor_and_decreasing_steps_fail() {
        let ts = [0, 10, 30];
        let mut body = Vec::new();
        encode(0, &[10, 20], &mut body);
        assert!(decode(&body, &mut 0, 3, 0, &mut Vec::new(), &mut Vec::new()).is_err());
        body.clear();
        encode(1, &[10, u64::MAX - 9], &mut body);
        let error = decode(&body, &mut 0, 3, ts[0], &mut Vec::new(), &mut Vec::new());
        assert!(error.unwrap_err().to_string().contains("decreased"));
    }
}
