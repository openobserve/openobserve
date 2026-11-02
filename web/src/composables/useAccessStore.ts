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

import { computed, shallowReactive, shallowRef, toRaw, type InjectionKey, type Ref } from "vue";
import {
  START_LOCATION,
  useRouter,
  type LocationQuery,
  type RouteLocationNormalizedLoaded,
  type RouteMeta,
  type RouteParamsGeneric,
  type Router,
} from "vue-router";
import { useStore } from "vuex";
import { getIntlLocale } from "@/locales";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

/** The resource a request touched, derived from its URL; only resources with a friendly name exist. */
export interface AccessResource {
  /** Compared against a route's `meta.accessResource`. */
  key: string;
  labelKey: I18nKey;
  /** Request path without host or query. */
  path: string;
  /** False where no role grant lifts the denial, so no message names a permission for it. */
  grantable?: false;
}

/** IAM permission a denied request needed, named as the role editor names it. */
export type AccessPermission = "list" | "get" | "create" | "update" | "delete";

export interface AccessSectionEntry {
  resource: AccessResource;
  permission: AccessPermission;
  /** `METHOD path` of each denied request. */
  requests: string[];
}

export interface AccessActionNotice {
  el: Element;
  /** The first denial's permission, method and resource; {@link denials} holds every denial of the action. */
  permission: AccessPermission;
  method: string;
  resource: AccessResource;
  /** Every write the action had refused, merged by resource and permission. */
  denials: AccessSectionEntry[];
  /** Route the request started on; the notice falls back to this route's section notice. */
  routeKey: string;
  /** Older qualifying activations, newest first, to re-anchor on if `el` leaves the page. */
  fallbacks: Element[];
}

/** What the caller knows about the request a response belongs to. */
export interface AccessRequest {
  url: string;
  method?: string;
  /** Route key stamped when the request started, from {@link currentAccessRouteKey}. */
  routeKey?: string;
}

interface AccessShellState {
  selectedOrganization?: { identifier?: string; label?: string; name?: string } | null;
  userInfo?: { email?: string } | null;
}

interface AccessShellStore {
  state: AccessShellState;
}

interface Activation {
  el: Element;
  at: number;
}

/** A denied (resource, permission) pair and the requests that hit it, as every 403 surface shows it. */
export type AccessDenial = AccessSectionEntry;

/** One permission's denied resources, labelled for display. */
export interface AccessDeniedGroup {
  permission: AccessPermission;
  /** The permission as the role editor names it. */
  label: I18nText;
  resources: I18nText[];
}

/** The shared 403 wording: a "You can't ..." title and the denials grouped by permission. */
export interface AccessDeniedMessage {
  title: I18nText;
  /** Only denials a role grant lifts; the rest set {@link askAdmin}. */
  groups: AccessDeniedGroup[];
  /** Some denial names no permission, as the server checks no role resource for it. */
  askAdmin: boolean;
  /** Denials across every group, one per resource and permission; the title and the chip's badge count this. */
  count: number;
}

/** A piece of a resource list; `more` marks the "N more" item that expands the list. */
export interface AccessListPart {
  text: I18nText;
  more: boolean;
}

interface DeniedRequest {
  permission: AccessPermission;
  request: string;
}

interface RouteOverride {
  /** Matched on the path after `/api`. */
  path: RegExp;
  /** Null where the server checks no role resource, so the route reads unnamed even under a named area. */
  resource: string | null;
  /** Permission per HTTP method, as the server's route table maps it; a method not listed falls through. */
  permissions: Partial<Record<string, AccessPermission>>;
  /** False where no view's own lock covers the route, though only views name its resource. */
  inPage?: false;
}

interface LocatedResource {
  matched: string;
  after: string[];
}

interface ClassifiedRequest {
  /** Null when the resource has no friendly name. */
  resource: AccessResource | null;
  permission: AccessPermission;
  /** A view's own lock names the resource, so its denied reads are not repeated as a chip. */
  inPage: boolean;
  /** The bare collection, as a page's own list reads it; a sub-read such as `roles/<id>/users` is not. */
  collection: boolean;
  /** Decided by the method, except a stream read or a POST the server checks as List: a POST it checks as Get still changes something. */
  write: boolean;
  /** The server checks no role resource for the request. */
  bypass: boolean;
}

// One sessionStorage record per org, so a revisit or a reload renders the access state on its first frame.
interface OrgAccessMemory {
  /** `<route>|<resource>` of each locked page, with the permission whose denial locked it. */
  pages: Record<string, AccessPermission>;
  /** Denied reads per route key; refused writes live in {@link writeEntries} only. */
  sections: Record<string, AccessSectionEntry[]>;
}

// Every `accessBoundary.resources.X`; the compiler then proves each has its `resourcesInline.X`.
type ResourceLabelName = LabelName<I18nKey>;
type LabelName<K> = K extends `accessBoundary.resources.${infer N}` ? N : never;

interface RouteWrites {
  /** {@link accessStamp} of the route the writes were refused on. */
  stamp: string;
  entries: AccessSectionEntry[];
}

const FRIENDLY_NAME_KEYS: Record<string, I18nKey> = {
  dashboards: "accessBoundary.resources.dashboards",
  alerts: "accessBoundary.resources.alerts",
  streams: "accessBoundary.resources.streams",
  functions: "accessBoundary.resources.functions",
  savedviews: "accessBoundary.resources.savedviews",
  users: "accessBoundary.resources.users",
  roles: "accessBoundary.resources.roles",
  organizations: "accessBoundary.resources.organizations",
  pipelines: "accessBoundary.resources.pipelines",
  destinations: "accessBoundary.resources.destinations",
  templates: "accessBoundary.resources.templates",
  reports: "accessBoundary.resources.reports",
  passcode: "accessBoundary.resources.passcode",
  status_pages: "accessBoundary.resources.statusPages",
  "llm/models": "accessBoundary.resources.llmModelPricing",
  groups: "accessBoundary.resources.groups",
  service_accounts: "accessBoundary.resources.serviceAccounts",
  cipher_keys: "accessBoundary.resources.cipherKeys",
  re_patterns: "accessBoundary.resources.regexPatterns",
};

// Resources no path word names on its own; only a route override or a nested-path alias reaches them.
const ROUTE_NAME_KEYS: Record<string, I18nKey> = {
  alert_folders: "accessBoundary.resources.alertFolders",
  folders: "accessBoundary.resources.dashboardFolders",
  incidents: "accessBoundary.resources.incidents",
  fleet_management: "accessBoundary.resources.fleetManagement",
  report_folders: "accessBoundary.resources.reportFolders",
  downtime_folders: "accessBoundary.resources.downtimeFolders",
  settings: "accessBoundary.resources.settings",
  db_monitoring: "accessBoundary.resources.databaseMonitoring",
  oncall: "accessBoundary.resources.onCall",
  oncall_responses: "accessBoundary.resources.onCallResponses",
  synthetic_folder: "accessBoundary.resources.syntheticFolders",
  synthetic_environment: "accessBoundary.resources.syntheticEnvironments",
  synthetics: "accessBoundary.resources.syntheticChecks",
  billing_group: "accessBoundary.resources.billingGroup",
  enrichment_tables: "accessBoundary.resources.enrichmentTables",
  eval_jobs: "accessBoundary.resources.evalJobs",
  providers: "accessBoundary.resources.llmProviders",
  rumtoken: "accessBoundary.resources.rumTokens",
  score_configs: "accessBoundary.resources.scoreConfigs",
  scorers: "accessBoundary.resources.scorers",
  service_streams: "accessBoundary.resources.serviceStreams",
  remote_tasks: "accessBoundary.resources.remoteTasks",
  workflows: "accessBoundary.resources.workflows",
  workflow_folder: "accessBoundary.resources.workflowFolders",
  prompt_folders: "accessBoundary.resources.promptFolders",
  incident_integrations: "accessBoundary.resources.incidentIntegrations",
  search_jobs: "accessBoundary.resources.searchJobs",
  metrics: "accessBoundary.resources.metrics",
  traces: "accessBoundary.resources.traces",
  sourcemaps: "accessBoundary.resources.sourceMaps",
};

