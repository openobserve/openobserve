// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed } from "vue";
import { flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

export const ATTACKER_IP = "185.220.101.47";
export const C2_IP = "45.137.21.9";

/** Shared, mutable grants that the `useSecurityAccess` mock reads on every call. */
export const accessGrants = { triage: true, author: true, admin: true };

export const grantAll = () => {
  accessGrants.triage = true;
  accessGrants.author = true;
  accessGrants.admin = true;
};

export const readOnly = () => {
  accessGrants.triage = false;
  accessGrants.author = false;
  accessGrants.admin = false;
};

/** A SOC analyst: triage writes only, no detection authoring or admin. */
export const triageOnly = () => {
  accessGrants.triage = true;
  accessGrants.author = false;
  accessGrants.admin = false;
};

/** A detection engineer: authoring on top of triage, without admin. */
export const authorOnly = () => {
  accessGrants.triage = true;
  accessGrants.author = true;
  accessGrants.admin = false;
};

export const mockSecurityAccess = () => ({
  loaded: computed(() => true),
  canEnter: computed(() => true),
  canOpen: computed(() => true),
  canTriage: computed(() => accessGrants.triage),
  canAuthor: computed(() => accessGrants.author),
  canAdmin: computed(() => accessGrants.admin),
  licenseLocked: computed(() => false),
});

export const okResponse = <T>(data: T) => ({
  data,
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

/** `runSql` streams over HTTP; specs route it through their `searchService.search` mock instead. */
export const runSqlVia =
  (search: (body: any, type: string) => Promise<any>) =>
  async (
    orgId: string,
    sql: string,
    startUs: number,
    endUs: number,
    size = -1,
    opts: { signal?: AbortSignal; traceId?: string } = {},
  ) => {
    const res = await search(
      {
        org_identifier: orgId,
        query: { query: { sql, start_time: startUs, end_time: endUs, from: 0, size } },
        page_type: "logs",
        signal: opts.signal,
      },
      "ui",
    );
    return {
      hits: (res?.data?.hits ?? []) as Record<string, any>[],
      total: res?.data?.total as number | undefined,
      partial: false,
      functionError: "",
    };
  };

export const nowMicros = () => Date.now() * 1000;

export const HOUR_US = 3_600_000_000;

export const cloudtrailEvent = (over: Record<string, unknown> = {}) => ({
  _timestamp: nowMicros() - 3 * HOUR_US,
  eventversion: "1.08",
  eventsource: "iam.amazonaws.com",
  eventname: "CreateAccessKey",
  awsregion: "us-east-1",
  sourceipaddress: ATTACKER_IP,
  useridentity_type: "IAMUser",
  useridentity_username: "svc-deploy",
  useridentity_arn: "arn:aws:iam::111122223333:user/svc-deploy",
  useragent: "python-requests/2.31",
  ...over,
});

export const oktaEvent = (over: Record<string, unknown> = {}) => ({
  _timestamp: nowMicros() - 6 * HOUR_US,
  eventtype: "user.session.start",
  displaymessage: "User login to Okta",
  actor_alternateid: "carol@acme.io",
  actor_displayname: "carol",
  client_ipaddress: ATTACKER_IP,
  outcome_result: "FAILURE",
  outcome_reason: "INVALID_CREDENTIALS",
  severity: "WARN",
  ...over,
});

export const sysmonEvent = (over: Record<string, unknown> = {}) => ({
  _timestamp: nowMicros() - 2 * HOUR_US,
  eventid: 1,
  computer: "WIN-FIN-07",
  user: "ACME\\dave",
  image: "C:\\Users\\Public\\mimikatz.exe",
  commandline: 'mimikatz.exe "privilege::debug" "sekurlsa::logonpasswords" exit',
  parentimage: "C:\\Windows\\System32\\cmd.exe",
  integritylevel: "High",
  ...over,
});

export const linuxAuthEvent = (over: Record<string, unknown> = {}) => ({
  _timestamp: nowMicros() - 4 * HOUR_US,
  host: "bastion",
  program: "sshd",
  message: `Failed password for invalid user root from ${ATTACKER_IP} port 51022 ssh2`,
  ...over,
});

export const vpcFlowEvent = (over: Record<string, unknown> = {}) => ({
  _timestamp: nowMicros() - 8 * HOUR_US,
  version: 2,
  srcaddr: ATTACKER_IP,
  dstaddr: "10.0.1.11",
  srcport: 55555,
  dstport: 22,
  protocol: 6,
  packets: 1,
  bytes: 60,
  action: "REJECT",
  log_status: "OK",
  ...over,
});

/** The security streams the seed generator writes, as the stream list API returns them. */
export const SEED_STREAMS = [
  "aws_cloudtrail",
  "okta_auth",
  "sysmon_process",
  "linux_auth",
  "windows_security",
  "vpc_flow",
  "k8s_audit",
  "web_access",
];

/** A stream as `GET /security/sources` lists it: a live auto-included source. */
export const sourceRow = (name: string, docs = 300) => ({
  name,
  state: "included" as const,
  reason: "auto" as const,
  suggested: false,
  verdict: null,
  source_type: "",
  offered_pack: null,
  detach_pack: null,
  health: "live" as const,
  activity: { doc_num: docs, doc_time_max: nowMicros() - 60_000_000 },
  included: null,
  updated_by: "",
  updated_at: 0,
  last_change: null,
  setting: null,
});

export const streamListEntry = (name: string, docs = 300) => ({
  name,
  stream_type: "logs",
  storage_type: "disk",
  stats: {
    doc_time_min: nowMicros() - 23 * HOUR_US,
    doc_time_max: nowMicros() - 60_000_000,
    doc_num: docs,
    storage_size: 1.2,
    compressed_size: 0.3,
  },
  schema: [],
  settings: {},
});

/** ODrawer portals into document.body through reka-ui; this stub keeps drawer content in the wrapper. */
export const drawerStubModule = {
  default: {
    name: "ODrawer",
    props: ["open"],
    emits: ["update:open"],
    template: `<div v-if="open" class="o-drawer-stub"><slot /><slot name="footer" /></div>`,
  },
};

export const RULE_STOP_LOGGING = {
  id: "8f8b5a1e-2c37-4f2c-9c4d-7d0f3b1c9a22",
  title: "AWS CloudTrail Logging Disabled",
  level: "high",
  techniques: "T1562.008",
  tactics: "defense_evasion",
  stream: "aws_cloudtrail",
  sourceType: "aws_cloudtrail",
  logsource: "product=aws service=cloudtrail",
};

export const RULE_ACCESS_KEY = {
  id: "a7e2f5c0-9d81-4b6a-8f21-5a0c9e3b6f14",
  title: "AWS IAM Access Key Created",
  level: "medium",
  techniques: "T1098.001",
  tactics: "persistence",
  stream: "aws_cloudtrail",
  sourceType: "aws_cloudtrail",
  logsource: "product=aws service=cloudtrail",
};

type SeedRule = typeof RULE_STOP_LOGGING;

/** A SIEM detection exactly as `listByFolderId` returns it: an alert carrying the sigma context attributes. */
export const siemAlert = (rule: SeedRule, alertId: string, over: Record<string, unknown> = {}) => ({
  alert_id: alertId,
  name: `${rule.title.replace(/\s+/g, "_")}__${rule.stream}`,
  stream_name: rule.stream,
  stream_type: "logs",
  enabled: true,
  is_real_time: false,
  folder_id: "default",
  folder_name: "default",
  description: rule.title,
  condition: "SELECT * FROM aws_cloudtrail",
  query_condition: {
    type: "sql",
    sql: `SELECT * FROM "${rule.stream}" WHERE "eventname" = 'StopLogging'`,
  },
  trigger_condition: { period: 5, frequency: 5, frequency_type: "minutes" },
  last_triggered_at: nowMicros() - HOUR_US,
  last_satisfied_at: nowMicros() - HOUR_US,
  context_attributes: {
    siem: "true",
    sigma_id: rule.id,
    sigma_title: rule.title,
    sigma_level: rule.level,
    mitre_techniques: rule.techniques,
    mitre_tactics: rule.tactics,
    sigma_logsource: rule.logsource,
    source_type: rule.sourceType,
  },
  ...over,
});

/** The two seed detections plus an ordinary (non-SIEM) alert that every Security page must ignore. */
export const alertListResponse = () =>
  okResponse({
    list: [
      siemAlert(RULE_STOP_LOGGING, "alert-stop-logging"),
      siemAlert(RULE_ACCESS_KEY, "alert-access-key"),
      {
        alert_id: "alert-cpu",
        name: "High_CPU_on_web-01",
        stream_name: "node_metrics",
        stream_type: "metrics",
        enabled: true,
        context_attributes: {},
      },
    ],
  });

/** `getHistorySummary` rows: the CloudTrail-logging detection fired 3 times one hour ago. */
export const historySummaryResponse = (alertId = "alert-stop-logging", firings = 3) => {
  const bucketUs = (Date.now() - 3_600_000) * 1000;
  return okResponse({
    rows: [
      { bucket: bucketUs, alert_id: alertId, outcome: "firing", n: firings, silenced: 0 },
      { bucket: bucketUs, alert_id: "alert-access-key", outcome: "ok", n: 12, silenced: 0 },
    ],
    total: firings + 12,
    interval: 60,
    is_partial: false,
    start_time: 0,
  });
};

const SECURITY_PAGES = [
  "overview",
  "events",
  "detections",
  "alerts",
  "cases",
  "entities",
  "intel",
  "ueba",
  "mitre",
  "content",
  "sources",
];

/** Only the Security routes: the app router pulls in every view and runs the org route guard. */
export const makeSecurityRouter = async (start = "/security/overview"): Promise<Router> => {
  const blank = { template: "<div />" };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: blank },
      { path: "/logs", name: "logs", component: blank },
      { path: "/alerts", name: "alertList", component: blank },
      { path: "/incidents", name: "incidentList", component: blank },
      ...SECURITY_PAGES.map((page) => ({
        path: `/security/${page}`,
        name: `security${page === "ueba" ? "UEBA" : page[0].toUpperCase() + page.slice(1)}`,
        component: blank,
      })),
    ],
  });
  await router.push(start);
  await router.isReady();
  return router;
};

