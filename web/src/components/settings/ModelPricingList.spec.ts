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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import ModelPricingList from "./ModelPricingList.vue";

installQuasar();

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/services/model_pricing", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getBuiltIn: vi.fn(),
    refreshBuiltIn: vi.fn(),
    test: vi.fn(),
  },
}));

const notifyMock = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual<any>("quasar");
  return {
    ...actual,
    useQuasar: () => ({ notify: notifyMock }),
  };
});

// Router mock — capture push calls
const routerPushMock = vi.fn();
const currentRouteRef = { value: { query: {} as Record<string, any> } };
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPushMock,
    currentRoute: currentRouteRef,
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (path: string) => `mock://${path}`,
}));

import modelPricingService from "@/services/model_pricing";

// ── Stubs for child components ───────────────────────────────────────────────

// ODrawer stub mirrors the migrated component API exactly: open/title/size +
// slots (default, header-left) and emits update:open + click:primary/secondary/neutral.
const ODrawerStub = {
  name: "ODrawer",
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: true },
    width: { type: [String, Number], default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="String(size)"
      :data-title="title"
      :data-width="String(width)"
    >
      <template v-if="open">
        <slot name="header-left" />
        <slot name="header-right" />
        <slot />
      </template>
    </div>
  `,
};

// ConfirmDialog stub exposes ok/cancel triggers without rendering the real
// underlying ODialog so the spec stays decoupled from that component.
const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: ["modelValue", "title", "message"],
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: `
    <div data-test="confirm-dialog-stub" :data-open="String(!!modelValue)">
      <button data-test="confirm-dialog-ok" @click="$emit('update:ok')">ok</button>
      <button data-test="confirm-dialog-cancel" @click="$emit('update:cancel')">cancel</button>
    </div>
  `,
};

// OButton stub — exposes click/data-test passthrough so we can drive interactions.
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "loading", "title", "disabled"],
  emits: ["click"],
  template: `
    <button
      :data-test="$attrs['data-test']"
      :disabled="disabled"
      @click="$emit('click', $event)"
    ><slot /></button>
  `,
};

// ImportModelPricing stub — renders only when the parent toggles the page.
const ImportModelPricingStub = {
  name: "ImportModelPricing",
  props: ["existingModels"],
  emits: ["cancel:hideform", "update:list"],
  template: `
    <div data-test="import-model-pricing-stub">
      <button data-test="import-stub-cancel" @click="$emit('cancel:hideform')">cancel</button>
      <button data-test="import-stub-update" @click="$emit('update:list')">update</button>
    </div>
  `,
};

const TestModelMatchDialogStub = {
  name: "TestModelMatchDialog",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: `<div data-test="test-model-match-stub" :data-open="String(!!modelValue)" />`,
};

const AppTabsStub = {
  name: "AppTabs",
  props: ["tabs", "activeTab"],
  emits: ["update:activeTab"],
  template: `<div data-test="app-tabs-stub" :data-active="activeTab" />`,
};

const QTablePaginationStub = {
  name: "QTablePagination",
  props: ["scope", "position", "resultTotal", "perPageOptions"],
  emits: ["update:changeRecordPerPage"],
  template: `<div data-test="q-table-pagination-stub" />`,
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const orgModel = (overrides: Partial<any> = {}) => ({
  id: "org-1",
  name: "GPT-4o (org)",
  match_pattern: "^gpt-4o.*",
  source: "org",
  org_id: "test-org",
  enabled: true,
  tiers: [
    { condition: null, prices: { input: 0.0000025, output: 0.00001 } },
  ],
  children: [],
  ...overrides,
});

const metaOrgModel = (overrides: Partial<any> = {}) => ({
  id: "meta-1",
  name: "Claude (meta)",
  match_pattern: "^claude.*",
  source: "meta_org",
  org_id: "_meta_org_",
  enabled: true,
  tiers: [
    { condition: null, prices: { input: 0.000003, output: 0.000015 } },
  ],
  children: [],
  ...overrides,
});

const builtInModel = (overrides: Partial<any> = {}) => ({
  id: "bi-1",
  name: "gpt-3.5-turbo",
  match_pattern: "^gpt-3\\.5.*",
  source: "built_in",
  org_id: "_built_in_",
  enabled: true,
  tiers: [
    { condition: null, prices: { input: 0.0000005, output: 0.0000015 } },
  ],
  children: [],
  ...overrides,
});

const mockModels = [orgModel(), metaOrgModel(), builtInModel()];

// ── Store / i18n ─────────────────────────────────────────────────────────────

const createMockStore = (theme: "light" | "dark" = "light") =>
  createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      theme,
    },
  });

const mockI18n = createI18n({
  locale: "en",
  legacy: false,
  messages: {
    en: {
      modelPricing: {
        header: "LLM Model Pricing",
        matchingPriorityTooltip: "Your Org > Global > Built-in",
        searchPlaceholder: "Search models...",
        refresh: "Refresh",
        testBtn: "Test",
        importBtn: "Import",
        newModel: "New Model",
        noModels: "No model pricing",
        noModelsDesc: "Add a custom model pricing",
        modelsCount: "{count} Models",
        exportSelected: "Export ({count})",
        deleteSelected: "Delete ({count})",
        tabAll: "All",
        tabCustom: "Custom",
        tabSystem: "System",
        colModel: "Model",
        colMatchPattern: "Match Pattern",
        colPricing: "Pricing (per 1M tokens)",
        colActions: "Actions",
        colPricingSimple: "Pricing",
        colPattern: "Pattern",
        usageType: "Usage Type",
        colModelTooltip: "Display name",
        colMatchPatternTooltip: "Regex pattern",
        colPricingTooltip: "Per-token prices",
        sourceBuiltIn: "Built-in",
        sourceInherited: "Inherited",
        sourceCustom: "Custom",
        overflowMore: "more",
        actionDisable: "Disable",
        actionEnable: "Enable",
        actionEdit: "Edit",
        actionDelete: "Delete",
        actionDuplicate: "Duplicate",
        actionClone: "Clone",
        confirmDeleteTitle: "Delete model?",
        confirmDeleteMessage: "Delete {name}?",
        confirmDeleteSelectedTitle: "Delete models?",
        confirmDeleteSelectedMessage: "Delete {count} models?",
        modelPricingDeleted: "Deleted",
        deletedModelsNotif: "Deleted {count} models",
        modelEnabledNotif: "Enabled {name}",
        modelDisabledNotif: "Disabled {name}",
        builtInRefreshed: "Built-in refreshed",
        errLoadModels: "Failed to load models",
        errUpdate: "Failed to update",
        errDelete: "Failed to delete",
        errDeleteNamed: "Failed to delete {name}",
        errRefresh: "Failed to refresh",
        errUnknown: "Unknown error",
        noModelsSelected: "No models selected",
        shadowBannerPrefix: "Shadowed by",
        shadowBannerSuffix: "rule",
        shadowedTooltip: "Shadowed by {name}",
      },
    },
  },
});

// ── Global stubs ─────────────────────────────────────────────────────────────

const globalStubs: Record<string, any> = {
  "q-page": { template: "<div><slot /></div>" },
  "q-table": {
    name: "q-table",
    props: ["rows", "columns", "pagination", "sortMethod"],
    template: `
      <div class="q-table">
        <slot name="header" :cols="columns" />
        <template v-for="(row, idx) in rows" :key="row.id">
          <slot name="body" :row="row" :rowIndex="idx" :cols="columns" />
        </template>
        <slot name="no-data" />
        <slot name="bottom" />
      </div>
    `,
  },
  "q-tr": { template: "<tr><slot /></tr>" },
  "q-th": { template: "<th><slot /></th>" },
  "q-td": { template: "<td><slot /></td>" },
  "q-icon": {
    template: '<span class="q-icon"><slot /></span>',
    props: ["name", "size", "color"],
  },
  "q-tooltip": { template: "<span><slot /></span>" },
  "q-checkbox": {
    name: "q-checkbox",
    props: ["modelValue", "indeterminate", "size"],
    emits: ["update:modelValue"],
    template: `<input type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', !modelValue)" />`,
  },
  "q-input": {
    name: "q-input",
    props: ["modelValue", "placeholder", "borderless", "dense"],
    emits: ["update:modelValue"],
    template: `<input :value="modelValue" :placeholder="placeholder" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
  "q-separator": true,
  "q-spinner-hourglass": true,
  ODrawer: ODrawerStub,
  OButton: OButtonStub,
  ConfirmDialog: ConfirmDialogStub,
  ImportModelPricing: ImportModelPricingStub,
  TestModelMatchDialog: TestModelMatchDialogStub,
  AppTabs: AppTabsStub,
  QTablePagination: QTablePaginationStub,
};

// ── Test helpers ─────────────────────────────────────────────────────────────

let store: any;

function mountComponent(extra: { store?: any; query?: Record<string, any> } = {}) {
  store = extra.store ?? createMockStore();
  currentRouteRef.value.query = extra.query ?? {};
  return mount(ModelPricingList, {
    global: {
      plugins: [mockI18n],
      provide: { store },
      stubs: globalStubs,
      mocks: {
        $store: store,
      },
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ModelPricingList.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(modelPricingService.list).mockResolvedValue({
      data: mockModels,
    } as any);
    vi.mocked(modelPricingService.update).mockResolvedValue({} as any);
    vi.mocked(modelPricingService.delete).mockResolvedValue({} as any);
    vi.mocked(modelPricingService.refreshBuiltIn).mockResolvedValue({} as any);
    routerPushMock.mockReset();
    notifyMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Mounting ─────────────────────────────────────────────────────────────

  describe("mounting", () => {
    it("should mount without errors", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should call modelPricingService.list with the org identifier on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(modelPricingService.list).toHaveBeenCalledWith("test-org");
    });

    it("should populate models from the API response", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.models).toHaveLength(3);
    });

    it("should toggle loading off after fetch resolves", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should auto-open the import page when route query action=import", async () => {
      wrapper = mountComponent({ query: { action: "import" } });
      await flushPromises();
      expect(wrapper.vm.showImportModelPricingPage).toBe(true);
      expect(wrapper.find('[data-test="import-model-pricing-stub"]').exists()).toBe(true);
    });

    it("should NOT show the import page when route has no action=import", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.showImportModelPricingPage).toBe(false);
      expect(wrapper.find('[data-test="import-model-pricing-stub"]').exists()).toBe(false);
    });
  });

  // ── Conditional rendering ────────────────────────────────────────────────

  describe("conditional rendering", () => {
    it("should render the list header when not showing the import page", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="model-pricing-list-title"]').exists()).toBe(true);
    });

    it("should hide the list view when import page is shown", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.showImportModelPricingPage = true;
      await nextTick();
      expect(wrapper.find('[data-test="model-pricing-list-title"]').exists()).toBe(false);
    });

    it("should render the ODrawer side panel closed by default", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(false);
    });

    it("should pass width=30 to the pricing detail ODrawer", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("width")).toBe(30);
    });
  });

  // ── ODrawer migration (open/close, props, slots) ─────────────────────────

  describe("ODrawer (pricing detail) migration", () => {
    it("should open the ODrawer when openPricingDialog is invoked", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(false);

      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();

      expect(drawer.props("open")).toBe(true);
      expect(wrapper.vm.pricingDialogRow).toEqual(mockModels[0]);
    });

    it("should close the ODrawer when it emits update:open false", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(true);

      drawer.vm.$emit("update:open", false);
      await nextTick();
      expect(drawer.props("open")).toBe(false);
    });

    it("should reopen the ODrawer when it emits update:open true", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // Open via the public method so pricingDialogRow is populated (the
      // drawer's header-left slot reads from it). Then simulate the drawer
      // re-emitting update:open(true) and confirm the binding stays open.
      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      drawer.vm.$emit("update:open", true);
      await nextTick();
      expect(drawer.props("open")).toBe(true);
    });

    it("should render pricing details inside the drawer default slot", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.text()).toContain(mockModels[0].match_pattern);
    });
  });

  // ── selectedTab / tab change ─────────────────────────────────────────────

  describe("tab filtering & selection reset", () => {
    it("should default selectedTab to 'all'", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.selectedTab).toBe("all");
    });

    it("should clear selectedIds when onTabChange is called", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1", "meta-1"];
      wrapper.vm.onTabChange();
      expect(wrapper.vm.selectedIds).toEqual([]);
    });

    it("should only return org-source models when selectedTab is 'org'", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedTab = "org";
      await nextTick();
      const filtered = wrapper.vm.filteredModels;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("org-1");
    });

    it("should return only inherited/built-in models when selectedTab is 'inherited'", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedTab = "inherited";
      await nextTick();
      const filtered = wrapper.vm.filteredModels;
      const ids = filtered.map((m: any) => m.id);
      expect(ids).toContain("meta-1");
      expect(ids).toContain("bi-1");
      expect(ids).not.toContain("org-1");
    });
  });

  // ── Search/filter ────────────────────────────────────────────────────────

  describe("search filtering", () => {
    it("should match by name (case-insensitive)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterQuery = "GPT-4O";
      await nextTick();
      const ids = wrapper.vm.filteredModels.map((m: any) => m.id);
      expect(ids).toContain("org-1");
      expect(ids).not.toContain("meta-1");
    });

    it("should match by match_pattern", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterQuery = "claude";
      await nextTick();
      const ids = wrapper.vm.filteredModels.map((m: any) => m.id);
      expect(ids).toEqual(["meta-1"]);
    });

    it("should return empty list when filter has no matches", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.filterQuery = "no-match-anywhere";
      await nextTick();
      expect(wrapper.vm.filteredModels).toHaveLength(0);
    });
  });

  // ── isReadOnly / getSource ───────────────────────────────────────────────

  describe("source classification", () => {
    it("getSource returns the model's source", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getSource(mockModels[0])).toBe("org");
      expect(wrapper.vm.getSource(mockModels[1])).toBe("meta_org");
      expect(wrapper.vm.getSource(mockModels[2])).toBe("built_in");
    });

    it("getSource falls back to 'org' when source is missing", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getSource({ org_id: "test-org" })).toBe("org");
    });

    it("isReadOnly returns true for built-in models", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.isReadOnly(mockModels[2])).toBe(true);
    });

    it("isReadOnly returns true for models owned by another org", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.isReadOnly(mockModels[1])).toBe(true);
    });

    it("isReadOnly returns false for the current org's models", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.isReadOnly(mockModels[0])).toBe(false);
    });
  });

  // ── Selection helpers ────────────────────────────────────────────────────

  describe("selection", () => {
    it("toggleSelect adds an id when not selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleSelect("org-1");
      expect(wrapper.vm.selectedIds).toEqual(["org-1"]);
    });

    it("toggleSelect removes an id when already selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1", "meta-1"];
      wrapper.vm.toggleSelect("org-1");
      expect(wrapper.vm.selectedIds).toEqual(["meta-1"]);
    });

    it("selectedCount reflects selectedIds length", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["a", "b", "c"];
      await nextTick();
      expect(wrapper.vm.selectedCount).toBe(3);
    });

    it("selectedIdsOnlyContainsOwn is false when nothing is selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.selectedIdsOnlyContainsOwn).toBe(false);
    });

    it("selectedIdsOnlyContainsOwn is true when only org-owned ids are selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1"];
      await nextTick();
      expect(wrapper.vm.selectedIdsOnlyContainsOwn).toBe(true);
    });

    it("selectedIdsOnlyContainsOwn is false when a built-in id is selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1", "bi-1"];
      await nextTick();
      expect(wrapper.vm.selectedIdsOnlyContainsOwn).toBe(false);
    });
  });

  // ── Tree expand/collapse ─────────────────────────────────────────────────

  describe("expandedParents", () => {
    it("toggleExpand adds an id when not expanded", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleExpand("org-1");
      expect(wrapper.vm.expandedParents.has("org-1")).toBe(true);
    });

    it("toggleExpand removes an id when already expanded", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleExpand("org-1");
      wrapper.vm.toggleExpand("org-1");
      expect(wrapper.vm.expandedParents.has("org-1")).toBe(false);
    });
  });

  // ── Formatting helpers ───────────────────────────────────────────────────

  describe("formatPriceKey", () => {
    it("strips trailing _tokens", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.formatPriceKey("input_tokens")).toBe("input");
    });

    it("converts underscores to hyphens", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.formatPriceKey("cached_input")).toBe("cached-input");
    });
  });

  describe("formatPerMillion", () => {
    it("converts per-token price to per-million dollars", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // 0.0000025 * 1_000_000 = 2.50
      expect(wrapper.vm.formatPerMillion(0.0000025)).toBe("$2.50");
    });

    it("returns $0.00 for null", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.formatPerMillion(null)).toBe("$0.00");
    });

    it("returns $0.00 for undefined", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.formatPerMillion(undefined)).toBe("$0.00");
    });

    it("returns $0.00 for zero", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.formatPerMillion(0)).toBe("$0.00");
    });
  });

  describe("getPriceKeyColorClass", () => {
    it("returns badge-blue for input keys", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getPriceKeyColorClass("input")).toBe("badge-blue");
      expect(wrapper.vm.getPriceKeyColorClass("cached_input")).toBe("badge-blue");
    });

    it("returns badge-green for output keys", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getPriceKeyColorClass("output")).toBe("badge-green");
    });

    it("returns a stable hashed palette class for arbitrary keys", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const class1 = wrapper.vm.getPriceKeyColorClass("audio");
      const class2 = wrapper.vm.getPriceKeyColorClass("audio");
      expect(class1).toBe(class2);
      // Should be one of the palette options (badge-something)
      expect(class1.startsWith("badge-")).toBe(true);
    });
  });

  describe("getDefaultTier", () => {
    it("returns the first unconditional tier", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const model = {
        tiers: [
          { condition: "x>1", prices: { input: 0.1 } },
          { condition: null, prices: { input: 0.5 } },
        ],
      };
      expect(wrapper.vm.getDefaultTier(model).prices.input).toBe(0.5);
    });

    it("falls back to tiers[0] when no unconditional tier exists", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const model = { tiers: [{ condition: "x>1", prices: { input: 0.1 } }] };
      expect(wrapper.vm.getDefaultTier(model).prices.input).toBe(0.1);
    });

    it("returns undefined when tiers is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.getDefaultTier({ tiers: [] })).toBeUndefined();
    });
  });

  describe("getVisiblePrices / getOverflowCount", () => {
    it("returns at most 2 visible prices", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const model = {
        tiers: [
          {
            condition: null,
            prices: { input: 0.1, output: 0.2, audio: 0.3, image: 0.4 },
          },
        ],
      };
      expect(Object.keys(wrapper.vm.getVisiblePrices(model))).toHaveLength(2);
    });

    it("reports overflow count for prices beyond the first 2", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const model = {
        tiers: [
          {
            condition: null,
            prices: { input: 0.1, output: 0.2, audio: 0.3, image: 0.4 },
          },
        ],
      };
      expect(wrapper.vm.getOverflowCount(model)).toBe(2);
    });

    it("returns overflow 0 when there are no prices", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const model = { tiers: [{ condition: null, prices: {} }] };
      expect(wrapper.vm.getOverflowCount(model)).toBe(0);
    });
  });

  describe("sortedPriceEntries", () => {
    it("sorts with input before output", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const out = wrapper.vm.sortedPriceEntries({ output: 0.2, input: 0.1 });
      expect(out[0][0]).toBe("input");
      expect(out[1][0]).toBe("output");
    });

    it("sorts other keys alphabetically after known ones", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const out = wrapper.vm.sortedPriceEntries({ output: 0.2, input: 0.1, audio: 0.3 });
      expect(out.map((e: any) => e[0])).toEqual(["input", "output", "audio"]);
    });
  });

  // ── pagination changePagination ──────────────────────────────────────────

  describe("pagination", () => {
    it("changePagination updates rowsPerPage", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // The mounted q-table stub doesn't implement setPagination — null the
      // ref so the optional-chained call short-circuits and we can assert on
      // the local state update.
      wrapper.vm.qTableRef = null;
      wrapper.vm.changePagination({ label: "50", value: 50 });
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });

    it("changePagination calls setPagination on the table ref when present", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const setPagination = vi.fn();
      wrapper.vm.qTableRef = { setPagination };
      wrapper.vm.changePagination({ label: "100", value: 100 });
      expect(setPagination).toHaveBeenCalledWith({ rowsPerPage: 100 });
    });
  });

  // ── Router-driven actions (openEditor / duplicate / openImport) ─────────

  describe("router navigation", () => {
    it("openEditor with a model navigates with id", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.openEditor(mockModels[0]);
      expect(routerPushMock).toHaveBeenCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org", id: "org-1" },
      });
    });

    it("openEditor with null navigates without id (new model)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.openEditor(null);
      expect(routerPushMock).toHaveBeenCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org" },
      });
    });

    it("duplicateModel navigates with duplicate=true", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.duplicateModel(mockModels[0]);
      expect(routerPushMock).toHaveBeenCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org", id: "org-1", duplicate: "true" },
      });
    });

    it("openImport sets showImportModelPricingPage and pushes route", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.openImport();
      expect(wrapper.vm.showImportModelPricingPage).toBe(true);
      expect(routerPushMock).toHaveBeenCalledWith({
        name: "modelPricing",
        query: { org_identifier: "test-org", action: "import" },
      });
    });
  });

  // ── confirmDelete + delete flow ──────────────────────────────────────────

  describe("confirmDelete", () => {
    it("opens the confirm dialog with title/message populated", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockModels[0]);
      await nextTick();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
      expect(wrapper.vm.confirmDialogMeta.title).toBe("Delete model?");
      expect(wrapper.vm.confirmDialogMeta.message).toContain(mockModels[0].name);
    });

    it("calls modelPricingService.delete and notifies on confirm", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockModels[0]);
      await nextTick();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      expect(modelPricingService.delete).toHaveBeenCalledWith("test-org", "org-1");
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("notifies error (and skips success notify) when delete fails", async () => {
      vi.mocked(modelPricingService.delete).mockRejectedValueOnce(
        new Error("boom"),
      );
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockModels[0]);
      await nextTick();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
    });

    it("does not notify when API returns 403 (silenced by global interceptor)", async () => {
      vi.mocked(modelPricingService.delete).mockRejectedValueOnce({
        response: { status: 403, data: { message: "forbidden" } },
      });
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockModels[0]);
      await nextTick();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      const negativeCalls = notifyMock.mock.calls.filter(
        (c) => c[0]?.type === "negative",
      );
      expect(negativeCalls).toHaveLength(0);
    });
  });

  describe("resetConfirmDialog", () => {
    it("closes the confirm dialog", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.confirmDialogMeta.show = true;
      wrapper.vm.resetConfirmDialog();
      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
    });

    it("is triggered when ConfirmDialog emits update:cancel", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.confirmDialogMeta.show = true;
      await nextTick();

      await wrapper.find('[data-test="confirm-dialog-cancel"]').trigger("click");
      await nextTick();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(false);
    });
  });

  // ── toggleEnabled ────────────────────────────────────────────────────────

  describe("toggleEnabled", () => {
    it("PUTs the cleaned model with the new enabled flag", async () => {
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.vm.toggleEnabled(mockModels[0], false);
      await flushPromises();

      expect(modelPricingService.update).toHaveBeenCalledWith(
        "test-org",
        "org-1",
        expect.objectContaining({ id: "org-1", enabled: false }),
      );
    });

    it("strips __sectionStart before sending to the API", async () => {
      wrapper = mountComponent();
      await flushPromises();

      const tagged = { ...orgModel(), __sectionStart: "org" };
      await wrapper.vm.toggleEnabled(tagged, true);
      await flushPromises();

      const sentPayload = vi.mocked(modelPricingService.update).mock.calls[0][2];
      expect("__sectionStart" in sentPayload).toBe(false);
    });

    it("notifies positive on success", async () => {
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.vm.toggleEnabled(mockModels[0], true);
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("notifies negative when update fails", async () => {
      vi.mocked(modelPricingService.update).mockRejectedValueOnce(
        new Error("update fail"),
      );
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.vm.toggleEnabled(mockModels[0], false);
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
    });
  });

  // ── refreshBuiltIn ───────────────────────────────────────────────────────

  describe("refreshBuiltIn", () => {
    it("sets refreshing to true while running and false after", async () => {
      let resolveFn: any;
      vi.mocked(modelPricingService.refreshBuiltIn).mockImplementationOnce(
        () => new Promise((r) => (resolveFn = r)),
      );
      wrapper = mountComponent();
      await flushPromises();

      const promise = wrapper.vm.refreshBuiltIn();
      await nextTick();
      expect(wrapper.vm.refreshing).toBe(true);

      resolveFn({});
      await promise;
      await flushPromises();
      expect(wrapper.vm.refreshing).toBe(false);
    });

    it("notifies positive and refetches on success", async () => {
      wrapper = mountComponent();
      await flushPromises();
      vi.mocked(modelPricingService.list).mockClear();

      await wrapper.vm.refreshBuiltIn();
      await flushPromises();

      expect(modelPricingService.refreshBuiltIn).toHaveBeenCalledWith("test-org");
      expect(modelPricingService.list).toHaveBeenCalled();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("notifies negative when refresh fails", async () => {
      wrapper = mountComponent();
      await flushPromises();
      vi.mocked(modelPricingService.refreshBuiltIn).mockRejectedValueOnce(
        new Error("nope"),
      );

      await wrapper.vm.refreshBuiltIn();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
      expect(wrapper.vm.refreshing).toBe(false);
    });
  });

  // ── fetchModels error path ───────────────────────────────────────────────

  describe("fetchModels errors", () => {
    it("notifies negative when list() rejects", async () => {
      vi.mocked(modelPricingService.list).mockRejectedValueOnce(
        new Error("network"),
      );
      wrapper = mountComponent();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
      expect(wrapper.vm.loading).toBe(false);
    });

    it("does not notify when list() returns 403", async () => {
      vi.mocked(modelPricingService.list).mockRejectedValueOnce({
        response: { status: 403, data: { message: "forbidden" } },
      });
      wrapper = mountComponent();
      await flushPromises();

      const negativeCalls = notifyMock.mock.calls.filter(
        (c) => c[0]?.type === "negative",
      );
      expect(negativeCalls).toHaveLength(0);
    });
  });

  // ── Export ───────────────────────────────────────────────────────────────

  describe("exportSelected", () => {
    let createObjectURLSpy: any;
    let revokeObjectURLSpy: any;
    let clickMock: any;
    let origCreateElement: any;

    beforeEach(() => {
      createObjectURLSpy = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob://mock");
      revokeObjectURLSpy = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => {});
      clickMock = vi.fn();
      origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "a") {
          return { href: "", download: "", click: clickMock } as any;
        }
        return origCreateElement(tag);
      });
    });

    afterEach(() => {
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
      (document.createElement as any).mockRestore?.();
    });

    it("warns when nothing is selected", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.exportSelected();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning" }),
      );
      expect(clickMock).not.toHaveBeenCalled();
    });

    it("triggers a download when selection is non-empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1"];
      await nextTick();

      wrapper.vm.exportSelected();

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(clickMock).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob://mock");
    });
  });

  // ── confirmDeleteSelected ────────────────────────────────────────────────

  describe("confirmDeleteSelected", () => {
    it("opens the confirm dialog with the count message", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1"];
      wrapper.vm.confirmDeleteSelected();

      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
      expect(wrapper.vm.confirmDialogMeta.message).toContain("1");
    });

    it("calls delete for each selected id and clears the selection on success", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1", "meta-1"];

      wrapper.vm.confirmDeleteSelected();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      expect(modelPricingService.delete).toHaveBeenCalledTimes(2);
      expect(wrapper.vm.selectedIds).toEqual([]);
    });

    it("keeps selection unchanged when every delete fails", async () => {
      vi.mocked(modelPricingService.delete).mockRejectedValue(new Error("nope"));
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1"];

      wrapper.vm.confirmDeleteSelected();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      expect(wrapper.vm.selectedIds).toEqual(["org-1"]);
    });
  });

  // ── Computed: ooLogo (theme reaction) ────────────────────────────────────

  describe("ooLogo computed", () => {
    it("uses the light-theme icon when theme is light", async () => {
      wrapper = mountComponent({ store: createMockStore("light") });
      await flushPromises();
      expect(wrapper.vm.ooLogo).toContain("openobserve_favicon.png");
    });

    it("uses the dark-theme icon when theme is dark", async () => {
      wrapper = mountComponent({ store: createMockStore("dark") });
      await flushPromises();
      expect(wrapper.vm.ooLogo).toContain("openobserve_favicon_dark.ico");
    });
  });

  // ── customSort ───────────────────────────────────────────────────────────

  describe("customSort", () => {
    it("returns the input unchanged when sortBy is empty", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const rows = [orgModel({ id: "a", name: "Zebra" }), orgModel({ id: "b", name: "Apple" })];
      expect(wrapper.vm.customSort(rows, "", false)).toBe(rows);
    });

    it("sorts org rows by name ascending", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const rows = [
        orgModel({ id: "a", name: "Zebra" }),
        orgModel({ id: "b", name: "Apple" }),
      ];
      const sorted = wrapper.vm.customSort(rows, "name", false);
      expect(sorted.map((r: any) => r.id)).toEqual(["b", "a"]);
    });

    it("sorts descending when flag is true", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const rows = [
        orgModel({ id: "a", name: "Apple" }),
        orgModel({ id: "b", name: "Zebra" }),
      ];
      const sorted = wrapper.vm.customSort(rows, "name", true);
      expect(sorted.map((r: any) => r.id)).toEqual(["b", "a"]);
    });
  });

  // ── allSelected / someSelected / toggleSelectAll ─────────────────────────

  describe("select-all behaviour", () => {
    it("toggleSelectAll selects all page rows when nothing is selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedTab = "all";
      await nextTick();

      wrapper.vm.toggleSelectAll();
      await nextTick();

      // current page has all 3 parents (no expanded children)
      expect(wrapper.vm.selectedIds.length).toBe(3);
    });

    it("toggleSelectAll clears selection when everything on the page is already selected", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.toggleSelectAll();
      await nextTick();
      expect(wrapper.vm.selectedIds.length).toBeGreaterThan(0);

      wrapper.vm.toggleSelectAll();
      await nextTick();
      expect(wrapper.vm.selectedIds).toEqual([]);
    });
  });

  // ── ImportModelPricing integration ───────────────────────────────────────

  describe("ImportModelPricing integration", () => {
    it("hides the import view when ImportModelPricing emits cancel:hideform", async () => {
      wrapper = mountComponent({ query: { action: "import" } });
      await flushPromises();
      expect(wrapper.vm.showImportModelPricingPage).toBe(true);

      const importStub = wrapper.findComponent(ImportModelPricingStub);
      await importStub.vm.$emit("cancel:hideform");
      await nextTick();

      expect(wrapper.vm.showImportModelPricingPage).toBe(false);
    });

    it("refetches models when ImportModelPricing emits update:list", async () => {
      wrapper = mountComponent({ query: { action: "import" } });
      await flushPromises();
      vi.mocked(modelPricingService.list).mockClear();

      const importStub = wrapper.findComponent(ImportModelPricingStub);
      await importStub.vm.$emit("update:list");
      await flushPromises();

      expect(modelPricingService.list).toHaveBeenCalled();
    });
  });
});
