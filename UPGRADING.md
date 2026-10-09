# Upgrading OpenObserve

## Metrics staleness markers

> **Warning:** Before starting any node that supports metrics staleness markers during a rolling upgrade, set `ZO_METRICS_STALENESS_MARKERS_ENABLED=false` throughout the deployment. Keep it disabled while versions are mixed. Enable it only after every node has been upgraded, including all participating nodes and regions in a Super Cluster deployment.

Staleness markers end a metric series at its marker in PromQL and are stored as a NULL metric value. Readers in versions without marker support may return incorrect values, and some compaction paths in those versions reject marker data.

### Rolling upgrade procedure

1. Set `ZO_METRICS_STALENESS_MARKERS_ENABLED=false` in the configuration for every node before starting any node on a supporting version. Ensure running nodes use the updated configuration, restarting them as needed.
2. Upgrade every node while keeping the setting disabled throughout the deployment. For deployments spanning multiple regions or Super Cluster participants, complete the upgrade in every participating region before enabling markers.
3. After confirming every node runs a version that supports staleness markers, set `ZO_METRICS_STALENESS_MARKERS_ENABLED=true` on all nodes and apply the updated configuration.

The setting defaults to `true`. When it is `false`, ingestion drops incoming markers and readers ignore stored markers. OpenObserve does not automatically detect whether all nodes support markers; operators must complete the upgrade before enabling them.

### Rollback

**Rollback to a version without marker support is unsafe after markers have been stored, even if `ZO_METRICS_STALENESS_MARKERS_ENABLED` is later disabled.** Disabling the setting does not remove previously stored markers or make them compatible with unsupported readers and compactors.

### Fresh installations

Fresh installations whose nodes and participating regions all run versions that support staleness markers can enable them from the start, using the default `true` setting.
