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

//! Sample blocks: one tag byte, then an uncompressed timestamp section and value section.

use anyhow::{Context, Result, bail, ensure};

use super::{
    BlockMeta, MAX_BLOCK_ROWS,
    compact::{get_varint, put_varint, unzigzag, zigzag},
};

const TAG_RESERVED: u8 = 0xe0;
const TS_CONST_STEP: u8 = 0;
const TS_DOD: u8 = 1;
const TS_RLE: u8 = 2;
const VALUE_CONST_INT: u8 = 0;
const VALUE_CONST_F64: u8 = 1;
const VALUE_INT_DELTA: u8 = 2;
const VALUE_ALP: u8 = 3;
const VALUE_XOR: u8 = 4;
const CHUNK: usize = 64;
const SPARSE: u8 = 0x80;
const EXACT_LIMIT: f64 = 9_007_199_254_740_992.0;
const MAX_EXPONENT: usize = 18;
const POW10: [f64; MAX_EXPONENT + 1] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16,
    1e17, 1e18,
];
const ALP_PROBE: usize = 32;

/// Reusable scratch space for encoding sample blocks.
#[derive(Default)]
pub(super) struct SampleEncoder {
    quotients: Vec<u64>,
    ints: Vec<i64>,
    exceptions: Vec<usize>,
}

impl SampleEncoder {
    /// Appends one block for `ts` (non-decreasing) and the matching f64 bit patterns to `out`.
    pub(super) fn encode_block(
        &mut self,
        ts: &[i64],
        bits: &[u64],
        out: &mut Vec<u8>,
    ) -> Result<()> {
        ensure!(
            !ts.is_empty() && ts.len() == bits.len() && ts.len() <= MAX_BLOCK_ROWS,
            "invalid sample block shape"
        );
        let start = out.len();
        out.push(0);
        let ts_kind = self.encode_timestamps(ts, out);
        let value_kind = self.encode_values(bits, out);
        out[start] = ts_kind | (value_kind << 2);
        ensure!(
            out.len() - start <= max_block_len(u32::try_from(ts.len())?)?,
            "sample block exceeds format bound"
        );
        Ok(())
    }

    fn encode_timestamps(&mut self, ts: &[i64], out: &mut Vec<u8>) -> u8 {
        let first = step(ts[0], ts[ts.len().min(2) - 1]);
        if ts.windows(2).all(|w| step(w[0], w[1]) == first) {
            return TS_CONST_STEP;
        }
        self.quotients.clear();
        self.quotients
            .extend(ts.windows(2).map(|w| step(w[0], w[1])));
        let divisor = self
            .quotients
            .iter()
            .fold(0, |g, d| if g != 0 && d % g == 0 { g } else { gcd(g, *d) });
        if divisor > 1 {
            self.quotients.iter_mut().for_each(|q| *q /= divisor);
        }
        let quotients = &self.quotients;
        let start = out.len();
        put_varint(out, divisor);
        put_sparse(
            std::iter::once(quotients[0]).chain(
                quotients
                    .windows(2)
                    .map(|w| zigzag(w[1].wrapping_sub(w[0]) as i64)),
            ),
            out,
        );
        let mut rle = varint_len(divisor);
        for_each_run(quotients, |quotient, run| {
            rle += varint_len(quotient) + varint_len(run)
        });
        if rle >= out.len() - start {
            return TS_DOD;
        }
        out.truncate(start);
        put_varint(out, divisor);
        for_each_run(quotients, |quotient, run| {
            put_varint(out, quotient);
            put_varint(out, run);
        });
        TS_RLE
    }

    fn encode_values(&mut self, bits: &[u64], out: &mut Vec<u8>) -> u8 {
        let first = bits[0];
        if bits.iter().all(|b| *b == first) {
            if let Some(v) = exact_int(first) {
                put_varint(out, zigzag(v));
                return VALUE_CONST_INT;
            }
            out.extend_from_slice(&first.to_le_bytes());
            return VALUE_CONST_F64;
        }
        self.ints.clear();
        if bits
            .iter()
            .all(|b| exact_int(*b).map(|v| self.ints.push(v)).is_some())
        {
            return self.encode_integers(bits, out);
        }
        let start = out.len();
        put_xor(bits, out);
        let xor_len = out.len() - start;
        if self.encode_alp(bits, start, xor_len, out) {
            VALUE_ALP
        } else {
            VALUE_XOR
        }
    }