// Resources only a view's own lock names; the classifier leaves their denied reads silent, so the lock is not repeated as a chip.
const IN_PAGE_NAME_KEYS: Record<string, I18nKey> = {
  ai: "accessBoundary.resources.ai",
  downtimes: "accessBoundary.resources.downtimes",
  fleet_configs: "accessBoundary.resources.fleetConfigs",
  public_dashboards: "accessBoundary.resources.publicDashboards",
};

// Paths that hit the same IAM resource as another key, so their denials merge into one row; a nested collection is its own resource.
const RESOURCE_ALIASES: Record<string, string> = {
  query_functions: "functions",
  "ingestion-tokens": "passcode",
  "llm/models/built-in": "llm/models",
  "llm/models/refresh-built-in": "llm/models",
  "alerts/templates": "templates",
  "alerts/destinations": "destinations",
  "alerts/incidents": "incidents",
  "dashboards/public_links": "public_dashboards",
  "fleet/configs": "fleet_configs",
  "fleet/pipelines": "fleet_management",
  "fleet/summary": "fleet_management",
  "fleet/audit": "fleet_management",
  "fleet/settings": "fleet_management",
};

// The server's `{org}/{stream}/<operation>` rows with the methods each takes; every one reads the stream.
const STREAM_ROUTES: { operation: RegExp; methods: string[] }[] = [
  { operation: /^profiles\/(?:meta|tag_values)$/, methods: ["GET"] },
  { operation: /^profiles\/(?:series|merge)$/, methods: ["GET", "POST"] },
  { operation: /^profiles\/diff$/, methods: ["POST"] },
  {
    operation: /^traces\/(?:latest|latest_stream|session|user|time_range|[^/]+\/(?:details|dag))$/,
    methods: ["GET"],
  },
  { operation: /^(?:_values|_around_multi)$/, methods: ["GET"] },
  { operation: /^_around$/, methods: ["GET", "POST"] },
];

// Server rows checked ahead of its stream routes that take a GET or POST where an operation could sit, by `<area>/{id}`, `<area>/{id}/{action}` or `<area>/{*}`.
const ROWS_BEFORE_STREAM_ROUTES: Record<string, string[]> = {
  ...Object.fromEntries(
    [
      "org_cleanup_tasks",
      "dashboards",
      "slos",
      "anomaly_detection",
      "folders",
      "reports",
      "functions",
      "pipelines",
      "roles",
      "groups",
      "service_accounts",
      "cipher_keys",
      "savedviews",
      "search_jobs",
      "re_patterns",
      "annotation_queues",
      "prompts",
      "experiments",
      "datasets",
      "providers",
      "score_configs",
      "tasks",
      "scorers",
      "eval_jobs",
    ].map((area) => [`${area}/{id}`, ["GET"]]),
  ),
  ...Object.fromEntries(
    ["streams", "users", "kv", "enrichment_tables", "_index_template", "_data_stream"].map(
      (area) => [`${area}/{id}`, ["GET", "POST"]],
    ),
  ),
  "eval_jobs/{id}/{action}": ["POST"],
  ...Object.fromEntries(
    ["billings", "aws-marketplace", "settings", "sourcemaps", "ai", "mcp", "prometheus"].map(
      (area) => [`${area}/{*}`, ["GET", "POST"]],
    ),
  ),
  "ratelimit/{*}": ["GET"],
  // These two sit between the server's trace and value routes, so they shadow only the one-word operations.
  "clusters/{id}": ["GET"],
  "short/{id}": ["GET"],
  ...Object.fromEntries(["azure-marketplace", "_search"].map((a) => [`${a}/{*}`, ["POST"]])),
};

// Every Database Monitoring endpoint the server lists; any other path under it has no row.
const DB_MONITORING_ENDPOINTS =
  "databases|queries|query/(?:history|endpoints|insights|plans|server_metrics)|samples|deadlocks|blocking|activity|server_queries|server_samples|table_health|instances|instance_metrics|badges";

