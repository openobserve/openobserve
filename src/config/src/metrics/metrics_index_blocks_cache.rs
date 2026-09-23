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
    Gauge, IntCounter, Opts,
    core::{Collector, Desc},
    proto::MetricFamily,
};

use super::{NAMESPACE, create_const_labels};

pub static METRICS: LazyLock<CacheMetrics> = LazyLock::new(CacheMetrics::default);

#[derive(Clone)]
pub struct CacheMetrics {
    pub used: Gauge,
    pub evictions: IntCounter,
    pub hits: IntCounter,
}

impl Default for CacheMetrics {
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

impl Collector for CacheMetrics {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exactly_three_zero_families_exist_before_lookup() {
        let registry = prometheus::Registry::new();
        registry
            .register(Box::new(CacheMetrics::default()))
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
