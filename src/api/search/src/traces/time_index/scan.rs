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

//! One shared backward scan per stream over a batch of unresolved keys,
//! replacing per-key locate/expand fan-out. The scanner is a pure state
//! machine: the async driver asks it which window to query next and feeds
//! the rows back, so the completion logic is unit-testable without a store.
//!
//! Correctness shape (see the design doc): a naive "locate then expand the
//! merged range" is wrong for unrelated keys — a miss window between two
//! distant keys would end expansion before the older key is found. Instead
//! the scan stays contiguous and each key completes individually once the
//! covered region extends one expand window past its leftmost hit (the right
//! side is covered by construction, since the scan starts at the top).

use super::{TimeIndexKind, TraceTimeRange};

/// A wildly-scattered UUID cluster degenerates into re-scanning everything,
/// so wider clusters fall through to the main scan.
const UUID_ISLAND_MAX_WIDTH_WINDOWS: i64 = 8;
/// Defensive backstop against a window-emission logic bug; the deadline is
/// the real bound.
const MAX_WINDOWS: u32 = 1000;

/// Per-key verdict for one stream, mirroring the API's three states plus the
/// partial rider.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ScanOutcome {
    Found {
        range: TraceTimeRange,
        partial: bool,
    },
    NotFound,
    Timeout,
}

#[derive(Clone, Copy, Debug)]
enum KeyState {
    Unseen,
    Seen(TraceTimeRange),
    Complete {
        range: TraceTimeRange,
        partial: bool,
    },
    Skipped,
    Absent,
}

impl KeyState {
    fn is_active(&self) -> bool {
        matches!(self, KeyState::Unseen | KeyState::Seen(_))
    }
}

/// A covered span detached from the main scan: a probe window, its growth
/// toward the attached keys' completion margins, or the whole scan span when
/// boundary keys must grow past the caller bounds.
#[derive(Debug)]
struct Island {
    left: i64,
    right: i64,
    keys: Vec<usize>,
}

#[derive(Clone, Copy, Debug)]
enum Pending {
    Probe {
        left: i64,
        right: i64,
    },
    IslandGrow {
        island: usize,
        left: i64,
        right: i64,
    },
    Main {
        left: i64,
    },
}

/// Scan bounds: locate walks `[scan_start, scan_end]`; completion margins and
/// island growth clamp to the hard bounds, so found ranges are never
/// truncated by a caller range.
#[derive(Clone, Copy, Debug)]
pub(super) struct ScanBounds {
    pub scan_start: i64,
    pub scan_end: i64,
    pub hard_start: i64,
    pub hard_end: i64,
}

pub(super) struct BatchScanner {
    margin: i64,
    bounds: ScanBounds,
    keys: Vec<KeyState>,
    islands: Vec<Island>,
    probes: Vec<(i64, i64)>,
    cursor: i64,
    batch_index: usize,
    main_done: bool,
    pending: Option<Pending>,
    windows_emitted: u32,
}

impl BatchScanner {
    pub(super) fn new(
        kind: TimeIndexKind,
        key_count: usize,
        bounds: ScanBounds,
        hint_ts: Option<i64>,
        key_uuid_ts: &[Option<i64>],
    ) -> Self {
        let margin = kind.expand_window();
        let mut probes = Vec::new();
        if let Some(hint) = hint_ts {
            probes.push((hint.saturating_sub(margin), hint.saturating_add(margin)));
        }
        let uuid_ts: Vec<i64> = key_uuid_ts.iter().copied().flatten().collect();
        if let (Some(&min), Some(&max)) = (uuid_ts.iter().min(), uuid_ts.iter().max())
            && max.saturating_sub(min) <= UUID_ISLAND_MAX_WIDTH_WINDOWS * margin
        {
            probes.push((min.saturating_sub(margin), max.saturating_add(margin)));
        }
        let probes = merge_and_clamp(probes, bounds.scan_start, bounds.scan_end);
        Self {
            margin,
            bounds,
            keys: vec![KeyState::Unseen; key_count],
            islands: Vec::new(),
            probes,
            cursor: bounds.scan_end,
            batch_index: 0,
            main_done: false,
            pending: None,
            windows_emitted: 0,
        }
    }

