import type { RouteLocationRaw, Router } from "vue-router";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import type { NavGateContext, NavItem } from "@/lib/core/Navbar/ONavbar.types";
import { groupNavLinks } from "@/lib/core/Navbar/navGroups";
import { visibleNavChildren } from "@/lib/core/Navbar/navVisibility";
import { isGateOpen } from "@/lib/core/Navbar/useNavGateContext";
import { iconRegistry, type IconName } from "@/lib/core/Icon/OIcon.icons";
import type { FeatureGateContext } from "@/utils/enterpriseFeatures";
export interface PalettePage {
  id: string;
  name: I18nText;
  route: RouteLocationRaw;
  icon: IconName;
  locked?: boolean;
  licenseLocked?: boolean;
}
function isIcon(value: string): value is IconName {
  return value in iconRegistry;
}
export function palettePages(
  links: NavItem[],
  flat: boolean,
  context: NavGateContext,
  featureContext: FeatureGateContext,
  router: Router,
  org: string,
  t: TranslateFn,
): PalettePage[] {
  const pages = new Map<string, PalettePage>();
  const add = (page: {
    name: string;
    label: I18nText;
    icon: string;
    tab?: string;
    locked?: boolean;
    licenseLocked?: boolean;
  }) => {
    const { name, label, icon, tab, locked, licenseLocked } = page;
    if (!router.hasRoute(name) || context.hiddenMenus.has(name)) return;
    const id = `${name}:${tab ?? ""}`;
    const route = { name, query: { org_identifier: org, ...(tab ? { tab } : {}) } };
    try {
      router.resolve(route);
    } catch {
      return;
    }
    pages.set(id, {
      id,
      name: label,
      icon: isIcon(icon) ? icon : "search",
      route,
      locked,
      licenseLocked,
    });
  };
  const entries = flat
    ? links.map((item) => ({ type: "link" as const, item }))
    : groupNavLinks(links, t, (gate) => isGateOpen(context, gate));
  for (const entry of entries) {
    if (entry.type !== "group" && !entry.item.hide && entry.item.display !== false)
      add({
        name: entry.item.name,
        label: entry.item.title,
        icon: entry.item.icon,
        locked: entry.item.locked,
        licenseLocked: entry.item.licenseLocked,
      });
    if (entry.type === "link") continue;
    for (const child of visibleNavChildren(entry.children, context, featureContext, (name) =>
      router.hasRoute(name),
    ))
      add({
        name: child.name,
        label: child.title ? raw(child.title) : t(child.titleKey),
        icon: child.icon,
        tab: child.tab,
        locked: child.locked,
        licenseLocked: child.licenseLocked,
      });
  }
  return [...pages.values()];
}
