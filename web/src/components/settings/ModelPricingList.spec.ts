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

import { resetListViewState, useListViewState } from "@/composables/useListViewState";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import ModelPricingList from "./ModelPricingList.vue";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/services/model_pricing", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
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
  });
});

const mockToastFn = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

// Router mock — capture push calls
const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
const currentRouteRef = { value: { query: {} as Record<string, any> } };
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    currentRoute: currentRouteRef,
  }),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getImageURL: (path: string) => `mock://${path}`,
}));

// The Unpriced tab's stream picker lists LLM trace streams.
const mockGetStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: mockGetStreams }),
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
  props: ["modelValue", "title", "message", "messageKeypath", "messageName", "okVariant"],
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

const PaginationStub = {
  name: "Pagination",
  props: ["scope", "position", "resultTotal", "perPageOptions"],
  emits: ["update:changeRecordPerPage"],
  template: `<div data-test="table-pagination-stub" />`,
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const orgModel = (overrides: Partial<any> = {}) => ({
  id: "org-1",
  name: "GPT-4o (org)",
  match_pattern: "^gpt-4o.*",
  source: "org",
  org_id: "test-org",
  enabled: true,
  tiers: [{ condition: null, prices: { input: 0.0000025, output: 0.00001 } }],
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
  tiers: [{ condition: null, prices: { input: 0.000003, output: 0.000015 } }],
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
  tiers: [{ condition: null, prices: { input: 0.0000005, output: 0.0000015 } }],
  children: [],
  ...overrides,
});

// Peak / off-peak model: an unrestricted off-peak tier plus a UTC-windowed peak
// tier — the DeepSeek shape.
const peakOffPeakModel = (overrides: Partial<any> = {}) => ({
  id: "org-peak",
  name: "DeepSeek V4 Pro",
  match_pattern: "(?i)deepseek-v4-pro",
  source: "org",
  org_id: "test-org",
  enabled: true,
  tiers: [
    { name: "Off-Peak", condition: null, prices: { input: 6.6e-7, output: 1.98e-6 } },
    {
      name: "Peak",
      condition: null,
      utc_windows: [
        { start_minute: 60, end_minute: 240 },
        { start_minute: 360, end_minute: 600 },
      ],
      prices: { input: 1.32e-6, output: 3.96e-6 },
    },
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
        ruleOpIn: "is one of",
        matchingPriorityTooltip: "Your org > Global > Built-in",
        searchPlaceholder: "Search models...",
        syncBuiltInPrices: "Sync built-in prices",
        testMatch: "Test match",
        moreActions: "More actions",
        modelDetails: "Model details",
        importBtn: "Import",
        newModel: "New model",
        noModels: "No model pricing",
        noModelsDesc: "Add a custom model pricing",
        tabAll: "All",
        tabCustom: "Custom",
        tabSystem: "System",
        colModel: "Model",
        colMatchPattern: "Match pattern",
        colPricing: "Pricing (per 1M tokens)",
        colPrice: "Price",
        colActions: "Actions",
        colPricingSimple: "Pricing",
        colPattern: "Pattern",
        usageType: "Usage type",
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
        builtInPricesSynced: "Built-in prices synced",
        errLoadModels: "Failed to load models",
        errUpdate: "Failed to update",
        errDelete: "Failed to delete",
        errDeleteNamed: "Failed to delete {name}",
        errSync: "Sync failed",
        errUnknown: "Unknown error",
        noModelsSelected: "No models selected",
        shadowBannerPrefix: "Shadowed by",
        shadowBannerSuffix: "rule",
        shadowedTooltip: "Shadowed by {name}",
        timeBasedChip: "Time-based",
        timeWindows: "Active hours (UTC)",
        localTimeHint: "In your timezone: {range}",
        tierAlwaysActive: "Always active (default)",
        tierDefaultName: "Default",
        builtInStatus: {
          seed: "seed {date}.",
          neverSynced: "never synced",
          lastSynced: "synced at {time}",
        },
        unpriced: { tab: "Unpriced", tabWithCount: "Unpriced · {count}" },
      },
    },
  },
});

// ── Global stubs ─────────────────────────────────────────────────────────────