    /// Keys worth putting in the next window's `IN` list: every key that is
    /// neither terminal nor skipped. A completed key's rows are already
    /// merged, so re-listing it buys nothing.
    pub(super) fn active_keys(&self) -> Vec<usize> {
        self.keys
            .iter()
            .enumerate()
            .filter(|(_, state)| state.is_active())
            .map(|(index, _)| index)
            .collect()
    }

    /// Drop an unseen key because another stream resolved it. A key already
    /// seen here keeps completing — the response reports what the index holds.
    pub(super) fn skip_key(&mut self, key: usize) {
        if matches!(self.keys[key], KeyState::Unseen) {
            self.keys[key] = KeyState::Skipped;
        }
    }

    fn has_active_keys(&self) -> bool {
        self.keys.iter().any(KeyState::is_active)
    }

    /// The next window to query, closed interval `[start, end]`, or None when
    /// the scan is finished. Must alternate with `ingest`.
    pub(super) fn next_window(&mut self) -> Option<(i64, i64)> {
        debug_assert!(self.pending.is_none(), "ingest the previous window first");
        if self.windows_emitted >= MAX_WINDOWS {
            return None;
        }
        let pending = loop {
            if !self.has_active_keys() {
                return None;
            }
            if let Some((left, right)) = self.probes.pop() {
                break Pending::Probe { left, right };
            }
            if let Some(pending) = self.next_island_window() {
                break pending;
            }
            if self.main_done {
                return None;
            }
            if let Some(pending) = self.next_main_window() {
                break pending;
            }
            self.finish_main();
        };
        self.windows_emitted += 1;
        self.pending = Some(pending);
        match pending {
            Pending::Probe { left, right } | Pending::IslandGrow { left, right, .. } => {
                Some((left, right))
            }
            Pending::Main { left } => Some((left, self.cursor)),
        }
    }

    /// Feed back the rows of the window handed out by `next_window`, merged
    /// per key. Returns the keys first seen in this window (for cross-stream
    /// pruning).
    pub(super) fn ingest(&mut self, rows: Vec<(usize, TraceTimeRange)>) -> Vec<usize> {
        let pending = self.pending.take().expect("no window pending");
        let mut newly_seen = Vec::new();
        for (key, range) in rows {
            match self.keys[key] {
                KeyState::Unseen => {
                    self.keys[key] = KeyState::Seen(range);
                    newly_seen.push(key);
                }
                KeyState::Seen(existing) => self.keys[key] = KeyState::Seen(existing.merge(range)),
                // Skipped keys are not in the IN list, so no rows arrive.
                KeyState::Skipped | KeyState::Complete { .. } | KeyState::Absent => {}
            }
        }
        match pending {
            Pending::Probe { left, right } => {
                // Keep the span even with no hits: the main scan jumps over it.
                self.islands.push(Island {
                    left,
                    right,
                    keys: newly_seen.clone(),
                });
            }
            Pending::IslandGrow {
                island,
                left,
                right,
            } => {
                let island = &mut self.islands[island];
                island.left = island.left.min(left);
                island.right = island.right.max(right);
                island.keys.extend(newly_seen.iter().copied());
            }
            Pending::Main { left } => {
                self.cursor = left;
                self.complete_main_keys();
            }
        }
        newly_seen
    }

    /// Terminal per-key outcomes, derived purely from key state: an
    /// interrupted scan leaves keys Seen (partial find) or Unseen
    /// (indeterminate). Skipped keys yield None — another stream already
    /// answered for them.
    pub(super) fn finish(mut self) -> Vec<Option<ScanOutcome>> {
        self.settle();
        self.keys
            .into_iter()
            .map(|state| match state {
                KeyState::Complete { range, partial } => {
                    Some(ScanOutcome::Found { range, partial })
                }
                // An interrupted scan can only have covered part of the
                // margins, so a seen key is a partial find.
                KeyState::Seen(range) => Some(ScanOutcome::Found {
                    range,
                    partial: true,
                }),
                // Reachable via the deadline or the window backstop; either
                // way the scan bounds were not covered — indeterminate.
                KeyState::Unseen => Some(ScanOutcome::Timeout),
                KeyState::Absent => Some(ScanOutcome::NotFound),
                KeyState::Skipped => None,
            })
            .collect()
    }

