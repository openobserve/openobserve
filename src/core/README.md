# openobserve-core

`openobserve-core` contains the application services and compatibility re-exports used by
OpenObserve frontends and background jobs.

Its main modules are:

- `common`: compatibility namespace backed by the `common` crate.
- `service`: business services used by APIs and jobs.
- `cipher`: enterprise-only encryption support.

This is an internal workspace crate and is not published independently. Transport-specific routing and background-job orchestration should remain in their respective crates instead of being added here.
