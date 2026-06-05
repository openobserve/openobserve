// data3.jsx — explorer field lists + RUM/traces data
const ftype = t => ({ str: "Tt", num: "#", ts: "◷", bool: "◑" }[t] || "Tt");

const LOG_FIELDS = [
  { group: "Key fields", count: 16, fields: [
    ["_timestamp", "ts"], ["body", "str"], ["error", "str"], ["exception_message", "str"],
    ["exception_stacktrace", "str"], ["exception_type", "str"], ["host_arch", "str"], ["host_name", "str"],
    ["level", "str"], ["message", "str"], ["service_criticality", "str"], ["service_instance_id", "str"],
    ["service_name", "str"], ["service_namespace", "str"], ["service_version", "str"], ["severity", "str"],
  ]},
  { group: "Common", count: 5, fields: [
    ["job", "str"], ["kubernetes_labels_app", "str"], ["kubernetes_labels_app_kubernetes_io_name", "str"],
    ["resource_host_name", "str"], ["version", "str"],
  ]},
  { group: "Kubernetes", count: 43, collapsed: true, fields: [
    ["kubernetes_namespace", "str"], ["kubernetes_pod_name", "str"], ["kubernetes_pod_id", "str"],
    ["kubernetes_container_name", "str"], ["kubernetes_node_name", "str"], ["kubernetes_host", "str"],
  ]},
];
const TRACE_FIELDS = [
  { group: "Key fields", count: 55, fields: [
    ["duration", "num"], ["service_name", "str"], ["operation_name", "str"], ["trace_id", "str"], ["span_id", "str"],
    ["service_browser_brands", "str"], ["service_browser_language", "str"], ["service_browser_mobile", "bool"],
    ["service_browser_platform", "str"], ["service_container_id", "str"], ["service_deployment_environment", "str"],
    ["service_environment", "str"], ["service_host_arch", "str"], ["service_host_name", "str"],
    ["service_k8s_cluster", "str"], ["service_k8s_deployment_name", "str"], ["service_k8s_namespace_name", "str"],
    ["service_k8s_node_name", "str"], ["service_k8s_pod_ip", "str"], ["service_k8s_pod_name", "str"],
    ["status_code", "num"], ["span_kind", "str"], ["http_method", "str"], ["http_route", "str"],
  ]},
];
const METRIC_FIELDS = [
  { group: "Fields", count: 7, fields: [
    ["__hash__", "str"], ["__name__", "str"], ["_timestamp", "ts"], ["flag", "str"],
    ["instrumentation_library_name", "str"], ["instrumentation_library_version", "str"], ["start_time", "ts"],
  ]},
];

// expandable log records (realistic access-log shape)
const IPS = ["10.10.104.66", "10.10.104.75", "10.10.104.51", "10.10.104.69", "10.10.192.4", "10.10.103.86", "10.10.102.223", "10.10.100.239", "10.10.104.57", "10.10.101.203"];
const PATHS = ["GET /healthz HTTP/1.1", "GET /api/v1/streams?type=logs HTTP/1.1", "GET /metrics HTTP/1.1", "POST /api/v1/_bulk HTTP/1.1", "GET /api/v1/functions?page_num=1 HTTP/1.1"];
const LOG_ROWS = Array.from({ length: 40 }, (_, i) => {
  const t = new Date("2026-06-05T15:56:36Z").getTime() - i * 1130;
  const d = new Date(t);
  const ip = IPS[i % IPS.length];
  const path = PATHS[i % PATHS.length];
  const lvl = i % 13 === 5 ? "ERROR" : i % 7 === 3 ? "WARN" : "INFO";
  const ts = d.toISOString().replace("T", " ").slice(0, 23);
  return {
    ts, ms: t, level: lvl, ip, path,
    body: `${d.toISOString()} ${lvl} config::axum::middlewares::access_log: ${ip} "${path}" 200 - "-" "-" "kube-probe/1.34" 0.000`,
    fields: {
      _timestamp: String(t) + "000",
      service_name: "openobserve", service_namespace: "default", level: lvl,
      host_name: "ingester-0" + (i % 4), kubernetes_namespace: "o2", kubernetes_pod_name: "router-" + (1000 + i),
      http_method: path.split(" ")[0], http_status: "200", source_ip: ip, duration_ms: (Math.random() * 4).toFixed(3),
    },
  };
});

// traces spans
const TRACE_SPANS = Array.from({ length: 26 }, (_, i) => {
  const svcs = ["api-gateway", "auth-svc", "orders-svc", "payments-svc", "catalog-svc", "db-proxy"];
  const ops = ["GET /checkout", "POST /orders", "GET /me", "POST /pay", "GET /catalog/{id}", "SELECT users"];
  const svc = svcs[i % svcs.length];
  const dur = 8 + Math.round(Math.abs(Math.sin(i * 1.3)) * 540);
  return { id: (Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 8)), svc, op: ops[i % ops.length], dur, spans: 3 + (i % 11), err: i % 9 === 4, start: `${(i * 0.7).toFixed(1)}s ago` };
});
const SVC_HUE = { "api-gateway": 210, "auth-svc": 150, "orders-svc": 28, "payments-svc": 280, "catalog-svc": 330, "db-proxy": 190 };

// RUM
const WEB_VITALS = [
  { name: "LCP", full: "Largest Contentful Paint", val: 1.8, unit: "s", rating: "good", pct: 32, good: "≤2.5s" },
  { name: "INP", full: "Interaction to Next Paint", val: 142, unit: "ms", rating: "good", pct: 28, good: "≤200ms" },
  { name: "CLS", full: "Cumulative Layout Shift", val: 0.14, unit: "", rating: "ni", pct: 56, good: "≤0.1" },
  { name: "FCP", full: "First Contentful Paint", val: 1.1, unit: "s", rating: "good", pct: 24, good: "≤1.8s" },
  { name: "TTFB", full: "Time to First Byte", val: 0.9, unit: "s", rating: "ni", pct: 60, good: "≤0.8s" },
];
const RUM_SESSIONS = Array.from({ length: 22 }, (_, i) => {
  const browsers = ["Chrome", "Safari", "Firefox", "Edge"];
  const os = ["macOS", "Windows", "iOS", "Android"];
  const countries = ["US", "DE", "IN", "JP", "BR", "GB"];
  return {
    id: "sess_" + Math.random().toString(16).slice(2, 10),
    user: ["ada@acme.io", "grace@acme.io", "anon", "kj@acme.io", "linus@acme.io"][i % 5],
    browser: browsers[i % 4], os: os[i % 4], country: countries[i % 6],
    duration: `${1 + (i % 9)}m ${10 + (i * 7 % 50)}s`, views: 2 + (i % 14), errors: i % 5 === 2 ? (i % 3) + 1 : 0,
    when: `${2 + i}m ago`,
  };
});
const RUM_ERRORS = Array.from({ length: 14 }, (_, i) => ({
  id: i,
  msg: ["TypeError: Cannot read 'map' of undefined", "ChunkLoadError: Loading chunk 12 failed", "Network request failed", "Uncaught (in promise) AbortError", "ResizeObserver loop limit exceeded"][i % 5],
  source: ["app.4f2c.js:1:24180", "vendor.8a1.js:2:9921", "main.js:14:55", "checkout.js:3:140"][i % 4],
  count: 240 - i * 14, users: 80 - i * 5, last: `${i + 1}m ago`,
}));

Object.assign(window, { ftype, LOG_FIELDS, TRACE_FIELDS, METRIC_FIELDS, LOG_ROWS, TRACE_SPANS, SVC_HUE, WEB_VITALS, RUM_SESSIONS, RUM_ERRORS });
