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

import { createRecordConverter, type RecordConverter } from "@/utils/rum/sessionReplayChangeFormat";
import { isSkipMarker } from "@/utils/rum/sessionReplayTimeline";

const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const META = 4;
const CUSTOM = 5;
const FOCUS = 6;
const VIEW_END = 7;
// A successor view in the same tab snapshots within milliseconds of the old view ending.
const HANDOVER_GRACE_MS = 1000;
const SOURCE_MOUSE_MOVE = 1;
const SOURCE_MOUSE_INTERACTION = 2;
// MouseDown, Click, ContextMenu, DblClick, TouchStart: a page cannot produce these without a person.
const PRESENCE_INTERACTIONS = new Set([1, 2, 3, 4, 7]);
// Scroll, Input and TouchMove are also recorded for programmatic changes, so they count only in a focused view.
const FOCUSED_ONLY_SOURCES = new Set([3, 5, 6]);
const ALL_VIEWS = "\u0000all";

export const LOADED_THROUGH_TAG = "oo-loaded-through";

export type SwitchReason = "snapshot" | "focus" | "activity" | "handover" | "missing";

export interface ReplaySwitch {
  at: number;
  viewId: string;
  reason: SwitchReason;
  rebuilt: boolean;
  fromEnded: boolean;
  href?: string;
}

export interface StaleSpan {
  viewId: string;
  from: number;
  to: number | null;
}

export interface DecodeResult {
  events: any[];
  skippedRecords: number;
}

export interface MultiViewDecoder {
  push(segments: any[], watermark: number): DecodeResult;
  switches(): ReplaySwitch[];
  staleSpans(): StaleSpan[];
  concurrent(): boolean;
}

interface ViewTrack {
  viewId: string;
  converter: RecordConverter | null;
  preamble: any[];
  lastMeta: any | null;
  lastMouse: any | null;
  focused: boolean | null;
  hasSnapshot: boolean;
  ended: boolean;
  lastIndex: number | null;
  openStale: StaleSpan | null;
  rebuilt: { version: number; data: any } | null;
  lastSeenAt: number;
}

type QueueItem =
  | {
      kind: "record";
      at: number;
      record: any;
      segmentStart: number;
      index: number | null;
      first: boolean;
    }
  | { kind: "skip"; at: number };

interface Queue {
  items: QueueItem[];
  head: number;
}

/** The page view a stored segment body belongs to; bodies without one share the "" view. */
export function viewIdOf(segment: any): string {
  const id = segment?.view?.id;
  return typeof id === "string" ? id : "";
}

function presenceReason(view: ViewTrack, record: any): SwitchReason | null {
  if (record?.type === FOCUS) return record.data?.has_focus === true ? "focus" : null;
  if (record?.type !== INCREMENTAL) return null;
  const source = record.data?.source;
  if (source === SOURCE_MOUSE_INTERACTION) {
    return PRESENCE_INTERACTIONS.has(record.data?.type) ? "activity" : null;
  }
  return FOCUSED_ONLY_SOURCES.has(source) && view.focused === true ? "activity" : null;
}

// A ViewEnd sorts before a tie so the next view in the same tab hands over instead of looking concurrent.
function priorityOf(item: QueueItem): number {
  return item.kind === "record" && item.record?.type === VIEW_END ? 0 : 1;
}

