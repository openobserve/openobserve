# Collect host metrics with Vector

Vector's [`host_metrics` source](https://vector.dev/docs/reference/configuration/sources/host_metrics/)
collects CPU, memory, filesystem and network metrics. Send these through the
[`prometheus_remote_write` sink](https://vector.dev/docs/reference/configuration/sinks/prometheus_remote_write/)
to OpenObserve's metrics endpoint. Sending them to the logs `/_json` endpoint
stores them as logs instead.

Install [Vector](https://vector.dev/docs/setup/installation/) on the host you
want to monitor, then set the following environment variables. Use the ingestion
URL, organization ID, user and passcode from **Data Sources > Metrics** in your
OpenObserve instance. `OPENOBSERVE_URL` is the base URL without a trailing slash,
for example `http://localhost:5080` for a local instance. Use HTTPS for a remote
instance, and keep credentials out of configuration files and source control.

```bash
export OPENOBSERVE_URL="http://localhost:5080"
export OPENOBSERVE_ORG="default"
export OPENOBSERVE_USER="your-email@example.com"
read -rs -p "Ingestion passcode: " OPENOBSERVE_PASSCODE
export OPENOBSERVE_PASSCODE
export VECTOR_DANGEROUSLY_ALLOW_ENV_VAR_INTERPOLATION=true
```

Vector 0.57 and newer disable [environment variable interpolation](https://vector.dev/docs/reference/environment_variables/)
by default. The last line enables it for this example. Use only environment
values you control, and consider Vector's [secrets backend](https://vector.dev/docs/reference/configuration/secrets/)
for credentials on shared hosts.

From the repository root, validate and run the supplied configuration:

```bash
vector validate --skip-healthchecks deploy/vector/host-metrics.yaml
vector --config deploy/vector/host-metrics.yaml
```

The example collects host metrics every 60 seconds. After the first collection,
open **Metrics** in the same organization and query `host_cpu_seconds_total`.
The available metrics depend on the host operating system and enabled collectors.
When Vector runs in a container, its host metrics describe the resources visible
inside that container. Run it on the host to monitor that host directly.

The configuration uses Snappy compression, as required by the
[Prometheus remote-write protocol](https://prometheus.io/docs/specs/prw/remote_write_spec/).
Do not copy `compression: gzip` or the `http` sink from a Vector logs example.
The metrics endpoint is `/api/<organization>/prometheus/api/v1/write`, and the
sink type must be `prometheus_remote_write`.

The sink's startup health check is disabled. Validation alone does not prove that
metrics were ingested. If Vector reports HTTP 400, check OpenObserve's server
logs for the rejected payload. For HTTP 401 or 403, check the selected
organization, ingestion user, passcode and permissions.
