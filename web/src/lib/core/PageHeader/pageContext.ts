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

import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { groupNavLinks, moduleRailForRoute, railGroupForRoute } from "@/lib/core/Navbar/navGroups";
import { isGateOpen, useNavGateContext } from "@/lib/core/Navbar/useNavGateContext";
import { solutionModeForPath } from "@/utils/security/solutionMode";

/** The rail's links as MainLayout builds them; a `flat` rail (security mode) has no groups. */
export interface PageNavContext {
  links: ComputedRef<NavItem[]>;
  flat: ComputedRef<boolean>;
}

export const PAGE_NAV_CONTEXT_KEY: InjectionKey<PageNavContext> = Symbol("pageNavContext");

export function providePageNavContext(context: PageNavContext): void {
  provide(PAGE_NAV_CONTEXT_KEY, context);
}

/** The context line of a page without a parent link: its module, solution or rail group, else the org (H4). */
export function usePageContextLabel(title?: () => string | undefined): ComputedRef<I18nText> {
  const { t } = useI18nTyped();
  const router = useRouter();
  const store = useStore() as { state?: Record<string, any> } | undefined;
  const nav = inject(PAGE_NAV_CONTEXT_KEY, null);
  const gates = useNavGateContext();

  // Until the rail's links arrive every group counts, so the line does not flip from org to group.
  const shownGroups = computed<ReadonlySet<string> | undefined>(() => {
    if (!nav) return undefined;
    if (nav.flat.value) return new Set();
    if (nav.links.value.length === 0) return undefined;
    const entries = groupNavLinks(nav.links.value, t, (gate) => isGateOpen(gates.value, gate));
    return new Set(entries.filter((e) => e.type === "linkGroup").map((e) => e.item.name));
  });

  const childPath = (name: string): string | null => {
    if (!router?.hasRoute?.(name)) return null;
    try {
      return router.resolve({ name }).path || null;
    } catch {
      return null;
    }
  };

  // Neither reads the rail's links, so the line is final before they load.
  const moduleOrSolution = (route: { path: string }): I18nText | null => {
    const module = moduleRailForRoute(route, childPath);
    if (module) return t(module.titleKey);
    if (solutionModeForPath(route.path ?? "", "observability") === "security")
      return t("solutionSwitcher.security.label");
    return null;
  };

  const orgLabel = (): I18nText => {
    const org = store?.state?.selectedOrganization;
    return raw(org?.label || org?.identifier || "");
  };
  const same = (a: string, b?: string) => !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

  const containerLabel = (route: Parameters<typeof railGroupForRoute>[0]): I18nText | null => {
    const fixed = moduleOrSolution(route);
    if (fixed) return fixed;
    const group = railGroupForRoute(route, childPath, shownGroups.value);
    return group ? t(group.titleKey) : null;
  };

  return computed(() => {
    const route = router?.currentRoute?.value;
    const label = route ? containerLabel(route) : null;
    // A container named exactly like the page ("Dashboards / Dashboards") says nothing, so name the org.
    if (!label || same(String(label), title?.())) return orgLabel();
    return label;
  });
}