    /// Advance every query-free transition — island completions, covered-span
    /// jumps, end-of-scan verdicts — so the outcome reflects what the covered
    /// region already proves. Without this, a deadline landing right after the
    /// last ingest would report a fully-covered miss as timeout and a
    /// margin-complete hit as partial.
    fn settle(&mut self) {
        self.complete_satisfied_islands();
        if self.main_done {
            return;
        }
        self.jump_covered_islands();
        self.complete_main_keys();
        if self.cursor <= self.bounds.scan_start {
            self.finish_main();
            self.complete_satisfied_islands();
        }
    }

    /// The span an island must cover to complete its attached keys.
    fn island_needs(&self, island: &Island) -> (i64, i64) {
        let mut needed_left = island.left;
        let mut needed_right = island.right;
        for &key in &island.keys {
            if let KeyState::Seen(range) = self.keys[key] {
                let (left, right) = margin_span(range, self.margin, self.bounds);
                needed_left = needed_left.min(left);
                needed_right = needed_right.max(right);
            }
        }
        (needed_left, needed_right)
    }

    /// Complete the keys of every island whose needs are already covered —
    /// a pure state transition, no queries involved.
    fn complete_satisfied_islands(&mut self) {
        for index in 0..self.islands.len() {
            let (needed_left, needed_right) = self.island_needs(&self.islands[index]);
            let island = &self.islands[index];
            if needed_left < island.left || needed_right > island.right {
                continue;
            }
            let keys = std::mem::take(&mut self.islands[index].keys);
            for key in keys {
                if let KeyState::Seen(range) = self.keys[key] {
                    self.keys[key] = KeyState::Complete {
                        range,
                        partial: false,
                    };
                }
            }
        }
    }

    /// The first island whose attached keys still need margin coverage gets a
    /// growth window.
    fn next_island_window(&mut self) -> Option<Pending> {
        self.complete_satisfied_islands();
        for index in 0..self.islands.len() {
            let (needed_left, needed_right) = self.island_needs(&self.islands[index]);
            let island = &self.islands[index];
            if needed_left < island.left {
                return Some(Pending::IslandGrow {
                    island: index,
                    left: needed_left,
                    right: island.left,
                });
            }
            if needed_right > island.right {
                return Some(Pending::IslandGrow {
                    island: index,
                    left: island.right,
                    right: needed_right,
                });
            }
        }
        None
    }

    /// Jump the cursor over spans probes or island growth already covered —
    /// a pure state transition, no queries involved. The strict left-edge
    /// comparison makes every jump lower the cursor, so the loop terminates;
    /// a cursor already at an island's left edge has nothing to gain.
    fn jump_covered_islands(&mut self) {
        loop {
            let mut jumped = false;
            for island in &self.islands {
                if island.left < self.cursor && self.cursor <= island.right {
                    self.cursor = island.left;
                    jumped = true;
                }
            }
            if !jumped {
                break;
            }
        }
    }

    fn next_main_window(&mut self) -> Option<Pending> {
        self.jump_covered_islands();
        if self.cursor <= self.bounds.scan_start {
            return None;
        }
        let batch = locate_batch_size(self.batch_index);
        self.batch_index += 1;
        let left = self
            .cursor
            .saturating_sub(batch)
            .max(self.bounds.scan_start);
        Some(Pending::Main { left })
    }

    /// After a main window: a seen key completes once the contiguous covered
    /// region `[cursor, scan_end]` extends one margin past both of its ends
    /// (clamps count as covered).
    fn complete_main_keys(&mut self) {
        for state in &mut self.keys {
            if let KeyState::Seen(range) = *state {
                let (needed_left, needed_right) = margin_span(range, self.margin, self.bounds);
                if self.cursor <= needed_left && self.bounds.scan_end >= needed_right {
                    *state = KeyState::Complete {
                        range,
                        partial: false,
                    };
                }
            }
        }
    }

