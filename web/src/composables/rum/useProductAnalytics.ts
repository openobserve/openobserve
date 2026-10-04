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

import { computed, reactive, readonly, ref, toRaw } from "vue";
import type { LocationQuery, Router } from "vue-router";
import { useStore, type Store } from "vuex";
import usePerformance from "@/composables/rum/usePerformance";
import useStreams from "@/composables/useStreams";
import useAnalyticsSearch, {
  type AnalyticsStoreState,
  type PanelStatus,
} from "@/composables/rum/useAnalyticsSearch";
import { gt } from "@/types/i18n";
import useNamedEvents, { type NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { getConsumableRelativeTime } from "@/utils/date";
import {
  appProbeSql,
  entryExitSql,
  facetOptionsSql,
  identityTopSql,
  stepPickerSql,
  summarySql,
  IDENTITY_FIELDS,
  type AnalyticsScope,
  type FunnelDef,
  type IdentitySql,
  type PathsDef,
  type RetentionDef,
  type SampleRatio,
  type StepKind,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";
import {
  cohortParam,
  encodeDef,
  funnelParam,
  identityExclusionNote,
  identityGapMessage,
  identityLabels,
  isEntityId,
  parseFunnelDef,
  parsePathsDef,
  parseRetentionDef,
  parseScope,
  resolveIdentity,
  samplingRatio,
  stepRefParam,
  decodeDef,
  type AnalyticsScopeState,
  type IdentityNote,
  type IdentityResolution,
  type IdentityTopRow,
  type SavedFunnel,
} from "@/utils/rum/productAnalyticsModel";
import { PA_ROUTES, type AnalyticsSubTab } from "@/utils/rum/productAnalyticsRoutes";

export type { AnalyticsScopeState } from "@/utils/rum/productAnalyticsModel";
export type { AnalyticsSubTab } from "@/utils/rum/productAnalyticsRoutes";
export type SavedLinkIssue = "failed" | "forbidden";
export interface AnalyticsSummary {
  sessions: number;
  prevSessions: number;
  views: number;
  vaRows: number;
  syntheticSessions: number;
  dataThroughUs: number | null;
}
export interface PickerOption {
  kind: StepKind;
  key: string;
  sessions: number | null;
  name?: string;
}
export interface PickerResult {
  status: PanelStatus;
  options: PickerOption[];
}
interface FacetRow {
  value: string;
  sessions: number;
}
type UsRange = { startUs: number; endUs: number };

const DEFAULT_PERIOD = "7d";
export const PICKER_LIMIT = 200;
const SEARCH_STREAM_NOT_FOUND = 20002;
const PATH_KEYS = ["anchor", "dir", "depth", "inc", "cohort"] as const;
const RETENTION_KEYS = ["rs", "rr", "per", "rmode"] as const;

const defaultState = (): AnalyticsScopeState => ({
  app: "",
  env: [],
  version: [],
  datetime: { valueType: "relative", relativeTimePeriod: DEFAULT_PERIOD, startTime: 0, endTime: 0 },
  includeAllIdentities: false,
  exact: false,
});
const defaultFunnel = (): FunnelDef => ({
  steps: [],
  unit: "sessions",
  window: "session",
  breakdown: null,
});
const defaultPaths = (): PathsDef => ({
  anchor: null,
  direction: "next",
  depth: 3,
  include: "all",
  cohort: null,
});
const defaultRetention = (): RetentionDef => ({ start: null, ret: null, per: "auto", mode: "on" });

const state = reactive<AnalyticsScopeState>(defaultState());
const range = ref<{ startUs: number; endUs: number } | null>(null);
const identity = ref<IdentityResolution | null>(null);
const summary = ref<AnalyticsSummary | null>(null);
const apps = ref<{ app: string; sessions: number }[]>([]);
const envOptions = ref<FacetRow[]>([]);
const versionOptions = ref<FacetRow[]>([]);
const scopeStatus = ref<PanelStatus>("idle");
const scopeError = ref<string | null>(null);
const invalidParams = ref<string[]>([]);
const lastSubTab = ref<AnalyticsSubTab>("overview");
const funnel = ref<FunnelDef>(defaultFunnel());
const paths = ref<PathsDef>(defaultPaths());
const retention = ref<RetentionDef>(defaultRetention());
const trendSeries = ref<StepRef[]>([]);
const refreshTick = ref(0);
const syncedSignature = ref("");
const dataStartUs = ref<number | null>(null);
let dataStartFor: string | null = null;
const summaryRow = ref<Record<string, number> | null>(null);
const identityTops = ref<Record<string, IdentityTopRow[]>>({});
const pickerCache = new Map<string, PickerOption[]>();
const entryExitCache = new Map<string, Record<string, unknown>[]>();
const entryExitInflight = new Map<string, Promise<Record<string, unknown>[]>>();
let loadedKey: string | null = null;
let loadGeneration = 0;
// Each part of a scope load is keyed by only what its SQL reads, so a toggle reruns only what it changes.
const partKeys = { apps: "", facets: "", summary: "" };
let appsNoStream = false;
// The org the shared _rumdata schema was read for; an entry another reader wrote belongs to the org on screen then.
let schemaStamp: { org: string; entry: object } | null = null;
let inflight: { key: string; promise: Promise<void> } | null = null;
let runner: ReturnType<typeof useAnalyticsSearch> | null = null;
let latestStore: Store<AnalyticsStoreState> | undefined;
let pendingPush: Promise<unknown> | null = null;
const deletedEventLink = ref(false);
let dropPending = false;
// The saved funnel being edited: its version is the one Save sends, never one re-read later.
const openedFunnel = ref<SavedFunnel | null>(null);
const pendingSavedId = ref<string | null>(null);
const savedFunnelMissing = ref(false);
// Why the sf link could not be read, keyed by org, app and link; an entry or app switch clears it.
const savedLinkIssue = ref<{ key: string; kind: SavedLinkIssue } | null>(null);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// A cohort keeps its meaning only while its anchor step survives and some step still follows it.
const dropCohortSteps = (p: PathsDef, missing: (s: StepRef | null) => boolean): PathsDef => {
  const c = p.cohort;
  if (!c || !c.funnel.steps.some(missing)) return p;
  const anchor = c.funnel.steps[c.stepIndex - 1];
  const steps = c.funnel.steps.filter((s) => !missing(s));
  const stepIndex = c.funnel.steps.slice(0, c.stepIndex).filter((s) => !missing(s)).length;
  if (missing(anchor) || stepIndex >= steps.length) {
    return { ...p, cohort: null, anchor: missing(anchor) ? p.anchor : anchor };
  }
  return { ...p, cohort: { ...c, funnel: { ...c.funnel, steps }, stepIndex } };
};

// A URL parses one value back as a string and numbers as strings, so both sides are normalised to string arrays.
export function querySignature(q: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(q)
      .filter((k) => q[k] !== undefined)
      .sort()
      .map((k) => {
        const v = q[k];
        return [k, (Array.isArray(v) ? v : [v]).map((x) => String(x ?? ""))];
      }),
  );
}

export function resetProductAnalytics(): void {
  Object.assign(state, defaultState());
  range.value = null;
  identity.value = null;
  summary.value = null;
  apps.value = [];
  envOptions.value = [];
  versionOptions.value = [];
  scopeStatus.value = "idle";
  scopeError.value = null;
  invalidParams.value = [];
  lastSubTab.value = "overview";
  funnel.value = defaultFunnel();
  paths.value = defaultPaths();
  retention.value = defaultRetention();
  trendSeries.value = [];
  refreshTick.value = 0;
  syncedSignature.value = "";
  dataStartUs.value = null;
  dataStartFor = null;
  summaryRow.value = null;
  identityTops.value = {};
  pickerCache.clear();
  entryExitCache.clear();
  entryExitInflight.clear();
  loadedKey = null;
  loadGeneration++;
  Object.assign(partKeys, { apps: "", facets: "", summary: "" });
  appsNoStream = false;
  schemaStamp = null;
  inflight = null;
  pendingPush = null;
  deletedEventLink.value = false;
  dropPending = false;
  openedFunnel.value = null;
  pendingSavedId.value = null;
  savedFunnelMissing.value = false;
  savedLinkIssue.value = null;
}

const appStorageKey = (org: string) => `o2.rum.analytics.${org}.app`;

const firstString = (v: unknown): string | undefined =>
  (Array.isArray(v) ? v[0] : v) as string | undefined;

export default function useProductAnalytics() {
  const store = useStore<AnalyticsStoreState>();
  if (store) latestStore = store;
  const { performanceState } = usePerformance();
  const { getStream } = useStreams(gt);
  const namedEvents = useNamedEvents();
  if (!runner) runner = useAnalyticsSearch(undefined, () => latestStore);
  const search = runner;

  const org = (): string => latestStore?.state.selectedOrganization?.identifier ?? "";

  const schema = computed<Record<string, boolean>>(() => {
    const fields = performanceState.data.streams?._rumdata?.schema ?? {};
    return Object.fromEntries(Object.keys(fields).map((f) => [f, true]));
  });

  const scope = computed<AnalyticsScope>(() => ({
    app: state.app,
    env: [...state.env],
    version: [...state.version],
    schema: schema.value,
  }));

  const identitySql = computed<IdentitySql | null>(() =>
    identity.value?.field
      ? { field: identity.value.field, excluded: [...identity.value.excluded] }
      : null,
  );

  const usersUnit = computed(() => identityLabels(identity.value));
  const identityGapText = computed(() => identityGapMessage(identity.value));

  const identityNote = computed<IdentityNote | null>(() =>
    summaryRow.value && identity.value
      ? identityExclusionNote(identity.value, summaryRow.value, identityTops.value, schema.value)
      : null,
  );

  const sampleRatio = computed<SampleRatio>(() =>
    samplingRatio(summary.value?.vaRows ?? 0, state.exact),
  );

  const scopeKey = computed(() =>
    [
      org(),
      state.app,
      state.env.join(","),
      state.version.join(","),
      range.value?.startUs ?? "",
      range.value?.endUs ?? "",
      state.includeAllIdentities ? 1 : 0,
      state.exact ? 1 : 0,
    ].join("|"),
  );

  const resolveRange = (force = false): { startUs: number; endUs: number } => {
    if (range.value && !force) return range.value;
    const dt = state.datetime;
    const resolved =
      dt.valueType === "relative"
        ? getConsumableRelativeTime(dt.relativeTimePeriod ?? DEFAULT_PERIOD)
        : null;
    range.value = resolved
      ? { startUs: resolved.startTime, endUs: resolved.endTime }
      : { startUs: dt.startTime, endUs: dt.endTime };
    return range.value;
  };

  /** `keepFunnel` keeps the funnel being built, for a URL that never names one (the saved-funnels list). */
  const initFromRoute = (
    query: LocationQuery | Record<string, unknown>,
    { keepFunnel = false }: { keepFunnel?: boolean } = {},
  ) => {
    const q = query as Record<string, unknown>;
    const { scope: parsed, invalid } = parseScope(q);
    Object.assign(state, defaultState(), parsed);
    range.value = null;
    paths.value = defaultPaths();
    retention.value = defaultRetention();
    if (!keepFunnel) {
      funnel.value = defaultFunnel();
      if (q.funnel !== undefined) {
        const def = parseFunnelDef(decodeDef(firstString(q.funnel)));
        if (def) funnel.value = def;
        else invalid.push("funnel");
      }
      openedFunnel.value = null;
      savedFunnelMissing.value = false;
      savedLinkIssue.value = null;
      const sf = firstString(q.sf);
      pendingSavedId.value = isEntityId(sf) ? sf : null;
      if (sf !== undefined && !pendingSavedId.value) invalid.push("sf");
    }
    if (PATH_KEYS.some((k) => q[k] !== undefined)) {
      const def = parsePathsDef(Object.fromEntries(PATH_KEYS.map((k) => [k, firstString(q[k])])));
      if (def) paths.value = def;
      else invalid.push("paths");
    }
    if (RETENTION_KEYS.some((k) => q[k] !== undefined)) {
      const def = parseRetentionDef(
        Object.fromEntries(RETENTION_KEYS.map((k) => [k, firstString(q[k])])),
      );
      if (def) retention.value = def;
      else invalid.push("retention");
    }
    invalidParams.value = invalid;
    deletedEventLink.value = false;
    dropPending = true;
  };

  /** The URL query for `routeName`, or for every route when omitted. */
  const toQuery = (routeName?: string): Record<string, string | string[]> => {
    const q: Record<string, string | string[]> = { org_identifier: org() };
    if (state.app) q.app = state.app;
    if (state.env.length) q.env = [...state.env];
    if (state.version.length) q.version = [...state.version];
    const dt = state.datetime;
    if (dt.valueType === "relative") q.period = dt.relativeTimePeriod ?? DEFAULT_PERIOD;
    else {
      q.from = String(dt.startTime);
      q.to = String(dt.endTime);
    }
    if (state.includeAllIdentities) q.idall = "1";
    if (state.exact) q.exact = "1";
    // A copied list link must open the list, so only other routes carry the funnel being built.
    const sf = openedFunnel.value?.id ?? pendingSavedId.value;
    if (routeName !== PA_ROUTES.funnels) {
      if (funnel.value.steps.length) q.funnel = encodeDef(funnelParam(funnel.value));
      if (sf) q.sf = sf;
    }
    const p = paths.value;
    if (p.anchor) q.anchor = encodeDef(stepRefParam(p.anchor));
    if (p.direction !== "next") q.dir = p.direction;
    if (p.depth !== 3) q.depth = String(p.depth);
    if (p.include !== "all") q.inc = p.include;
    if (p.cohort) q.cohort = cohortParam(p.cohort);
    const r = retention.value;
    if (r.start) q.rs = encodeDef(stepRefParam(r.start));
    if (r.ret) q.rr = encodeDef(stepRefParam(r.ret));
    if (r.per !== "auto") q.per = r.per;
    if (r.mode !== "on") q.rmode = r.mode;
    return q;
  };

  const syncUrl = async (router: Router, name?: string): Promise<void> => {
    // A replace issued while a sub-tab push is pending cancels that push and strands the user on the old sub-tab.
    while (pendingPush) await pendingPush.catch(() => undefined);
    const target = name ?? (router.currentRoute.value.name as string);
    const query = toQuery(target);
    syncedSignature.value = querySignature(query);
    await router.replace({ name: target, query });
  };

  /** Opens another analytics sub-tab with the current state; URL syncs wait for it to land. */
  const pushSubTab = (router: Router, name: string): Promise<unknown> => {
    const query = toQuery(name);
    // Stamped before the push so the shell's route watcher treats it as its own navigation, not a pasted link.
    syncedSignature.value = querySignature(query);
    const push = router.push({ name, query });
    pendingPush = push;
    const settle = () => {
      if (pendingPush === push) pendingPush = null;
    };
    push.then(settle, settle);
    return push;
  };

  /** The empty states' one-click way out: the last 30 days, written to the URL. */
  const widenRange = (router: Router) => {
    setScope({
      datetime: { valueType: "relative", relativeTimePeriod: "30d", startTime: 0, endTime: 0 },
    });
    void syncUrl(router);
  };

  const setScope = (patch: Partial<AnalyticsScopeState>, explicitApp = false) => {
    if (patch.datetime) range.value = null;
    if (patch.app !== undefined && patch.app !== state.app) savedLinkIssue.value = null;
    Object.assign(state, patch);
    if (explicitApp && patch.app) {
      try {
        window.localStorage.setItem(appStorageKey(org()), patch.app);
      } catch {
        /* storage is best-effort */
      }
    }
  };

  const rumEntry = (): object | null => {
    const entry = performanceState.data.streams?._rumdata;
    return entry?.schema ? toRaw(entry) : null;
  };

  const ensureSchema = async () => {
    const forOrg = org();
    const seen = rumEntry();
    if (seen && schemaStamp?.entry !== seen) schemaStamp = { org: forOrg, entry: seen };
    if (seen && schemaStamp?.org === forOrg) return;
    let fields: Record<string, unknown> = {};
    let read = false;
    try {
      const stream = await getStream("_rumdata", "logs", true);
      for (const f of stream?.schema ?? []) fields[f.name] = f;
      read = true;
    } catch {
      fields = {};
    }
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: fields };
    // A failed read is stamped for no org, so the next load asks again instead of trusting it.
    schemaStamp = { org: read ? forOrg : "", entry: rumEntry() ?? {} };
  };

  const pickApp = (listed: string[]): string => {
    if (state.app) return state.app;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(appStorageKey(org()));
    } catch {
      stored = null;
    }
    if (stored && listed.includes(stored)) return stored;
    return listed[0] ?? "";
  };

  const loadIdentityTops = async (cur: UsRange, key: string) => {
    const tops: Record<string, IdentityTopRow[]> = {};
    await Promise.all(
      IDENTITY_FIELDS.filter((f) => schema.value[f]).map(async (f) => {
        const res = await search.run<IdentityTopRow>(
          `scope-top-${f}`,
          { sql: identityTopSql(scope.value, f), ...cur, limit: 3, sampled: 1 },
          key,
        );
        tops[f] = res.status === "ok" ? res.rows : [];
      }),
    );
    return tops;
  };

  const loadFacets = async (cur: UsRange, key: string, stale: () => boolean) => {
    let settled = true;
    await Promise.all(
      (["env", "version"] as const).map(async (field) => {
        const target = field === "env" ? envOptions : versionOptions;
        if (!schema.value[field]) {
          target.value = [];
          return;
        }
        const res = await search.run<FacetRow>(
          `scope-facet-${field}`,
          { sql: facetOptionsSql(scope.value, field), ...cur, limit: 100, sampled: 1 },
          key,
        );
        if (stale()) return;
        // A run still loading or aborted says nothing about the options, so the selects keep theirs.
        if (res.status === "ok") target.value = res.rows;
        else if (res.status === "error" || res.status === "forbidden") target.value = [];
        if (res.status !== "ok") settled = false;
      }),
    );
    return settled;
  };

  const loadApps = async (cur: UsRange, force: boolean): Promise<PanelStatus | null> => {
    const key = `${org()}|${cur.startUs}|${cur.endUs}`;
    if (!force && partKeys.apps === key) return null;
    const probe = await search.run<{ app: string; sessions: number }>(
      "scope-apps",
      { sql: appProbeSql(), ...cur, limit: 100, sampled: 1 },
      key,
    );
    // An org that never ingested RUM has no _rumdata stream, which search refuses instead of answering empty.
    const noStream = probe.status === "error" && probe.error?.code === SEARCH_STREAM_NOT_FOUND;
    if (probe.status !== "ok" && !noStream) {
      scopeError.value = probe.error?.message ?? null;
      return probe.status;
    }
    appsNoStream = noStream;
    apps.value = (noStream ? [] : probe.rows).map((r) => ({
      app: String(r.app),
      sessions: num(r.sessions),
    }));
    partKeys.apps = key;
    return null;
  };

  const commitSummary = (row: Record<string, number>, tops: Record<string, IdentityTopRow[]>) => {
    summaryRow.value = row;
    identityTops.value = tops;
    summary.value = {
      sessions: num(row.sessions),
      prevSessions: num(row.prev_sessions),
      views: num(row.views),
      vaRows: num(row.va_rows),
      syntheticSessions: num(row.synthetic_sessions),
      dataThroughUs: row.data_through_us ? num(row.data_through_us) : null,
    };
  };

  const runSummary = async (cur: UsRange, key: string, stale: () => boolean) => {
    const prev = { startUs: cur.startUs - (cur.endUs - cur.startUs), endUs: cur.endUs };
    const [sum, tops] = await Promise.all([
      search.run<Record<string, number>>(
        "scope-summary",
        { sql: summarySql(scope.value, cur.startUs), ...prev, limit: 1, sampled: 1 },
        key,
      ),
      loadIdentityTops(cur, key),
    ]);
    if (stale() || sum.status !== "ok") return sum;
    commitSummary(sum.rows[0] ?? {}, tops);
    partKeys.summary = key;
    return sum;
  };

  /** Facets read only app and range; summary and identity tops also read env and version. */
  const loadSummary = async (
    cur: UsRange,
    force: boolean,
    stale: () => boolean,
  ): Promise<PanelStatus | null> => {
    const facetsKey = `${org()}|${state.app}|${cur.startUs}|${cur.endUs}`;
    const key = `${facetsKey}|${state.env.join(",")}|${state.version.join(",")}`;
    const needFacets = force || partKeys.facets !== facetsKey;
    const needSummary = force || partKeys.summary !== key || !summaryRow.value;
    const [facetsSettled, sum] = await Promise.all([
      needFacets ? loadFacets(cur, facetsKey, stale) : false,
      needSummary ? runSummary(cur, key, stale) : null,
    ]);
    if (stale()) return null;
    if (facetsSettled) partKeys.facets = facetsKey;
    if (sum && sum.status !== "ok") {
      scopeError.value = sum.error?.message ?? null;
      return sum.status;
    }
    return null;
  };

  const doLoad = async (force: boolean) => {
    const gen = ++loadGeneration;
    const stale = () => gen !== loadGeneration;
    const cur = resolveRange(force);
    if (state.app) void namedEvents.ensure(org(), state.app, force);
    await ensureSchema();
    if (stale()) return;
    scopeStatus.value = "loading";
    scopeError.value = null;
    const appsFailed = await loadApps(cur, force);
    if (stale()) return;
    if (appsFailed) {
      scopeStatus.value = appsFailed;
      return;
    }
    // No stream means no app can exist, so a URL app would only send the summary into the same 20002.
    if (appsNoStream) state.app = "";
    const before = state.app;
    state.app = pickApp(apps.value.map((a) => a.app));
    // The same app's load already started above; a second call after a fast failure would retry and toast twice.
    if (state.app && state.app !== before) void namedEvents.ensure(org(), state.app, force);
    // Stamped from this load's own scope: a newer load makes this one stale before it can commit.
    const key = scopeKey.value;
    if (!state.app) {
      summary.value = null;
      identity.value = null;
      scopeStatus.value = "ok";
      loadedKey = key;
      return;
    }
    const failed = await loadSummary(cur, force, stale);
    if (stale()) return;
    if (failed) {
      scopeStatus.value = failed;
      return;
    }
    identity.value = resolveIdentity(
      summaryRow.value ?? {},
      identityTops.value,
      schema.value,
      state.includeAllIdentities,
    );
    scopeStatus.value = "ok";
    loadedKey = key;
  };

  const loadScope = async (force = false): Promise<void> => {
    if (force) resolveRange(true);
    else resolveRange();
    if (!force && loadedKey === scopeKey.value && scopeStatus.value === "ok") return;
    if (!force && inflight && inflight.key === scopeKey.value) return inflight.promise;
    const promise = doLoad(force);
    inflight = { key: scopeKey.value, promise };
    try {
      await promise;
    } finally {
      if (inflight?.promise === promise) inflight = null;
    }
  };

  const eventsStatus = computed<NamedEventsStatus>(() => namedEvents.status(org(), state.app));

  // A shared link can name an event deleted since; its steps are dropped once, when the app's events are ready.
  const dropMissingEvents = () => {
    dropPending = false;
    const known = new Set(namedEvents.events.value.map((e) => e.id));
    const missing = (s: StepRef | null) => !!s && s.kind === "e" && !known.has(s.key);
    let dropped = false;
    const f = funnel.value;
    // A saved funnel keeps a deleted event's step, tagged, so it stays editable.
    const saved = !!openedFunnel.value || !!pendingSavedId.value;
    if (!saved && f.steps.some(missing)) {
      funnel.value = { ...f, steps: f.steps.filter((s) => !missing(s)) };
      dropped = true;
    }
    const p = dropCohortSteps(paths.value, missing);
    if (p !== paths.value) {
      paths.value = p;
      dropped = true;
    }
    if (missing(paths.value.anchor)) {
      paths.value = { ...paths.value, anchor: null };
      dropped = true;
    }
    const r = retention.value;
    if (missing(r.start) || missing(r.ret)) {
      retention.value = {
        ...r,
        start: missing(r.start) ? null : r.start,
        ret: missing(r.ret) ? null : r.ret,
      };
      dropped = true;
    }
    deletedEventLink.value = dropped;
  };

  /** Resolves "ready" at once when `uses` is false; otherwise waits out the events load, so "loading" means a newer load began. */
  const eventsGate = async (uses: () => boolean): Promise<NamedEventsStatus> => {
    if (!uses()) return "ready";
    await namedEvents.ensure(org(), state.app);
    const status = namedEvents.status(org(), state.app);
    if (status === "ready" && dropPending) dropMissingEvents();
    return uses() ? status : "ready";
  };

  /** Makes `f` the funnel being edited; `keepSteps` leaves unsaved edits on screen, as a rename does. */
  const openSavedFunnel = (f: SavedFunnel, keepSteps = false) => {
    openedFunnel.value = f;
    pendingSavedId.value = null;
    savedFunnelMissing.value = false;
    savedLinkIssue.value = null;
    if (!keepSteps) funnel.value = { ...f.def, steps: [...f.def.steps] };
  };

  const detachSavedFunnel = () => {
    openedFunnel.value = null;
    pendingSavedId.value = null;
    savedLinkIssue.value = null;
  };

  const linkKey = (app: string, id: string) => `${org()}|${app}|${id}`;

  const savedLinkProblem = computed<SavedLinkIssue | null>(() => {
    const issue = savedLinkIssue.value;
    const id = pendingSavedId.value;
    return issue && id && issue.key === linkKey(state.app, id) ? issue.kind : null;
  });

  /** Records why the link `id` could not be read under `app`, which the caller captured before its reads. */
  const setSavedLinkIssue = (app: string, id: string, kind: SavedLinkIssue) => {
    savedLinkIssue.value = { key: linkKey(app, id), kind };
  };

  /** The link's saved funnel is gone or unreadable: keep the funnel it carried and say so. */
  const markSavedFunnelMissing = () => {
    detachSavedFunnel();
    savedFunnelMissing.value = true;
  };

  const retryEvents = async (): Promise<void> => {
    await namedEvents.ensure(org(), state.app, true);
  };

  // The oldest kept event bounds retention cohorts; a missing stat leaves them unclipped.
  const loadDataStart = async (): Promise<number | null> => {
    const forOrg = org();
    if (dataStartFor === forOrg) return dataStartUs.value;
    let start: number | null = null;
    try {
      const stream = await getStream("_rumdata", "logs", false);
      const min = Number(stream?.stats?.doc_time_min);
      start = Number.isFinite(min) && min > 0 ? min : null;
    } catch {
      start = null;
    }
    if (org() !== forOrg) return dataStartFor === org() ? dataStartUs.value : null;
    dataStartUs.value = start;
    dataStartFor = forOrg;
    return start;
  };

  const refresh = async () => {
    pickerCache.clear();
    entryExitCache.clear();
    await loadScope(true);
    refreshTick.value++;
  };

  const toPickerRows = (rows: { kind: string; k: string; sessions: number }[]): PickerOption[] =>
    rows.map((r) => ({
      kind: r.kind === "c" ? "c" : "p",
      key: String(r.k),
      sessions: num(r.sessions),
    }));

  /** Pages and clicks in scope; only a successful read is cached, so a failure is retried on the next call. */
  const loadPicker = async (force = false): Promise<PickerResult> => {
    const key = scopeKey.value;
    const cached = pickerCache.get(key);
    if (!force && cached) return { status: "ok", options: cached };
    const cur = resolveRange();
    const res = await search.run<{ kind: string; k: string; sessions: number }>(
      "scope-picker",
      { sql: stepPickerSql(scope.value), ...cur, limit: PICKER_LIMIT, sampled: 1 },
      key,
    );
    if (res.status !== "ok") return { status: res.status, options: [] };
    const options = toPickerRows(res.rows);
    pickerCache.set(key, options);
    return { status: "ok", options };
  };

  /** Named events first, then the scope's pages and clicks; a failed read contributes none. */
  const pickerOptions = async (force = false): Promise<PickerOption[]> => {
    const events: PickerOption[] = namedEvents.events.value.map((e) => ({
      kind: "e" as const,
      key: e.id,
      sessions: null,
      name: e.name,
    }));
    return [...events, ...(await loadPicker(force)).options];
  };

  const searchPicker = async (term: string): Promise<PickerResult> => {
    const cur = resolveRange();
    const res = await search.run<{ kind: string; k: string; sessions: number }>(
      "scope-picker-term",
      { sql: stepPickerSql(scope.value, term), ...cur, limit: 50, sampled: 1 },
      `${scopeKey.value}|${term}`,
    );
    return { status: res.status, options: res.status === "ok" ? toPickerRows(res.rows) : [] };
  };

  const readEntryExit = async (key: string): Promise<Record<string, unknown>[]> => {
    const cur = resolveRange();
    const prev = { startUs: cur.startUs - (cur.endUs - cur.startUs), endUs: cur.endUs };
    const res = await search.run<Record<string, unknown>>(
      "scope-entry-exit",
      {
        sql: entryExitSql(scope.value, cur.startUs, identitySql.value),
        ...prev,
        limit: 1000,
        sampled: 1,
      },
      key,
    );
    if (res.status !== "ok")
      throw Object.assign(new Error(res.error?.message ?? ""), { state: res });
    entryExitCache.set(key, res.rows);
    return res.rows;
  };

  /** Overview and Paths share one panel, so a second caller for the same scope joins the read in flight. */
  const entryExit = async (force = false): Promise<Record<string, unknown>[]> => {
    const key = `${scopeKey.value}|${identitySql.value ? identitySql.value.field : ""}`;
    if (!force && entryExitCache.has(key)) return entryExitCache.get(key) ?? [];
    const joined = entryExitInflight.get(key);
    if (!force && joined) return joined;
    const read = readEntryExit(key);
    entryExitInflight.set(key, read);
    try {
      return await read;
    } finally {
      if (entryExitInflight.get(key) === read) entryExitInflight.delete(key);
    }
  };

  return {
    state,
    scope,
    schema,
    identity: readonly(identity),
    identityNote,
    usersUnit,
    identityGapText,
    dataStartUs: readonly(dataStartUs),
    loadDataStart,
    refreshTick: readonly(refreshTick),
    refresh,
    identitySql,
    summary: readonly(summary),
    sampleRatio,
    apps: readonly(apps),
    envOptions: readonly(envOptions),
    versionOptions: readonly(versionOptions),
    scopeStatus: readonly(scopeStatus),
    scopeError: readonly(scopeError),
    scopeKey,
    range: readonly(range),
    invalidParams,
    lastSubTab,
    funnel,
    paths,
    retention,
    trendSeries,
    initFromRoute,
    toQuery,
    syncUrl,
    pushSubTab,
    syncedSignature: readonly(syncedSignature),
    setScope,
    widenRange,
    resolveRange,
    loadScope,
    pickerOptions,
    loadPicker,
    searchPicker,
    entryExit,
    eventsStatus,
    eventsGate,
    retryEvents,
    deletedEventLink: readonly(deletedEventLink),
    openedFunnel: computed(() => openedFunnel.value),
    pendingSavedId: readonly(pendingSavedId),
    savedFunnelMissing: readonly(savedFunnelMissing),
    savedLinkProblem,
    setSavedLinkIssue,
    openSavedFunnel,
    detachSavedFunnel,
    markSavedFunnelMissing,
  };
}
