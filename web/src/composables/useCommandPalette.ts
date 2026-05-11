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
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import useAutoNavigation from "@/composables/useAutoNavigation";

export interface PaletteItem {
  name: string;
  path: string;
  title: string;
  icon: string;
  section: string;
  keywords: string[];
  type: "page" | "entity" | "command" | "ai_action";
  prompt?: string;
}

export interface SlashCommand {
  pattern: string;
  label: string;
  description: string;
  icon: string;
  section: string;
}

const STORAGE_KEY = "o2_recent_pages";
const DEBOUNCE_MS = 250;

const SLASH_COMMANDS: SlashCommand[] = [
  {
    pattern: "/ai",
    label: "AI Assistant",
    description: "Ask the AI assistant anything",
    icon: "psychology",
    section: "AI Actions",
  },
];

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

function isSlashQuery(q: string): boolean {
  return q.trim().startsWith("/");
}

function detectSlashCommand(q: string): SlashCommand | null {
  const trimmed = q.trim().toLowerCase();
  for (const cmd of SLASH_COMMANDS) {
    if (trimmed === cmd.pattern || trimmed.startsWith(cmd.pattern + " ")) {
      return cmd;
    }
  }
  return null;
}

function extractAiPrompt(q: string): string {
  const match = q.trim().match(/^\/ai\s+(.+)/);
  return match ? match[1].trim() : "";
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const useCommandPalette = () => {
  const store = useStore();
  const router = useRouter();
  const { t, locale } = useI18n();

  const query = ref("");
  const activeIndex = ref(0);
  const isSearching = ref(false);
  const entityResults = ref<PaletteItem[]>([]);
  const aiPrompt = ref("");

  // ─── Page index ────────────────────────────────────────────────────────────

  const pageIndex = computed<PaletteItem[]>(() => {
    const org = store.state.selectedOrganization?.identifier ?? "default";
    const routes = router.getRoutes();
    const items: PaletteItem[] = [];

    void locale.value;

    for (const route of routes) {
      if (!route.meta?.searchable) continue;

      const path = route.path.includes(":org_identifier")
        ? route.path.replace(":org_identifier", org)
        : route.path;

      const title = route.meta.titleKey
        ? t(String(route.meta.titleKey))
        : String(route.meta.title ?? route.name ?? "");

      const localizedKwds = Array.isArray(route.meta.keywordKeys)
        ? (route.meta.keywordKeys as string[]).map((k) => t(k))
        : [];

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
        type: "page" as const,
      });
    }

    return items;
  });

  // ─── Slash command items ───────────────────────────────────────────────────

  const slashCommandItems = computed<PaletteItem[]>(() => {
    return SLASH_COMMANDS.map((cmd) => ({
      name: cmd.pattern,
      path: "",
      title: cmd.label,
      icon: cmd.icon,
      section: cmd.section,
      keywords: [cmd.description, cmd.pattern],
      type: "command" as const,
      prompt: "",
    }));
  });

  // ─── Recents ───────────────────────────────────────────────────────────────

  const recentPages = computed<PaletteItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const recents: { name: string; path: string; title: string }[] =
        JSON.parse(stored);
      return recents.map((r) => {
        const match = pageIndex.value.find((p) => p.name === r.name);
        return {
          name: r.name,
          path: r.path,
          title: match?.title ?? r.title,
          icon: match?.icon ?? "history",
          section: match?.section ?? "",
          keywords: match?.keywords ?? [],
          type: "page" as const,
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

  const filteredCommands = computed<PaletteItem[]>(() => {
    const q = query.value.trim().toLowerCase();
    if (!q || !q.startsWith("/")) return [];
    return slashCommandItems.value.filter(
      (cmd) =>
        cmd.name.startsWith(q) || cmd.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  });

  const TOP_PAGES_COUNT = 10;

  const visibleItems = computed<PaletteItem[]>(() => {
    const q = query.value.trim();

    // Default view: recents + top pages
    if (!q) {
      const recents = recentPages.value;
      const recentNames = new Set(recents.map((r) => r.name));
      const topPages = pageIndex.value
        .filter((p) => !recentNames.has(p.name))
        .slice(0, Math.max(0, TOP_PAGES_COUNT - recents.length));
      return [...recents, ...topPages].slice(0, TOP_PAGES_COUNT);
    }

    // Slash command mode: show matching commands
    if (isSlashQuery(q)) {
      const slashCmd = detectSlashCommand(q);
      if (slashCmd && extractAiPrompt(q)) {
        // /ai with prompt — show the AI action item
        return [
          {
            name: "/ai",
            path: "",
            title: `Ask AI: "${extractAiPrompt(q)}"`,
            icon: "psychology",
            section: "AI Actions",
            keywords: [],
            type: "ai_action" as const,
            prompt: extractAiPrompt(q),
          },
        ];
      }
      // Just "/" or "/ai" — show matching commands
      return filteredCommands.value;
    }

    // Normal search: pages + entities (if any)
    const pages = filteredPages.value;
    const entities = entityResults.value.filter(
      (e) =>
        e.title.toLowerCase().includes(q.toLowerCase()) ||
        e.keywords.some((k) => k.toLowerCase().includes(q.toLowerCase())),
    );
    return [...pages, ...entities];
  });

  const hasResults = computed(() => visibleItems.value.length > 0);

  const isDefaultView = computed(() => !query.value.trim());

  const activeSlashCommand = computed(() => {
    return isSlashQuery(query.value) ? detectSlashCommand(query.value) : null;
  });

  // ─── Grouped results for rendering ─────────────────────────────────────────

  interface ResultGroup {
    label: string;
    items: PaletteItem[];
  }

  const groupedResults = computed<ResultGroup[]>(() => {
    const items = visibleItems.value;
    if (!items.length) return [];

    const q = query.value.trim();
    if (!q) {
      // Default view: group recents + top pages
      const groups: ResultGroup[] = [];
      const recents = items.filter(
        (i) => recentPages.value.some((r) => r.name === i.name),
      );
      const pages = items.filter(
        (i) => !recentPages.value.some((r) => r.name === i.name),
      );
      if (recents.length) groups.push({ label: "Recents", items: recents });
      if (pages.length) groups.push({ label: "Pages", items: pages });
      return groups;
    }

    if (isSlashQuery(q)) {
      return [{ label: "Commands", items }];
    }

    // Group by section
    const map = new Map<string, PaletteItem[]>();
    for (const item of items) {
      const section = item.section || "Results";
      if (!map.has(section)) map.set(section, []);
      map.get(section)!.push(item);
    }
    return Array.from(map.entries()).map(([label, groupItems]) => ({
      label,
      items: groupItems,
    }));
  });

  // ─── Dynamic entity search (debounced) ─────────────────────────────────────

  async function fetchEntitySearch(q: string) {
    if (!q || q.length < 2) {
      entityResults.value = [];
      return;
    }

    isSearching.value = true;
    try {
      const org = store.state.selectedOrganization?.identifier ?? "default";
      // Backend API integration point — uses existing stream nameList endpoint.
      // Replace with unified entity search API when available.
      const streamService = (await import("@/services/stream")).default;
      const res = await streamService.nameList(
        org,
        undefined,
        true,
        0,
        10,
        q,
        undefined,
        undefined,
      );
      const streams = res?.data?.list ?? [];
      entityResults.value = streams.map((s: any) => ({
        name: `stream-${s.name}`,
        path: `/${org}/logs?stream=${encodeURIComponent(s.name)}`,
        title: s.name,
        icon: s.stream_type === "metrics" ? "query_stats" : s.stream_type === "traces" ? "timeline" : "article",
        section: "Streams",
        keywords: [s.name, s.stream_type ?? "logs"],
        type: "entity" as const,
      }));
    } catch {
      entityResults.value = [];
    } finally {
      isSearching.value = false;
    }
  }

  function triggerEntitySearch(q: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchEntitySearch(q);
    }, DEBOUNCE_MS);
  }

  // Watch query for entity search
  watch(
    () => query.value,
    (newVal) => {
      const q = newVal.trim();
      if (!isSlashQuery(q) && q.length >= 2) {
        triggerEntitySearch(q);
      } else {
        entityResults.value = [];
        isSearching.value = false;
      }
    },
  );

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

  const { navigate } = useAutoNavigation();

  function navigateTo(item: PaletteItem) {
    // AI action: emit prompt and close
    if (item.type === "ai_action" && item.prompt) {
      aiPrompt.value = item.prompt;
      store.dispatch("commandPalette/close");
      window.dispatchEvent(
        new CustomEvent("o2:ai-prompt", { detail: { prompt: item.prompt } }),
      );
      return;
    }

    // Slash command without prompt — fill the query for further input
    if (item.type === "command") {
      query.value = item.name + " ";
      return;
    }

    // Page or entity navigation — uses shared AutoNavigation
    store.dispatch("commandPalette/close");
    navigate({ path: item.path });
  }

  function navigateSelected() {
    const item = visibleItems.value[activeIndex.value];
    if (item) navigateTo(item);
  }

  // ─── Palette open / close ─────────────────────────────────────────────────

  function open() {
    query.value = "";
    aiPrompt.value = "";
    entityResults.value = [];
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
    groupedResults,
    hasResults,
    isDefaultView,
    isOpen,
    isSearching,
    entityResults,
    aiPrompt,
    activeSlashCommand,
    open,
    close,
    moveUp,
    moveDown,
    resetActiveIndex,
    navigateTo,
    navigateSelected,
    scoreItem,
    detectSlashCommand,
    extractAiPrompt,
  };
};

export { scoreItem, detectSlashCommand, extractAiPrompt, SLASH_COMMANDS };
export type { SlashCommand };
export default useCommandPalette;
