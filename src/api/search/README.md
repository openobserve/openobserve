# openobserve-api-search

`openobserve-api-search` contains the data-query HTTP APIs for OpenObserve.

Its main domains are:

- Search APIs and query helpers.
- Log pattern extraction from search results.
- PromQL APIs.
- Trace query APIs.

The crate depends on `openobserve-http-common` for shared HTTP types and on `openobserve-core` for
application services. It does not depend on any other API crate. Routing and top-level OpenAPI
composition remain in `openobserve-http`.

This is an internal workspace crate and is not published independently.
