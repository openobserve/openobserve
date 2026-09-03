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

// @vitest-environment jsdom
//
// Render tests for SyntheticMonitoring.vue — the main synthetics list page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";

const $t = (key: string) => key;

// ── Mock functions hoisted so vi.mock factories can reference them ────────
const {
  mockServiceList,
  mockServiceEnable,
  mockServiceDelete,
  mockServiceBulkDelete,
  mockServiceRun,
  mockServiceGet,
  mockServiceCreate,
  mockServiceGetLocations,
  mockServiceGetAgentSetup,
  mockRouterPush,
  mockRouteQuery,
} = vi.hoisted(() => ({
  mockServiceList: vi.fn().mockResolvedValue({ data: { monitors: [] } }),
  mockServiceEnable: vi.fn().mockResolvedValue({}),
  mockServiceDelete: vi.fn().mockResolvedValue({}),
  mockServiceBulkDelete: vi.fn().mockResolvedValue({}),
  mockServiceRun: vi.fn().mockResolvedValue({}),
  mockServiceGet: vi.fn().mockResolvedValue({ data: {} }),
  mockServiceCreate: vi.fn().mockResolvedValue({ data: { id: "new-1" } }),
  mockServiceGetLocations: vi.fn().mockResolvedValue({ data: { locations: [] } }),
  mockServiceGetAgentSetup: vi
    .fn()
    .mockResolvedValue({ data: { install: "curl ...", token: "abc123" } }),
  // router.push returns a Promise in vue-router; callers here chain .catch() on it.
  mockRouterPush: vi.fn().mockResolvedValue(undefined),
  // Mutable so a test can drive `?section=private` without remounting the mock.
  mockRouteQuery: {} as Record<string, string>,
}));

// ── Module mocks ─────────────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: $t })),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: {},
    query: mockRouteQuery,
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
  }),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    listByFolderId: mockServiceList,
    list: mockServiceList,
    get: mockServiceGet,
    create: mockServiceCreate,
    enable: mockServiceEnable,
    delete: mockServiceDelete,
    bulkDelete: mockServiceBulkDelete,
    run: mockServiceRun,
    getLocations: mockServiceGetLocations,
    getAgentSetup: mockServiceGetAgentSetup,
  },
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/utils/synthetics/buildPayload", () => ({
  mapResponseToBrowserCheck: vi.fn((data: any) => data),
  buildCreateBrowserTestPayload: vi.fn((data: any) => ({ ...data, type: "browser" })),
  mapResponseToProtocolCheck: vi.fn((data: any) => ({ ...data, checkType: data.type })),
  buildCreateProtocolCheckPayload: vi.fn((data: any) => ({ ...data, type: data.checkType })),
}));

import SyntheticMonitoring from "./SyntheticMonitoring.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  buildCreateBrowserTestPayload,
  buildCreateProtocolCheckPayload,
} from "@/utils/synthetics/buildPayload";

// ── Test helpers ─────────────────────────────────────────────────────────

