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

import type { ComputedRef, InjectionKey } from "vue";
import type { I18nKey, I18nText } from "@/types/i18n";

export interface NavItem {
  title: I18nText;
  icon: string;
  link: string;
  exact?: boolean;
  name: string;
  display?: boolean;
  hide?: boolean;
  badge?: number;
}

/**
 * Provided by ONavbar, injected by each MenuLink. True once the rail's single
 * sliding-selection pill is positioned and visible — while true, an active
 * MenuLink defers its fill (background + left accent) to that pill and keeps only
 * its active text/icon colour. False (e.g. before first measure, or while the
 * rail is hidden) means each active tile paints its own pill as before, so the
 * nav never renders without a visible selection.
 */
export const RailIndicatorActiveKey: InjectionKey<ComputedRef<boolean>> = Symbol(
  "o-navbar-rail-indicator-active",
);

/**
 * A flyout sub-item. These mirror the target page's own in-page section nav
 * EXACTLY — same label (i18n key), same icon, same category grouping — so the
 * rail flyout and the page's SectionRail stay in sync. Navigation is by route
 * `name` (the app's section navs do the same), and `name` is filtered through
 * `router.hasRoute()` so feature-gated sub-pages never render a dead link.
 */
export interface SubnavChild {
  /** i18n key for the label, translated in the flyout. */
  titleKey: I18nKey;
  /**
   * Literal label, used INSTEAD of `titleKey` when the name must not be
   * translated — an acronym or product name. "RUM" came back from the
   * translator as "RON"/"RHUM" (the drink) in several locales.
   */
  title?: string;
  /** OIcon registry name — matches the sub-page's own icon. */
  icon: string;
  /** Route name — used for navigation, active-state, and hasRoute gating. */
  name: string;
  /**
   * i18n key for a section header this item sits under. Consecutive children
   * sharing a key render beneath one header, mirroring the sub-page grouping.
   * A KEY, not a literal: the rail ships in 15 locales.
   */
  categoryKey?: I18nKey;
  /** Query `tab` for routes that switch sub-views via a query param. */
  tab?: string;
  /** Use this child as the active fallback when its route has no `tab` query. */
  defaultForRoute?: boolean;
  /**
   * Also mark this child active on these route names. For a section whose
   * sub-views are IN-PAGE TABS on sibling routes rather than query params:
   * Databases owns `dbmQueries` and `dbmQueryDetail`, which have no flyout
   * entry of their own, so without this the entry unlights the moment the
   * user switches tab.
   */
  activeOnRoutes?: string[];
  /** Group children only: include only when this top-level item is present. */
  requires?: string;
  /**
   * Visibility gate key (see GATE_PREDICATES in navGroups.ts). Mirrors the
   * EXACT `visible` condition the target page applies to this section, so a
   * gated section (e.g. Nodes, only for enterprise meta-org) never shows in the
   * flyout when the page itself would hide it.
   */
  gate?: string;
}

/** Context for evaluating subnav `gate` predicates (see navGroups.ts). */
export interface NavGateContext {
  isEnterprise: boolean;
  isCloud: boolean;
  isMeta: boolean;
  rbac: boolean;
  serviceAccount: boolean;
  orgStorage: boolean;
  modelPricing: boolean;
  serviceStreams: boolean;
  onlineEvals: boolean;
  /** `zoConfig.database_monitoring_enabled`. OSS feature — no build gate. */
  databaseMonitoring: boolean;
  /** Raw `custom_hide_menus` entries (split on ",") — matches how pages test it. */
  hiddenMenus: Set<string>;
}

/**
 * A rendered rail entry. The navbar reshapes the flat `linksList` into:
 *  - `link`      — a plain standalone rail link.
 *  - `linkGroup` — a standalone link that ALSO reveals its own sub-pages on
 *                  hover (clicking the tile navigates to the main page). Used
 *                  for NAV_GROUPS (Data, Dashboards) and any NAV_SUBNAV entry.
 *  - `group`     — a pure flyout group with no page of its own; clicking the
 *                  tile toggles the submenu. Supported but not currently emitted
 *                  by groupNavLinks.
 * See `navGroups.ts`.
 */
export type RailEntry =
  | { type: "link"; item: NavItem }
  | { type: "linkGroup"; item: NavItem; children: SubnavChild[] }
  | {
      type: "group";
      key: string;
      title: I18nText;
      icon: string;
      children: SubnavChild[];
      pinBottom: boolean;
    };

export interface NavbarProps {
  linksList: NavItem[];
  miniMode?: boolean;
  visible?: boolean;
}

export interface NavbarEmits {
  (e: "menu-hover", routePath: string): void;
}

export interface NavbarSlots {
  default?: never;
}
