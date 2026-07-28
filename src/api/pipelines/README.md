# openobserve-api-pipelines

`openobserve-api-pipelines` owns APIs for pipelines, functions, enrichment tables, reusable regex
transformation patterns, and data transformations. Log pattern extraction from search results
belongs in `openobserve-api-search`.

Put a new API here when it configures how data is transformed or processed. General CRUD and
administrative APIs belong in `openobserve-api-management`.

This crate does not depend on any other API crate.
