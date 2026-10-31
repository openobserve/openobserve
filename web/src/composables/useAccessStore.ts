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
import { useRouter, type RouteLocationNormalizedLoaded, type Router } from "vue-router";
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
  permission: AccessPermission;
  method: string;
  resource: AccessResource;
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
  groups: AccessDeniedGroup[];
  /** Distinct resources across every group, as the chip counts them. */
  resourceCount: number;
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

// One sessionStorage record per org, so a revisit or a reload renders the access state on its first frame.
interface OrgAccessMemory {
  /** `<route>|<resource>` of each locked page, with the permission whose denial locked it. */
  pages: Record<string, AccessPermission>;
  /** Section denials per route key. */
  sections: Record<string, AccessSectionEntry[]>;
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
  "llm/models": "accessBoundary.resources.llmModelPricing",
  groups: "accessBoundary.resources.groups",
  service_accounts: "accessBoundary.resources.serviceAccounts",
  cipher_keys: "accessBoundary.resources.cipherKeys",
  re_patterns: "accessBoundary.resources.regexPatterns",
};

// Resources only a view's own lock names; the URL classifier leaves their 403s silent, so the lock is not repeated as a chip.
const IN_PAGE_NAME_KEYS: Record<string, I18nKey> = {
  ai: "accessBoundary.resources.ai",
  downtimes: "accessBoundary.resources.downtimes",
  fleet_configs: "accessBoundary.resources.fleetConfigs",
  public_dashboards: "accessBoundary.resources.publicDashboards",
};

// Paths that hit the same IAM resource as another key, so their denials merge into one row.
const RESOURCE_ALIASES: Record<string, string> = {
  query_functions: "functions",
  "ingestion-tokens": "passcode",
  "llm/models/built-in": "llm/models",
  "llm/models/refresh-built-in": "llm/models",
};

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
]);

// Casing inside a sentence is a per-locale choice (German keeps nouns capitalised), so it is translated, never lower-cased in code.
const INLINE_LABEL_KEYS: Record<string, I18nKey> = {
  "accessBoundary.resources.dashboards": "accessBoundary.resourcesInline.dashboards",
  "accessBoundary.resources.alerts": "accessBoundary.resourcesInline.alerts",
  "accessBoundary.resources.streams": "accessBoundary.resourcesInline.streams",
  "accessBoundary.resources.functions": "accessBoundary.resourcesInline.functions",
  "accessBoundary.resources.savedviews": "accessBoundary.resourcesInline.savedviews",
  "accessBoundary.resources.users": "accessBoundary.resourcesInline.users",
  "accessBoundary.resources.roles": "accessBoundary.resourcesInline.roles",
  "accessBoundary.resources.organizations": "accessBoundary.resourcesInline.organizations",
  "accessBoundary.resources.pipelines": "accessBoundary.resourcesInline.pipelines",
  "accessBoundary.resources.destinations": "accessBoundary.resourcesInline.destinations",
  "accessBoundary.resources.templates": "accessBoundary.resourcesInline.templates",
  "accessBoundary.resources.reports": "accessBoundary.resourcesInline.reports",
  "accessBoundary.resources.llmModelPricing": "accessBoundary.resourcesInline.llmModelPricing",
  "accessBoundary.resources.passcode": "accessBoundary.resourcesInline.passcode",
  "accessBoundary.resources.groups": "accessBoundary.resourcesInline.groups",
  "accessBoundary.resources.serviceAccounts": "accessBoundary.resourcesInline.serviceAccounts",
  "accessBoundary.resources.cipherKeys": "accessBoundary.resourcesInline.cipherKeys",
  "accessBoundary.resources.regexPatterns": "accessBoundary.resourcesInline.regexPatterns",
  "accessBoundary.resources.ai": "accessBoundary.resourcesInline.ai",
  "accessBoundary.resources.downtimes": "accessBoundary.resourcesInline.downtimes",
  "accessBoundary.resources.fleetConfigs": "accessBoundary.resourcesInline.fleetConfigs",
  "accessBoundary.resources.publicDashboards": "accessBoundary.resourcesInline.publicDashboards",
};

// App-shell and prefetch reads the user never asked for, matched on the path after `/api`; their 403s say nothing about the page on screen.
const BACKGROUND_PATHS: RegExp[] = [
  /^\/organizations$/,
  /^\/auth\/refresh_token$/,
  /^\/license(\/refresh)?$/,
  /^\/[^/]+\/config$/,
  /^\/[^/]+\/settings$/,
  /^\/[^/]+\/settings\/v2\//,
  /^\/[^/]+\/announcements(\/config)?$/,
  /^\/[^/]+\/alerts\/deduplication\/semantic-groups$/,
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

// POST endpoints that only read data; the server checks them as List, not Create.
const READ_POST_ACTIONS = new Set([
  "_search",
  "_search_partition",
  "_search_partition_multi",
  "_search_multi",
  "_search_history",
  "_values",
  "_around",
  "_around_multi",
  "_correlate",
]);

const PERMISSION_ORDER: AccessPermission[] = ["list", "get", "create", "update", "delete"];

/** Resources a collapsed list names before it folds the rest into "N more". */
export const ACCESS_LIST_LIMIT = 4;

const MEMORY_PREFIX = "o2.access.memory.";
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
const sectionEntries = computed<AccessSectionEntry[]>(() =>
  currentRoute.value ? (readMemory(currentOrg()).sections[routeKey(currentRoute.value)] ?? []) : [],
);
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
  return currentRoute.value ? accessStamp(routeKey(currentRoute.value)) : undefined;
}

