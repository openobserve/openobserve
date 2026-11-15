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

import { computed, inject, type ComputedRef } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { PAGE_NAV_CONTEXT_KEY } from "@/lib/core/PageHeader/pageContext";
import { groupNavLinks, MODULE_RAILS } from "@/lib/core/Navbar/navGroups";
import {
  isGateOpen,
  useNavGateContext,
  visibleSubnavChildren,
} from "@/lib/core/Navbar/useNavGateContext";
import type { NavItem, RailEntry, SubnavChild } from "@/lib/core/Navbar/ONavbar.types";
import type { SectionHubItem } from "@/components/common/SectionHub.vue";
import { useSettingsSections } from "@/components/settings/useSettingsSections";
import { useIamSections } from "@/composables/iam/useIamSections";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { hidesOnlineEvalEntries } from "@/composables/shared/useOnlineEvalsGate";
import {
  AI_OBSERVABILITY_SECTIONS,
  AI_OBSERVABILITY_TABBED_ITEMS,
  ONLINE_EVAL_FEATURE_KEYS,
} from "@/composables/shared/useAIObservabilityRoutes";
import { ACTIONS_AREA_KEY, type JumpDestination } from "./jumpToDestinations";

type Section = Pick<JumpDestination, "key" | "label" | "icon" | "to">;

const MODULE_NAMES = new Set(MODULE_RAILS.map((m) => m.name));

/** Actions people look for by name; each lists only while the page it belongs to (`page`, a route name) does. */
const JUMP_ACTIONS: {
  key: string;
  labelKey: I18nKey;
  page: string;
  to: { name: string; query?: Record<string, string> };
}[] = [
  { key: "addData", labelKey: "menu.addData", page: "ingestion", to: { name: "ingestion" } },
  { key: "newAlert", labelKey: "alerts.add", page: "alertList", to: { name: "addAlert" } },
  {
    key: "newDashboard",
    labelKey: "dashboard.add",
    page: "dashboards",
    to: { name: "dashboards", query: { action: "add" } },
  },
  {
    key: "newPipeline",
    labelKey: "pipeline.addPipeline",
    page: "pipelines",
    to: { name: "createPipeline" },
  },
];