/** Standard set of stubs for child components used across all mounts. */
const baseStubs = {
  FolderList: {
    template: '<div data-test="synthetic-monitoring-folder-list" />',
  },
  MonitorTable: {
    template:
      '<div data-test="synthetic-monitoring-monitors-table"><slot name="toolbar" /><slot name="toolbar-trailing" /></div>',
    props: [
      "mode",
      "data",
      "loading",
      "selectedIds",
      "showFolderColumn",
      "toggleLoadingMap",
      "triggerLoadingMap",
      "bulkActionLoading",
      "footerTitle",
      "emptyMessage",
      "hasFilters",
    ],
  },
  CheckTypePicker: {
    template: '<div data-test="check-type-picker-stub"><slot /></div>',
    props: ["variant", "layout", "disabledTypes", "comingSoonTypes"],
    emits: ["select"],
  },
  MoveAcrossFolders: {
    template: '<div data-test="synthetic-monitoring-move-dialog" />',
    props: ["type", "moduleId", "activeFolderId", "open"],
  },
  SelectFolderDropDown: {
    name: "SelectFolderDropDown",
    template: "<div />",
    props: ["type", "activeFolderId", "disableDropdown"],
    emits: ["folder-selected"],
  },
  ODropdown: {
    template:
      '<div><div data-test="odropdown-trigger"><slot name="trigger" /></div><div v-if="true"><slot /></div></div>',
    props: ["align"],
  },
  ODropdownItem: {
    template: '<div data-test="odropdown-item"><slot /></div>',
    props: ["iconLeft", "dataTest"],
  },
  OIcon: {
    template: "<span />",
    props: ["name", "size", "class"],
  },
  ODialog: {
    template: '<div v-if="open"><slot /></div>',
    props: [
      "open",
      "size",
      "title",
      "subTitle",
      "primaryButtonLabel",
      "secondaryButtonLabel",
      "primaryButtonDisabled",
      "primaryButtonVariant",
    ],
    emits: ["click:primary", "click:secondary", "update:open"],
  },
  OButton: {
    template:
      '<button :data-test="$attrs[\'data-test\']"><slot name="icon-left" /><slot name="icon-right" /><slot /></button>',
    props: ["variant", "size", "class", "loading", "title", "iconLeft"],
    inheritAttrs: true,
  },
  OSelect: {
    template: "<select :data-test=\"$attrs['data-test']\" />",
    props: ["modelValue", "options", "size"],
  },
  OInput: {
    template:
      '<input :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ["modelValue", "placeholder", "label", "error", "errorMessage"],
    emits: ["update:modelValue"],
  },
  OToggleGroup: {
    template: "<div><slot /></div>",
    props: ["modelValue"],
  },
  OToggleGroupItem: {
    template: "<button :data-test=\"$attrs['data-test']\"><slot /></button>",
    props: ["value", "size", "iconLeft"],
    inheritAttrs: true,
  },
  // ── Stubs for tabs-below header tabs (Reka-UI backed, must be stubbed) ──
  OTabs: {
    template: '<div data-test="synthetic-monitoring-header-tabs"><slot /></div>',
    props: ["modelValue", "align", "dense", "bordered", "orientation", "reorderable"],
    emits: ["change", "update:modelValue", "reorder"],
  },
  OTab: {
    template: '<div data-test="synthetic-monitoring-header-tab"><slot /></div>',
    props: ["value", "name", "label", "icon", "disable", "tooltip"],
  },
  OText: {
    template: "<span><slot /></span>",
    props: ["variant"],
  },
  // ── Stubs for Private Locations functionality ────────────────────────
  PrivateLocations: {
    template: '<div data-test="synthetic-monitoring-private-locations-stub" />',
    props: ["locations", "loading"],
    emits: ["refresh", "copy-setup", "delete"],
  },
  AgentSetupDrawer: {
    template: '<div data-test="synthetic-monitoring-agent-setup-drawer-stub" />',
    props: ["open", "install", "locationName", "locationId", "token", "org", "o2Url", "scriptUrl"],
    emits: ["update:open"],
  },
  BetaBadge: {
    template: '<span data-test="beta-badge">BETA</span>',
  },
};

function mountPage() {
  return mount(SyntheticMonitoring, {
    global: {
      plugins: [store],
      stubs: baseStubs,
    },
  });
}

/** Renders the page as an OSS build sees it: no private locations. */
function mountPageWithoutPrivateLocations() {
  store.state.zoConfig.synthetics_private_locations_enabled = false;
  return mountPage();
}

