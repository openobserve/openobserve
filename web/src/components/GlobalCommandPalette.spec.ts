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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { computed, nextTick, ref } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

vi.mock("@/composables/useAutoNavigation", () => ({
  default: () => ({ navigate: vi.fn() }),
}));

vi.mock("@/composables/useCommandPalette", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    default: vi.fn(() => {
      const { ref, computed } = require("vue");
      return {
        query: ref(""),
        activeIndex: ref(0),
        visibleItems: ref([]),
        recentPages: ref([]),
        groupedResults: computed(() => []),
        hasResults: computed(() => false),
        isDefaultView: computed(() => true),
        isOpen: computed(() => false),
        isSearching: ref(false),
        activeSlashCommand: computed(() => null),
        close: vi.fn(),
        moveUp: vi.fn(),
        moveDown: vi.fn(),
        resetActiveIndex: vi.fn(),
        navigateTo: vi.fn(),
        navigateSelected: vi.fn(),
      };
    }),
  };
});

import GlobalCommandPalette from "@/components/GlobalCommandPalette.vue";
import useCommandPalette, {
  scoreItem,
  detectSlashCommand,
  extractAiPrompt,
  SLASH_COMMANDS,
  type PaletteItem,
} from "@/composables/useCommandPalette";

installQuasar();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePaletteItem(overrides: Partial<PaletteItem> = {}): PaletteItem {
  return {
    name: "logs",
    path: "/default/logs",
    title: "Logs",
    icon: "storage",
    section: "Observability",
    keywords: ["log", "search", "stream"],
    type: "page",
    ...overrides,
  };
}

const defaultMockReturn = () => ({
  query: ref(""),
  activeIndex: ref(0),
  visibleItems: ref([]),
  recentPages: ref([]),
  groupedResults: computed(() => []),
  hasResults: computed(() => false),
  isDefaultView: computed(() => true),
  isOpen: ref(true),
  isSearching: ref(false),
  activeSlashCommand: computed(() => null),
  close: vi.fn(),
  moveUp: vi.fn(),
  moveDown: vi.fn(),
  resetActiveIndex: vi.fn(),
  navigateTo: vi.fn(),
  navigateSelected: vi.fn(),
});

function mountPalette() {
  return mount(GlobalCommandPalette, {
    global: {
      plugins: [store, router],
      stubs: {
        "q-dialog": {
          props: ["modelValue"],
          template: '<div v-if="modelValue"><slot /></div>',
        },
        "q-icon": true,
        "q-spinner-dots": true,
      },
    },
  });
}

// ─── 1. scoreItem unit tests ───────────────────────────────────────────────

describe("scoreItem", () => {
  it("should return 0 when query is empty string", () => {
    const item = makePaletteItem({ title: "Logs", keywords: ["log"] });
    expect(scoreItem(item, "")).toBe(0);
  });

  it("should return 0 when query is whitespace only", () => {
    const item = makePaletteItem({ title: "Logs", keywords: [] });
    expect(scoreItem(item, "   ")).toBe(0);
  });

  it("should return score >= 2 when title starts with query", () => {
    const item = makePaletteItem({ title: "Logs", keywords: [] });
    const score = scoreItem(item, "log");
    expect(score).toBeGreaterThanOrEqual(2);
  });

  it("should return exactly 2 when title starts with query and no keyword matches", () => {
    const item = makePaletteItem({ title: "Metrics", keywords: [] });
    expect(scoreItem(item, "metr")).toBe(2);
  });

  it("should return 1 when title includes query but does not start with it", () => {
    const item = makePaletteItem({ title: "Dashboard", keywords: [] });
    expect(scoreItem(item, "board")).toBe(1);
  });

  it("should return 0.5 when only a keyword matches and title does not match", () => {
    const item = makePaletteItem({
      title: "Metrics",
      keywords: ["prometheus", "gauge"],
    });
    expect(scoreItem(item, "prometheus")).toBe(0.5);
  });

  it("should return 2.5 when title starts with query AND a keyword also matches", () => {
    const item = makePaletteItem({
      title: "Logs",
      keywords: ["log", "stream"],
    });
    expect(scoreItem(item, "log")).toBe(2.5);
  });

  it("should return 1.5 when title includes query (not starts) AND a keyword matches", () => {
    const item = makePaletteItem({
      title: "Dashboard",
      keywords: ["board", "widget"],
    });
    expect(scoreItem(item, "board")).toBe(1.5);
  });

  it("should return 0 when neither title nor keywords match", () => {
    const item = makePaletteItem({
      title: "Alerts",
      keywords: ["notification", "trigger"],
    });
    expect(scoreItem(item, "zzznomatch")).toBe(0);
  });

  it("should be case-insensitive for title matching", () => {
    const item = makePaletteItem({ title: "Logs", keywords: [] });
    expect(scoreItem(item, "LOGS")).toBe(2);
  });

  it("should be case-insensitive for keyword matching", () => {
    const item = makePaletteItem({
      title: "Settings",
      keywords: ["CONFIGURATION"],
    });
    expect(scoreItem(item, "configuration")).toBe(0.5);
  });

  it("should only add keyword bonus once regardless of how many keywords match", () => {
    const item = makePaletteItem({
      title: "Traces",
      keywords: ["trace", "span", "trace-id"],
    });
    const score = scoreItem(item, "trace");
    expect(score).toBe(2.5);
  });
});

