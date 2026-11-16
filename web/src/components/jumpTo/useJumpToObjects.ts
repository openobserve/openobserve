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

import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import { firingAlertsQuery } from "@/services/alerts.queries";
import { dashboardsSearchQuery } from "@/services/dashboards.queries";
import { streamNameListQuery } from "@/services/stream.queries";
import { alertEvidenceRoute, type AlertEvidencePage } from "@/utils/alerts/alertEvidenceRoute";
import { escapeSingleQuotes } from "@/utils/queryUtils";
import { pickDashboardPanelStream, restoreLogsSelectedStreams } from "@/utils/streamPersist";
import {
  ACTIONS_AREA_KEY,
  rankObjects,
  type JumpDestination,
  type JumpGroup,
  type JumpObjectKind,
} from "./jumpToDestinations";

/** Rows per object kind before its "Show all" row. */
export const OBJECT_CAP = 5;

const SETTLE_MS = 250;
const DASHBOARD_MIN_CHARS = 2;
const EXPLORE_PERIOD = "15m";
const STREAM_TYPES: AlertEvidencePage[] = ["logs", "metrics", "traces"];

type StreamRow = { name: string; stats?: { doc_num?: number; doc_time_max?: number } };

/**
 * Alerts, dashboards and streams whose name holds the query, then a "Search logs" row. Each kind is
 * read only while its page is in `pages`, from the list query its own page caches.
 */
