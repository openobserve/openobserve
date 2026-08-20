// Copyright 2026 OpenObserve Inc.
//
// ocsf.ts — the slice of the Open Cybersecurity Schema Framework the SIEM speaks.
//
// OCSF is the vocabulary that lets one Events page show CloudTrail, Okta, Sysmon
// and nginx side by side: every source is mapped onto the same class, severity,
// actor, endpoint and outcome, so a column means the same thing whatever
// produced the row. https://schema.ocsf.io
//
// This is deliberately a subset. OCSF 1.x defines eight categories and well over
// a hundred classes; carrying all of them would be dead weight, because a class
// only earns its place here once something can actually map a log source onto
// it. Every class listed is referenced by an entry in sourceTypes.ts.

/** OCSF category uids, which are also the first digit of every class uid. */
export const OCSF_CATEGORIES = [
  { uid: 1, name: "System Activity", short: "System" },
  { uid: 2, name: "Findings", short: "Findings" },
  { uid: 3, name: "Identity & Access Management", short: "IAM" },
  { uid: 4, name: "Network Activity", short: "Network" },
  { uid: 5, name: "Discovery", short: "Discovery" },
  { uid: 6, name: "Application Activity", short: "Application" },
  { uid: 7, name: "Remediation", short: "Remediation" },
  { uid: 8, name: "Unmanned Systems", short: "Unmanned" },
] as const;

export type OcsfCategoryUid = (typeof OCSF_CATEGORIES)[number]["uid"];

export interface OcsfClass {
  uid: number;
  name: string;
  category: OcsfCategoryUid;
}

/** Classes reachable from at least one source type. */
export const OCSF_CLASSES: OcsfClass[] = [
  // System Activity
  { uid: 1001, name: "File System Activity", category: 1 },
  { uid: 1007, name: "Process Activity", category: 1 },
  { uid: 1008, name: "Event Log Activity", category: 1 },
  { uid: 1009, name: "Script Activity", category: 1 },
  { uid: 201001, name: "Registry Key Activity", category: 1 },
  { uid: 201002, name: "Registry Value Activity", category: 1 },
  // Findings
  { uid: 2001, name: "Security Finding", category: 2 },
  { uid: 2004, name: "Detection Finding", category: 2 },
  // Identity & Access Management
  { uid: 3001, name: "Account Change", category: 3 },
  { uid: 3002, name: "Authentication", category: 3 },
  { uid: 3003, name: "Authorize Session", category: 3 },
  { uid: 3005, name: "User Access Management", category: 3 },
  // Network Activity
  { uid: 4001, name: "Network Activity", category: 4 },
  { uid: 4002, name: "HTTP Activity", category: 4 },
  { uid: 4003, name: "DNS Activity", category: 4 },
  { uid: 4007, name: "SSH Activity", category: 4 },
  { uid: 4009, name: "Email Activity", category: 4 },
  // Application Activity
  { uid: 6003, name: "API Activity", category: 6 },
  { uid: 6004, name: "Web Resource Access Activity", category: 6 },
];

const CLASS_BY_UID = new Map(OCSF_CLASSES.map((c) => [c.uid, c]));
const CATEGORY_BY_UID = new Map(OCSF_CATEGORIES.map((c) => [c.uid, c]));

export function ocsfClass(uid: number | undefined | null): OcsfClass | undefined {
  return uid == null ? undefined : CLASS_BY_UID.get(Number(uid));
}

/**
 * The category of a class uid. Derived from the uid's leading digits rather than
 * a lookup, so a class this file has not enumerated still lands in the right
 * bucket: 4002 is Network whether or not HTTP Activity is listed above.
 */
export function ocsfCategoryOf(classUid: number | undefined | null) {
  if (classUid == null) return undefined;
  const uid = Number(classUid);
  if (!Number.isFinite(uid)) return undefined;
  const known = CLASS_BY_UID.get(uid);
  if (known) return CATEGORY_BY_UID.get(known.category);
  // Extension classes are prefixed (201001 is a Windows extension of System),
  // so the category is the leading digit of the last four.
  const base = uid > 100000 ? uid % 100000 : uid;
  return CATEGORY_BY_UID.get(Math.floor(base / 1000) as OcsfCategoryUid);
}

/**
 * OCSF's severity scale. Not the same as a log level: 0 and 99 both mean "we do
 * not know", which is why they render as Unknown rather than collapsing to Info.
 */
