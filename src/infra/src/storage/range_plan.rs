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

use std::ops::Range;

use anyhow::{Context, Result, ensure};
use bytes::Bytes;

const DEFAULT_MAX_GAP: u64 = 16 * 1024;
const DEFAULT_MAX_SPAN: u64 = 16 * 1024 * 1024;

pub(crate) struct ReadPlan {
    pub(crate) ranges: Vec<Range<u64>>,
    payloads: Vec<(usize, Range<usize>)>,
}

impl ReadPlan {
    pub(crate) fn into_payloads(self, reads: Vec<Bytes>) -> Result<Vec<Bytes>> {
        ensure!(
            reads.len() == self.ranges.len(),
            "incomplete coalesced read response"
        );
        for (bytes, range) in reads.iter().zip(&self.ranges) {
            let expected = usize::try_from(range.end - range.start)?;
            ensure!(bytes.len() <= expected, "coalesced read length mismatch");
        }
        self.payloads
            .into_iter()
            .map(|(read, span)| {
                let bytes = reads.get(read).context("invalid coalesced read index")?;
                ensure!(
                    span.start < span.end && span.start < bytes.len(),
                    "invalid range read slice"
                );
                Ok(bytes.slice(span.start..span.end.min(bytes.len())))
            })
            .collect()
    }
}

pub(crate) fn plan_coalesced_ranges(source: &[Range<u64>]) -> Result<ReadPlan> {
    for (position, range) in source.iter().enumerate() {
        ensure!(range.start < range.end, "empty or inverted range");
        if position > 0 {
            ensure!(
                source[position - 1].end <= range.start,
                "unordered or overlapping ranges"
            );
        }
    }
    let mut ranges: Vec<Range<u64>> = Vec::with_capacity(source.len());
    let mut payloads = Vec::with_capacity(source.len());
    for range in source {
        let merge = ranges.last().is_some_and(|last| {
            let gap = range.start - last.end;
            gap <= DEFAULT_MAX_GAP && range.end - last.start <= DEFAULT_MAX_SPAN
        });
        if merge {
            let last = ranges.last_mut().expect("merge requires previous range");
            last.end = range.end;
        } else {
            ranges.push(range.clone());
        }
        let index = ranges.len() - 1;
        let base = ranges[index].start;
        payloads.push((
            index,
            usize::try_from(range.start - base)?..usize::try_from(range.end - base)?,
        ));
    }
    Ok(ReadPlan { ranges, payloads })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_only_bounded_gaps_and_restores_exact_payload_bytes() {
        let far = DEFAULT_MAX_GAP + 40;
        let source = [10..14, 16..20, 20..23, far..far + 3];
        let plan = plan_coalesced_ranges(&source).unwrap();
        assert_eq!(plan.ranges, vec![10..23, far..far + 3]);
        let data = (0..far + 3).map(|value| value as u8).collect::<Vec<_>>();
        let reads = plan
            .ranges
            .iter()
            .map(|range| Bytes::copy_from_slice(&data[range.start as usize..range.end as usize]))
            .collect();
        let payloads = plan.into_payloads(reads).unwrap();
        for (range, payload) in source.iter().zip(payloads) {
            assert_eq!(
                payload.as_ref(),
                &data[range.start as usize..range.end as usize]
            );
        }
    }

    #[test]
    fn merges_gaps_without_a_global_read_budget() {
        let half = DEFAULT_MAX_SPAN / 2;
        let source = [
            0..half,
            half + 1..DEFAULT_MAX_SPAN,
            DEFAULT_MAX_SPAN + 1..DEFAULT_MAX_SPAN + half,
        ];
        let plan = plan_coalesced_ranges(&source).unwrap();
        assert_eq!(
            plan.ranges,
            vec![
                0..DEFAULT_MAX_SPAN,
                DEFAULT_MAX_SPAN + 1..DEFAULT_MAX_SPAN + half
            ]
        );
        assert!(
            plan.ranges
                .iter()
                .map(|range| range.end - range.start)
                .sum::<u64>()
                > DEFAULT_MAX_SPAN
        );
    }

    #[test]
    fn enforces_default_span_and_keeps_a_large_single_range_intact() {
        let half = DEFAULT_MAX_SPAN / 2;
        let source = [
            0..half,
            half..DEFAULT_MAX_SPAN,
            DEFAULT_MAX_SPAN..DEFAULT_MAX_SPAN + 1,
        ];
        let plan = plan_coalesced_ranges(&source).unwrap();
        assert_eq!(
            plan.ranges,
            vec![0..DEFAULT_MAX_SPAN, DEFAULT_MAX_SPAN..DEFAULT_MAX_SPAN + 1]
        );
        let large = 0..DEFAULT_MAX_SPAN + 1;
        assert_eq!(
            plan_coalesced_ranges(std::slice::from_ref(&large))
                .unwrap()
                .ranges,
            vec![large]
        );
    }

    #[test]
    fn rejects_invalid_ranges_and_accepts_empty_input() {
        for source in [
            vec![Range { start: 1, end: 1 }],
            vec![Range { start: 3, end: 2 }],
            vec![2..5, 4..6],
            vec![8..9, 1..2],
        ] {
            assert!(plan_coalesced_ranges(&source).is_err());
        }
        assert!(plan_coalesced_ranges(&[]).unwrap().ranges.is_empty());
        let source = [u64::MAX - 4..u64::MAX - 2, u64::MAX - 1..u64::MAX];
        assert_eq!(
            plan_coalesced_ranges(&source).unwrap().ranges,
            vec![u64::MAX - 4..u64::MAX]
        );
    }

    #[test]
    fn validates_read_results_and_preserves_eof_clipping() {
        let make = || plan_coalesced_ranges(&[4..6, 8..10]).unwrap();
        assert!(make().into_payloads(vec![]).is_err());
        assert_eq!(
            make()
                .into_payloads(vec![Bytes::from_static(b"12345")])
                .unwrap(),
            vec![Bytes::from_static(b"12"), Bytes::from_static(b"5")]
        );
        assert!(
            make()
                .into_payloads(vec![Bytes::from_static(b"123")])
                .is_err()
        );
        assert!(
            make()
                .into_payloads(vec![Bytes::from_static(b"1234567")])
                .is_err()
        );
        assert!(
            make()
                .into_payloads(vec![Bytes::from_static(b"123456"), Bytes::new()])
                .is_err()
        );
        let good = make()
            .into_payloads(vec![Bytes::from_static(b"123456")])
            .unwrap();
        assert_eq!(
            good,
            vec![Bytes::from_static(b"12"), Bytes::from_static(b"56")]
        );
    }
}