export function useJumpToObjects(
  query: Ref<string>,
  open: Ref<boolean>,
  pages: ComputedRef<JumpDestination[]>,
): { groups: ComputedRef<JumpGroup[]>; searchable: ComputedRef<boolean> } {
  const { t } = useI18nTyped();
  const router = useRouter();
  const org = useOrgId();

  // The dashboard read is per title, so it waits for typing to settle; the other lists filter locally.
  const settled = ref(query.value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(query, (text) => {
    clearTimeout(timer);
    timer = setTimeout(() => (settled.value = text), SETTLE_MS);
  });
  onScopeDispose(() => clearTimeout(timer));

  const pageByRoute = computed(() => {
    const byName = new Map<string, JumpDestination>();
    for (const page of pages.value) {
      if (page.areaKey === ACTIONS_AREA_KEY) continue;
      let name: unknown;
      try {
        name = router.resolve(page.to).name;
      } catch {
        continue;
      }
      if (typeof name === "string" && !byName.has(name)) byName.set(name, page);
    }
    return byName;
  });
  const page = (name: string) => pageByRoute.value.get(name);
  const readable = (name: string) => open.value && !!org.value && !!page(name);

  const alertsRead = useQuery(() => ({
    ...firingAlertsQuery(org.value, { silentForbidden: true }),
    enabled: readable("alertList"),
  }));

  const dashboardTitle = computed(() => settled.value.trim().toLowerCase());
  const dashboardsRead = useQuery(() => ({
    ...dashboardsSearchQuery(org.value, dashboardTitle.value, { silentForbidden: true }),
    enabled: readable("dashboards") && dashboardTitle.value.length >= DASHBOARD_MIN_CHARS,
    placeholderData: keepPreviousData,
  }));

  const streamReads = STREAM_TYPES.map((type) => ({
    type,
    read: useQuery(() => ({ ...streamNameListQuery(org.value, type), enabled: readable(type) })),
  }));
  const streamsOf = (type: AlertEvidencePage): StreamRow[] =>
    (streamReads.find((s) => s.type === type)?.read.data.value ?? []) as StreamRow[];

  const withOrg = (to: { name: string; query?: Record<string, string> }): RouteLocationRaw => ({
    ...to,
    query: { org_identifier: org.value, ...to.query },
  });

  // Alerts and Dashboards name their search across folders the same way in the URL.
  const searchAcrossFolders = () => ({ "v.search": query.value.trim(), "v.all": "true" });

  const showAllRow = (areaKey: string, kind: string, to: RouteLocationRaw): JumpDestination => ({
    key: `${areaKey}:all`,
    label: t("menu.jumpToShowAll", { page: kind }),
    icon: "arrow-forward",
    area: raw(""),
    areaKey,
    to,
  });

  const alertKind = (): JumpObjectKind | null => {
    const listPage = page("alertList");
    if (!listPage) return null;
    const area = t("menu.alerts");
    return {
      areaKey: "objects:alerts",
      area,
      items: (alertsRead.data.value?.list ?? []).map((row) => ({
        key: `objects:alerts:${row.alert_id}`,
        label: raw(row.name),
        icon: listPage.icon,
        area,
        areaKey: "objects:alerts",
        to: {
          name: "alertDetail",
          params: { alert_id: row.alert_id },
          query: { org_identifier: org.value, folder: row.folder_id },
        },
        hint: raw(row.folder_name),
      })),
      showAll: () =>
        showAllRow(
          "objects:alerts",
          area,
          withOrg({ name: "alertList", query: searchAcrossFolders() }),
        ),
    };
  };

  const dashboardKind = (): JumpObjectKind | null => {
    const listPage = page("dashboards");
    if (!listPage) return null;
    const area = t("menu.dashboard");
    return {
      areaKey: "objects:dashboards",
      area,
      items: (dashboardsRead.data.value ?? []).map((hit) => ({
        key: `objects:dashboards:${hit.dashboardId}`,
        label: raw(hit.title),
        icon: listPage.icon,
        area,
        areaKey: "objects:dashboards",
        to: {
          path: "/dashboards/view",
          query: { org_identifier: org.value, dashboard: hit.dashboardId, folder: hit.folderId },
        },
        hint: raw(hit.folderName),
      })),
      showAll: () =>
        showAllRow(
          "objects:dashboards",
          area,
          withOrg({ name: "dashboards", query: searchAcrossFolders() }),
        ),
    };
  };

  const streamKind = (): JumpObjectKind | null => {
    const area = t("menu.index");
    const typeOf = new Map<string, AlertEvidencePage>();
    const items = STREAM_TYPES.flatMap((type) => {
      const explorer = page(type);
      if (!explorer) return [];
      return streamsOf(type).map((stream): JumpDestination => {
        const key = `objects:streams:${type}:${stream.name}`;
        typeOf.set(key, type);
        return {
          key,
          label: raw(stream.name),
          icon: explorer.icon,
          area,
          areaKey: "objects:streams",
          to: alertEvidenceRoute({
            page: type,
            stream: stream.name,
            filter: null,
            window: { period: EXPLORE_PERIOD },
            org: org.value,
          }),
          hint: explorer.label,
        };
      });
    });
    if (!items.length) return null;
    // Streams O2 writes itself sort after the user's own on a tie.
    const internal = (item: JumpDestination) => Number(String(item.label).startsWith("_"));
    items.sort((a, b) => internal(a) - internal(b));
    const listPage = page("logstreams");
    return {
      areaKey: "objects:streams",
      area,
      items,
      showAll: listPage
        ? (matches) =>
            showAllRow(
              "objects:streams",
              area,
              withOrg({
                name: "logstreams",
                query: {
                  "v.q": query.value.trim(),
                  "v.type": typeOf.get(matches[0].key) ?? "logs",
                },
              }),
            )
        : undefined,
    };
  };

  // The streams the Logs page last searched, else the freshest stream of the user's own data.
  const logsStream = (): string => {
    const listed = streamsOf("logs");
    const names = new Set(listed.map((s) => s.name));
    const explored = restoreLogsSelectedStreams(org.value, "logs").filter(
      (name) => !listed.length || names.has(name),
    );
    return explored.length
      ? explored.join(",")
      : pickDashboardPanelStream(org.value, "logs", listed);
  };

  const searchLogsGroup = (text: string): JumpGroup[] => {
    if (!page("logs")) return [];
    const stream = logsStream();
    if (!stream) return [];
    return [
      {
        areaKey: "search-logs",
        area: raw(""),
        items: [
          {
            key: "search-logs",
            label: t("menu.jumpToSearchLogs", { text }),
            icon: "search",
            area: raw(""),
            areaKey: "search-logs",
            to: alertEvidenceRoute({
              page: "logs",
              stream,
              filter: { kind: "where", where: `match_all('${escapeSingleQuotes(text)}')` },
              window: { period: EXPLORE_PERIOD },
              org: org.value,
            }),
          },
        ],
      },
    ];
  };

  const groups = computed(() => {
    const text = query.value.trim();
    if (!text) return [];
    const kinds = [alertKind(), dashboardKind(), streamKind()].filter(
      (kind): kind is JumpObjectKind => kind !== null,
    );
    return [...rankObjects(kinds, text, OBJECT_CAP), ...searchLogsGroup(text)];
  });
  const searchable = computed(() =>
    ["alertList", "dashboards", ...STREAM_TYPES].some((name) => !!page(name)),
  );
  return { groups, searchable };
}
