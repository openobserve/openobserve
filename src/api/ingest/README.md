# openobserve-api-ingest

`openobserve-api-ingest` owns HTTP endpoints that accept telemetry or ingestion-control requests.

Put a new API here when its primary purpose is to send logs, metrics, traces, or RUM data into
OpenObserve. Anything that administers the system rather than carrying telemetry — stream CRUD,
health and node endpoints, authentication, configuration reload — belongs in
`openobserve-api-management`. Shared ingestion implementation belongs in `ingestion-common` or
`openobserve-core`, not in another API crate.

This crate does not depend on any other API crate.
