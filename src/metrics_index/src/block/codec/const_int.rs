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

//! ConstInt: one exact integer repeated for every row, as a zigzag varint.

use anyhow::Result;

use crate::block::compact::{get_varint, put_varint, unzigzag, zigzag};

/// `value` must come from `exact_int`, so it converts back to the same f64 bits.
pub(crate) fn encode(value: i64, out: &mut Vec<u8>) {
    put_varint(out, zigzag(value));
}

pub(crate) fn decode(body: &[u8], pos: &mut usize, rows: usize, bits: &mut Vec<u64>) -> Result<()> {
    let value = unzigzag(get_varint(body, pos)?) as f64;
    bits.resize(rows, value.to_bits());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{super::assert_truncations_fail, *};

    #[test]
    fn constant_integers_round_trip() {
        for value in [0, 1, -1, 7, -123_456_789, 1 << 53, -(1 << 53)] {
            let mut body = Vec::new();
            encode(value, &mut body);
            let (mut pos, mut bits) = (0, Vec::new());
            decode(&body, &mut pos, 5, &mut bits).unwrap();
            assert_eq!((bits, pos), (vec![(value as f64).to_bits(); 5], body.len()));
            assert_truncations_fail(&body, |bytes| decode(bytes, &mut 0, 5, &mut Vec::new()));
        }
    }
}
