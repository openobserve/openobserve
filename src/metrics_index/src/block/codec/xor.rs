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

//! Xor: Gorilla XOR of consecutive f64 bit patterns, as an LSB-first bitstream.

use anyhow::{Context, Result, ensure};

use super::pack::{BitReader, BitWriter, get_u64};

pub(crate) fn encode(bits: &[u64], out: &mut Vec<u8>) {
    out.extend_from_slice(&bits[0].to_le_bytes());
    let mut writer = BitWriter::new(out);
    let mut window: Option<(u32, u32)> = None;
    for w in bits.windows(2) {
        let x = w[0] ^ w[1];
        if x == 0 {
            writer.put(0, 1);
            continue;
        }
        let lead = x.leading_zeros().min(31);
        let trail = x.trailing_zeros();
        match window {
            Some((l, t)) if lead >= l && trail >= t => {
                writer.put(0b01, 2);
                writer.put(x >> t, 64 - l - t);
            }
            _ => {
                let sig = 64 - lead - trail;
                writer.put(0b11, 2);
                writer.put(u64::from(lead) | (u64::from(sig - 1) << 5), 11);
                writer.put(x >> trail, sig);
                window = Some((lead, trail));
            }
        }
    }
    writer.finish();
}

pub(crate) fn decode(body: &[u8], pos: &mut usize, rows: usize, bits: &mut Vec<u64>) -> Result<()> {
    let mut value = get_u64(body, pos)?;
    bits.push(value);
    let mut reader = BitReader::new(&body[*pos..]);
    let mut window: Option<(u32, u32)> = None;
    for _ in 1..rows {
        if reader.read(1)? == 1 {
            let (lead, trail) = if reader.read(1)? == 1 {
                let head = reader.read(11)? as u32;
                let (lead, sig) = (head & 31, (head >> 5) + 1);
                ensure!(lead + sig <= 64, "invalid XOR window");
                *window.insert((lead, 64 - lead - sig))
            } else {
                window.context("XOR window reused before it was set")?
            };
            value ^= reader.read(64 - lead - trail)? << trail;
        }
        bits.push(value);
    }
    *pos += reader.consumed_bytes();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        super::{assert_truncations_fail, random},
        *,
    };

    fn roundtrip(bits: &[u64]) {
        let mut body = Vec::new();
        encode(bits, &mut body);
        let (mut pos, mut out) = (0, Vec::new());
        decode(&body, &mut pos, bits.len(), &mut out).unwrap();
        assert_eq!((out.as_slice(), pos), (bits, body.len()));
        assert_truncations_fail(&body, |bytes| {
            decode(bytes, &mut 0, bits.len(), &mut Vec::new())
        });
    }

    #[test]
    fn bit_patterns_round_trip() {
        roundtrip(&[0x7ff0_0000_0000_0002]);
        roundtrip(&[1.5f64.to_bits(); 100]);
        roundtrip(
            &(0..64)
                .map(|i| [1.0f64, 1.5][i % 2].to_bits())
                .collect::<Vec<_>>(),
        );
        roundtrip(&[
            0,
            (-0f64).to_bits(),
            f64::NAN.to_bits(),
            0x7ff8_0000_0000_0042,
            f64::INFINITY.to_bits(),
            f64::NEG_INFINITY.to_bits(),
            u64::MAX,
            1,
        ]);
        roundtrip(&random(3).take(300).collect::<Vec<_>>());
        roundtrip(
            &random(4)
                .take(500)
                .map(|r| (4_000_000_000_000.0 + (r % 4096) as f64).to_bits())
                .collect::<Vec<_>>(),
        );
    }

    #[test]
    fn invalid_windows_fail() {
        let reuse = [&[0u8; 8][..], &[0b01, 0, 0, 0, 0, 0, 0, 0, 0]].concat();
        let error = decode(&reuse, &mut 0, 2, &mut Vec::new()).unwrap_err();
        assert!(error.to_string().contains("reused before"));
        let wide = [&[0u8; 8][..], &[0xff, 0x1f, 0, 0, 0, 0, 0, 0, 0, 0]].concat();
        let error = decode(&wide, &mut 0, 2, &mut Vec::new()).unwrap_err();
        assert!(error.to_string().contains("invalid XOR window"));
    }
}
