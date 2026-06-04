// data2.jsx — records for IAM, Settings, Dashboard flows
const H = window.hue;

const IAM_USERS = [
  { id: "u1", name: "Platform Team", email: "pt@russia.com", role: "admin", status: "active", last: "2 min ago", groups: ["Platform", "On-call"], mfa: true },
  { id: "u2", name: "Ada Lovelace", email: "ada@acme.io", role: "editor", status: "active", last: "1 h ago", groups: ["Analytics"], mfa: true },
  { id: "u3", name: "Grace Hopper", email: "grace@acme.io", role: "editor", status: "active", last: "3 h ago", groups: ["Platform"], mfa: false },
  { id: "u4", name: "Alan Turing", email: "alan@acme.io", role: "viewer", status: "active", last: "yesterday", groups: ["Analytics", "Audit"], mfa: true },
  { id: "u5", name: "Katherine Johnson", email: "kj@acme.io", role: "editor", status: "active", last: "2 d ago", groups: ["On-call"], mfa: true },
  { id: "u6", name: "Linus Pauling", email: "linus@acme.io", role: "viewer", status: "suspended", last: "3 w ago", groups: [], mfa: false },
];
const IAM_GROUPS_REC = [
  { id: "g1", name: "Platform", members: 8, roles: ["admin", "editor"], desc: "Core platform engineers" },
  { id: "g2", name: "Analytics", members: 14, roles: ["editor", "viewer"], desc: "Data & analytics team" },
  { id: "g3", name: "On-call", members: 6, roles: ["alerts-manager"], desc: "Rotation responders" },
  { id: "g4", name: "Audit", members: 3, roles: ["viewer"], desc: "Read-only compliance" },
];
const IAM_SA = [
  { id: "s1", name: "ci-pipeline", token: "oo_sa_3kP9…xQ2", created: "Jan 12, 2026", scopes: ["ingest:write", "streams:read"], expiry: "No expiry" },
  { id: "s2", name: "grafana-reader", token: "oo_sa_7mN2…aB8", created: "Feb 3, 2026", scopes: ["dashboards:read", "metrics:read"], expiry: "Dec 31, 2026" },
  { id: "s3", name: "terraform", token: "oo_sa_1qW5…zR4", created: "Mar 20, 2026", scopes: ["*"], expiry: "No expiry" },
];
const IAM_ORGS = [
  { id: "o1", name: "default", plan: "Enterprise", members: 42, region: "us-east-1", created: "2024" },
  { id: "o2", name: "acme-prod", plan: "Enterprise", members: 28, region: "us-east-1", created: "2025" },
  { id: "o3", name: "staging", plan: "Pro", members: 11, region: "eu-west-1", created: "2025" },
];
const IAM_QUOTA = [
  { id: "q1", name: "Ingestion volume", used: 1.2, cap: 2, unit: "TB/day", pct: 60 },
  { id: "q2", name: "Active streams", used: 47, cap: 100, unit: "streams", pct: 47 },
  { id: "q3", name: "Dashboards", used: 1036, cap: 2000, unit: "dashboards", pct: 52 },
  { id: "q4", name: "Alert rules", used: 8, cap: 50, unit: "rules", pct: 16 },
  { id: "q5", name: "API requests", used: 84, cap: 100, unit: "k/min", pct: 84 },
];
const IAM_INVITES = [
  { id: "i1", name: "newhire@acme.io", role: "viewer", sent: "2 d ago", status: "pending" },
  { id: "i2", name: "contractor@ext.io", role: "editor", sent: "5 d ago", status: "pending" },
  { id: "i3", name: "intern@acme.io", role: "viewer", sent: "1 w ago", status: "expired" },
];

// permission matrix categories (reused for roles)
const PERM_CATS = ["Dashboards", "Logs & Streams", "Metrics", "Traces", "Alerts", "Pipelines", "IAM & Users", "Settings", "Billing"];

