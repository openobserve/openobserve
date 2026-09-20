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

pub(super) struct ReadPlan {
    pub(super) ranges: Vec<Range<u64>>,
    payloads: Vec<(usize, Range<usize>)>,
}

impl ReadPlan {
    pub(super) fn into_payloads(self, reads: Vec<Bytes>) -> Result<Vec<Bytes>> {
        ensure!(
            reads.len() == self.ranges.len(),
            "incomplete coalesced read response"
        );
        for (bytes, range) in reads.iter().zip(&self.ranges) {
            let expected = usize::try_from(range.end - range.start)?;
            ensure!(bytes.len() == expected, "coalesced read length mismatch");
        }
        self.payloads
            .into_iter()
            .map(|(read, span)| {
                let bytes = reads.get(read).context("invalid block read index")?;
                ensure!(
                    span.start < span.end && span.end <= bytes.len(),
                    "invalid block read slice"
                );
                Ok(bytes.slice(span))
            })
            .collect()
    }
}

pub(super) fn plan_coalesced_ranges(
    source: &[Range<u64>],
    max_gap: u64,
    max_span: u64,
    max_total: u64,
) -> Result<ReadPlan> {
    ensure!(max_span > 0 && max_total > 0, "zero coalesced read budget");
    let mut selected_bytes = 0u64;
    for (position, range) in source.iter().enumerate() {
        ensure!(range.start < range.end, "empty or inverted block range");
        if position > 0 {
            ensure!(
                source[position - 1].end <= range.start,
                "unordered or overlapping block ranges"
            );
        }
        selected_bytes = selected_bytes
            .checked_add(range.end - range.start)
            .context("selected block bytes overflow")?;
    }
    ensure!(
        selected_bytes <= max_total,
        "selected blocks exceed read budget"
    );
    let mut gap_budget = max_total - selected_bytes;
    let mut ranges: Vec<Range<u64>> = Vec::with_capacity(source.len());
    let mut payloads = Vec::with_capacity(source.len());
    for range in source {
        let merge = ranges.last().is_some_and(|last| {
            let gap = range.start - last.end;
            gap <= max_gap && gap <= gap_budget && range.end - last.start <= max_span
        });
        if merge {
            let last = ranges.last_mut().expect("merge requires previous range");
            gap_budget -= range.start - last.end;
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
        let source = [10..14, 16..20, 20..23, 40..43];
        let plan = plan_coalesced_ranges(&source, 2, 16, 20).unwrap();
        assert_eq!(plan.ranges, vec![10..23, 40..43]);
        let data = (0..64u8).collect::<Vec<_>>();
        let reads = plan
            .ranges
            .iter()
            .map(|r| Bytes::copy_from_slice(&data[r.start as usize..r.end as usize]))
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
    fn reserves_all_selected_bytes_before_spending_gap_budget() {
        let source = [0..4, 6..10, 12..16];
        let plan = plan_coalesced_ranges(&source, 8, 64, 14).unwrap();
        assert_eq!(plan.ranges, vec![0..10, 12..16]);
        assert_eq!(plan.ranges.iter().map(|r| r.end - r.start).sum::<u64>(), 14);
        let plan = plan_coalesced_ranges(&source, 8, 64, 12).unwrap();
        assert_eq!(plan.ranges, source);
    }

    #[test]
    fn enforces_merged_span_and_keeps_a_large_single_range_intact() {
        let source = [0..4, 4..8, 8..12, 20..40];
        let plan = plan_coalesced_ranges(&source, 16, 8, 64).unwrap();
        assert_eq!(plan.ranges, vec![0..8, 8..12, 20..40]);
        let adjacent = plan_coalesced_ranges(&[0..1, 1..2], 0, 2, 2).unwrap();
        assert_eq!(adjacent.ranges, vec![0..2]);
    }

    #[test]
    fn rejects_invalid_ranges_and_budgets_without_allocating_payloads() {
        for source in [
            vec![Range { start: 1, end: 1 }],
            vec![Range { start: 3, end: 2 }],
            vec![2..5, 4..6],
            vec![8..9, 1..2],
        ] {
            assert!(plan_coalesced_ranges(&source, 10, 10, 100).is_err());
        }
        assert!(plan_coalesced_ranges(std::slice::from_ref(&(0..100)), 1, 100, 99).is_err());
        assert!(plan_coalesced_ranges(std::slice::from_ref(&(0..1)), 1, 0, 2).is_err());
        assert!(plan_coalesced_ranges(&[], 1, 1, 0).is_err());
        assert!(
            plan_coalesced_ranges(&[], 0, 1, 1)
                .unwrap()
                .ranges
                .is_empty()
        );
        let plan = plan_coalesced_ranges(
            &[u64::MAX - 4..u64::MAX - 2, u64::MAX - 1..u64::MAX],
            1,
            4,
            4,
        )
        .unwrap();
        assert_eq!(plan.ranges, vec![u64::MAX - 4..u64::MAX]);
    }

    #[test]
    fn rejects_missing_extra_short_and_long_read_results() {
        let make = || plan_coalesced_ranges(&[4..6, 8..10], 2, 6, 6).unwrap();
        assert!(make().into_payloads(vec![]).is_err());
        assert!(
            make()
                .into_payloads(vec![Bytes::from_static(b"12345")])
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
