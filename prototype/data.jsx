// data.jsx — mock data + navigation config

// L1 sidebar modules (the icon rail)
const MODULES = [
  { id: "home", label: "Home", icon: "home" },
  { id: "logs", label: "Logs", icon: "logs" },
  { id: "metrics", label: "Metrics", icon: "metrics" },
  { id: "traces", label: "Traces", icon: "traces" },
  { id: "rum", label: "RUM", icon: "rum" },
  { id: "pipelines", label: "Pipelines", icon: "pipelines" },
  { id: "dashboards", label: "Dashboards", icon: "dashboards" },
  { id: "streams", label: "Streams", icon: "streams" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "alerts", label: "Alerts", icon: "alerts" },
  { id: "incidents", label: "Incidents", icon: "incidents" },
  { id: "datasources", label: "Data sources", icon: "datasources" },
  { id: "iam", label: "IAM", icon: "iam" },
];

// folders for dashboards (matches screenshot)
const FOLDERS = [
  { id: "default", name: "default", count: 20 },
  { id: "123", name: "123", count: 4 },
  { id: "f191", name: "Folder191", count: 12 },
  { id: "f350", name: "Folder350", count: 8 },
  { id: "f463", name: "Folder463", count: 3 },
  { id: "f735", name: "Folder735", count: 16 },
  { id: "f812", name: "Folder812", count: 7 },
  { id: "t1", name: "t_1778499813088", count: 1 },
  { id: "t2", name: "t_1778499886232", count: 1 },
  { id: "t3", name: "t_1778499956747", count: 1 },
  { id: "t4", name: "t_1778500027840", count: 1 },
  { id: "t5", name: "t_1779432915788", count: 1 },
  { id: "t6", name: "t_1779432974314", count: 1 },
  { id: "t7", name: "t_1779433128594", count: 1 },
  { id: "t8", name: "t_1779433255197", count: 1 },
  { id: "t9", name: "t_1779433410857", count: 1 },
  { id: "t10", name: "t_1779433548771", count: 1 },
];

const rid = () => "74" + Math.floor(Math.random() * 9e16).toString().padStart(16, "0");
const DASH_NAMES = ["test", "VRL_Dashboard_8c9xam69n", "Dashboard_ytxzqn6ct", "Sankey_si00vjyvt",
  "Sankey_18ecs2ezb", "Dashboard_n417yji15", "Dashboard_5vhh2ig2j", "Dashboard_iohh2iuhx",
  "Dashboard_mfhufs3p0", "Dashboard_cux9v2mbt", "Dashboard_qgxpulenc", "Dashboard_sxwr08ydz",
  "Dashboard_071mmhhcu", "Dashboard_fggghx5bh", "Dashboard_auwzfri1z", "Dashboard_3tci3gcav",
  "Dashboard_0lk1z3fel", "Dashboard_3c3krcf0d", "Dashboard_pbf9mkkyx", "Dashboard_qzrr5mi6g"];
const DASH_DATES = ["Jun 3, 2026", "Jun 2, 2026", ...Array(18).fill("May 29, 2026")];
const DASHBOARDS = DASH_NAMES.map((name, i) => ({
  idx: i + 1, name, id: rid(), desc: "—", owner: "pt@russia.com", created: DASH_DATES[i],
}));

// Settings — grouped rail (A2)
const SETTINGS_GROUPS = [
  { id: "general", label: "General", items: [
    { id: "org", label: "Organization", icon: "settings" },
    { id: "members", label: "Members", icon: "users" },
    { id: "querymgmt", label: "Query Management", icon: "search" },
  ]},
  { id: "security", label: "Security", items: [
    { id: "cipher", label: "Cipher Keys", icon: "key" },
    { id: "sso", label: "SSO / OAuth", icon: "shield" },
    { id: "regex", label: "Regex Patterns", icon: "code" },
  ]},
  { id: "destinations", label: "Destinations", items: [
    { id: "templates", label: "Templates", icon: "reports" },
    { id: "dest-alerts", label: "Alert Destinations", icon: "bell" },
    { id: "dest-pipe", label: "Pipeline Destinations", icon: "pipelines" },
  ]},
  { id: "advanced", label: "Advanced", items: [
    { id: "nodes", label: "Nodes", icon: "box" },
    { id: "billing", label: "Billing & Plans", icon: "tag" },
    { id: "logs-settings", label: "Logs Settings", icon: "logs" },
    { id: "management", label: "Management", icon: "database" },
  ]},
];

