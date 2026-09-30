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

//! Alp: one shared decimal exponent, exceptions for values that do not round-trip, IntDelta
//! mantissas.

use anyhow::{Context, Result, ensure};

use super::{EXACT_LIMIT, int_delta, pack::get_u64};
use crate::block::compact::{get_varint, put_varint};

const MAX_EXPONENT: usize = 18;
const POW10: [f64; MAX_EXPONENT + 1] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16,
    1e17, 1e18,
];
const PROBE: usize = 32;

/// Reusable scratch space for encoding ALP candidates.
#[derive(Default)]
pub(crate) struct Encoder {
    mantissas: Vec<i64>,
    exceptions: Vec<usize>,
}

impl Encoder {
    /// Appends the smaller of the two exponent candidates; false when neither applies.
    pub(crate) fn encode(&mut self, bits: &[u64], out: &mut Vec<u8>) -> bool {
        let Some((a, b)) = exponents(bits) else {
            return false;
        };
        let start = out.len();
        for exponent in [Some(a), (b != a).then_some(b)].into_iter().flatten() {
            let mid = out.len();
            if self.encode_with(bits, exponent, out) && mid > start {
                let len = out.len() - mid;
                if len < mid - start {
                    out.copy_within(mid.., start);
                    out.truncate(start + len);
                } else {
                    out.truncate(mid);
                }
            }
        }
        out.len() > start
    }

    fn encode_with(&mut self, bits: &[u64], exponent: usize, out: &mut Vec<u8>) -> bool {
        self.mantissas.clear();
        self.exceptions.clear();
        let mut last = None;
        for (i, b) in bits.iter().enumerate() {
            match to_decimal(*b, exponent) {
                Some(m) => {
                    if last.is_none() {
                        self.mantissas.fill(m);
                    }
                    last = Some(m);
                    self.mantissas.push(m);
                }
                None => {
                    self.exceptions.push(i);
                    self.mantissas.push(last.unwrap_or_default());
                }
            }
        }
        if last.is_none() {
            return false;
        }
        out.push(exponent as u8);
        put_varint(out, self.exceptions.len() as u64);
        let mut previous = 0;
        for i in &self.exceptions {
            put_varint(out, (i - previous) as u64);
            out.extend_from_slice(&bits[*i].to_le_bytes());
            previous = *i;
        }
        int_delta::encode(&self.mantissas, out);
        true
    }
}

/// Reusable scratch space for decoding exceptions.
#[derive(Default)]
pub(crate) struct Decoder {
    exceptions: Vec<(usize, u64)>,
}

impl Decoder {
    pub(crate) fn decode(
        &mut self,
        body: &[u8],
        pos: &mut usize,
        rows: usize,
        seq: &mut Vec<u64>,
        bits: &mut Vec<u64>,
    ) -> Result<()> {
        let exponent = usize::from(*body.get(*pos).context("truncated ALP exponent")?);
        *pos += 1;
        ensure!(exponent <= MAX_EXPONENT, "invalid ALP exponent");
        let count = get_varint(body, pos)?;
        ensure!(count < rows as u64, "too many ALP exceptions");
        self.exceptions.clear();
        let mut at = 0usize;
        for _ in 0..count {
            let gap = get_varint(body, pos)?;
            at = usize::try_from(gap)
                .ok()
                .and_then(|gap| at.checked_add(gap))
                .filter(|at| *at < rows)
                .context("ALP exception out of range")?;
            self.exceptions.push((at, get_u64(body, pos)?));
        }
        let scale = POW10[exponent];
        int_delta::decode_with(body, pos, rows, seq, bits, |m| (m as f64 / scale).to_bits())?;
        for (i, b) in &self.exceptions {
            bits[*i] = *b;
        }
        Ok(())
    }
}

/// Candidate A covers every convertible value; candidate B is the smallest covering 90%.
fn exponents(bits: &[u64]) -> Option<(usize, usize)> {
    let probe = bits.len().min(PROBE);
    let mut counts = [0usize; MAX_EXPONENT + 1];
    let mut unconvertible = 0;
    for (i, b) in bits.iter().enumerate() {
        match min_exponent(*b) {
            Some(e) => counts[e] += 1,
            None => unconvertible += 1,
        }
        if i + 1 == probe && unconvertible * 2 > probe {
            return None;
        }
    }
    let a = counts.iter().rposition(|c| *c > 0)?;
    let cover = (bits.len() * 9).div_ceil(10);
    if bits.len() - unconvertible < cover {
        return Some((a, a));
    }
    let mut covered = 0;
    let b = counts
        .iter()
        .position(|c| {
            covered += c;
            covered >= cover
        })
        .unwrap_or(a);
    Some((a, b))
}

fn min_exponent(b: u64) -> Option<usize> {
    if !f64::from_bits(b).is_finite() {
        return None;
    }
    (0..=MAX_EXPONENT).find(|e| to_decimal(b, *e).is_some())
}

