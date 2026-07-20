# openobserve-api-query

`openobserve-api-query` contains the data-query HTTP APIs for OpenObserve.

Its main domains are:

- Search APIs and query helpers.
- PromQL APIs.
- Trace query APIs.

The crate depends on `openobserve-api-common` for shared HTTP types and `openobserve-core` for application services. It does not depend on the management API crate. Routing and top-level OpenAPI composition remain in `openobserve-api`.

This is an internal workspace crate and is not published independently.
