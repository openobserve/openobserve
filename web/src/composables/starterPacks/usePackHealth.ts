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

import { ref, shallowRef } from "vue";

import { readQuery } from "@/composables/query/readQuery";
import { streamNameListQuery } from "@/services/stream.queries";

import type { PackStream } from "./packStreams";

export const STALE_AFTER_US = 30 * 60 * 1_000_000;

// Where the type is unknown (a dashboard's streams) every list is read.
const UNTYPED_LOOKUP = ["metrics", "logs", "traces"];

export type StreamHealthState = "receiving" | "stopped" | "never" | "unknown";

export interface StreamHealth extends PackStream {
  state: StreamHealthState;
  /** Microseconds of the newest event; null when none is known. */
  lastUs: number | null;
}

type StreamRow = { name: string; stats?: { doc_time_max?: number } };

/** The newest event of the read streams when none has arrived for 30 minutes; a stream without stats says nothing. */
export const staleSinceUs = (
  rows: Array<{ name: string; stats?: { doc_time_max?: number } }>,
  names: Set<string>,
  nowUs: number,
): number | null => {
  const latest = rows
    .filter(({ name }) => names.has(name))
    .map(({ stats }) => stats?.doc_time_max ?? 0)
    .filter(Boolean);
  if (!latest.length) return null;
  const newest = Math.max(...latest);
  return nowUs - newest >= STALE_AFTER_US ? newest : null;
};

/** The no-data time as the page chip and Pack details both show it, e.g. "12 Nov, 10:27". */
export const staleSinceText = (at: number | null): string =>
  at
    ? new Date(at / 1000).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** One stream's state; a failed list read is Couldn't check, never healthy. An untyped stream takes the type of the list it is found in. */
export const streamHealthOf = (
  stream: PackStream,
  lists: Map<string, StreamRow[] | null>,
  nowUs: number,
): StreamHealth => {
  const types = stream.type ? [stream.type] : UNTYPED_LOOKUP;
  const read = types.map((type) => lists.get(type) ?? null);
  const at = read.findIndex((rows) => rows?.some(({ name }) => name === stream.name));
  const row = at < 0 ? undefined : read[at]!.find(({ name }) => name === stream.name);
  const found = { ...stream, type: stream.type || (at < 0 ? "" : types[at]) };
  const lastUs = row?.stats?.doc_time_max || null;
  if (lastUs) {
    const state = nowUs - lastUs >= STALE_AFTER_US ? "stopped" : "receiving";
    return { ...found, state, lastUs };
  }
  return { ...found, state: read.some((rows) => rows === null) ? "unknown" : "never", lastUs };
};

/** Spellings of one signal are alternatives, so the ones a source never sends drop out once another spelling of that signal reports. */
export const withoutUnusedSignals = (rows: StreamHealth[]): StreamHealth[] => {
  const reporting = new Set(
    rows.flatMap(({ signal, lastUs }) => (signal && lastUs ? [signal] : [])),
  );
  return rows.filter(({ signal, lastUs }) => !signal || lastUs || !reporting.has(signal));
};

/** Pack health from stream stats, since alerts cannot detect missing data themselves. */
export function usePackHealth(org: string) {
  const staleSince = ref<number | null>(null);
  const staleStreams = ref<Set<string>>(new Set());
  /** Per-stream states for the pack page; unlike staleSince these count never-received streams. */
  const streams = shallowRef<StreamHealth[]>([]);

  const check = async (names: string[], type = "metrics") => {
    const rows = await readQuery(streamNameListQuery(org, type)).catch(() => []);
    const nowUs = Date.now() * 1000;
    const wanted = new Set(names);
    staleSince.value = staleSinceUs(rows, wanted, nowUs);
    staleStreams.value = new Set(
      names.filter((name) => staleSinceUs(rows, new Set([name]), nowUs) !== null),
    );
  };

  const checkStreams = async (list: PackStream[], force = false) => {
    const types = [...new Set(list.flatMap(({ type }) => (type ? [type] : UNTYPED_LOOKUP)))];
    const read = await Promise.all(
      types.map(async (type) => {
        const rows = await readQuery(streamNameListQuery(org, type), force).catch(() => null);
        return [type, rows as StreamRow[] | null] as const;
      }),
    );
    const lists = new Map(read);
    const nowUs = Date.now() * 1000;
    streams.value = withoutUnusedSignals(list.map((row) => streamHealthOf(row, lists, nowUs)));
  };

  return { staleSince, staleStreams, streams, check, checkStreams };
}
