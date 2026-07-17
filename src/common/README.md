# common

`common` contains shared application types, infrastructure helpers, and utilities used
by OpenObserve services and frontends.

This crate must not depend on `openobserve-core` or the `search` crate. Service-backed
authentication, query-range, and bootstrap logic belongs in the service layer:
`openobserve-core` may depend on `common`, never the reverse.

This is an internal workspace crate and is not published independently.
