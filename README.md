<p align="center">
  <a href="https://openobserve.ai"><img src="https://openobserve.ai/img/logo/o2-logo-readme.svg" alt="OpenObserve"></a>
</p>
<p align="center">
    <em> Modern Observability 🚀 10x easier, 🚀 140x lower storage cost, 🚀 high performance, 🚀 petabyte scale - Elasticsearch/Splunk/Datadog alternative for 🚀 (logs, metrics, traces, frontend monitoring + more).</em>
</p>
<p align="center">
<a href="https://github.com/openobserve/openobserve" target="_blank">
    <img src="https://img.shields.io/github/last-commit/openobserve/openobserve" alt="Last Commit">
</a>
<a href="https://github.com/openobserve/openobserve/stargazers" target="_blank">
    <img src="https://img.shields.io/github/stars/openobserve/openobserve" alt="GitHub Stars">
</a>
<a href="https://github.com/openobserve/openobserve/issues" target="_blank">
    <img src="https://img.shields.io/github/issues/openobserve/openobserve" alt="GitHub Issues">
</a>
<a href="https://github.com/openobserve/openobserve/graphs/contributors" target="_blank">
    <img src="https://img.shields.io/github/contributors/openobserve/openobserve" alt="Contributors">
</a>
<a href="https://github.com/openobserve/openobserve/releases" target="_blank">
    <img src="https://img.shields.io/github/v/release/openobserve/openobserve" alt="GitHub Release">
</a>
</p>

OpenObserve (O2 for short) is a single binary, petabyte-scale observability platform built specifically for logs, metrics, traces, analytics, frontend monitoring and more.

<h2>Why OpenObserve?</h2>

<h3>1. Simplicity</h3>
It is straightforward and easy to operate, compared to other observability tools, that require understanding and tuning numerous settings. Get OpenObserve up and running on a single node in under 2 minutes. 

<h3>2. Cost Efficiency</h3>
You can reduce your log storage costs by ~140x compared to Elasticsearch by using OpenObserve.

<h3>3. Single Binary Platform</h3>
Consolidate metrics, logs, and traces on one single, efficient platform. OpenObserve comes with its own UI, eliminating the need for multiple installations. 

![OpenObserve Vs Elasticsearch](./screenshots/zo_vs_es.png)

## 🎥 Introduction Video

