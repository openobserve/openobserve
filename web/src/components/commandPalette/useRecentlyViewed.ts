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

import { computed, ref, watch, type ComputedRef } from "vue";
import { useRoute, type RouteLocationNormalizedLoaded } from "vue-router";
import type { ResourceHit, ResourceKind } from "@/ts/interfaces/resources";
import {
  RECENT_PAGE_ROUTES,
  sanitizeResourceHit,
  type RecentPageRoute,
  type RecentVisit,
} from "./resourceRoutes";

const MAX_VISITS = 20;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
interface VisitScope {
  deployment: string;
  subject: string;
  org: string;
}
export interface RecentVisitScope {
  key: string;
  epoch: number;
  org: string;
  started_at_us: number;
}
interface VisitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class RecentVisitsStore {
  private all = ref<RecentVisit[]>([]);
  readonly items = computed(() => this.all.value.slice(0, 5));
  readonly storageFailed = ref(false);
  private key = "";
  private org = "";
  private epoch = 0;
  private fallback = new Map<string, RecentVisit[]>();
  private memoryOnly = new Set<string>();
  constructor(
    private storage: () => VisitStorage,
    private now: () => number = Date.now,
  ) {}
  select(scope: VisitScope) {
    const key =
      scope.deployment && scope.subject && scope.org
        ? `o2.commandPalette.recent.v2:${encodeURIComponent(scope.deployment)}:${encodeURIComponent(scope.subject)}:${encodeURIComponent(scope.org)}`
        : "";
    if (key === this.key) return;
    this.epoch++;
    this.key = key;
    this.org = scope.org;
    this.all.value = [];
    this.storageFailed.value = false;
    if (!key) {
      this.fallback.clear();
      this.memoryOnly.clear();
      return;
    }
    if (this.memoryOnly.has(key)) {
      this.all.value = this.fresh(this.fallback.get(key) ?? []);
      this.storageFailed.value = true;
      return;
    }
    try {
      const text = this.storage().getItem(key);
      if (text && text.length <= 262144) this.all.value = this.decode(JSON.parse(text));
    } catch {
      this.storageFailed.value = true;
      this.all.value = this.fallback.get(key) ?? [];
    }
    this.all.value = this.fresh(this.all.value);
  }
  capture(): RecentVisitScope | null {
    return this.key
      ? { key: this.key, epoch: this.epoch, org: this.org, started_at_us: this.now() * 1000 }
      : null;
  }
  record(scope: RecentVisitScope | null, value: unknown) {
    if (!this.current(scope)) return;
    const hit = sanitizeResourceHit(value);
    if (!hit) return;
    const visit = {
      kind: hit.type,
      id: hit.id,
      name: hit.name,
      route_ref: hit.route_ref,
      visited_at_us: this.now() * 1000,
    } as RecentVisit;
    this.put(visit);
  }
  recordPage(scope: RecentVisitScope | null, page: RecentPageRoute, name: string) {
    if (!this.current(scope) || !RECENT_PAGE_ROUTES.includes(page) || !name) return;
    this.put({
      kind: "page",
      id: page,
      name,
      route_ref: { page },
      visited_at_us: this.now() * 1000,
    });
  }
  clear() {
    this.all.value = [];
    this.save();
  }
  removeAfterFailure(
    scope: RecentVisitScope | null,
    kind: ResourceKind | "page",
    id: string,
    status: number,
  ) {
    if (!this.current(scope) || (status !== 403 && status !== 404)) return;
    this.all.value = this.all.value.filter(
      (visit) =>
        visit.kind !== kind || visit.id !== id || visit.visited_at_us > scope!.started_at_us,
    );
    this.save();
  }
  private current(scope: RecentVisitScope | null) {
    return !!scope && scope.key === this.key && scope.epoch === this.epoch;
  }
  private put(visit: RecentVisit) {
    this.all.value = [
      visit,
      ...this.fresh(this.all.value).filter((x) => x.kind !== visit.kind || x.id !== visit.id),
    ].slice(0, MAX_VISITS);
    this.save();
  }
  private save() {
    if (!this.key) return;
    this.fallback.set(this.key, this.all.value);
    try {
      this.storage().setItem(this.key, JSON.stringify(this.all.value));
      this.memoryOnly.delete(this.key);
      this.storageFailed.value = false;
    } catch {
      this.memoryOnly.add(this.key);
      this.storageFailed.value = true;
    }
  }
  private fresh(visits: RecentVisit[]) {
    const now = this.now() * 1000;
    return visits
      .filter((v) => v.visited_at_us <= now && v.visited_at_us >= now - MAX_AGE_MS * 1000)
      .slice(0, MAX_VISITS);
  }
  private decode(value: unknown): RecentVisit[] {
    if (!Array.isArray(value)) return [];
    const visits: RecentVisit[] = [];
    for (const raw of value.slice(0, MAX_VISITS)) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (
        !Number.isSafeInteger(row.visited_at_us) ||
        typeof row.name !== "string" ||
        row.name.length > 4096
      )
        continue;
      if (
        row.kind === "page" &&
        typeof row.id === "string" &&
        RECENT_PAGE_ROUTES.includes(row.id as RecentPageRoute)
      ) {
        const page = row.id as RecentPageRoute;
        visits.push({
          kind: "page",
          id: page,
          name: row.name,
          route_ref: { page },
          visited_at_us: row.visited_at_us as number,
        });
        continue;
      }
      const hit = sanitizeResourceHit({
        type: row.kind,
        id: row.id,
        name: row.name,
        route_ref: row.route_ref,
      });
      if (hit)
        visits.push({
          kind: hit.type,
          id: hit.id,
          name: hit.name,
          route_ref: hit.route_ref,
          visited_at_us: row.visited_at_us as number,
        } as RecentVisit);
    }
    return visits;
  }
}