const ITEM_PERMISSIONS: RouteOverride["permissions"] = {
  GET: "get",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

// Folder types whose folders the role editor names; other types keep the path heuristic.
const FOLDER_RESOURCES: Record<string, string> = {
  alerts: "alert_folders",
  dashboards: "folders",
  reports: "report_folders",
  synthetics: "synthetic_folder",
  downtimes: "downtime_folders",
  workflows: "workflow_folder",
  prompts: "prompt_folders",
};

// The server answers these folder types' list and name lookups itself, with no role check.
const UNLISTED_FOLDER_TYPES = new Set(["downtimes"]);

const KNOWN_FOLDER_TYPES = Object.keys(FOLDER_RESOURCES).join("|");

// Routes the server checks against another resource or permission than the path suggests, as its route permission table lists them; first match wins.
const ROUTE_OVERRIDES: RouteOverride[] = [
  {
    path: /^\/v2\/[^/]+\/alerts$/,
    resource: "alert_folders",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/[^/]+\/dashboards$/,
    resource: "folders",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/v2\/[^/]+\/alerts\/[^/]+\/clone$/,
    resource: "alert_folders",
    permissions: { POST: "create" },
  },
  {
    path: /^\/v2\/[^/]+\/alerts\/[^/]+\/(ack|unack|mute(\/[^/]+\/(extend|cancel))?|export)$/,
    resource: "alerts",
    permissions: { POST: "get" },
  },
  {
    path: /^\/[^/]+\/dashboards\/[^/]+\/public_links\/[^/]+\/(pause|refresh|resume)$/,
    resource: "public_dashboards",
    permissions: { POST: "update" },
  },
  {
    path: /^\/[^/]+\/dashboards\/[^/]+\/(annotations|panels)(\/panels)?(\/[^/]+)?$/,
    resource: "dashboards",
    permissions: { POST: "update", DELETE: "update" },
  },
  { path: /^\/[^/]+\/pipelines\/backfill$/, resource: "pipelines", permissions: { GET: "list" } },
  {
    path: /^\/[^/]+\/pipelines\/[^/]+\/backfill$/,
    resource: "pipelines",
    permissions: { POST: "update" },
  },
  { path: /^\/[^/]+\/pipelines\/streams$/, resource: "pipelines", permissions: { GET: "list" } },
  {
    path: /^\/v2\/[^/]+\/alerts\/incidents(\/stats)?$/,
    resource: "incidents",
    permissions: { GET: "list" },
  },
  {
    path: /^\/v2\/[^/]+\/alerts\/incidents\/[^/]+\/rca$/,
    resource: "incidents",
    permissions: { DELETE: "update" },
  },
  { path: /^\/[^/]+\/users\/roles$/, resource: "users", permissions: { GET: "list" } },
  { path: /^\/[^/]+\/users\/roles\/all$/, resource: "users", permissions: { GET: "get" } },
  { path: /^\/[^/]+\/roles\/[^/]+\/users$/, resource: "roles", permissions: { GET: "list" } },
  {
    path: /^\/[^/]+\/fleet\/(pipelines|summary|settings)$/,
    resource: "fleet_management",
    permissions: { GET: "get" },
  },
  { path: /^\/[^/]+\/fleet\/audit$/, resource: "fleet_management", permissions: { GET: "list" } },
  {
    path: /^\/[^/]+\/fleet\/configs\/validate$/,
    resource: "fleet_configs",
    permissions: { POST: "get" },
  },
  {
    path: /^\/[^/]+\/llm\/models(\/refresh-built-in)?$/,
    resource: "llm/models",
    permissions: { POST: "update" },
  },
  { path: /^\/[^/]+\/re_patterns\/test$/, resource: "re_patterns", permissions: { POST: "get" } },
  {
    path: /^\/v2\/[^/]+\/reports$/,
    resource: "report_folders",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/v2\/[^/]+\/downtimes(\/(preview|resources|values))?$/,
    resource: "downtime_folders",
    permissions: { POST: "create" },
  },
  {
    path: /^\/v2\/[^/]+\/downtimes\/[^/]+\/(cancel|extend)$/,
    resource: "downtimes",
    permissions: { POST: "update" },
  },
  ...Object.entries(FOLDER_RESOURCES).flatMap(([type, resource]): RouteOverride[] => {
    const unlisted = UNLISTED_FOLDER_TYPES.has(type);
    const name: RouteOverride = {
      path: new RegExp(`^/v2/[^/]+/folders/${type}/name/[^/]+$`),
      resource,
      permissions: { GET: "list" },
    };
    return [
      ...(unlisted ? [] : [name]),
      {
        path: new RegExp(`^/v2/[^/]+/folders/${type}$`),
        resource,
        permissions: unlisted ? { POST: "create" } : { GET: "list", POST: "create" },
      },
      {
        path: new RegExp(`^/v2/[^/]+/folders/${type}/[^/]+$`),
        resource,
        permissions: { GET: "get", PUT: "update", DELETE: "delete" },
      },
    ];
  }),
  // The server checks a raw PATCH here, which no role permission grants.
  {
    path: /^\/v2\/[^/]+\/folders\/alerts\/[^/]+\/[^/]+$/,
    resource: null,
    permissions: { PATCH: "update" },
  },
  {
    path: /^\/v2\/[^/]+\/folders\/alerts\/[^/]+\/[^/]+$/,
    resource: "alert_folders",
    permissions: { PUT: "update", DELETE: "delete" },
  },
  {
    path: /^\/v2\/[^/]+\/folders\/dashboards\/[^/]+\/[^/]+$/,
    resource: "dashboards",
    permissions: { PUT: "update", PATCH: "update", DELETE: "update" },
  },
  {
    path: /^\/[^/]+\/settings\/v2\/user\/[^/]+$/,
    resource: "settings",
    permissions: { POST: "get" },
  },
  {
    path: /^\/[^/]+\/settings\/v2\/user\/[^/]+\/[^/]+$/,
    resource: "settings",
    permissions: { DELETE: "get" },
  },
  {
    path: /^\/[^/]+\/alerts\/deduplication\/semantic-groups(\/preview-diff)?$/,
    resource: "settings",
    permissions: { GET: "get", POST: "update", PUT: "update" },
  },
  {
    path: /^\/[^/]+\/(settings(\/.*)?|telephony(\/status)?)$/,
    resource: "settings",
    permissions: { GET: "get", POST: "update", PUT: "update", DELETE: "update" },
  },
  {
    path: /^\/[^/]+\/storage$/,
    resource: "settings",
    permissions: { GET: "get", POST: "create", PUT: "update" },
  },
  {
    path: /^\/[^/]+\/sourcemaps\/stacktrace$/,
    resource: "sourcemaps",
    permissions: { POST: "list" },
  },
  { path: /^\/[^/]+\/annotations$/, resource: "score_configs", permissions: { POST: "list" } },
  { path: /^\/[^/]+\/prompts\/match$/, resource: "prompt_folders", permissions: { POST: "list" } },
  {
    path: /^\/[^/]+\/prometheus\/api\/v1\/query_range$/,
    resource: null,
    permissions: { POST: "list" },
  },
  {
    path: /^\/[^/]+\/oncall\/contacts\/[^/]+(\/verify(\/confirm)?)?$/,
    resource: null,
    permissions: ITEM_PERMISSIONS,
  },
  {
    path: /^\/[^/]+\/org_cleanup_tasks\/[^/]+\/retry$/,
    resource: null,
    permissions: { POST: "create" },
  },
  {
    path: new RegExp(`^/[^/]+/db_monitoring/(?:${DB_MONITORING_ENDPOINTS})$`),
    resource: "db_monitoring",
    permissions: { GET: "get" },
  },
  {
    path: /^\/[^/]+\/oncall\/teams\/[^/]+\/(members|overrides)$/,
    resource: "oncall",
    permissions: { GET: "list", POST: "create", DELETE: "delete" },
  },
  {
    path: /^\/[^/]+\/oncall\/(teams\/[^/]+\/resolved-schedule|routing)\/preview$/,
    resource: "oncall",
    permissions: { POST: "get" },
  },
  {
    path: /^\/[^/]+\/oncall\/(teams|ownership(\/stats)?|unrouted|coverage-gaps)$/,
    resource: "oncall",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/[^/]+\/oncall\/(teams|schedule-presets|routing|ownership|unrouted)(\/.*)?$/,
    resource: "oncall",
    permissions: ITEM_PERMISSIONS,
  },
  {
    path: /^\/[^/]+\/oncall\/(responses|my\/deliveries|my\/teams|unavailability|analytics\/causes)$/,
    resource: "oncall_responses",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/[^/]+\/oncall\/(responses\/[^/]+\/(history|deliveries)|incidents\/[^/]+\/responses)$/,
    resource: "oncall_responses",
    permissions: { GET: "list" },
  },
  {
    path: /^\/[^/]+\/oncall\/(responses|my|unavailability)\/.+$/,
    resource: "oncall_responses",
    permissions: ITEM_PERMISSIONS,
  },
  {
    path: /^\/[^/]+\/synthetics\/(agent-setup|agent-tokens(\/.*)?)$/,
    resource: "synthetic_folder",
    permissions: { GET: "update", POST: "update", PATCH: "update" },
  },
  {
    path: /^\/[^/]+\/synthetics(\/locations)?$/,
    resource: "synthetic_folder",
    permissions: { GET: "list", POST: "create", DELETE: "delete" },
  },
  {
    path: /^\/[^/]+\/synthetics\/locations\/[^/]+$/,
    resource: "synthetic_folder",
    permissions: { GET: "get", PUT: "update", DELETE: "delete" },
  },
  {
    path: /^\/[^/]+\/synthetics\/(variables|environments(\/global\/variables)?)$/,
    resource: null,
    permissions: { GET: "list" },
  },
  {
    path: /^\/[^/]+\/synthetics\/variables$/,
    resource: "synthetic_environment",
    permissions: { POST: "update" },
  },
  {
    path: /^\/[^/]+\/synthetics\/environments$/,
    resource: "synthetic_environment",
    permissions: { POST: "create" },
  },
  {
    path: /^\/[^/]+\/synthetics\/environments\/[^/]+\/duplicate$/,
    resource: "synthetic_environment",
    permissions: { POST: "get" },
  },
  {
    path: /^\/[^/]+\/synthetics\/environments\/[^/]+$/,
    resource: "synthetic_environment",
    permissions: { POST: "create", PUT: "update", DELETE: "delete" },
  },
  {
    path: /^\/[^/]+\/synthetics\/(variables|environments)\/.+$/,
    resource: "synthetic_environment",
    permissions: { GET: "get", POST: "update", PUT: "update", DELETE: "update" },
  },
  {
    path: /^\/[^/]+\/synthetics\/[^/]+\/(variables\/[^/]+\/promote|replay-secrets)$/,
    resource: "synthetics",
    permissions: { POST: "update" },
  },
  {
    path: /^\/[^/]+\/synthetics\/[^/]+\/artifacts\/presign$/,
    resource: "synthetics",
    permissions: { POST: "get" },
  },
  // Any other folder type is a dashboard folder on the server.
  {
    path: new RegExp(`^/v2/[^/]+/folders/(?!(${KNOWN_FOLDER_TYPES})(/|$))[^/]+$`),
    resource: "folders",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: new RegExp(`^/v2/[^/]+/folders/(?!(${KNOWN_FOLDER_TYPES})(/|$))[^/]+/[^/]+$`),
    resource: "folders",
    permissions: { GET: "get", PUT: "update", DELETE: "delete" },
  },
  {
    path: /^\/[^/]+\/(anomaly_detection(\/history)?|slos|alerts\/slo-eligible)$/,
    resource: "alert_folders",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/[^/]+\/(anomaly_detection|slos)\/(?!move$)[^/]+(\/.*)?$/,
    resource: "alerts",
    permissions: ITEM_PERMISSIONS,
  },
  {
    path: /^\/[^/]+\/billing_group\/.+$/,
    resource: "billing_group",
    permissions: { GET: "get", POST: "create", DELETE: "delete" },
  },
  {
    path: /^\/[^/]+\/billings\/.+$/,
    resource: "organizations",
    permissions: { GET: "get", POST: "create" },
  },
  {
    path: /^\/[^/]+\/org_cleanup_tasks\/[^/]+$/,
    resource: "organizations",
    permissions: { GET: "list" },
  },
  {
    path: /^\/[^/]+\/quota\/[^/]+\/paid_overage$/,
    resource: "ai",
    inPage: false,
    permissions: { GET: "get", PUT: "update" },
  },
  {
    path: /^\/[^/]+\/quota\/[^/]+\/usage_limit$/,
    resource: "organizations",
    permissions: { PUT: "update" },
  },
  { path: /^\/[^/]+\/invites$/, resource: "users", permissions: { GET: "list", POST: "create" } },
  { path: /^\/[^/]+\/invites\/[^/]+$/, resource: "users", permissions: { DELETE: "delete" } },
  {
    path: /^\/[^/]+\/eval_jobs\/[^/]+\/[^/]+$/,
    resource: "eval_jobs",
    permissions: { POST: "update" },
  },
  ...collectionRoutes("eval_jobs", "eval_jobs"),
  ...collectionRoutes("providers", "providers"),
  {
    path: /^\/[^/]+\/rumtoken$/,
    resource: "rumtoken",
    permissions: { GET: "list", POST: "create", PUT: "update" },
  },
  {
    path: /^\/[^/]+\/score_configs\/([^/]+\/)?quality(\/timeline)?$/,
    resource: "traces",
    permissions: { GET: "get" },
  },
  {
    path: /^\/[^/]+\/score_configs$/,
    resource: "score_configs",
    permissions: { GET: "list", POST: "create", PUT: "update" },
  },
  itemRoute("score_configs", "score_configs"),
  ...collectionRoutes("scorers", "scorers"),
  { path: /^\/[^/]+\/service_streams$/, resource: "service_streams", permissions: { GET: "list" } },
  {
    path: /^\/[^/]+\/service_streams\/_grouped$/,
    resource: "settings",
    permissions: { GET: "get" },
  },
  {
    path: /^\/[^/]+\/tasks\/[^/]+\/(signing\/(rotate|test|activate|end_grace)|test_connection|test_run)$/,
    resource: "remote_tasks",
    permissions: { POST: "update" },
  },
  ...collectionRoutes("tasks", "remote_tasks"),
  {
    path: /^\/[^/]+\/workflows$/,
    resource: "workflow_folder",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/[^/]+\/workflows\/(?!promote\/)[^/]+(\/.*)?$/,
    resource: "workflows",
    permissions: ITEM_PERMISSIONS,
  },
  {
    path: /^\/v2\/[^/]+\/incidents\/integrations\/[^/]+\/(enable|rotate)$/,
    resource: "incident_integrations",
    permissions: { POST: "update", PATCH: "update" },
  },
  {
    path: /^\/v2\/[^/]+\/incidents\/integrations$/,
    resource: "incident_integrations",
    permissions: { GET: "list", POST: "create" },
  },
  {
    path: /^\/v2\/[^/]+\/incidents\/integrations\/.+$/,
    resource: "incident_integrations",
    permissions: ITEM_PERMISSIONS,
  },
  ...collectionRoutes("search_jobs", "search_jobs"),
  {
    path: /^\/[^/]+\/enrichment_tables(\/status)?$/,
    resource: "enrichment_tables",
    permissions: { GET: "list", POST: "create" },
  },
  itemRoute("enrichment_tables", "enrichment_tables"),
  { path: /^\/[^/]+\/streams$/, resource: "streams", permissions: { POST: "update" } },
  { path: /^\/[^/]+\/metrics\/[^/]+\/usage$/, resource: "metrics", permissions: { GET: "get" } },
  {
    path: /^\/[^/]+\/traces\/(service_graph\/(topology\/current|edge\/history)|agent_signals(\/compare)?)$/,
    resource: "traces",
    permissions: { GET: "get", POST: "get" },
  },
  // Agent job and registration calls are checked by agent token, not by a role resource.
  {
    path: /^\/[^/]+\/synthetics\/(?!jobs\/|agent\/)[^/]+(\/.*)?$/,
    resource: "synthetics",
    permissions: ITEM_PERMISSIONS,
  },
];

// Trailing path words that name an operation or a view of a collection, never the resource itself.
const NON_RESOURCE_SEGMENTS = new Set([
  "all",
  "list",
  "bulk",
  "enable",
  "disable",
  "status",
  "count",
  "summary",
  "stats",
]);

// App-shell and prefetch reads the user never asked for, matched on the path after `/api`; a refused write on them is still the user's own action.
const BACKGROUND_PATHS: RegExp[] = [
  /^\/organizations$/,
  /^\/auth\/refresh_token$/,
  /^\/license(\/refresh)?$/,
  /^\/[^/]+\/config$/,
  /^\/[^/]+\/settings$/,
  /^\/[^/]+\/settings\/v2\//,
  /^\/[^/]+\/announcements(\/config)?$/,
  /^\/[^/]+\/alerts\/deduplication\/semantic-groups$/,
  /^\/[^/]+\/summary$/,
];

// The role editor's own column labels, so a message names the permission an admin will look for.
const PERMISSION_KEYS: Record<AccessPermission, I18nKey> = {
  list: "iam.list",
  get: "iam.get",
  create: "iam.create",
  update: "iam.update",
  delete: "iam.delete",
};

// The verb a denial's title uses: List and Get both read as "view".
const DENIED_TITLE_KEYS: Record<AccessPermission, I18nKey> = {
  list: "accessBoundary.denied.view",
  get: "accessBoundary.denied.view",
  create: "accessBoundary.denied.create",
  update: "accessBoundary.denied.edit",
  delete: "accessBoundary.denied.delete",
};

// Prefixes of read-only POST words, so the `_stream` and `_multi` variants count too: org-level ones right after the org, the rest right after one name.
const ORG_READ_POST_PREFIXES = ["_search", "_values"];
const NAMED_READ_POST_PREFIXES = ["_values", "_around", "_correlate"];

// A POST that toggles an existing item is checked against Update on the server, not Create.
const UPDATE_POST_ACTIONS = new Set(["enable", "disable"]);

const PERMISSION_ORDER: AccessPermission[] = ["list", "get", "create", "update", "delete"];

/** Resources a collapsed list names before it folds the rest into "N more". */
export const ACCESS_LIST_LIMIT = 4;

/** Request lines "Copy details" prints and storage keeps per denial; older ones drop off first. */
export const ACCESS_REQUEST_LIMIT = 20;

const RESOURCE_LABEL_PREFIX = "accessBoundary.resources.";
const MEMORY_PREFIX = "o2.access.memory.";
// Bump when the classifier changes a resource or permission identity: a record from another version is dropped, never migrated.
const MEMORY_VERSION = 2;
// Route key of a request sent before the router's first navigation; a real route key is never empty.
const BEFORE_NAVIGATION = "";
const UNNAMED_RESOURCE = "_unnamed";
// AI paths span several server resources (chats, shares, toolsets), so a refused AI write stays unnamed rather than name the wrong one.
const UNNAMED_IN_PAGE_WRITES = new Set(["ai"]);
const ACTIVATION_WINDOW_MS = 5000;
const ACTIVATION_HISTORY = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// KSUID, ULID and similar generated ids: a long alphanumeric run that contains a digit.
const GENERATED_ID_RE = /^(?=.*\d)[0-9A-Za-z]{20,}$/;
// A confirm dialog or menu is already closing when its button's request answers, so its controls are about to leave the page.
const CLOSING_OVERLAY =
  '[role="dialog"][data-state="closed"],[role="alertdialog"][data-state="closed"],[role="menu"][data-state="closed"]';

/** Provided by the outermost boundary so nested ones do not render a second action popover. */
export const accessBoundaryKey: InjectionKey<true> = Symbol("accessBoundary");

const routerRef = shallowRef<Router | null>(null);
let shellStore: AccessShellStore | null = null;
let activations: Activation[] = [];
let listenersInstalled = false;
let anchorObserver: MutationObserver | null = null;

// Keyed by org; the reactive read tracks the org's entry, a cache fill goes through toRaw so a computed never writes what it reads.
const memoryByOrg = shallowReactive(new Map<string, OrgAccessMemory>());
// Request lines for "Copy details"; memory only, the next 403 refills them.
const deniedRequests = new Map<string, DeniedRequest[]>();
const actionNotice = shallowRef<AccessActionNotice | null>(null);
// A refused write stays for the visit only: the exact request rarely succeeds later, so a stored one would never clear.
const writeEntries = shallowRef<RouteWrites>({ stamp: "", entries: [] });
// Each mounted boundary's index in the current route's matched records; -1 when it renders none of them.
const boundaryDepths = shallowReactive(new Set<Ref<number>>());

const currentRoute = computed(() => routerRef.value?.currentRoute.value ?? null);
const currentResource = computed(() =>
  currentRoute.value ? routeResource(currentRoute.value) : undefined,
);
const currentEntry = computed(() =>
  currentRoute.value && currentResource.value
    ? deniedEntry(currentRoute.value, currentResource.value)
    : null,
);
const deniedPermission = computed<AccessPermission | null>(() =>
  currentEntry.value === null ? null : (readMemory(currentOrg()).pages[currentEntry.value] ?? null),
);
const pageDenied = computed(() => deniedPermission.value !== null);
const sectionEntries = computed<AccessSectionEntry[]>(() => {
  if (!currentRoute.value) return [];
  const key = routeKey(currentRoute.value);
  const reads = readMemory(currentOrg()).sections[key] ?? [];
  const writes = routeWrites(key);
  return writes.length ? [...reads, ...writes] : reads;
});
const pageDenial = computed<AccessDenial | null>(() => {
  const resource = currentResource.value ? resourceForKey(currentResource.value) : null;
  return resource && deniedPermission.value
    ? { resource, permission: deniedPermission.value, requests: [] }
    : null;
});
const deepestBoundary = computed(() =>
  Math.max(-1, ...[...boundaryDepths].map((depth) => depth.value)),
);

/** Route key a request is stamped with when it starts, so its response is judged against the page that asked. */
export function currentAccessRouteKey(): string | undefined {
  const route = currentRoute.value;
  if (!route) return undefined;
  return accessStamp(route === START_LOCATION ? BEFORE_NAVIGATION : routeKey(route));
}

/** Classifies one 403 and records it as page-denied, a section entry or an action notice. */
export function recordForbidden({ url, method, routeKey: stamp }: AccessRequest): void {
  const verb = (method ?? "get").toUpperCase();
  if (isBackground(verb, url)) return;
  const route = currentRoute.value;
  if (!route) return;
  const key = routeKey(route);
  // A response from a page the user has already left says nothing about the page now on screen.
  if (!stampedHere(stamp, key)) return;
  const {
    resource: named,
    permission,
    inPage,
    collection,
    write,
    bypass,
  } = classifyRequest(verb, url);
  if (!write && inPage) return;
  // An unnamed read is a side fetch whose resource no role editor row names, like a server bypass.
  const resource = named ?? unnamedResource(url, write && !bypass);
  const denied: DeniedRequest = { permission, request: `${verb} ${resource.path}` };
  if (write) {
    const [el, ...fallbacks] = anchorCandidates();
    if (el) {
      const denials = [{ resource, permission, requests: [denied.request] }];
      showAction({ el, permission, method: verb, resource, denials, routeKey: key, fallbacks });
      return;
    }
  }
  const pageResource = routeResource(route);
  if (pageResource && resource.key === pageResource && permission === "list" && collection) {
    markPageDenied(deniedEntry(route, pageResource), denied);
    return;
  }
  addSectionEntry(key, resource, denied, write);
}

/** Lifts a page lock or a section entry once the same permission on that resource succeeds on the same route. */
export function noteAccessSuccess({ url, method, routeKey: stamp }: Partial<AccessRequest>): void {
  // Two cached reads per response; parsing happens only while the route shows a denial.
  if (!url || (!pageDenied.value && sectionEntries.value.length === 0 && !actionNotice.value))
    return;
  const route = currentRoute.value;
  if (!route || !stampedHere(stamp, routeKey(route))) return;
  const verb = (method ?? "get").toUpperCase();
  const { resource: named, permission, collection, write } = classifyRequest(verb, url);
  const info = named ?? unnamedResource(url);
  const entry = currentEntry.value;
  const org = currentOrg();
  if (
    entry &&
    deniedPermission.value === permission &&
    info.key === currentResource.value &&
    permission === "list" &&
    collection
  ) {
    writeMemory(org, { ...readMemory(org), pages: omitKey(readMemory(org).pages, entry) });
    deniedRequests.delete(entry);
  }
  const key = routeKey(route);
  const entries = entriesFor(key, write);
  // Only the request that succeeded is cleared, so a readable dashboard does not erase another one's denial.
  const request = `${verb} ${info.path}`;
  let changed = false;
  const kept = entries.flatMap((e) => {
    if (entryId(e) !== info.key || e.permission !== permission || !e.requests.includes(request))
      return [e];
    changed = true;
    const requests = e.requests.filter((r) => r !== request);
    return requests.length ? [{ ...e, requests }] : [];
  });
  if (changed) setEntries(key, write, kept);
  dropRecoveredAction(key, info.key, permission, request);
}

/** Forgets every denial, for an org switch or a sign-out. */
export function resetAccess(): void {
  dismissAction();
  writeEntries.value = { stamp: "", entries: [] };
  activations = [];
  deniedRequests.clear();
  memoryByOrg.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(MEMORY_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable (privacy mode); memory is already cleared.
  }
}

/** Counts a mounted boundary; the deepest one for the current route renders the section notice. */
export function registerAccessBoundary(depth: Ref<number>): () => void {
  boundaryDepths.add(depth);
  return () => {
    boundaryDepths.delete(depth);
  };
}

/** Denials sorted by resource label, then in the role editor's permission order. */
export function sortDenials(denials: AccessDenial[], t: TranslateFn): AccessDenial[] {
  return [...denials].sort(
    (a, b) =>
      String(resourceLabel(a.resource, t)).localeCompare(String(resourceLabel(b.resource, t))) ||
      PERMISSION_ORDER.indexOf(a.permission) - PERMISSION_ORDER.indexOf(b.permission),
  );
}

/** Denials grouped by permission in the role editor's order, each resource once per group with its requests merged. */
export function groupDenials(
  denials: AccessDenial[],
): { permission: AccessPermission; denials: AccessDenial[] }[] {
  return PERMISSION_ORDER.flatMap((permission) => {
    const byResource = new Map<string, AccessDenial>();
    for (const d of denials) {
      if (d.permission !== permission) continue;
      const seen = byResource.get(entryId(d));
      byResource.set(
        entryId(d),
        seen ? { ...seen, requests: [...new Set([...seen.requests, ...d.requests])] } : d,
      );
    }
    return byResource.size ? [{ permission, denials: [...byResource.values()] }] : [];
  });
}

/** Title and permission groups for any set of denials; every 403 surface words itself through this. */
export function accessDeniedMessage(denials: AccessDenial[], t: TranslateFn): AccessDeniedMessage {
  const grouped = groupDenials(denials);
  const groups = grouped.flatMap((g) => {
    const granted = g.denials.filter((d) => d.resource.grantable !== false);
    if (!granted.length) return [];
    return [
      {
        permission: g.permission,
        label: permissionLabel(g.permission, t),
        resources: resourceLabels(
          granted.map((d) => d.resource),
          (r) => resourceLabel(r, t),
          t,
        ),
      },
    ];
  });
  const count = grouped.reduce((sum, g) => sum + g.denials.length, 0);
  const askAdmin = denials.some((d) => d.resource.grantable === false);
  return { title: deniedTitle(grouped, count, t), groups, askAdmin, count };
}

/** The full "missing permission" sentence for one group, naming every resource. */
export function accessReason(group: AccessDeniedGroup, t: TranslateFn): I18nText {
  return t("accessBoundary.denied.missing", {
    permission: group.label,
    resource: listFormat().format(group.resources),
  });
}

/** A group's resources as list parts, folded after {@link ACCESS_LIST_LIMIT} into an "N more" part unless expanded. */
export function accessListParts(
  resources: I18nText[],
  expanded: boolean,
  t: TranslateFn,
): AccessListPart[] {
  const folds = !expanded && resources.length > ACCESS_LIST_LIMIT;
  const items: string[] = folds
    ? [
        ...resources.slice(0, ACCESS_LIST_LIMIT),
        t("accessBoundary.denied.more", resources.length - ACCESS_LIST_LIMIT),
      ]
    : resources;
  const parts = listFormat().formatToParts(items);
  const last = parts.map((p) => p.type).lastIndexOf("element");
  return parts.map((p, i) => ({ text: raw(p.value), more: folds && i === last }));
}

/** Copy-details text shared by every 403 surface: who and where, then one line per permission group. */
export function accessDetails(denials: AccessDenial[]): string {
  return [
    ...identityLines(),
    ...groupDenials(denials).map(({ permission, denials: inGroup }) => {
      const requests = inGroup.flatMap((d) => cappedRequests(d.requests)).join(", ");
      const keys = inGroup.filter((d) => !isUnnamed(d.resource)).map((d) => d.resource.key);
      if (!keys.length) return `denied ${permission}: ${requests}`;
      return `denied ${permission}: ${keys.join(", ")}${requests ? ` (${requests})` : ""}`;
    }),
  ].join("\n");
}

/** A denial a view detects itself, named by its IAM resource key, for its own lock or message. */
export function viewDenial(
  key: string,
  permission: AccessPermission,
  requests: string[] = [],
): AccessDenial {
  const resource = resourceForKey(key) ?? { key, labelKey: IN_PAGE_NAME_KEYS[key], path: "" };
  return { resource, permission, requests };
}

/** `METHOD path` of each failed HTTP request among `errors`, as Copy details lists them. */
export function failedRequests(...errors: unknown[]): string[] {
  return errors.flatMap((err) => {
    const config = (err as { config?: { method?: string; url?: string } } | null)?.config;
    if (!config?.url) return [];
    try {
      const path = new URL(config.url, "http://localhost").pathname;
      return [`${(config.method ?? "get").toUpperCase()} ${path}`];
    } catch {
      return [];
    }
  });
}

/** Maps a request to the resource key and label the access UI shows; null when the resource has no friendly name. */
export function extractResourceInfo(rawUrl: string, method = "GET"): AccessResource | null {
  return classifyRequest(method, rawUrl).resource;
}

/** IAM permission a request needed: the server's own mapping where the path misleads, else reads are List or Get and writes follow the method. */
export function accessPermission(method: string, rawUrl: string): AccessPermission {
  return classifyRequest(method, rawUrl).permission;
}

/** Translated IAM permission name, as the role editor shows it. */
export function permissionLabel(permission: AccessPermission, t: TranslateFn): I18nText {
  return t(PERMISSION_KEYS[permission]);
}

/** Translated label for a resource. */
export function resourceLabel(resource: AccessResource, t: TranslateFn): I18nText {
  return t(resource.labelKey);
}

/** Label placed mid-sentence, as in "Your role can't delete {resource}." */
export function resourceInlineLabel(resource: AccessResource, t: TranslateFn): I18nText {
  const key = resource.labelKey;
  if (!key.startsWith(RESOURCE_LABEL_PREFIX)) return t(key);
  return t(inlineLabelKey(key.slice(RESOURCE_LABEL_PREFIX.length) as ResourceLabelName));
}

/** Binds the router and store once, and exposes the access state to the shell components. */
export function useAccessBoundary() {
  bindAccess(useRouter(), useStore());
  return {
    pageDenied,
    pageDenial,
    pageRequests,
    sectionEntries,
    actionNotice,
    deepestBoundary,
    dismissAction,
  };
}

/** Binds the router and store once; called at app start too, so a 403 before the first boundary mounts is still recorded. */
export function bindAccess(router: Router, store: AccessShellStore): void {
  shellStore = store;
  if (routerRef.value === router) return;
  routerRef.value = router;
  router.afterEach((to, from, failure) => {
    // A cancelled or failed navigation leaves the user on the page whose denials are on screen.
    if (failure) return;
    const leaving = routeKey(from);
    if (leaving === routeKey(to)) return;
    dismissAction();
    writeEntries.value = { stamp: "", entries: [] };
  });
  if (!listenersInstalled && typeof document !== "undefined") {
    listenersInstalled = true;
    document.addEventListener("pointerdown", onActivation, true);
    document.addEventListener("keydown", onActivation, true);
  }
}

function onActivation(event: Event): void {
  if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
  const at = Date.now();
  const el =
    event.target instanceof Element ? event.target.closest("button,[role=button],a") : null;
  if (!el) return;
  activations = [...activations.filter((a) => a.el !== el), { el, at }].slice(-ACTIVATION_HISTORY);
}

// Newest first: a confirm button that is closing gives way to the row control that opened its dialog.
function anchorCandidates(): Element[] {
  const now = Date.now();
  return activations
    .filter((a) => now - a.at <= ACTIVATION_WINDOW_MS && isAnchorable(a.el))
    .map((a) => a.el)
    .reverse();
}

function isAnchorable(el: Element): boolean {
  return el.isConnected && !el.closest(CLOSING_OVERLAY);
}

// Requests from one action share its control: they join the open card; a card for another control sends the open one to the section notice.
function showAction(notice: AccessActionNotice): void {
  const open = actionNotice.value;
  if (open && open.el === notice.el && open.routeKey === notice.routeKey) {
    actionNotice.value = { ...open, denials: mergeDenials(open.denials, notice.denials) };
    return;
  }
  if (open) handOff(open);
  actionNotice.value = notice;
  if (anchorObserver || typeof MutationObserver === "undefined") return;
  anchorObserver = new MutationObserver(keepAnchored);
  anchorObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state"],
  });
}

