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

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";

export type ModuleGroupId =
  | "data"
  | "dashboards"
  | "alerting"
  | "pipelines"
  | "monitoring"
  | "ai"
  | "fleet"
  | "assistant"
  | "llmObservability"
  | "access"
  | "platform"
  | "other";

/** One entry of `GET /{org}/resources`. */
export type CatalogResource = {
  key: string;
  parent?: string;
  has_entities?: boolean;
  visible?: boolean;
  order?: number;
};

export type RoleModule = {
  /** Rail key: the resource key. */
  key: string;
  group: ModuleGroupId;
  icon: IconName;
  /** False for an org-wide resource with no individual items, which has a single grant row. */
  hasEntities: boolean;
  /** Type-level grants that cover this module, widest first. */
  scopeKeys: string[];
  /** Every resource key whose grants count towards this module's badge. */
  countedKeys: string[];
};

/** Client copy for a module until the server sends translated labels. */
export type ModuleCopy = { labelKey: I18nKey; descKey: I18nKey };

/** Rail key of the view that lists every module's own grant row; no resource key starts with `__`. */
export const ALL_MODULES_KEY = "__all__";

export const ALL_MODULES_ICON: IconName = "checklist";

/** Stream types are type-level children of `stream`, opened from the Streams module like folders. */
export const STREAM_PARENT_KEY = "stream";

export const GROUP_ORDER: ModuleGroupId[] = [
  "data",
  "dashboards",
  "alerting",
  "pipelines",
  "monitoring",
  "ai",
  "fleet",
  "access",
  "platform",
  "other",
];

/** The assistant's own modules sit next to alerting; LLM observability stays with the data tools. */
export const GROUP_ORDER_V2: ModuleGroupId[] = [
  "data",
  "dashboards",
  "alerting",
  "assistant",
  "pipelines",
  "monitoring",
  "llmObservability",
  "access",
  "platform",
  "other",
];

export const GROUP_LABEL_KEYS: Record<ModuleGroupId, I18nKey> = {
  data: "iam.editRole.moduleGroupData",
  dashboards: "iam.editRole.moduleGroupDashboards",
  alerting: "iam.editRole.moduleGroupAlerting",
  pipelines: "iam.editRole.moduleGroupPipelines",
  monitoring: "iam.editRole.moduleGroupMonitoring",
  ai: "iam.editRole.moduleGroupAi",
  fleet: "iam.editRole.moduleGroupFleet",
  assistant: "iam.modules.groups.assistant",
  llmObservability: "iam.modules.groups.llmObservability",
  access: "iam.editRole.moduleGroupAccess",
  platform: "iam.editRole.moduleGroupPlatform",
  other: "iam.editRole.moduleGroupOther",
};

// ponytail: client-side taxonomy; replace with a `group` field on GET /resources once the backend adds one.
const GROUP_OF: Record<string, ModuleGroupId> = {
  stream: "data",
  logs: "data",
  metrics: "data",
  traces: "data",
  profiles: "data",
  index: "data",
  metadata: "data",
  enrichment_table: "data",
  savedviews: "data",
  logs_pattern: "data",
  logs_insights: "data",
  logs_cache: "data",
  re_patterns: "data",
  cipher_keys: "data",
  search_jobs: "data",
  search_inspector: "data",
  service_streams: "data",
  dfolder: "dashboards",
  dashboard: "dashboards",
  rfolder: "dashboards",
  report: "dashboards",
  afolder: "alerting",
  alert: "alerting",
  template: "alerting",
  destination: "alerting",
  incidents: "alerting",
  incident_integrations: "alerting",
  oncall: "alerting",
  oncall_response: "alerting",
  pipeline: "pipelines",
  function: "pipelines",
  workflow_folder: "pipelines",
  workflows: "pipelines",
  synthetic_folder: "monitoring",
  synthetics: "monitoring",
  downtime_folder: "alerting",
  downtime: "alerting",
  synthetic_environment: "monitoring",
  status_page: "monitoring",
  db_monitoring: "monitoring",
  rumtoken: "monitoring",
  sourcemaps: "monitoring",
  provider: "ai",
  score_config: "ai",
  scorer: "ai",
  eval_job: "ai",
  annotation_queue: "ai",
  dataset: "ai",
  experiment: "ai",
  playground: "ai",
  pfolder: "ai",
  prompt: "ai",
  prompt_label: "ai",
  ai: "ai",
  ai_toolsets: "ai",
  ai_chat_share: "ai",
  mcp: "ai",
  model_pricing: "ai",
  fleets: "fleet",
  fleet_configs: "fleet",
  fleet_management: "fleet",
  role: "access",
  group: "access",
  service_accounts: "access",
  user: "access",
  passcode: "access",
  org: "platform",
  settings: "platform",
  kv: "platform",
  summary: "platform",
  license: "platform",
  ratelimit: "platform",
  billing_group: "platform",
  remote_task: "platform",
};