// ─── 2. Slash commands ─────────────────────────────────────────────────────

describe("detectSlashCommand", () => {
  it("should return null for non-slash queries", () => {
    expect(detectSlashCommand("logs")).toBeNull();
  });

  it("should return null for unknown slash commands", () => {
    expect(detectSlashCommand("/unknown")).toBeNull();
  });

  it("should detect /ai command", () => {
    const result = detectSlashCommand("/ai");
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("/ai");
    expect(result!.label).toBe("AI Assistant");
  });

  it("should detect /ai followed by a prompt", () => {
    const result = detectSlashCommand("/ai what are the errors?");
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("/ai");
  });

  it("should be case-insensitive", () => {
    const result = detectSlashCommand("/AI help me");
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("/ai");
  });
});

describe("extractAiPrompt", () => {
  it("should extract prompt after /ai", () => {
    expect(extractAiPrompt("/ai what are errors?")).toBe("what are errors?");
  });

  it("should return empty string when no prompt follows /ai", () => {
    expect(extractAiPrompt("/ai")).toBe("");
  });

  it("should return empty string for non-ai queries", () => {
    expect(extractAiPrompt("/unknown command")).toBe("");
  });

  it("should trim whitespace from prompt", () => {
    expect(extractAiPrompt("/ai   help me   ")).toBe("help me");
  });
});

describe("SLASH_COMMANDS", () => {
  it("should include /ai command", () => {
    const aiCmd = SLASH_COMMANDS.find((c) => c.pattern === "/ai");
    expect(aiCmd).toBeDefined();
    expect(aiCmd!.icon).toBe("psychology");
  });
});

// ─── 3. commandPalette Vuex store module ──────────────────────────────────────

import commandPaletteModule from "@/stores/commandPalette";

describe("commandPalette Vuex store module", () => {
  function createLocalStore() {
    return createStore({
      modules: {
        commandPalette: commandPaletteModule,
      },
    });
  }

  it("should have isOpen as false in initial state", () => {
    const localStore = createLocalStore();
    expect(localStore.state.commandPalette.isOpen).toBe(false);
  });

  it("should set isOpen to true when open mutation is committed", () => {
    const localStore = createLocalStore();
    localStore.commit("commandPalette/open");
    expect(localStore.state.commandPalette.isOpen).toBe(true);
  });

  it("should set isOpen to false when close mutation is committed", () => {
    const localStore = createLocalStore();
    localStore.commit("commandPalette/open");
    localStore.commit("commandPalette/close");
    expect(localStore.state.commandPalette.isOpen).toBe(false);
  });

  it("should set isOpen to true when open action is dispatched", async () => {
    const localStore = createLocalStore();
    await localStore.dispatch("commandPalette/open");
    expect(localStore.state.commandPalette.isOpen).toBe(true);
  });

  it("should set isOpen to false when close action is dispatched", async () => {
    const localStore = createLocalStore();
    await localStore.dispatch("commandPalette/open");
    await localStore.dispatch("commandPalette/close");
    expect(localStore.state.commandPalette.isOpen).toBe(false);
  });

  it("should expose isOpen via getter", () => {
    const localStore = createLocalStore();
    expect(localStore.getters["commandPalette/isOpen"]).toBe(false);
    localStore.commit("commandPalette/open");
    expect(localStore.getters["commandPalette/isOpen"]).toBe(true);
  });
});

// ─── 4. GlobalCommandPalette.vue component tests ──────────────────────────────

