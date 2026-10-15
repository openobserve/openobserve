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

//! IntDelta: a zigzag varint first integer, then SparsePacked zigzag deltas.

use anyhow::Result;

use super::pack::{get_sparse, put_sparse};
use crate::block::compact::{get_varint, put_varint, unzigzag, zigzag};

/// `ints` hold at most 2^53 in magnitude, so their deltas cannot overflow.
pub(crate) fn encode(ints: &[i64], out: &mut Vec<u8>) {
    put_varint(out, zigzag(ints[0]));
    put_sparse(
        ints.windows(2).map(|w| zigzag(w[1].wrapping_sub(w[0]))),
        out,
    );
}

pub(crate) fn decode(
    body: &[u8],
    pos: &mut usize,
    rows: usize,
    seq: &mut Vec<u64>,
    bits: &mut Vec<u64>,
) -> Result<()> {
    decode_with(body, pos, rows, seq, bits, |v| (v as f64).to_bits())
}

/// Decodes the integer sequence and appends `to_bits` of each one.
pub(crate) fn decode_with(
    body: &[u8],
    pos: &mut usize,
    rows: usize,
    seq: &mut Vec<u64>,
    bits: &mut Vec<u64>,
    to_bits: impl Fn(i64) -> u64,
) -> Result<()> {
    let mut value = unzigzag(get_varint(body, pos)?);
    get_sparse(body, pos, rows - 1, seq)?;
    bits.push(to_bits(value));
    for delta in seq.iter() {
        value = value.wrapping_add(unzigzag(*delta));
        bits.push(to_bits(value));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        super::{assert_truncations_fail, random},
        *,
    };

    const LIMIT: i64 = 1 << 53;

    fn roundtrip(ints: &[i64]) {
        let mut body = Vec::new();
        encode(ints, &mut body);
        let (mut pos, mut seq, mut bits) = (0, Vec::new(), Vec::new());
        decode(&body, &mut pos, ints.len(), &mut seq, &mut bits).unwrap();
        let expected: Vec<u64> = ints.iter().map(|v| (*v as f64).to_bits()).collect();
        assert_eq!((bits, pos), (expected, body.len()));
        assert_truncations_fail(&body, |bytes| {
            decode(bytes, &mut 0, ints.len(), &mut Vec::new(), &mut Vec::new())
        });
    }

    #[test]
    fn integer_sequences_round_trip() {
        roundtrip(&[5]);
        roundtrip(&[3, -3]);
        roundtrip(&(0..200).map(|i| i * i * 7919).collect::<Vec<_>>());
        roundtrip(
            &(0..65)
                .map(|i| if i % 2 == 0 { LIMIT } else { -LIMIT })
                .collect::<Vec<_>>(),
        );
        roundtrip(&(0..300).map(|i| i64::from(i % 50 == 0)).collect::<Vec<_>>());
        roundtrip(
            &random(1)
                .take(300)
                .map(|r| (r % 2001) as i64 - 1000)
                .collect::<Vec<_>>(),
        );
    }

    #[test]
    fn decode_with_maps_each_integer() {
        let ints = [10, 20, 35];
        let mut body = Vec::new();
        encode(&ints, &mut body);
        let mut bits = Vec::new();
        decode_with(&body, &mut 0, 3, &mut Vec::new(), &mut bits, |v| {
            v as u64 * 2
        })
        .unwrap();
        assert_eq!(bits, [20, 40, 70]);
    }
}
