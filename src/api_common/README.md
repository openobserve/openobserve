# openobserve-api-common

`openobserve-api-common` contains small HTTP building blocks shared by multiple API domain crates.

It currently provides:

- Request extractors shared by API handlers.
- Common request and response types.

The crate intentionally has a small dependency surface and does not depend on `openobserve-core`, query APIs, or management APIs. Domain-specific handlers and models should remain in their owning API crate.

This is an internal workspace crate and is not published independently.
