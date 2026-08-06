// Mock SIEM data for Phase 0 UI development.
// Replace with real API calls in Sprint 2–4.

// ── OSM field definitions (shown in field picker) ────────────────────────────
export const OSM_FIELDS = [
  { alias: "osm.user",    ocsf: "actor.user.name",             type: "string",  example: "j.torres" },
  { alias: "osm.uid",     ocsf: "actor.user.uid",              type: "string",  example: "user@example.com" },
  { alias: "osm.src",     ocsf: "src_endpoint.ip",             type: "string",  example: "203.0.113.42" },
  { alias: "osm.dst",     ocsf: "dst_endpoint.ip",             type: "string",  example: "10.0.0.1" },
  { alias: "osm.host",    ocsf: "device.hostname",             type: "string",  example: "WIN-DC01" },
  { alias: "osm.product", ocsf: "metadata.product.name",       type: "string",  example: "okta" },
  { alias: "osm.sev",     ocsf: "severity_id",                 type: "integer", example: "4" },
  { alias: "osm.class",   ocsf: "class_uid",                   type: "integer", example: "4001" },
  { alias: "osm.act",     ocsf: "activity_name",               type: "string",  example: "Logon" },
  { alias: "osm.geo",     ocsf: "src_endpoint.location.city",  type: "string",  example: "São Paulo" },
  { alias: "osm.process", ocsf: "actor.process.name",          type: "string",  example: "powershell.exe" },
];

// ── Saved queries ────────────────────────────────────────────────────────────
export const SAVED_QUERIES = [
  { id: "sq1", name: "Failed logins last 1h",      sql: "SELECT osm.user, COUNT(*) as cnt FROM security_events WHERE osm.sev >= 3 AND status_id = 2 GROUP BY osm.user ORDER BY cnt DESC" },
  { id: "sq2", name: "Lateral movement candidates", sql: "SELECT osm.src, osm.dst, COUNT(*) as hops FROM security_events WHERE class_uid = 4004 GROUP BY osm.src, osm.dst HAVING hops > 5" },
  { id: "sq3", name: "Impossible travel (Okta)",   sql: "SELECT actor.user.name, COUNT(DISTINCT src_endpoint.location.country) as countries FROM security_events WHERE metadata.product.name = 'okta' AND activity_name = 'Logon' GROUP BY actor.user.name HAVING countries > 1" },
];

// ── Detection rules ──────────────────────────────────────────────────────────
export const DETECTIONS = [
  {
    id: "det1",
    name: "Impossible Travel - Okta",
    severity: "high",
    source: "okta",
    enabled: true,
    mitre: ["T1078", "T1550"],
    tactic: "Initial Access",
    lastFired: "2026-06-17T14:22:00Z",
    alerts: 3,
    sigma: `title: Impossible Travel - Okta\nstatus: stable\ntags:\n  - attack.t1078\n  - attack.initial_access\ndetection:\n  selection:\n    metadata.product.name: okta\n    activity_name: Logon\n  condition: selection`,
  },
  {
    id: "det2",
    name: "Admin Account Created Outside IAM",
    severity: "critical",
    source: "aws_cloudtrail",
    enabled: true,
    mitre: ["T1136", "T1098"],
    tactic: "Persistence",
    lastFired: "2026-06-16T09:05:00Z",
    alerts: 1,
    sigma: `title: Admin Account Created Outside IAM\nstatus: stable\ntags:\n  - attack.t1136\n  - attack.persistence\ndetection:\n  selection:\n    metadata.product.name: aws_cloudtrail\n    activity_name: CreateUser\n  condition: selection`,
  },
  {
    id: "det3",
    name: "Powershell with -EncodedCommand",
    severity: "medium",
    source: "syslog",
    enabled: false,
    mitre: ["T1059.001"],
    tactic: "Execution",
    lastFired: null,
    alerts: 0,
    sigma: `title: Powershell Encoded Command\nstatus: experimental\ntags:\n  - attack.t1059.001\n  - attack.execution\ndetection:\n  selection:\n    actor.process.name|contains: powershell\n    message|contains: '-EncodedCommand'\n  condition: selection`,
  },
  {
    id: "det4",
    name: "S3 Bucket Made Public",
    severity: "high",
    source: "aws_cloudtrail",
    enabled: true,
    mitre: ["T1530"],
    tactic: "Collection",
    lastFired: "2026-06-15T11:48:00Z",
    alerts: 2,
    sigma: `title: S3 Bucket Public ACL\nstatus: stable\ntags:\n  - attack.t1530\n  - attack.collection\ndetection:\n  selection:\n    metadata.product.name: aws_cloudtrail\n    activity_name: PutBucketAcl\n  condition: selection`,
  },
];

