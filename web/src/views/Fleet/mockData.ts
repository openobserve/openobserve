// Copyright 2026 OpenObserve Inc.
// Mock data for Fleet Management views. All data is static/deterministic.

export type AgentStatus = "ok" | "warn" | "err" | "off";
export type AgentType = "otel" | "vector" | "fluent" | "prom" | "beat" | "custom";

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  version: string;
  latestVersion: string;
  status: AgentStatus;
  host: string;
  region: string;
  env: string;
  eps: number;
  bytesPerSec: number;
  cpuPct: number;
  memMb: number;
  lastSeen: string;
  uptime: string;
  tags: string[];
  pipelines: string[];
}

export interface DataSource {
  name: string;
  category: string;
  icon: string;
  connectedAgents: number;
  eps: number;
  description: string;
  protocol: string;
}

export interface Pipeline {
  id: string;
  name: string;
  input: string;
  transforms: string[];
  output: string;
  eps: number;
  status: AgentStatus;
  agentCount: number;
  lastModified: string;
}

export interface ConfigTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  agentType: AgentType;
  agentsDeployed: number;
  version: string;
  lastPushed: string;
}

export const KPIS = [
  { label: "Total Agents", val: "1,284", delta: "+23 this week", trend: "up", color: "#1aaf88", dot: "#1aaf88" },
  { label: "Active", val: "1,201", delta: "93.5% healthy", trend: "up", color: "#16a35d", dot: "#16a35d" },
  { label: "Degraded", val: "48", delta: "↑ 6 since yesterday", trend: "dn", color: "#d97706", dot: "#d97706" },
  { label: "Offline", val: "35", delta: "↓ 4 since yesterday", trend: "up", color: "#8690a8", dot: "#8690a8" },
  { label: "Events/sec", val: "4.2M", delta: "+12% vs last week", trend: "up", color: "#2563eb", dot: "#2563eb" },
  { label: "Data/day", val: "892 GB", delta: "+8% vs last week", trend: "up", color: "#7c3aed", dot: "#7c3aed" },
];

export const AGENT_TYPES_DIST = [
  { label: "OpenTelemetry Collector", key: "otel", count: 542, pct: 42 },
  { label: "Vector", key: "vector", count: 361, pct: 28 },
  { label: "Fluent Bit", key: "fluent", count: 220, pct: 17 },
  { label: "Prometheus", key: "prom", count: 103, pct: 8 },
  { label: "Elastic Beat", key: "beat", count: 45, pct: 4 },
  { label: "Custom Agent", key: "custom", count: 13, pct: 1 },
];