/** A child listed without its parent still belongs where that parent would have been; the API sends `parent: ""` at top level. */
export const moduleGroup = (key: string, parent?: string): ModuleGroupId =>
  GROUP_OF[key] || GROUP_OF[parent ?? ""] || "other";

// English on purpose: code compares them with what the user types; a child's words sit on its parent, the rail row.
export const TASK_WORDS: Record<string, string[]> = {
  stream: ["logs", "metrics", "traces", "indices", "index", "query", "search"],
  enrichment_table: ["lookup", "csv", "enrich"],
  savedviews: ["saved search", "view"],
  metadata: ["fields", "schema"],
  search_jobs: ["background search", "async query"],
  cipher_keys: ["encryption", "decrypt", "secret"],
  re_patterns: ["regex", "redact", "mask", "pii"],
  service_streams: ["service", "correlation"],
  search_inspector: ["query profile", "slow query"],
  dfolder: ["dashboard", "panel", "chart", "graph", "visualization"],
  rfolder: ["report", "pdf", "scheduled report"],
  template: ["message", "format", "notification template"],
  destination: [
    "slack",
    "email",
    "webhook",
    "pagerduty",
    "teams",
    "opsgenie",
    "notification",
    "channel",
  ],
  afolder: ["alert", "alert rule", "trigger", "monitor"],
  incidents: ["incident", "outage"],
  oncall: ["rotation", "schedule", "pager"],
  oncall_response: ["acknowledge", "escalation"],
  downtime_folder: ["downtime", "mute", "silence", "maintenance"],
  function: ["vrl", "transform", "parse"],
  pipeline: ["pipeline", "ingest", "route", "transform"],
  workflow_folder: ["workflow", "automation"],
  rumtoken: ["rum", "browser", "frontend", "token"],
  sourcemaps: ["sourcemap", "javascript", "stack trace"],
  synthetic_folder: ["synthetics", "uptime", "probe", "http test"],
  db_monitoring: ["database", "dbm", "sql", "postgres", "mysql"],
  status_page: ["status page", "uptime"],
  synthetic_environment: ["environment", "location"],
  ai: ["assistant", "chat", "llm"],
  ai_toolsets: ["tools", "toolset"],
  mcp: ["model context protocol"],
  model_pricing: ["cost", "price", "token cost"],
  provider: ["openai", "anthropic", "provider", "model"],
  score_config: ["score", "eval", "evaluation"],
  scorer: ["score", "eval", "judge"],
  eval_job: ["eval", "evaluation"],
  annotation_queue: ["annotation", "review"],
  dataset: ["dataset", "eval data"],
  experiment: ["experiment", "ab test", "compare"],
  playground: ["prompt", "test prompt"],
  prompt_label: ["prompt", "protected label"],
  pfolder: ["prompt", "prompt template"],
  ai_chat_share: ["share chat"],
  user: ["user", "member", "people", "invite"],
  role: ["role", "permission", "rbac"],
  group: ["group", "team"],
  passcode: ["token", "api key", "ingest", "passcode"],
  service_accounts: ["service account", "bot", "machine"],
  settings: ["configuration", "org settings"],
  kv: ["key value", "kv"],
  summary: ["usage"],
  ratelimit: ["rate limit", "quota", "throttle"],
  license: ["license", "plan"],
  billing_group: ["billing", "invoice", "cost"],
  remote_task: ["remote", "task"],
  rum_analytics: ["product analytics", "funnel", "rum"],
  query_history: ["past queries"],
  alert_calibration: ["alert", "calibration", "threshold"],
};

/** Which part of the module fit the filter. */
export type ModuleMatch = { via: "label" | "group" | "word" };

/** Tries the module's label, then its group, then its task words; an empty query keeps every module. */
export const matchModule = (
  module: { key: string; label: string; groupLabel: string },
  query: string,
): ModuleMatch | null => {
  const term = query.trim().toLowerCase();
  if (!term || module.label.toLowerCase().includes(term)) return { via: "label" };
  if (module.groupLabel.toLowerCase().includes(term)) return { via: "group" };
  // One letter is inside nearly every task word, so it would keep almost every module.
  const byWord =
    term.length > 1 && !!TASK_WORDS[module.key]?.some((candidate) => candidate.includes(term));
  return byWord ? { via: "word" } : null;
};

