# openobserve-jobs

`openobserve-jobs` contains background-job orchestration that runs outside the request-serving API frontend.

Job implementations live under `src/job` and reuse application services from `openobserve-core`. Keeping jobs in a separate crate allows API-only changes to avoid recompiling the background-job frontend and vice versa.

This is an internal workspace crate and is not published independently. Reusable business logic should live in `openobserve-core` rather than being duplicated in a job.

At startup, the system-settings watcher subscribes before the database snapshot loads into memory. It processes queued events after the load, so a concurrent change cannot disappear or be overwritten by the snapshot. Trace ingestion reads Gen-AI agent mappings from this cache without a database fallback.