/** Classifies one 403 and records it as page-denied, a section entry or an action notice. */
export function recordForbidden({ url, method, routeKey: startedOn }: AccessRequest): void {
  if (isBackground(url)) return;
  const route = currentRoute.value;
  if (!route) return;
  const key = routeKey(route);
  // A response from a page the user has already left says nothing about the page now on screen.
  if (startedOn !== undefined && startedOn !== accessStamp(key)) return;
  const verb = (method ?? "get").toUpperCase();
  const resource = extractResourceInfo(url);
  // A resource without a friendly name would surface a raw URL word, so it stays silent like a background read.
  if (!resource) {
    if (import.meta.env.DEV) console.debug("[access] 403 on an unnamed resource:", verb, url);
    return;
  }
  const permission = accessPermission(verb, url);
  const denied: DeniedRequest = { permission, request: `${verb} ${resource.path}` };
  const isRead = permission === "list" || permission === "get";
  if (!isRead) {
    const [el, ...fallbacks] = anchorCandidates();
    if (el) {
      showAction({ el, permission, method: verb, resource, routeKey: key, fallbacks });
      return;
    }
  }
  const pageResource = routeResource(route);
  if (pageResource && resource.key === pageResource && isRead) {
    markPageDenied(deniedEntry(route, pageResource), denied);
    return;
  }
  addSectionEntry(key, resource, denied);
}

/** Lifts a page lock or a section entry once the same permission on that resource succeeds on the same route. */
export function noteAccessSuccess({
  url,
  method,
  routeKey: startedOn,
}: Partial<AccessRequest>): void {
  // Two cached reads per response; parsing happens only while the route shows a denial.
  if (!url || (!pageDenied.value && sectionEntries.value.length === 0)) return;
  const route = currentRoute.value;
  if (!route || (startedOn !== undefined && startedOn !== accessStamp(routeKey(route)))) return;
  const info = extractResourceInfo(url);
  if (!info) return;
  const permission = accessPermission(method ?? "get", url);
  const entry = currentEntry.value;
  const org = currentOrg();
  if (entry && deniedPermission.value === permission && info.key === currentResource.value) {
    writeMemory(org, { ...readMemory(org), pages: omitKey(readMemory(org).pages, entry) });
    deniedRequests.delete(entry);
  }
  const key = routeKey(route);
  const entries = sectionEntries.value;
  const kept = entries.filter((e) => entryId(e) !== info.key || e.permission !== permission);
  if (kept.length !== entries.length) writeSections(org, key, kept);
}

/** Forgets every denial, for an org switch or a sign-out. */
export function resetAccess(): void {
  dismissAction();
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
  const resourceCount = new Set(denials.map(entryId)).size;
  const first = grouped[0]?.denials[0];
  const title =
    resourceCount === 1 && first
      ? t(DENIED_TITLE_KEYS[first.permission], { resource: resourceInlineLabel(first.resource, t) })
      : t("accessBoundary.denied.parts", resourceCount);
  const groups = grouped.map((g) => ({
    permission: g.permission,
    label: permissionLabel(g.permission, t),
    resources: g.denials.map((d) => resourceLabel(d.resource, t)),
  }));
  return { title, groups, resourceCount };
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
      const requests = inGroup.flatMap((d) => d.requests);
      const keys = inGroup.map((d) => d.resource.key).join(", ");
      return `denied ${permission}: ${keys}${requests.length ? ` (${requests.join(", ")})` : ""}`;
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

/** Maps a request URL to the resource key and label the access UI shows; null when the resource has no friendly name. */
export function extractResourceInfo(rawUrl: string): AccessResource | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, "http://localhost");
  } catch {
    return null;
  }
  const located = locateResource(apiSegments(parsed.pathname));
  if (!located) return null;
  const { matched } = located;
  const key = Object.hasOwn(RESOURCE_ALIASES, matched) ? RESOURCE_ALIASES[matched] : matched;
  return resourceForKey(key, parsed.pathname);
}

