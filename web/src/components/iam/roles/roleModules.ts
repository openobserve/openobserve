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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";

export type ModuleGroupId =
  | "data"
  | "dashboards"
  | "alerting"
  | "pipelines"
  | "monitoring"
  | "ai"
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

/** Stream types are type-level children of `stream`, opened from the Streams module like folders. */
export const STREAM_PARENT_KEY = "stream";

export const GROUP_ORDER: ModuleGroupId[] = [
  "data",
  "dashboards",
  "alerting",
  "pipelines",
  "monitoring",
  "ai",
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
  oncall: "alerting",
  oncall_response: "alerting",
  pipeline: "pipelines",
  function: "pipelines",
  workflow_folder: "pipelines",
  workflows: "pipelines",
  synthetic_folder: "monitoring",
  synthetics: "monitoring",
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
  ai: "ai",
  ai_toolsets: "ai",
  mcp: "ai",
  model_pricing: "ai",
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
  oncall: "person-pin-circle",
  oncall_response: "forum",
  pipeline: "lan",
  function: "function",
  workflow_folder: "schema",
  workflows: "schema",
  synthetic_folder: "radar",
  synthetics: "radar",
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
  ai: "smart-toy",
  ai_toolsets: "extension",
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

const FALLBACK_ICON: IconName = "category";

export const moduleIcon = (key: string): IconName => ICON_OF[key] ?? FALLBACK_ICON;

/** Rail modules from the catalogue, one per resource; children open from inside their parent. */
export const buildRoleModules = (resources: CatalogResource[]): RoleModule[] => {
  const visible = resources
    .filter((resource) => resource.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const keys = new Set(visible.map((resource) => resource.key));
  const childrenOf = (key: string) =>
    visible.filter((child) => child.parent === key).map((child) => child.key);

  const modules: RoleModule[] = visible
    // A child whose parent is listed is reached by opening that parent, like a folder.
    .filter((resource) => !(resource.parent && keys.has(resource.parent)))
    .map((resource) => ({
      key: resource.key,
      // A child listed without its parent still belongs where that parent would have been; the API sends `parent: ""` at top level.
      group: GROUP_OF[resource.key] || GROUP_OF[resource.parent ?? ""] || "other",
      icon: ICON_OF[resource.key] || ICON_OF[resource.parent ?? ""] || FALLBACK_ICON,
      hasEntities: resource.has_entities !== false,
      scopeKeys: [resource.key],
      countedKeys: [resource.key, ...childrenOf(resource.key)],
    }));

  return modules.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
};
