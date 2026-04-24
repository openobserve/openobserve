# Quasar Tab Components Usage (`q-tab`, `q-tabs`, `q-route-tab`, `q-tab-panels`)

**Total files:** 51 Vue files (50 with direct q-tab template tags + 1 via RouteTabs wrapper)  
**Date audited:** 2026-04-24

---

## Overview

Quasar tab components are used across **7 major feature areas**:

| Module | Files | Tab Type |
|---|---|---|
| Ingestion | 14 | `q-tabs` + `q-route-tab` |
| Dashboard | 5 | `q-tabs` + `q-tab` |
| Alerts & Incidents | 3 | `q-tabs` + `q-tab` |
| Traces | 3 | `q-tabs` + `q-tab` |
| Settings | 2 | `q-tabs` + `q-route-tab` |
| RUM / Error Tracking | 2 | `q-tabs` + `q-tab` |
| IAM | 1 | `RouteTabs` wrapper (`q-route-tab`) |
| Shared / Utility | 9 | mixed |

---

## 1. Ingestion Module

### 1.1 Main Ingestion Page
**File:** `views/Ingestion.vue`  
**Tab type:** `<q-tabs>` + `<q-route-tab>` (horizontal, route-based)  
**Purpose:** Top-level navigation between ingestion categories

| Tab Label | Route Name |
|---|---|
| Recommended | `recommended` |
| Custom | `custom` |
| Server | `server` |
| Database | `database` |
| Security | `security` |
| DevOps | `devops` |
| Networking | `networking` |
| Message Queues | `messagequeues` |
| Languages | `languages` |
| Others | `others` |

---

### 1.2 Custom Ingestion
**File:** `components/ingestion/Custom.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)  
**Purpose:** Switch between telemetry types on the Custom ingestion page

| Tab Label | Name |
|---|---|
| Logs | `ingestLogs` |
| Metrics | `ingestMetrics` |
| Traces | `ingestTraces` |

---

### 1.3 Ingestion Category Pages (Dynamic tabs)
The following category pages share an identical pattern — tabs are dynamically rendered from a config array (`tab.name` / `tab.label`). Each has a search filter to narrow displayed integrations.

| File | Page / Category |
|---|---|
| `components/ingestion/Recommended.vue` | Recommended integrations |
| `components/ingestion/Server.vue` | Server integrations |
| `components/ingestion/Database.vue` | Database integrations |
| `components/ingestion/Security.vue` | Security integrations |
| `components/ingestion/DevOps.vue` | DevOps integrations |
| `components/ingestion/Networking.vue` | Networking integrations |
| `components/ingestion/MessageQueues.vue` | Message Queue integrations |
| `components/ingestion/Languages.vue` | Language SDK integrations |
| `components/ingestion/Others.vue` | Other integrations |

---

### 1.4 Ingestion Sub-Type Pages

#### Logs Ingestion
**File:** `components/ingestion/logs/Index.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)

| Tab Label | Name |
|---|---|
| Curl | `curl` |
| Filebeat | `filebeat` |
| FluentBit | `fluentbit` |
| Fluentd | `fluentd` |
| Vector | `vector` |
| OTEL Collector | `ingestLogsFromOtel` |
| Logstash | `logstash` |
| Syslog-ng | `syslogNg` |

#### Metrics Ingestion
**File:** `components/ingestion/metrics/Index.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)

| Tab Label | Name |
|---|---|
| Prometheus | `prometheus` |
| OTEL Collector | `otelCollector` |
| Telegraf | `telegraf` |
| AWS CloudWatch Metrics | `cloudwatchMetrics` |

#### Traces Ingestion
**File:** `components/ingestion/traces/Index.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)

| Tab Label | Name |
|---|---|
| OpenTelemetry | `openTelemetry` |
| OTEL Collector | `ingestTracesFromOtel` |

