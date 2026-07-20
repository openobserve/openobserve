# openobserve-api

`openobserve-api` is the transport frontend for OpenObserve. It composes the HTTP and gRPC handlers, routers, OpenAPI schemas, and rate-limit path mappings used by the server binary.

Domain handlers are split into dedicated crates where possible:

- `openobserve-api-query` for search, PromQL, and trace APIs.
- `openobserve-api-management` for management APIs.
- `openobserve-api-common` for shared HTTP types and extractors.
- `openobserve-core` for application services and business logic.

This is an internal workspace crate and is not published independently. New business logic should normally be implemented in `openobserve-core`, leaving this crate responsible for transport composition.