/** A firing row from `getHistory`, as the triage queue and alert pages read it. */
export const historyRow = (over: Record<string, unknown> = {}) => {
  const ts = nowMicros() - HOUR_US;
  return {
    timestamp: ts,
    alert_name: "AWS_CloudTrail_Logging_Disabled__aws_cloudtrail",
    alert_id: "alert-stop-logging",
    status: "firing",
    level: "",
    actual_value: 1,
    threshold_operator: ">=",
    start_time: ts - 300_000_000,
    end_time: ts,
    error: null,
    is_silenced: false,
    evaluation_took_in_secs: 0.12,
    ...over,
  };
};

export const historyResponse = (rows = [historyRow()]) =>
  okResponse({ hits: rows, total: rows.length });

/** An incident (case) correlated from the seed attack: the compromised svc-deploy key. */
export const incident = (over: Record<string, unknown> = {}) => ({
  id: "inc-svc-deploy",
  org_id: "default",
  status: "open",
  severity: "P1",
  group_values: { sourceipaddress: ATTACKER_IP, useridentity_username: "svc-deploy" },
  key_type: "Primary",
  first_alert_at: nowMicros() - 3 * HOUR_US,
  last_alert_at: nowMicros() - HOUR_US,
  alert_count: 4,
  title: "svc-deploy key used from 185.220.101.47",
  created_at: nowMicros() - 3 * HOUR_US,
  updated_at: nowMicros() - HOUR_US,
  rca: null,
  alert_groups: [
    {
      alert_id: "alert-stop-logging",
      alert_name: "AWS_CloudTrail_Logging_Disabled__aws_cloudtrail",
      count: 3,
    },
    {
      alert_id: "alert-access-key",
      alert_name: "AWS_IAM_Access_Key_Created__aws_cloudtrail",
      count: 1,
    },
  ],
  ...over,
});