// The anchor can leave after the popover opens; move to the next control, or hand the denial to the section notice rather than drop it.
function keepAnchored(): void {
  const notice = actionNotice.value;
  if (!notice || isAnchorable(notice.el)) return;
  const [el, ...fallbacks] = notice.fallbacks.filter(isAnchorable);
  if (el) {
    actionNotice.value = { ...notice, el, fallbacks };
    return;
  }
  dismissAction();
  handOff(notice);
}

function handOff(notice: AccessActionNotice): void {
  if (!currentRoute.value || notice.routeKey !== routeKey(currentRoute.value)) return;
  for (const d of notice.denials)
    for (const request of d.requests)
      addSectionEntry(notice.routeKey, d.resource, { permission: d.permission, request }, true);
}

function mergeDenials(
  open: AccessSectionEntry[],
  added: AccessSectionEntry[],
): AccessSectionEntry[] {
  return added.reduce((merged, d) => {
    const found = merged.find((m) => entryId(m) === entryId(d) && m.permission === d.permission);
    if (!found) return [...merged, d];
    const requests = [...new Set([...found.requests, ...d.requests])];
    return merged.map((m) => (m === found ? { ...m, requests } : m));
  }, open);
}

// A later attempt on the same control merges into the card, so a write that has since succeeded must leave it first.
function dropRecoveredAction(
  key: string,
  resourceKey: string,
  permission: AccessPermission,
  request: string,
): void {
  const notice = actionNotice.value;
  if (!notice || notice.routeKey !== key) return;
  let changed = false;
  const denials = notice.denials.flatMap((d) => {
    if (entryId(d) !== resourceKey || d.permission !== permission || !d.requests.includes(request))
      return [d];
    changed = true;
    const requests = d.requests.filter((r) => r !== request);
    return requests.length ? [{ ...d, requests }] : [];
  });
  if (!changed) return;
  if (denials.length) actionNotice.value = { ...notice, denials };
  else dismissAction();
}