    /// The main scan covered the whole `[scan_start, scan_end]`: unseen keys
    /// are proven absent; seen keys whose margins fall outside the caller
    /// bounds grow past them through a boundary island.
    fn finish_main(&mut self) {
        self.main_done = true;
        let mut boundary_keys = Vec::new();
        for (index, state) in self.keys.iter_mut().enumerate() {
            match *state {
                KeyState::Unseen => *state = KeyState::Absent,
                KeyState::Seen(_) => boundary_keys.push(index),
                _ => {}
            }
        }
        if !boundary_keys.is_empty() {
            self.islands.push(Island {
                left: self.bounds.scan_start,
                right: self.bounds.scan_end,
                keys: boundary_keys,
            });
        }
    }
}

/// A range's completion margins: one expand window past each end, clamped to
/// the hard bounds (a clamp counts as covered).
pub(super) fn margin_span(range: TraceTimeRange, margin: i64, bounds: ScanBounds) -> (i64, i64) {
    (
        range
            .start_time
            .saturating_sub(margin)
            .max(bounds.hard_start),
        range.end_time.saturating_add(margin).min(bounds.hard_end),
    )
}

/// The session-causality floor: spans cannot precede their session's UUID v7
/// creation time, so the hard bound can rise to one expand window below the
/// earliest key. Only sound when every key carries a timestamp.
pub(super) fn session_uuid_floor(kind: TimeIndexKind, key_uuid_ts: &[Option<i64>]) -> Option<i64> {
    if kind != TimeIndexKind::Session || key_uuid_ts.is_empty() {
        return None;
    }
    let mut earliest = i64::MAX;
    for ts in key_uuid_ts {
        earliest = earliest.min((*ts)?);
    }
    Some(earliest.saturating_sub(kind.expand_window()))
}

fn locate_batch_size(index: usize) -> i64 {
    super::locate_batch_sizes().nth(index).unwrap_or(i64::MAX)
}