/** Stream schemas as `nameList(org, "logs", true)` returns them, using ingest's flattened column names. */
export const schemaStreamsResponse = () =>
  okResponse({
    list: [
      {
        ...streamListEntry("aws_cloudtrail", 311),
        schema: Object.keys(cloudtrailEvent()).map((name) => ({ name, type: "Utf8" })),
      },
      {
        ...streamListEntry("okta_auth", 243),
        schema: Object.keys(oktaEvent()).map((name) => ({ name, type: "Utf8" })),
      },
      {
        ...streamListEntry("vpc_flow", 448),
        schema: Object.keys(vpcFlowEvent()).map((name) => ({ name, type: "Utf8" })),
      },
    ],
  });

/** OTable holds its loading skeleton for at least 50ms, so rows appear only after that. */
export const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await flushPromises();
};

/** `@/services/securitySources.queries` as the server answers for the fixture streams. */
export async function sourceQueriesModule() {
  const { SOURCE_TYPES_FIXTURE, SOURCE_TYPE_BY_ID } =
    await import("@/views/Security/__fixtures__/securitySourceTypes");
  const has = (fields: string[], name: string) =>
    fields.some((f) => f.toLowerCase() === name.toLowerCase());
  // Keyed on a field only that source carries, the way the server's fingerprints separate them.
  const classify = (fields: string[]) =>
    has(fields, "eventType")
      ? SOURCE_TYPE_BY_ID.get("okta_system_log")!
      : has(fields, "eventName")
        ? SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!
        : null;
  const match = async (_org: string, fields: string[]) => {
    const source = classify(fields);
    return {
      classification: source
        ? { source, confidence: 0.8, matchedRequired: [], matchedSignals: [], isSecurity: true }
        : null,
      isSecurity: !!source,
    };
  };
  return {
    fetchSourceMatch: match,
    sourceMatchQuery: (org: string, fields: string[]) => ({
      queryKey: ["source-match", org, ...fields],
      queryFn: () => match(org, fields),
    }),
    sourceTypesQuery: (org: string) => ({
      queryKey: ["source-types", org],
      queryFn: async () => SOURCE_TYPES_FIXTURE,
      initialData: SOURCE_TYPES_FIXTURE,
    }),
    fetchSourceTypes: async () => SOURCE_TYPES_FIXTURE,
    securitySourcesQuery: (org: string) => ({
      queryKey: ["security-sources", org],
      queryFn: async () => ({ streams: [], sources: [], suggestions: [], notices: [] }),
    }),
    fetchSecuritySources: async () => ({ streams: [], sources: [], suggestions: [], notices: [] }),
    classifySourcesMutation: () => ({ mutationFn: async () => ({ classified: [] }) }),
    attachPackMutation: () => ({ mutationFn: async () => ({}) }),
    attachPlanMutation: () => ({ mutationFn: async () => ({}) }),
    detachPackMutation: () => ({ mutationFn: async () => ({}) }),
  };
}
