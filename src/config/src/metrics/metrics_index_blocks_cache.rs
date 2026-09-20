// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::{Arc, LazyLock, Mutex};

use prometheus::{
    Gauge, IntCounter, IntCounterVec, Opts,
    core::{Collector, Desc},
    proto::MetricFamily,
};

use super::{NAMESPACE, create_const_labels};

pub static METRICS: LazyLock<CacheMetrics> = LazyLock::new(|| {
    CacheMetrics::new(
        crate::get_config()
            .search
            .metrics_index_blocks_cache_max_size
            .saturating_mul(1024 * 1024),
    )
});

#[derive(Clone)]
pub struct CacheMetrics {
    state: Arc<Mutex<CacheRecorder>>,
    descs: Arc<Vec<Desc>>,
}

impl CacheMetrics {
    pub fn new(limit: usize) -> Self {
        let state = CacheRecorder::new(limit);
        let descs = state
            .collectors()
            .iter()
            .flat_map(|collector| collector.desc().into_iter().cloned())
            .collect();
        Self {
            state: Arc::new(Mutex::new(state)),
            descs: Arc::new(descs),
        }
    }

    /// A scrape cannot observe partially updated cache accounting or event counters.
    pub fn update<T>(&self, update: impl FnOnce(&mut CacheRecorder) -> T) -> T {
        update(&mut self.state.lock().unwrap_or_else(|error| error.into_inner()))
    }
}

impl Collector for CacheMetrics {
    fn desc(&self) -> Vec<&Desc> {
        self.descs.iter().collect()
    }

    fn collect(&self) -> Vec<MetricFamily> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state
            .collectors()
            .iter()
            .flat_map(|collector| collector.collect())
            .collect()
    }
}

pub struct CacheRecorder {
    limit: Gauge,
    used: Gauge,
    entries: Gauge,
    components: prometheus::GaugeVec,
    lookups: IntCounterVec,
    admissions: IntCounter,
    admitted_bytes: IntCounter,
    replacements: IntCounter,
    replaced_bytes: IntCounter,
    rejections: IntCounterVec,
    evictions: IntCounterVec,
    evicted_bytes: IntCounterVec,
    invalidations: IntCounter,
    invalidated_bytes: IntCounter,
}

impl CacheRecorder {
    pub fn resident(&mut self, limit: usize, used: usize, entries: usize, components: [usize; 3]) {
        self.limit.set(limit as f64);
        self.used.set(used as f64);
        self.entries.set(entries as f64);
        for (component, bytes) in ["directory", "labels", "other"].into_iter().zip(components) {
            self.components
                .with_label_values(&[component])
                .set(bytes as f64);
        }
    }

    pub fn lookup(&mut self, result: LookupResult) {
        self.lookups.with_label_values(&[result.as_str()]).inc();
    }

    pub fn admitted(&mut self, bytes: usize, previous: Option<usize>) {
        self.admissions.inc();
        self.admitted_bytes.inc_by(bytes as u64);
        if let Some(previous) = previous {
            self.replacements.inc();
            self.replaced_bytes.inc_by(previous as u64);
        }
    }

    pub fn rejected(&mut self, reason: RejectionReason) {
        self.rejections.with_label_values(&[reason.as_str()]).inc();
    }

    pub fn evicted(&mut self, bytes: usize, reason: EvictionReason) {
        self.evictions.with_label_values(&[reason.as_str()]).inc();
        self.evicted_bytes
            .with_label_values(&[reason.as_str()])
            .inc_by(bytes as u64);
    }

    pub fn invalidated(&mut self, bytes: usize) {
        self.invalidations.inc();
        self.invalidated_bytes.inc_by(bytes as u64);
    }