[![OpenObserve Introduction](./screenshots/o2_intro.webp)](https://www.youtube.com/watch?v=4VwuC1tpRP4)

## 🌟 Capabilities:

- **Logs, Metrics, Traces**: Comprehensive support for key telemetry signals.
- **OpenTelemetry Support**: Full compatibility with OTLP for logs, metrics, and traces.
- **Real User Monitoring (RUM)**: Includes performance tracking, error logging, and session replay.
- **Dashboards, Reports, Alerts**: Features over 18 different chart types for comprehensive data visualization for on-the-fly analysis and reporting along with alerting.
- **Pipelines**: Enrich, redact, reduce, normalize data on the fly. Stream processing for logs to metrics and more.
- **Advanced Embedded GUI**: Intuitive and user-friendly interface.
- **SQL and PromQL Support**: Query logs and traces with SQL, and metrics with SQL and PromQL.
- **Single Binary or HA Installation**: Install using a single binary for small deployments or in HA mode for large deployments.
- **Versatile Storage Options**: Supports local disk, S3, MinIO, GCS, Azure Blob Storage.
- **High Availability and Clustering**: Ensures reliable and scalable performance.
- **Dynamic Schema**: Adapts to your data structure seamlessly.
- **Built-in Authentication**: Secure and ready to use.
- **Ease of Operation**: Designed for simplicity and efficiency.
- **Seamless Upgrades**: Hassle-free updates.
- **Multilingual UI**: Supports 11 languages, including English, Spanish, German, French, Chinese, and more.

For a full list of features, check the [documentation](https://openobserve.ai/docs/#project-status-features-and-roadmap).

## ⚡️ Quick start

### 🐳 Docker:
```bash
docker run -d \
      --name openobserve \
      -v $PWD/data:/data \
      -p 5080:5080 \
      -e ZO_ROOT_USER_EMAIL="root@example.com" \
      -e ZO_ROOT_USER_PASSWORD="Complexpass#123" \
      public.ecr.aws/zinclabs/openobserve:latest
```


For other ways to quickly install OpenObserve or use OpenObserve cloud, check [quickstart documentation](https://openobserve.ai/docs/quickstart).

For installing OpenObserve in HA mode, check [HA deployment documentation](https://openobserve.ai/docs/ha_deployment/).
<h3>Comparison</h3>
<table>
  <thead>
    <tr>
      <th>Category</th>
      <th>Open Source</th>
      <th><a href="https://openobserve.ai/downloads/">Enterprise Edition</a></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td colspan="3"><strong>LICENSES & COST</strong></td>
    </tr>
    <tr>
      <td>License Type</td>
      <td>AGPL-3.0</td>
      <td>End User License Agreement</td>
    </tr>
    <tr>
      <td>Cost</td>
      <td>Free without limits</td>
      <td>*Free up to 200 GB/day ingestion</td>
    </tr>
    <tr>
      <td colspan="3"><strong>CORE CAPABILITIES</strong></td>
    </tr>
    <tr>
      <td>Metrics</td>
      <td>✅ Full support</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Logs</td>
      <td>✅ Full support</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Traces</td>
      <td>✅ Full support</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Real User Monitoring (RUM)</td>
      <td>✅ Full support</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Data Pipelines</td>
      <td>Available, limited functionality</td>
      <td>✅Full support including remote destinations</td>
    </tr>
    <tr>
      <td>Actions</td>
      <td>❌ Not available</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Dashboards</td>
      <td>✅ Full support, 18+ chart types</td>
      <td>✅ Full support, 18+ chart types</td>
    </tr>
    <tr>
      <td>Alerts</td>
      <td>✅ Full support</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Federated Search / Super Cluster</td>
      <td>❌ Not available</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Query Management</td>
      <td>❌ Not available</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Workload Management (QoS)</td>
      <td>❌ Not available</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td>Quotas & Rate Limiting</td>
      <td>Basic</td>
      <td>✅ Full support</td>
    </tr>
    <tr>
      <td colspan="3"><strong>SECURITY CAPABILITIES</strong></td>
    </tr>
    <tr>
      <td>TLS Encryption</td>
      <td>✅ TLS 1.2+</td>
      <td>✅ TLS 1.2+</td>
    </tr>
    <tr>
      <td>Storage Encryption</td>
      <td>✅ Via cloud provider KMS</td>
      <td>✅ Via cloud provider KMS</td>
    </tr>
    <tr>
      <td>Basic Authentication</td>
      <td>✅ Email + password</td>
      <td>✅ Email + password</td>
    </tr>
    <tr>
      <td>Single Sign-On (SSO)</td>
      <td>❌ Not available</td>
      <td>✅ OIDC, SAML 2.0, Okta, Azure Entra, LDAP/AD, GitHub, GitLab, Google, Keycloak + <strong>more</strong></td>
    </tr>
    <tr>
      <td>Cipher Keys (Advanced Encryption)</td>
      <td>❌ Not available</td>
      <td>✅ AES-256 SIV, Google Tink KeySet, Akeyless integration</td>
    </tr>
    <tr>
      <td>HIPAA Compliance Support</td>
      <td>❌ Self-managed</td>
      <td>✅ Yes (requires addendum)</td>
    </tr>
    <tr>
      <td>PCI-DSS Compliance Support</td>
      <td>❌ Self-managed</td>
      <td>✅ Yes (requires addendum)</td>
    </tr>
    <tr>
      <td>Audit Trail</td>
      <td>❌ Basic logging only</td>
      <td>✅ Comprehensive 365-day immutable logs</td>
    </tr>
    <tr>
      <td colspan="3"><strong>USER MANAGEMENT & AUTHENTICATION</strong></td>
    </tr>
    <tr>
      <td>Root User Account</td>
      <td>✅ Created at startup</td>
      <td>✅ Created at startup</td>
    </tr>
    <tr>
      <td>Multiple Users</td>
      <td>Yes, including system roles: Admin, Editor, User, and Viewer</td>
      <td>✅ With role-based permissions</td>
    </tr>
    <tr>
      <td>Role-Based Access Control (RBAC)</td>
      <td>❌ All users have full access</td>
      <td>✅ Admin, Editor, Viewer, User, Root, Custom roles</td>
    </tr>
    <tr>
      <td>Custom Roles</td>
      <td>❌ Not available</td>
      <td>✅ Granular permission management</td>
    </tr>
    <tr>
      <td>User Groups</td>
      <td>❌ Not available</td>
      <td>✅ Collective permission management</td>
    </tr>
    <tr>
      <td>Service Accounts</td>
      <td>Full access only</td>
      <td>✅ Role-based token authentication</td>
    </tr>
    <tr>
      <td>Multi-Tenancy</td>
      <td>Organizations and streams</td>
      <td>Organizations and streams with quotas</td>
    </tr>
    <tr>
      <td colspan="3"><strong>DATA RETENTION & STORAGE</strong></td>
    </tr>
    <tr>
      <td>Default Retention</td>
      <td>User-configurable</td>
      <td>User-configurable</td>
    </tr>
    <tr>
      <td>Storage Format</td>
      <td>Parquet</td>
      <td>Parquet</td>
    </tr>
    <tr>
      <td>Metadata Storage</td>
      <td>SQLite (single node), PostgreSQL (HA)</td>
      <td>SQLite (single node), PostgreSQL(HA)</td>
    </tr>
    <tr>
      <td>Backup & Recovery</td>
      <td>Customer-managed</td>
      <td>Customer-managed</td>
    </tr>
    <tr>
      <td colspan="3"><strong>SUPPORT & SLAs</strong></td>
    </tr>
    <tr>
      <td>Support Type</td>
      <td>Community</td>
      <td>Priority</td>
    </tr>
    <tr>
      <td>Response Time Guarantees</td>
      <td>Best-effort</td>
      <td>✅ Yes, w/ contract</td>
    </tr>
    <tr>
      <td>SLA Guarantees</td>
      <td>❌ None</td>
      <td>✅ Yes, w/ contract</td>
    </tr>
    <tr>
      <td>Support Channels</td>
      <td>Slack community</td>
      <td>Dedicated</td>
    </tr>
    <tr>
      <td>Update Requirements</td>
      <td>Self-managed</td>
      <td>Critical security updates within 90 days w/ contract</td>
    </tr>
  </tbody>
</table>

<p><em>* Registration required at 100 GB/day</em></p>

## 📷 Screenshots

### Home

![Home](./screenshots/zo_home.png)

### Logs

![Logs](./screenshots/logs.png)

### Traces (OpenTelemetry)

Trace details page
![Traces using OpenTelemetry](./screenshots/traces.png)

Golden metrics based on traces
![Traces golden metrics](./screenshots/traces-overall.png)

### Visualizations and Dashboards

![Dashboard](./screenshots/dashboard.png)
![Dashboard](./screenshots/dashboard2.png)
![Create panel](./screenshots/create-panel.png)
![Map](./screenshots/map.png)

### Front end monitoring

Performance analytics
![Performance](./screenshots/performance.png)

Session replay
![Session replay](./screenshots/session-replay.png)

Error tracking
![Error tracking](./screenshots/error-tracking.png)


### Alerts

![Alerts](./screenshots/alerts.png)


### Streams

![Streams](./screenshots/streams.png)

### Ingestion

![Ingestion](./screenshots/ingestion1.png)

### Pipeline

Pipeline
![Pipeline](./screenshots/pipeline.png)

Function
![Function](./screenshots/function.png)


### SBOM

Software Bill of Materials for OpenObserve

#### Rust

SBOM can be found [here](./openobserve.cdx.xml). You can analyze it using [dependency track](https://dependencytrack.org/).

In order to generate the SBOM, you can use the following commands:

Install cargo-cyclonedx:

````bash
cargo install cargo-cyclonedx
````

Generate the SBOM:
```bash
cargo-cyclonedx cyclonedx
```

#### JavaScript

SBOM can be found [here](./web/sbom.json ). You can analyze it using [dependency track](https://dependencytrack.org/).

In order to generate the SBOM, you can use the following commands:

Install cyclonedx-npm:

````bash
npm install --global @cyclonedx/cyclonedx-npm
````

Generate the SBOM:
```bash
cd web
cyclonedx-npm > sbom.json         
```


## ⚖️ License

OpenObserve is licensed under the AGPL-3.0 license. For more details, see the [LICENSE](https://github.com/openobserve/openobserve/blob/main/LICENSE).

## 🌍 Community

### 🔗 Join OpenObserve community on Slack

[![Slack](./screenshots/slack.png)](https://short.openobserve.ai/community)

Easiest way to get support is to join the [Slack channel](https://short.openobserve.ai/community).
<!-- ## Enterprise Vs Open source Vs Cloud edition

OpenObserve is available in three different editions:


| Feature | Open Source (Self hosted) | Enterprise (Self hosted) | Cloud |
| --- | --- | --- | --- | 
| Logs | ✅ | ✅ | ✅ |
| Metrics | ✅ | ✅ | ✅ |
| Traces | ✅ | ✅ | ✅ |
| RUM | ✅ | ✅ | ✅ |
| Alerts | ✅ | ✅ | ✅ |
| Dashboards | ✅ | ✅ | ✅ |
| Reports | ✅ | ✅ | ✅ |
| VRL functions | ✅ | ✅ | ✅ |
| Pipelines | ✅ | ✅ | ✅ |
| High Availability | ✅ | ✅ | ✅ |
| Multitenancy (Organizations) | ✅ | ✅ | ✅ |
| Dynamic schema and schema evolution | ✅ | ✅ | ✅ |
| Advanced multilingual GUI | ✅ | ✅ | ✅ |
| Single Sign On | ❌ | ✅ | ✅ |
| Role Based Access Control (RBAC) | ❌ | ✅ | ✅ |
| Federated search / Super cluster | ❌ | ✅ | ❌ |
| Query management | ❌ | ✅ | ❌ |
| Workload management (QoS) | ❌ | ✅ | ❌ |
| Audit trail | ❌ | ✅ | ❌ |
| Ability to influence roadmap | ❌ | ✅ | ✅ on enterprise plan |
| License | AGPL | Enterprise | Cloud |
| Support | Community | Enterprise | Cloud |
| Cost | Free | If self hosted, free for up to 200 GB/Day data ingested <br> Paid thereafter  | Free 200 GB/Month data ingested <br> Paid thereafter | -->

### 📱 Join OpenObserve community on WeChat

<img src="./screenshots/wechat_qr.jpg" width="300">