/** IAM permission a request needed: reads are List or Get (an id after the resource), writes follow the method. */
export function accessPermission(method: string, rawUrl: string): AccessPermission {
  const verb = method.toUpperCase();
  let segments: string[] = [];
  try {
    segments = apiSegments(new URL(rawUrl, "http://localhost").pathname);
  } catch {
    // An unparseable URL reads as a collection.
  }
  if (verb === "POST") return segments.some((s) => READ_POST_ACTIONS.has(s)) ? "list" : "create";
  if (verb === "PUT" || verb === "PATCH") return "update";
  if (verb === "DELETE") return "delete";
  const itemNamed = locateResource(segments)?.after.some((s) => !NON_RESOURCE_SEGMENTS.has(s));
  return itemNamed || hasItemId(segments) ? "get" : "list";
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
  return t(INLINE_LABEL_KEYS[resource.labelKey] ?? resource.labelKey);
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

function bindAccess(router: Router, store: AccessShellStore): void {
  shellStore = store;
  if (routerRef.value === router) return;
  routerRef.value = router;
  router.afterEach((to, from) => {
    const leaving = routeKey(from);
    if (leaving === routeKey(to)) return;
    dismissAction();
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

function showAction(notice: AccessActionNotice): void {
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
  if (currentRoute.value && notice.routeKey === routeKey(currentRoute.value))
    addSectionEntry(notice.routeKey, notice.resource, {
      permission: notice.permission,
      request: `${notice.method} ${notice.resource.path}`,
    });
}

function dismissAction(): void {
  actionNotice.value = null;
  anchorObserver?.disconnect();
  anchorObserver = null;
}

function markPageDenied(entry: string, denied: DeniedRequest): void {
  const records = deniedRequests.get(entry) ?? [];
  if (!records.some((r) => r.request === denied.request))
    deniedRequests.set(entry, [...records, denied]);
  const org = currentOrg();
  const memory = readMemory(org);
  if (!memory.pages[entry])
    writeMemory(org, { ...memory, pages: { ...memory.pages, [entry]: denied.permission } });
}

// One entry per (resource, permission): a denied List and a denied Delete on alerts are two things to grant.
function addSectionEntry(key: string, resource: AccessResource, denied: DeniedRequest): void {
  const org = currentOrg();
  const entries = readMemory(org).sections[key] ?? [];
  const found = entries.find(
    (e) => entryId(e) === resource.key && e.permission === denied.permission,
  );
  if (!found) {
    writeSections(org, key, [
      ...entries,
      { resource, permission: denied.permission, requests: [denied.request] },
    ]);
    return;
  }
  if (found.requests.includes(denied.request)) return;
  writeSections(
    org,
    key,
    entries.map((e) => (e === found ? { ...e, requests: [...e.requests, denied.request] } : e)),
  );
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
    const parsed: Partial<OrgAccessMemory> | null = JSON.parse(
      sessionStorage.getItem(MEMORY_PREFIX + org) ?? "{}",
    );
    memory.pages = parsed?.pages ?? {};
    memory.sections = namedSections(parsed?.sections ?? {});
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
    else sessionStorage.setItem(MEMORY_PREFIX + org, JSON.stringify(memory));
  } catch {
    // Storage can be unavailable or full; the in-memory copy still drives this tab.
  }
}

// A record written by an older build can hold resources with no friendly name, which must never render.
function namedSections(
  sections: Record<string, AccessSectionEntry[]>,
): Record<string, AccessSectionEntry[]> {
  const named = Object.entries(sections).map(
    ([key, entries]) => [key, entries.filter((e) => !!e.resource.labelKey)] as const,
  );
  return Object.fromEntries(named.filter(([, entries]) => entries.length > 0));
}

function entryId(entry: AccessSectionEntry): string {
  return entry.resource.key;
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

function resourceForKey(key: string, path = ""): AccessResource | null {
  return Object.hasOwn(FRIENDLY_NAME_KEYS, key)
    ? { key, labelKey: FRIENDLY_NAME_KEYS[key], path }
    : null;
}

// The segment after the optional version is the org (or a `_` system scope), never the resource; the last named word wins, so `functions/my_fn` is Functions.
function locateResource(segments: string[]): { matched: string; after: string[] } | null {
  const rest = segments.slice((/^v\d+$/.test(segments[0] ?? "") ? 1 : 0) + 1);
  for (let i = rest.length; i > 0; i--) {
    const joined = rest
      .slice(0, i)
      .filter((s) => !isIdSegment(s))
      .join("/");
    const matched = isKnownResource(joined) ? joined : rest[i - 1];
    if (isKnownResource(matched)) return { matched, after: rest.slice(i) };
  }
  return null;
}

function isKnownResource(path: string): boolean {
  return Object.hasOwn(FRIENDLY_NAME_KEYS, path) || Object.hasOwn(RESOURCE_ALIASES, path);
}

function isBackground(url: string): boolean {
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

// The org segment is skipped: a generated org id would otherwise read as an item id.
function hasItemId(segments: string[]): boolean {
  const rest = segments.slice((/^v\d+$/.test(segments[0] ?? "") ? 1 : 0) + 1);
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

function routeKey(route: { name?: unknown; path: string }): string {
  return typeof route.name === "string" ? route.name : route.path;
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