    fn new(limit: usize) -> Self {
        let options = |suffix: &str, help: &str| {
            Opts::new(format!("metrics_index_blocks_cache_{suffix}"), help)
                .namespace(NAMESPACE)
                .const_labels(create_const_labels())
        };
        let mut state = Self {
            limit: Gauge::with_opts(options(
                "limit_bytes",
                "Budget in bytes applied by block metadata cache operations.",
            ))
            .expect("Metric created"),
            used: Gauge::with_opts(options(
                "used_bytes",
                "Resident block metadata cache accounting in bytes, not process RSS.",
            ))
            .expect("Metric created"),
            entries: Gauge::with_opts(options("entries", "Resident block metadata cache entries."))
                .expect("Metric created"),
            components: prometheus::GaugeVec::new(
                options(
                    "accounted_bytes",
                    "Components of resident block metadata cache accounting in bytes.",
                ),
                &["component"],
            )
            .expect("Metric created"),
            lookups: IntCounterVec::new(
                options(
                    "lookups_total",
                    "Block metadata cache key lookups before file binding validation.",
                ),
                &["result"],
            )
            .expect("Metric created"),
            admissions: IntCounter::with_opts(options(
                "admissions_total",
                "Successful block metadata cache admissions, including replacements.",
            ))
            .expect("Metric created"),
            admitted_bytes: IntCounter::with_opts(options(
                "admitted_bytes_total",
                "Accounted bytes of successful block metadata cache admissions.",
            ))
            .expect("Metric created"),
            replacements: IntCounter::with_opts(options(
                "replacements_total",
                "Resident block metadata cache entries replaced by admission.",
            ))
            .expect("Metric created"),
            replaced_bytes: IntCounter::with_opts(options(
                "replaced_bytes_total",
                "Old accounted bytes removed by block metadata cache replacements.",
            ))
            .expect("Metric created"),
            rejections: IntCounterVec::new(
                options(
                    "admission_rejections_total",
                    "Decoded block metadata candidates rejected from cache admission.",
                ),
                &["reason"],
            )
            .expect("Metric created"),
            evictions: IntCounterVec::new(
                options(
                    "evictions_total",
                    "Block metadata cache entries removed to enforce capacity or a lookup budget.",
                ),
                &["reason"],
            )
            .expect("Metric created"),
            evicted_bytes: IntCounterVec::new(
                options(
                    "evicted_bytes_total",
                    "Accounted bytes removed by block metadata cache evictions.",
                ),
                &["reason"],
            )
            .expect("Metric created"),
            invalidations: IntCounter::with_opts(options(
                "invalidations_total",
                "Resident block metadata cache entries explicitly invalidated.",
            ))
            .expect("Metric created"),
            invalidated_bytes: IntCounter::with_opts(options(
                "invalidated_bytes_total",
                "Accounted bytes removed by explicit block metadata cache invalidation.",
            ))
            .expect("Metric created"),
        };
        state.resident(limit, 0, 0, [0; 3]);
        for result in ["hit", "miss", "disabled"] {
            state.lookups.with_label_values(&[result]);
        }
        for reason in ["oversize", "disabled"] {
            state.rejections.with_label_values(&[reason]);
        }
        for reason in ["capacity", "limit_shrink"] {
            state.evictions.with_label_values(&[reason]);
            state.evicted_bytes.with_label_values(&[reason]);
        }
        state
    }

    fn collectors(&self) -> [&dyn Collector; 14] {
        [
            &self.limit,
            &self.used,
            &self.entries,
            &self.components,
            &self.lookups,
            &self.admissions,
            &self.admitted_bytes,
            &self.replacements,
            &self.replaced_bytes,
            &self.rejections,
            &self.evictions,
            &self.evicted_bytes,
            &self.invalidations,
            &self.invalidated_bytes,
        ]
    }
}

pub enum LookupResult {
    Hit,
    Miss,
    Disabled,
}
impl LookupResult {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Hit => "hit",
            Self::Miss => "miss",
            Self::Disabled => "disabled",
        }
    }
}

pub enum RejectionReason {
    Oversize,
    Disabled,
}
impl RejectionReason {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Oversize => "oversize",
            Self::Disabled => "disabled",
        }
    }
}

#[derive(Clone, Copy)]
pub enum EvictionReason {
    Capacity,
    LimitShrink,
}
impl EvictionReason {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Capacity => "capacity",
            Self::LimitShrink => "limit_shrink",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_budget_and_bounded_zero_series_exist_before_lookup() {
        let metrics = CacheMetrics::new(17 * 1024 * 1024);
        let registry = prometheus::Registry::new();
        registry.register(Box::new(metrics)).unwrap();
        let families = registry.gather();
        assert_eq!(families.len(), 14);
        for family in families {
            let expected = if family.name().ends_with("_limit_bytes") {
                (17 * 1024 * 1024) as f64
            } else {
                0.0
            };
            for metric in family.get_metric() {
                let value = if metric.gauge.is_some() {
                    metric.gauge.as_ref().unwrap().value()
                } else {
                    metric.counter.as_ref().unwrap().value()
                };
                assert_eq!(value, expected);
            }
            if family.name().ends_with("_lookups_total") {
                assert_eq!(family.get_metric().len(), 3);
            }
            if family.name().ends_with("_accounted_bytes") {
                assert_eq!(family.get_metric().len(), 3);
            }
        }
    }
}