    /// Non-decreasing integers never choose XOR, so they skip that attempt.
    fn encode_integers(&self, bits: &[u64], out: &mut Vec<u8>) -> u8 {
        let start = out.len();
        put_deltas(&self.ints, out);
        if self.ints.is_sorted() {
            return VALUE_INT_DELTA;
        }
        let delta_len = out.len() - start;
        put_xor(bits, out);
        if out.len() - start - delta_len < delta_len {
            out.copy_within(start + delta_len.., start);
            out.truncate(out.len() - delta_len);
            return VALUE_XOR;
        }
        out.truncate(start + delta_len);
        VALUE_INT_DELTA
    }

    /// Replaces the XOR section at `start` when an ALP candidate is strictly smaller.
    fn encode_alp(
        &mut self,
        bits: &[u64],
        start: usize,
        xor_len: usize,
        out: &mut Vec<u8>,
    ) -> bool {
        let Some((a, b)) = alp_exponents(bits) else {
            return false;
        };
        let mut best = xor_len;
        let mut chosen = false;
        for exponent in [Some(a), (b != a).then_some(b)].into_iter().flatten() {
            let mid = start + best;
            if self.put_alp(bits, exponent, out) && out.len() - mid < best {
                best = out.len() - mid;
                out.copy_within(mid.., start);
                chosen = true;
            }
            out.truncate(start + best);
        }
        chosen
    }