export const AGENTS: Agent[] = [
  { id: "a1", name: "otel-k8s-prod-us-east-1a", type: "otel", version: "0.121.0", latestVersion: "0.121.0", status: "ok", host: "ip-10-0-12-44.ec2.internal", region: "us-east-1", env: "prod", eps: 41230, bytesPerSec: 3_840_000, cpuPct: 24, memMb: 312, lastSeen: "2s ago", uptime: "14d 6h", tags: ["k8s", "prod", "aws"], pipelines: ["otel-to-openobserve"] },
  { id: "a2", name: "otel-k8s-prod-us-east-1b", type: "otel", version: "0.121.0", latestVersion: "0.121.0", status: "ok", host: "ip-10-0-12-88.ec2.internal", region: "us-east-1", env: "prod", eps: 38900, bytesPerSec: 3_600_000, cpuPct: 21, memMb: 298, lastSeen: "2s ago", uptime: "14d 6h", tags: ["k8s", "prod", "aws"], pipelines: ["otel-to-openobserve"] },
  { id: "a3", name: "vector-eks-staging-us-west", type: "vector", version: "0.43.1", latestVersion: "0.43.1", status: "ok", host: "ip-10-2-5-21.ec2.internal", region: "us-west-2", env: "staging", eps: 12800, bytesPerSec: 1_100_000, cpuPct: 15, memMb: 186, lastSeen: "3s ago", uptime: "7d 2h", tags: ["k8s", "staging", "aws"], pipelines: ["vector-enrich-drop"] },
  { id: "a4", name: "fluent-bit-gke-prod-eu", type: "fluent", version: "3.3.4", latestVersion: "3.3.4", status: "ok", host: "gke-prod-eu-node-3f2a", region: "europe-west1", env: "prod", eps: 29500, bytesPerSec: 2_200_000, cpuPct: 18, memMb: 144, lastSeen: "1s ago", uptime: "21d 14h", tags: ["k8s", "prod", "gcp"], pipelines: ["fluent-filter-route"] },
  { id: "a5", name: "prom-scraper-infra-prod-1", type: "prom", version: "2.55.0", latestVersion: "2.55.1", status: "warn", host: "metrics-host-11.dc.corp", region: "us-east-1", env: "prod", eps: 4200, bytesPerSec: 380_000, cpuPct: 42, memMb: 521, lastSeen: "5s ago", uptime: "3d 1h", tags: ["infra", "prod", "bare-metal"], pipelines: ["prom-remote-write"] },
  { id: "a6", name: "vector-azure-aks-prod", type: "vector", version: "0.41.0", latestVersion: "0.43.1", status: "warn", host: "aks-prod-node-007.az.corp", region: "eastus", env: "prod", eps: 7800, bytesPerSec: 670_000, cpuPct: 31, memMb: 240, lastSeen: "12s ago", uptime: "2d 8h", tags: ["k8s", "prod", "azure"], pipelines: ["vector-enrich-drop"] },
  { id: "a7", name: "otel-baremetal-dc1-rack4", type: "otel", version: "0.118.0", latestVersion: "0.121.0", status: "warn", host: "dc1-rack4-srv-09.corp", region: "dc-us-east", env: "prod", eps: 9100, bytesPerSec: 820_000, cpuPct: 52, memMb: 640, lastSeen: "8s ago", uptime: "44d 3h", tags: ["bare-metal", "prod", "infra"], pipelines: ["otel-to-openobserve"] },
  { id: "a8", name: "beat-windows-audit-prod", type: "beat", version: "8.16.0", latestVersion: "8.17.2", status: "err", host: "win-app-srv-042.corp.local", region: "us-central-dc", env: "prod", eps: 0, bytesPerSec: 0, cpuPct: 0, memMb: 0, lastSeen: "14m ago", uptime: "—", tags: ["windows", "prod", "audit"], pipelines: ["beat-route-siem"] },
  { id: "a9", name: "fluent-bit-lambda-us-east", type: "fluent", version: "3.2.9", latestVersion: "3.3.4", status: "off", host: "lambda-log-forwarder", region: "us-east-1", env: "prod", eps: 0, bytesPerSec: 0, cpuPct: 0, memMb: 0, lastSeen: "2h ago", uptime: "—", tags: ["lambda", "prod", "aws"], pipelines: ["fluent-filter-route"] },
  { id: "a10", name: "custom-jdbc-exporter-prod", type: "custom", version: "1.2.4", latestVersion: "1.2.4", status: "ok", host: "db-exporter-01.corp", region: "us-east-1", env: "prod", eps: 320, bytesPerSec: 28_000, cpuPct: 6, memMb: 92, lastSeen: "4s ago", uptime: "88d 12h", tags: ["db", "prod", "custom"], pipelines: ["custom-enrich-sink"] },
];

