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

//! Per-(org, stream) series state: retained set, budgets, TTL, `t_base` and sample emission.

use std::collections::{HashMap, HashSet, VecDeque};

use config::metrics;

use super::{
    EDGE_HARD_CAP, NODE_HARD_CAP, SERIES_TTL_MICROS,
    resolve::{REASON_CARDINALITY, SeriesKey, Staging},
    sql::WindowCounts,
};

/// `t_base` sits 1 ms before the first sample so the 0 baseline never shares a timestamp.
pub const BASELINE_OFFSET_MICROS: i64 = 1000;
const EVICT_TTL: &str = "ttl";
const EVICT_CAP: &str = "cap";
const DROP_NODE_CAP: &str = "node_cap";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Budgets {
    pub edges: usize,
    pub nodes: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Series {
    pub t_base: i64,
    pub first_emitted: bool,
    pub counts: WindowCounts,
    pub last_delta_at: i64,
    pub last_sample_ts: i64,
    pub dirty: bool,
    replay: Vec<(i64, WindowCounts)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sample {
    pub key: SeriesKey,
    pub ts: i64,
    pub counts: WindowCounts,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Batch {
    pub window_end: i64,
    pub samples: Vec<Sample>,
    /// Q4 instance gauges for retained agent edges; not series, so `mark_clean` ignores them.
    pub instances: Vec<(SeriesKey, u64)>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MergeReport {
    pub evicted_ttl: u64,
    pub evicted_cap: u64,
    pub dropped_cardinality: u64,
    pub dropped_node_cap: u64,
}

struct AdmitCtx<'a> {
    org: &'a str,
    now: i64,
    t_base: i64,
    touched: &'a HashSet<SeriesKey>,
    report: &'a mut MergeReport,
    victims: [Option<VecDeque<SeriesKey>>; 2],
}

pub struct StreamState {
    pub series: HashMap<SeriesKey, Series>,
    pub staging: Staging,
    pub pending: Option<Batch>,
    pub last_window_end: i64,
    pub budgets: Budgets,
    /// Learning generation whose staging pass this stream has already applied.
    pub staging_gen: u64,
    edges: usize,
    nodes: usize,
}

impl Series {
    fn new(t_base: i64, counts: WindowCounts, now: i64, replay: Vec<(i64, WindowCounts)>) -> Self {
        Self {
            t_base,
            first_emitted: false,
            counts,
            last_delta_at: now,
            last_sample_ts: 0,
            dirty: true,
            replay,
        }
    }

    fn add_delta(&mut self, counts: &WindowCounts, now: i64) {
        self.counts.add(counts);
        self.dirty = true;
        self.last_delta_at = now;
    }

    fn add_replay(&mut self, end: i64, counts: &WindowCounts) {
        match self.replay.binary_search_by_key(&end, |(e, _)| *e) {
            Ok(i) => self.replay[i].1.add(counts),
            Err(i) => self.replay.insert(i, (end, *counts)),
        }
        self.t_base = self.t_base.min(end - BASELINE_OFFSET_MICROS);
    }
}

impl Default for StreamState {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamState {
    pub fn new() -> Self {
        Self {
            series: HashMap::new(),
            staging: Staging::default(),
            pending: None,
            last_window_end: 0,
            budgets: budgets(0),
            staging_gen: 0,
            edges: 0,
            nodes: 0,
        }
    }

    pub fn retained(&self) -> (usize, usize) {
        (self.edges, self.nodes)
    }

    pub fn merge_window(
        &mut self,
        org: &str,
        window_end: i64,
        now: i64,
        services: usize,
        contributions: Vec<(SeriesKey, WindowCounts)>,
    ) -> MergeReport {
        let mut report = MergeReport::default();
        self.budgets = budgets(services);
        self.last_window_end = window_end;
        self.evict_ttl(org, now, &mut report);

        let mut touched = HashSet::new();
        let mut fresh: HashMap<SeriesKey, WindowCounts> = HashMap::new();
        for (key, counts) in contributions {
            match self.series.get_mut(&key) {
                Some(s) => {
                    s.add_delta(&counts, now);
                    touched.insert(key);
                }
                None => fresh.entry(key).or_default().add(&counts),
            }
        }
        let mut newcomers: Vec<(SeriesKey, WindowCounts)> = fresh.into_iter().collect();
        newcomers.sort_by(|a, b| b.1.requests.cmp(&a.1.requests).then_with(|| a.0.cmp(&b.0)));
        let mut ctx = AdmitCtx::new(org, now, window_end, &touched, &mut report);
        for (key, counts) in newcomers {
            self.admit(&mut ctx, key, vec![], counts);
        }
        report
    }

    pub fn admit_staged(
        &mut self,
        org: &str,
        admissions: Vec<(SeriesKey, Vec<(i64, WindowCounts)>)>,
        now: i64,
    ) -> MergeReport {
        let mut report = MergeReport::default();
        let touched = HashSet::new();
        let mut ctx = AdmitCtx::new(org, now, 0, &touched, &mut report);
        for (key, windows) in admissions {
            let Some((first_end, _)) = windows.first() else {
                continue;
            };
            if let Some(s) = self.series.get_mut(&key) {
                for (end, c) in &windows {
                    s.add_delta(c, now);
                    if !s.first_emitted {
                        s.add_replay(*end, c);
                    }
                }
                continue;
            }
            let mut total = WindowCounts::default();
            for (_, c) in &windows {
                total.add(c);
            }
            ctx.t_base = first_end - BASELINE_OFFSET_MICROS;
            self.admit(&mut ctx, key, windows, total);
        }
        report
    }

    /// `0 @ t_base` precedes a first emission, or the engine cannot count the first value.
    pub fn emit(&self, window_end: i64) -> Batch {
        let mut samples = Vec::with_capacity(self.series.len() * 2);
        for (key, s) in &self.series {
            if !s.first_emitted {
                samples.push(Sample {
                    key: key.clone(),
                    ts: s.t_base,
                    counts: WindowCounts::default(),
                });
                let mut cumulative = WindowCounts::default();
                for (ts, delta) in &s.replay {
                    if *ts >= window_end {
                        break;
                    }
                    cumulative.add(delta);
                    samples.push(Sample {
                        key: key.clone(),
                        ts: *ts,
                        counts: cumulative,
                    });
                }
            }
            samples.push(Sample {
                key: key.clone(),
                ts: window_end,
                counts: s.counts,
            });
        }
        Batch {
            window_end,
            samples,
            instances: vec![],
        }
    }

    /// After a delivered batch: the emitted deltas are on disk, so the series may be evicted again.
    pub fn mark_clean(&mut self, batch: &Batch) {
        for sample in &batch.samples {
            if let Some(s) = self.series.get_mut(&sample.key) {
                s.dirty = false;
                s.first_emitted = true;
                s.last_sample_ts = s.last_sample_ts.max(sample.ts);
                s.replay.clear();
            }
        }
    }

    fn admit(
        &mut self,
        ctx: &mut AdmitCtx<'_>,
        key: SeriesKey,
        replay: Vec<(i64, WindowCounts)>,
        counts: WindowCounts,
    ) {
        if self.take_slot(ctx, key.is_edge()) {
            self.insert(key, Series::new(ctx.t_base, counts, ctx.now, replay));
            return;
        }
        match key {
            SeriesKey::Edge { client, .. } => {
                ctx.report.dropped_cardinality += counts.requests;
                self.drop_for_cardinality(ctx, client, counts);
            }
            _ => Self::drop_for_node_cap(ctx, counts),
        }
    }

    fn drop_for_cardinality(
        &mut self,
        ctx: &mut AdmitCtx<'_>,
        client: String,
        counts: WindowCounts,
    ) {
        let key = SeriesKey::unresolved(&client, REASON_CARDINALITY);
        if let Some(s) = self.series.get_mut(&key) {
            s.add_delta(&counts, ctx.now);
            return;
        }
        if self.take_slot(ctx, false) {
            self.insert(key, Series::new(ctx.t_base, counts, ctx.now, vec![]));
        } else {
            Self::drop_for_node_cap(ctx, counts);
        }
    }

    fn drop_for_node_cap(ctx: &mut AdmitCtx<'_>, counts: WindowCounts) {
        ctx.report.dropped_node_cap += counts.requests;
        metrics::O2_SERVICE_GRAPH_DROPPED_REQUESTS_TOTAL
            .with_label_values(&[ctx.org, DROP_NODE_CAP])
            .inc_by(counts.requests);
    }

    fn take_slot(&mut self, ctx: &mut AdmitCtx<'_>, edge: bool) -> bool {
        let (used, budget) = if edge {
            (self.edges, self.budgets.edges)
        } else {
            (self.nodes, self.budgets.nodes)
        };
        if used < budget {
            return true;
        }
        let victims = ctx.victims[usize::from(edge)]
            .get_or_insert_with(|| self.eviction_candidates(edge, ctx.touched));
        // a queued candidate may have taken a delta since the queue was built
        while let Some(victim) = victims.pop_front() {
            if !self.series.get(&victim).is_some_and(|s| !s.dirty) {
                continue;
            }
            self.remove(&victim);
            ctx.report.evicted_cap += 1;
            if edge {
                metrics::O2_SERVICE_GRAPH_EVICTED_EDGES_TOTAL
                    .with_label_values(&[ctx.org, EVICT_CAP])
                    .inc();
            }
            return true;
        }
        false
    }

    fn eviction_candidates(&self, edge: bool, touched: &HashSet<SeriesKey>) -> VecDeque<SeriesKey> {
        let mut candidates: Vec<(i64, &SeriesKey)> = self
            .series
            .iter()
            .filter(|(k, s)| k.is_edge() == edge && !s.dirty && !touched.contains(*k))
            .map(|(k, s)| (s.last_delta_at, k))
            .collect();
        candidates.sort();
        candidates.into_iter().map(|(_, k)| k.clone()).collect()
    }

    /// Rule ②: idle for `SERIES_TTL` → evict; rule ①: a dirty series is never evicted.
    fn evict_ttl(&mut self, org: &str, now: i64, report: &mut MergeReport) {
        let expired: Vec<SeriesKey> = self
            .series
            .iter()
            .filter(|(_, s)| !s.dirty && now - s.last_delta_at > SERIES_TTL_MICROS)
            .map(|(k, _)| k.clone())
            .collect();
        for key in expired {
            let edge = key.is_edge();
            self.remove(&key);
            report.evicted_ttl += 1;
            if edge {
                metrics::O2_SERVICE_GRAPH_EVICTED_EDGES_TOTAL
                    .with_label_values(&[org, EVICT_TTL])
                    .inc();
            }
        }
    }

    fn insert(&mut self, key: SeriesKey, series: Series) {
        if key.is_edge() {
            self.edges += 1;
        } else {
            self.nodes += 1;
        }
        self.series.insert(key, series);
    }

    fn remove(&mut self, key: &SeriesKey) {
        if self.series.remove(key).is_some() {
            if key.is_edge() {
                self.edges -= 1;
            } else {
                self.nodes -= 1;
            }
        }
    }
}

impl<'a> AdmitCtx<'a> {
    fn new(
        org: &'a str,
        now: i64,
        window_end: i64,
        touched: &'a HashSet<SeriesKey>,
        report: &'a mut MergeReport,
    ) -> Self {
        Self {
            org,
            now,
            t_base: window_end - BASELINE_OFFSET_MICROS,
            touched,
            report,
            victims: [None, None],
        }
    }
}

/// Design §4.4: `clamp(10·services, 20000, 50000)` edges, `clamp(3·services, 5000, 15000)` nodes.
pub fn budgets(services: usize) -> Budgets {
    Budgets {
        edges: (10 * services).clamp(20_000, EDGE_HARD_CAP),
        nodes: (3 * services).clamp(5_000, NODE_HARD_CAP),
    }
}

#[cfg(test)]
mod tests {
    use config::utils::time::SECOND_MICRO_SECS;

    use super::{super::resolve::REASON_NO_PEER, *};

    const NOW: i64 = 1_700_000_000 * SECOND_MICRO_SECS;

    fn counts(n: u64) -> WindowCounts {
        WindowCounts {
            requests: n,
            errors: n / 2,
            dur_sum: n as i64 * 500,
            buckets: [n; 17],
        }
    }

    fn edge(i: usize) -> SeriesKey {
        SeriesKey::edge("a", &format!("s{i}"), "")
    }

    fn samples_for<'a>(batch: &'a Batch, key: &SeriesKey) -> Vec<&'a Sample> {
        batch.samples.iter().filter(|s| &s.key == key).collect()
    }

    fn ts_requests(batch: &Batch, key: &SeriesKey) -> Vec<(i64, u64)> {
        samples_for(batch, key)
            .iter()
            .map(|s| (s.ts, s.counts.requests))
            .collect()
    }

    #[test]
    fn test_budgets_clamp() {
        assert_eq!(
            budgets(0),
            Budgets {
                edges: 20_000,
                nodes: 5_000
            }
        );
        assert_eq!(
            budgets(3_000),
            Budgets {
                edges: 30_000,
                nodes: 9_000
            }
        );
        assert_eq!(
            budgets(100_000),
            Budgets {
                edges: EDGE_HARD_CAP,
                nodes: NODE_HARD_CAP
            }
        );
    }

    #[test]
    fn test_t_base_fixed_and_first_emission_has_baseline() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        st.merge_window("o", w1, NOW, 1, vec![(edge(1), counts(5))]);
        let s = &st.series[&edge(1)];
        assert_eq!(s.t_base, w1 - 1000);
        assert!(s.dirty);
        let batch = st.emit(w1);
        assert!(batch.instances.is_empty());
        assert_eq!(ts_requests(&batch, &edge(1)), vec![(w1 - 1000, 0), (w1, 5)]);
        st.mark_clean(&batch);
        let s = &st.series[&edge(1)];
        assert!(!s.dirty && s.first_emitted);
        assert_eq!(s.last_sample_ts, w1);

        let w2 = w1 + 60 * SECOND_MICRO_SECS;
        st.merge_window("o", w2, NOW, 1, vec![(edge(1), counts(3))]);
        assert_eq!(st.series[&edge(1)].t_base, w1 - 1000);
        let batch = st.emit(w2);
        let got = samples_for(&batch, &edge(1));
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].ts, got[0].counts.requests), (w2, 8));
        assert_eq!(got[0].counts.errors, 3);
        assert_eq!(got[0].counts.buckets[3], 8);
    }

    #[test]
    fn test_window_without_delta_repeats_last_value() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        st.merge_window("o", w1, NOW, 1, vec![(edge(1), counts(5))]);
        st.mark_clean(&st.emit(w1));
        let w2 = w1 + 60 * SECOND_MICRO_SECS;
        st.merge_window("o", w2, NOW, 1, vec![]);
        let batch = st.emit(w2);
        assert_eq!(ts_requests(&batch, &edge(1)), vec![(w2, 5)]);
        assert!(!st.series[&edge(1)].dirty);
    }

    #[test]
    fn test_staged_admission_case1_replays_in_order() {
        let mut st = StreamState::new();
        let w = |i: i64| 100 * SECOND_MICRO_SECS + i * 60 * SECOND_MICRO_SECS;
        st.merge_window("o", w(3), NOW, 1, vec![(SeriesKey::node("s1"), counts(1))]);
        st.mark_clean(&st.emit(w(3)));
        let windows = vec![(w(1), counts(2)), (w(2), counts(3)), (w(3), counts(4))];
        st.admit_staged("o", vec![(edge(1), windows)], NOW);
        let s = &st.series[&edge(1)];
        assert_eq!(s.t_base, w(1) - 1000);
        assert_eq!(s.counts.requests, 9);
        let batch = st.emit(w(4));
        assert_eq!(
            ts_requests(&batch, &edge(1)),
            vec![(w(1) - 1000, 0), (w(1), 2), (w(2), 5), (w(3), 9), (w(4), 9)]
        );
        assert_eq!(samples_for(&batch, &edge(1))[2].counts.buckets[0], 5);
        st.mark_clean(&batch);
        assert_eq!(st.series[&edge(1)].last_sample_ts, w(4));
        assert!(st.series[&edge(1)].replay.is_empty());
    }

    #[test]
    fn test_staged_keys_converging_on_one_unemitted_edge_merge_per_window() {
        let mut st = StreamState::new();
        let w = |i: i64| 100 * SECOND_MICRO_SECS + i * 60 * SECOND_MICRO_SECS;
        st.admit_staged("o", vec![(edge(1), vec![(w(2), counts(1))])], NOW);
        st.admit_staged(
            "o",
            vec![(
                edge(1),
                vec![(w(1), counts(2)), (w(2), counts(2)), (w(3), counts(4))],
            )],
            NOW,
        );
        let s = &st.series[&edge(1)];
        assert!(!s.first_emitted);
        assert_eq!(s.t_base, w(1) - 1000);
        assert_eq!(s.counts.requests, 9);
        let batch = st.emit(w(4));
        assert_eq!(
            ts_requests(&batch, &edge(1)),
            vec![(w(1) - 1000, 0), (w(1), 2), (w(2), 5), (w(3), 9), (w(4), 9)]
        );

        st.merge_window("o", w(5), NOW, 1, vec![(edge(2), counts(1))]);
        st.admit_staged("o", vec![(edge(2), vec![(w(4), counts(3))])], NOW);
        let batch = st.emit(w(5));
        assert_eq!(st.series[&edge(2)].t_base, w(4) - 1000);
        assert_eq!(
            ts_requests(&batch, &edge(2)),
            vec![(w(4) - 1000, 0), (w(4), 3), (w(5), 4)]
        );
    }

    #[test]
    fn test_staged_admission_case2_folds_into_next_sample() {
        let mut st = StreamState::new();
        let w = |i: i64| 100 * SECOND_MICRO_SECS + i * 60 * SECOND_MICRO_SECS;
        st.merge_window("o", w(1), NOW, 1, vec![(edge(1), counts(5))]);
        st.mark_clean(&st.emit(w(1)));
        st.merge_window("o", w(2), NOW, 1, vec![(edge(1), counts(1))]);
        st.mark_clean(&st.emit(w(2)));
        let t_base = st.series[&edge(1)].t_base;
        st.admit_staged(
            "o",
            vec![(edge(1), vec![(w(1), counts(2)), (w(2), counts(3))])],
            NOW,
        );
        assert_eq!(st.series[&edge(1)].t_base, t_base);
        assert_eq!(st.series[&edge(1)].counts.requests, 11);
        let batch = st.emit(w(3));
        assert_eq!(ts_requests(&batch, &edge(1)), vec![(w(3), 11)]);
        assert!(batch.samples.iter().all(|s| s.ts > w(2)));
    }

    #[test]
    fn test_admission_never_emits_at_or_before_last_sample() {
        let mut st = StreamState::new();
        let w = |i: i64| 100 * SECOND_MICRO_SECS + i * 60 * SECOND_MICRO_SECS;
        for i in 1..=5 {
            st.merge_window("o", w(i), NOW, 1, vec![(SeriesKey::node("s1"), counts(1))]);
            st.mark_clean(&st.emit(w(i)));
        }
        st.admit_staged(
            "o",
            vec![(edge(2), vec![(w(4), counts(1)), (w(5), counts(1))])],
            NOW,
        );
        let batch = st.emit(w(6));
        for s in samples_for(&batch, &edge(2)) {
            assert!(s.ts <= w(6));
        }
        st.mark_clean(&batch);
        st.admit_staged("o", vec![(edge(2), vec![(w(5), counts(7))])], NOW);
        let batch = st.emit(w(7));
        assert_eq!(ts_requests(&batch, &edge(2)), vec![(w(7), 9)]);
    }

    #[test]
    fn test_dirty_series_never_evicted_and_ttl_eviction() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        st.merge_window(
            "o",
            w1,
            NOW,
            1,
            vec![(edge(1), counts(1)), (edge(2), counts(1))],
        );
        let batch = st.emit(w1);
        st.mark_clean(&Batch {
            window_end: w1,
            samples: batch
                .samples
                .into_iter()
                .filter(|s| s.key == edge(2))
                .collect(),
            instances: vec![],
        });
        let later = NOW + SERIES_TTL_MICROS + SECOND_MICRO_SECS;
        let report = st.merge_window("o", w1 + 60 * SECOND_MICRO_SECS, later, 1, vec![]);
        assert_eq!(report.evicted_ttl, 1);
        assert!(st.series.contains_key(&edge(1)));
        assert!(!st.series.contains_key(&edge(2)));
        assert_eq!(st.retained(), (1, 0));
    }

    #[test]
    fn test_cardinality_drop_counted_and_cap_eviction() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        let many: Vec<(SeriesKey, WindowCounts)> = (0..20_001)
            .map(|i| (edge(i), counts(if i == 20_000 { 1 } else { 100 })))
            .collect();
        let report = st.merge_window("o", w1, NOW, 1, many);
        assert_eq!(st.retained().0, 20_000);
        assert_eq!(report.dropped_cardinality, 1);
        assert!(!st.series.contains_key(&edge(20_000)));
        let unresolved = SeriesKey::unresolved("a", REASON_CARDINALITY);
        assert_eq!(st.series[&unresolved].counts.requests, 1);
        assert_eq!(st.retained().1, 1);

        st.mark_clean(&st.emit(w1));
        let w2 = w1 + 60 * SECOND_MICRO_SECS;
        let report = st.merge_window(
            "o",
            w2,
            NOW + SECOND_MICRO_SECS,
            1,
            vec![(edge(20_001), counts(9))],
        );
        assert_eq!(report.evicted_cap, 1);
        assert_eq!(report.dropped_cardinality, 0);
        assert!(st.series.contains_key(&edge(20_001)));
        assert_eq!(st.retained().0, 20_000);
    }

    #[test]
    fn test_cap_candidates_consumed_once_then_rejected() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        let full: Vec<(SeriesKey, WindowCounts)> =
            (0..20_000).map(|i| (edge(i), counts(10))).collect();
        st.merge_window("o", w1, NOW, 1, full);
        let batch = st.emit(w1);
        st.mark_clean(&Batch {
            window_end: w1,
            samples: batch
                .samples
                .into_iter()
                .filter(|s| s.key == edge(0) || s.key == edge(1))
                .collect(),
            instances: vec![],
        });
        let w2 = w1 + 60 * SECOND_MICRO_SECS;
        let newcomers: Vec<(SeriesKey, WindowCounts)> =
            (20_000..20_005).map(|i| (edge(i), counts(50))).collect();
        let report = st.merge_window("o", w2, NOW + SECOND_MICRO_SECS, 1, newcomers);
        assert_eq!(report.evicted_cap, 2);
        assert_eq!(report.dropped_cardinality, 150);
        assert!(!st.series.contains_key(&edge(0)) && !st.series.contains_key(&edge(1)));
        assert_eq!(st.retained().0, 20_000);
    }

    #[test]
    fn test_cap_victim_dirtied_before_eviction_is_skipped() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        let full: Vec<(SeriesKey, WindowCounts)> =
            (0..20_000).map(|i| (edge(i), counts(10))).collect();
        st.merge_window("o", w1, NOW, 1, full);
        st.mark_clean(&st.emit(w1));
        let x = SeriesKey::edge("x", "new1", "");
        let y = SeriesKey::edge("y", "new2", "");
        let report = st.admit_staged(
            "o",
            vec![
                (x.clone(), vec![(w1, counts(1))]),
                (edge(1), vec![(w1, counts(5))]),
                (y.clone(), vec![(w1, counts(1))]),
            ],
            NOW + SECOND_MICRO_SECS,
        );
        assert_eq!(report.evicted_cap, 2);
        assert!(!st.series.contains_key(&edge(0)));
        assert!(!st.series.contains_key(&edge(10)));
        let b = &st.series[&edge(1)];
        assert!(b.dirty);
        assert_eq!(b.counts.requests, 15);
        assert!(st.series.contains_key(&x) && st.series.contains_key(&y));
        assert_eq!(st.retained().0, 20_000);
    }

    #[test]
    fn test_node_cap_drops_unresolved_client() {
        let mut st = StreamState::new();
        let w1 = 100 * SECOND_MICRO_SECS;
        let mut contributions: Vec<(SeriesKey, WindowCounts)> = (0..5_000)
            .map(|i| (SeriesKey::node(&format!("n{i}")), counts(50)))
            .collect();
        contributions.push((SeriesKey::unresolved("x", REASON_NO_PEER), counts(1)));
        let report = st.merge_window("o", w1, NOW, 1, contributions);
        assert_eq!(st.retained().1, 5_000);
        assert_eq!(report.dropped_node_cap, 1);
        let report = st.merge_window("o", w1, NOW, 1, vec![(edge(1), counts(1))]);
        assert_eq!(report.dropped_node_cap, 0);
        assert_eq!(st.retained().0, 1);
    }
}
