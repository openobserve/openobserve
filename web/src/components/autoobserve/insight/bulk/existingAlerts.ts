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

import type { RouteLocationRaw } from "vue-router";
import { queryClient } from "@/composables/query/queryClient";
import { alertsListQuery } from "@/services/alerts.queries";

/** An alert the org already has, as the alerts list returns it to this user. */
export interface ExistingAlert {
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  streamType: string;
  streamName: string;
  sql: string | null;
}

/** What identifies a draft against the org's alerts: its name and folder, or its stream and query. */
export interface DraftIdentity {
  name: string;
  folderId: string;
  streamType: string;
  streamName: string;
  sql?: string | null;
}

type Clause = "select" | "from" | "where" | "group" | "having" | "order" | "limit";

// String literals, quoted identifiers, words and operators; the whitespace between them carries nothing.
const TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|[A-Za-z0-9_.$]+|>=|<=|<>|!=|\S/g;
const PLAIN_NAME = /^[a-z_][a-z0-9_$]*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const CLAUSES = new Set<string>(["select", "from", "where", "group", "having", "order", "limit"]);

const canonical = (token: string): string => {
  if (token.startsWith("'")) return token;
  if (token.startsWith('"') || token.startsWith("`")) {
    const name = token.slice(1, -1).replace(/""/g, '"');
    // A quoted name keeps its case; only an all-lower-case one is the same field as the unquoted spelling.
    return PLAIN_NAME.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
  }
  return token.toLowerCase();
};

const tokensOf = (sql: string | null | undefined): string[] =>
  (String(sql ?? "").match(TOKEN) ?? []).map(canonical).filter((t) => t !== ";");

const clausesOf = (tokens: string[]): Partial<Record<Clause, string[]>> => {
  const out: Partial<Record<Clause, string[]>> = {};
  let current: string[] | null = null;
  let depth = 0;
  for (const token of tokens) {
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
    if (depth === 0 && CLAUSES.has(token)) {
      current = out[token as Clause] = [];
    } else if (current && !(token === "by" && current.length === 0)) {
      current.push(token);
    }
  }
  return out;
};

const withoutAliases = (select: string[]): string[] => {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < select.length; i += 1) {
    const token = select[i];
    if (token === "(") depth += 1;
    if (token === ")") depth -= 1;
    if (depth === 0 && token === "as") i += 1;
    else out.push(token);
  }
  return out;
};

/** What the alert fires on: no rows, a p95 or a count above a threshold, whatever the threshold or aliases. */
const signalOf = (c: Partial<Record<Clause, string[]>>): string => {
  const having = (c.having ?? []).join(" ");
  if ([...(c.select ?? []), ...(c.having ?? [])].some((t) => t.includes("percentile"))) {
    return "latency";
  }
  if (/^count \( \* \) (?:= 0|< 1)$/.test(having)) return "no_data";
  if (/^count \( \* \) >=? \S+$/.test(having)) return "count_above";
  const masked = (c.having ?? []).map((t) => (NUMBER.test(t) ? "?" : t));
  return [...withoutAliases(c.select ?? []), "having", ...masked].join(" ");
};

/** The check a query runs: its signal, stream and filter, with aliases, spacing and the threshold set aside. */
export const checkKeyOf = (sql: string | null | undefined): string | null => {
  const c = clausesOf(tokensOf(sql));
  if (!c.select || !c.from) return null;
  return [
    signalOf(c),
    "from",
    ...c.from,
    "where",
    ...(c.where ?? []),
    "group",
    ...(c.group ?? []),
  ].join(" ");
};

const existingOf = (a: any): ExistingAlert => ({
  id: String(a?.alert_id ?? a?.id ?? ""),
  name: String(a?.name ?? ""),
  folderId: String(a?.folder_id ?? ""),
  folderName: String(a?.folder_name ?? a?.folder_id ?? ""),
  streamType: String(a?.stream_type ?? ""),
  streamName: String(a?.stream_name ?? ""),
  sql: a?.condition?.sql ?? a?.query_condition?.sql ?? null,
});

/** Every alert this user can see in the org, read fresh; it throws when the list can't be read. */
export const loadExistingAlerts = async (org: string): Promise<ExistingAlert[]> => {
  const list = await queryClient.fetchQuery({
    ...alertsListQuery(org, "", undefined, undefined, { silentForbidden: true }),
    staleTime: 0,
  });
  return list.map(existingOf).filter((a) => a.id);
};

/** The org's alert this draft would duplicate: same name in the same folder, or the same check on the same stream. */
export const findExisting = (
  alerts: readonly ExistingAlert[],
  draft: DraftIdentity,
): ExistingAlert | null => {
  const check = checkKeyOf(draft.sql);
  return (
    alerts.find((a) => a.name === draft.name && a.folderId === draft.folderId) ??
    (check
      ? (alerts.find(
          (a) =>
            a.streamType === draft.streamType &&
            a.streamName === draft.streamName &&
            checkKeyOf(a.sql) === check,
        ) ?? null)
      : null)
  );
};

/** The alert a draft being saved from the alert form would duplicate; "unread" when the list can't be read. */
export const existingForSave = async (
  org: string,
  alert: { name?: string; stream_type?: string; stream_name?: string; query_condition?: any },
  folderId: string,
): Promise<ExistingAlert | null | "unread"> => {
  const known = await loadExistingAlerts(org).catch(() => null);
  if (!known) return "unread";
  return findExisting(known, {
    name: String(alert.name ?? ""),
    folderId,
    streamType: String(alert.stream_type ?? ""),
    streamName: String(alert.stream_name ?? ""),
    sql: alert.query_condition?.sql ?? null,
  });
};

/** Opens the existing alert in the alert editor. */
export const existingAlertRoute = (org: string, alert: ExistingAlert): RouteLocationRaw => ({
  name: "alertList",
  query: {
    org_identifier: org,
    folder: alert.folderId,
    action: "update",
    alert_id: alert.id,
  },
});
