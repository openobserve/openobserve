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
    Gauge, HistogramOpts, HistogramVec, IntCounter, IntCounterVec, IntGaugeVec, Opts,
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
}

impl Default for IndexBlocksCacheMetrics {
    fn default() -> Self {
        let options = |suffix: &str, help: &str| {
            Opts::new(format!("metrics_index_blocks_cache_{suffix}"), help)
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
                "Successful block metadata cache key lookups before file binding validation.",
            ))
            .expect("Metric created"),
        }
    }
}

impl Collector for IndexBlocksCacheMetrics {
    fn desc(&self) -> Vec<&Desc> {
        [&self.used as &dyn Collector, &self.evictions, &self.hits]
            .into_iter()
            .flat_map(Collector::desc)
            .collect()
    }

    fn collect(&self) -> Vec<MetricFamily> {
        [&self.used as &dyn Collector, &self.evictions, &self.hits]
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

// metrics for metrics index selection cache
pub static INDEX_SELECTION_CACHE_MEMORY_USAGE: LazyLock<IntGaugeVec> = LazyLock::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "metrics_index_selection_cache_memory_usage",
            "Total memory usage (bytes) of metrics index selection cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static INDEX_SELECTION_CACHE_GC_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    IntCounterVec::new(
        Opts::new(
            "metrics_index_selection_cache_gc_total",
            "Total number of GC of metrics index selection cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static INDEX_SELECTION_CACHE_REQUESTS_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    IntCounterVec::new(
        Opts::new(
            "metrics_index_selection_cache_requests_total",
            "Total number of search of metrics index selection cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
    )
    .expect("Metric created")
});

pub static INDEX_SELECTION_CACHE_HITS_TOTAL: LazyLock<IntCounterVec> = LazyLock::new(|| {
    IntCounterVec::new(
        Opts::new(
            "metrics_index_selection_cache_hits_total",
            "Total number of hit of metrics index selection cache",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &[],
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

    // metrics for metrics index selection cache
    registry
        .register(Box::new(INDEX_SELECTION_CACHE_MEMORY_USAGE.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INDEX_SELECTION_CACHE_GC_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INDEX_SELECTION_CACHE_REQUESTS_TOTAL.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INDEX_SELECTION_CACHE_HITS_TOTAL.clone()))
        .expect("Metric registered");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_three_zero_families_exist_before_lookup() {
        let registry = prometheus::Registry::new();
        registry
            .register(Box::new(IndexBlocksCacheMetrics::default()))
            .unwrap();
        let families = registry.gather();
        assert_eq!(families.len(), 3);
        assert_eq!(
            families
                .iter()
                .map(|family| family.name())
                .collect::<Vec<_>>(),
            vec![
                "zo_metrics_index_blocks_cache_evictions_total",
                "zo_metrics_index_blocks_cache_hits_total",
                "zo_metrics_index_blocks_cache_used_bytes",
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
