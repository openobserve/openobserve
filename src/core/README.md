# openobserve-core

`openobserve-core` contains the application services and shared business logic used by OpenObserve frontends and background jobs.

Its main modules are:

- `common`: shared application types and utilities.
- `service`: business services used by APIs and jobs.
- `cipher`: enterprise-only encryption support.

This is an internal workspace crate and is not published independently. Transport-specific routing and background-job orchestration should remain in their respective crates instead of being added here.
