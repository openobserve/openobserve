# openobserve-api-management

`openobserve-api-management` contains the management and control-plane HTTP APIs for OpenObserve.

It includes handlers and models for areas such as alerts, templates, destinations, organizations,
users, authorization, dashboards, folders, actions, AI, billing, service accounts, keys,
sourcemaps, synthetics, and other control-plane features.

New CRUD or control-plane APIs belong here unless they ingest telemetry, query observability data,
or configure pipeline transformations.

The crate depends on `openobserve-http-common` for shared HTTP and authentication helpers and on
`openobserve-core` for application services. It does not depend on any other API crate. Routing and
top-level OpenAPI composition remain in `openobserve-http`.

This is an internal workspace crate and is not published independently.
