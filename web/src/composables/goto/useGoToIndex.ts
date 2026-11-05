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

import { computed, inject, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { refDebounced } from "@vueuse/core";
import { useQuery } from "@tanstack/vue-query";
import type { RouteLocationRaw, Router } from "vue-router";

import { useOrgId } from "@/composables/query/useOrgId";
import { useListViewState } from "@/composables/useListViewState";
import { alertsListQuery } from "@/services/alerts.queries";
import { optionalFoldersQuery } from "@/services/common.queries";
import { dashboardsSearchQuery, type DashboardSearchHit } from "@/services/dashboards.queries";
import type { Folder } from "@/services/common";
import { NAV_GROUPS, NAV_SUBNAV } from "@/lib/core/Navbar/navGroups";
import type { NavItem, SubnavChild } from "@/lib/core/Navbar/ONavbar.types";
import { featureState, type FeatureStates } from "@/utils/featureGate";
import { raw, useI18nTyped, type I18nText, type TranslateFn } from "@/types/i18n";

import { withHomeReturn, type HomeReturnState } from "./homeReturn";
import { GO_TO_PAGES, type GoToMatch, type GoToPage } from "./types";

export const GO_TO_GROUP_CAP = 5;
export const ALERTS_LIST_CAP = 1000;
export const DASHBOARD_SEARCH_CAP = 100;
export const DASHBOARD_SEARCH_MIN_CHARS = 2;
export const DASHBOARD_SEARCH_DEBOUNCE_MS = 200;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "in",
  "of",
  "on",
  "to",
  "my",
  "me",
  "show",
  "open",
  "go",
  "take",
  "view",
]);
const TOKEN_SPLIT = /[\s›/\-_.]+/;
const GROUP_ORDER: readonly GoToGroup[] = ["pages", "alertFolders", "alerts", "dashboards"];
const MORE_ALERTS_ID = "more:alerts";
const MORE_DASHBOARDS_ID = "more:dashboards";

/** The result group a match is listed under; the Ask row has none. */
export type GoToGroup = "pages" | "alertFolders" | "alerts" | "dashboards";

/** A searchable row before matching: `terms` are the label's group and folder names. */
export interface GoToCandidate {
  match: GoToMatch;
  group: GoToGroup;
  terms: string[];
}

export interface GoToIndexOptions {
  /** Shows the Ask row; false when the assistant cannot chat. */
  canAsk: MaybeRefOrGetter<boolean>;
  /** Off while nothing shows the results, so no list is fetched. */
  enabled?: MaybeRefOrGetter<boolean>;
}

export interface GoToIndex {
  matches: ComputedRef<GoToMatch[]>;
}

/** What the rail itself reads to decide which subnav children show. */
export interface GoToMenuGates {
  org: string;
  hasRoute(name: string): boolean;
  gateOpen(gate: string): boolean;
  hiddenMenus: Set<string>;
  features: FeatureStates | undefined;
}

interface Ranked {
  candidate: GoToCandidate;
  atLabelStart: boolean;
  order: number;
}

/** Lowercase tokens with the stop words dropped, so "alerts for payments" reads as two words. */
export function goToTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((token) => token !== "" && !STOP_WORDS.has(token));
}

/** Every input token must start some label, group or folder token; ranked by label start, then label length. */
export function matchGoTo(text: string, candidates: GoToCandidate[]): GoToMatch[] {
  const input = goToTokens(text);
  if (input.length === 0) return [];
  const normalized = input.join(" ");
  const ranked = candidates.flatMap((candidate, order): Ranked[] => {
    const labelTokens = goToTokens(String(candidate.match.label));
    const all = [...labelTokens, ...candidate.terms.flatMap(goToTokens)];
    if (!input.every((token) => all.some((word) => word.startsWith(token)))) return [];
    const atLabelStart = labelTokens.length > 0 && labelTokens[0].startsWith(input[0]);
    return [{ candidate, atLabelStart, order }];
  });
  ranked.sort(compareRanked);
  return ranked.map(({ candidate }) => ({
    ...candidate.match,
    exact: isExact(normalized, candidate),
  }));
}

/** The group header a row sits under; `more` rows close their own group. */
export function goToGroupOf(match: GoToMatch): GoToGroup | null {
  switch (match.kind) {
    case "page":
      return "pages";
    case "alert_folder":
      return "alertFolders";
    case "alert":
      return "alerts";
    case "dashboard_folder":
    case "dashboard":
      return "dashboards";
    case "more":
      return match.id === MORE_ALERTS_ID ? "alerts" : "dashboards";
    case "ask":
      return null;
  }
}

export function goToOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/** The menu's own links plus their subnav views, so Go to offers exactly what the rail offers. */
export function goToPagesFromMenu(
  links: NavItem[],
  t: TranslateFn,
  gates: GoToMenuGates,
): GoToPage[] {
  return links.flatMap((link): GoToPage[] => {
    if (link.locked) return [];
    const group = NAV_GROUPS.find((def) => def.absorbs.includes(link.name));
    const page: GoToPage = {
      id: link.name,
      label: link.title,
      ...(group && { group: t(group.titleKey) }),
      route: { path: link.link, query: { org_identifier: gates.org } },
    };
    const views = (NAV_SUBNAV[link.name] ?? []).filter((child) => subnavShows(child, gates));
    return [page, ...views.map((child) => subnavPage(link, child, t, gates.org))];
  });
}