    fn put_alp(&mut self, bits: &[u64], exponent: usize, out: &mut Vec<u8>) -> bool {
        self.ints.clear();
        self.exceptions.clear();
        let mut last = None;
        for (i, b) in bits.iter().enumerate() {
            match to_decimal(*b, exponent) {
                Some(m) => {
                    if last.is_none() {
                        self.ints.fill(m);
                    }
                    last = Some(m);
                    self.ints.push(m);
                }
                None => {
                    self.exceptions.push(i);
                    self.ints.push(last.unwrap_or_default());
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
        put_deltas(&self.ints, out);
        true
    }
}

/// Reusable scratch space for decoding sample blocks.
#[derive(Default)]
pub(super) struct SampleDecoder {
    seq: Vec<u64>,
    exceptions: Vec<(usize, u64)>,
}

impl SampleDecoder {
    pub(super) fn with_capacity(rows: usize) -> Self {
        Self {
            seq: Vec::with_capacity(rows),
            exceptions: Vec::new(),
        }
    }

    /// Replaces `ts` and `bits` with the samples of one block; both may hold garbage on error.
    pub(super) fn decode(
        &mut self,
        bytes: &[u8],
        block: &BlockMeta,
        ts: &mut Vec<i64>,
        bits: &mut Vec<u64>,
    ) -> Result<()> {
        ts.clear();
        bits.clear();
        let rows = block.row_count as usize;
        ensure!(
            rows > 0 && rows <= MAX_BLOCK_ROWS,
            "invalid decoded row count"
        );
        ensure!(
            block.min_timestamp <= block.max_timestamp,
            "invalid time bounds"
        );
        let (&tag, body) = bytes.split_first().context("empty sample block")?;
        ensure!(tag & TAG_RESERVED == 0, "reserved sample tag bits set");
        let mut pos = 0;
        self.decode_timestamps(tag & 3, body, &mut pos, block, ts)?;
        self.decode_values(tag >> 2, body, &mut pos, rows, bits)?;
        ensure!(pos == body.len(), "trailing sample block bytes");
        Ok(())
    }

    fn decode_timestamps(
        &mut self,
        kind: u8,
        body: &[u8],
        pos: &mut usize,
        block: &BlockMeta,
        ts: &mut Vec<i64>,
    ) -> Result<()> {
        let rows = block.row_count as usize;
        let (min, max) = (block.min_timestamp, block.max_timestamp);
        if kind == TS_CONST_STEP {
            return const_step_timestamps(rows, min, max, ts);
        }
        ensure!(
            kind == TS_DOD || kind == TS_RLE,
            "reserved timestamp encoding"
        );
        let divisor = get_varint(body, pos)?;
        ensure!(divisor > 0, "zero timestamp step divisor");
        ts.push(min);
        let last = if kind == TS_DOD {
            get_sparse(body, pos, rows - 1, &mut self.seq)?;
            dod_timestamps(&self.seq, divisor, min, ts)?
        } else {
            rle_timestamps(body, pos, rows - 1, divisor, min, ts)?
        };
        ensure!(last == max, "decoded timestamp bounds mismatch");
        Ok(())
    }

    fn decode_values(
        &mut self,
        kind: u8,
        body: &[u8],
        pos: &mut usize,
        rows: usize,
        bits: &mut Vec<u64>,
    ) -> Result<()> {
        match kind {
            VALUE_CONST_INT => {
                let value = unzigzag(get_varint(body, pos)?) as f64;
                bits.resize(rows, value.to_bits());
            }
            VALUE_CONST_F64 => bits.resize(rows, get_u64(body, pos)?),
            VALUE_INT_DELTA => self.get_deltas(body, pos, rows, bits, |v| (v as f64).to_bits())?,
            VALUE_ALP => self.decode_alp(body, pos, rows, bits)?,
            VALUE_XOR => get_xor(body, pos, rows, bits)?,
            _ => bail!("reserved value encoding"),
        }
        Ok(())
    }

    fn decode_alp(
        &mut self,
        body: &[u8],
        pos: &mut usize,
        rows: usize,
        bits: &mut Vec<u64>,
    ) -> Result<()> {
        let exponent = usize::from(*body.get(*pos).context("truncated ALP exponent")?);
        *pos += 1;
        ensure!(exponent <= MAX_EXPONENT, "invalid ALP exponent");
        let count = get_varint(body, pos)?;
        ensure!(count < rows as u64, "too many ALP exceptions");
        self.exceptions.clear();
        let mut at = 0usize;
        for k in 0..count {
            let gap = get_varint(body, pos)?;
            ensure!(k == 0 || gap > 0, "ALP exception positions not increasing");
            at = usize::try_from(gap)
                .ok()
                .and_then(|gap| at.checked_add(gap))
                .filter(|at| *at < rows)
                .context("ALP exception out of range")?;
            self.exceptions.push((at, get_u64(body, pos)?));
        }
        let scale = POW10[exponent];
        self.get_deltas(body, pos, rows, bits, |m| (m as f64 / scale).to_bits())?;
        for (i, b) in &self.exceptions {
            bits[*i] = *b;
        }
        Ok(())
    }

    fn get_deltas(
        &mut self,
        body: &[u8],
        pos: &mut usize,
        rows: usize,
        bits: &mut Vec<u64>,
        to_bits: impl Fn(i64) -> u64,
    ) -> Result<()> {
        let mut value = unzigzag(get_varint(body, pos)?);
        get_sparse(body, pos, rows - 1, &mut self.seq)?;
        bits.push(to_bits(value));
        for delta in &self.seq {
            value = value.wrapping_add(unzigzag(*delta));
            bits.push(to_bits(value));
        }
        Ok(())
    }
}

/// LSB-first bit sink that flushes whole bytes into a byte vector.
struct BitWriter<'a> {
    out: &'a mut Vec<u8>,
    acc: u128,
    pending: u32,
}

impl<'a> BitWriter<'a> {
    fn new(out: &'a mut Vec<u8>) -> Self {
        Self {
            out,
            acc: 0,
            pending: 0,
        }
    }

    /// `value` must fit in `width` bits, and `width` is at most 64.
    #[inline]
    fn put(&mut self, value: u64, width: u32) {
        self.acc |= u128::from(value) << self.pending;
        self.pending += width;
        if self.pending >= 64 {
            self.out.extend_from_slice(&(self.acc as u64).to_le_bytes());
            self.acc >>= 64;
            self.pending -= 64;
        }
    }

    fn finish(self) {
        let bytes = self.pending.div_ceil(8) as usize;
        self.out
            .extend_from_slice(&(self.acc as u64).to_le_bytes()[..bytes]);
    }
}

/// LSB-first bit source over one byte slice.
struct BitReader<'a> {
    bytes: &'a [u8],
    bit: usize,
}

impl<'a> BitReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, bit: 0 }
    }

    /// `width` is between 1 and 64.
    #[inline]
    fn read(&mut self, width: u32) -> Result<u64> {
        let end = self.bit + width as usize;
        ensure!(end <= self.bytes.len() * 8, "truncated XOR bitstream");
        let value = read_bits(self.bytes, self.bit, width as usize);
        self.bit = end;
        Ok(value)
    }

    fn consumed_bytes(&self) -> usize {
        self.bit.div_ceil(8)
    }
}