describe("SyntheticMonitoring", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceList.mockResolvedValue({ data: { monitors: [] } });
    // Both are process-global and mutated by individual tests, so they are
    // restored here rather than left for the next test to inherit.
    for (const k of Object.keys(mockRouteQuery)) delete mockRouteQuery[k];
    store.state.zoConfig.synthetics_private_locations_enabled = true;
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render the page shell with the new check button", () => {
      wrapper = mountPage();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetic-monitoring-new-check-btn"]').exists()).toBe(true);
    });

    it("should render the sidebar folder list", () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="synthetic-monitoring-folder-list"]').exists()).toBe(true);
    });

    it("should render the MonitorTable", () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="synthetic-monitoring-monitors-table"]').exists()).toBe(true);
    });

    it("should render the Beta badge in the page title", () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="beta-badge"]').exists()).toBe(true);
    });
  });

  describe("service calls on mount", () => {
    it("should call listByFolderId when initialised", async () => {
      wrapper = mountPage();
      await flushPromises();
      expect(mockServiceList).toHaveBeenCalled();
    });
  });

  describe("MonitorTable has-filters prop", () => {
    it("passes false when no filters are active", () => {
      wrapper = mountPage();
      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      expect(mt.props("hasFilters")).toBe(false);
    });

    it("passes true when search has a value", async () => {
      wrapper = mountPage();
      const input = wrapper.find('[data-test="synthetic-monitoring-search-input"]');
      await input.setValue("test");
      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      expect(mt.props("hasFilters")).toBe(true);
    });

    it("passes false after search value is cleared", async () => {
      wrapper = mountPage();
      const input = wrapper.find('[data-test="synthetic-monitoring-search-input"]');
      await input.setValue("test");
      await input.setValue("");
      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      expect(mt.props("hasFilters")).toBe(false);
    });
  });

  describe("empty-action handler via MonitorTable", () => {
    it("routes to create page when actionId is 'create'", () => {
      wrapper = mountPage();
      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      mt.vm.$emit("empty-action", "create");
      expect(mockRouterPush).toHaveBeenCalled();
    });

    it("does not route when actionId is 'clear-filters'", () => {
      wrapper = mountPage();
      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      mockRouterPush.mockClear();
      mt.vm.$emit("empty-action", "clear-filters");
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("clears search input on 'clear-filters'", async () => {
      wrapper = mountPage();
      const input = wrapper.find('[data-test="synthetic-monitoring-search-input"]');
      await input.setValue("test");

      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      mt.vm.$emit("empty-action", "clear-filters");
      await nextTick();

      expect((input.element as HTMLInputElement).value).toBe("");
    });

    it("resets hasFilters to false on 'clear-filters'", async () => {
      wrapper = mountPage();
      const input = wrapper.find('[data-test="synthetic-monitoring-search-input"]');
      await input.setValue("test");

      const mt = wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
      mt.vm.$emit("empty-action", "clear-filters");
      await nextTick();

      expect(mt.props("hasFilters")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Header tabs (tabs-below pattern: OTabs in the OPageLayout #header-tabs slot)
  // ═══════════════════════════════════════════════════════════════════════
  describe("header tabs", () => {
    it("renders all tab options (Checks, Private Locations, and Status Pages) in the header", () => {
      wrapper = mountPage();
      const tabsWrapper = wrapper.find('[data-test="synthetic-monitoring-header-tabs"]');
      expect(tabsWrapper.exists()).toBe(true);

      const tabElements = wrapper.findAll('[data-test="synthetic-monitoring-header-tab"]');
      expect(tabElements).toHaveLength(3);
    });

    it("hides the Private Locations tab when private locations are unavailable", () => {
      // Private locations are served by agents deployed inside the customer's
      // network, which is the one enterprise part of synthetics. An OSS build
      // must not offer a tab whose contents it cannot serve. Status Pages ships
      // with synthetics unconditionally, so it still renders alongside Checks.
      wrapper = mountPageWithoutPrivateLocations();
      const tabElements = wrapper.findAll('[data-test="synthetic-monitoring-header-tab"]');
      expect(tabElements).toHaveLength(2);
    });

    it("falls back to Checks when ?section=private but private locations are unavailable", () => {
      // Otherwise a deep link from an enterprise deployment lands on a tab that
      // is not rendered, and the page looks empty rather than unavailable.
      mockRouteQuery.section = "private";
      wrapper = mountPageWithoutPrivateLocations();
      expect((wrapper.vm as any).activeSection).toBe("checks");
    });

    it("defaults activeSection to 'checks'", () => {
      wrapper = mountPage();
      expect((wrapper.vm as any).activeSection).toBe("checks");
    });

    it("allows switching activeSection to 'private'", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();
      expect((wrapper.vm as any).activeSection).toBe("private");
    });

    it("can switch activeSection back from 'private' to 'checks'", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();
      (wrapper.vm as any).activeSection = "checks";
      await nextTick();
      expect((wrapper.vm as any).activeSection).toBe("checks");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Conditional #actions slot: New Check vs Setup an agent
  // ═══════════════════════════════════════════════════════════════════════
  describe("conditional header action button", () => {
    it("shows New Check button when on Checks tab and hides Setup agent button", () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="synthetic-monitoring-new-check-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetic-monitoring-setup-agent-btn"]').exists()).toBe(
        false,
      );
    });

    it("shows Setup an agent button when on Private tab and hides New Check button", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      expect(wrapper.find('[data-test="synthetic-monitoring-new-check-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="synthetic-monitoring-setup-agent-btn"]').exists()).toBe(
        true,
      );
    });

    it("clicking New Check button sets showTypePicker to true", async () => {
      wrapper = mountPage();
      expect((wrapper.vm as any).showTypePicker).toBe(false);

      await wrapper.find('[data-test="synthetic-monitoring-new-check-btn"]').trigger("click");

      expect((wrapper.vm as any).showTypePicker).toBe(true);
    });

    it("clicking Setup an agent button sets showSetupDrawer to true", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      await wrapper.find('[data-test="synthetic-monitoring-setup-agent-btn"]').trigger("click");

      // openSetupDrawer sets showSetupDrawer synchronously before any async call
      expect((wrapper.vm as any).showSetupDrawer).toBe(true);
      // Confirm getAgentSetup was called as part of openSetupDrawer
      expect(mockServiceGetAgentSetup).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Sidebar, main content, and PrivateLocations visibility per activeSection
  // ═══════════════════════════════════════════════════════════════════════
  describe("sidebar and main content visibility", () => {
    it("shows sidebar folder list only on Checks tab", async () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="synthetic-monitoring-folder-list"]').exists()).toBe(true);

      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      expect(wrapper.find('[data-test="synthetic-monitoring-folder-list"]').exists()).toBe(false);
    });

    it("shows MonitorTable only on Checks tab", async () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="synthetic-monitoring-monitors-table"]').exists()).toBe(true);

      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      expect(wrapper.find('[data-test="synthetic-monitoring-monitors-table"]').exists()).toBe(
        false,
      );
    });

    it("renders PrivateLocations on Private Locations tab", async () => {
      wrapper = mountPage();
      expect(
        wrapper.find('[data-test="synthetic-monitoring-private-locations-stub"]').exists(),
      ).toBe(false);

      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      expect(
        wrapper.find('[data-test="synthetic-monitoring-private-locations-stub"]').exists(),
      ).toBe(true);
    });

    it("shows sidebar and MonitorTable again after switching back to Checks", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();
      (wrapper.vm as any).activeSection = "checks";
      await nextTick();

      expect(wrapper.find('[data-test="synthetic-monitoring-folder-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetic-monitoring-monitors-table"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="synthetic-monitoring-private-locations-stub"]').exists(),
      ).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PrivateLocations: old @setup listener removed, replaced by @copy-setup
  // ═══════════════════════════════════════════════════════════════════════
  describe("PrivateLocations no longer emits setup", () => {
    it("uses @copy-setup instead of the old @setup to open the setup drawer", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      const plWrapper = wrapper.findComponent(
        '[data-test="synthetic-monitoring-private-locations-stub"]',
      );
      expect(plWrapper.exists()).toBe(true);

      // Emit copy-setup (the replacement for the old @setup listener).
      plWrapper.vm.$emit("copy-setup", { id: "loc1", name: "Test Location" });

      // @copy-setup calls openSetupDrawer which sets showSetupDrawer = true
      expect((wrapper.vm as any).showSetupDrawer).toBe(true);
    });

    it("does not respond to a 'setup' emit on PrivateLocations", async () => {
      wrapper = mountPage();
      (wrapper.vm as any).activeSection = "private";
      await nextTick();

      const plWrapper = wrapper.findComponent(
        '[data-test="synthetic-monitoring-private-locations-stub"]',
      );
      expect((wrapper.vm as any).showSetupDrawer).toBe(false);

      // Emitting the old "setup" event should have no effect — it is unbound.
      plWrapper.vm.$emit("setup", { id: "loc1", name: "Test Location" });
      await nextTick();

      expect((wrapper.vm as any).showSetupDrawer).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Duplicate Check dialog — folder picker, folder-scoped requests
  // ═══════════════════════════════════════════════════════════════════════
  describe("duplicate check dialog", () => {
    const row = { id: "m-1", name: "Checkout flow", folderId: "f-2" };

    const findTable = () =>
      wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');
    const findDialog = () =>
      wrapper.findComponent('[data-test="synthetic-monitoring-duplicate-dialog"]');
    const findFolderSelect = () => wrapper.findComponent({ name: "SelectFolderDropDown" });

    /** Opens the dialog for a row and waits for the source fetch to settle. */
    const openDuplicate = async (monitor: any = row) => {
      findTable().vm.$emit("duplicate", monitor);
      await flushPromises();
    };

    beforeEach(() => {
      mockServiceGet.mockResolvedValue({
        data: { id: "m-1", name: "Checkout flow", target: "https://example.com" },
      });
      mockServiceCreate.mockResolvedValue({ data: { id: "m-2" } });
    });

    it("prefills the folder dropdown with the row's own folder", async () => {
      wrapper = mountPage();
      await flushPromises();
      await openDuplicate();

      expect(findDialog().exists()).toBe(true);
      expect(
        wrapper.find('[data-test="synthetic-monitoring-duplicate-folder-select"]').exists(),
      ).toBe(true);
      expect(findFolderSelect().props("activeFolderId")).toBe("f-2");
      expect(findFolderSelect().props("type")).toBe("synthetics");
    });

    it("falls back to the active folder when the row carries no folderId", async () => {
      wrapper = mountPage();
      await flushPromises();
      await openDuplicate({ id: "m-9", name: "No folder" });

      expect(findFolderSelect().props("activeFolderId")).toBe("default");
    });

    it("fetches the source check scoped to the row's folder when opened", async () => {
      wrapper = mountPage();
      await flushPromises();
      await openDuplicate();

      expect(mockServiceGet).toHaveBeenCalledTimes(1);
      const [, id, folderId] = mockServiceGet.mock.calls[0];
      expect(id).toBe("m-1");
      expect(folderId).toBe("f-2");
    });

    it("closes the dialog and does not create when the source fetch fails", async () => {
      mockServiceGet.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
      wrapper = mountPage();
      await flushPromises();
      await openDuplicate();

      expect(findDialog().exists()).toBe(false);
      expect(mockServiceCreate).not.toHaveBeenCalled();
    });

    it("creates the copy in the folder chosen in the dropdown", async () => {
      wrapper = mountPage();
      await flushPromises();
      await openDuplicate();

      findFolderSelect().vm.$emit("folder-selected", { label: "Ops", value: "f-9" });
      await nextTick();

      findDialog().vm.$emit("click:primary");
      await flushPromises();

      expect(mockServiceCreate).toHaveBeenCalledTimes(1);
      const [, payload, folderId] = mockServiceCreate.mock.calls[0];
      // The payload folder and the ?folder= RBAC scope must agree.
      expect((payload as any).folder).toBe("f-9");
      expect(folderId).toBe("f-9");
      expect((payload as any).id).toBeUndefined();
    });

    it("follows the copy into its destination folder with a single reload", async () => {
      wrapper = mountPage();
      await flushPromises();
      const listCallsAfterMount = mockServiceList.mock.calls.length;

      await openDuplicate();
      findFolderSelect().vm.$emit("folder-selected", { label: "Ops", value: "f-9" });
      await nextTick();
      findDialog().vm.$emit("click:primary");
      await flushPromises();

      expect((wrapper.vm as any).activeFolderId).toBe("f-9");
      expect(mockServiceList.mock.calls.length - listCallsAfterMount).toBe(1);
    });

    // buildCreateBrowserTestPayload hardcodes type: "browser", so a protocol
    // check run through it would come back as a browser check.
    describe("check type", () => {
      const duplicateWithType = async (type: string) => {
        mockServiceGet.mockResolvedValue({
          data: { id: "m-1", name: "API health", type, schedule: {} },
        });
        wrapper = mountPage();
        await flushPromises();
        await openDuplicate();
        findDialog().vm.$emit("click:primary");
        await flushPromises();
        return mockServiceCreate.mock.calls[0][1] as any;
      };

      it.each(["http", "tcp", "tls", "ssh"])("preserves a %s check's type", async (type) => {
        const payload = await duplicateWithType(type);

        expect(payload.type).toBe(type);
        expect(vi.mocked(buildCreateProtocolCheckPayload)).toHaveBeenCalled();
        expect(vi.mocked(buildCreateBrowserTestPayload)).not.toHaveBeenCalled();
      });

      it("uses the browser builder for a browser check", async () => {
        const payload = await duplicateWithType("browser");

        expect(payload.type).toBe("browser");
        expect(vi.mocked(buildCreateBrowserTestPayload)).toHaveBeenCalled();
        expect(vi.mocked(buildCreateProtocolCheckPayload)).not.toHaveBeenCalled();
      });
    });

    // The API rejects a start in the past, and mapFrequencyToSchedule reports
    // every saved check as "Schedule Later" with the date it originally started.
    describe("schedule start rebasing", () => {
      const pastStart = 1_600_000_000_000_000; // µs — Sep 2020

      it("resets a past start to 'Schedule Now'", async () => {
        mockServiceGet.mockResolvedValue({
          data: {
            id: "m-1",
            name: "Checkout flow",
            start: pastStart,
            schedule: { startType: "later", startDate: "2020-09-13", startTime: "12:26" },
          },
        });
        wrapper = mountPage();
        await flushPromises();
        await openDuplicate();
        findDialog().vm.$emit("click:primary");
        await flushPromises();

        const [, payload] = mockServiceCreate.mock.calls[0];
        expect((payload as any).schedule.startType).toBe("now");
        expect((payload as any).schedule.startDate).toBeUndefined();
        expect((payload as any).schedule.startTime).toBeUndefined();
      });

      // buildPayload is mocked to identity above, so the tests around this one
      // only prove the view sets startType. This one pins the contract the fix
      // relies on, using the real builder.
      it("real buildCreateBrowserTestPayload emits a current start for 'now' and replays a past one for 'later'", async () => {
        const actual = await vi.importActual<typeof import("@/utils/synthetics/buildPayload")>(
          "@/utils/synthetics/buildPayload",
        );
        const source = actual.mapResponseToBrowserCheck({
          name: "Checkout flow",
          target: "https://example.com",
          folder_id: "f-2",
          start: pastStart,
          frequency: { type: "minutes", interval: 5, timezone: "UTC" },
          config: { steps: [] },
        });

        // As read back from the API: "later", replaying the original start —
        // in the past, which is what the server rejects. (Not exactly
        // pastStart: the round-trip through HH:mm truncates to the minute.)
        expect(source.schedule.startType).toBe("later");
        const asIs = actual.buildCreateBrowserTestPayload({ ...source }) as any;
        expect(asIs.start).toBeLessThan(Date.now() * 1000);
        expect(asIs.start).toBeCloseTo(pastStart, -8); // same minute

        // What saveDuplicate submits instead. computeStart truncates to the
        // minute, so allow up to 60s of backdating.
        const rebased = actual.buildCreateBrowserTestPayload({
          ...source,
          schedule: { ...source.schedule, startType: "now" },
        } as any) as any;
        expect(rebased.start).toBeGreaterThan((Date.now() - 60_000) * 1000);
      });

      it("preserves a start that is still in the future", async () => {
        const futureStart = (Date.now() + 7 * 24 * 60 * 60 * 1000) * 1000;
        mockServiceGet.mockResolvedValue({
          data: {
            id: "m-1",
            name: "Checkout flow",
            start: futureStart,
            schedule: { startType: "later", startDate: "2099-01-01", startTime: "09:00" },
          },
        });
        wrapper = mountPage();
        await flushPromises();
        await openDuplicate();
        findDialog().vm.$emit("click:primary");
        await flushPromises();

        const [, payload] = mockServiceCreate.mock.calls[0];
        expect((payload as any).schedule).toEqual({
          startType: "later",
          startDate: "2099-01-01",
          startTime: "09:00",
        });
      });
    });

    it("closes the dialog without an extra error toast on a 403", async () => {
      mockServiceCreate.mockRejectedValueOnce({ response: { status: 403 } });
      wrapper = mountPage();
      await flushPromises();
      await openDuplicate();

      findDialog().vm.$emit("click:primary");
      await flushPromises();

      expect(findDialog().exists()).toBe(false);
      expect(vi.mocked(toast)).not.toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });
  });

  // Regression coverage for the routing audit: every hop out of this page must
  // carry `org_identifier` (otherwise a refresh/share resolves against whatever
  // org is in localStorage), and `?folder=` must carry the folder *ID* — the
  // server documents it as "Current folder ID of the synthetic (for RBAC)" and
  // this page used to send the display name, which is "—" before folders load.
  describe("navigation out of the list", () => {
    // Shaped like a row emitted by MonitorTable: `folderId` is the KSUID,
    // `folder_name` the display string the page used to send by mistake.
    const row = {
      id: "mon-9",
      name: "Checkout flow",
      folderId: "f_ksuid_prod",
      folder_name: "Production",
      lastTriggeredAt: 1_700_000_000_000_000,
      enabled: true,
    };

    const findTable = () =>
      wrapper.findComponent('[data-test="synthetic-monitoring-monitors-table"]');

    const mountReady = async () => {
      wrapper = mountPage();
      await flushPromises();
    };

    it("sends org_identifier and the folder ID when opening a monitor's results", async () => {
      await mountReady();
      findTable().vm.$emit("row-click", row);

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetic-monitor-results",
        params: { id: "mon-9" },
        query: {
          org_identifier: "default",
          folder: "f_ksuid_prod",
          name: "Checkout flow",
          last_triggered_at: "1700000000000000",
        },
      });
    });

    it("sends org_identifier and the folder ID when editing a monitor", async () => {
      await mountReady();
      findTable().vm.$emit("edit", row);

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics-edit",
        params: { id: "mon-9" },
        query: { org_identifier: "default", folder: "f_ksuid_prod" },
      });
    });

    it("sends org_identifier and the active folder when creating a check", async () => {
      await mountReady();
      // The picker lives in a dialog, so it only renders once opened.
      await wrapper.find('[data-test="synthetic-monitoring-new-check-btn"]').trigger("click");
      await nextTick();
      wrapper
        .findComponent('[data-test="synthetic-monitoring-check-type-picker-modal"]')
        .vm.$emit("select", "http");
      await nextTick();

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics-add",
        query: { org_identifier: "default", folder: "default", type: "http" },
      });
    });

    it("passes the folder ID — not the display name — to per-check API calls", async () => {
      await mountReady();
      findTable().vm.$emit("run", row);
      await flushPromises();

      expect(mockServiceRun).toHaveBeenCalledWith("default", "mon-9", {}, "f_ksuid_prod");
    });
  });
});
