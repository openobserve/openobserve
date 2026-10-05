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

//! Bit and byte primitives shared by the encodings, including SparsePack.

use anyhow::{Context, Result, ensure};

const CHUNK: usize = 64;
const SPARSE: u8 = 0x80;

/// LSB-first bit sink that flushes whole bytes into a byte vector.
pub(super) struct BitWriter<'a> {
    out: &'a mut Vec<u8>,
    acc: u128,
    pending: u32,
}

impl<'a> BitWriter<'a> {
    pub(super) fn new(out: &'a mut Vec<u8>) -> Self {
        Self {
            out,
            acc: 0,
            pending: 0,
        }
    }

    /// `value` must fit in `width` bits, and `width` is at most 64.
    #[inline]
    pub(super) fn put(&mut self, value: u64, width: u32) {
        self.acc |= u128::from(value) << self.pending;
        self.pending += width;
        if self.pending >= 64 {
            self.out.extend_from_slice(&(self.acc as u64).to_le_bytes());
            self.acc >>= 64;
            self.pending -= 64;
        }
    }

    pub(super) fn finish(self) {
        let bytes = self.pending.div_ceil(8) as usize;
        self.out
            .extend_from_slice(&(self.acc as u64).to_le_bytes()[..bytes]);
    }
}

/// LSB-first bit source over one byte slice.
pub(super) struct BitReader<'a> {
    bytes: &'a [u8],
    bit: usize,
}

impl<'a> BitReader<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, bit: 0 }
    }

    /// `width` is between 1 and 64.
    #[inline]
    pub(super) fn read(&mut self, width: u32) -> Result<u64> {
        let end = self.bit + width as usize;
        ensure!(end <= self.bytes.len() * 8, "truncated bitstream");
        let value = read_bits(self.bytes, self.bit, width as usize);
        self.bit = end;
        Ok(value)
    }

    pub(super) fn consumed_bytes(&self) -> usize {
        self.bit.div_ceil(8)
    }
}

/// Packs unsigned values in 64-value chunks, each dense or a nonzero bitmap plus nonzero values.
pub(super) fn put_sparse(values: impl Iterator<Item = u64>, out: &mut Vec<u8>) {
    let mut chunk = [0u64; CHUNK];
    let mut len = 0;
    for value in values {
        chunk[len] = value;
        len += 1;
        if len == CHUNK {
            put_chunk(&chunk, out);
            len = 0;
        }
    }
    if len > 0 {
        put_chunk(&chunk[..len], out);
    }
}

/// Replaces `out` with `len` values written by [`put_sparse`].
pub(super) fn get_sparse(
    body: &[u8],
    pos: &mut usize,
    len: usize,
    out: &mut Vec<u64>,
) -> Result<()> {
    out.clear();
    let mut left = len;
    while left > 0 {
        let chunk = left.min(CHUNK);
        get_chunk(body, pos, chunk, out)?;
        left -= chunk;
    }
    Ok(())
}

pub(super) fn take<'a>(body: &'a [u8], pos: &mut usize, len: usize) -> Result<&'a [u8]> {
    let data = body
        .get(*pos..pos.saturating_add(len))
        .context("truncated sample block")?;
    *pos += len;
    Ok(data)
}

pub(super) fn get_u64(body: &[u8], pos: &mut usize) -> Result<u64> {
    Ok(u64::from_le_bytes(take(body, pos, 8)?.try_into()?))
}

fn put_chunk(chunk: &[u64], out: &mut Vec<u8>) {
    let width = 64 - chunk.iter().fold(0, |acc, v| acc | v).leading_zeros();
    let nonzero = chunk.iter().filter(|v| **v != 0).count();
    let w = width as usize;
    if width > 0 && 64 + nonzero * w < chunk.len() * w {
        let mask = chunk
            .iter()
            .enumerate()
            .fold(0u64, |mask, (i, v)| mask | (u64::from(*v != 0) << i));
        out.push(SPARSE | width as u8);
        out.extend_from_slice(&mask.to_le_bytes());
        put_bits(chunk.iter().copied().filter(|v| *v != 0), width, out);
    } else {
        out.push(width as u8);
        if width > 0 {
            put_bits(chunk.iter().copied(), width, out);
        }
    }
}

