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
import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";
import {
  STREAM_PROBE_PAGE,
  streamNameListQuery,
  streamProbeQuery,
  streamSchemaQuery,
} from "@/services/stream.queries";
import { streamKeys } from "@/services/stream.querykeys";
import { recentRejectionsQuery } from "@/services/ingestion.queries";
import type { IngestRejection } from "@/services/ingestion";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { gt } from "@/types/i18n";
import {
  USER_DATA_STREAM_TYPES,
  isUserDataStream,
  type UserDataStreamType,
} from "@/utils/internalStreams";
import { FIRST_EVENT_BUDGET, cadenceAt } from "./firstEventBudget";
import {
  DEFAULT_INGEST_ALLOWED_IN_FUTURE_H,
  DEFAULT_INGEST_ALLOWED_UPTO_H,
  anchorSql,
  confirmSql,
  filterFields,
  firstRecordSql,
  ingestWindow,
  recordRange,
  sinceWindow,
  type TimeWindowUs,
} from "./confirmQuery";
import { markDetectionSeen } from "./useFirstDataNotice";

export type StreamSignal = UserDataStreamType;
export type FirstEventState = "waiting" | "received" | "rejected" | "no-requests" | "stopped";
export type DiagnosisTrigger = "auto" | "troubleshoot";

export interface FirstEventDiagnosis {
  form: "rejected" | "no-requests" | "unavailable";
  trigger: DiagnosisTrigger;
  rejections: IngestRejection[];
}

export interface FirstEventResult {
  streamName: string;
  streamType: StreamSignal;
  count: number;
  firstRecord?: Record<string, unknown>;
  firstRecordUs?: number;
  /** Microseconds; thirty minutes around the first record. */
  rangeStart: number;
  rangeEnd: number;
  /** Server-clock watch start, set only for a target stream that already existed. */
  sinceUs?: number;
}

export interface FirstEventWatchOptions {
  targetStream?: Ref<string | undefined>;
  filter?: Ref<string | undefined>;
  /** `keyword`: the target is a name fragment shared by the source's streams, such as `system_`. */
  match?: Ref<"exact" | "keyword" | undefined>;
  /** Off for the pill display, which names no cause: no rejections read without a Troubleshoot. */
  autoDiagnosis?: Ref<boolean>;
}

interface StreamRow {
  name: string;
  stream_type?: string;
  stats?: { doc_num?: number; doc_time_min?: number; doc_time_max?: number };
}

interface TypeSnapshot {
  total: number;
  names: Set<string>;
}

interface TargetState {
  /** Unknown until the first answered probe. */
  existed?: boolean;
  zoNowUs?: number;
  anchoredAtMs?: number;
  baseline?: Set<string>;
  baselineTotal?: number;
  matches?: string[];
}

interface Confirmation {
  count: number;
  tsUs: number;
}

/** One poll's view of the watch, captured when it starts. */
interface PollContext {
  gen: number;
  org: string;
  type: StreamSignal;
  filter?: string;
}

const MAX_TARGET_PAGES = 10;
const ONE_SECOND_US = 1_000_000;
const QUARTER_HOUR_US = 15 * 60 * ONE_SECOND_US;

const nowMs = () => Date.now();

const fetchOrNull = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch {
    // a failed probe or query counts as a zero; the next poll tries again
    return null;
  }
};

const newestFirst = (rows: StreamRow[]): StreamRow[] =>
  [...rows].sort((a, b) => Number(b.stats?.doc_time_max ?? 0) - Number(a.stats?.doc_time_max ?? 0));

const statsKey = (row: StreamRow): string =>
  `${Number(row.stats?.doc_num ?? 0)}/${Number(row.stats?.doc_time_max ?? 0)}`;

