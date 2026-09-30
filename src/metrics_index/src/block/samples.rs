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

//! Sample blocks: a tag naming each section's encoding, then the timestamp and value sections.

use anyhow::{Context, Result, bail, ensure};

use super::{
    BlockMeta, MAX_BLOCK_ROWS,
    codec::{
        Codec, alp, const_f64, const_int, const_step, dod, exact_int, int_delta, rle, scaled_steps,
        xor,
    },
};

/// Reusable scratch space for encoding sample blocks.
#[derive(Default)]
pub(super) struct SampleEncoder {
    quotients: Vec<u64>,
    ints: Vec<i64>,
    alp: alp::Encoder,
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
        let timestamps = self.encode_timestamps(ts, out);
        let values = self.encode_values(bits, out);
        out[start] = Codec::tag(timestamps, values);
        ensure!(
            out.len() - start <= max_block_len(u32::try_from(ts.len())?)?,
            "sample block exceeds format bound"
        );
        Ok(())
    }

    /// Candidates: ConstStep, else the smaller of Dod and Rle (Dod on a tie).
    fn encode_timestamps(&mut self, ts: &[i64], out: &mut Vec<u8>) -> Codec {
        if const_step::fits(ts) {
            return Codec::ConstStep;
        }
        let divisor = scaled_steps(ts, &mut self.quotients);
        let start = out.len();
        dod::encode(divisor, &self.quotients, out);
        if rle::encoded_len(divisor, &self.quotients) >= out.len() - start {
            return Codec::Dod;
        }
        out.truncate(start);
        rle::encode(divisor, &self.quotients, out);
        Codec::Rle
    }

    /// Candidates: ConstInt or ConstF64 when constant, IntDelta or Xor for integers, else Alp or
    /// Xor.
    fn encode_values(&mut self, bits: &[u64], out: &mut Vec<u8>) -> Codec {
        let first = bits[0];
        if bits.iter().all(|b| *b == first) {
            if let Some(value) = exact_int(first) {
                const_int::encode(value, out);
                return Codec::ConstInt;
            }
            const_f64::encode(first, out);
            return Codec::ConstF64;
        }
        self.ints.clear();
        if bits
            .iter()
            .all(|b| exact_int(*b).map(|v| self.ints.push(v)).is_some())
        {
            return self.encode_integers(bits, out);
        }
        let start = out.len();
        xor::encode(bits, out);
        let mid = out.len();
        if self.alp.encode(bits, out) && out.len() - mid < mid - start {
            out.copy_within(mid.., start);
            out.truncate(out.len() - (mid - start));
            return Codec::Alp;
        }
        out.truncate(mid);
        Codec::Xor
    }

    /// Non-decreasing integers never choose Xor, so they skip that attempt.
    fn encode_integers(&self, bits: &[u64], out: &mut Vec<u8>) -> Codec {
        let start = out.len();
        int_delta::encode(&self.ints, out);
        if self.ints.is_sorted() {
            return Codec::IntDelta;
        }
        let mid = out.len();
        xor::encode(bits, out);
        if out.len() - mid < mid - start {
            out.copy_within(mid.., start);
            out.truncate(out.len() - (mid - start));
            return Codec::Xor;
        }
        out.truncate(mid);
        Codec::IntDelta
    }
}

/// Reusable scratch space for decoding sample blocks.
#[derive(Default)]
pub(super) struct SampleDecoder {
    seq: Vec<u64>,
    alp: alp::Decoder,
}