/** Every page the rails let the user reach, in rail order; a module rail lists its own sections. */
export function useJumpToDestinations(): ComputedRef<JumpDestination[]> {
  const { t } = useI18nTyped();
  const router = useRouter();
  const store = useStore();
  const nav = inject(PAGE_NAV_CONTEXT_KEY, null);
  const gates = useNavGateContext();
  const { settingsItems } = useSettingsSections();
  const { sectionGroups: iamGroups } = useIamSections();
  const aiSections = useAiSections();

  const orgQuery = () => ({ org_identifier: store.state.selectedOrganization?.identifier });

  // Like the flyouts' hasRoute check: a section whose route this build does not register is a dead link.
  const routable = (to: RouteLocationRaw): boolean => {
    try {
      return router.resolve(to).matched.length > 0;
    } catch {
      return false;
    }
  };

  const resolved = (to: RouteLocationRaw) => {
    try {
      return router.resolve(to);
    } catch {
      return null;
    }
  };

  // The path's last word finds a page by the name its URL uses, as "ingestion" finds Data sources.
  const withPathKeyword = (page: JumpDestination): JumpDestination => {
    const word = resolved(page.to)?.path.split("/").filter(Boolean).pop();
    return word ? { ...page, keywords: [word] } : page;
  };

  const actionsFor = (pages: JumpDestination[]): JumpDestination[] =>
    JUMP_ACTIONS.flatMap((action) => {
      const page = pages.find((p) => resolved(p.to)?.name === action.page);
      const to = { ...action.to, query: { ...orgQuery(), ...action.to.query } };
      if (!page || !routable(to)) return [];
      return [
        {
          key: `${ACTIONS_AREA_KEY}:${action.key}`,
          label: t(action.labelKey),
          icon: page.icon,
          area: t("common.actions"),
          areaKey: ACTIONS_AREA_KEY,
          to,
          hint: page.label,
          keywords: page.keywords,
        },
      ];
    });

  const reachable = (items: SectionHubItem[]): Section[] =>
    items
      .filter((item) => item.visible !== false && !item.locked && routable(item.to))
      .map((item) => ({ key: item.key, label: item.label, icon: item.icon ?? "", to: item.to }));

  const moduleSections = (name: string): Section[] => {
    if (name === "settings") return reachable(settingsItems.value);
    if (name === "iam") return reachable(iamGroups.value.flatMap((group) => group.items));
    if (name === "aiObservability")
      return aiSections.value.filter((section) => routable(section.to));
    return [];
  };

  const childTo = (child: SubnavChild): RouteLocationRaw => ({
    name: child.name,
    query: child.tab ? { ...orgQuery(), tab: child.tab } : orgQuery(),
  });

  const childLabel = (child: SubnavChild): I18nText =>
    child.title ? raw(child.title) : t(child.titleKey);

  return computed<JumpDestination[]>(() => {
    if (!nav) return [];
    const flat = nav.flat.value;
    const solution = flat
      ? { key: "security", label: t("solutionSwitcher.security.label") }
      : { key: "observability", label: t("solutionSwitcher.observability.label") };
    const entries: RailEntry[] = flat
      ? nav.links.value.map((item): RailEntry => ({ type: "link", item }))
      : groupNavLinks(nav.links.value, t, (gate) => isGateOpen(gates.value, gate));

    const out: JumpDestination[] = [];
    const addModule = (name: string, area: I18nText) => {
      for (const section of moduleSections(name)) {
        out.push({ ...section, key: `${name}:${section.key}`, area, areaKey: name });
      }
    };
    const addLink = (item: NavItem) => {
      if (item.locked) return;
      if (MODULE_NAMES.has(item.name)) return addModule(item.name, item.title);
      out.push({
        key: item.name,
        label: item.title,
        icon: item.icon,
        area: solution.label,
        areaKey: solution.key,
        to: { path: item.link, query: orgQuery() },
      });
    };
    const addGroup = (key: string, title: I18nText, children: SubnavChild[]) => {
      const shown = visibleSubnavChildren(children, gates.value, store.state.zoConfig, (name) =>
        router.hasRoute(name),
      );
      for (const child of shown) {
        if (child.locked) continue;
        if (MODULE_NAMES.has(child.name)) {
          addModule(child.name, child.name === key ? title : childLabel(child));
          continue;
        }
        out.push({
          key: `${key}:${child.name}:${child.tab ?? ""}`,
          label: childLabel(child),
          icon: child.icon,
          area: title,
          areaKey: key,
          to: childTo(child),
        });
      }
    };

    for (const entry of entries) {
      if (entry.type === "link") addLink(entry.item);
      else if (entry.type === "linkGroup")
        addGroup(entry.item.name, entry.item.title, entry.children);
      else addGroup(entry.key, entry.title, entry.children);
    }
    const pages = out.map(withPathKeyword);
    return [...pages, ...actionsFor(pages)];
  });
}

/** AI observability's rail items, Tools pages and Playground, as its shell derives them from the section table. */
function useAiSections(): ComputedRef<Section[]> {
  const { t } = useI18nTyped();
  const store = useStore();
  return computed(() => {
    const zoConfig = store.state.zoConfig;
    const gate = buildFeatureGateContext(zoConfig);
    const hideEvals = hidesOnlineEvalEntries(zoConfig);
    const query = { org_identifier: store.state.selectedOrganization?.identifier };
    const seenTabbed = new Set<string>();
    const out: Section[] = [];
    for (const section of AI_OBSERVABILITY_SECTIONS) {
      if (hideEvals && section.featureKey && ONLINE_EVAL_FEATURE_KEYS[section.featureKey]) continue;
      if (section.requiresConfigFlag && zoConfig?.[section.requiresConfigFlag] !== true) continue;
      if (section.featureKey && !checkFeatureAccess(section.featureKey, gate).allowed) continue;
      // A tabbed rail item opens on its first open tab, so later tabs add nothing.
      if (section.tabOf && seenTabbed.has(section.tabOf)) continue;
      if (section.tabOf) seenTabbed.add(section.tabOf);
      const item = section.tabOf ? AI_OBSERVABILITY_TABBED_ITEMS[section.tabOf] : section;
      out.push({
        key: section.tabOf ?? section.key,
        label: t(item.labelKey),
        icon: item.icon,
        to: {
          name: section.routeName,
          query: section.tabQuery ? { ...query, tab: section.tabQuery } : query,
        },
      });
    }
    return out;
  });
}
