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

/* global localStorage */
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

export interface PaletteItem {
  name: string;
  path: string;
  title: string;
  icon: string;
  section: string;
  keywords: string[];
}

const STORAGE_KEY = "o2_recent_pages";

/**
 * Score a page item against a query string.
 * Returns 0 when the item should be excluded from results.
 * Scoring is locale-agnostic: `title` is already the localised string,
 * and `keywords` contains both English terms and localised tab labels.
 */
function scoreItem(item: PaletteItem, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const title = item.title.toLowerCase();
  let score = 0;

  if (title.startsWith(q)) score += 2;
  else if (title.includes(q)) score += 1;

  for (const kw of item.keywords) {
    if (kw.toLowerCase().includes(q)) {
      score += 0.5;
      break;
    }
  }

  return score;
}

const useCommandPalette = () => {
  const store = useStore();
  const router = useRouter();
  const { t, locale } = useI18n();

  const query = ref("");
  const activeIndex = ref(0);

  // ─── Page index ────────────────────────────────────────────────────────────

  /**
   * Build the searchable page index from registered routes.
   * Only routes with `meta.searchable === true` are included.
   *
   * Multi-language support
   * ─────────────────────
   * Route meta can carry two optional i18n fields:
   *
   *   titleKey?: string
   *     An i18n key whose translation becomes the page title shown in the
   *     palette AND searched against.  When the user switches to Chinese the
   *     computed re-runs automatically (locale is a dependency) and every
   *     title updates — no manual translation work required.
   *     Example:  titleKey: "menu.search"  →  "Logs" / "日志" / "Journaux" …
   *
   *   keywordKeys?: string[]
   *     Array of i18n keys for tab labels or section names that live on the
   *     page.  They are resolved to the current locale and appended to the
   *     static English `keywords` array so users can search in their language.
   *     Example:  keywordKeys: ["alerts.scheduled", "alerts.realTime"]
   *               → adds "Scheduled"/"轮询" and "Realtime"/"实时" as keywords.
   */
  const pageIndex = computed<PaletteItem[]>(() => {
    const org = store.state.selectedOrganization?.identifier ?? "default";
    const routes = router.getRoutes();
    const items: PaletteItem[] = [];

    // Reading locale.value makes this computed reactive to locale changes.
    void locale.value;

    for (const route of routes) {
      if (!route.meta?.searchable) continue;

      // Replace :org_identifier param with current org when present
      const path = route.path.includes(":org_identifier")
        ? route.path.replace(":org_identifier", org)
        : route.path;

      // Prefer the i18n-translated title; fall back to the static string.
      const title = route.meta.titleKey
        ? t(String(route.meta.titleKey))
        : String(route.meta.title ?? route.name ?? "");

      // Resolve keywordKeys to localized strings (tab labels, section names).
      const localizedKwds = Array.isArray(route.meta.keywordKeys)
        ? (route.meta.keywordKeys as string[]).map((k) => t(k))
        : [];

      // Merge static English keywords with localised keyword-key resolutions.
      // Deduplication is intentionally omitted — minor overhead, simpler code.
      const keywords = [
        ...(Array.isArray(route.meta.keywords)
          ? (route.meta.keywords as string[])
          : []),
        ...localizedKwds,
      ];

      items.push({
        name: String(route.name ?? ""),
        path,
        title,
        icon: String(route.meta.icon ?? "circle"),
        section: String(route.meta.section ?? ""),
        keywords,
      });
    }

    return items;
  });

  // ─── Recents ───────────────────────────────────────────────────────────────

  const recentPages = computed<PaletteItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const recents: { name: string; path: string; title: string }[] =
        JSON.parse(stored);
      return recents.map((r) => {
        // Enrich from page index when possible (picks up localised title too)
        const match = pageIndex.value.find((p) => p.name === r.name);
        return {
          name: r.name,
          path: r.path,
          // Show the current-locale title when the page is indexed; fall back
          // to the stored English title for pages that were removed from index.
          title: match?.title ?? r.title,
          icon: match?.icon ?? "history",
          section: match?.section ?? "",
          keywords: match?.keywords ?? [],
        };
      });
    } catch {
      return [];
    }
  });

  // ─── Filtered results ──────────────────────────────────────────────────────

  const filteredPages = computed<PaletteItem[]>(() => {
    const q = query.value.trim();
    if (!q) return [];

    return pageIndex.value
      .map((item) => ({ item, score: scoreItem(item, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  });

  const TOP_PAGES_COUNT = 10;

  /**
   * Items currently visible in the palette.
   * When query is empty → show recents first, then fill up to TOP_PAGES_COUNT with top pages.
   * When query is non-empty → show filtered page results.
   */
  const visibleItems = computed<PaletteItem[]>(() => {
    const q = query.value.trim();
    if (!q) {
      const recents = recentPages.value;
      const recentNames = new Set(recents.map((r) => r.name));
      const topPages = pageIndex.value
        .filter((p) => !recentNames.has(p.name))
        .slice(0, Math.max(0, TOP_PAGES_COUNT - recents.length));
      return [...recents, ...topPages].slice(0, TOP_PAGES_COUNT);
    }
    return filteredPages.value;
  });

  const hasResults = computed(() => visibleItems.value.length > 0);

  /**
   * Whether we are in the "empty query, default view" mode.
   * Used by the UI to render RECENTS + PAGES section labels.
   */
  const isDefaultView = computed(() => !query.value.trim());

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  function moveUp() {
    activeIndex.value =
      (activeIndex.value - 1 + visibleItems.value.length) %
      (visibleItems.value.length || 1);
  }

  function moveDown() {
    activeIndex.value =
      (activeIndex.value + 1) % (visibleItems.value.length || 1);
  }

  function resetActiveIndex() {
    activeIndex.value = 0;
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  function navigateTo(item: PaletteItem) {
    const org = store.state.selectedOrganization?.identifier ?? "default";
    store.dispatch("commandPalette/close");
    router.push({ path: item.path, query: { org_identifier: org } });
  }

  function navigateSelected() {
    const item = visibleItems.value[activeIndex.value];
    if (item) navigateTo(item);
  }

  // ─── Palette open / close ─────────────────────────────────────────────────

  function open() {
    query.value = "";
    resetActiveIndex();
    store.dispatch("commandPalette/open");
  }

  function close() {
    store.dispatch("commandPalette/close");
  }

  const isOpen = computed(() => store.state.commandPalette?.isOpen ?? false);

  return {
    query,
    activeIndex,
    pageIndex,
    recentPages,
    filteredPages,
    visibleItems,
    hasResults,
    isDefaultView,
    isOpen,
    open,
    close,
    moveUp,
    moveDown,
    resetActiveIndex,
    navigateTo,
    navigateSelected,
    // Exposed for testing
    scoreItem,
  };
};

export { scoreItem };
export default useCommandPalette;