describe("GlobalCommandPalette.vue", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    store.commit("commandPalette/close");
  });

  describe("when palette is closed (isOpen = false)", () => {
    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(false),
      } as any);
      wrapper = mountPalette();
    });

    it("should not render the input element when dialog is hidden", () => {
      expect(wrapper.find('[data-test="command-palette-input"]').exists()).toBe(
        false,
      );
    });

    it("should not render result items when dialog is hidden", () => {
      expect(
        wrapper.find('[data-test="command-palette-result-item"]').exists(),
      ).toBe(false);
    });

    it("should not render empty state when dialog is hidden", () => {
      expect(
        wrapper.find('[data-test="command-palette-empty"]').exists(),
      ).toBe(false);
    });
  });

  describe("when palette is open (isOpen = true)", () => {
    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(true),
      } as any);
      wrapper = mountPalette();
    });

    it("should render the input element when dialog is visible", async () => {
      await flushPromises();
      await nextTick();
      expect(wrapper.find('[data-test="command-palette-input"]').exists()).toBe(
        true,
      );
    });

    it("should render input with correct data-test attribute", async () => {
      await flushPromises();
      await nextTick();
      const input = wrapper.find('[data-test="command-palette-input"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes("data-test")).toBe("command-palette-input");
    });
  });

  describe("when palette is open with matching results", () => {
    const mockItems: PaletteItem[] = [
      makePaletteItem({ name: "logs", title: "Logs", path: "/default/logs" }),
      makePaletteItem({
        name: "metrics",
        title: "Metrics",
        path: "/default/metrics",
        icon: "bar_chart",
        section: "Observability",
        keywords: ["prometheus"],
      }),
    ];

    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(true),
        query: ref("log"),
        visibleItems: ref(mockItems),
        groupedResults: computed(() => [{ label: "Pages", items: mockItems }]),
        hasResults: computed(() => true),
        isDefaultView: computed(() => false),
      } as any);
      wrapper = mountPalette();
    });

    it("should render result items when visibleItems is non-empty", async () => {
      await flushPromises();
      await nextTick();
      const items = wrapper.findAll('[data-test="command-palette-result-item"]');
      expect(items.length).toBeGreaterThan(0);
    });

    it("should render one result item per visible item", async () => {
      await flushPromises();
      await nextTick();
      const items = wrapper.findAll('[data-test="command-palette-result-item"]');
      expect(items.length).toBe(mockItems.length);
    });

    it("should not show empty state when results exist", async () => {
      await flushPromises();
      await nextTick();
      expect(
        wrapper.find('[data-test="command-palette-empty"]').exists(),
      ).toBe(false);
    });
  });

  describe("when palette is open with no matching results and a query", () => {
    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(true),
        query: ref("zzznomatch"),
        isDefaultView: computed(() => false),
      } as any);
      wrapper = mountPalette();
    });

    it("should show the empty state element when query yields no results", async () => {
      await flushPromises();
      await nextTick();
      expect(
        wrapper.find('[data-test="command-palette-empty"]').exists(),
      ).toBe(true);
    });

    it("should not render result items when there are no results", async () => {
      await flushPromises();
      await nextTick();
      expect(
        wrapper.find('[data-test="command-palette-result-item"]').exists(),
      ).toBe(false);
    });

    it("should display the unmatched query in the empty state message", async () => {
      await flushPromises();
      await nextTick();
      const emptyEl = wrapper.find('[data-test="command-palette-empty"]');
      expect(emptyEl.exists()).toBe(true);
      expect(emptyEl.text()).toContain("zzznomatch");
    });
  });

  describe("when searching entities (loading state)", () => {
    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(true),
        query: ref("stream"),
        isSearching: ref(true),
        hasResults: computed(() => false),
        isDefaultView: computed(() => false),
      } as any);
      wrapper = mountPalette();
    });

    it("should show loading state when searching", async () => {
      await flushPromises();
      await nextTick();
      expect(
        wrapper.find('[data-test="command-palette-loading"]').exists(),
      ).toBe(true);
    });
  });

  describe("when palette is open with create items", () => {
    const createItems: PaletteItem[] = [
      makePaletteItem({
        name: "addAlert",
        title: "New Alert",
        path: "/default/alerts/add",
        icon: "notifications",
        section: "Create",
        keywords: ["new alert", "create alert"],
        type: "create",
      }),
      makePaletteItem({
        name: "createPipeline",
        title: "New Pipeline",
        path: "/default/pipeline/pipelines/add",
        icon: "account_tree",
        section: "Create",
        keywords: ["new pipeline", "add pipeline"],
        type: "create",
      }),
    ];

    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(true),
        visibleItems: ref(createItems),
        groupedResults: computed(() => [{ label: "Create", items: createItems }]),
        hasResults: computed(() => true),
      } as any);
      wrapper = mountPalette();
    });

    it("should render create items in results", async () => {
      await flushPromises();
      await nextTick();
      const items = wrapper.findAll('[data-test="command-palette-result-item"]');
      expect(items.length).toBe(createItems.length);
    });

    it("should show Create section label", async () => {
      await flushPromises();
      await nextTick();
      expect(wrapper.text()).toContain("Create");
    });
  });

  describe("with slash command active", () => {
    beforeEach(() => {
      vi.mocked(useCommandPalette).mockReturnValue({
        ...defaultMockReturn(),
        isOpen: ref(true),
        query: ref("/ai"),
        activeSlashCommand: computed(() => ({
          pattern: "/ai",
          label: "AI Assistant",
          description: "Ask the AI assistant anything",
          icon: "psychology",
          section: "AI Actions",
        })),
        hasResults: computed(() => false),
        isDefaultView: computed(() => false),
      } as any);
      wrapper = mountPalette();
    });

    it("should show slash command hint when active", async () => {
      await flushPromises();
      await nextTick();
      expect(
        wrapper.find('[data-test="command-palette-slash-hint"]').exists(),
      ).toBe(true);
    });
  });
});
