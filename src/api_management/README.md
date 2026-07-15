# openobserve-api-management

`openobserve-api-management` contains the management and control-plane HTTP APIs for OpenObserve.

It includes handlers and models for areas such as alerts, templates, destinations, organizations, users, authorization, dashboards, and folders, together with authentication helpers.

The crate depends on `openobserve-api-common` for shared HTTP types and `openobserve-core` for application services. It does not depend on the query API crate. Routing and top-level OpenAPI composition remain in `openobserve-api`.

This is an internal workspace crate and is not published independently.