fn merge_and_clamp(mut spans: Vec<(i64, i64)>, min: i64, max: i64) -> Vec<(i64, i64)> {
    spans.sort_unstable();
    let mut merged: Vec<(i64, i64)> = Vec::with_capacity(spans.len());
    for (left, right) in spans {
        let (left, right) = (left.max(min), right.min(max));
        if left >= right {
            continue;
        }
        match merged.last_mut() {
            Some(last) if left <= last.1 => last.1 = last.1.max(right),
            _ => merged.push((left, right)),
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::{
        super::{EXPAND_WINDOW, SESSION_EXPAND_WINDOW},
        *,
    };

    const W: i64 = EXPAND_WINDOW;

    fn bounds(scan_start: i64, scan_end: i64) -> ScanBounds {
        ScanBounds {
            scan_start,
            scan_end,
            hard_start: scan_start,
            hard_end: scan_end,
        }
    }

    fn range(start: i64, end: i64) -> TraceTimeRange {
        TraceTimeRange {
            start_time: start,
            end_time: end,
        }
    }

    /// Drives the scanner against a synthetic dataset of per-key spans and
    /// records the windows it queried.
    fn drive(scanner: &mut BatchScanner, data: &[(usize, TraceTimeRange)]) -> Vec<(i64, i64)> {
        let mut windows = Vec::new();
        while let Some((start, end)) = scanner.next_window() {
            windows.push((start, end));
            let rows = data
                .iter()
                .filter(|(_, r)| r.start_time <= end && r.end_time >= start)
                .map(|&(k, r)| (k, r))
                .collect();
            scanner.ingest(rows);
        }
        windows
    }

    #[test]
    fn single_key_completes_after_margin_is_covered() {
        let mut scanner =
            BatchScanner::new(TimeIndexKind::Trace, 1, bounds(0, W * 40), None, &[None]);
        let data = [(0usize, range(W * 30, W * 30 + 100))];
        drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        assert_eq!(
            outcomes[0],
            Some(ScanOutcome::Found {
                range: data[0].1,
                partial: false,
            })
        );
    }

    #[test]
    fn scan_continues_past_the_first_find_until_every_key_is_answered() {
        // k0 recent, k1 much older: the merged-range mistake would stop at
        // the miss gap after k0 and never reach k1.
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 40),
            None,
            &[None, None],
        );
        let data = [
            (0usize, range(W * 38, W * 38 + 10)),
            (1usize, range(W * 5, W * 5 + 10)),
        ];
        drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        assert_eq!(
            outcomes[0],
            Some(ScanOutcome::Found {
                range: data[0].1,
                partial: false,
            })
        );
        assert_eq!(
            outcomes[1],
            Some(ScanOutcome::Found {
                range: data[1].1,
                partial: false,
            })
        );
    }

    #[test]
    fn unseen_keys_are_proven_absent_only_after_full_coverage() {
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 40),
            None,
            &[None, None],
        );
        let data = [(0usize, range(W * 20, W * 20 + 10))];
        drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        assert!(matches!(outcomes[0], Some(ScanOutcome::Found { .. })));
        assert_eq!(outcomes[1], Some(ScanOutcome::NotFound));
    }

    #[test]
    fn timeout_reports_seen_keys_partial_and_unseen_indeterminate() {
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 400),
            None,
            &[None, None],
        );
        let data = [(0usize, range(W * 399, W * 399 + 10))];
        // One window, then the driver hits the deadline.
        let (start, end) = scanner.next_window().unwrap();
        let rows = data
            .iter()
            .filter(|(_, r)| r.start_time <= end && r.end_time >= start)
            .map(|&(k, r)| (k, r))
            .collect();
        scanner.ingest(rows);
        let outcomes = scanner.finish();
        assert_eq!(
            outcomes[0],
            Some(ScanOutcome::Found {
                range: data[0].1,
                partial: true,
            })
        );
        assert_eq!(outcomes[1], Some(ScanOutcome::Timeout));
    }

    #[test]
    fn hint_probe_resolves_clustered_keys_in_few_windows() {
        let hint = W * 20;
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 40),
            Some(hint),
            &[None, None],
        );
        let data = [
            (0usize, range(hint - 50, hint + 50)),
            (1usize, range(hint + 100, hint + 200)),
        ];
        let windows = drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        assert!(matches!(
            outcomes[0],
            Some(ScanOutcome::Found { partial: false, .. })
        ));
        assert!(matches!(
            outcomes[1],
            Some(ScanOutcome::Found { partial: false, .. })
        ));
        // probe + margin growth, then the main scan skips the covered island:
        // far fewer windows than two full backward scans.
        assert!(
            windows.len() <= 8,
            "expected a handful of windows, got {windows:?}"
        );
    }

    #[test]
    fn uuid_cluster_probe_is_dropped_when_too_wide() {
        let uuid_ts = [Some(W), Some(W * 30)];
        let scanner = BatchScanner::new(TimeIndexKind::Trace, 2, bounds(0, W * 40), None, &uuid_ts);
        assert!(scanner.probes.is_empty());

        let clustered = [Some(W * 20), Some(W * 21)];
        let scanner =
            BatchScanner::new(TimeIndexKind::Trace, 2, bounds(0, W * 40), None, &clustered);
        assert_eq!(scanner.probes.len(), 1);
    }

    #[test]
    fn boundary_key_grows_past_the_caller_bounds() {
        // Caller bound clips the scan to [10W, 12W] inside hard [0, 40W];
        // the key's data continues below the bound.
        let scan_bounds = ScanBounds {
            scan_start: W * 10,
            scan_end: W * 12,
            hard_start: 0,
            hard_end: W * 40,
        };
        let mut scanner = BatchScanner::new(TimeIndexKind::Trace, 1, scan_bounds, None, &[None]);
        let data = [(0usize, range(W * 9, W * 11))];
        drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        // The full range, including the part outside the caller bound.
        assert_eq!(
            outcomes[0],
            Some(ScanOutcome::Found {
                range: data[0].1,
                partial: false,
            })
        );
    }

    #[test]
    fn skipped_keys_leave_the_in_list_and_yield_no_outcome() {
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 4),
            None,
            &[None, None],
        );
        scanner.skip_key(1);
        assert_eq!(scanner.active_keys(), vec![0]);
        let data = [(0usize, range(W * 2, W * 2 + 10))];
        drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        assert!(matches!(outcomes[0], Some(ScanOutcome::Found { .. })));
        assert_eq!(outcomes[1], None);
    }

    #[test]
    fn probe_spans_merge_and_clamp() {
        let merged = merge_and_clamp(vec![(5, 10), (8, 20), (30, 40), (-5, 2)], 0, 35);
        assert_eq!(merged, vec![(0, 2), (5, 20), (30, 35)]);
    }

    #[test]
    fn missed_hint_island_does_not_trap_the_main_scan() {
        // A wrong hint leaves a keyless covered island; the main scan must
        // jump over it (and not spin at its left edge) and still answer both
        // keys from the region below.
        let hint = W * 30;
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 40),
            Some(hint),
            &[None, None],
        );
        let data = [(0usize, range(W * 5, W * 5 + 10))];
        drive(&mut scanner, &data);
        let outcomes = scanner.finish();
        assert!(matches!(
            outcomes[0],
            Some(ScanOutcome::Found { partial: false, .. })
        ));
        assert_eq!(outcomes[1], Some(ScanOutcome::NotFound));
    }

    #[test]
    fn deadline_after_full_coverage_still_proves_absence() {
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            2,
            bounds(0, W * 4),
            None,
            &[None, None],
        );
        let data = [(0usize, range(W * 2, W * 2 + 10))];
        // Stop right after ingesting the window that reaches scan_start,
        // without another next_window call — as the driver does on deadline.
        while let Some((start, end)) = scanner.next_window() {
            let rows = data
                .iter()
                .filter(|(_, r)| r.start_time <= end && r.end_time >= start)
                .map(|&(k, r)| (k, r))
                .collect();
            scanner.ingest(rows);
            if start <= 0 {
                break;
            }
        }
        let outcomes = scanner.finish();
        assert_eq!(
            outcomes[0],
            Some(ScanOutcome::Found {
                range: data[0].1,
                partial: false,
            })
        );
        assert_eq!(outcomes[1], Some(ScanOutcome::NotFound));
    }

    #[test]
    fn deadline_after_island_completion_is_not_partial() {
        let hint = W * 20;
        let mut scanner = BatchScanner::new(
            TimeIndexKind::Trace,
            1,
            bounds(0, W * 40),
            Some(hint),
            &[None],
        );
        let data = [(0usize, range(hint, hint))];
        // Probe window only; the deadline lands before any further window.
        let (start, end) = scanner.next_window().unwrap();
        let rows = data
            .iter()
            .filter(|(_, r)| r.start_time <= end && r.end_time >= start)
            .map(|&(k, r)| (k, r))
            .collect();
        scanner.ingest(rows);
        let outcomes = scanner.finish();
        assert_eq!(
            outcomes[0],
            Some(ScanOutcome::Found {
                range: data[0].1,
                partial: false,
            })
        );
    }

    #[test]
    fn session_floor_requires_every_key_to_carry_a_timestamp() {
        let full = [
            Some(SESSION_EXPAND_WINDOW * 10),
            Some(SESSION_EXPAND_WINDOW * 12),
        ];
        assert_eq!(
            session_uuid_floor(TimeIndexKind::Session, &full),
            Some(SESSION_EXPAND_WINDOW * 9)
        );
        let partial = [Some(SESSION_EXPAND_WINDOW * 10), None];
        assert_eq!(session_uuid_floor(TimeIndexKind::Session, &partial), None);
        assert_eq!(session_uuid_floor(TimeIndexKind::Trace, &full), None);
        assert_eq!(session_uuid_floor(TimeIndexKind::Session, &[]), None);
    }

    #[test]
    fn window_backstop_ends_as_indeterminate_not_proof() {
        let mut scanner =
            BatchScanner::new(TimeIndexKind::Trace, 1, bounds(0, W * 40), None, &[None]);
        scanner.windows_emitted = MAX_WINDOWS;
        assert!(scanner.next_window().is_none());
        let outcomes = scanner.finish();
        assert_eq!(outcomes[0], Some(ScanOutcome::Timeout));
    }
}
