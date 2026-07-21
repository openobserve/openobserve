# openobserve-jobs

`openobserve-jobs` contains background-job orchestration that runs outside the request-serving API frontend.

Job implementations live under `src/job` and reuse application services from `openobserve-core`. Keeping jobs in a separate crate allows API-only changes to avoid recompiling the background-job frontend and vice versa.

This is an internal workspace crate and is not published independently. Reusable business logic should live in `openobserve-core` rather than being duplicated in a job.