fn put_bits(values: impl Iterator<Item = u64>, width: u32, out: &mut Vec<u8>) {
    let mut writer = BitWriter::new(out);
    for value in values {
        writer.put(value, width);
    }
    writer.finish();
}

fn get_chunk(body: &[u8], pos: &mut usize, len: usize, out: &mut Vec<u64>) -> Result<()> {
    let head = *body.get(*pos).context("truncated packed chunk")?;
    *pos += 1;
    let width = usize::from(head & !SPARSE);
    if head & SPARSE == 0 {
        ensure!(width <= 64, "invalid packed width");
        let data = take(body, pos, (len * width).div_ceil(8))?;
        if width == 0 {
            out.resize(out.len() + len, 0);
        } else {
            out.extend((0..len).map(|i| read_bits(data, i * width, width)));
        }
        return Ok(());
    }
    ensure!((1..=64).contains(&width), "invalid sparse width");
    let mask = get_u64(body, pos)?;
    ensure!(
        len == CHUNK || mask >> len == 0,
        "sparse bitmap outside chunk"
    );
    let data = take(body, pos, (mask.count_ones() as usize * width).div_ceil(8))?;
    let start = out.len();
    out.resize(start + len, 0);
    let mut rest = mask;
    let mut j = 0;
    while rest != 0 {
        out[start + rest.trailing_zeros() as usize] = read_bits(data, j * width, width);
        rest &= rest - 1;
        j += 1;
    }
    Ok(())
}

/// Callers guarantee `bit + width <= data.len() * 8` and `1 <= width <= 64`.
#[inline]
fn read_bits(data: &[u8], bit: usize, width: usize) -> u64 {
    let byte = bit >> 3;
    let word = if let Some(window) = data.get(byte..byte + 16) {
        u128::from_le_bytes(window.try_into().expect("16-byte window"))
    } else {
        let mut tail = [0u8; 16];
        tail[..data.len() - byte].copy_from_slice(&data[byte..]);
        u128::from_le_bytes(tail)
    };
    let value = (word >> (bit & 7)) as u64;
    if width == 64 {
        value
    } else {
        value & ((1u64 << width) - 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparse_pack_widths_boundaries_and_bitmap_bounds() {
        let sequences: Vec<Vec<u64>> = vec![
            vec![0; 64],
            vec![1; 64],
            vec![u64::MAX >> 1; 64],
            vec![u64::MAX; 64],
            (0..100).map(|i| i * 3).collect(),
            (0..130)
                .map(|i| if i % 50 == 0 { u64::MAX } else { 0 })
                .collect(),
        ];
        let mut decoded = Vec::new();
        for values in &sequences {
            let mut out = Vec::new();
            put_sparse(values.iter().copied(), &mut out);
            let mut pos = 0;
            get_sparse(&out, &mut pos, values.len(), &mut decoded).unwrap();
            assert_eq!((&decoded, pos), (values, out.len()));
        }
        let head = |nonzero: usize| {
            let values: Vec<u64> = (0..64).map(|i| if i < nonzero { 255 } else { 0 }).collect();
            let mut out = Vec::new();
            put_sparse(values.into_iter(), &mut out);
            out[0]
        };
        assert_eq!(head(55), SPARSE | 8);
        assert_eq!(head(56), 8);
        let mut out = Vec::new();
        put_sparse(std::iter::repeat_n(0, 64), &mut out);
        assert_eq!(out, [0]);
        for bad in [
            vec![65],
            vec![SPARSE],
            vec![SPARSE | 65],
            [&[SPARSE | 1][..], &(1u64 << 10).to_le_bytes(), &[1]].concat(),
        ] {
            assert!(get_sparse(&bad, &mut 0, 10, &mut decoded).is_err());
        }
        let valid = [&[SPARSE | 1][..], &(1u64 << 9).to_le_bytes(), &[1]].concat();
        get_sparse(&valid, &mut 0, 10, &mut decoded).unwrap();
        assert_eq!(decoded[9], 1);
    }
}
