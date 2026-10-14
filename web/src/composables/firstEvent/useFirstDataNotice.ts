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
import { ref, watch, type InjectionKey, type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { queryClient } from "@/composables/query/queryClient";
import { streamPageQuery, streamProbeQuery, STREAM_PROBE_PAGE } from "@/services/stream.queries";
import analytics from "@/services/product_analytics";
import { USER_DATA_STREAM_TYPES, isUserDataStream } from "@/utils/internalStreams";
import { rangeRoute, recordRange, type TimeWindowUs } from "./confirmQuery";

const MAX_PAGES_PER_TYPE = 5;

/** MainLayout owns the notice; a page with its own header and totals (Home) renders it below that header. */
export const FIRST_DATA_NOTICE: InjectionKey<ReturnType<typeof useFirstDataNotice>> =
  Symbol("firstDataNotice");

/** Per-org record in localStorage; `hadData` false means the last visit saw no user data. */
export interface FirstDataRecord {
  lastVisit: number;
  hadData: boolean;
  shown?: boolean;
  dismissed?: boolean;
  seenDetection?: boolean;
}

export interface FirstDataStream {
  name: string;
  streamType: string;
  /** Microseconds. */
  createdAt: number;
  docTimeMin: number;
}

/** The stream-list row fields the notice reads. */
export interface ListedStream {
  name?: string;
  stream_type?: string;
  stats?: { created_at?: number; doc_time_min?: number };
}

/** A stream list tagged with the org it was read for, so an org switch never reads another org's rows. */
export interface OrgStreamList {
  org: string;
  list: ListedStream[];
}

export const firstDataStorageKey = (org: string) => `o2.onboarding.firstData.${org}`;

export function readFirstDataRecord(org: string): FirstDataRecord | null {
  try {
    const raw = localStorage.getItem(firstDataStorageKey(org));
    return raw ? (JSON.parse(raw) as FirstDataRecord) : null;
  } catch {
    // unreadable or blocked storage is treated as a first visit
    return null;
  }
}

export function writeFirstDataRecord(org: string, record: FirstDataRecord): void {
  try {
    localStorage.setItem(firstDataStorageKey(org), JSON.stringify(record));
  } catch {
    // storage unavailable: the banner simply never shows
  }
}

/** Called when the setup page's bar turned green, so the next visit never repeats the news. */
export function markDetectionSeen(org: string): void {
  if (!org) return;
  const record = readFirstDataRecord(org) ?? { lastVisit: Date.now(), hadData: false };
  writeFirstDataRecord(org, { ...record, seenDetection: true });
}

const toFirstDataStream = (s: ListedStream): FirstDataStream => ({
  name: s.name ?? "",
  streamType: s.stream_type ?? "logs",
  createdAt: Number(s.stats?.created_at ?? 0),
  docTimeMin: Number(s.stats?.doc_time_min ?? 0),
});

const oldest = (streams: FirstDataStream[]): FirstDataStream | undefined =>
  streams.reduce<FirstDataStream | undefined>(
    (min, s) => (!min || (s.createdAt > 0 && s.createdAt < min.createdAt) ? s : min),
    undefined,
  );

// Until stats flush doc_time_min is 0; created_at is the first batch's earliest record time, so this range holds it.
const sinceCreatedRange = (createdAtUs: number): TimeWindowUs | undefined => {
  if (createdAtUs <= 0) return undefined;
  const { startUs, endUs } = recordRange(createdAtUs);
  return { startUs, endUs: Math.max(endUs, Date.now() * 1000) };
};

/** Shows the next-visit banner once, after a visit that recorded no user data. */
export function useFirstDataNotice(
  org: Ref<string>,
  layoutStreams: Ref<OrgStreamList | undefined>,
) {
  const store = useStore();
  const router = useRouter();

  const visible = ref(false);
  const arrivedAt = ref<number>();
  const stream = ref<FirstDataStream>();
  let evaluatedOrg = "";
  let evaluating = false;

  const flagState = (): "on" | "off" | "unknown" => {
    const cfg = store.state.zoConfig ?? {};
    // the bootstrap config stored at startup has no flag key; only the full config can say it is off
    if (!Object.prototype.hasOwnProperty.call(cfg, "restricted_routes_on_empty_data")) {
      return "unknown";
    }
    return cfg.restricted_routes_on_empty_data === true ? "on" : "off";
  };

  // Flag off: three limit-1 probes, then at most five 20-row pages per type until a user stream turns up.
  const probeUserStreams = async (orgId: string): Promise<FirstDataStream[] | null> => {
    const found: FirstDataStream[] = [];
    for (const type of USER_DATA_STREAM_TYPES) {
      const total = await queryClient
        .fetchQuery(streamProbeQuery(orgId, type))
        .then((r) => r.total)
        .catch(() => null);
      if (total === null) return null;
      for (let page = 0; page < MAX_PAGES_PER_TYPE && page * STREAM_PROBE_PAGE < total; page++) {
        const res = await queryClient
          .fetchQuery(
            streamPageQuery(orgId, type, {
              offset: page * STREAM_PROBE_PAGE,
              limit: STREAM_PROBE_PAGE,
            }),
          )
          .catch(() => null);
        if (!res) return null;
        const users = (res.list as ListedStream[]).filter((s) =>
          isUserDataStream(s?.name ?? "", s?.stream_type ?? type),
        );
        if (users.length) {
          found.push(...users.map(toFirstDataStream));
          break;
        }
      }
    }
    return found;
  };

  const evaluate = async (orgId: string, source: FirstDataStream[] | null) => {
    if (source === null) return;
    evaluatedOrg = orgId;
    const now = Date.now();
    const record = readFirstDataRecord(orgId);
    const hasData = source.length > 0;
    if (!record) {
      writeFirstDataRecord(orgId, { lastVisit: now, hadData: hasData });
      return;
    }
    if (record.hadData) {
      writeFirstDataRecord(orgId, { ...record, lastVisit: now });
      return;
    }
    const next: FirstDataRecord = { ...record, lastVisit: now, hadData: hasData };
    if (hasData && !record.shown && !record.dismissed && !record.seenDetection) {
      const first = oldest(source);
      stream.value = first;
      // created_at is the first record's own time, so a back-dated or future-dated batch is held to the span it arrived in
      arrivedAt.value = first?.createdAt
        ? Math.min(Math.max(first.createdAt, (record.lastVisit || 0) * 1000), now * 1000)
        : undefined;
      visible.value = true;
      next.shown = true;
      analytics.track("first_data_notice_shown", { stream_type: first?.streamType ?? "logs" });
    }
    writeFirstDataRecord(orgId, next);
  };

  const run = async () => {
    const orgId = org.value;
    if (!orgId || evaluating || evaluatedOrg === orgId) return;
    const record = readFirstDataRecord(orgId);
    if (record?.hadData) {
      evaluatedOrg = orgId;
      writeFirstDataRecord(orgId, { ...record, lastVisit: Date.now() });
      return;
    }
    const flag = flagState();
    if (flag === "unknown") return;
    if (flag === "on") {
      const listed = layoutStreams.value;
      if (listed?.org !== orgId) return;
      const users = listed.list
        .filter((s: ListedStream) => isUserDataStream(s?.name ?? "", s?.stream_type ?? ""))
        .map(toFirstDataStream);
      await evaluate(orgId, users);
      return;
    }
    evaluating = true;
    try {
      await evaluate(orgId, await probeUserStreams(orgId));
    } finally {
      evaluating = false;
    }
  };

  watch(org, () => {
    visible.value = false;
    stream.value = undefined;
  });
  watch([org, layoutStreams, () => flagState()], () => void run(), { immediate: true });

  const dismiss = () => {
    visible.value = false;
    const orgId = org.value;
    const record = readFirstDataRecord(orgId);
    if (record) writeFirstDataRecord(orgId, { ...record, dismissed: true });
  };

  const open = () => {
    const s = stream.value;
    visible.value = false;
    if (!s) return;
    const range = s.docTimeMin > 0 ? recordRange(s.docTimeMin) : sinceCreatedRange(s.createdAt);
    router.push(rangeRoute(org.value, s.streamType, s.name, range)).catch(() => {});
  };

  return {
    visible,
    arrivedAt,
    stream,
    open,
    dismiss,
    markDetectionSeen: () => markDetectionSeen(org.value),
  };
}

export default useFirstDataNotice;