function dismissAction(): void {
  actionNotice.value = null;
  anchorObserver?.disconnect();
  anchorObserver = null;
}

function markPageDenied(entry: string, denied: DeniedRequest): void {
  const records = deniedRequests.get(entry) ?? [];
  if (!records.some((r) => r.request === denied.request))
    deniedRequests.set(entry, [...records, denied].slice(-ACCESS_REQUEST_LIMIT));
  const org = currentOrg();
  const memory = readMemory(org);
  if (!memory.pages[entry])
    writeMemory(org, { ...memory, pages: { ...memory.pages, [entry]: denied.permission } });
}

// One entry per (resource, permission): a denied List and a denied Delete on alerts are two things to grant.
function addSectionEntry(
  key: string,
  resource: AccessResource,
  denied: DeniedRequest,
  write: boolean,
): void {
  const entries = entriesFor(key, write);
  const found = entries.find(
    (e) => entryId(e) === resource.key && e.permission === denied.permission,
  );
  if (found?.requests.includes(denied.request)) return;
  setEntries(
    key,
    write,
    found
      ? entries.map((e) => (e === found ? { ...e, requests: [...e.requests, denied.request] } : e))
      : [...entries, { resource, permission: denied.permission, requests: [denied.request] }],
  );
}

function entriesFor(key: string, write: boolean): AccessSectionEntry[] {
  return write ? routeWrites(key) : (readMemory(currentOrg()).sections[key] ?? []);
}