/** Opens a match; a `more` row first leaves its search on the list page, and a trip from Home carries the way back. */
export function openGoToMatch(
  match: GoToMatch,
  router: Pick<Router, "push">,
  text: string,
  homeReturn: HomeReturnState | null = null,
): void {
  if (!match.route) return;
  if (match.id === MORE_ALERTS_ID) seedListSearch("alerts", text);
  if (match.id === MORE_DASHBOARDS_ID) seedListSearch("dashboards", text);
  void router.push(homeReturn ? withHomeReturn(match.route, homeReturn) : match.route);
}

/** Pages, alert folders, alerts and dashboards for the typed text, then Ask when the assistant can chat. */
export function useGoToIndex(text: MaybeRefOrGetter<string>, options: GoToIndexOptions): GoToIndex {
  const { t } = useI18nTyped();
  const org = useOrgId();
  const pages = inject(GO_TO_PAGES, null);
  const pageList = computed<GoToPage[]>(() => pages?.value ?? []);
  const typed = computed(() => toValue(text).trim());
  const enabled = computed(() => !!org.value && (toValue(options.enabled) ?? true));
  // A source whose page the menu hides is not offered, nor fetched.
  const hasPage = (id: string) => pageList.value.some((page) => page.id === id);
  const alertsOn = computed(() => enabled.value && hasPage("alertList"));
  const dashboardsOn = computed(() => enabled.value && hasPage("dashboards"));

  const alertFolders = useQuery(() => ({
    ...optionalFoldersQuery(org.value, "alerts"),
    enabled: alertsOn.value,
  }));
  const dashboardFolders = useQuery(() => ({
    ...optionalFoldersQuery(org.value, "dashboards"),
    enabled: dashboardsOn.value,
  }));
  const alerts = useQuery(() => ({ ...alertsListQuery(org.value, ""), enabled: alertsOn.value }));
  const searched = refDebounced(typed, DASHBOARD_SEARCH_DEBOUNCE_MS);
  const dashboards = useQuery(() => ({
    ...dashboardsSearchQuery(org.value, searched.value),
    enabled: dashboardsOn.value && searched.value.length >= DASHBOARD_SEARCH_MIN_CHARS,
  }));

  const candidates = computed<GoToCandidate[]>(() => [
    ...pageList.value.map((page) => pageCandidate(page)),
    ...(alertsOn.value
      ? folderCandidates(alertFolders.data.value?.folders, "alerts", org.value, t)
      : []),
    ...(alertsOn.value ? alertCandidates(alerts.data.value, org.value, t) : []),
    ...(dashboardsOn.value
      ? folderCandidates(dashboardFolders.data.value?.folders, "dashboards", org.value, t)
      : []),
    ...(dashboardsOn.value && searched.value === typed.value
      ? dashboardCandidates(dashboards.data.value, org.value, t)
      : []),
  ]);

  const matches = computed<GoToMatch[]>(() => {
    const value = typed.value;
    if (!value) return [];
    const grouped = capGroups(matchGoTo(value, candidates.value));
    const rows = [...grouped, ...moreRows(value)];
    return sortByGroup(rows).concat(toValue(options.canAsk) ? [askRow(value, t)] : []);
  });

  function moreRows(value: string): GoToMatch[] {
    const rows: GoToMatch[] = [];
    if (alertsOn.value && (alerts.data.value?.length ?? 0) >= ALERTS_LIST_CAP)
      rows.push(
        moreRow(
          MORE_ALERTS_ID,
          "alertList",
          t("overview.goTo.more.alerts", { text: raw(value) }),
          org.value,
        ),
      );
    if (
      dashboardsOn.value &&
      searched.value === value &&
      (dashboards.data.value?.length ?? 0) >= DASHBOARD_SEARCH_CAP
    )
      rows.push(
        moreRow(
          MORE_DASHBOARDS_ID,
          "dashboards",
          t("overview.goTo.more.dashboards", { text: raw(value) }),
          org.value,
        ),
      );
    return rows;
  }

  return { matches };
}

function subnavShows(child: SubnavChild, gates: GoToMenuGates): boolean {
  if (!gates.hasRoute(child.name) || gates.hiddenMenus.has(child.name)) return false;
  if (child.feature && featureState(gates.features, child.feature) === "hidden") return false;
  return !child.gate || gates.gateOpen(child.gate);
}

function subnavPage(link: NavItem, child: SubnavChild, t: TranslateFn, org: string): GoToPage {
  return {
    id: `${link.name}:${child.tab ?? child.name}`,
    label: child.title ? raw(child.title) : t(child.titleKey),
    group: link.title,
    route: {
      name: child.name,
      query: { ...(child.tab && { tab: child.tab }), org_identifier: org },
    },
  };
}