export function resourceFailureStatus(error: unknown): number {
  if (!error || typeof error !== "object" || !("response" in error)) return 0;
  const response = error.response;
  return response &&
    typeof response === "object" &&
    "status" in response &&
    typeof response.status === "number"
    ? response.status
    : 0;
}

let activeRoute: RouteLocationNormalizedLoaded | undefined;
export const isPaletteSavedViewPending = (signal: "logs" | "metrics" | "traces") =>
  activeRoute?.name === signal && typeof activeRoute.query.saved_view_id === "string";
export function recordLoadedStream(
  scope: RecentVisitScope | null,
  streamType: string,
  streamName: string,
) {
  if (
    !activeRoute ||
    !["logs", "metrics", "traces"].includes(streamType) ||
    activeRoute.name !== streamType
  )
    return;
  const selected = activeRoute.query[streamType === "metrics" ? "metric" : "stream"];
  if (selected !== streamName) return;
  if (streamType === "logs" || streamType === "metrics" || streamType === "traces") {
    history.record(scope, {
      type: "stream",
      id: `${streamType}/${streamName}`,
      name: streamName,
      route_ref: { stream_type: streamType, stream_name: streamName },
    });
  }
}

export interface RecentResourceRequest {
  scope: RecentVisitScope | null;
  kind: ResourceKind;
  id: string;
}
export function captureRecentResourceRequest(
  url: string,
  method: string,
): RecentResourceRequest | undefined {
  if (!activeRoute || method.toLowerCase() !== "get") return;
  const scope = history.capture();
  if (!scope) return;
  const route = activeRoute;
  const org = encodeURIComponent(scope.org);
  const query = route.query;
  let target: [ResourceKind, unknown, string] | undefined;
  const detail = (kind: ResourceKind, id: unknown, collection: string, version = "") =>
    [kind, id, `/api/${version}${org}/${collection}/${encodeURIComponent(String(id))}`] as [
      ResourceKind,
      unknown,
      string,
    ];
  if (typeof query.saved_view_id === "string")
    target = detail("saved_view", query.saved_view_id, "savedviews");
  else
    switch (route.name) {
      case "viewDashboard":
        target = detail("dashboard", query.dashboard, "dashboards");
        break;
      case "alertDetail":
        target = detail("alert", route.params.alert_id, "alerts", "v2/");
        break;
      case "synthetic-monitor-results":
        target = detail("synthetic", route.params.id, "synthetics");
        break;
      case "functionList":
        if (query.action === "update") target = ["function", query.name, `/api/${org}/functions`];
        break;
      case "pipelineEditor":
        target = ["pipeline", query.id, `/api/${org}/pipelines`];
        break;
      case "users":
        if (query.action === "update") target = ["user", query.email, `/api/${org}/users`];
        break;
      case "serviceAccounts":
        if (query.action === "update")
          target = ["service_account", query.email, `/api/${org}/service_accounts`];
        break;
      case "logs":
      case "metrics":
      case "traces": {
        const name = query[route.name === "metrics" ? "metric" : "stream"];
        if (typeof name === "string")
          target = [
            "stream",
            `${route.name}/${name}`,
            `/api/${org}/streams/${encodeURIComponent(name)}/schema`,
          ];
        break;
      }
    }
  if (!target || typeof target[1] !== "string") return;
  try {
    const request = new URL(url, "https://local.invalid");
    if (
      request.pathname !== target[2] ||
      (target[0] === "stream" && request.searchParams.get("type") !== route.name)
    )
      return;
    return { scope, kind: target[0], id: target[1] };
  } catch {
    return;
  }
}
export function removeFailedResourceRequest(
  request: RecentResourceRequest | undefined,
  status: number,
) {
  if (request) history.removeAfterFailure(request.scope, request.kind, request.id, status);
}

const history = new RecentVisitsStore(() => window.localStorage);
export const captureRecentVisitScope = () => history.capture();
export const recordResourceVisit = (scope: RecentVisitScope | null, hit: ResourceHit) =>
  history.record(scope, hit);
export const recordPageVisit = (
  scope: RecentVisitScope | null,
  page: RecentPageRoute,
  name: string,
) => history.recordPage(scope, page, name);
export const removeFailedRecentVisit = (
  scope: RecentVisitScope | null,
  kind: ResourceKind | "page",
  id: string,
  status: number,
) => history.removeAfterFailure(scope, kind, id, status);
export function useRecentlyViewed(scope: {
  deployment: ComputedRef<string>;
  subject: ComputedRef<string>;
  org: ComputedRef<string>;
}) {
  activeRoute = useRoute();
  watch(
    () => [scope.deployment.value, scope.subject.value, scope.org.value] as const,
    ([deployment, subject, org]) => history.select({ deployment, subject, org }),
    { immediate: true, flush: "sync" },
  );
  return {
    items: history.items,
    storageFailed: history.storageFailed,
    clear: () => history.clear(),
  };
}
export type { RecentVisit } from "./resourceRoutes";