function setEntries(key: string, write: boolean, entries: AccessSectionEntry[]): void {
  if (write) writeEntries.value = { stamp: accessStamp(key), entries };
  else writeSections(currentOrg(), key, entries);
}

function routeWrites(key: string): AccessSectionEntry[] {
  return writeEntries.value.stamp === accessStamp(key) ? writeEntries.value.entries : [];
}

function cappedRequests(requests: string[]): string[] {
  return requests.slice(-ACCESS_REQUEST_LIMIT);
}

function writeSections(org: string, key: string, entries: AccessSectionEntry[]): void {
  const others = omitKey(readMemory(org).sections, key);
  writeMemory(org, {
    ...readMemory(org),
    sections: entries.length ? { ...others, [key]: entries } : others,
  });
}

function readMemory(org: string): OrgAccessMemory {
  const cached = memoryByOrg.get(org);
  if (cached) return cached;
  const memory: OrgAccessMemory = { pages: {}, sections: {} };
  try {
    const parsed: (Partial<OrgAccessMemory> & { version?: number }) | null = JSON.parse(
      sessionStorage.getItem(MEMORY_PREFIX + org) ?? "{}",
    );
    if (parsed?.version === MEMORY_VERSION) {
      memory.pages = parsed.pages ?? {};
      memory.sections = namedSections(parsed.sections ?? {});
    }
  } catch {
    // Unreadable or unavailable storage starts the org with no remembered denials.
  }
  toRaw(memoryByOrg).set(org, memory);
  return memory;
}