// ── Alert findings ────────────────────────────────────────────────────────────
export type AlertStatus = "open" | "ack" | "closed";
export type Disposition = "" | "tp" | "fp" | "benign" | "duplicate";

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: AlertStatus;
  disposition: Disposition;
  assignee: string;
  triggeredAt: string;
  src: string;
  user: string;
  host: string;
  mitre: string[];
  caseId: string | null;
}

export const ALERTS: Alert[] = [
  { id: "a1",  ruleId: "det1", ruleName: "Impossible Travel - Okta",          severity: "high",     status: "open",   disposition: "",          assignee: "",          triggeredAt: "2026-06-17T14:22:00Z", src: "185.220.101.12", user: "j.torres",    host: "unknown",   mitre: ["T1078"], caseId: null },
  { id: "a2",  ruleId: "det1", ruleName: "Impossible Travel - Okta",          severity: "high",     status: "open",   disposition: "",          assignee: "",          triggeredAt: "2026-06-17T12:05:00Z", src: "45.142.212.31",  user: "m.chen",     host: "unknown",   mitre: ["T1078"], caseId: null },
  { id: "a3",  ruleId: "det1", ruleName: "Impossible Travel - Okta",          severity: "high",     status: "ack",    disposition: "",          assignee: "alice",     triggeredAt: "2026-06-17T08:44:00Z", src: "103.94.123.5",   user: "r.patel",    host: "unknown",   mitre: ["T1078"], caseId: "c1" },
  { id: "a4",  ruleId: "det2", ruleName: "Admin Account Created Outside IAM", severity: "critical", status: "open",   disposition: "",          assignee: "",          triggeredAt: "2026-06-16T09:05:00Z", src: "54.239.28.85",   user: "aws-service", host: "us-east-1", mitre: ["T1136"], caseId: null },
  { id: "a5",  ruleId: "det4", ruleName: "S3 Bucket Made Public",             severity: "high",     status: "closed", disposition: "fp",        assignee: "bob",       triggeredAt: "2026-06-15T11:48:00Z", src: "52.217.12.44",   user: "devops-ci",  host: "us-west-2", mitre: ["T1530"], caseId: null },
  { id: "a6",  ruleId: "det4", ruleName: "S3 Bucket Made Public",             severity: "high",     status: "closed", disposition: "tp",        assignee: "alice",     triggeredAt: "2026-06-14T16:30:00Z", src: "3.32.1.190",     user: "j.smith",    host: "us-east-1", mitre: ["T1530"], caseId: "c1" },
];

// ── Alert detail (for drawer) ─────────────────────────────────────────────────
export const ALERT_DETAIL: Record<string, Record<string, string>> = {
  a1: {
    "actor.user.name":                "j.torres",
    "actor.user.uid":                 "javier.torres@corp.example",
    "src_endpoint.ip":                "185.220.101.12",
    "src_endpoint.location.city":     "Bratislava",
    "src_endpoint.location.country":  "Slovakia",
    "dst_endpoint.ip":                "10.0.0.42",
    "device.hostname":                "unknown",
    "metadata.product.name":          "okta",
    "metadata.product.vendor":        "Okta",
    "metadata.version":               "1.1.0",
    "class_uid":                      "4001",
    "class_name":                     "Authentication Activity",
    "activity_name":                  "Logon",
    "severity_id":                    "4",
    "status_id":                      "1",
    "_timestamp":                     "2026-06-17T14:22:00Z",
  },
};

// ── Helper: severity label ────────────────────────────────────────────────────
export function sevLabel(sev: Alert["severity"]): string {
  const m: Record<string, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
  return m[sev] ?? sev;
}

// ── Helper: capitalize ────────────────────────────────────────────────────────
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
