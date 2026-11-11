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

// A re-measured baseline moves the threshold, so a draft of the same check differs from its alert only there.
const HAVING_NUMBER = /(having\s.*?(?:>=|<=|<>|!=|=|>|<)\s*)-?\d+(?:\.\d+)?\s*$/;

// Odd parts of a split on this are string literals, whose case and spacing are data.
const LITERAL = /('(?:[^']|'')*')/;

const plainSql = (part: string): string =>
  part.toLowerCase().replace(/["`]/g, "").replace(/\s+/g, " ");

/** The query with keyword case, identifier quoting, spacing and the HAVING threshold value set aside. */
export const normalizedSql = (sql: string | null | undefined): string =>
  (sql ?? "")
    .split(LITERAL)
    .map((part, i) => (i % 2 ? part : plainSql(part)))
    .join("")
    .trim()
    .replace(/;$/, "")
    .replace(HAVING_NUMBER, "$1?");

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

/** The org's alert this draft would duplicate: same name in the same folder, or the same stream and query. */
export const findExisting = (
  alerts: readonly ExistingAlert[],
  draft: DraftIdentity,
): ExistingAlert | null => {
  const sql = normalizedSql(draft.sql);
  return (
    alerts.find((a) => a.name === draft.name && a.folderId === draft.folderId) ??
    (sql
      ? (alerts.find(
          (a) =>
            a.streamType === draft.streamType &&
            a.streamName === draft.streamName &&
            normalizedSql(a.sql) === sql,
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
