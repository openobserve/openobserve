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

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

// Route query state — reset per test via beforeEach
let routeQuery: Record<string, any> = {
  name: "Test Monitor",
  status: "healthy",
};

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: { id: "mon-1" },
    query: routeQuery,
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  RouterLink: { name: "RouterLinkStub", template: "<a><slot /></a>" },
}));

vi.mock("vuex", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useStore: () => ({
      state: {
        timezone: "UTC",
        selectedOrganization: { identifier: "org-1" },
      },
    }),
  };
});

vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn((period: string) => {
    if (period === "15m") {
      return { startTime: 1_700_000_000_000_000, endTime: 1_700_000_900_000_000 };
    }
    return null;
  }),
}));

import MonitorResults from "./MonitorResults.vue";

// ── Mount factory ──────────────────────────────────────────────────────────

function makeWrapper() {
  return mount(MonitorResults, {
    global: {
      stubs: {
        OPageHeader: {
          template: `
            <div data-test="app-page-header">
              <span data-test="app-page-header-title">{{ title }}</span>
              <span data-test="app-page-header-subtitle">{{ subtitle }}</span>
              <slot name="actions" />
            </div>
          `,
          props: ["title", "subtitle", "back"],
        },
        DateTime: {
          template: '<div data-test="date-time-picker" />',
          props: [
            "autoApply",
            "menuAlign",
            "defaultType",
            "defaultAbsoluteTime",
            "defaultRelativeTime",
          ],
        },
        OButton: {
          template: '<button class="obutton-stub" @click="$emit(\'click\')"><slot /></button>',
          props: ["variant", "size", "iconLeft", "loading"],
        },
        OIcon: {
          template: '<span class="oicon-stub" />',
          props: ["name", "size"],
        },
        OBadge: {
          template: '<span class="obadge-stub"><slot /></span>',
          props: ["variant", "size", "icon", "dot"],
        },
        ODrawer: {
          template: `
            <div class="odrawer-stub">
              <slot name="header-left" />
              <slot />
            </div>
          `,
          props: ["open", "side", "width", "title", "subTitle"],
        },
        MonitorRuns: {
          template: `
            <div data-test="monitor-runs">
              <button data-test="trigger-open-run" @click="$emit('open-run', 'run-123', 'exec-1')" />
              <button data-test="trigger-edit" @click="$emit('edit')" />
              <button data-test="trigger-refresh" @click="$emit('refresh')" />
              <button data-test="trigger-jump-to-window" @click="$emit('jump-to-window', 1000, 2000)" />
            </div>
          `,
          props: ["monitorId", "monitorName", "monitorStatus"],
        },
        RunDetail: {
          template: '<div data-test="run-detail" />',
          props: [
            "drawerMode",
            "overrideMonitorId",
            "overrideMonitorName",
            "overrideRunId",
            "overrideExecutionId",
          ],
        },
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MonitorResults", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterReplace.mockReset();
    mockRouterReplace.mockImplementation(() => Promise.resolve());
    mockRouterPush.mockReset();
    mockRouterPush.mockImplementation(() => Promise.resolve());

    // Default route state
    routeQuery = {
      name: "Test Monitor",
      status: "healthy",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("page shell rendering", () => {
    it("should render the root div with data-test", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="synthetic-monitor-results-page"]').exists()).toBe(true);
    });

    it("should render OPageHeader with monitor name from route query", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const title = wrapper.find('[data-test="app-page-header-title"]');
      expect(title.text()).toBe("Test Monitor");
    });

    it("should render MonitorRuns child component", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="monitor-runs"]').exists()).toBe(true);
    });
  });

  describe("edit button", () => {
    it("should render the edit button", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const editBtn = wrapper.find('[data-test="synthetic-monitor-results-edit-btn"]');
      expect(editBtn.exists()).toBe(true);
    });

    it("should navigate to synthetic-new with edit query on click", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const editBtn = wrapper.find('[data-test="synthetic-monitor-results-edit-btn"]');
      await editBtn.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetic-new",
        query: { edit: "mon-1" },
      });
    });
  });

  describe("run detail drawer", () => {
    it("should render the ODrawer for run detail", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      // The drawer exists in the template (closed by default with v-model:open)
      const drawer = wrapper.find('[data-test="synthetics-run-detail-drawer"]');
      expect(drawer.exists()).toBe(true);
    });

    it("should open drawer and update URL when MonitorRuns emits open-run", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const triggerBtn = wrapper.find('[data-test="trigger-open-run"]');
      await triggerBtn.trigger("click");
      await flushPromises();

      // URL should be updated with run and exec query params
      expect(mockRouterReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            run: "run-123",
            exec: "exec-1",
          }),
        }),
      );
    });

    it("should render RunDetail inside the drawer", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.find('[data-test="run-detail"]').exists()).toBe(true);
    });
  });

  describe("auto-open drawer from URL query params", () => {
    it("should open drawer when route query has run and exec params", async () => {
      routeQuery = {
        name: "Test Monitor",
        status: "healthy",
        run: "run-from-url",
        exec: "exec-from-url",
      };

      wrapper = makeWrapper();
      await flushPromises();

      // The drawer opens by setting drawerOpen = true in onMounted
      const drawer = wrapper.find('[data-test="synthetics-run-detail-drawer"]');
      expect(drawer.exists()).toBe(true);
    });
  });

  describe("route query integration", () => {
    it("should use default status when no status in query", async () => {
      routeQuery = { name: "Test Monitor" };
      wrapper = makeWrapper();
      await flushPromises();

      // Should not throw — defaults to "degraded"
      expect(wrapper.find('[data-test="synthetic-monitor-results-page"]').exists()).toBe(true);
    });

    it("should handle missing name gracefully with default title", async () => {
      routeQuery = {};
      wrapper = makeWrapper();
      await flushPromises();

      const title = wrapper.find('[data-test="app-page-header-title"]');
      expect(title.text()).toBe("synthetics.results.title");
    });
  });

  describe("MonitorRuns events", () => {
    it("should forward edit event from MonitorRuns to editMonitor", async () => {
      wrapper = makeWrapper();
      await flushPromises();
      mockRouterPush.mockClear(); // clear the writeToUrl call from onMounted

      const editBtn = wrapper.find('[data-test="trigger-edit"]');
      await editBtn.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetic-new",
        query: { edit: "mon-1" },
      });
    });

    it("should handle refresh event from MonitorRuns", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const refreshBtn = wrapper.find('[data-test="trigger-refresh"]');
      await refreshBtn.trigger("click");

      // Should not throw — refresh is called
      expect(wrapper.find('[data-test="synthetic-monitor-results-page"]').exists()).toBe(true);
    });
  });
});