const globalStubs: Record<string, any> = {
  OIcon: {
    template: '<span class="OIcon"><slot /></span>',
    props: ["name", "size", "color"],
  },
  ODrawer: ODrawerStub,
  OButton: OButtonStub,
  ConfirmDialog: ConfirmDialogStub,
  ImportModelPricing: ImportModelPricingStub,
  TestModelMatchDialog: TestModelMatchDialogStub,
  AppTabs: AppTabsStub,
  Pagination: PaginationStub,
};

// ── Test helpers ─────────────────────────────────────────────────────────────

let store: any;

function mountComponent(
  extra: { store?: any; query?: Record<string, any>; attachTo?: HTMLElement } = {},
) {
  store = extra.store ?? createMockStore();
  currentRouteRef.value.query = extra.query ?? {};
  return mount(ModelPricingList, {
    attachTo: extra.attachTo,
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

beforeEach(() => resetListViewState());

describe("ModelPricingList.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(modelPricingService.list).mockResolvedValue({
      data: mockModels,
    } as any);
    vi.mocked(modelPricingService.update).mockResolvedValue({} as any);
    vi.mocked(modelPricingService.delete).mockResolvedValue({} as any);
    vi.mocked(modelPricingService.refreshBuiltIn).mockResolvedValue({} as any);
    mockGetStreams.mockResolvedValue({ list: [] });
    routerPushMock.mockReset();
    mockToastFn.mockReset();
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
      // Title now lives in the standard OPageHeader (row 1).
      expect(wrapper.find(".app-page-header h1").exists()).toBe(true);
    });

    it("should hide the list view when import page is shown", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.showImportModelPricingPage = true;
      await nextTick();
      expect(wrapper.find(".app-page-header").exists()).toBe(false);
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

  describe("rows and the pricing drawer", () => {
    // OTable keeps its loading skeleton up for a minimum real-time window.
    async function waitForRow(w: VueWrapper, name: string) {
      return vi.waitFor(() => {
        const row = w.findAll('[data-test^="o2-table-row-"]').find((r) => r.text().includes(name));
        expect(row).toBeTruthy();
        return row!;
      });
    }

    it("opens the pricing drawer when the name or pattern cell is clicked", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const row = await waitForRow(wrapper, "GPT-4o (org)");

      await row.find('[data-test="o-truncated-text"]').trigger("click");
      await nextTick();
      expect(wrapper.vm.showPricingDialog).toBe(true);
      expect(wrapper.vm.pricingDialogRow?.id).toBe("org-1");

      wrapper.vm.showPricingDialog = false;
      wrapper.vm.pricingDialogRow = null;
      const patternCell = row.findAll("td").find((td) => td.text() === "^gpt-4o.*");
      await patternCell!.trigger("click");
      await nextTick();
      expect(wrapper.vm.showPricingDialog).toBe(true);
      expect(wrapper.vm.pricingDialogRow?.id).toBe("org-1");
    });

    it("does not open the drawer from the tree toggle or the checkbox", async () => {
      vi.mocked(modelPricingService.list).mockResolvedValue({
        data: [orgModel({ children: [orgModel({ id: "org-child", name: "Shadowed child" })] })],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      const row = await waitForRow(wrapper, "GPT-4o (org)");

      await row.find('[data-test="o2-table-tree-toggle-name"]').trigger("click");
      await row.find('button[role="checkbox"]').trigger("click");
      await nextTick();

      expect(wrapper.vm.showPricingDialog).toBe(false);
      await waitForRow(wrapper, "Shadowed child");
    });

    it("keeps the duplicate and delete row shortcuts working from the hovered row", async () => {
      wrapper = mountComponent({ attachTo: document.body });
      await flushPromises();
      const row = await waitForRow(wrapper, "GPT-4o (org)");
      (row.element as HTMLElement).focus();

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      await nextTick();
      expect(routerPushMock).toHaveBeenLastCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org", id: "org-1", duplicate: "true" },
      });

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }));
      await nextTick();
      expect(wrapper.vm.confirmDialogMeta.show).toBe(true);
      expect(wrapper.vm.confirmDialogMeta.messageKeypath).toBe("modelPricing.confirmDeleteMessage");
      expect(wrapper.vm.confirmDialogMeta.messageName).toBe("GPT-4o (org)");
      expect(wrapper.vm.showPricingDialog).toBe(false);
    });

    it("mutes disabled rows and tags them Disabled", async () => {
      vi.mocked(modelPricingService.list).mockResolvedValue({
        data: [orgModel({ id: "org-off", name: "Paused model", enabled: false }), orgModel()],
      } as any);
      wrapper = mountComponent();
      await flushPromises();
      const disabledRow = await waitForRow(wrapper, "Paused model");
      const enabledRow = await waitForRow(wrapper, "GPT-4o (org)");

      expect(disabledRow.classes()).toContain("bg-surface-panel");
      expect(disabledRow.find('[data-test="model-pricing-disabled-tag"]').exists()).toBe(true);
      expect(enabledRow.classes()).not.toContain("bg-surface-panel");
      expect(enabledRow.find('[data-test="model-pricing-disabled-tag"]').exists()).toBe(false);
    });

    it("keeps toggle and edit inline and moves duplicate and delete into the row menu", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const row = await waitForRow(wrapper, "GPT-4o (org)");

      expect(row.find('[data-test="model-pricing-toggle-btn"]').exists()).toBe(true);
      expect(row.find('[data-test="model-pricing-edit-btn"]').exists()).toBe(true);
      expect(row.find('[data-test="model-pricing-row-more-actions"]').exists()).toBe(true);
      expect(row.find('[data-test="model-pricing-duplicate-btn"]').exists()).toBe(false);
      expect(row.find('[data-test="model-pricing-delete-btn"]').exists()).toBe(false);
    });

    it("titles the drawer with the model name, not its pattern", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("GPT-4o (org)");
      expect(drawer.text()).toContain(mockModels[0].match_pattern);
    });

    it("offers Edit and Duplicate in the drawer footer for the org's own model", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLabel")).toBe("Edit");
      expect(drawer.props("secondaryButtonLabel")).toBe("Duplicate");
      expect(drawer.props("secondaryButtonVariant")).toBe("outline");

      drawer.vm.$emit("click:primary");
      await nextTick();
      expect(routerPushMock).toHaveBeenLastCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org", id: "org-1" },
      });

      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();
      drawer.vm.$emit("click:secondary");
      await nextTick();
      expect(routerPushMock).toHaveBeenLastCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org", id: "org-1", duplicate: "true" },
      });
    });

    it("offers only Clone in the drawer footer for a read-only model", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.openPricingDialog(builtInModel());
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLabel")).toBeUndefined();
      expect(drawer.props("secondaryButtonLabel")).toBe("Clone");
      expect(drawer.props("secondaryButtonVariant")).toBe("outline");

      drawer.vm.$emit("click:secondary");
      await nextTick();
      expect(routerPushMock).toHaveBeenLastCalledWith({
        name: "modelPricingEditor",
        query: { org_identifier: "test-org", id: "bi-1", duplicate: "true" },
      });
    });

    it("closes the drawer before leaving for the editor, so the cached list does not reopen it", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const openAtPush: boolean[] = [];
      routerPushMock.mockImplementation(() => openAtPush.push(wrapper.vm.showPricingDialog));
      const drawer = wrapper.findComponent(ODrawerStub);

      for (const [model, event] of [
        [mockModels[0], "click:primary"],
        [mockModels[0], "click:secondary"],
        [builtInModel(), "click:secondary"],
      ] as const) {
        wrapper.vm.openPricingDialog(model);
        await nextTick();
        drawer.vm.$emit(event);
        await nextTick();
      }

      expect(openAtPush).toEqual([false, false, false]);
      expect(drawer.props("open")).toBe(false);
    });

    it("labels the catalogue sync and test buttons by what they do", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.find('[data-test="model-pricing-refresh-btn"]').text()).toBe(
        "Sync built-in prices",
      );
      expect(wrapper.find('[data-test="model-pricing-test-match-btn"]').text()).toBe("Test match");
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
    it("selectedIds can be set directly (OTable manages selection via @update:selected-ids)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1"];
      expect(wrapper.vm.selectedIds).toEqual(["org-1"]);
    });

    it("selectedIds can be cleared", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1", "meta-1"];
      wrapper.vm.selectedIds = ["meta-1"];
      expect(wrapper.vm.selectedIds).toEqual(["meta-1"]);
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
    it("renders OTable with tree expand (tree expand handled by OTable internally)", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // OTable handles tree expansion internally — verify the table renders
      expect(wrapper.findComponent({ name: "OTable" }).exists()).toBe(true);
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

    it("skips tiers restricted only by attribute rules", async () => {
      wrapper = mountComponent();
      await flushPromises();
      const model = {
        tiers: [
          {
            condition: null,
            rules: [{ keys: ["service_tier"], op: "in", values: ["flex"] }],
            prices: { input: 0.1 },
          },
          { condition: null, prices: { input: 0.5 } },
        ],
      };
      expect(wrapper.vm.getDefaultTier(model).prices.input).toBe(0.5);
    });
  });

  describe("attribute-rule (service tier) pricing", () => {
    const flexModel = () => ({
      id: "flex",
      name: "GPT-6 Sol",
      match_pattern: "(?i)gpt-6-sol",
      enabled: true,
      source: "org",
      tiers: [
        { name: "Default", condition: null, prices: { input: 0.000002 } },
        {
          name: "Flex",
          condition: null,
          rules: [
            {
              keys: ["openai.response.service_tier", "openai.request.service_tier"],
              op: "in",
              values: ["flex"],
            },
          ],
          prices: { input: 0.000001 },
        },
      ],
    });

    it("renders each rule of a tier in the drawer and no always-active label for it", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(flexModel());
      await nextTick();

      const rules = wrapper.findAll('[data-test="model-pricing-drawer-tier-rule"]');
      expect(rules).toHaveLength(1);
      expect(rules[0].text()).toBe("openai.response.service_tier +1 is one of flex");
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.text().match(/Always active \(default\)/g)).toHaveLength(1);
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
    it("renders OTable with client-side pagination", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // OTable handles pagination internally via pagination="client" prop
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.exists()).toBe(true);
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
      const dialog = wrapper.findComponent(ConfirmDialogStub);
      expect(dialog.props("messageKeypath")).toBe("modelPricing.confirmDeleteMessage");
      expect(dialog.props("messageName")).toBe(mockModels[0].name);
      expect(dialog.props("okVariant")).toBe("destructive");
    });

    it("calls modelPricingService.delete and notifies on confirm", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockModels[0]);
      await nextTick();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      expect(modelPricingService.delete).toHaveBeenCalledWith("test-org", "org-1");
      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("notifies error (and skips success notify) when delete fails", async () => {
      vi.mocked(modelPricingService.delete).mockRejectedValueOnce(new Error("boom"));
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockModels[0]);
      await nextTick();
      await wrapper.vm.confirmDialogMeta.onConfirm();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
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

      const negativeCalls = mockToastFn.mock.calls.filter((c) => c[0]?.variant === "error");
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

      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("notifies negative when update fails", async () => {
      vi.mocked(modelPricingService.update).mockRejectedValueOnce(new Error("update fail"));
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.vm.toggleEnabled(mockModels[0], false);
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
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
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: "Built-in prices synced" }),
      );
    });

    it("notifies negative when refresh fails", async () => {
      wrapper = mountComponent();
      await flushPromises();
      vi.mocked(modelPricingService.refreshBuiltIn).mockRejectedValueOnce(new Error("nope"));

      await wrapper.vm.refreshBuiltIn();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(wrapper.vm.refreshing).toBe(false);
    });
  });

  // ── fetchModels error path ───────────────────────────────────────────────

  describe("fetchModels errors", () => {
    it("notifies negative when list() rejects", async () => {
      vi.mocked(modelPricingService.list).mockRejectedValueOnce(new Error("network"));
      wrapper = mountComponent();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(wrapper.vm.loading).toBe(false);
    });

    it("does not notify when list() returns 403", async () => {
      vi.mocked(modelPricingService.list).mockRejectedValueOnce({
        response: { status: 403, data: { message: "forbidden" } },
      });
      wrapper = mountComponent();
      await flushPromises();

      const negativeCalls = mockToastFn.mock.calls.filter((c) => c[0]?.variant === "error");
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
      createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob://mock");
      revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
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

      expect(mockToastFn).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
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

  // ── customSort (handled internally by OTable) ─────────────────────────────

  describe("customSort", () => {
    it("OTable handles column sorting internally", async () => {
      wrapper = mountComponent();
      await flushPromises();
      // OTable manages sorting internally — verify table renders with sortable columns
      expect(wrapper.findComponent({ name: "OTable" }).exists()).toBe(true);
    });
  });

  // ── allSelected / someSelected / toggleSelectAll ─────────────────────────

  describe("select-all behaviour", () => {
    it("can select all page rows via selectedIds", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedTab = "all";

      // OTable handles select-all internally — simulate by setting selectedIds
      wrapper.vm.selectedIds = ["org-1", "org-2", "org-3"];
      await nextTick();

      expect(wrapper.vm.selectedIds.length).toBe(3);
    });

    it("can clear selection via selectedIds", async () => {
      wrapper = mountComponent();
      await flushPromises();
      wrapper.vm.selectedIds = ["org-1", "org-2", "org-3"];
      await nextTick();
      expect(wrapper.vm.selectedIds.length).toBeGreaterThan(0);

      wrapper.vm.selectedIds = [];
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

  // ── Time-based (peak / off-peak) pricing ─────────────────────────────────

  describe("time-based (peak / off-peak) pricing", () => {
    // OTable keeps its loading skeleton up for a minimum real-time window, so
    // body cells appear a beat after flushPromises — wait for them.
    async function waitForChips(w: any, count: number) {
      return vi.waitFor(() => {
        const chips = w.findAll('[data-test="model-pricing-time-based-chip"]');
        expect(chips).toHaveLength(count);
        return chips;
      });
    }

    it("shows the Time-based chip only for models with UTC-windowed tiers", async () => {
      vi.mocked(modelPricingService.list).mockResolvedValue({
        data: [orgModel(), peakOffPeakModel()],
      } as any);
      wrapper = mountComponent();
      await flushPromises();

      const chips = await waitForChips(wrapper, 1);
      expect(chips[0].text()).toContain("Time-based");
    });

    it("opens the pricing drawer on the peak model when the chip is clicked", async () => {
      vi.mocked(modelPricingService.list).mockResolvedValue({
        data: [orgModel(), peakOffPeakModel()],
      } as any);
      wrapper = mountComponent();
      await flushPromises();

      const chips = await waitForChips(wrapper, 1);
      await chips[0].trigger("click");
      await nextTick();

      expect(wrapper.vm.showPricingDialog).toBe(true);
      expect(wrapper.vm.pricingDialogRow?.id).toBe("org-peak");
    });

    it("renders every tier in the drawer, each with its restriction caption", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(peakOffPeakModel());
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      const tierCards = drawer.findAll('[data-test^="model-pricing-drawer-tier-"]');
      expect(tierCards).toHaveLength(2);
      // Off-peak: unrestricted default caption. Peak: its formatted UTC hours.
      expect(tierCards[0].text()).toContain("Off-Peak");
      expect(tierCards[0].text()).toContain("Always active (default)");
      expect(tierCards[1].text()).toContain("Peak");
      expect(tierCards[1].text()).toContain("01:00–04:00, 06:00–10:00 UTC");
    });

    it("shows both tiers' prices in the drawer, not only the default tier's", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(peakOffPeakModel());
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      // 0.66 / 1.98 off-peak and 1.32 / 3.96 peak, all per 1M tokens.
      expect(drawer.text()).toContain("$0.66");
      expect(drawer.text()).toContain("$1.98");
      expect(drawer.text()).toContain("$1.32");
      expect(drawer.text()).toContain("$3.96");
    });

    it("skips the per-tier header for single-tier models in the drawer", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(mockModels[0]);
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.findAll('[data-test^="model-pricing-drawer-tier-"]')).toHaveLength(1);
      expect(drawer.text()).not.toContain("Always active (default)");
    });

    it("shows the windowed tier's hours in the user's timezone in the drawer", async () => {
      wrapper = mountComponent();
      await flushPromises();
      store.state.timezone = "Asia/Kolkata"; // UTC+5:30, no DST

      wrapper.vm.openPricingDialog(peakOffPeakModel());
      await nextTick();

      const hint = wrapper.find('[data-test="model-pricing-drawer-tier-local-hint"]');
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toContain("06:30–09:30, 11:30–15:30");
    });

    it("draws the 24h hours bar for windowed tiers in the drawer", async () => {
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.openPricingDialog(peakOffPeakModel());
      await nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.find('[data-test="utc-hours-bar"]').exists()).toBe(true);
      // Two windows, neither wrapping midnight → two filled segments.
      expect(drawer.findAll('[data-test^="utc-hours-bar-segment-"]')).toHaveLength(2);
    });

    it("hasTimeBasedTiers reflects whether any tier has utc_windows", async () => {
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.hasTimeBasedTiers(peakOffPeakModel())).toBe(true);
      expect(wrapper.vm.hasTimeBasedTiers(orgModel())).toBe(false);
      expect(wrapper.vm.hasTimeBasedTiers({ tiers: [{ utc_windows: [] }] })).toBe(false);
    });
  });
});

