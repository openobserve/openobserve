# openobserve-http-common

`openobserve-http-common` contains HTTP building blocks shared by multiple independent API domain
crates.

It currently provides:

- Request extractors shared by API handlers.
- Common request and response types.
- Shared authentication and token validation.

It does not depend on any API crate. Domain-specific handlers and models should remain in their
owning API crate.

This is an internal workspace crate and is not published independently.