#### RUM Ingestion
**File:** `components/ingestion/rum/Index.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal, single visible tab)

| Tab Label | Name |
|---|---|
| Browser | `rumWebTab` |

---

### 1.5 Recommended — AWS
**File:** `components/ingestion/recommended/AWSConfig.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>`

| Tab Label | Name |
|---|---|
| Quick Setup | `quick-setup` |
| Individual Services | `individual-services` |

**File:** `components/ingestion/recommended/AWSIndividualServices.vue`  
**Purpose:** Filter AWS services by category

| Tab Label | Name |
|---|---|
| All Services | `all` |
| Logs | `logs` |
| Metrics | `metrics` |
| Security | `security` |
| Networking | `networking` |

**File:** `components/ingestion/recommended/AWSIntegrationGrid.vue`  
**Purpose:** Same filter pattern as AWSIndividualServices (shared grid component)

| Tab Label | Name |
|---|---|
| All Services | `all` |
| Logs | `logs` |
| Metrics | `metrics` |
| Security | `security` |
| Networking | `networking` |

---

### 1.6 Recommended — Azure
**File:** `components/ingestion/recommended/AzureIndividualServices.vue`  
**Purpose:** Filter Azure services by category

| Tab Label | Name |
|---|---|
| All Services | `all` |
| Logs | `logs` |
| Compute | `compute` |
| Storage | `storage` |
| Security | `security` |
| Networking | `networking` |

---

### 1.7 Recommended — Kubernetes
**File:** `components/ingestion/recommended/KubernetesConfig.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (two separate tab sets on the page)

| Tab Label | Name | Purpose |
|---|---|---|
| External Endpoint | `external` | Show external cluster endpoint config |
| Internal Endpoint | `internal` | Show internal cluster endpoint config |

---

## 2. Dashboard Module

### 2.1 Dashboard Folder Navigation
**File:** `views/Dashboards/Dashboards.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (vertical sidebar)  
**Purpose:** Navigate between dashboard folders  
**Tabs:** Dynamic — rendered from user-created folder list (folder name as label, `folderId` as name)

Also used in:  
**File:** `components/common/sidebar/FolderList.vue`  
**Purpose:** Shared folder sidebar component (same dynamic pattern)

---

### 2.2 Dashboard Settings
**File:** `views/Dashboards/DashboardSettings.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Organize dashboard-level configuration into sections

| Tab Label | Name |
|---|---|
| General Settings | `generalSettings` |
| Variable Settings | `variableSettings` |
| Tab Settings | `tabSettings` |

---

### 2.3 Dashboard Tab Bar
**File:** `components/dashboards/tabs/TabList.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)  
**Purpose:** User-defined dashboard tab navigation (the tabs within a dashboard itself)  
**Tabs:** Dynamic — rendered from dashboard tab configuration; includes an "Add Tab" button

---

### 2.4 Dashboard Panel — Query Editor
**File:** `components/dashboards/addPanel/DashboardQueryEditor.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)  
**Purpose:** Switch between multiple queries in a single panel

**Tabs:** Dynamic — `Query 1`, `Query 2`, … (index-based); each tab has a visibility toggle icon and a close button

---

### 2.5 Dashboard Panel — Config Panel (PromQL Legend Query Selector)
**File:** `components/dashboards/addPanel/ConfigPanel.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal, narrow indicator)  
**Purpose:** Select which query's legend to configure when multiple PromQL queries exist  
**Tabs:** Dynamic — `Query 1`, `Query 2`, … (same pattern as DashboardQueryEditor)

---

### 2.6 Dashboard Panel — Dynamic Function Popup
**File:** `components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>`  
**Purpose:** Switch between query builder modes for dynamic functions

| Tab Label | Name |
|---|---|
| Build | `build` |
| Raw | `raw` |

---

### 2.7 Dashboard Panel — Add Condition (Panel Filters)
**File:** `views/Dashboards/addPanel/AddCondition.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (dense, inline per condition row)  
**Purpose:** Choose between list-picker and expression-builder for each filter condition

| Tab Label | Name |
|---|---|
| List | `list` |
| Condition | `condition` |

---

## 3. Alerts & Incidents Module

### 3.1 Alert Insights
**File:** `components/alerts/AlertInsights.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)  
**Purpose:** Analyse alert health across multiple dimensions

| Tab Label | Name |
|---|---|
| Overview | `overview` |
| Frequency | `frequency` |
| Correlation | `correlation` |
| Quality | `quality` |

---

### 3.2 Incident Detail Drawer
**File:** `components/alerts/IncidentDetailDrawer.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Explore all facets of an alert incident

| Tab Label | Name |
|---|---|
| Overview | `overview` |
| Activity | `activity` |
| Incident Analysis | `incidentAnalysis` |
| Alert Graph | `serviceGraph` |
| Alert Triggers | `alertTriggers` |
| Logs | `logs` |
| Metrics | `metrics` |
| Traces | `traces` |

---

### 3.3 Alert History Drawer
**File:** `components/alerts/AlertHistoryDrawer.vue`  
**Tab type:** Custom toggle buttons (not `q-tab`) + `<q-tab-panels>` (history / condition content)  
**Purpose:** View alert firing history and the alert's condition definition