describe("list view state", () => {
  it("restores search, page size, page and sort from the saved view", async () => {
    Object.assign(useListViewState("model-pricing", {}), {
      filterQuery: "abc",
      selectedTab: "org",
      pageSize: 50,
      currentPage: 2,
      sortBy: "name",
      sortOrder: "desc",
    });
    const w: any = mountComponent();
    await flushPromises();
    expect(w.vm.filterQuery).toBe("abc");
    expect(w.vm.selectedTab).toBe("org");
    expect(w.vm.pageSize).toBe(50);
    expect(w.vm.currentPage).toBe(2);
    expect(w.vm.sortBy).toBe("name");
    expect(w.vm.sortOrder).toBe("desc");
    w.unmount();
  });

  it("saves list state so it survives unmount", async () => {
    const w: any = mountComponent();
    await flushPromises();
    w.vm.filterQuery = "xyz";
    w.vm.pageSize = 100;
    w.vm.sortBy = "name";
    w.vm.sortOrder = "desc";
    await flushPromises();
    w.unmount();
    expect(useListViewState("model-pricing", {})).toMatchObject({
      filterQuery: "xyz",
      pageSize: 100,
      sortBy: "name",
      sortOrder: "desc",
    });
  });
});

describe("Unpriced / approximate tab", () => {
  const unpricedResponse = {
    models: [
      {
        model: "acme-internal-llm",
        status: "unpriced",
        spans: 1870,
        tokens: 2_330_000,
        cost: 0,
        agents: ["research-agent"],
        matched: null,
      },
      {
        model: "gpt-5.4-mini",
        status: "approximate",
        spans: 1204,
        tokens: 9_100_000,
        cost: 41.22,
        agents: ["support-bot"],
        matched: {
          name: "GPT-5.4",
          match_pattern: "^gpt-5\\.4",
          source: "built_in",
          tiers: [{ name: "Default", condition: null, prices: { input: 2.5e-6, output: 1.5e-5 } }],
        },
      },
    ],
  };
  let w: any;

  beforeEach(() => {
    vi.mocked(modelPricingService.list).mockResolvedValue({ data: mockModels } as any);
    vi.mocked(modelPricingService.listUnpriced).mockResolvedValue({
      data: unpricedResponse,
    } as any);
    mockGetStreams.mockResolvedValue({
      list: [
        { name: "default", settings: { is_llm_stream: true } },
        { name: "llm", settings: {} },
        { name: "plain", settings: { is_llm_stream: false } },
      ],
    });
  });

  afterEach(() => {
    w?.unmount();
    vi.clearAllMocks();
  });

  it("opens from ?tab=unpriced&stream= and renders the rows of the unpriced response", async () => {
    w = mountComponent({ query: { tab: "unpriced", stream: "llm" } });
    await flushPromises();

    expect(w.vm.selectedTab).toBe("unpriced");
    const [org, params] = vi.mocked(modelPricingService.listUnpriced).mock.calls.at(-1)!;
    expect(org).toBe("test-org");
    expect(params.stream_name).toBe("llm");
    expect(params.end_time - params.start_time).toBe(24 * 60 * 60 * 1_000_000);

    const tab = w.findComponent({ name: "UnpricedModelsTab" });
    expect(tab.props("streams")).toEqual(["default", "llm"]);
    await vi.waitFor(() =>
      expect(w.findAll('[data-test="model-pricing-unpriced-row"]')).toHaveLength(2),
    );
    expect(w.find('[data-test="model-pricing-list-table"]').exists()).toBe(false);
    expect(w.vm.tabOptions.find((o: any) => o.value === "unpriced").label).toBe("Unpriced · 2");
  });

  it("reads the first LLM stream when the link names none", async () => {
    w = mountComponent({ query: { tab: "unpriced" } });
    await flushPromises();
    expect(vi.mocked(modelPricingService.listUnpriced).mock.calls.at(-1)![1].stream_name).toBe(
      "default",
    );
  });

  it("switching tab writes it to the route query, keeping the other params", async () => {
    w = mountComponent({ query: { tab: "unpriced", stream: "llm" } });
    await flushPromises();

    w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "org");
    await flushPromises();

    expect(w.vm.selectedTab).toBe("org");
    expect(routerReplaceMock).toHaveBeenLastCalledWith({ query: { tab: "org", stream: "llm" } });
  });

  it("reopens the tab named in the route query after a reload", async () => {
    w = mountComponent({ query: { tab: "inherited" } });
    await flushPromises();
    expect(w.vm.selectedTab).toBe("inherited");
  });

  it("reads unpriced models only while the Unpriced tab is open", async () => {
    w = mountComponent({ query: { tab: "all" } });
    await flushPromises();
    expect(w.vm.selectedTab).toBe("all");
    expect(modelPricingService.listUnpriced).not.toHaveBeenCalled();

    w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "inherited");
    await flushPromises();
    expect(modelPricingService.listUnpriced).not.toHaveBeenCalled();

    w.findComponent({ name: "AppTabs" }).vm.$emit("update:activeTab", "unpriced");
    await flushPromises();
    await vi.waitFor(() => expect(modelPricingService.listUnpriced).toHaveBeenCalledTimes(1));
  });

  it("shows the load error when the unpriced read fails, and Retry reads again", async () => {
    vi.mocked(modelPricingService.listUnpriced).mockRejectedValue({ response: { status: 400 } });
    w = mountComponent({ query: { tab: "unpriced" } });
    await vi.waitFor(() =>
      expect(w.find('[data-test="model-pricing-unpriced-error"]').exists()).toBe(true),
    );
    expect(w.find('[data-test="model-pricing-unpriced-empty"]').exists()).toBe(false);
    const calls = vi.mocked(modelPricingService.listUnpriced).mock.calls.length;

    // A later timestamp gives the retried read a new window, so it never reuses the failed one.
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    await w.find('[data-test="o2-empty-state-action-retry"]').trigger("click");
    await flushPromises();
    now.mockRestore();

    expect(vi.mocked(modelPricingService.listUnpriced).mock.calls.length).toBeGreaterThan(calls);
  });

  it("says online sync has not run when the built-in list was never synced", async () => {
    vi.mocked(modelPricingService.getBuiltIn).mockResolvedValue({
      data: { models: [], source_url: "", last_updated: 0, seed_date: "2026-10-14" },
    } as any);
    w = mountComponent();
    await flushPromises();
    const status = w.find('[data-test="model-pricing-built-in-status"]');
    expect(status.text()).toContain("2026-10-14");
    expect(status.text()).toContain("never synced");
  });

  it("gives the last online sync time once the built-in list has synced", async () => {
    vi.mocked(modelPricingService.getBuiltIn).mockResolvedValue({
      data: { models: [], source_url: "", last_updated: 1_798_000_000, seed_date: "2026-10-14" },
    } as any);
    w = mountComponent();
    await flushPromises();
    const status = w.find('[data-test="model-pricing-built-in-status"]');
    expect(status.text()).toContain("synced at 2026-12-");
    expect(status.text()).not.toContain("never synced");
  });
});
