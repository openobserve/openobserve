# openobserve-http

`openobserve-http` is the HTTP transport composition root for OpenObserve. It composes the
independent API crates, routers, OpenAPI schemas, and rate-limit path mappings used by the server
binary.

HTTP handlers are grouped into four business-domain crates:

- `openobserve-api-ingest` for log, metric, trace/OTLP, RUM, stream, and cluster ingestion.
- `openobserve-api-search` for search, log pattern extraction, PromQL, trace query, saved-view, and
  search-job APIs.
- `openobserve-api-pipelines` for pipelines, functions, enrichment tables, and reusable regex
  transformation patterns.
- `openobserve-api-management` for alerts, dashboards, organizations, users, actions, AI,
  platform configuration, and other control-plane APIs.
- `openobserve-http-common` for shared HTTP types, extractors, and authentication.
- `openobserve-core` for application services and business logic.

API crates must not depend on one another. Cross-domain behavior belongs in a non-API shared crate
such as `openobserve-core`, `common`, `audit`, or `openobserve-http-common`. This crate is the only
layer that aggregates API crates.

When adding an API, choose its crate by the resource it primarily owns:

1. Data entering OpenObserve goes to `src/api/ingest`.
2. Reading or querying stored observability data goes to `src/api/search`.
3. Data transformation and processing configuration goes to `src/api/pipelines`.
4. CRUD, administration, automation, alerts, dashboards, and configuration go to
   `src/api/management`.

Code used by two or more API crates goes to `openobserve-http-common` only when it is
transport-specific. Shared business behavior belongs in `openobserve-core`; shared metadata and
general utilities belong in `common`. Business endpoints must never be placed in a common crate.

This is an internal workspace crate and is not published independently. New business logic should
normally be implemented in `openobserve-core`, leaving this crate responsible for HTTP transport
composition.