function writeMemory(org: string, memory: OrgAccessMemory): void {
  memoryByOrg.set(org, memory);
  try {
    const empty = !Object.keys(memory.pages).length && !Object.keys(memory.sections).length;
    if (empty) sessionStorage.removeItem(MEMORY_PREFIX + org);
    // Every denied request stays in memory to judge recovery; storage keeps only what Copy details prints.
    else
      sessionStorage.setItem(
        MEMORY_PREFIX + org,
        JSON.stringify({
          version: MEMORY_VERSION,
          ...memory,
          sections: namedSections(memory.sections),
        }),
      );
  } catch {
    // Storage can be unavailable or full; the in-memory copy still drives this tab.
  }
}

// Storage keeps only labelled reads with capped request lists; a write is told by its request, as a GET the server checks as Update is still a read.
function namedSections(
  sections: Record<string, AccessSectionEntry[]>,
): Record<string, AccessSectionEntry[]> {
  const named = Object.entries(sections).map(
    ([key, entries]) =>
      [
        key,
        entries
          .map((e) => ({ ...e, requests: cappedRequests(e.requests.filter(isReadRequest)) }))
          .filter((e) => !!e.resource.labelKey && e.requests.length > 0),
      ] as const,
  );
  return Object.fromEntries(named.filter(([, entries]) => entries.length > 0));
}

function entryId(entry: AccessSectionEntry): string {
  return entry.resource.key;
}

function isReadRequest(request: string): boolean {
  const [method = "", path = ""] = request.split(" ");
  return !classifyRequest(method, path).write;
}

function isUnnamed(resource: AccessResource): boolean {
  return resource.key.startsWith(UNNAMED_RESOURCE);
}

// Same verb everywhere: one resource is named, several reads are counted, several writes are listed; mixed verbs count the blocked actions. A count is the chip's count.
function deniedTitle(
  grouped: { permission: AccessPermission; denials: AccessDenial[] }[],
  count: number,
  t: TranslateFn,
): I18nText {
  const verbs = new Set(grouped.map((g) => DENIED_TITLE_KEYS[g.permission]));
  if (verbs.size > 1) return t("accessBoundary.denied.actions", count);
  const [verb] = verbs;
  const resources = [
    ...new Map(grouped.flatMap((g) => g.denials).map((d) => [entryId(d), d.resource])).values(),
  ];
  if (!verb || (verb === DENIED_TITLE_KEYS.list && resources.length > 1))
    return t("accessBoundary.denied.parts", count);
  const labels = resourceLabels(resources, (r) => resourceInlineLabel(r, t), t);
  const resource = accessListParts(labels, false, t)
    .map((p) => p.text)
    .join("");
  return t(verb, { resource });
}

// Unnamed resources share one label, so several of them read as one counted item after the named ones.
function resourceLabels(
  resources: AccessResource[],
  label: (resource: AccessResource) => I18nText,
  t: TranslateFn,
): I18nText[] {
  const unnamed = resources.filter(isUnnamed);
  const named = resources.filter((r) => !isUnnamed(r)).map(label);
  if (unnamed.length === 0) return named;
  return [
    ...named,
    unnamed.length === 1 ? label(unnamed[0]) : t("accessBoundary.denied.resources", unnamed.length),
  ];
}