export const DATA_SOURCES: DataSource[] = [
  // Cloud
  { name: "AWS CloudTrail", category: "Cloud", icon: "☁️", connectedAgents: 48, eps: 12400, description: "Management and data events across AWS accounts", protocol: "S3 / SQS" },
  { name: "AWS VPC Flow Logs", category: "Cloud", icon: "🌐", connectedAgents: 36, eps: 89000, description: "IP traffic records for VPC network interfaces", protocol: "S3 / CWL" },
  { name: "AWS GuardDuty", category: "Cloud", icon: "🛡️", connectedAgents: 12, eps: 340, description: "Intelligent threat detection service findings", protocol: "EventBridge" },
  { name: "GCP Audit Logs", category: "Cloud", icon: "☁️", connectedAgents: 18, eps: 7200, description: "Admin Activity, Data Access, System Event logs", protocol: "Pub/Sub" },
  { name: "Azure Monitor", category: "Cloud", icon: "☁️", connectedAgents: 24, eps: 18600, description: "Activity logs, diagnostics and resource metrics", protocol: "Event Hub" },
  // Kubernetes
  { name: "Kubernetes Events", category: "Kubernetes", icon: "⚙️", connectedAgents: 62, eps: 41200, description: "Pod, node, deployment and HPA events", protocol: "OTLP / API" },
  { name: "Container Stdout", category: "Kubernetes", icon: "📦", connectedAgents: 104, eps: 128000, description: "stdout/stderr from all running containers", protocol: "CRI / OTLP" },
  { name: "kube-state-metrics", category: "Kubernetes", icon: "📊", connectedAgents: 38, eps: 9200, description: "Kubernetes object state metrics (Prometheus)", protocol: "Prometheus" },
  // Databases
  { name: "PostgreSQL Logs", category: "Databases", icon: "🐘", connectedAgents: 21, eps: 4100, description: "Slow query, error and DDL statement logs", protocol: "JDBC / file" },
  { name: "MySQL Slow Query", category: "Databases", icon: "🐬", connectedAgents: 14, eps: 1800, description: "Slow query and general query log events", protocol: "file / JDBC" },
  { name: "MongoDB Oplog", category: "Databases", icon: "🍃", connectedAgents: 8, eps: 2400, description: "Replication oplog for change stream capture", protocol: "MongoDB driver" },
  { name: "Redis Keyspace", category: "Databases", icon: "⚡", connectedAgents: 6, eps: 7800, description: "Keyspace notifications and command log events", protocol: "Redis RESP" },
  // Applications
  { name: "OTLP / gRPC", category: "Applications", icon: "🔗", connectedAgents: 214, eps: 195000, description: "OpenTelemetry SDK native traces, metrics, logs", protocol: "OTLP gRPC/HTTP" },
  { name: "Prometheus Scrape", category: "Applications", icon: "📈", connectedAgents: 103, eps: 0, description: "Scrape /metrics endpoints for time-series data", protocol: "Prometheus" },
  { name: "Syslog (UDP/TCP)", category: "Applications", icon: "📝", connectedAgents: 72, eps: 34200, description: "RFC 5424 and BSD syslog from hosts and appliances", protocol: "Syslog" },
  { name: "Kafka Consumer", category: "Applications", icon: "🔄", connectedAgents: 18, eps: 48000, description: "Consume log/event topics from Apache Kafka", protocol: "Kafka" },
];

export const PIPELINES: Pipeline[] = [
  { id: "p1", name: "otel-to-openobserve", input: "OTLP gRPC :4317", transforms: ["attr-enrichment", "k8s-tagger", "pii-redact"], output: "OpenObserve HTTP", eps: 148000, status: "ok", agentCount: 312, lastModified: "3 days ago" },
  { id: "p2", name: "vector-enrich-drop", input: "Docker logs", transforms: ["json-parse", "level-filter", "field-map"], output: "OpenObserve HTTP", eps: 22400, status: "ok", agentCount: 88, lastModified: "1 week ago" },
  { id: "p3", name: "fluent-filter-route", input: "Syslog :514", transforms: ["parser", "geo-lookup", "severity-map"], output: "OpenObserve + S3", eps: 41800, status: "ok", agentCount: 72, lastModified: "5 days ago" },
  { id: "p4", name: "prom-remote-write", input: "Prometheus scrape", transforms: ["label-drop", "downsample-5m"], output: "OpenObserve RemoteWrite", eps: 0, status: "warn", agentCount: 38, lastModified: "2 weeks ago" },
  { id: "p5", name: "beat-route-siem", input: "Winlogbeat :5044", transforms: ["ecs-normalize", "sigma-enrich"], output: "OpenObserve SIEM stream", eps: 3200, status: "err", agentCount: 45, lastModified: "1 day ago" },
  { id: "p6", name: "custom-enrich-sink", input: "JDBC exporter", transforms: ["row-flatten", "type-cast"], output: "OpenObserve HTTP", eps: 320, status: "ok", agentCount: 10, lastModified: "1 month ago" },
];