// Mirrors the main navigation's glyphs where a module has a counterpart there.
const ICON_OF: Record<string, IconName> = {
  stream: "window",
  metadata: "data-object",
  enrichment_table: "dataset",
  savedviews: "bookmark",
  logs_pattern: "pattern",
  logs_insights: "insights",
  logs_cache: "cached",
  re_patterns: "code",
  cipher_keys: "lock",
  search_jobs: "history",
  search_inspector: "query-stats",
  service_streams: "share",
  dfolder: "dashboard",
  rfolder: "description",
  afolder: "notifications-active",
  template: "article",
  destination: "webhook",
  incidents: "shield-alert-outline",
  incident_integrations: "webhook",
  oncall: "person-pin-circle",
  oncall_response: "forum",
  pipeline: "lan",
  function: "function",
  workflow_folder: "schema",
  workflows: "schema",
  synthetic_folder: "radar",
  synthetics: "radar",
  downtime_folder: "notifications-paused",
  downtime: "notifications-paused",
  synthetic_environment: "layers",
  status_page: "monitor-heart",
  db_monitoring: "database",
  rumtoken: "devices",
  sourcemaps: "code",
  provider: "hub",
  score_config: "tune",
  scorer: "rule",
  eval_job: "fact-check",
  annotation_queue: "inbox",
  dataset: "table-chart",
  experiment: "science",
  playground: "psychology",
  pfolder: "folder",
  fleets: "workspaces",
  fleet_configs: "tune",
  fleet_management: "admin-panel-settings",
  prompt: "edit-note",
  prompt_label: "label",
  ai: "smart-toy",
  ai_toolsets: "extension",
  ai_chat_share: "share",
  mcp: "extension",
  model_pricing: "paid",
  role: "shield",
  group: "group",
  service_accounts: "manage-accounts",
  user: "person",
  passcode: "key",
  org: "corporate-fare",
  settings: "settings",
  kv: "list",
  summary: "assignment",
  license: "card-membership",
  ratelimit: "speed",
  billing_group: "paid",
  remote_task: "cloud",
};

const ASSISTANT_KEYS: ReadonlySet<string> = new Set(["ai", "ai_chat_share", "ai_toolsets", "mcp"]);

// The assistant group uses its own glyphs, none shared with LLM observability.
const ASSISTANT_ICON_OF: Record<string, IconName> = {
  ai: assistantGlyph.assistant,
  ai_chat_share: "share",
  ai_toolsets: "extension",
  mcp: "link",
};

// A client catalogue until GET /resources returns its own `group` and `description`.
export const MODULE_COPY: Record<string, ModuleCopy> = {
  ai: { labelKey: "iam.modules.labels.ai", descKey: "iam.modules.descriptions.ai" },
  ai_chat_share: {
    labelKey: "iam.modules.labels.ai_chat_share",
    descKey: "iam.modules.descriptions.ai_chat_share",
  },
  ai_toolsets: {
    labelKey: "iam.modules.labels.ai_toolsets",
    descKey: "iam.modules.descriptions.ai_toolsets",
  },
  mcp: { labelKey: "iam.modules.labels.mcp", descKey: "iam.modules.descriptions.mcp" },
};

export const GROUP_DESC_KEYS: Partial<Record<ModuleGroupId, I18nKey>> = {
  llmObservability: "iam.modules.descriptions.llmObservability",
};

const FALLBACK_ICON: IconName = "category";

export const moduleIcon = (key: string): IconName => ICON_OF[key] ?? FALLBACK_ICON;

/** Rail modules from the catalogue, one per resource; children open from inside their parent. */
export const buildRoleModules = (
  resources: CatalogResource[],
  options: { assistantV2?: boolean } = {},
): RoleModule[] => {
  const visible = resources
    .filter((resource) => resource.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const keys = new Set(visible.map((resource) => resource.key));
  const childrenOf = (key: string) =>
    visible.filter((child) => child.parent === key).map((child) => child.key);
  const groupOf = (key: string): ModuleGroupId | undefined => {
    const group = GROUP_OF[key];
    if (!options.assistantV2 || group !== "ai") return group;
    return ASSISTANT_KEYS.has(key) ? "assistant" : "llmObservability";
  };
  const iconOf = (key: string): IconName | undefined =>
    (options.assistantV2 ? ASSISTANT_ICON_OF[key] : undefined) ?? ICON_OF[key];
  const order = options.assistantV2 ? GROUP_ORDER_V2 : GROUP_ORDER;

  const modules: RoleModule[] = visible
    // A child whose parent is listed is reached by opening that parent, like a folder.
    .filter((resource) => !(resource.parent && keys.has(resource.parent)))
    .map((resource) => ({
      key: resource.key,
      // A child listed without its parent still belongs where that parent would have been; the API sends `parent: ""` at top level.
      group: groupOf(resource.key) || groupOf(resource.parent ?? "") || "other",
      icon: iconOf(resource.key) || iconOf(resource.parent ?? "") || FALLBACK_ICON,
      hasEntities: resource.has_entities !== false,
      scopeKeys: [resource.key],
      countedKeys: [resource.key, ...childrenOf(resource.key)],
    }));

  return modules.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
};