| Panel | Name |
|---|---|
| History | `history` |
| Condition | `condition` |

---

## 4. Traces Module

### 4.1 Trace Span Details Sidebar
**File:** `plugins/traces/TraceDetailsSidebar.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Inspect all metadata for a selected trace span

| Tab Label | Name |
|---|---|
| Preview | `preview` |
| Attributes | `attributes` |
| Events | `events` |
| Exceptions | `exceptions` |
| Links | `links` |
| Correlated Logs | `correlated-logs` |
| Correlated Metrics | `correlated-metrics` |

---

### 4.2 Service Graph Node Side Panel
**File:** `plugins/traces/ServiceGraphNodeSidePanel.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Inspect a service node selected in the service map

| Tab Label | Name |
|---|---|
| Operations | `operations` |
| _(dynamic service tabs)_ | `cfg.id` |
| Metrics | `metrics` |

---

### 4.3 Traces Analysis Dashboard
**File:** `plugins/traces/metrics/TracesAnalysisDashboard.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)  
**Purpose:** Switch between latency / volume / error analysis views  
**Tabs:** Dynamic — rendered from config array (`tab.name` / `tab.label`), typically: Duration, Volume, Error

---

## 5. Logs Module

### 5.1 Log Record Detail Table
**File:** `plugins/logs/DetailTable.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** View a log record in multiple formats with optional correlation data

| Tab Label | Name | Notes |
|---|---|---|
| JSON | `json` | Always visible |
| Table | `table` | Always visible |
| Correlated Logs | `correlated-logs` | Enterprise only |
| Correlated Metrics | `correlated-metrics` | Enterprise only |
| Correlated Traces | `correlated-traces` | Enterprise only |

---

### 5.2 Search Result Detail Table (Generic)
**File:** `views/DetailTable.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Toggle between table and JSON views for search results

| Tab Label | Name |
|---|---|
| Table | `table` |
| JSON | `json` |

---

## 6. Correlation Module

### 6.1 Telemetry Correlation Dashboard
**File:** `plugins/correlation/TelemetryCorrelationDashboard.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal, nested)  
**Purpose:** View correlated telemetry data across signal types

**Outer tabs:**

| Tab Label | Name |
|---|---|
| Logs | `logs` |
| Metrics | `metrics` |
| Traces | `traces` |

**Inner tabs (within Metrics panel — dynamic metric groups):**  
Rendered from `group.id` / `group label` — one tab per metric stream group.

---

## 7. RUM & Error Tracking Module

### 7.1 RUM Event Detail
**File:** `components/rum/EventDetailDrawerContent.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Inspect a browser RUM event

| Tab Label | Name |
|---|---|
| Overview | `overview` |
| Network | `network` |
| Attributes | `attributes` |

---

### 7.2 Error Stack Trace
**File:** `components/rum/errorTracking/view/ErrorStackTrace.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Toggle between raw and formatted stack trace views

| Tab Label | Name |
|---|---|
| Raw | `raw` |
| Pretty | `pretty` |

---

## 8. Settings Module

### 8.1 Organization Settings
**File:** `components/settings/index.vue`  
**Tab type:** `<q-tabs>` + `<q-route-tab>` (vertical sidebar, route-based)  
**Purpose:** Top-level settings navigation

| Tab Label | Name | Enterprise Only |
|---|---|---|
| Query Management | `queryManagement` | |
| Nodes | `nodes` | |
| General | `general` | |
| Organization | `organization` | |
| Domain Management | `domain_management` | ✓ |
| Alert Destinations | `alert_destinations` | |
| Pipeline Destinations | `pipeline_destinations` | |
| Alert Templates | `templates` | |
| LLM Model Pricing | `model_pricing` | |
| Cipher Keys | `cipher-keys` | |
| AI Toolsets | `ai_toolsets` | |
| License | `license` | ✓ |
| Organization Management | `organization_management` | ✓ |
| Regex Patterns | `regex_patterns` | |
| Correlation Settings | `correlation_settings` | |

---