function compareRanked(a: Ranked, b: Ranked): number {
  if (a.atLabelStart !== b.atLabelStart) return a.atLabelStart ? -1 : 1;
  const length = String(a.candidate.match.label).length - String(b.candidate.match.label).length;
  return length !== 0 ? length : a.order - b.order;
}

function isExact(normalized: string, candidate: GoToCandidate): boolean {
  const label = goToTokens(String(candidate.match.label)).join(" ");
  const inFolder = candidate.match.kind === "alert" || candidate.match.kind === "dashboard";
  const folder = inFolder ? goToTokens(String(candidate.match.secondary ?? "")).join(" ") : null;
  return normalized === label || normalized === folder;
}

function capGroups(matches: GoToMatch[]): GoToMatch[] {
  const counts = new Map<GoToGroup | null, number>();
  return matches.filter((match) => {
    const group = goToGroupOf(match);
    const count = counts.get(group) ?? 0;
    counts.set(group, count + 1);
    return count < GO_TO_GROUP_CAP;
  });
}

// Stable, so the ranking inside a group survives; `more` rows stay last in theirs.
function sortByGroup(rows: GoToMatch[]): GoToMatch[] {
  const rank = (match: GoToMatch) => {
    const group = goToGroupOf(match);
    return (
      (group ? GROUP_ORDER.indexOf(group) : GROUP_ORDER.length) * 2 +
      (match.kind === "more" ? 1 : 0)
    );
  };
  return rows
    .map((match, index) => ({ match, index }))
    .sort((a, b) => rank(a.match) - rank(b.match) || a.index - b.index)
    .map(({ match }) => match);
}

function pageCandidate(page: GoToPage): GoToCandidate {
  return {
    match: {
      id: `page:${page.id}`,
      kind: "page",
      label: page.label,
      ...(page.group && { secondary: page.group }),
      route: page.route,
      exact: false,
    },
    group: "pages",
    terms: page.group ? [String(page.group)] : [],
  };
}

function folderCandidates(
  folders: Folder[] | undefined,
  type: "alerts" | "dashboards",
  org: string,
  t: TranslateFn,
): GoToCandidate[] {
  const alerts = type === "alerts";
  const secondary = alerts ? t("menu.alerts") : t("menu.dashboard");
  return (folders ?? []).map((folder) => ({
    match: {
      id: `${alerts ? "alert_folder" : "dashboard_folder"}:${folder.folderId}`,
      kind: alerts ? "alert_folder" : "dashboard_folder",
      label: raw(folder.name),
      secondary,
      route: {
        name: alerts ? "alertList" : "dashboards",
        query: { folder: folder.folderId, org_identifier: org },
      },
      exact: false,
    },
    group: alerts ? "alertFolders" : "dashboards",
    terms: [String(secondary)],
  }));
}

function alertCandidates(rows: any[] | undefined, org: string, t: TranslateFn): GoToCandidate[] {
  return (rows ?? []).flatMap((row): GoToCandidate[] => {
    const id = row?.alert_id ?? row?.id;
    if (!id || !row?.name) return [];
    const folder = String(row.folder_name ?? row.folder_id ?? "");
    return [
      {
        match: {
          id: `alert:${id}`,
          kind: "alert",
          label: raw(String(row.name)),
          ...(folder && { secondary: raw(folder) }),
          route: {
            name: "alertDetail",
            params: { alert_id: String(id) },
            query: { folder: String(row.folder_id ?? "default"), org_identifier: org },
          },
          exact: false,
        },
        group: "alerts",
        terms: [folder, String(t("menu.alerts"))],
      },
    ];
  });
}

function dashboardCandidates(
  hits: DashboardSearchHit[] | undefined,
  org: string,
  t: TranslateFn,
): GoToCandidate[] {
  return (hits ?? []).map((hit) => ({
    match: {
      id: `dashboard:${hit.dashboardId}`,
      kind: "dashboard",
      label: raw(hit.title),
      ...(hit.folderName && { secondary: raw(hit.folderName) }),
      route: {
        name: "viewDashboard",
        query: { dashboard: hit.dashboardId, folder: hit.folderId, org_identifier: org },
      },
      exact: false,
    },
    group: "dashboards",
    terms: [hit.folderName, String(t("menu.dashboard"))],
  }));
}

function moreRow(id: string, routeName: string, label: I18nText, org: string): GoToMatch {
  const route: RouteLocationRaw = { name: routeName, query: { org_identifier: org } };
  return { id, kind: "more", label, route, exact: false };
}

function askRow(text: string, t: TranslateFn): GoToMatch {
  return {
    id: "ask",
    kind: "ask",
    label: t("overview.goTo.ask", { text: raw(text) }),
    exact: false,
  };
}

// The list pages restore their search from this shared view state, which is how the `more` row hands over the text.
function seedListSearch(key: "alerts" | "dashboards", text: string): void {
  const view = useListViewState(key, { searchQuery: "", searchAcrossFolders: false });
  view.searchQuery = text;
  view.searchAcrossFolders = true;
}
