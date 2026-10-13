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

import { gt, type I18nKey } from "@/types/i18n";
import { getConsumableRelativeTime } from "@/utils/date";
import { buildDashboard, type CuratedResolution } from "@/views/Infrastructure/curated/resolve";
import {
  resolveCuratedHeadless,
  translateTitles,
} from "@/views/Infrastructure/curated/useCuratedPage";
import { GROUP } from "@/views/Infrastructure/curated/types";
import { kubernetesPage } from "@/views/Infrastructure/curated/packs/kubernetes.page";
import {
  kubernetesDashboardLayouts,
  type KubernetesDashboardKey,
  type KubernetesDashboardLayout,
  type KubernetesDashboardLink,
} from "@/views/Infrastructure/curated/packs/kubernetes.dashboards";
import { getReadyMadeSource, readyMadeMarker } from "./catalog";

const HOUR_US = 60 * 60 * 1_000_000;

/** Grid rows for a note: header bar and padding, plus one text line per ~160 characters at a 1280-wide page. */
const noteHeight = (text: string) => Math.ceil((58 + 20 * Math.ceil(text.length / 160)) / 15.5);

const GRID_COLUMNS = 192;

/** Picker flags only the curated page reads; the dashboards API drops them on save anyway. */
const PAGE_ONLY_VARIABLE_KEYS = new Set([
  "omitWhenValuesEmpty",
  "loadOptionsWithAllDefault",
  "labelKey",
]);

/** The page scopes each picker to its tabs; a stored copy re-declares its own scope below. */
const PAGE_SCOPE_VARIABLE_KEYS = new Set(["scope", "tabs"]);

const GROUP_IDS = new Set<string>(Object.values(GROUP));

/** A picker label that fell back to the bare group id reads better as the plain noun. */
const VARIABLE_LABEL_KEYS: Record<string, I18nKey> = {
  cluster: "infra.k8s2.groupCluster",
  namespace: "infra.k8s2.columnNamespace",
  pod: "infra.k8s2.kindPod",
  node: "infra.k8s2.kindNode",
};

type Doc = Record<string, any>;

/** The 4 Kubernetes dashboards, rendered for this org, in the catalog's order. */
export async function buildKubernetesDashboards(orgId: string): Promise<Doc[]> {
  const nowUs = Date.now() * 1000;
  const window = getConsumableRelativeTime(kubernetesPage.defaultRelativePeriod);
  const range = window
    ? { start: window.startTime, end: window.endTime }
    : { start: nowUs - 3 * HOUR_US, end: nowUs };
  const resolutions = await resolveCuratedHeadless({
    orgId,
    manifests: kubernetesDashboardLayouts.map((layout) => layout.manifest),
    range,
  });
  const docs = kubernetesDashboardLayouts.map((layout, index) =>
    renderDashboard(layout, resolutions[index], range.end),
  );
  const empty = docs.find((doc) => doc.tabs.length === 0);
  // A dashboard with no tab cannot even open; failing names the gap instead of saving a blank copy.
  if (empty) throw new Error(`no live Kubernetes metrics for ${empty.title}`);
  return docs;
}

function renderDashboard(
  layout: KubernetesDashboardLayout,
  resolution: CuratedResolution,
  nowUs: number,
): Doc {
  const built = buildDashboard(layout.manifest, resolution, {}, { timezone: "UTC", nowUs });
  const translated = translateTitles(built, layout.manifest) as Doc;
  return {
    version: 8,
    dashboardId: "",
    title: titleOf(layout.key),
    description: describe(resolution),
    role: readyMadeMarker("kubernetes", layout.key),
    owner: "",
    created: new Date().toISOString(),
    tabs: (translated.tabs as Doc[]).map((tab) => storedTab(tab, layout)),
    variables: {
      list: (translated.variables?.list ?? []).map(storedVariable),
      showDynamicFilters: false,
    },
    defaultDatetimeDuration: {
      type: "relative",
      relativeTimePeriod: layout.manifest.defaultRelativePeriod,
    },
  };
}

const titleOf = (key: KubernetesDashboardKey): string =>
  getReadyMadeSource("kubernetes").dashboards.find((ref) => ref.key === key)!.title;