function listFormat(): Intl.ListFormat {
  return new Intl.ListFormat(getIntlLocale(), { type: "conjunction" });
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function pageRequests(): string[] {
  const entry = currentEntry.value;
  return entry ? (deniedRequests.get(entry) ?? []).map((r) => r.request) : [];
}

function identityLines(): string[] {
  const org = shellStore?.state.selectedOrganization;
  return [
    `org: ${org?.label || org?.name || ""} (${org?.identifier ?? ""})`,
    `user: ${shellStore?.state.userInfo?.email ?? ""}`,
    `route: ${currentRoute.value?.fullPath ?? ""}`,
  ];
}

// Casing inside a sentence is a per-locale choice (German keeps nouns capitalised), so it is translated, never lower-cased in code.
function inlineLabelKey(name: ResourceLabelName): I18nKey {
  return `accessBoundary.resourcesInline.${name}`;
}

// An override names its resource on purpose, so an in-page resource is named there even where the path heuristic leaves it unnamed.
function resourceForKey(key: string, path = "", explicit = false): AccessResource | null {
  if (Object.hasOwn(FRIENDLY_NAME_KEYS, key))
    return { key, labelKey: FRIENDLY_NAME_KEYS[key], path };
  if (Object.hasOwn(ROUTE_NAME_KEYS, key)) return { key, labelKey: ROUTE_NAME_KEYS[key], path };
  return Object.hasOwn(IN_PAGE_NAME_KEYS, key) && (explicit || !UNNAMED_IN_PAGE_WRITES.has(key))
    ? { key, labelKey: IN_PAGE_NAME_KEYS[key], path }
    : null;
}

// A collection and its items checked as plain CRUD.
function collectionRoutes(area: string, resource: string): RouteOverride[] {
  return [
    {
      path: new RegExp(`^/[^/]+/${area}$`),
      resource,
      permissions: { GET: "list", POST: "create" },
    },
    itemRoute(area, resource),
  ];
}

function itemRoute(area: string, resource: string): RouteOverride {
  return {
    path: new RegExp(`^/[^/]+/${area}/.+$`),
    resource,
    permissions: ITEM_PERMISSIONS,
  };
}

function classifyRequest(method: string, rawUrl: string): ClassifiedRequest {
  const verb = method.toUpperCase();
  let pathname = "";
  try {
    pathname = new URL(rawUrl, "http://localhost").pathname;
  } catch {
    // An unparseable URL reads as an unnamed collection.
  }
  const segments = apiSegments(pathname);
  if (isStreamRoute(verb, segments))
    return {
      resource: resourceForKey("streams", pathname),
      permission: "get",
      inPage: false,
      collection: false,
      write: false,
      bypass: false,
    };
  const apiPath = "/" + segments.join("/");
  // Search-style POSTs only read, so they route like a GET.
  const searchPost = verb === "POST" && isSearchPost(segments);
  const override = ROUTE_OVERRIDES.find((o) => !!o.permissions[verb] && o.path.test(apiPath));
  if (override) {
    const key = override.resource;
    const permission = override.permissions[verb]!;
    return {
      resource: key === null ? null : resourceForKey(key, pathname, true),
      permission,
      inPage: override.inPage ?? (key !== null && Object.hasOwn(IN_PAGE_NAME_KEYS, key)),
      collection: false,
      write: verb !== "GET" && !searchPost && !(verb === "POST" && permission === "list"),
      bypass: key === null,
    };
  }
  const located = locateResource(segments);
  const key = located?.matched ?? "";
  return {
    resource: located ? resourceForKey(key, pathname) : null,
    permission: inferPermission(verb, segments, located),
    inPage: Object.hasOwn(IN_PAGE_NAME_KEYS, key),
    collection: located?.after.length === 0,
    write: verb !== "GET" && !searchPost,
    bypass: false,
  };
}

function inferPermission(
  verb: string,
  segments: string[],
  located: LocatedResource | null,
): AccessPermission {
  if (verb === "POST") {
    if (isSearchPost(segments)) return "list";
    return segments.some((s) => UPDATE_POST_ACTIONS.has(s)) ? "update" : "create";
  }
  if (verb === "PUT" || verb === "PATCH") return "update";
  if (verb === "DELETE") return "delete";
  const itemNamed = located?.after.some((s) => !NON_RESOURCE_SEGMENTS.has(s));
  return itemNamed || hasItemId(segments) ? "get" : "list";
}

// The segment after the optional version is the org (or a `_` system scope), never the resource; the first named word wins, so `users/<id>/roles` is Users.
function locateResource(segments: string[]): LocatedResource | null {
  const rest = afterOrg(segments);
  for (let start = 0; start < rest.length; start++) {
    if (isIdSegment(rest[start])) continue;
    for (let end = rest.length; end > start; end--) {
      const joined = rest
        .slice(start, end)
        .filter((s) => !isIdSegment(s))
        .join("/");
      if (isKnownResource(joined)) return { matched: resolveAlias(joined), after: rest.slice(end) };
    }
  }
  return null;
}

// Walked in the server's order, so a function named `_values` stays a function while a stream named `synthetics` keeps its reads.
function isStreamRoute(verb: string, segments: string[]): boolean {
  const [org = "", area, ...operation] = segments;
  if (!area || !operation.length || /^v\d+$/.test(org)) return false;
  const path = operation.join("/");
  if (!STREAM_ROUTES.some((r) => r.methods.includes(verb) && r.operation.test(path))) return false;
  const shape = ["{id}", "{id}/{action}"][operation.length - 1];
  const rows = [`${area}/{*}`, ...(shape ? [`${area}/${shape}`] : [])];
  return !rows.some((row) => ROWS_BEFORE_STREAM_ROUTES[row]?.includes(verb));
}

// Matched only where the server puts operation words, so an item named `_search_archive` is still created; an area whose POST row precedes the stream routes, such as an upload, keeps its write.
function isSearchPost(segments: string[]): boolean {
  const [area = "", name, ...more] = afterOrg(segments);
  if (name === undefined || area === "_search")
    return ORG_READ_POST_PREFIXES.some((p) => area.startsWith(p));
  const rows = [`${area}/{*}`, `${area}/{id}`];
  return (
    more.length === 0 &&
    area !== "streams" &&
    !rows.some((row) => ROWS_BEFORE_STREAM_ROUTES[row]?.includes("POST")) &&
    NAMED_READ_POST_PREFIXES.some((p) => name.startsWith(p))
  );
}

// Keyed by the path area after the org, so two unnamed resources stay two rows.
function unnamedResource(url: string, grantable = true): AccessResource {
  let path = "";
  try {
    path = new URL(url, "http://localhost").pathname;
  } catch {
    // The request line in Copy details then omits the path.
  }
  const segments = apiSegments(path);
  const rest = afterOrg(segments);
  const area = (rest[0] === "folders" ? rest.slice(0, 2) : rest.slice(0, 1)).join("/");
  return {
    key: `${UNNAMED_RESOURCE}/${area || segments[0] || ""}`,
    labelKey: "accessBoundary.resourcesInline.unnamed",
    path,
    ...(grantable ? {} : { grantable: false as const }),
  };
}

function isKnownResource(path: string): boolean {
  return (
    Object.hasOwn(FRIENDLY_NAME_KEYS, path) ||
    Object.hasOwn(IN_PAGE_NAME_KEYS, path) ||
    Object.hasOwn(RESOURCE_ALIASES, path)
  );
}

function resolveAlias(path: string): string {
  return Object.hasOwn(RESOURCE_ALIASES, path) ? RESOURCE_ALIASES[path] : path;
}

function isBackground(verb: string, url: string): boolean {
  if (verb !== "GET") return false;
  try {
    const path = "/" + apiSegments(new URL(url, "http://localhost").pathname).join("/");
    return BACKGROUND_PATHS.some((re) => re.test(path));
  } catch {
    return false;
  }
}

function apiSegments(pathname: string): string[] {
  const segments = pathname.split("/").filter(Boolean);
  const apiAt = segments.indexOf("api");
  return apiAt >= 0 ? segments.slice(apiAt + 1) : segments;
}

function afterOrg(segments: string[]): string[] {
  return segments.slice((/^v\d+$/.test(segments[0] ?? "") ? 1 : 0) + 1);
}

// The org segment is skipped: a generated org id would otherwise read as an item id.
function hasItemId(segments: string[]): boolean {
  const rest = afterOrg(segments);
  const first = rest.findIndex((s) => !isIdSegment(s));
  return first >= 0 && rest.slice(first + 1).some(isIdSegment);
}

function isIdSegment(s: string): boolean {
  return (
    s.includes("@") ||
    s.includes("%40") ||
    /^\d+$/.test(s) ||
    UUID_RE.test(s) ||
    GENERATED_ID_RE.test(s)
  );
}

function accessStamp(key: string): string {
  return `${currentOrg()}|${key}`;
}

// A request sent before the first navigation belongs to whichever route the router lands on in the same org.
function stampedHere(stamp: string | undefined, key: string): boolean {
  return (
    stamp === undefined || stamp === accessStamp(key) || stamp === accessStamp(BEFORE_NAVIGATION)
  );
}

// Two items on one route (two dashboards) keep separate denials; other query changes (time range, tab) keep the key.
function routeKey(route: {
  name?: unknown;
  path: string;
  params?: RouteParamsGeneric;
  query?: LocationQuery;
  meta?: RouteMeta;
}): string {
  const base = typeof route.name === "string" ? route.name : route.path;
  const scoped = (route.meta?.accessScopeQuery ?? []).map((k) => [k, route.query?.[k]] as const);
  const scope = [...Object.entries(route.params ?? {}), ...scoped]
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`);
  return scope.length ? `${base}?${scope.join("&")}` : base;
}

function routeResource(route: RouteLocationNormalizedLoaded): string | undefined {
  return route.matched[route.matched.length - 1]?.meta.accessResource;
}

function deniedEntry(route: RouteLocationNormalizedLoaded, resource: string): string {
  return `${routeKey(route)}|${resource}`;
}

function currentOrg(): string {
  return shellStore?.state.selectedOrganization?.identifier ?? "";
}