### 8.2 Correlation Settings
**File:** `components/settings/CorrelationSettings.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal)  
**Purpose:** Configure cross-signal correlation behavior

| Tab Label | Name |
|---|---|
| Discovered Services | `services` |
| Service Discovery | `discovery` |
| Alert Correlation | `alert-correlation` |
| Field Aliases | `field-aliases` |

---

## 9. Functions & Pipelines Module

### 9.1 Functions Page Navigation
**File:** `views/Functions.vue`  
**Tab type:** `<q-tabs>` + `<q-route-tab>` (vertical sidebar, icon + label, compact mode collapses labels)  
**Purpose:** Navigate between processing feature areas

| Tab Label | Name |
|---|---|
| Stream Pipelines | `streamPipeline` |
| Functions | `functions` |
| Enrichment Tables | `enrichmentTables` |
| Eval Templates | `evalTemplates` |

---

## 10. Stream Schema

### 10.1 Log Stream Schema Viewer
**File:** `components/logstream/schema.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` (horizontal, inline-label, dense)  
**Purpose:** Navigate different configuration sections of a log stream

| Tab Label | Name | Enterprise |
|---|---|---|
| Schema Settings | `schemaSettings` | |
| Extended Retention | `redButton` | ✓ |
| Configuration | `configuration` | |
| LLM Evaluation | `llmEvaluation` | |
| Cross Linking | `crossLinking` | |

---

## 11. Enterprise — Billing

### 11.1 Billing & Plans
**File:** `enterprise/components/billings/Billing.vue`  
**Tab type:** `<q-tabs>` + `<q-route-tab>` (vertical, route-based)  
**Purpose:** Manage subscription and usage

| Tab Label | Name |
|---|---|
| Plans | `plans` |
| Usage | `usage` |
| Invoice History | `invoice_history` |

---

## 12. Identity & Access Management (IAM)

### 12.1 IAM Page Navigation
**File:** `views/IdentityAccessManagement.vue`  
**Tab type:** `<route-tabs>` (uses `RouteTabs.vue` wrapper → `q-tabs` + `q-route-tab`), vertical sidebar  
**Purpose:** Navigate between IAM management sections

| Tab Label | Name | Notes |
|---|---|---|
| Basic Users | `users` | Default active tab |
| Service Accounts | `serviceAccounts` | |
| Groups | `groups` | |
| Roles | `roles` | |
| Quota | `quota` | Meta org only |
| Organizations | `organizations` | |
| Invitations | `invitations` | |

---

## 13. Shared / Utility Components

### 13.1 Route Tabs (Generic Wrapper)
**File:** `components/RouteTabs.vue`  
**Tab type:** `<q-tabs>` + `<q-route-tab>`  
**Purpose:** Reusable component that renders a horizontal route-based tab bar; accepts a list of tab configs as a prop.

---

### 13.2 Query Plan Dialog
**File:** `components/QueryPlanDialog.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** View the execution plan for a log/metric query

| Tab Label | Name |
|---|---|
| Logical Plan | `logical` |
| Physical Plan | `physical` |

---

### 13.3 Predefined Themes
**File:** `components/PredefinedThemes.vue`  
**Tab type:** `<q-tabs>` + `<q-tab>` + `<q-tab-panels>` (horizontal)  
**Purpose:** Browse and apply light vs. dark theme presets

| Tab Label | Name |
|---|---|
| Light Mode | `light` |
| Dark Mode | `dark` |

---

### 13.4 Date/Time Pickers

**File:** `components/DateTime.vue`  
**Tab type:** `<q-tab-panels>` (no `q-tabs` bar — controlled externally)  
**Panels:** `relative`, `absolute`

**File:** `components/CustomDateTimePicker.vue`  
**Tab type:** `<q-tab-panels>` only  
**Panels:** `relative`

**File:** `components/DateTimePicker.vue`  
**Tab type:** `<q-tab-panels>` only  
**Panels:** `relative`, `absolute`

---

## Summary by Pattern

| Pattern | Files | Description |
|---|---|---|
| Route-based navigation (`q-route-tab`) | 5 | Main page nav: Ingestion, Functions, Settings, Billing, RouteTabs wrapper |
| Content switch with panels (`q-tab-panels`) | 35 | Detail views, settings sections, ingestion forms |
| Dynamic tabs (loop-generated) | 12 | Dashboard folders, query editor, ingestion categories, service graph |
| Nested tabs (tabs within tabs) | 2 | TelemetryCorrelationDashboard, ConfigPanel |
| Custom toggle with `q-tab-panels` | 1 | AlertHistoryDrawer (custom buttons driving tab-panels) |
| Via `RouteTabs` wrapper (indirect) | 1 | IdentityAccessManagement — renders q-tabs + q-route-tab through RouteTabs.vue |
