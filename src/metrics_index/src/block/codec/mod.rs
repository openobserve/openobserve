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

//! Sample encodings: each file is one encoding, and a column picks among its own candidates.

pub(super) mod alp;
pub(super) mod const_f64;
pub(super) mod const_int;
pub(super) mod const_step;
pub(super) mod dod;
pub(super) mod int_delta;
mod pack;
pub(super) mod rle;
pub(super) mod xor;

use anyhow::{Result, bail};

const EXACT_LIMIT: f64 = 9_007_199_254_740_992.0;

/// Encoding ids shared by both sections: a tag holds the timestamp id in its low nibble.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Codec {
    ConstStep = 0,
    Dod = 1,
    Rle = 2,
    ConstInt = 3,
    ConstF64 = 4,
    IntDelta = 5,
    Alp = 6,
    Xor = 7,
}

impl Codec {
    pub(super) fn tag(timestamps: Self, values: Self) -> u8 {
        timestamps as u8 | ((values as u8) << 4)
    }

    pub(super) fn from_id(id: u8) -> Result<Self> {
        Ok(match id {
            0 => Self::ConstStep,
            1 => Self::Dod,
            2 => Self::Rle,
            3 => Self::ConstInt,
            4 => Self::ConstF64,
            5 => Self::IntDelta,
            6 => Self::Alp,
            7 => Self::Xor,
            _ => bail!("reserved sample encoding id {id}"),
        })
    }
}

/// Integer value when `b` is a finite whole f64 that converts back to the same bits.
pub(super) fn exact_int(b: u64) -> Option<i64> {
    let v = f64::from_bits(b);
    if !(v.is_finite() && v.abs() <= EXACT_LIMIT && v.trunc() == v) {
        return None;
    }
    let i = v as i64;
    ((i as f64).to_bits() == b).then_some(i)
}

/// Replaces `quotients` with the timestamp steps divided by their GCD and returns the GCD.
pub(super) fn scaled_steps(ts: &[i64], quotients: &mut Vec<u64>) -> u64 {
    quotients.clear();
    quotients.extend(ts.windows(2).map(|w| step(w[0], w[1])));
    let divisor = quotients
        .iter()
        .fold(0, |g, d| if g != 0 && d % g == 0 { g } else { gcd(g, *d) });
    if divisor > 1 {
        quotients.iter_mut().for_each(|q| *q /= divisor);
    }
    divisor
}

/// Timestamps are non-decreasing, so their true difference always fits in a u64.
#[inline]
fn step(previous: i64, next: i64) -> u64 {
    (next as u64).wrapping_sub(previous as u64)
}

fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

#[inline]
fn next_timestamp(previous: i64, step: u64) -> i64 {
    previous.wrapping_add(step as i64)
}

/// Deterministic pseudo-random sequence for codec tests.
#[cfg(test)]
fn random(seed: u64) -> impl Iterator<Item = u64> {
    std::iter::successors(Some(seed), |x| {
        Some(
            x.wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407),
        )
    })
    .map(|x| (x ^ (x >> 29)).wrapping_mul(0xbf58_476d_1ce4_e5b9) ^ (x >> 32))
}

/// Asserts that `decode` fails on every strict prefix of `body`.
#[cfg(test)]
fn assert_truncations_fail(body: &[u8], decode: impl Fn(&[u8]) -> Result<()>) {
    for len in 0..body.len() {
        assert!(
            decode(&body[..len]).is_err(),
            "prefix of {len} bytes decoded"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_int_rejects_negative_zero_fractions_and_out_of_range_values() {
        assert_eq!(exact_int(7f64.to_bits()), Some(7));
        assert_eq!(exact_int((-EXACT_LIMIT).to_bits()), Some(-(1 << 53)));
        for value in [-0.0, 0.5, EXACT_LIMIT + 2.0, f64::NAN, f64::INFINITY] {
            assert_eq!(exact_int(value.to_bits()), None);
        }
    }

    #[test]
    fn ids_round_trip_and_reserved_ids_fail() {
        for id in 0..8 {
            assert_eq!(Codec::from_id(id).unwrap() as u8, id);
        }
        assert!((8..16).all(|id| Codec::from_id(id).is_err()));
        assert_eq!(Codec::tag(Codec::Rle, Codec::Xor), 0x72);
    }
}
