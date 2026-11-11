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

import { reactive } from "vue";
import { scopeWhereOf, type ServiceScope } from "../bulk/bulkTargets";
import { readHits, type Hit } from "./baseline";

/** Whether a stream's last 7 days hold rows of the service: some, none while others arrived, or no rows at all. */
export type ScopeMatch = "match" | "none" | "quiet";

type Fields = { names: string[]; types: Record<string, string> } | null;

// A week of rows barely changes in minutes, so one answer serves every card and review for a while.
const KEEP_MS = 15 * 60_000;
const PROBES_AT_ONCE = 4;

const known = reactive(new Map<string, { value: ScopeMatch; at: number }>());
const running = new Map<string, Promise<ScopeMatch | null>>();
// Whether a stream had any row, and its fields, are the same for every service on it.
const streamRows = new Map<string, { value: boolean; at: number }>();
const streamFields = new Map<string, { value: NonNullable<Fields>; at: number }>();

// One page-level pool: every probe of every run waits for one of these slots.
let freeSlots = PROBES_AT_ONCE;
const waiting: (() => void)[] = [];
let currentRun: AbortController | null = null;

const quoteStream = (name: string): string => `"${name.replace(/"/g, '""')}"`;

const fresh = <T>(kept: { value: T; at: number } | undefined): T | undefined =>
  kept && Date.now() - kept.at < KEEP_MS ? kept.value : undefined;

const streamKeyOf = (org: string, s: ServiceScope): string =>
  [org, s.stream.type, s.stream.name].join("\n");

const inSlot = async <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T | null> => {
  if (freeSlots > 0) freeSlots -= 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return signal.aborted ? null : await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else freeSlots += 1;
  }
};

/** The stream and service a draft is scoped to, the same before and after its fields are read. */
export const scopeIdOf = (s: ServiceScope): string =>
  [s.stream.type, s.stream.name, s.service, s.cluster ?? "", s.namespace ?? ""].join("\n");

/** Two probes that stop at the first row: one the draft's filter keeps, then any; null when it can't be filtered. */
export const scopeMatchSql = (s: ServiceScope): { filtered: string; any: string } | null => {
  const where = scopeWhereOf(s);
  if (!where) return null;
  const any = `SELECT 1 AS n FROM ${quoteStream(s.stream.name)}`;
  return { filtered: `${any} WHERE ${where} LIMIT 1`, any: `${any} LIMIT 1` };
};

/** The kept answer for a draft's scope, read synchronously by the cards that count drafts. */
export const knownMatch = (org: string, s: ServiceScope): ScopeMatch | undefined => {
  const kept = known.get(`${org}\n${scopeIdOf(s)}`);
  return kept && Date.now() - kept.at < KEEP_MS ? kept.value : undefined;
};

/** Drops every kept answer, so the next read asks again. */
export const forgetMatches = (): void => {
  known.clear();
  streamRows.clear();
  streamFields.clear();
};

/** Stops the page's running probes, queued and in flight; for unmount, leaving the page and an org switch. */
export const cancelProbes = (): void => {
  currentRun?.abort();
  currentRun = null;
};

/** Whether the scope's filter keeps any of the stream's rows over 7 days, on fields already read; null when the read failed. */
export const checkScopeMatch = (
  org: string,
  s: ServiceScope,
  signal?: AbortSignal,
): Promise<ScopeMatch | null> => {
  const kept = knownMatch(org, s);
  if (kept) return Promise.resolve(kept);
  const sql = scopeMatchSql(s);
  if (!sql) return Promise.resolve(null);
  const key = `${org}\n${scopeIdOf(s)}`;
  const pending = running.get(key);
  if (pending && !signal) return pending;
  const end = Date.now() * 1000;
  const exists = (q: string): Promise<boolean | null> =>
    readHits(org, s.stream.type, q, end, signal).then((hits: Hit[] | null) =>
      hits ? hits.length > 0 : null,
    );
  const read = Promise.resolve()
    .then(async (): Promise<ScopeMatch | null> => {
      const matched = await exists(sql.filtered);
      if (matched === null) return null;
      if (matched) return "match";
      const streamKey = streamKeyOf(org, s);
      const any = fresh(streamRows.get(streamKey)) ?? (await exists(sql.any));
      if (any === null) return null;
      streamRows.set(streamKey, { value: any, at: Date.now() });
      return any ? "none" : "quiet";
    })
    .then((value) => {
      if (value) known.set(key, { value, at: Date.now() });
      return value;
    })
    .catch(() => null);
  if (!signal) {
    running.set(key, read);
    void read.finally(() => running.delete(key));
  }
  return read;
};

const fieldsOf = async (
  org: string,
  s: ServiceScope,
  readFields: (org: string, stream: ServiceScope["stream"]) => Promise<Fields>,
  signal: AbortSignal,
): Promise<Fields> => {
  const key = streamKeyOf(org, s);
  const kept = fresh(streamFields.get(key));
  if (kept) return kept;
  const fields = await inSlot(signal, () => readFields(org, s.stream));
  if (fields) streamFields.set(key, { value: fields, at: Date.now() });
  return fields ?? null;
};

/** Reads each stream's fields once and asks whether each scope's filter keeps any rows, 4 at a time page-wide; a new run cancels the last. */
export const probeScopes = async (
  org: string,
  scopes: ServiceScope[],
  readFields: (org: string, stream: ServiceScope["stream"]) => Promise<Fields>,
): Promise<void> => {
  cancelProbes();
  const run = new AbortController();
  currentRun = run;
  const due = [...new Map(scopes.map((s) => [scopeIdOf(s), s])).values()].filter(
    (s) => !knownMatch(org, s),
  );
  const byStream = new Map<string, ServiceScope[]>();
  for (const s of due) {
    const key = streamKeyOf(org, s);
    const group = byStream.get(key);
    if (group) group.push(s);
    else byStream.set(key, [s]);
  }
  await Promise.all(
    [...byStream.values()].map(async (group) => {
      const fields = group.some((s) => !s.schema)
        ? await fieldsOf(org, group[0], readFields, run.signal)
        : null;
      await Promise.all(
        group.map(async (s) => {
          const schema = s.schema ?? fields?.names;
          if (schema && !run.signal.aborted) {
            await inSlot(run.signal, () => checkScopeMatch(org, { ...s, schema }, run.signal));
          }
        }),
      );
    }),
  );
  if (currentRun === run) currentRun = null;
};