/// Mantissa `m` when `b` is exactly the f64 the decoder computes as `m / 10^exponent`.
#[inline]
fn to_decimal(b: u64, exponent: usize) -> Option<i64> {
    let v = f64::from_bits(b);
    if !v.is_finite() {
        return None;
    }
    let m = (v * POW10[exponent]).round();
    if m.abs() > EXACT_LIMIT {
        return None;
    }
    let m = m as i64;
    ((m as f64 / POW10[exponent]).to_bits() == b).then_some(m)
}

#[cfg(test)]
mod tests {
    use super::{
        super::{assert_truncations_fail, random},
        *,
    };

    const STALE_NAN: u64 = 0x7ff0_0000_0000_0002;

    fn floats(values: &[f64]) -> Vec<u64> {
        values.iter().map(|v| v.to_bits()).collect()
    }

    fn roundtrip(bits: &[u64]) -> Vec<u8> {
        let mut body = Vec::new();
        assert!(Encoder::default().encode(bits, &mut body));
        let (mut pos, mut out) = (0, Vec::new());
        Decoder::default()
            .decode(&body, &mut pos, bits.len(), &mut Vec::new(), &mut out)
            .unwrap();
        assert_eq!((out.as_slice(), pos), (bits, body.len()));
        assert_truncations_fail(&body, |bytes| {
            Decoder::default().decode(bytes, &mut 0, bits.len(), &mut Vec::new(), &mut Vec::new())
        });
        body
    }

    #[test]
    fn decimals_round_trip_with_their_exponent() {
        assert_eq!(&roundtrip(&floats(&[0.1, 0.2, 0.35]))[..2], &[2, 0]);
        assert_eq!(roundtrip(&floats(&[1.0, 2.0, 3.0]))[0], 0);
        let tiny: Vec<u64> = (1..=10).map(|i| (i as f64 / 1e18).to_bits()).collect();
        assert_eq!(roundtrip(&tiny)[0], 18);
        let gauge: Vec<u64> = random(5)
            .take(300)
            .map(|r| ((r % 100_000) as f64 / 100.0).to_bits())
            .collect();
        assert_eq!(roundtrip(&gauge)[0], 2);
    }

    #[test]
    fn exceptions_keep_their_bits_at_every_position() {
        let n = 40;
        let base: Vec<f64> = (0..n)
            .map(|i| (2000 + i * 37 % 991) as f64 / 100.0)
            .collect();
        let cases: [&[(usize, u64)]; 5] = [
            &[(0, STALE_NAN)],
            &[(20, (-0f64).to_bits())],
            &[(n - 1, f64::NAN.to_bits())],
            &[
                (5, f64::INFINITY.to_bits()),
                (6, STALE_NAN),
                (7, (-0f64).to_bits()),
            ],
            &[
                (0, STALE_NAN),
                (1, f64::NEG_INFINITY.to_bits()),
                (n - 1, STALE_NAN),
            ],
        ];
        for exceptions in cases {
            let mut bits = floats(&base);
            for (i, b) in exceptions {
                bits[*i] = *b;
            }
            let body = roundtrip(&bits);
            assert_eq!(usize::from(body[1]), exceptions.len());
        }
    }

    #[test]
    fn rare_large_exponents_become_exceptions() {
        let mut values: Vec<f64> = (0..100).map(|i| (i + 1) as f64 / 10.0).collect();
        values[40] = 0.123_456_789_012_345;
        values[70] = 1.987_654_321_098_765;
        assert_eq!(&roundtrip(&floats(&values))[..2], &[1, 2]);
    }

    #[test]
    fn unconvertible_blocks_are_not_encoded() {
        let mut out = vec![9];
        let noise: Vec<u64> = random(6).take(64).collect();
        assert!(!Encoder::default().encode(&noise, &mut out));
        assert!(!Encoder::default().encode(&[f64::NAN.to_bits(); 8], &mut out));
        assert_eq!(out, [9]);
    }

    #[test]
    fn corrupt_bodies_fail() {
        let decode = |body: &[u8], rows| {
            Decoder::default().decode(body, &mut 0, rows, &mut Vec::new(), &mut Vec::new())
        };
        assert!(decode(&[1, 0, 2, 2, 2], 2).is_ok());
        let zeros = [0u8; 8];
        for (body, rows) in [
            (vec![19, 0, 2, 2, 2], 2),
            (
                [&[1, 2, 0][..], &zeros, &[0], &zeros, &[2, 2, 2]].concat(),
                2,
            ),
            ([&[1, 1, 3][..], &zeros, &[2, 2, 4, 0]].concat(), 3),
        ] {
            assert!(decode(&body, rows).is_err(), "{body:?}");
        }
    }

    #[test]
    fn negative_zero_is_never_a_decimal() {
        assert!((0..=MAX_EXPONENT).all(|e| to_decimal((-0f64).to_bits(), e).is_none()));
        assert_eq!(to_decimal(0f64.to_bits(), 3), Some(0));
        assert_eq!(to_decimal(0.35f64.to_bits(), 2), Some(35));
        assert_eq!(min_exponent((3.0 / 1e18f64).to_bits()), Some(18));
        assert_eq!(min_exponent(f64::NAN.to_bits()), None);
    }
}
