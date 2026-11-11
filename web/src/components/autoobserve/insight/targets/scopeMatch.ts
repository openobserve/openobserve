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

const quoteStream = (name: string): string => `"${name.replace(/"/g, '""')}"`;

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
export const forgetMatches = (): void => known.clear();

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
      const any = await exists(sql.any);
      return any === null ? null : any ? "none" : "quiet";
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

/** Reads each scope's stream fields and asks whether its filter keeps any rows, a few at a time. */
export const probeScopes = async (
  org: string,
  scopes: ServiceScope[],
  readFields: (org: string, stream: ServiceScope["stream"]) => Promise<Fields>,
): Promise<void> => {
  const due = [...new Map(scopes.map((s) => [scopeIdOf(s), s])).values()].filter(
    (s) => !knownMatch(org, s),
  );
  for (let i = 0; i < due.length; i += PROBES_AT_ONCE) {
    await Promise.all(
      due.slice(i, i + PROBES_AT_ONCE).map(async (s) => {
        const fields = s.schema ? null : await readFields(org, s.stream);
        const schema = s.schema ?? fields?.names;
        if (schema) await checkScopeMatch(org, { ...s, schema });
      }),
    );
  }
};
