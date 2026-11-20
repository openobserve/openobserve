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
import { reactive, shallowRef } from "vue";

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

// Route query state — reset per test via beforeEach
const routeParams = reactive({ id: "mon-1" });
const routeQuery = shallowRef<Record<string, string | undefined>>({});

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: routeParams,
    get query() {
      return routeQuery.value;
    },
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  RouterLink: { name: "RouterLinkStub", template: "<a><slot /></a>" },
  onBeforeRouteUpdate: vi.fn(),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useStore: () => ({
      state: {
        timezone: "UTC",
        selectedOrganization: { identifier: "org-1" },
        // `?folder=` carries the folder ID; the header resolves it to a name
        // against this cached list.
        organizationData: {
          foldersByType: { synthetics: [{ folderId: "f-1", name: "Production" }] },
        },
      },
    }),
  };
});

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/utils/date", () => ({
  getConsumableRelativeTime: vi.fn((period: string) => {
    if (period === "15m") {
      return { startTime: 1_700_000_000_000_000, endTime: 1_700_000_900_000_000 };
    }
    return null;
  }),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

const mockFetchAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/composables/useSyntheticResults", async () => {
  const { ref } = await import("vue");
  return {
    default: () => ({
      kpiLoading: ref(false),
      histogramLoading: ref(false),
      runsLoading: ref(false),
      kpiHasLoadedOnce: ref(false),
      histogramHasLoadedOnce: ref(false),
      runsHasLoadedOnce: ref(false),
      fetchAll: mockFetchAll,
      cancelAll: vi.fn(),
    }),
  };
});

// Mock syntheticsService.get — called via bootstrap() when MonitorRuns emits
// need-check-data (only when there are zero runs and no lastTriggeredAt).
const mockSyntheticsServiceGet = vi.fn().mockResolvedValue({
  data: { name: "Test Monitor", status: "healthy", last_triggered_at: 0 },
});
const mockListEnvironments = vi.fn().mockResolvedValue({ data: [] });
vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get: (...args: any[]) => mockSyntheticsServiceGet(...args),
      listEnvironments: (...args: any[]) => mockListEnvironments(...args),
      run: vi.fn().mockResolvedValue({}),
    },
  });
});

import MonitorResults from "./MonitorResults.vue";

// ── Mount factory ──────────────────────────────────────────────────────────

