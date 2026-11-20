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

import type { LocationQueryRaw, RouteLocationNormalizedLoaded } from "vue-router";
import type { NavGateContext, SubnavChild } from "./ONavbar.types";
import type { I18nKey } from "@/types/i18n";
import { isGateOpen } from "./useNavGateContext";
import { featureState } from "@/utils/featureGate";
import {
  checkFeatureAccess,
  buildFeatureGateContext,
  isFeatureKey,
} from "@/utils/enterpriseFeatures";

// Shared by the rail flyout (ONavGroup) and the grouped sidebar (OSidebarGroup) so both gate children identically.

export const childKey = (child: SubnavChild) => `${child.name}-${child.tab ?? ""}`;

export const licenseStateOf = (ctx: NavGateContext, c: SubnavChild) =>
  c.feature ? featureState(ctx.features, c.feature) : "enabled";

/**
 * A child shows when its route is registered and custom_hide_menus does not name it. A FeatureKey
 * `gate` then decides locked vs. unlocked; a plain gate keeps hide-on-fail.
 */
export function visibleNavChildren(
  children: SubnavChild[],
  ctx: NavGateContext,
  hasRoute: (name: string) => boolean,
  zoConfig: Record<string, any> | undefined,
): SubnavChild[] {
  return children
    .filter((c) => hasRoute(c.name) && !ctx.hiddenMenus.has(c.name))
    .flatMap((c): SubnavChild[] => {
      if (c.gate && isFeatureKey(c.gate)) {
        const access = checkFeatureAccess(c.gate, buildFeatureGateContext(zoConfig));
        if (!access.visible) return [];
        if (!access.allowed) return [{ ...c, locked: true, lockedMessage: access.message }];
      }
      // The license applies once the edition allows the feature; a locked license also turns its runtime flag off.
      const license = licenseStateOf(ctx, c);
      if (license === "hidden") return [];
      if (license === "locked") return [{ ...c, locked: false, licenseLocked: true }];
      if (!c.gate) return [{ ...c, locked: false }];
      return isGateOpen(ctx, c.gate) ? [{ ...c, locked: false }] : [];
    });
}

/**
 * At most ONE child is active: exact tab, then route alias, then exact name, then the
 * route default, then the DEEPEST path prefix, so a nested route lights its own section.
 */
export function resolveActiveChild(
  children: SubnavChild[],
  route: Pick<RouteLocationNormalizedLoaded, "name" | "path" | "query">,
  childPath: (name: string) => string | null,
): SubnavChild | null {
  const exactTab = children.find(
    (c) => c.tab && route.name === c.name && route.query.tab === c.tab,
  );
  if (exactTab) return exactTab;

  // Checked before the prefix pass, which would otherwise attribute a detail route to the longest matching path.
  const routeAlias = children.find((c) => c.activeOnRoutes?.includes(route.name as string));
  if (routeAlias) return routeAlias;

  const exact = children.find((c) => route.name === c.name && !c.tab);
  if (exact) return exact;

  const routeDefault = children.find((c) => c.defaultForRoute && route.name === c.name);
  if (routeDefault) return routeDefault;

  let best: SubnavChild | null = null;
  let bestLen = 0;
  for (const child of children) {
    if (child.tab) continue;
    const base = childPath(child.name);
    if (!base || base === "/") continue;
    if (route.path !== base && !route.path.startsWith(`${base}/`)) continue;
    if (base.length > bestLen) {
      best = child;
      bestLen = base.length;
    }
  }
  return best;
}

/** Keeps the current query when staying on the same route, so a tab switch keeps its context. */
export function childLocation(
  child: SubnavChild,
  route: Pick<RouteLocationNormalizedLoaded, "name" | "query">,
  orgIdentifier: string | undefined,
) {
  const query: LocationQueryRaw = route.name === child.name ? { ...route.query } : {};
  if (orgIdentifier) query.org_identifier = orgIdentifier;
  if (child.tab) {
    delete query.search_mode;
    query.tab = child.tab;
  }
  return { name: child.name, query };
}

export interface ChildSection {
  key: string;
  titleKey?: I18nKey;
  children: SubnavChild[];
  /** Every child is beta, so the heading carries one badge instead of each row. */
  beta: boolean;
}

/** Consecutive children sharing a `categoryKey` form one headed section; uncategorised runs stay headless. */
export function sectionNavChildren(children: SubnavChild[]): ChildSection[] {
  const sections: ChildSection[] = [];
  for (const child of children) {
    const last = sections[sections.length - 1];
    if (last && last.titleKey === child.categoryKey) {
      last.children.push(child);
      continue;
    }
    sections.push({
      key: child.categoryKey?.split(".").pop() ?? `items-${sections.length}`,
      titleKey: child.categoryKey,
      children: [child],
      beta: false,
    });
  }
  for (const s of sections) s.beta = !!s.titleKey && s.children.every((c) => c.beta);
  return sections;
}