impl SampleDecoder {
    pub(super) fn with_capacity(rows: usize) -> Self {
        Self {
            seq: Vec::with_capacity(rows),
            alp: alp::Decoder::default(),
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
        let mut pos = 0;
        self.decode_timestamps(Codec::from_id(tag & 0x0f)?, body, &mut pos, block, ts)?;
        self.decode_values(Codec::from_id(tag >> 4)?, body, &mut pos, rows, bits)?;
        ensure!(pos == body.len(), "trailing sample block bytes");
        Ok(())
    }

    fn decode_timestamps(
        &mut self,
        kind: Codec,
        body: &[u8],
        pos: &mut usize,
        block: &BlockMeta,
        ts: &mut Vec<i64>,
    ) -> Result<()> {
        let rows = block.row_count as usize;
        let (min, max) = (block.min_timestamp, block.max_timestamp);
        let last = match kind {
            Codec::ConstStep => const_step::decode(rows, min, max, ts)?,
            Codec::Dod => dod::decode(body, pos, rows, min, &mut self.seq, ts)?,
            Codec::Rle => rle::decode(body, pos, rows, min, ts)?,
            _ => bail!("{kind:?} is not a timestamp encoding"),
        };
        ensure!(last == max, "decoded timestamp bounds mismatch");
        Ok(())
    }

    fn decode_values(
        &mut self,
        kind: Codec,
        body: &[u8],
        pos: &mut usize,
        rows: usize,
        bits: &mut Vec<u64>,
    ) -> Result<()> {
        match kind {
            Codec::ConstInt => const_int::decode(body, pos, rows, bits),
            Codec::ConstF64 => const_f64::decode(body, pos, rows, bits),
            Codec::IntDelta => int_delta::decode(body, pos, rows, &mut self.seq, bits),
            Codec::Alp => self.alp.decode(body, pos, rows, &mut self.seq, bits),
            Codec::Xor => xor::decode(body, pos, rows, bits),
            _ => bail!("{kind:?} is not a value encoding"),
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::compact::get_varint;

    const STALE_NAN: u64 = 0x7ff0_0000_0000_0002;
    const STEP: i64 = 15_000_000;
    const BASE: i64 = 1_790_000_000_000_000;
    const LIMIT: f64 = 9_007_199_254_740_992.0;

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

    fn kinds(block: &[u8]) -> (Codec, Codec) {
        (
            Codec::from_id(block[0] & 0x0f).unwrap(),
            Codec::from_id(block[0] >> 4).unwrap(),
        )
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
            LIMIT.to_bits(),
            (-LIMIT).to_bits(),
            (LIMIT + 2.0).to_bits(),
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
        assert_eq!(kinds(&block), (Codec::ConstStep, Codec::ConstInt));
        let counter: Vec<u64> = (0..n as u64).map(|i| ((i / 3) as f64).to_bits()).collect();
        assert_eq!(
            kinds(&roundtrip(&ts, &counter)),
            (Codec::ConstStep, Codec::IntDelta)
        );
        let small_gauge: Vec<u64> = random(12)
            .take(n)
            .map(|r| ((r % 10) as f64).to_bits())
            .collect();
        assert_eq!(kinds(&roundtrip(&ts, &small_gauge)).1, Codec::IntDelta);
        for value in [0.5, -0.0, f64::NAN] {
            let block = roundtrip(&ts, &vec![value.to_bits(); n]);
            assert_eq!(kinds(&block), (Codec::ConstStep, Codec::ConstF64));
        }
        let big = [4_398_046_511_104.0f64, 4_398_047_559_680.0];
        let flapping: Vec<u64> = (0..n).map(|i| big[i % 2].to_bits()).collect();
        assert_eq!(kinds(&roundtrip(&ts, &flapping)).1, Codec::Xor);
        let halves: Vec<u64> = (0..64).map(|i| [1.0f64, 1.5][i % 2].to_bits()).collect();
        assert_eq!(kinds(&roundtrip(&grid(64), &halves)).1, Codec::Xor);

        let block = roundtrip(&grid(3), &floats(&[0.1, 0.2, 0.35]));
        assert_eq!(kinds(&block), (Codec::ConstStep, Codec::Alp));
        assert_eq!(&block[1..3], &[2, 0]);
        let block = roundtrip(&grid(3), &floats(&[0.1, f64::NAN, 0.35]));
        assert_eq!(kinds(&block), (Codec::ConstStep, Codec::Alp));
        assert_eq!(&block[1..4], &[2, 1, 1]);
        let tiny: Vec<u64> = (1..=10).map(|i| (i as f64 / 1e18).to_bits()).collect();
        let block = roundtrip(&grid(10), &tiny);
        assert_eq!((kinds(&block).1, block[1]), (Codec::Alp, 18));
        let mut rare: Vec<f64> = (0..100).map(|i| (i + 1) as f64 / 10.0).collect();
        rare[40] = 0.123_456_789_012_345;
        rare[70] = 1.987_654_321_098_765;
        let block = roundtrip(&grid(100), &floats(&rare));
        assert_eq!((kinds(&block).1, block[1], block[2]), (Codec::Alp, 1, 2));

        let mut gaps = grid(100);
        for t in &mut gaps[50..] {
            *t += STEP;
        }
        assert_eq!(kinds(&roundtrip(&gaps, &counter[..100])).0, Codec::Rle);
        for (unit, divisor) in [(1000, 1000u64), (1, 1)] {
            let ts: Vec<i64> = (0..n as i64)
                .zip(random(13))
                .map(|(i, r)| BASE + i * STEP + (r % 997) as i64 * unit)
                .collect();
            let block = roundtrip(&ts, &counter);
            assert_eq!(kinds(&block).0, Codec::Dod);
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
            assert_eq!(kinds(&block).1, Codec::Alp);
            assert_eq!(usize::from(block[2]), exceptions.len());
        }
    }

    #[test]
    fn mixed_signed_zeros_keep_their_bits() {
        roundtrip(&grid(6), &floats(&[0.0, -0.0, 0.25, -0.0, 0.0, 0.5]));
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
            for id in 0..16u8 {
                let timestamp_tag = (block[0] & 0xf0) | id;
                let value_tag = (block[0] & 0x0f) | (id << 4);
                for (tag, allowed) in [(timestamp_tag, id <= 2), (value_tag, (3..=7).contains(&id))]
                {
                    let mut bad = block.clone();
                    bad[0] = tag;
                    if !allowed {
                        assert!(
                            decoder
                                .decode(&bad, &meta, &mut out_ts, &mut out_bits)
                                .is_err()
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn crafted_invalid_blocks_are_rejected() {
        let rle = Codec::tag(Codec::Rle, Codec::ConstInt);
        let dod = Codec::tag(Codec::Dod, Codec::ConstInt);
        let xor = Codec::tag(Codec::ConstStep, Codec::Xor);
        let alp = Codec::tag(Codec::ConstStep, Codec::Alp);
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
        let invalid: [(&[u8], &BlockMeta); 19] = [
            (
                &[Codec::tag(Codec::ConstInt, Codec::ConstInt), 0, 0],
                &three,
            ),
            (&[Codec::tag(Codec::ConstStep, Codec::Rle), 0], &three),
            (&[0x38, 10, 1, 2, 0], &three),
            (&[0x80, 0], &three),
            (&[0xf0, 0], &three),
            (&[rle, 10, 1, 0, 1, 2, 0], &three),
            (&[rle, 10, 1, 3, 0], &three),
            (&[rle, 0, 1, 2, 0], &three),
            (&[dod, 0, 2, 2, 0x02, 0], &three),
            (&[dod, 5, 65, 0], &three),
            (&[rle, 10, 1, 2, 0], &shifted),
            (&[Codec::tag(Codec::ConstStep, Codec::ConstInt), 0], &uneven),
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
