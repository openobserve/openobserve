# Runtime blocking-thread limits

Each long-lived Tokio runtime has an independent blocking-thread ceiling. All
ceilings remain **512** unless overridden. An unset value or `0` selects that
same default; a positive integer selects an explicit ceiling. These are limits,
not threads preallocated at startup. Lower limits can queue blocking work and
should be tested against the deployment's workload.

| Runtime | Environment variable |
| --- | --- |
| Main / HTTP | `ZO_MAIN_RUNTIME_BLOCKING_WORKER_NUM` |
| Background jobs | `ZO_JOB_RUNTIME_BLOCKING_WORKER_NUM` |
| gRPC | `ZO_GRPC_RUNTIME_BLOCKING_WORKER_NUM` |
| DataFusion | `ZO_DATAFUSION_RUNTIME_BLOCKING_WORKER_NUM` |
| Vortex | `ZO_VORTEX_RUNTIME_BLOCKING_WORKER_NUM` |
| Dedicated WAL | `ZO_WAL_RUNTIME_BLOCKING_WORKER_NUM` |

For example, to opt into a ceiling of 16 for each runtime:

```dotenv
ZO_MAIN_RUNTIME_BLOCKING_WORKER_NUM=16
ZO_JOB_RUNTIME_BLOCKING_WORKER_NUM=16
ZO_GRPC_RUNTIME_BLOCKING_WORKER_NUM=16
ZO_DATAFUSION_RUNTIME_BLOCKING_WORKER_NUM=16
ZO_VORTEX_RUNTIME_BLOCKING_WORKER_NUM=16
ZO_WAL_RUNTIME_BLOCKING_WORKER_NUM=16
```

Use process environment variables, the usual `.env` file, or the file selected
by `--config`. The existing file-over-process-environment precedence applies.
The main runtime reads its setting before server configuration is initialized,
so local CLI commands do not require unrelated server settings to be valid.

**Restart the process after changing these settings.** Config reload does not
resize existing runtimes. Setting the WAL ceiling does not enable the dedicated
WAL runtime; `ZO_WAL_DEDICATED_RUNTIME_ENABLED` and its existing CPU checks still
control whether that runtime is constructed.

Blocking ceilings are separate from asynchronous worker counts. The existing
`ZO_JOB_RUNTIME_WORKER_NUM`, `ZO_GRPC_RUNTIME_WORKER_NUM`,
`ZO_WAL_RUNTIME_WORKER_NUM`, and `ZO_VORTEX_THREAD_NUM` settings retain their
existing sizing rules. DataFusion continues to use the detected CPU budget, and
the main runtime continues to use Tokio's worker-count selection.

Compatibility note: `.env` and `--config` files are now loaded before the main
runtime is built. A `TOKIO_WORKER_THREADS` entry in such a file therefore now
applies to the main runtime, including the normal file-over-process precedence.
Previously, the main runtime only saw the original process environment for that
Tokio setting. Deployments without that file entry retain their worker sizing.

For Kubernetes, set these variables through the chart's existing `extraEnv`
configuration. No new chart-specific settings are required.