// IAM — grouped rail + master-detail
const IAM_GROUPS = [
  { id: "access", label: "Access Control", items: [
    { id: "users", label: "Users", icon: "user" },
    { id: "roles", label: "Roles", icon: "shield" },
    { id: "groups", label: "Groups", icon: "users" },
  ]},
  { id: "auth", label: "Authentication", items: [
    { id: "tokens", label: "Service Accounts", icon: "key" },
    { id: "quota", label: "Organizations", icon: "globe" },
  ]},
];
const IAM_ROLES = [
  { id: "admin", name: "admin", users: 4, perms: 42, desc: "Full administrative access", system: true },
  { id: "editor", name: "editor", users: 11, perms: 28, desc: "Create & modify resources", system: true },
  { id: "viewer", name: "viewer", users: 37, perms: 9, desc: "Read-only across the org", system: true },
  { id: "alerts-mgr", name: "alerts-manager", users: 3, perms: 14, desc: "Manage alerts & destinations", system: false },
  { id: "billing", name: "billing-admin", users: 2, perms: 6, desc: "Billing & subscription", system: false },
  { id: "ingest-ro", name: "ingest-readonly", users: 8, perms: 5, desc: "View ingestion config", system: false },
];

// Ingestion — categories (A4 drill) → providers (A5 grid)
const ING_CATEGORIES = [
  { id: "recommended", label: "Recommended", icon: "spark", count: 6 },
  { id: "custom", label: "Custom", icon: "code", count: 8 },
  { id: "databases", label: "Databases", icon: "database", count: 12 },
  { id: "languages", label: "Languages", icon: "code", count: 9 },
  { id: "cloud", label: "Cloud providers", icon: "globe", count: 7 },
  { id: "security", label: "Security", icon: "shield", count: 6 },
  { id: "servers", label: "Servers & infra", icon: "box", count: 11 },
  { id: "messaging", label: "Message queues", icon: "pipelines", count: 5 },
  { id: "observ", label: "Observability", icon: "metrics", count: 8 },
  { id: "network", label: "Network", icon: "link", count: 4 },
  { id: "saas", label: "SaaS & apps", icon: "grid", count: 10 },
];
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const ING_PROVIDERS = {
  databases: ["PostgreSQL", "MySQL", "MongoDB", "Redis", "SQL Server", "Cassandra", "ClickHouse", "CouchDB", "Oracle DB", "MariaDB", "DynamoDB", "Elasticsearch"],
  languages: ["Python", "Java", "Go", "Node.js", "Ruby", "Rust", "PHP", ".NET", "Kotlin"],
  cloud: ["AWS", "Google Cloud", "Azure", "DigitalOcean", "Heroku", "Cloudflare", "Vercel"],
  recommended: ["OpenTelemetry", "Fluent Bit", "Vector", "Kubernetes", "Syslog", "Prometheus"],
  custom: ["cURL", "OTLP HTTP", "OTLP gRPC", "Filebeat", "Logstash", "Telegraf", "Fluentd", "Promtail"],
  security: ["Falco", "OSQuery", "Wazuh", "CrowdStrike", "Okta", "Auth0"],
  servers: ["Nginx", "Apache", "HAProxy", "Caddy", "IIS", "Tomcat", "Kong", "Envoy", "systemd", "Docker", "Podman"],
  messaging: ["Kafka", "RabbitMQ", "NATS", "Amazon SQS", "Pulsar"],
  observ: ["Prometheus", "Grafana", "Jaeger", "Zipkin", "StatsD", "Graphite", "Datadog Agent", "Telegraf"],
  network: ["NetFlow", "SNMP", "pfSense", "Suricata"],
  saas: ["GitHub", "GitLab", "Jira", "Stripe", "Salesforce", "Slack", "PagerDuty", "Zendesk", "Shopify", "Twilio"],
};