// Settings records
const SET_TEMPLATES = [
  { id: "t1", name: "slack-default", type: "Slack", used: 4 },
  { id: "t2", name: "pagerduty-critical", type: "PagerDuty", used: 2 },
  { id: "t3", name: "email-digest", type: "Email", used: 7 },
  { id: "t4", name: "webhook-generic", type: "Webhook", used: 1 },
];
const SET_DESTINATIONS = [
  { id: "d1", name: "#alerts-prod", type: "Slack", url: "hooks.slack.com/…/T0/B1", active: true },
  { id: "d2", name: "oncall-pd", type: "PagerDuty", url: "events.pagerduty.com/…", active: true },
  { id: "d3", name: "ops-email", type: "Email", url: "ops@acme.io", active: true },
  { id: "d4", name: "siem-forward", type: "Webhook", url: "siem.acme.io/ingest", active: false },
];
const SET_CIPHER = [
  { id: "c1", name: "pii-key", algo: "AES-256-GCM", created: "Jan 2026", rotated: "30 d ago" },
  { id: "c2", name: "export-key", algo: "AES-256-GCM", created: "Feb 2026", rotated: "12 d ago" },
];
const SET_REGEX = [
  { id: "r1", name: "redact-email", pattern: "[\\w.]+@[\\w.]+", replace: "[EMAIL]", used: 3 },
  { id: "r2", name: "redact-card", pattern: "\\d{4}-\\d{4}-\\d{4}-\\d{4}", replace: "[CARD]", used: 2 },
  { id: "r3", name: "redact-ssn", pattern: "\\d{3}-\\d{2}-\\d{4}", replace: "[SSN]", used: 1 },
];
const SET_NODES = [
  { id: "n1", name: "ingester-01", role: "Ingester", status: "healthy", cpu: 42, mem: 61, region: "us-east-1a" },
  { id: "n2", name: "ingester-02", role: "Ingester", status: "healthy", cpu: 38, mem: 55, region: "us-east-1b" },
  { id: "n3", name: "querier-01", role: "Querier", status: "healthy", cpu: 71, mem: 48, region: "us-east-1a" },
  { id: "n4", name: "compactor-01", role: "Compactor", status: "degraded", cpu: 88, mem: 79, region: "us-east-1c" },
  { id: "n5", name: "router-01", role: "Router", status: "healthy", cpu: 24, mem: 33, region: "us-east-1a" },
];

// Dashboard panels (for View Dashboard)
const DASH_PANELS = [
  { id: "p1", title: "Request rate", viz: "line", w: 6, h: 2, unit: "req/s" },
  { id: "p2", title: "Error ratio", viz: "stat", w: 3, h: 2, unit: "%" },
  { id: "p3", title: "p99 latency", viz: "stat", w: 3, h: 2, unit: "ms" },
  { id: "p4", title: "Throughput by service", viz: "bar", w: 6, h: 2, unit: "req/s" },
  { id: "p5", title: "CPU by pod", viz: "area", w: 6, h: 2, unit: "%" },
  { id: "p6", title: "Top endpoints", viz: "table", w: 12, h: 2, unit: "" },
];
const VIZ_TYPES = [
  { id: "line", label: "Line", icon: "metrics" }, { id: "area", label: "Area", icon: "metrics" },
  { id: "bar", label: "Bar", icon: "reports" }, { id: "stat", label: "Stat", icon: "spark" },
  { id: "gauge", label: "Gauge", icon: "rum" }, { id: "table", label: "Table", icon: "logs" },
  { id: "pie", label: "Pie", icon: "rum" }, { id: "heatmap", label: "Heatmap", icon: "grid" },
];

Object.assign(window, {
  IAM_USERS, IAM_GROUPS_REC, IAM_SA, IAM_ORGS, IAM_QUOTA, IAM_INVITES, PERM_CATS,
  SET_TEMPLATES, SET_DESTINATIONS, SET_CIPHER, SET_REGEX, SET_NODES, DASH_PANELS, VIZ_TYPES,
});