/// Upper bound of one encoded sample block, enforced by the writer and on every read.
pub fn max_block_len(row_count: u32) -> Result<usize> {
    ensure!(
        row_count > 0 && row_count as usize <= MAX_BLOCK_ROWS,
        "invalid block row count"
    );
    Ok(32 + 18 * row_count as usize)
}

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

/// Integer value when `b` is a finite whole f64 that converts back to the same bits.
fn exact_int(b: u64) -> Option<i64> {
    let v = f64::from_bits(b);
    if !(v.is_finite() && v.abs() <= EXACT_LIMIT && v.trunc() == v) {
        return None;
    }
    let i = v as i64;
    ((i as f64).to_bits() == b).then_some(i)
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

fn min_exponent(b: u64) -> Option<usize> {
    if !f64::from_bits(b).is_finite() {
        return None;
    }
    (0..=MAX_EXPONENT).find(|e| to_decimal(b, *e).is_some())
}

/// Candidate A covers every convertible value; candidate B is the smallest covering 90%.
fn alp_exponents(bits: &[u64]) -> Option<(usize, usize)> {
    let probe = bits.len().min(ALP_PROBE);
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

fn put_deltas(ints: &[i64], out: &mut Vec<u8>) {
    put_varint(out, zigzag(ints[0]));
    put_sparse(
        ints.windows(2).map(|w| zigzag(w[1].wrapping_sub(w[0]))),
        out,
    );
}

fn put_xor(bits: &[u64], out: &mut Vec<u8>) {
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

fn get_xor(body: &[u8], pos: &mut usize, rows: usize, bits: &mut Vec<u64>) -> Result<()> {
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

fn put_sparse(values: impl Iterator<Item = u64>, out: &mut Vec<u8>) {
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

/// Replaces `out` with `len` values packed in 64-value chunks.
fn get_sparse(body: &[u8], pos: &mut usize, len: usize, out: &mut Vec<u64>) -> Result<()> {
    out.clear();
    let mut left = len;
    while left > 0 {
        let chunk = left.min(CHUNK);
        get_chunk(body, pos, chunk, out)?;
        left -= chunk;
    }
    Ok(())
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

fn take<'a>(body: &'a [u8], pos: &mut usize, len: usize) -> Result<&'a [u8]> {
    let data = body
        .get(*pos..pos.saturating_add(len))
        .context("truncated sample block")?;
    *pos += len;
    Ok(data)
}

fn get_u64(body: &[u8], pos: &mut usize) -> Result<u64> {
    Ok(u64::from_le_bytes(take(body, pos, 8)?.try_into()?))
}

fn const_step_timestamps(rows: usize, min: i64, max: i64, ts: &mut Vec<i64>) -> Result<()> {
    if rows == 1 {
        ensure!(min == max, "decoded timestamp bounds mismatch");
        ts.push(min);
        return Ok(());
    }
    let span = step(min, max);
    let steps = rows as u64 - 1;
    ensure!(
        span.is_multiple_of(steps),
        "inexact constant timestamp step"
    );
    let each = span / steps;
    ts.extend((0..rows as u64).map(|i| min.wrapping_add((each * i) as i64)));
    Ok(())
}

/// Appends the timestamps after `first` and returns the last one.
fn dod_timestamps(seq: &[u64], divisor: u64, first: i64, ts: &mut Vec<i64>) -> Result<i64> {
    let mut previous = first;
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

/// Appends `steps` timestamps after `first` from `(quotient, run)` pairs and returns the last one.
fn rle_timestamps(
    body: &[u8],
    pos: &mut usize,
    steps: usize,
    divisor: u64,
    first: i64,
    ts: &mut Vec<i64>,
) -> Result<i64> {
    let mut previous = first;
    let mut left = steps;
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

#[inline]
fn next_timestamp(previous: i64, step: u64) -> Result<i64> {
    let next = previous.wrapping_add(step as i64);
    ensure!(next >= previous, "decoded timestamps decreased");
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STALE_NAN: u64 = 0x7ff0_0000_0000_0002;
    const STEP: i64 = 15_000_000;
    const BASE: i64 = 1_790_000_000_000_000;

    fn meta(ts: &[i64], len: usize) -> BlockMeta {
        BlockMeta {
            hash: 1,
            row_start: 0,
            row_count: ts.len() as u32,
            min_timestamp: ts[0],
            max_timestamp: *ts.last().unwrap(),
            block_offset: 0,
            block_length: len as u32,
        }
    }

    fn encode(ts: &[i64], bits: &[u64]) -> Vec<u8> {
        let mut out = Vec::new();
        SampleEncoder::default()
            .encode_block(ts, bits, &mut out)
            .unwrap();
        out
    }

    fn decode(block: &[u8], meta: &BlockMeta) -> Result<(Vec<i64>, Vec<u64>)> {
        let (mut ts, mut bits) = (Vec::new(), Vec::new());
        SampleDecoder::default().decode(block, meta, &mut ts, &mut bits)?;
        Ok((ts, bits))
    }

    fn roundtrip(ts: &[i64], bits: &[u64]) -> Vec<u8> {
        let block = encode(ts, bits);
        assert!(block.len() <= max_block_len(ts.len() as u32).unwrap());
        let (decoded_ts, decoded_bits) = decode(&block, &meta(ts, block.len())).unwrap();
        assert_eq!(decoded_ts, ts);
        assert_eq!(decoded_bits, bits);
        block
    }

    fn kinds(block: &[u8]) -> (u8, u8) {
        (block[0] & 3, block[0] >> 2)
    }

    fn floats(values: &[f64]) -> Vec<u64> {
        values.iter().map(|v| v.to_bits()).collect()
    }

    fn random(seed: u64) -> impl Iterator<Item = u64> {
        std::iter::successors(Some(seed), |x| {
            Some(
                x.wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407),
            )
        })
        .map(|x| (x ^ (x >> 29)).wrapping_mul(0xbf58_476d_1ce4_e5b9) ^ (x >> 32))
    }

    fn grid(n: usize) -> Vec<i64> {
        (0..n as i64).map(|i| BASE + i * STEP).collect()
    }

    fn timestamp_shapes(n: usize) -> Vec<Vec<i64>> {
        let jitter = |unit: i64, seed| {
            (0..n as i64)
                .zip(random(seed))
                .map(|(i, r)| BASE + i * STEP + (r % 1000) as i64 * unit)
                .collect::<Vec<_>>()
        };
        let span = u64::MAX / (n.max(2) as u64 - 1);
        let mut extremes: Vec<i64> = (0..n as u64)
            .map(|i| (i64::MIN as u64).wrapping_add(i * span) as i64)
            .collect();
        if n > 1 {
            extremes[n - 1] = i64::MAX;
        }
        vec![
            grid(n),
            (0..n as i64).map(|i| BASE + (i - i / 5) * STEP).collect(),
            (0..n as i64).map(|i| BASE + (i + i / 10) * STEP).collect(),
            jitter(1000, 1),
            jitter(1, 2),
            extremes,
            (0..n).map(|i| [i64::MIN, 0, i64::MAX][i * 3 / n]).collect(),
        ]
    }

    fn value_shapes(n: usize) -> Vec<Vec<u64>> {
        let specials = [
            0f64.to_bits(),
            (-0f64).to_bits(),
            f64::INFINITY.to_bits(),
            f64::NEG_INFINITY.to_bits(),
            f64::NAN.to_bits(),
            0x7ff8_0000_0000_0042,
            0xfff0_0000_0000_0001,
            STALE_NAN,
            EXACT_LIMIT.to_bits(),
            (-EXACT_LIMIT).to_bits(),
            (EXACT_LIMIT + 2.0).to_bits(),
            1.5f64.to_bits(),
        ];
        let mut walk = 0.0;
        vec![
            vec![0; n],
            vec![1f64.to_bits(); n],
            vec![(-0f64).to_bits(); n],
            vec![STALE_NAN; n],
            random(3)
                .take(n)
                .map(|r| ((r & 1) as f64).to_bits())
                .collect(),
            (0..n as u64)
                .map(|i| ((i * i * 7919) as f64).to_bits())
                .collect(),
            random(4)
                .take(n)
                .map(|r| ((r % 2000) as f64 - 1000.0).to_bits())
                .collect(),
            random(5)
                .take(n)
                .map(|r| (4_000_000_000_000.0 + (r % 4096) as f64).to_bits())
                .collect(),
            random(6)
                .take(n)
                .map(|r| ((r % 100_000) as f64 / 100.0).to_bits())
                .collect(),
            random(7)
                .take(n)
                .map(|r| (r as f64 / 7.0).to_bits())
                .collect(),
            random(8)
                .take(n)
                .map(|r| {
                    walk += (r >> 11) as f64 / (1u64 << 53) as f64;
                    f64::to_bits(walk)
                })
                .collect(),
            (0..n).map(|i| specials[i % specials.len()]).collect(),
            (0..n as u64)
                .map(|i| ((i % 9 + 1) as f64 * 1e-18).to_bits())
                .collect(),
            random(9).take(n).collect(),
        ]
    }

    #[test]
    fn roundtrip_preserves_bits_for_every_size_and_shape() {
        for n in [1, 2, 3, 64, 65, 127, 8192] {
            for ts in timestamp_shapes(n) {
                for bits in value_shapes(n) {
                    roundtrip(&ts, &bits);
                }
            }
        }
    }

    #[test]
    fn worst_case_blocks_stay_within_the_format_bound() {
        for n in [1, 2, 3, 64, 65, 8192] {
            let mut ts: Vec<i64> = random(10)
                .take(n)
                .map(|r| (r >> 1) as i64 - i64::MAX / 2)
                .collect();
            ts.sort_unstable();
            let bits: Vec<u64> = random(11).take(n).collect();
            let block = roundtrip(&ts, &bits);
            assert!(block.len() <= 32 + 18 * n);
        }
    }

    #[test]
    fn encoder_picks_the_expected_kinds() {
        let n = 240;
        let ts = grid(n);
        let block = roundtrip(&ts, &vec![7f64.to_bits(); n]);
        assert_eq!(kinds(&block), (TS_CONST_STEP, VALUE_CONST_INT));
        let counter: Vec<u64> = (0..n as u64).map(|i| ((i / 3) as f64).to_bits()).collect();
        assert_eq!(
            kinds(&roundtrip(&ts, &counter)),
            (TS_CONST_STEP, VALUE_INT_DELTA)
        );
        let small_gauge: Vec<u64> = random(12)
            .take(n)
            .map(|r| ((r % 10) as f64).to_bits())
            .collect();
        assert_eq!(kinds(&roundtrip(&ts, &small_gauge)).1, VALUE_INT_DELTA);
        for value in [0.5, -0.0, f64::NAN] {
            let block = roundtrip(&ts, &vec![value.to_bits(); n]);
            assert_eq!(kinds(&block), (TS_CONST_STEP, VALUE_CONST_F64));
        }
        let big = [4_398_046_511_104.0f64, 4_398_047_559_680.0];
        let flapping: Vec<u64> = (0..n).map(|i| big[i % 2].to_bits()).collect();
        assert_eq!(kinds(&roundtrip(&ts, &flapping)).1, VALUE_XOR);
        let halves: Vec<u64> = (0..64).map(|i| [1.0f64, 1.5][i % 2].to_bits()).collect();
        assert_eq!(kinds(&roundtrip(&grid(64), &halves)).1, VALUE_XOR);

        let block = roundtrip(&grid(3), &floats(&[0.1, 0.2, 0.35]));
        assert_eq!(kinds(&block), (TS_CONST_STEP, VALUE_ALP));
        assert_eq!(&block[1..3], &[2, 0]);
        let block = roundtrip(&grid(3), &floats(&[0.1, f64::NAN, 0.35]));
        assert_eq!(kinds(&block), (TS_CONST_STEP, VALUE_ALP));
        assert_eq!(&block[1..4], &[2, 1, 1]);
        let tiny: Vec<u64> = (1..=10).map(|i| (i as f64 / 1e18).to_bits()).collect();
        let block = roundtrip(&grid(10), &tiny);
        assert_eq!((kinds(&block).1, block[1]), (VALUE_ALP, 18));
        let mut rare: Vec<f64> = (0..100).map(|i| (i + 1) as f64 / 10.0).collect();
        rare[40] = 0.123_456_789_012_345;
        rare[70] = 1.987_654_321_098_765;
        let block = roundtrip(&grid(100), &floats(&rare));
        assert_eq!((kinds(&block).1, block[1], block[2]), (VALUE_ALP, 1, 2));

        let mut gaps = grid(100);
        for t in &mut gaps[50..] {
            *t += STEP;
        }
        assert_eq!(kinds(&roundtrip(&gaps, &counter[..100])).0, TS_RLE);
        for (unit, divisor) in [(1000, 1000u64), (1, 1)] {
            let ts: Vec<i64> = (0..n as i64)
                .zip(random(13))
                .map(|(i, r)| BASE + i * STEP + (r % 997) as i64 * unit)
                .collect();
            let block = roundtrip(&ts, &counter);
            assert_eq!(kinds(&block).0, TS_DOD);
            let mut pos = 1;
            assert_eq!(get_varint(&block, &mut pos).unwrap(), divisor);
        }
    }

    #[test]
    fn alp_exceptions_at_edges_and_in_runs_keep_their_bits() {
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
            let block = roundtrip(&grid(n), &bits);
            assert_eq!(kinds(&block).1, VALUE_ALP);
            assert_eq!(usize::from(block[2]), exceptions.len());
        }
    }

    #[test]
    fn negative_zero_is_never_a_decimal() {
        assert_eq!(exact_int((-0f64).to_bits()), None);
        assert!((0..=MAX_EXPONENT).all(|e| to_decimal((-0f64).to_bits(), e).is_none()));
        assert_eq!(to_decimal(0f64.to_bits(), 3), Some(0));
        let mixed = floats(&[0.0, -0.0, 0.25, -0.0, 0.0, 0.5]);
        roundtrip(&grid(6), &mixed);
    }

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

    #[test]
    fn corrupt_blocks_fail_and_leave_the_decoder_reusable() {
        let n = 200;
        let ts = timestamp_shapes(n)[3].clone();
        let mut valid = Vec::new();
        for bits in value_shapes(n) {
            valid.push((ts.clone(), bits));
        }
        let mut gaps = grid(n);
        gaps[n / 2..].iter_mut().for_each(|t| *t += STEP);
        valid.push((gaps, vec![0; n]));
        let mut decoder = SampleDecoder::default();
        let (mut out_ts, mut out_bits) = (Vec::new(), Vec::new());
        for (ts, bits) in &valid {
            let block = encode(ts, bits);
            let meta = meta(ts, block.len());
            for len in 0..block.len() {
                assert!(
                    decoder
                        .decode(&block[..len], &meta, &mut out_ts, &mut out_bits)
                        .is_err()
                );
                decoder
                    .decode(&block, &meta, &mut out_ts, &mut out_bits)
                    .unwrap();
                assert_eq!((&out_ts, &out_bits), (ts, bits));
            }
            let trailing = [block.as_slice(), &[0]].concat();
            assert!(
                decoder
                    .decode(&trailing, &meta, &mut out_ts, &mut out_bits)
                    .is_err()
            );
            for reserved in [0x20, 0x40, 0x80] {
                let mut bad = block.clone();
                bad[0] |= reserved;
                assert!(
                    decoder
                        .decode(&bad, &meta, &mut out_ts, &mut out_bits)
                        .is_err()
                );
            }
        }
    }

    #[test]
    fn crafted_invalid_blocks_are_rejected() {
        let rle = TS_RLE | (VALUE_CONST_INT << 2);
        let dod = TS_DOD | (VALUE_CONST_INT << 2);
        let xor = TS_CONST_STEP | (VALUE_XOR << 2);
        let alp = TS_CONST_STEP | (VALUE_ALP << 2);
        let three = meta(&[0, 10, 20], 0);
        let two = meta(&[0, 10], 0);
        let mut decoder = SampleDecoder::default();
        let (mut ts, mut bits) = (Vec::new(), Vec::new());
        let valid: [(&[u8], &BlockMeta); 3] = [
            (&[rle, 10, 1, 2, 0], &three),
            (&[alp, 1, 0, 2, 2, 2], &two),
            (&[dod, 5, 2, 0x02, 0], &three),
        ];
        for (block, meta) in valid {
            decoder.decode(block, meta, &mut ts, &mut bits).unwrap();
        }
        assert_eq!(bits, [0; 3]);
        let mut shifted = three.clone();
        shifted.max_timestamp = 30;
        let mut uneven = three.clone();
        uneven.max_timestamp = 5;
        let bad_xor_window = [&[xor][..], &[0; 8], &[0xff, 0x1f, 0, 0, 0, 0, 0, 0, 0, 0]].concat();
        let invalid: [(&[u8], &BlockMeta); 17] = [
            (&[rle | 3, 10, 1, 2, 0], &three),
            (&[TS_CONST_STEP | (5 << 2), 0], &three),
            (&[TS_CONST_STEP | (7 << 2), 0], &three),
            (&[rle, 10, 1, 0, 1, 2, 0], &three),
            (&[rle, 10, 1, 3, 0], &three),
            (&[rle, 0, 1, 2, 0], &three),
            (&[dod, 0, 2, 2, 0x02, 0], &three),
            (&[dod, 5, 65, 0], &three),
            (&[rle, 10, 1, 2, 0], &shifted),
            (&[TS_CONST_STEP, 0], &uneven),
            (
                &[xor, 0, 0, 0, 0, 0, 0, 0, 0, 0b01, 0, 0, 0, 0, 0, 0, 0, 0],
                &two,
            ),
            (&bad_xor_window, &two),
            (&[alp, 19, 0, 2, 2, 2], &two),
            (
                &[
                    alp, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2,
                ],
                &two,
            ),
            (
                &[
                    alp, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 4, 0,
                ],
                &three,
            ),
            (&[alp, 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 4, 0], &three),
            (&[rle, 10, 1, 2, 0, 0], &three),
        ];
        for (i, (block, meta)) in invalid.into_iter().enumerate() {
            assert!(
                decoder.decode(block, meta, &mut ts, &mut bits).is_err(),
                "case {i} decoded"
            );
            decoder
                .decode(valid[0].0, valid[0].1, &mut ts, &mut bits)
                .unwrap();
            assert_eq!(ts, [0, 10, 20]);
        }
    }
}
