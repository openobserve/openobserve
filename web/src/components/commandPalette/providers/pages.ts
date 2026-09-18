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
import { groupNavLinks, isNavChildVisible, NAV_GROUPS } from "@/lib/core/Navbar/navGroups";
import type { NavGateContext, NavItem, SubnavChild } from "@/lib/core/Navbar/ONavbar.types";
import type { TranslateFn } from "@/types/i18n";
import type { PaletteItem } from "../types";

/** The two router calls the provider needs; satisfied by a vue-router Router. */
export interface PageRouter {
  hasRoute(name: string): boolean;
  resolve(to: RouteLocationRaw): { name?: string | symbol | null; path: string };
}

export interface PagesProviderInput {
  navLinks: NavItem[];
  ctx: NavGateContext;
  router: PageRouter;
  t: TranslateFn;
}

function safeResolve(
  router: PageRouter,
  to: RouteLocationRaw,
): { name?: string; path: string } | null {
  try {
    const r = router.resolve(to);
    return { name: typeof r.name === "string" ? r.name : undefined, path: r.path };
  } catch {
    return null;
  }
}

function fromLink(
  item: NavItem,
  router: PageRouter,
  groupKey: string,
  group?: string,
): PaletteItem | null {
  const resolved = safeResolve(router, { path: item.link });
  if (!resolved) return null;
  const name = resolved.name ?? item.name;
  return {
    id: `page:${name}`,
    type: "page",
    label: String(item.title),
    subtitle: group,
    icon: item.icon,
    trailing: { kind: "path", value: item.link },
    keywords: [item.name, name, ...(group ? [group] : [])],
    group: groupKey,
    route: { path: item.link },
  };
}

function fromChild(
  child: SubnavChild,
  groupKey: string,
  group: string,
  router: PageRouter,
  t: TranslateFn,
): PaletteItem | null {
  const resolved = safeResolve(router, { name: child.name });
  if (!resolved) return null;
  const label = child.title ?? String(t(child.titleKey));
  const category = child.categoryKey ? String(t(child.categoryKey)) : undefined;
  const path = child.tab ? `${resolved.path}?tab=${child.tab}` : resolved.path;
  return {
    id: child.tab ? `page:${child.name}:${child.tab}` : `page:${child.name}`,
    type: "page",
    label,
    subtitle: category && category !== group ? `${group} · ${category}` : group,
    icon: child.icon,
    trailing: { kind: "path", value: path },
    keywords: [
      child.name,
      group,
      ...(child.tab ? [child.tab] : []),
      ...(category ? [category] : []),
    ],
    group: groupKey,
    route: { name: child.name, query: child.tab ? { tab: child.tab } : {} },
  };
}

/** Every page the rail and its flyouts can show, in rail order, gated exactly as they are. */
export function buildPageItems({ navLinks, ctx, router, t }: PagesProviderInput): PaletteItem[] {
  const visibleLinks = navLinks.filter((l) => l.display !== false && !l.hide);
  const isNavGroup = new Set(NAV_GROUPS.map((d) => d.key));
  const items: PaletteItem[] = [];
  const push = (item: PaletteItem | null) => {
    if (item && !items.some((i) => i.id === item.id)) items.push(item);
  };
  for (const entry of groupNavLinks(visibleLinks, t)) {
    if (entry.type === "link") {
      push(fromLink(entry.item, router, entry.item.name));
      continue;
    }
    const groupKey = entry.type === "linkGroup" ? entry.item.name : entry.key;
    const group = entry.type === "linkGroup" ? String(entry.item.title) : String(entry.title);
    // A NAV_GROUPS tile only fronts its children; a NAV_SUBNAV parent is a page of its own.
    if (entry.type === "linkGroup" && !isNavGroup.has(entry.item.name)) {
      push(fromLink(entry.item, router, groupKey));
    }
    for (const child of entry.children) {
      if (child.defaultForRoute) continue;
      if (!isNavChildVisible(child, ctx, router)) continue;
      push(fromChild(child, groupKey, group, router, t));
    }
  }
  return items;
}

export interface RailCategory {
  key: string;
  label: string;
  icon: string;
}

/** The rail's tiles, in rail order and gated as the rail gates them: the chip row mirrors this. */
export function railCategories(
  navLinks: NavItem[],
  ctx: NavGateContext,
  router: PageRouter,
  t: TranslateFn,
): RailCategory[] {
  const visibleLinks = navLinks.filter((l) => l.display !== false && !l.hide);
  const out: RailCategory[] = [];
  for (const entry of groupNavLinks(visibleLinks, t)) {
    if (entry.type === "link") {
      out.push({ key: entry.item.name, label: String(entry.item.title), icon: entry.item.icon });
      continue;
    }
    // A tile whose children are all gated away never renders in the rail either.
    if (!entry.children.some((c) => isNavChildVisible(c, ctx, router))) continue;
    out.push(
      entry.type === "linkGroup"
        ? { key: entry.item.name, label: String(entry.item.title), icon: entry.item.icon }
        : { key: entry.key, label: String(entry.title), icon: entry.icon },
    );
  }
  return out;
}