/** Pack version plus every field spelling this copy was frozen to, so a later drift can be traced. */
function describe(resolution: CuratedResolution): string {
  const fields = new Set<string>();
  for (const panel of resolution.panels) {
    if (panel.hidden) continue;
    for (const field of Object.values(panel.resolvedFields)) fields.add(field);
  }
  for (const picker of resolution.pickers) fields.add(picker.field);
  return `${gt(kubernetesPage.titleKey)} v${kubernetesPage.contentVersion} · ${[...fields].sort().join(", ")}`;
}

const withoutPageKeys = (source: Doc): Doc =>
  Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("curated")));

function storedTab(tab: Doc, layout: KubernetesDashboardLayout): Doc {
  const section = layout.manifest.sections.find((entry) => entry.id === tab.tabId);
  const panels = (tab.panels as Doc[]).map((panel) => storedPanel(panel, layout));
  if (!section?.noteKey) return { tabId: tab.tabId, name: tab.name, panels };
  // The tab's caveat rides above its grid, where the curated page prints it.
  const note = gt(section.noteKey);
  const shift = noteHeight(note);
  const shifted = panels.map((panel, index) => ({
    ...panel,
    layout: { ...panel.layout, y: panel.layout.y + shift, i: index + 1 },
  }));
  return {
    tabId: tab.tabId,
    name: tab.name,
    panels: [notePanel(`${tab.tabId}_note`, note), ...shifted],
  };
}

function storedPanel(panel: Doc, layout: KubernetesDashboardLayout): Doc {
  const link = layout.links[panel.id];
  return {
    ...panel,
    config: {
      ...withoutPageKeys(panel.config),
      // The explorer link carried the query base64-encoded, so a variable inside it never resolved.
      drilldown: link ? [dashboardLink(link)] : [],
    },
  };
}

function dashboardLink(link: KubernetesDashboardLink): Doc {
  const target = kubernetesDashboardLayouts.find((layout) => layout.key === link.to)!;
  const section =
    target.manifest.sections.find((entry) => entry.id === link.section) ??
    target.manifest.sections[0];
  const title = titleOf(link.to);
  return {
    name: title,
    type: "byDashboard",
    targetBlank: false,
    findBy: "name",
    data: {
      logsMode: "auto",
      logsQuery: "",
      url: "",
      folder: getReadyMadeSource("kubernetes").folderName,
      dashboard: title,
      tab: gt(section.titleKey),
      passAllVariables: true,
      variables: link.seriesVariable
        ? [{ name: link.seriesVariable, value: "${series.__name}" }]
        : [],
    },
  };
}

function storedVariable(variable: Doc): Doc {
  const kept = Object.fromEntries(
    Object.entries(withoutPageKeys(variable)).filter(
      ([key]) => !PAGE_ONLY_VARIABLE_KEYS.has(key) && !PAGE_SCOPE_VARIABLE_KEYS.has(key),
    ),
  );
  const fallback = VARIABLE_LABEL_KEYS[kept.name];
  // The dictionary's display when the org has one; its raw group id otherwise.
  const unlabelled = !kept.label || GROUP_IDS.has(kept.label);
  return {
    ...kept,
    label: unlabelled && fallback ? gt(fallback) : kept.label,
    // A link passes picks as URL keys; a tab-scoped key names the source dashboard's tab, which the target lacks.
    scope: "global",
  };
}

function notePanel(id: string, text: string): Doc {
  return {
    id,
    type: "markdown",
    title: "",
    description: "",
    config: { show_legends: false, legends_position: null, decimals: 2 },
    queryType: "sql",
    queries: [
      {
        query: "",
        vrlFunctionQuery: "",
        customQuery: false,
        fields: {
          stream: "",
          stream_type: "logs",
          x: [],
          y: [],
          z: [],
          filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        },
        config: {
          promql_legend: "",
          layer_type: "scatter",
          weight_fixed: 1,
          limit: 0,
          min: 0,
          max: 100,
        },
      },
    ],
    layout: { x: 0, y: 0, w: GRID_COLUMNS, h: noteHeight(text), i: 0 },
    htmlContent: "",
    markdownContent: text,
  };
}