// Alerts — tabs (A1) + list→editor (A6)
const ALERTS = [
  { id: 1, name: "High CPU usage", stream: "prod.metrics", on: true, sev: "critical", type: "Threshold", fires: 12 },
  { id: 2, name: "5xx error spike", stream: "prod.logs", on: true, sev: "critical", type: "Threshold", fires: 4 },
  { id: 3, name: "Disk > 85%", stream: "infra.metrics", on: true, sev: "warning", type: "Threshold", fires: 1 },
  { id: 4, name: "p99 latency SLO", stream: "api.traces", on: false, sev: "warning", type: "Anomaly", fires: 0 },
  { id: 5, name: "Login failures", stream: "auth.logs", on: true, sev: "critical", type: "Frequency", fires: 7 },
  { id: 6, name: "Memory leak watch", stream: "prod.metrics", on: false, sev: "info", type: "Anomaly", fires: 0 },
  { id: 7, name: "Cert expiry < 14d", stream: "infra.events", on: true, sev: "warning", type: "Scheduled", fires: 0 },
  { id: 8, name: "Queue depth surge", stream: "kafka.metrics", on: true, sev: "warning", type: "Threshold", fires: 2 },
];

// Logs sample
const LOG_LEVELS = ["info", "info", "info", "warn", "info", "error", "debug", "info"];
const LOG_MSGS = [
  'GET /api/v1/dashboards 200 14ms org_id=default',
  'cache hit ratio=0.94 keyspace=sessions',
  'scheduler: evaluated 28 alert rules in 41ms',
  'rate limit approaching for tenant t_1778499813088',
  'flush batch=512 stream=prod.logs bytes=1.2MB',
  'connection reset by peer upstream=10.0.3.14:5432',
  'span exported trace_id=4a7f...e2 duration=88ms',
  'ingested 1,204 records stream=api.traces',
];
const LOGS = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.now() - i * 37000);
  const lvl = LOG_LEVELS[i % LOG_LEVELS.length];
  return { ts: d.toISOString().replace("T", " ").slice(0, 23), lvl, msg: LOG_MSGS[i % LOG_MSGS.length] };
});
const HIST = Array.from({ length: 48 }, (_, i) => 8 + Math.round(40 * Math.abs(Math.sin(i / 4) + 0.4 * Math.cos(i / 2.3)) + (i % 7) * 2));

// Traces sample
const SVC_COLORS = { "api-gateway": 210, "auth-svc": 150, "orders-svc": 28, "payments-svc": 280, "db": 340 };
const TRACES = Array.from({ length: 30 }, (_, i) => {
  const svcs = Object.keys(SVC_COLORS);
  const root = svcs[i % svcs.length];
  const dur = 20 + Math.round(Math.abs(Math.sin(i)) * 480);
  const err = i % 11 === 3;
  return { id: (Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)), root, op: ["GET /checkout", "POST /orders", "GET /me", "POST /pay", "GET /catalog"][i % 5], dur, spans: 4 + (i % 9), err, start: `${(i * 1.7).toFixed(1)}s ago` };
});

Object.assign(window, {
  MODULES, FOLDERS, DASHBOARDS, SETTINGS_GROUPS, IAM_GROUPS, IAM_ROLES,
  ING_CATEGORIES, ING_PROVIDERS, ALERTS, LOGS, HIST, TRACES, SVC_COLORS, hue,
});