export const OCSF_SEVERITY = [
  { id: 0, name: "Unknown", tone: "muted" },
  { id: 1, name: "Informational", tone: "info" },
  { id: 2, name: "Low", tone: "low" },
  { id: 3, name: "Medium", tone: "medium" },
  { id: 4, name: "High", tone: "high" },
  { id: 5, name: "Critical", tone: "critical" },
  { id: 6, name: "Fatal", tone: "critical" },
  { id: 99, name: "Other", tone: "muted" },
] as const;

const SEVERITY_BY_ID = new Map<number, (typeof OCSF_SEVERITY)[number]>(
  OCSF_SEVERITY.map((s) => [s.id, s]),
);

export function ocsfSeverity(id: number | undefined | null) {
  return SEVERITY_BY_ID.get(Number(id ?? 0)) ?? SEVERITY_BY_ID.get(0)!;
}

/**
 * Log levels and vendor severity words, mapped onto the OCSF scale. Sources
 * disagree wildly here (syslog counts up as things get better, most products
 * count the other way), so the mapping is by word, never by number.
 */
const SEVERITY_WORDS: Record<string, number> = {
  emerg: 6,
  emergency: 6,
  panic: 6,
  fatal: 6,
  alert: 5,
  crit: 5,
  critical: 5,
  sev0: 5,
  p1: 5,
  err: 4,
  error: 4,
  high: 4,
  sev1: 4,
  p2: 4,
  warn: 3,
  warning: 3,
  medium: 3,
  moderate: 3,
  sev2: 3,
  p3: 3,
  notice: 2,
  low: 2,
  minor: 2,
  sev3: 2,
  p4: 2,
  info: 1,
  informational: 1,
  information: 1,
  debug: 1,
  trace: 1,
  none: 1,
};

/** Best-effort severity for a value that may be a number, a word, or absent. */
export function toOcsfSeverity(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 && value <= 6 ? value : 99;
  }
  const word = String(value).trim().toLowerCase();
  if (word in SEVERITY_WORDS) return SEVERITY_WORDS[word];
  const asNumber = Number(word);
  if (Number.isFinite(asNumber) && asNumber >= 0 && asNumber <= 6) return asNumber;
  return 0;
}

/** OCSF status_id, the "did it work" axis, kept separate from severity. */
export const OCSF_STATUS = [
  { id: 0, name: "Unknown" },
  { id: 1, name: "Success" },
  { id: 2, name: "Failure" },
  { id: 99, name: "Other" },
] as const;

const SUCCESS_WORDS = new Set([
  "success",
  "succeeded",
  "allow",
  "allowed",
  "accept",
  "accepted",
  "ok",
  "pass",
  "passed",
  "true",
  "granted",
  "0",
]);
const FAILURE_WORDS = new Set([
  "failure",
  "failed",
  "fail",
  "deny",
  "denied",
  "denied_by_policy",
  "block",
  "blocked",
  "drop",
  "dropped",
  "error",
  "reject",
  "rejected",
  "false",
  "invalid",
]);

/** Best-effort outcome for an action/result/outcome style field. */
export function toOcsfStatus(value: unknown): number {
  if (value == null || value === "") return 0;
  const word = String(value).trim().toLowerCase();
  if (SUCCESS_WORDS.has(word)) return 1;
  if (FAILURE_WORDS.has(word)) return 2;
  // HTTP status codes are the common numeric case: 2xx/3xx worked, 4xx/5xx did not.
  const code = Number(word);
  if (Number.isFinite(code) && code >= 100 && code < 600) return code < 400 ? 1 : 2;
  return 99;
}

export function ocsfStatusName(id: number | undefined | null): string {
  return OCSF_STATUS.find((s) => s.id === Number(id ?? 0))?.name ?? "Unknown";
}

/**
 * The normalized event every source is mapped onto. These are the columns the
 * Events page can always show, whatever the underlying stream looks like.
 * `raw` is kept so the detail view can show what actually arrived.
 */
export interface NormalizedEvent {
  time: number | null;
  classUid: number | null;
  className: string;
  activity: string;
  severityId: number;
  statusId: number;
  actor: string;
  actorId: string;
  srcIp: string;
  srcPort: string;
  dstIp: string;
  dstPort: string;
  host: string;
  process: string;
  product: string;
  vendor: string;
  operation: string;
  resource: string;
  message: string;
  raw: Record<string, unknown>;
}

/** Column identifiers for the normalized view, in the order a SOC reads them. */
export const NORMALIZED_COLUMNS = [
  "time",
  "severityId",
  "className",
  "activity",
  "statusId",
  "actor",
  "srcIp",
  "dstIp",
  "host",
  "process",
  "operation",
  "resource",
  "product",
  "message",
] as const;

export type NormalizedColumn = (typeof NORMALIZED_COLUMNS)[number];
