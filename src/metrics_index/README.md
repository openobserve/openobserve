# Metrics index cache observability

The MIDX metadata cache is shared by metrics index pruning and streaming PromQL.
`ZO_METRICS_BLOCKS_CACHE_MAX_SIZE` sets its memory budget in MiB. Zero selects
5% of node memory, clamped to 128–4096 MiB; values 1–9 disable the cache;
values of at least 10 set an explicit budget.

| Metric | Meaning |
| --- | --- |
| `zo_metrics_blocks_cache_hits_total` | Initial enabled-cache lookups with an existing key, including partial hits. |
| `zo_metrics_blocks_cache_misses_total` | Initial enabled-cache lookups with an absent key. |
| `zo_metrics_blocks_cache_partial_hits_total` | Subset of key hits missing at least one requested label column. |
| `zo_metrics_blocks_cache_evictions_total` | Entries evicted for capacity or a reduced budget. |
| `zo_metrics_blocks_cache_used_bytes` | Estimated resident metadata accounting, rather than process RSS. |

Each file lookup is classified before singleflight waiting or retries. Internal
peeks, rechecks, and column merges do not count. Disabled-cache lookups are
excluded. A query may perform multiple file lookups, including separate pruning
and streaming lookups. Labels absent from the source schema do not require a
column load and therefore do not make a hit partial. Hits are recorded before
file binding validation and may still lead to an error. These counters measure
metadata availability, not S3 request counts or query success.

Key hit ratio over five minutes:

```promql
sum(rate(zo_metrics_blocks_cache_hits_total[5m]))
/
(
  sum(rate(zo_metrics_blocks_cache_hits_total[5m]))
  + sum(rate(zo_metrics_blocks_cache_misses_total[5m]))
)
```

Full hit ratio, where every requested label column is already cached:

```promql
(
  sum(rate(zo_metrics_blocks_cache_hits_total[5m]))
  - sum(rate(zo_metrics_blocks_cache_partial_hits_total[5m]))
)
/
(
  sum(rate(zo_metrics_blocks_cache_hits_total[5m]))
  + sum(rate(zo_metrics_blocks_cache_misses_total[5m]))
)
```

The denominator is enabled-cache lookup traffic. A zero denominator gives NaN;
there is no hit-ratio observation while the cache is disabled or idle. Scope all
terms to the same instances running this metric version when comparing ratios.