/** Polls for the first record of the current source on the shared budget, and reads recent rejections when nothing arrives. */
export function useFirstEventWatch(
  org: Ref<string>,
  signal?: Ref<StreamSignal | undefined>,
  options: FirstEventWatchOptions = {},
) {
  const store = useStore();
  const { setStreams } = useStreams(gt);

  const state = ref<FirstEventState>("waiting");
  const result = ref<FirstEventResult>();
  const diagnosis = ref<FirstEventDiagnosis>();
  const startedAtMs = ref<number>();
  const troubleshooting = ref(false);
  const target = ref<TargetState>({});

  let running = false;
  // bumped on every org, signal, target, match or filter change; results of an older generation are dropped
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pausedWhileHidden = false;
  let pollingGen: number | undefined;
  let rejectionsGen: number | undefined;
  let lastRejectionsReadMs: number | undefined;
  // an org with data can never turn tracked again, so automatic reads stop until the watch restarts
  let untracked = false;
  let diagnosisTrigger: DiagnosisTrigger | undefined;
  let snapshots: Partial<Record<StreamSignal, TypeSnapshot>> = {};
  let candidates: Partial<Record<StreamSignal, Map<string, StreamRow>>> = {};
  let schemaReady = new Set<string>();
  let matchStats = new Map<string, string>();
  let owed = new Set<string>();
  let rotation = 0;
  let lastFromOwed = false;

  const targetName = computed(() => options.targetStream?.value?.trim() || undefined);
  const filter = computed(() => options.filter?.value?.trim() || undefined);
  const keywordMatch = computed(() => options.match?.value === "keyword");
  const watchedTypes = computed<StreamSignal[]>(() => {
    if (signal?.value) return [signal.value];
    return targetName.value ? ["logs"] : [...USER_DATA_STREAM_TYPES];
  });
  const elapsedMs = () => (startedAtMs.value === undefined ? 0 : nowMs() - startedAtMs.value);
  const scope = computed(() =>
    target.value.existed && targetName.value ? "since-watch-start" : "new-data",
  );
  const stale = (ctx: { gen: number }) => !running || ctx.gen !== generation;
  const autoDiagnosis = () => options.autoDiagnosis?.value !== false;

  const configNumber = (key: string, fallback: number): number => {
    const raw = store.state.zoConfig?.[key];
    const value = Number(raw);
    return raw !== undefined && raw !== null && Number.isFinite(value) ? value : fallback;
  };

  const runSql = async (
    ctx: PollContext,
    sql: string,
    w: TimeWindowUs,
  ): Promise<Record<string, unknown>[] | null> =>
    fetchOrNull(async () => {
      const res = await searchService.search(
        {
          org_identifier: ctx.org,
          query: {
            query: { sql, start_time: w.startUs, end_time: w.endUs, from: 0, size: 1 },
          },
          page_type: ctx.type,
        },
        "ui",
      );
      return (res?.data?.hits ?? []) as Record<string, unknown>[];
    });

  // Filter fields are gated on the schema: a stream without them answers zero instead of a failed query.
  const schemaHasFilterFields = async (ctx: PollContext, stream: string): Promise<boolean> => {
    const fields = filterFields(ctx.filter);
    if (!fields.length || schemaReady.has(`${ctx.type}/${stream}`)) return true;
    const schema = await fetchOrNull(() =>
      queryClient.fetchQuery({ ...streamSchemaQuery(ctx.org, stream, ctx.type), staleTime: 0 }),
    );
    const names = new Set<string>(
      ((schema?.schema ?? []) as Array<{ name?: string }>).map((f) => f?.name ?? ""),
    );
    const ready = fields.every((f) => names.has(f));
    if (ready && !stale(ctx)) schemaReady.add(`${ctx.type}/${stream}`);
    return ready;
  };

  const confirmNewStream = async (
    ctx: PollContext,
    row: StreamRow,
    trustStats: boolean,
  ): Promise<Confirmation | null> => {
    if (!(await schemaHasFilterFields(ctx, row.name))) return null;
    const docNum = Number(row.stats?.doc_num ?? 0);
    const docMin = Number(row.stats?.doc_time_min ?? 0);
    if (trustStats && !ctx.filter && docNum > 0 && docMin > 0) {
      return { count: docNum, tsUs: docMin };
    }
    const w = ingestWindow(nowMs(), {
      ingestAllowedUptoH: configNumber("ingest_allowed_upto", DEFAULT_INGEST_ALLOWED_UPTO_H),
      ingestAllowedInFutureH: configNumber(
        "ingest_allowed_in_future",
        DEFAULT_INGEST_ALLOWED_IN_FUTURE_H,
      ),
      maxQueryRangeH: configNumber("max_query_range", 0),
    });
    const hits = await runSql(ctx, confirmSql(row.name, ctx.filter), w);
    const count = Number(hits?.[0]?.zo_count ?? 0);
    if (count <= 0) return null;
    const zoMin = Number(hits?.[0]?.zo_min ?? 0);
    return { count, tsUs: !ctx.filter && docMin > 0 ? docMin : zoMin };
  };

  const confirmSinceAnchor = async (
    ctx: PollContext,
    stream: string,
  ): Promise<Confirmation | null> => {
    const t = target.value;
    if (t.zoNowUs === undefined || t.anchoredAtMs === undefined) return null;
    if (!(await schemaHasFilterFields(ctx, stream))) return null;
    const w = sinceWindow(t.zoNowUs, nowMs() - t.anchoredAtMs);
    const hits = await runSql(ctx, confirmSql(stream, ctx.filter, t.zoNowUs), w);
    const count = Number(hits?.[0]?.zo_count ?? 0);
    return count > 0 ? { count, tsUs: Number(hits?.[0]?.zo_min ?? t.zoNowUs) } : null;
  };

  const anchor = async (ctx: PollContext, stream: string) => {
    const end = nowMs() * 1000;
    const hits = await runSql(ctx, anchorSql(stream), {
      startUs: end - ONE_SECOND_US,
      endUs: end,
    });
    const zoNow = Number(hits?.[0]?.zo_now ?? 0);
    if (zoNow > 0 && !stale(ctx)) {
      target.value = { ...target.value, zoNowUs: zoNow * ONE_SECOND_US, anchoredAtMs: nowMs() };
    }
  };

  const probePage = (ctx: PollContext, keyword: string, offset: number) =>
    fetchOrNull(() => queryClient.fetchQuery(streamProbeQuery(ctx.org, ctx.type, keyword, offset)));

  const findTarget = async (
    ctx: PollContext,
    name: string,
  ): Promise<StreamRow | null | undefined> => {
    for (let page = 0; page < MAX_TARGET_PAGES; page++) {
      const offset = page * STREAM_PROBE_PAGE;
      const res = await probePage(ctx, name, offset);
      if (!res) return undefined;
      const row = (res.list as StreamRow[]).find((s) => s?.name === name);
      if (row) return row;
      if (offset + STREAM_PROBE_PAGE >= res.total) return null;
    }
    return null;
  };

  /** Every user stream whose name holds the keyword, in bounded pages; undefined when a page fails. */
  const listMatches = async (
    ctx: PollContext,
    keyword: string,
  ): Promise<{ rows: StreamRow[]; total: number } | undefined> => {
    const rows: StreamRow[] = [];
    let total = 0;
    for (let page = 0; page < MAX_TARGET_PAGES; page++) {
      const offset = page * STREAM_PROBE_PAGE;
      const res = await probePage(ctx, keyword, offset);
      if (!res) return undefined;
      total = res.total;
      rows.push(
        ...(res.list as StreamRow[]).filter(
          (s) => s?.name?.includes(keyword) && isUserDataStream(s.name, s.stream_type ?? ctx.type),
        ),
      );
      if (offset + STREAM_PROBE_PAGE >= res.total) break;
    }
    return { rows, total };
  };

  const freshTypeList = (ctx: PollContext) =>
    fetchOrNull(() =>
      queryClient.fetchQuery({ ...streamNameListQuery(ctx.org, ctx.type), staleTime: 0 }),
    ) as Promise<StreamRow[] | null>;

  const fetchFirstRecord = async (
    ctx: PollContext,
    stream: string,
    fromUs: number,
  ): Promise<Record<string, unknown> | undefined> => {
    const hits = await runSql(ctx, firstRecordSql(stream, fromUs, ctx.filter), {
      startUs: fromUs,
      endUs: fromUs + QUARTER_HOUR_US,
    });
    return hits?.[0] ?? undefined;
  };

  const selectedOrg = (): string | undefined => store.state.selectedOrganization?.identifier;

  // Pages read the name list and the store, which may still hold the empty list from before the first record.
  const refreshStreamLists = async (ctx: PollContext) => {
    if (ctx.org !== selectedOrg()) return;
    // a failed refresh leaves the cached list; the page's own next read refetches it
    const list = await fetchOrNull(async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: streamKeys.nameList(ctx.org, ctx.type),
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: streamKeys.pagesAll(ctx.org) }),
      ]);
      return queryClient.fetchQuery(streamNameListQuery(ctx.org, ctx.type));
    });
    // the Vuex stream store holds the selected org's lists only, so a late answer for another org stays out
    if (!list || stale(ctx) || ctx.org !== selectedOrg()) return;
    setStreams(ctx.type, list);
  };

  const receive = async (ctx: PollContext, stream: string, c: Confirmation, sinceUs?: number) => {
    const record = c.tsUs > 0 ? await fetchFirstRecord(ctx, stream, c.tsUs) : undefined;
    if (stale(ctx)) return;
    await refreshStreamLists(ctx);
    if (stale(ctx)) return;
    const recordUs = Number(record?._timestamp ?? c.tsUs);
    const range = recordRange(recordUs > 0 ? recordUs : nowMs() * 1000);
    result.value = {
      streamName: stream,
      streamType: ctx.type,
      count: c.count,
      firstRecord: record,
      firstRecordUs: recordUs > 0 ? recordUs : undefined,
      rangeStart: range.startUs,
      rangeEnd: range.endUs,
      sinceUs,
    };
    state.value = "received";
    markDetectionSeen(ctx.org);
    halt();
  };

  const probeTarget = async (ctx: PollContext, name: string) => {
    const t = target.value;
    if (t.existed === undefined) {
      const row = await findTarget(ctx, name);
      if (row === undefined || stale(ctx)) return;
      target.value = { existed: !!row };
      if (row) await anchor(ctx, name);
      return;
    }
    if (t.existed) {
      if (t.zoNowUs === undefined) {
        await anchor(ctx, name);
        return;
      }
      const c = await confirmSinceAnchor(ctx, name);
      if (c && !stale(ctx)) await receive(ctx, name, c, t.zoNowUs);
      return;
    }
    const row = await findTarget(ctx, name);
    if (!row || stale(ctx)) return;
    const c = await confirmNewStream(ctx, row, true);
    if (c && !stale(ctx)) await receive(ctx, name, c);
  };

  const confirmPending = async (
    ctx: PollContext,
    pending: Map<string, StreamRow>,
    trustStats: boolean,
  ): Promise<boolean> => {
    for (const row of pending.values()) {
      const c = await confirmNewStream(ctx, row, trustStats);
      if (stale(ctx)) return true;
      if (c) {
        await receive(ctx, row.name, c);
        return true;
      }
    }
    return false;
  };

  // Stats lag the ingester and also move on back-dated samples, so owed matches and the rotation take turns and none starves.
  const nextOtherMatch = (seen: StreamRow[]): string | undefined => {
    const busiest = target.value.matches?.[0];
    const others = (target.value.matches ?? []).filter((n) => n !== busiest);
    if (!others.length) return undefined;
    for (const r of seen) {
      if (!others.includes(r.name) || matchStats.get(r.name) === statsKey(r)) continue;
      matchStats.set(r.name, statsKey(r));
      owed.add(r.name);
    }
    lastFromOwed = owed.size > 0 && !lastFromOwed;
    const next = lastFromOwed ? [...owed][0] : others[rotation++ % others.length];
    owed.delete(next);
    return next;
  };

  /** At most two COUNTs per poll: the busiest existing match, and one other match in turn. */
  const confirmExistingMatches = async (ctx: PollContext, seen: StreamRow[]) => {
    const busiest = target.value.matches?.[0];
    if (!busiest) return;
    const other = nextOtherMatch(seen);
    for (const stream of other ? [busiest, other] : [busiest]) {
      const c = await confirmSinceAnchor(ctx, stream);
      if (stale(ctx)) return;
      if (c) {
        await receive(ctx, stream, c, target.value.zoNowUs);
        return;
      }
    }
  };

  // A keyword source fans out into many streams: a new match counts, and so do new records in any existing one.
  const probeKeyword = async (ctx: PollContext, keyword: string) => {
    const t = target.value;
    if (t.baseline === undefined) {
      const found = await listMatches(ctx, keyword);
      if (!found || stale(ctx)) return;
      const matches = newestFirst(found.rows);
      for (const row of matches) matchStats.set(row.name, statsKey(row));
      target.value = {
        existed: matches.length > 0,
        baseline: new Set(matches.map((s) => s.name)),
        baselineTotal: found.total,
        matches: matches.map((s) => s.name),
      };
      if (matches.length) await anchor(ctx, matches[0].name);
      return;
    }
    const pending = candidates[ctx.type] ?? new Map<string, StreamRow>();
    candidates[ctx.type] = pending;
    const first = await probePage(ctx, keyword, 0);
    if (!first || stale(ctx)) return;
    let seen = first.list as StreamRow[];
    let fresh = false;
    if (first.total !== t.baselineTotal) {
      const found = await listMatches(ctx, keyword);
      if (!found || stale(ctx)) return;
      target.value = { ...target.value, baselineTotal: found.total };
      for (const row of found.rows) if (!t.baseline.has(row.name)) pending.set(row.name, row);
      seen = found.rows;
      fresh = true;
    }
    if (await confirmPending(ctx, pending, fresh)) return;
    if (!t.existed || !t.matches?.length) return;
    if (target.value.zoNowUs === undefined) {
      await anchor(ctx, t.matches[0]);
      return;
    }
    await confirmExistingMatches(ctx, seen);
  };

  const probeType = async (ctx: PollContext) => {
    const type = ctx.type;
    const res = await fetchOrNull(() => queryClient.fetchQuery(streamProbeQuery(ctx.org, type)));
    if (!res || stale(ctx)) return;
    const known = snapshots[type];
    if (!known) {
      if (res.total === 0) {
        snapshots[type] = { total: 0, names: new Set() };
        return;
      }
      const list = await freshTypeList(ctx);
      if (list && !stale(ctx)) {
        snapshots[type] = { total: res.total, names: new Set(list.map((s) => s.name)) };
      }
      return;
    }
    const pending = candidates[type] ?? new Map<string, StreamRow>();
    candidates[type] = pending;
    let fresh = false;
    if (res.total !== known.total) {
      const list = await freshTypeList(ctx);
      if (!list || stale(ctx)) return;
      known.total = res.total;
      for (const s of list) {
        if (!known.names.has(s.name) && isUserDataStream(s.name, s.stream_type ?? type)) {
          pending.set(s.name, s);
        }
      }
      fresh = true;
    }
    await confirmPending(ctx, pending, fresh);
  };

  const poll = async () => {
    if (!running || pollingGen === generation) return;
    const gen = generation;
    pollingGen = gen;
    try {
      const name = targetName.value;
      const keyword = keywordMatch.value;
      for (const type of watchedTypes.value) {
        const ctx: PollContext = { gen, org: org.value, type, filter: filter.value };
        if (stale(ctx) || state.value === "received") break;
        if (name && keyword) await probeKeyword(ctx, name);
        else if (name) await probeTarget(ctx, name);
        else await probeType(ctx);
      }
    } finally {
      if (pollingGen === gen) pollingGen = undefined;
    }
  };

  // a function, so TS does not carry the narrowing across the await below
  const received = () => state.value === "received";

  // a failed or untracked read keeps the bar waiting; only a user-pressed check says no cause can be named
  const markUnavailable = (trigger: DiagnosisTrigger, gen: number) => {
    if (
      trigger !== "troubleshoot" ||
      gen !== generation ||
      (diagnosis.value && diagnosis.value.form !== "unavailable")
    ) {
      return;
    }
    diagnosisTrigger = diagnosisTrigger ?? "troubleshoot";
    diagnosis.value = { form: "unavailable", trigger: "troubleshoot", rejections: [] };
  };

  const readRejections = async (trigger: DiagnosisTrigger) => {
    if (rejectionsGen === generation || received()) return;
    const ctx = { gen: generation };
    rejectionsGen = ctx.gen;
    troubleshooting.value = trigger === "troubleshoot";
    lastRejectionsReadMs = nowMs();
    try {
      const { tracked, list } = await queryClient.fetchQuery(
        recentRejectionsQuery(org.value, store.state.API_ENDPOINT),
      );
      if (stale(ctx) || received()) return;
      if (!tracked) {
        untracked = true;
        // an untracked org never stores a rejection, so an earlier named cause is stale, unlike after a failed read
        if (state.value === "rejected" || state.value === "no-requests") {
          state.value = "waiting";
          diagnosis.value = undefined;
        }
        markUnavailable(trigger, ctx.gen);
        return;
      }
      diagnosisTrigger = diagnosisTrigger ?? trigger;
      const form = list.length ? "rejected" : "no-requests";
      diagnosis.value = { form, trigger: diagnosisTrigger, rejections: list };
      state.value = form;
    } catch {
      markUnavailable(trigger, ctx.gen);
    } finally {
      if (rejectionsGen === ctx.gen) {
        rejectionsGen = undefined;
        troubleshooting.value = false;
      }
    }
  };

  const rejectionsDue = (): boolean => {
    if (lastRejectionsReadMs === undefined) return elapsedMs() >= FIRST_EVENT_BUDGET.diagnosisAtMs;
    return nowMs() - lastRejectionsReadMs >= FIRST_EVENT_BUDGET.rejectionsEveryMs;
  };

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (delayMs?: number) => {
    clearTimer();
    if (!running) return;
    const cadence = cadenceAt(elapsedMs());
    if (cadence === null) {
      finish();
      return;
    }
    timer = setTimeout(tick, delayMs ?? cadence);
  };

  async function tick() {
    timer = undefined;
    if (!running) return;
    if (cadenceAt(elapsedMs()) === null) {
      finish();
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      pausedWhileHidden = true;
      return;
    }
    const gen = generation;
    await poll();
    if (gen !== generation) return;
    if (running && state.value !== "received" && autoDiagnosis() && !untracked && rejectionsDue()) {
      await readRejections("auto");
    }
    if (gen === generation) schedule();
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible" || !pausedWhileHidden || !running) return;
    pausedWhileHidden = false;
    schedule(0);
  };

  function halt() {
    running = false;
    clearTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  }

  function finish() {
    halt();
    if (state.value !== "received") state.value = "stopped";
  }

  const resetWatch = () => {
    snapshots = {};
    candidates = {};
    schemaReady = new Set();
    matchStats = new Map();
    owed = new Set();
    rotation = 0;
    lastFromOwed = false;
    target.value = {};
    result.value = undefined;
    diagnosis.value = undefined;
    diagnosisTrigger = undefined;
    lastRejectionsReadMs = undefined;
    untracked = false;
    troubleshooting.value = false;
    state.value = "waiting";
  };

  /** Starts the watch on page open, or restarts the fast cadence after a copy. */
  const start = (reason: "copy" | "open") => {
    if (state.value === "received") return;
    if (running) {
      if (reason === "copy") {
        untracked = false;
        startedAtMs.value = nowMs();
        schedule(FIRST_EVENT_BUDGET.fastMs);
      }
      return;
    }
    running = true;
    pausedWhileHidden = false;
    startedAtMs.value = nowMs();
    // a restart is a new watch: its first automatic read waits the full diagnosisAtMs again
    lastRejectionsReadMs = undefined;
    untracked = false;
    diagnosisTrigger = undefined;
    if (state.value === "stopped") {
      state.value = "waiting";
      diagnosis.value = undefined;
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    schedule(0);
  };

  const stop = () => halt();

  const probeNow = async () => {
    if (!running) return;
    await poll();
  };

  /** The user-pressed shortcut to the diagnosis; the automatic read at diagnosisAtMs stays. */
  const troubleshoot = async () => {
    if (!running || state.value !== "waiting") return;
    await readRejections("troubleshoot");
  };

  // sync, so the generation moves before any in-flight answer for the old configuration can land
  watch(
    [org, () => signal?.value, targetName, filter, keywordMatch],
    () => {
      const wasRunning = running;
      generation++;
      halt();
      resetWatch();
      if (wasRunning) start("open");
    },
    { flush: "sync" },
  );

  onScopeDispose(halt);

  return {
    state,
    result,
    diagnosis,
    startedAtMs,
    scope,
    troubleshooting,
    sinceUs: computed(() => target.value.zoNowUs),
    start,
    stop,
    probeNow,
    troubleshoot,
  };
}

export default useFirstEventWatch;
