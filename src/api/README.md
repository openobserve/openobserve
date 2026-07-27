# OpenObserve API crates

All API-facing crates live under this directory:

- `common`: shared HTTP authentication, extractors, and transport types.
- `grpc`: gRPC services and server transport.
- `http`: HTTP routing, OpenAPI, middleware, and composition of the domain crates.
- `ingest`: telemetry ingestion APIs.
- `management`: control-plane APIs such as alerts, dashboards, users, and organizations.
- `pipelines`: pipelines, functions, enrichment tables, and transformation configuration.
- `search`: search, PromQL, trace-query, and log-pattern extraction APIs.

The domain crates do not depend on one another. Shared HTTP concerns belong in `common`; shared
business logic belongs in `openobserve-core` or another non-API service crate. The `http` crate is
the composition root.