function makeWrapper(stubOverrides: Record<string, unknown> = {}) {
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
        OSelect: {
          template: '<select class="oselect-stub" :data-test="$attrs[\'data-test\']" />',
          props: ["modelValue", "options", "size"],
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
              <button data-test="trigger-open-run-error" @click="$emit('open-run-error', { errorSource: 'quota', message: 'steps exhausted', timestamp: 1700000000000, location: 'aws-us-east-1', browser: 'chromium', device: 'desktop' })" />
              <button data-test="trigger-edit" @click="$emit('edit')" />
              <button data-test="trigger-refresh" @click="$emit('refresh')" />
              <button data-test="trigger-jump-to-window" @click="$emit('jump-to-window', 1000, 2000)" />
            </div>
          `,
          props: [
            "monitorId",
            "monitorName",
            "monitorStatus",
            "lastTriggeredAt",
            "checkType",
            "environments",
            "environmentScope",
          ],
        },
        RunDetail: {
          template: '<div data-test="run-detail" />',
          props: [
            "drawerMode",
            "overrideMonitorId",
            "overrideMonitorName",
            "overrideRunId",
            "overrideExecutionId",
            "overrideMonitorType",
            "overrideError",
          ],
        },
        ...stubOverrides,
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

    routeParams.id = "mon-1";
    // Default route state
    routeQuery.value = {
      name: "Test Monitor",
      status: "healthy",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("reloads another monitor in place and ignores an earlier late response", async () => {
    wrapper = makeWrapper();
    await flushPromises();
    let finishOld!: (value: unknown) => void;
    mockSyntheticsServiceGet.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    routeParams.id = "slow-monitor";
    await flushPromises();
    expect(mockSyntheticsServiceGet).toHaveBeenLastCalledWith("org-1", "slow-monitor", "");
    mockSyntheticsServiceGet.mockResolvedValueOnce({
      data: { name: "New monitor", last_triggered_at: 42 },
    });
    routeParams.id = "new-monitor";
    await flushPromises();
    expect(wrapper.find('[data-test="app-page-header-title"]').text()).toBe("New monitor");
    finishOld({ data: { name: "Stale monitor", last_triggered_at: 1 } });
    await flushPromises();
    expect(wrapper.find('[data-test="app-page-header-title"]').text()).toBe("New monitor");
  });

  it("reloads the real runs child for a different monitor with no environment scope", async () => {
    wrapper = makeWrapper({ MonitorRuns: false, ChartRenderer: true, MonitorStatusTimeline: true });
    await flushPromises();
    const firstChild = wrapper.findComponent({ name: "SyntheticMonitorRuns" }).vm;
    mockSyntheticsServiceGet.mockResolvedValueOnce({
      data: { name: "Second", environments: [], last_triggered_at: 0 },
    });
    routeParams.id = "second-monitor";
    await flushPromises();
    expect(mockFetchAll).toHaveBeenCalledWith(
      "second-monitor",
      expect.any(Number),
      expect.any(Number),
      undefined,
      false,
    );
    expect(mockFetchAll.mock.calls.filter(([id]) => id === "second-monitor")).toHaveLength(1);
    expect(wrapper.findComponent({ name: "SyntheticMonitorRuns" }).vm).not.toBe(firstChild);
  });

  it.each([
    {
      description: "an explicit range, environment and run",
      query: {
        from: "1700100000000000",
        to: "1700100900000000",
        env: "staging",
        run: "run-b",
        exec: "exec-b",
      },
      range: { startTime: 1_700_100_000_000_000, endTime: 1_700_100_900_000_000 },
      environment: "staging",
    },
    {
      description: "no range, environment or run",
      query: {},
      range: { startTime: 1_700_000_000_000_000, endTime: 1_700_000_900_000_000 },
      environment: undefined,
    },
  ])(
    "initializes the next check from its URL with $description",
    async ({ query, range, environment }) => {
      routeQuery.value = {
        from: "1699000000000000",
        to: "1699000900000000",
        env: "prod",
        run: "run-a",
        exec: "exec-a",
      };
      for (const name of ["First", "Second"]) {
        mockSyntheticsServiceGet.mockResolvedValueOnce({
          data: { name, environments: ["prod-id", "staging-id"] },
        });
        mockListEnvironments.mockResolvedValueOnce({
          data: [
            { id: "prod-id", name: "prod" },
            { id: "staging-id", name: "staging" },
          ],
        });
      }
      wrapper = makeWrapper({
        MonitorRuns: false,
        ChartRenderer: true,
        MonitorStatusTimeline: true,
      });
      await flushPromises();
      expect(mockFetchAll).toHaveBeenLastCalledWith(
        "mon-1",
        1_699_000_000_000_000,
        1_699_000_900_000_000,
        "prod",
        false,
      );
      const picker = () =>
        wrapper.findComponent('[data-test="synthetic-monitor-results-date-time"]');
      const firstPicker = picker().vm;

      routeQuery.value = query;
      routeParams.id = "second-monitor";
      await flushPromises();

      expect(mockFetchAll).toHaveBeenLastCalledWith(
        "second-monitor",
        range.startTime,
        range.endTime,
        environment,
        environment === undefined,
      );
      expect(picker().vm).not.toBe(firstPicker);
      expect(picker().props("defaultAbsoluteTime")).toEqual(range);
      expect(picker().props("defaultType")).toBe(query.from ? "absolute" : "relative");
      expect(wrapper.findComponent(".odrawer-stub").props("open")).toBe(Boolean(query.run));
      const runDetail = wrapper.findComponent('[data-test="run-detail"]');
      expect(runDetail.props("overrideRunId")).toBe(query.run ?? "");
      expect(runDetail.props("overrideExecutionId")).toBe(query.exec ?? "");

      mockRouterReplace.mockClear();
      picker().vm.$emit("on:date-change", {
        valueType: "absolute",
        startTime: 1_699_000_000_000_000,
        endTime: 1_699_000_900_000_000,
        relativeTimePeriod: null,
        userChangedValue: false,
      });
      await flushPromises();
      expect(mockRouterReplace).not.toHaveBeenCalled();
      expect(mockFetchAll.mock.calls.filter(([id]) => id === "second-monitor")).toHaveLength(1);
    },
  );

  it("still loads the runs when the check itself fails to load", async () => {
    mockSyntheticsServiceGet.mockRejectedValueOnce({ response: { status: 500 } });
    wrapper = makeWrapper({ MonitorRuns: false, ChartRenderer: true, MonitorStatusTimeline: true });
    await flushPromises();
    expect(mockFetchAll).toHaveBeenCalledWith(
      "mon-1",
      expect.any(Number),
      expect.any(Number),
      undefined,
      false,
    );
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

    it("should title the page from the fetched check, not the deep link", async () => {
      // Rename-safe: the ?name= param is only the pre-fetch fallback.
      mockSyntheticsServiceGet.mockResolvedValueOnce({
        data: { name: "Renamed Check", status: "healthy", last_triggered_at: 0 },
      });
      wrapper = makeWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="app-page-header"]').text()).toContain("Renamed Check");
    });

    it("should offer the environment scope only from two environments up", async () => {
      wrapper = makeWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="synthetic-monitor-results-env-scope"]').exists()).toBe(
        false,
      );
      wrapper.unmount();

      mockSyntheticsServiceGet.mockResolvedValueOnce({
        data: {
          name: "Test Monitor",
          status: "healthy",
          last_triggered_at: 0,
          environments: ["e1", "e2"],
        },
      });
      mockListEnvironments.mockResolvedValueOnce({
        data: [
          { id: "e1", name: "cloud" },
          { id: "e2", name: "ap1" },
        ],
      });
      wrapper = makeWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="synthetic-monitor-results-env-scope"]').exists()).toBe(true);
    });

    it("should restore the scope from ?env= and pass it to MonitorRuns", async () => {
      routeQuery.value = { name: "Test Monitor", status: "healthy", env: "ap1" };
      mockSyntheticsServiceGet.mockResolvedValueOnce({
        data: {
          name: "Test Monitor",
          status: "healthy",
          last_triggered_at: 0,
          environments: ["e1", "e2"],
        },
      });
      mockListEnvironments.mockResolvedValueOnce({
        data: [
          { id: "e1", name: "cloud" },
          { id: "e2", name: "ap1" },
        ],
      });
      wrapper = makeWrapper();
      await flushPromises();
      const runs = wrapper.findComponent('[data-test="monitor-runs"]') as any;
      expect(runs.props("environmentScope")).toBe("ap1");
      // A deleted env id resolves to nothing and drops out of the options.
      expect(runs.props("environments")).toEqual(["cloud", "ap1"]);
    });

    it("should drop a ?env= the check no longer runs in instead of filtering to nothing", async () => {
      routeQuery.value = { name: "Test Monitor", status: "healthy", env: "deleted-env" };
      mockSyntheticsServiceGet.mockResolvedValueOnce({
        data: {
          name: "Test Monitor",
          status: "healthy",
          last_triggered_at: 0,
          environments: ["e1", "e2"],
        },
      });
      mockListEnvironments.mockResolvedValueOnce({
        data: [
          { id: "e1", name: "cloud" },
          { id: "e2", name: "ap1" },
        ],
      });
      wrapper = makeWrapper();
      await flushPromises();
      const runs = wrapper.findComponent('[data-test="monitor-runs"]') as any;
      expect(runs.props("environmentScope")).toBe("");
      const lastQuery = mockRouterReplace.mock.calls.at(-1)?.[0]?.query ?? {};
      expect(lastQuery.env).toBeUndefined();
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

    it("should navigate to synthetics-edit with id param on click", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const editBtn = wrapper.find('[data-test="synthetic-monitor-results-edit-btn"]');
      await editBtn.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics-edit",
        params: { id: "mon-1" },
        query: { org_identifier: "org-1" },
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

    it("passes an override error to RunDetail (and clears run/exec ids) when MonitorRuns emits open-run-error", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      await wrapper.find('[data-test="trigger-open-run-error"]').trigger("click");
      await flushPromises();

      const runDetail = wrapper.findComponent('[data-test="run-detail"]');
      expect(runDetail.props("overrideError")).toMatchObject({
        errorSource: "quota",
        message: "steps exhausted",
      });
      // An id-less error must NOT carry run/exec ids — RunDetail renders it from
      // the row instead of fetching a per-execution record.
      expect(runDetail.props("overrideRunId")).toBe("");
      expect(runDetail.props("overrideExecutionId")).toBe("");
      // No run/exec query params are written for an id-less error.
      expect(mockRouterReplace).not.toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ run: expect.anything() }) }),
      );
    });

    it("should pass an empty override-monitor-type to RunDetail until fetchCheck resolves", async () => {
      let resolveFetch: (value: any) => void;
      mockSyntheticsServiceGet.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      wrapper = makeWrapper();
      await flushPromises();

      // fetchCheck() hasn't settled yet — RunDetail must not receive the
      // possibly-stale "browser" default.
      let runDetail = wrapper.findComponent('[data-test="run-detail"]');
      expect(runDetail.props("overrideMonitorType")).toBe("");

      resolveFetch!({ data: { type: "api", last_triggered_at: 0 } });
      await flushPromises();

      // fetchCheck() has now resolved with the real type.
      runDetail = wrapper.findComponent('[data-test="run-detail"]');
      expect(runDetail.props("overrideMonitorType")).toBe("api");
    });

    it("should resolve override-monitor-type to the default type when fetchCheck fails with a non-404 error", async () => {
      mockSyntheticsServiceGet.mockRejectedValueOnce({ response: { status: 500 } });

      wrapper = makeWrapper();
      await flushPromises();

      // The finally block still flips checkTypeReady even on a non-404
      // error, exposing the untouched "browser" default.
      const runDetail = wrapper.findComponent('[data-test="run-detail"]');
      expect(runDetail.props("overrideMonitorType")).toBe("browser");
    });
  });

  describe("auto-open drawer from URL query params", () => {
    it("should open drawer when route query has run and exec params", async () => {
      routeQuery.value = {
        name: "Test Monitor",
        status: "healthy",
        run: "run-from-url",
        exec: "exec-from-url",
      };

      wrapper = makeWrapper();
      await flushPromises();

      expect(wrapper.findComponent(".odrawer-stub").props("open")).toBe(true);
    });
  });

  describe("route query integration", () => {
    it("should use default status when no status in query", async () => {
      routeQuery.value = { name: "Test Monitor" };
      wrapper = makeWrapper();
      await flushPromises();

      // Should not throw — defaults to "degraded"
      expect(wrapper.find('[data-test="synthetic-monitor-results-page"]').exists()).toBe(true);
    });

    it("should handle missing name gracefully with default title", async () => {
      routeQuery.value = {};
      mockSyntheticsServiceGet.mockRejectedValueOnce(new Error("network"));
      wrapper = makeWrapper();
      await flushPromises();

      const header = wrapper.find('[data-test="app-page-header"]');
      expect(header.text()).toContain("synthetics.results.title");
    });
  });

  describe("MonitorRuns events", () => {
    it("should forward edit event from MonitorRuns to editMonitor", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      const editBtn = wrapper.find('[data-test="trigger-edit"]');
      await editBtn.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics-edit",
        params: { id: "mon-1" },
        query: { org_identifier: "org-1" },
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
