# common

`common` contains shared application types, infrastructure helpers, and utilities used
by OpenObserve services and frontends.

This crate must not depend on `openobserve-service`. Service-backed authentication, query-range,
and bootstrap logic belongs in the service layer: `openobserve-service` may depend on
`common`, never the reverse.

This is an internal workspace crate and is not published independently.
