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

use std::sync::LazyLock;

use prometheus::{
    Gauge, HistogramOpts, HistogramVec, IntCounter, IntCounterVec, Opts,
    core::{Collector, Desc},
    proto::MetricFamily,
};

use super::{HELP_SUFFIX, NAMESPACE, create_const_labels};

pub static INDEX_BLOCKS_CACHE_METRICS: LazyLock<IndexBlocksCacheMetrics> =
    LazyLock::new(IndexBlocksCacheMetrics::default);

#[derive(Clone)]
pub struct IndexBlocksCacheMetrics {
    pub used: Gauge,
    pub evictions: IntCounter,
    pub hits: IntCounter,
    pub misses: IntCounter,
    pub partial_hits: IntCounter,
}

impl Default for IndexBlocksCacheMetrics {
    fn default() -> Self {
        let options = |suffix: &str, help: &str| {
            Opts::new(format!("metrics_blocks_cache_{suffix}"), help)
                .namespace(NAMESPACE)
                .const_labels(create_const_labels())
        };
        Self {
            used: Gauge::with_opts(options(
                "used_bytes",
                "Resident block metadata cache accounting in bytes, not process RSS.",
            ))
            .expect("Metric created"),
            evictions: IntCounter::with_opts(options(
                "evictions_total",
                "Block metadata cache entries evicted for capacity or a lowered limit.",
            ))
            .expect("Metric created"),
            hits: IntCounter::with_opts(options(
                "hits_total",
                "Successful enabled block metadata cache key lookups before file binding validation, including partial hits; disabled-cache lookups excluded.",
            ))
            .expect("Metric created"),
            misses: IntCounter::with_opts(options(
                "misses_total",
                "Absent keys in initial enabled block metadata cache lookups; disabled-cache lookups excluded.",
            ))
            .expect("Metric created"),
            partial_hits: IntCounter::with_opts(options(
                "partial_hits_total",
                "Initial enabled block metadata cache key hits missing requested label columns, a subset of hits; disabled-cache lookups excluded.",
            ))
            .expect("Metric created"),
        }
    }
}

impl Collector for IndexBlocksCacheMetrics {
    fn desc(&self) -> Vec<&Desc> {
        [
            &self.used as &dyn Collector,
            &self.evictions,
            &self.hits,
            &self.misses,
            &self.partial_hits,
        ]
        .into_iter()
        .flat_map(Collector::desc)
        .collect()
    }

    fn collect(&self) -> Vec<MetricFamily> {
        [
            &self.used as &dyn Collector,
            &self.evictions,
            &self.hits,
            &self.misses,
            &self.partial_hits,
        ]
        .into_iter()
        .flat_map(Collector::collect)
        .collect()
    }
}

// query cache ratio for metrics
pub static QUERY_METRICS_CACHE_RATIO: LazyLock<HistogramVec> = LazyLock::new(|| {
    HistogramVec::new(
        HistogramOpts::new(
            "query_metrics_cache_ratio",
            "Querier metrics cache ratio.".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .buckets(vec![
            0.01, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0,
        ])
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

// promql series label cache metrics
pub static LABEL_CACHE_HIT_COUNT: LazyLock<IntCounterVec> = LazyLock::new(|| {
    IntCounterVec::new(
        Opts::new(
            "metrics_label_cache_hit_count",
            "promql series label cache hit count".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});
pub static LABEL_CACHE_MISS_COUNT: LazyLock<IntCounterVec> = LazyLock::new(|| {
    IntCounterVec::new(
        Opts::new(
            "metrics_label_cache_miss_count",
            "promql series label cache miss count".to_owned() + HELP_SUFFIX,
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization"],
    )
    .expect("Metric created")
});

pub(crate) fn register(registry: &prometheus::Registry) {
    // metrics for metrics index blocks cache
    registry
        .register(Box::new(INDEX_BLOCKS_CACHE_METRICS.clone()))
        .expect("Metric registered");

    // query cache ratio for metrics
    registry
        .register(Box::new(QUERY_METRICS_CACHE_RATIO.clone()))
        .expect("Metric registered");

    // promql series label cache metrics
    registry
        .register(Box::new(LABEL_CACHE_HIT_COUNT.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(LABEL_CACHE_MISS_COUNT.clone()))
        .expect("Metric registered");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_five_zero_families_exist_before_lookup() {
        let registry = prometheus::Registry::new();
        registry
            .register(Box::new(IndexBlocksCacheMetrics::default()))
            .unwrap();
        let families = registry.gather();
        assert_eq!(families.len(), 5);
        assert_eq!(
            families
                .iter()
                .map(|family| family.name())
                .collect::<Vec<_>>(),
            vec![
                "zo_metrics_blocks_cache_evictions_total",
                "zo_metrics_blocks_cache_hits_total",
                "zo_metrics_blocks_cache_misses_total",
                "zo_metrics_blocks_cache_partial_hits_total",
                "zo_metrics_blocks_cache_used_bytes",
            ]
        );
        for family in families {
            assert_eq!(family.get_metric().len(), 1);
            let metric = &family.get_metric()[0];
            assert!(
                metric
                    .get_label()
                    .iter()
                    .all(|label| { ["cluster", "instance", "role"].contains(&label.name()) })
            );
            let value = if let Some(gauge) = metric.gauge.as_ref() {
                gauge.value()
            } else {
                metric.counter.as_ref().unwrap().value()
            };
            assert_eq!(value, 0.0);
        }
    }
}
