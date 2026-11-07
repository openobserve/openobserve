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

import { isAssistantV2 } from "@/composables/assistant/flags";

/** Home's own per-user, per-device records; the key hashes `email:org` so no address sits in storage. */
export const LAST_VISIT_PREFIX = "o2.home.lastVisit:";

export const RECENT_DASHBOARDS_PREFIX = "o2.home.recentDashboards:";

/** Home keeps only this many dashboards. */
export const RECENT_DASHBOARDS_CAP = 4;

/** A dashboard seen on this device, newest first. */
export interface RecentDashboard {
  dashboardId: string;
  folderId: string;
  title: string;
  /** Milliseconds. */
  at: number;
}

/** djb2 of `email:org`, so the key is stable without the async digest the assistant uses. */
export function homeUserKey(email: string, org: string): string {
  const raw = `${email}:${org}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = (((hash << 5) + hash) ^ raw.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** The last time this user left Home in this org on this device, or null on the first visit. */
export function readLastVisit(userKey: string): number | null {
  const value = Number(safeGet(LAST_VISIT_PREFIX + userKey));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function writeLastVisit(userKey: string, at: number): void {
  safeSet(LAST_VISIT_PREFIX + userKey, String(at));
}

export function readRecentDashboards(userKey: string): RecentDashboard[] {
  try {
    const parsed: unknown = JSON.parse(safeGet(RECENT_DASHBOARDS_PREFIX + userKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentDashboard) : [];
  } catch {
    return [];
  }
}

/** Moves the dashboard to the front, dropping the oldest past the cap. */
export function recordRecentDashboard(userKey: string, entry: RecentDashboard): RecentDashboard[] {
  const rest = readRecentDashboards(userKey).filter((d) => d.dashboardId !== entry.dashboardId);
  const next = [entry, ...rest].slice(0, RECENT_DASHBOARDS_CAP);
  safeSet(RECENT_DASHBOARDS_PREFIX + userKey, JSON.stringify(next));
  return next;
}

/** Called by the dashboard page on every load, so Home lists what this user opened here. */
export function noteDashboardVisit(
  email: string | undefined,
  org: string | undefined,
  dashboard: { dashboardId?: unknown; title?: unknown },
  folderId: string,
): void {
  if (!isAssistantV2() || !email || !org || typeof dashboard.dashboardId !== "string") return;
  const title = typeof dashboard.title === "string" ? dashboard.title : dashboard.dashboardId;
  recordRecentDashboard(homeUserKey(email, org), {
    dashboardId: dashboard.dashboardId,
    folderId,
    title,
    at: Date.now(),
  });
}

function isRecentDashboard(value: unknown): value is RecentDashboard {
  const v = value as Partial<RecentDashboard> | null;
  return (
    !!v &&
    typeof v.dashboardId === "string" &&
    typeof v.folderId === "string" &&
    typeof v.title === "string" &&
    typeof v.at === "number"
  );
}

// A private window or a full quota throws on storage; Home then simply has nothing to compare.
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the record is best effort */
  }
}