export const CONFIG_TEMPLATES: ConfigTemplate[] = [
  { id: "c1", name: "OTel Collector — Kubernetes Full", icon: "⚙️", description: "Traces, metrics, logs from pods, nodes and k8s events. Includes k8s-tagger, batch and retry.", agentType: "otel", agentsDeployed: 312, version: "v4.2.1", lastPushed: "2h ago" },
  { id: "c2", name: "Vector — Container Log Enrichment", icon: "⚡", description: "Docker/CRI log parse, JSON extraction, PII field redaction and label enrichment.", agentType: "vector", agentsDeployed: 88, version: "v2.1.0", lastPushed: "1d ago" },
  { id: "c3", name: "Fluent Bit — Syslog + Geo", icon: "🔀", description: "Syslog RFC5424 input, geo-IP lookup, severity mapping, route to OpenObserve + S3 backup.", agentType: "fluent", agentsDeployed: 72, version: "v1.8.3", lastPushed: "3d ago" },
  { id: "c4", name: "Prometheus — Infra Scrape", icon: "📊", description: "Node exporter, cAdvisor, kube-state-metrics scrape config with 5m downsampling.", agentType: "prom", agentsDeployed: 38, version: "v1.4.0", lastPushed: "6d ago" },
  { id: "c5", name: "Winlogbeat — Security Audit", icon: "🛡️", description: "Windows Security, System and PowerShell event log channels, ECS normalization, SIEM routing.", agentType: "beat", agentsDeployed: 45, version: "v3.0.1", lastPushed: "12h ago" },
  { id: "c6", name: "Custom JDBC Exporter", icon: "🐘", description: "PostgreSQL and MySQL slow query + metrics export via JDBC with row flattening.", agentType: "custom", agentsDeployed: 10, version: "v1.2.4", lastPushed: "1mo ago" },
];

export const RECENT_EVENTS = [
  { kind: "ok", time: "0:31", msg: "Config push succeeded", agent: "otel-k8s-prod-us-east-1a" },
  { kind: "warn", time: "1:44", msg: "High CPU — 52% avg over 10 min", agent: "otel-baremetal-dc1-rack4" },
  { kind: "ok", time: "3:12", msg: "Agent upgraded 0.120.0 → 0.121.0", agent: "fluent-bit-gke-prod-eu" },
  { kind: "err", time: "14:07", msg: "Connection lost to OpenObserve endpoint", agent: "beat-windows-audit-prod" },
  { kind: "warn", time: "22:51", msg: "Version 0.41.0 is 2 versions behind latest", agent: "vector-azure-aks-prod" },
  { kind: "ok", time: "38:16", msg: "New agent registered and connected", agent: "otel-k8s-prod-eu-central" },
  { kind: "ok", time: "1h 2m", msg: "Pipeline prom-remote-write restarted", agent: "prom-scraper-infra-prod-1" },
];

export const HEALTH_METRICS = [
  { label: "Connectivity", ok: 1201, total: 1284, pct: 93.5, color: "#16a35d" },
  { label: "Config Sync", ok: 1163, total: 1284, pct: 90.6, color: "#1aaf88" },
  { label: "Version Current", ok: 1044, total: 1284, pct: 81.3, color: "#2563eb" },
  { label: "Data Flowing", ok: 1178, total: 1284, pct: 91.7, color: "#7c3aed" },
];

export function fmtBytes(b: number) {
  if (b >= 1_000_000) return (b / 1_000_000).toFixed(1) + " MB/s";
  if (b >= 1_000) return (b / 1_000).toFixed(0) + " KB/s";
  return b + " B/s";
}
export function fmtEps(e: number) {
  if (e >= 1_000_000) return (e / 1_000_000).toFixed(1) + "M";
  if (e >= 1_000) return (e / 1_000).toFixed(1) + "k";
  return e.toString();
}