export function createMultiViewDecoder(): MultiViewDecoder {
  const views = new Map<string, ViewTrack>();
  const queues = new Map<string, Queue>();
  const switchLog: ReplaySwitch[] = [];
  const stale: StaleSpan[] = [];
  let active: string | null = null;
  let pendingHandOver: { at: number } | null = null;
  let sawConcurrent = false;
  let clockStarted = false;
  let lastClock = -Infinity;
  let lastDecodedAt = -Infinity;

  function viewFor(viewId: string): ViewTrack {
    let view = views.get(viewId);
    if (!view) {
      const converter = createRecordConverter();
      // Change records before this view's own full snapshot decode against nothing.
      converter.markStale();
      view = {
        viewId,
        converter,
        preamble: [],
        lastMeta: null,
        lastMouse: null,
        focused: null,
        hasSnapshot: false,
        ended: false,
        lastIndex: null,
        openStale: null,
        rebuilt: null,
        lastSeenAt: -Infinity,
      };
      views.set(viewId, view);
    }
    return view;
  }

  function enqueue(key: string, item: QueueItem) {
    let queue = queues.get(key);
    if (!queue) {
      queue = { items: [], head: 0 };
      queues.set(key, queue);
    }
    queue.items.push(item);
  }

  function nextKey(watermark: number): string | null {
    let bestKey: string | null = null;
    let bestAt = Infinity;
    let bestPriority = 2;
    for (const [key, queue] of queues) {
      const item = queue.items[queue.head];
      if (!item || !(item.at < watermark)) continue;
      const priority = priorityOf(item);
      if (item.at < bestAt || (item.at === bestAt && priority < bestPriority)) {
        bestKey = key;
        bestAt = item.at;
        bestPriority = priority;
      }
    }
    return bestKey;
  }

  function take(key: string): QueueItem {
    const queue = queues.get(key)!;
    const item = queue.items[queue.head++];
    if (queue.head > 1024 && queue.head * 2 > queue.items.length) {
      queue.items = queue.items.slice(queue.head);
      queue.head = 0;
    }
    return item;
  }

  function openStale(view: ViewTrack, at: number) {
    view.converter?.markStale();
    if (view.openStale) return;
    view.openStale = { viewId: view.viewId, from: at, to: null };
    stale.push(view.openStale);
  }

  function closeStale(view: ViewTrack, at: number) {
    if (!view.openStale) return;
    view.openStale.to = at;
    view.openStale = null;
  }

  function activate(view: ViewTrack, at: number, reason: SwitchReason, rebuilt: boolean) {
    const previous = active === null ? null : views.get(active);
    const fromEnded = !previous || previous.ended;
    if (!fromEnded) sawConcurrent = true;
    active = view.viewId;
    pendingHandOver = null;
    switchLog.push({
      at,
      viewId: view.viewId,
      reason,
      rebuilt,
      fromEnded,
      href: view.lastMeta?.data?.href,
    });
  }

  function rebuild(view: ViewTrack, at: number, reason: SwitchReason): any[] {
    const converter = view.converter!;
    const version = converter.version();
    let data = view.rebuilt && view.rebuilt.version === version ? view.rebuilt.data : null;
    if (!data) {
      data = converter.snapshot();
      if (!data) return [];
      view.rebuilt = { version, data };
    }
    activate(view, at, reason, true);
    const events: any[] = [];
    if (view.lastMeta) events.push({ ...view.lastMeta, timestamp: at });
    events.push({ type: FULL_SNAPSHOT, timestamp: at, data });
    if (view.lastMouse) {
      const positions = (view.lastMouse.data?.positions ?? []).map((p: any) => ({
        ...p,
        timeOffset: 0,
      }));
      events.push({
        ...view.lastMouse,
        timestamp: at,
        data: { ...view.lastMouse.data, positions },
      });
    }
    return events;
  }

  // The shown view ended without a successor taking over, so the most recently used open view continues.
  function handOver(at: number): any[] {
    let next: ViewTrack | null = null;
    for (const candidate of views.values()) {
      if (candidate.ended || !candidate.hasSnapshot || !candidate.converter) continue;
      if (!next || candidate.lastSeenAt > next.lastSeenAt) next = candidate;
    }
    return next ? rebuild(next, at, "handover") : [];
  }

  function resolveHandOver(at: number): any[] {
    pendingHandOver = null;
    return handOver(at);
  }

  function logMissing(view: ViewTrack, at: number) {
    const last = switchLog[switchLog.length - 1];
    if (last && last.reason === "missing" && last.viewId === view.viewId) return;
    switchLog.push({
      at,
      viewId: view.viewId,
      reason: "missing",
      rebuilt: false,
      fromEnded: false,
      href: view.lastMeta?.data?.href,
    });
  }

  function checkIndex(view: ViewTrack, item: Extract<QueueItem, { kind: "record" }>) {
    if (!item.first || item.index === null) return;
    if (view.lastIndex !== null && item.index > view.lastIndex + 1)
      openStale(view, item.segmentStart);
    view.lastIndex = item.index;
  }

  function onPresence(view: ViewTrack, record: any, out: any[]) {
    const reason = presenceReason(view, record);
    if (!reason) return;
    view.lastSeenAt = record.timestamp;
    if (view.viewId === active) return;
    if (view.hasSnapshot) out.push(...rebuild(view, record.timestamp, reason));
    else if (active !== null && record.type !== FOCUS) logMissing(view, record.timestamp);
  }

  function onSnapshot(view: ViewTrack, at: number, out: any[]) {
    view.hasSnapshot = true;
    view.rebuilt = null;
    view.lastSeenAt = at;
    closeStale(view, at);
    const current = active === null ? null : views.get(active);
    const takesOver = view.focused !== false || !current || current.ended;
    if (view.viewId !== active && takesOver) {
      activate(view, at, "snapshot", false);
      out.push(...view.preamble);
    }
    view.preamble = [];
  }

  function step(view: ViewTrack, item: Extract<QueueItem, { kind: "record" }>, out: any[]): number {
    const converter = view.converter;
    if (view.ended || !converter) return 0;
    checkIndex(view, item);
    const { record } = item;
    // The rebuild must come before the trigger is decoded, or its removals apply to a tree that already lost them.
    onPresence(view, record, out);
    if (record?.type === FOCUS) view.focused = record.data?.has_focus === true;
    let converted: any[];
    try {
      converted = converter.convert(record);
    } catch (error) {
      console.error("Session replay: skipped an unconvertible record", error);
      return 1;
    }
    if (record?.type === META) view.lastMeta = record;
    if (record?.type === INCREMENTAL && record.data?.source === SOURCE_MOUSE_MOVE)
      view.lastMouse = record;
    if (converted.some((r) => r?.type === FULL_SNAPSHOT)) onSnapshot(view, record.timestamp, out);
    if (view.viewId === active) out.push(...converted);
    else if (!view.hasSnapshot) view.preamble.push(...converted);
    if (record?.type === VIEW_END) {
      view.ended = true;
      view.converter = null;
      view.preamble = [];
      view.rebuilt = null;
      if (view.viewId === active) pendingHandOver = { at: record.timestamp };
    }
    return 0;
  }

  function enqueueSegments(segments: any[]): number {
    let earliest = Infinity;
    for (const segment of segments ?? []) {
      const start = Number(segment?.start);
      if (isSkipMarker(segment)) {
        const viewId = (segment as any).viewId;
        enqueue(typeof viewId === "string" ? viewId : ALL_VIEWS, { kind: "skip", at: start || 0 });
        if (start < earliest) earliest = start;
        continue;
      }
      const viewId = viewIdOf(segment);
      viewFor(viewId);
      const rawIndex = Number(segment?.index_in_view);
      const index = Number.isFinite(rawIndex) ? rawIndex : null;
      const records: any[] = segment?.records ?? [];
      const segmentStart = Number.isFinite(start) ? start : Number(records[0]?.timestamp) || 0;
      if (records.length && segmentStart < earliest) earliest = segmentStart;
      records.forEach((record, i) =>
        enqueue(viewId, {
          kind: "record",
          at: Number(record?.timestamp) || 0,
          record,
          segmentStart,
          index,
          first: i === 0,
        }),
      );
    }
    return earliest;
  }

  function clock(timestamp: number) {
    return { type: CUSTOM, timestamp, data: { tag: LOADED_THROUGH_TAG, payload: {} } };
  }

  // rrweb's start, end and total time come from its events, so they must follow the data, not just the shown view.
  function addClock(out: any[], earliest: number, watermark: number) {
    const firstEmitted = out.length ? out[0].timestamp : Infinity;
    if (!clockStarted && Number.isFinite(earliest)) {
      clockStarted = true;
      if (earliest < firstEmitted) out.unshift(clock(earliest));
    }
    const through = Number.isFinite(watermark) ? watermark - 1 : lastDecodedAt;
    const lastEmitted = out.length ? out[out.length - 1].timestamp : -Infinity;
    if (Number.isFinite(through) && through > lastClock && through > lastEmitted && clockStarted) {
      out.push(clock(through));
      lastClock = through;
    }
  }

  function push(segments: any[], watermark: number): DecodeResult {
    const earliest = enqueueSegments(segments);
    const out: any[] = [];
    let skippedRecords = 0;
    for (let key = nextKey(watermark); key !== null; key = nextKey(watermark)) {
      const item = take(key);
      if (pendingHandOver && item.at > pendingHandOver.at + HANDOVER_GRACE_MS)
        out.push(...resolveHandOver(item.at));
      if (item.at > lastDecodedAt) lastDecodedAt = item.at;
      if (item.kind === "skip") {
        if (key === ALL_VIEWS) views.forEach((view) => openStale(view, item.at));
        else openStale(viewFor(key), item.at);
        continue;
      }
      skippedRecords += step(viewFor(key), item, out);
    }
    if (pendingHandOver && watermark === Infinity) out.push(...resolveHandOver(pendingHandOver.at));
    addClock(out, earliest, watermark);
    return { events: out, skippedRecords };
  }

  return {
    push,
    switches: () => switchLog.slice(),
    staleSpans: () => stale.map((span) => ({ ...span })),
    concurrent: () => sawConcurrent,
  };
}
