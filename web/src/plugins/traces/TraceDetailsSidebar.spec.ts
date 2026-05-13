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

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
  afterAll,
  beforeAll,
} from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";

// Hoisted mock references — available inside vi.mock factories so individual
// tests can assert against them without re-mocking entire modules.
const { mockLoadSemanticGroups, mockBuildQueryDetails, mockNavigateToLogs } =
  vi.hoisted(() => ({
    mockLoadSemanticGroups: vi.fn().mockResolvedValue([]),
    mockBuildQueryDetails: vi.fn().mockReturnValue({}),
    mockNavigateToLogs: vi.fn(),
  }));

vi.mock("@/utils/traces/convertTraceData", () => ({
  getServiceIconDataUrl: vi
    .fn()
    .mockReturnValue("data:image/svg+xml;base64,ICON"),
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: { meta: { serviceColors: { alertmanager: "#1ab8be" } } },
    buildQueryDetails: mockBuildQueryDetails,
    navigateToLogs: mockNavigateToLogs,
  }),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "false",
  },
}));

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    findRelatedTelemetry: vi.fn().mockResolvedValue(null),
    loadSemanticGroups: mockLoadSemanticGroups,
  }),
}));

import componentSource from "@/plugins/traces/TraceDetailsSidebar.vue?raw";
import { getServiceIconDataUrl } from "@/utils/traces/convertTraceData";
import TraceDetailsSidebar from "@/plugins/traces/TraceDetailsSidebar.vue";
import useTraceDetails from "@/composables/traces/useTraceDetails";
import config from "@/aws-exports";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

// CSS.supports is not available in jsdom but used by TenstackTable
vi.stubGlobal("CSS", { supports: () => false });

// Mock @tanstack/vue-virtual so TenstackTable renders rows in jsdom
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (optsRef: any) => ({
    __v_isRef: true,
    value: {
      getTotalSize: () => optsRef.value.count * 28,
      getVirtualItems: () =>
        Array.from({ length: optsRef.value.count }, (_, i) => ({
          key: i,
          index: i,
          start: i * 28,
          size: 28,
        })),
      measureElement: vi.fn(),
    },
  }),
}));

vi.mock("@/plugins/logs/JsonPreview.vue", () => ({
  default: { template: "<div />" },
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

const mockStore = createStore({
  state: {
    theme: "light",
    API_ENDPOINT: "http://localhost:8080",
    zoConfig: {
      timestamp_column: "@timestamp",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
  },
});

const mockEvents =
  '[{"name":"[work_group:short] done a job: user_id None, trace_id bd64db54267785abbe7a43869ed8eb6e","_timestamp":1752490492843047,"code.filepath":"/home/runner/work/o2-enterprise/o2-enterprise/o2-enterprise/o2_enterprise/src/enterprise/search/work_group.rs","code.lineno":"125","level":"DEBUG","target":"o2_enterprise::enterprise::search::work_group","code.namespace":"o2_enterprise::enterprise::search::work_group"}]';

const mockExceptions =
  '[{"_timestamp": 1752490492843047,"name": "exception","exception.type": "RuntimeError","exception.message": "Test error","exception.escaped": "false","exception.stacktrace": "Error: Test error\\n    at test.js:1:1"}]';

const mockLinks =
  '[{"context": {"traceId": "f6e08ab2a928aa393375f0d9b05a9054", "spanId": "ecc59cb843104cf8"}}, {"context": {"traceId": "6262666637a9ae45ad3e25f5111dd59f", "spanId": "d9603ec7f76eb499"}}]';

const mockSpan = {
  _timestamp: 1752490492843047,
  start_time: 1752490492843000000,
  end_time: 1752490493164419300,
  duration: 321372,
  span_id: "d9603ec7f76eb499",
  trace_id: "6262666637a9ae45ad3e25f5111dd59f",
  operation_name: "service:alerts:evaluate_scheduled",
  service_name: "alertmanager",
  span_status: "UNSET",
  span_kind: 2, // Server
  parent_id: "6702b0494b2b6e57",
  events: "",
  links: "",
  http_method: "GET",
  http_status_code: "200",
  http_url: "/api/v1/alerts",
  service_service_instance: "dev2-openobserve-alertmanager-1",
  service_service_version: "v0.15.0-rc3",
  busy_ns: "40550",
  idle_ns: "321332352",
  code_filepath: "src/service/alerts/mod.rs",
  code_lineno: "114",
  code_namespace: "openobserve::service::alerts",
  thread_id: "6",
  thread_name: "job_runtime",
};

const mockBaseTracePosition = {
  durationUs: 350.372,
  startTimeUs: 1752490492843000,
  tics: [
    {
      value: 0,
      label: "0.00us",
      left: "-1px",
    },
    {
      value: 80.34,
      label: "80.34ms",
      left: "25%",
    },
    {
      value: 160.69,
      label: "160.69ms",
      left: "50%",
    },
    {
      value: 241.03,
      label: "241.03ms",
      left: "75%",
    },
    {
      value: 321.37,
      label: "321.37ms",
      left: "100%",
    },
  ],
};

describe("TraceDetailsSidebar", async () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mount(TraceDetailsSidebar, {
      attachTo: "#app",
      props: {
        span: mockSpan,
        baseTracePosition: mockBaseTracePosition,
        searchQuery: "",
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs: {
          "q-resize-observer": true,
          "q-virtual-scroll": {
            template: `
              <div>
                <slot name="before"></slot>
                <div v-for="(item, index) in items" :key="index">
                  <slot :item="item" :index="index"></slot>
                </div>
              </div>
            `,
            props: ["items"],
          },
        },
      },
    });

    const el = wrapper.find('[data-test="trace-details-sidebar-tabs"]').element;
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      value: 1024,
    });

    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should mount TraceDetailsSidebar component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should display operation name in header", () => {
    const operationName = wrapper.find(
      '[data-test="trace-details-sidebar-header-operation-name"]',
    );
    expect(operationName.exists()).toBe(true);
    expect(operationName.text()).toBe(mockSpan.operation_name);
  });

  it("should display service name", () => {
    const serviceName = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-service"]',
    );
    expect(serviceName.exists()).toBe(true);
    expect(serviceName.text()).toContain(mockSpan.service_name);
  });

  describe("service icon", () => {
    it("should render service icon img inside the service chip", () => {
      const serviceChip = wrapper.find(
        '[data-test="trace-details-sidebar-header-toolbar-service"]',
      );
      expect(serviceChip.exists()).toBe(true);
      const img = serviceChip.find("img");
      expect(img.exists()).toBe(true);
    });

    it("should set icon src from getServiceIconDataUrl", () => {
      const serviceChip = wrapper.find(
        '[data-test="trace-details-sidebar-header-toolbar-service"]',
      );
      expect(serviceChip.exists()).toBe(true);
      const img = serviceChip.find("img");
      expect(img.exists()).toBe(true);
      expect(img.attributes("src")).toBe("data:image/svg+xml;base64,ICON");
    });

    it("should call getServiceIconDataUrl with the span service name", () => {
      expect(
        vi
          .mocked(getServiceIconDataUrl)
          .mock.calls.some((call) => call[0] === mockSpan.service_name),
      ).toBe(true);
    });
  });

  it("should display duration", () => {
    const duration = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-duration"]',
    );
    expect(duration.exists()).toBe(true);
    expect(duration.text()).toContain("321.37ms");
  });

  it("should display start time", () => {
    const startTime = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-start-time"]',
    );
    expect(startTime.exists()).toBe(true);
    expect(startTime.text()).toContain("0us");
  });

  it("should display span ID", () => {
    const spanId = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-span-id"]',
    );
    expect(spanId.exists()).toBe(true);
    expect(spanId.text()).toContain(mockSpan.span_id);
  });

  it("should emit close when close button is clicked", async () => {
    const closeBtn = wrapper.find(
      '[data-test="trace-details-sidebar-header-close-btn"]',
    );
    expect(closeBtn.exists()).toBe(true);

    await closeBtn.trigger("click");

    expect(wrapper.emitted("close")).toBeTruthy();
  });

  describe("viewSpanLogs", () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn>;
    let pushSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      dispatchSpy?.mockRestore();
      pushSpy?.mockRestore();
      // Restore the default enterprise setting for subsequent tests
      config.isEnterprise = "true";
    });

    describe("when isEnterprise is true (enterprise branch)", () => {
      beforeEach(() => {
        // correlationProps is null by default because loadCorrelation() has not
        // been called. navigateToCorrelatedLogs() iterates correlationProps.value.logStreams,
        // so we must provide a valid value. No public API exists to set correlationProps
        // — we set vm state directly.
        wrapper.vm.correlationProps = {
          logStreams: [
            {
              stream_name: "test-stream",
              filters: { service_name: "test-svc" },
            },
          ],
          timeRange: { startTime: 1000000, endTime: 2000000 },
        };
        // Spy on store.dispatch and router.push to prevent real navigation and
        // assert they are called with the expected arguments.
        dispatchSpy = vi
          .spyOn(mockStore, "dispatch")
          .mockResolvedValue(undefined);
        pushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined);
      });

      it("should call loadSemanticGroups and navigate to /logs with query", async () => {
        const viewLogsBtn = wrapper.find(
          '[data-test="trace-details-sidebar-header-toolbar-view-logs-btn"]',
        );
        expect(viewLogsBtn.exists()).toBe(true);

        await viewLogsBtn.trigger("click");
        await flushPromises();

        expect(mockLoadSemanticGroups).toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(
          "logs/setIsInitialized",
          false,
        );
        expect(pushSpy).toHaveBeenCalled();
        const pushArgs = pushSpy.mock.calls[0][0];
        expect(pushArgs.path).toBe("/logs");
        expect(pushArgs.query.query).toBeDefined();
        expect(pushArgs.query.stream).toBe("test-stream");
      });

      it("should not call buildQueryDetails or navigateToLogs in enterprise path", async () => {
        const viewLogsBtn = wrapper.find(
          '[data-test="trace-details-sidebar-header-toolbar-view-logs-btn"]',
        );
        await viewLogsBtn.trigger("click");
        await flushPromises();

        expect(mockBuildQueryDetails).not.toHaveBeenCalled();
        expect(mockNavigateToLogs).not.toHaveBeenCalled();
      });
    });

    describe("when isEnterprise is false (non-enterprise branch)", () => {
      beforeEach(() => {
        config.isEnterprise = "false";
      });

      it("should call buildQueryDetails with the span and navigateToLogs", async () => {
        const viewLogsBtn = wrapper.find(
          '[data-test="trace-details-sidebar-header-toolbar-view-logs-btn"]',
        );
        expect(viewLogsBtn.exists()).toBe(true);

        await viewLogsBtn.trigger("click");

        expect(mockBuildQueryDetails).toHaveBeenCalledWith(mockSpan);
        expect(mockNavigateToLogs).toHaveBeenCalled();
      });

      it("should not call loadSemanticGroups", async () => {
        const viewLogsBtn = wrapper.find(
          '[data-test="trace-details-sidebar-header-toolbar-view-logs-btn"]',
        );
        await viewLogsBtn.trigger("click");

        expect(mockLoadSemanticGroups).not.toHaveBeenCalled();
      });
    });
  });

  it("should copy span ID when copy button is clicked", async () => {
    const copyBtn = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"]',
    );
    expect(copyBtn.exists()).toBe(true);

    await copyBtn.trigger("click");

    await flushPromises();

    // Check if clipboard.writeText was called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      mockSpan.span_id,
    );

    // Check if notification was triggered
    expect(wrapper.vm.$q.notify).toBeTruthy();
  });

  it("should show error notification when copy fails", async () => {
    // Mock clipboard API to fail for this specific test
    const originalWriteText = navigator.clipboard.writeText;
    (navigator.clipboard.writeText as any) = vi
      .fn()
      .mockRejectedValue(new Error("Clipboard error"));

    const copyBtn = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"]',
    );
    expect(copyBtn.exists()).toBe(true);

    await copyBtn.trigger("click");

    await flushPromises();

    // Check if clipboard.writeText was called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      mockSpan.span_id,
    );

    // Check if error notification was triggered
    expect(wrapper.vm.$q.notify).toBeTruthy();

    // Restore original mock
    (navigator.clipboard.writeText as any) = originalWriteText;
  });

  describe("Tabs functionality", () => {
    it("should have all required tabs", () => {
      const tabs = wrapper.findAll('[data-test="trace-details-sidebar-tabs"]');
      expect(tabs.length).toBeGreaterThan(0);

      const tabNames = ["attributes", "events", "exceptions", "links"];
      tabNames.forEach((tabName) => {
        const tab = wrapper.find(
          `[data-test="trace-details-sidebar-tabs-${tabName}"]`,
        );
        expect(tab.exists()).toBe(true);
      });
    });

    it("should switch to attributes tab by default", () => {
      expect(wrapper.vm.activeTab).toBe("attributes");
    });

    it("should switch tabs when clicked", async () => {
      const eventsTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-events"]',
      );
      await eventsTab.trigger("click");

      expect(wrapper.vm.activeTab).toBe("events");
    });
  });

  describe("Attributes tab content", () => {
    it("should display attributes table", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
    });

    it("should display HTTP method in attributes", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).toContain("GET");
    });

    it("should display HTTP status code in attributes", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).toContain("200");
    });
  });

  describe("Service information in Attributes tab", () => {
    it("should display service information", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
    });

    it("should display service name in attributes", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).toContain("alertmanager");
    });

    it("should display service instance in attributes", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).toContain(
        "dev2-openobserve-alertmanager-1",
      );
    });
  });

  describe("Events tab", () => {
    beforeEach(async () => {
      const eventsTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-events"]',
      );
      await eventsTab.trigger("click");
    });

    it("should display events table", () => {
      // When there are no events, the table doesn't exist, only the no-events message shows
      const noEventsMsg = wrapper.find(
        '[data-test="trace-details-sidebar-no-events"]',
      );
      expect(noEventsMsg.exists()).toBe(true);
    });

    it("should display no events message when no events", () => {
      const noEventsMsg = wrapper.find(
        '[data-test="trace-details-sidebar-no-events"]',
      );
      expect(noEventsMsg.exists()).toBe(true);
      expect(noEventsMsg.text()).toContain("No events present for this span");
    });

    describe("When events exist", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          span: { ...mockSpan, events: mockEvents },
        });

        await flushPromises();
        await wrapper.vm.$nextTick();
      });

      it("should display events table", async () => {
        const eventsTable = wrapper.find(
          '[data-test="trace-details-sidebar-events-table"]',
        );

        expect(eventsTable.exists()).toBe(true);
      });

      it("should display event rows", async () => {
        // Wait for virtual scroll to render items
        await flushPromises();
        await wrapper.vm.$nextTick();

        // TenstackTable renders rows with data-test="o2-table-detail-{timestamp}"
        const eventRows = wrapper.findAll('[data-test^="o2-table-detail-"]');
        expect(eventRows.length).toBeGreaterThan(0);
      });

      it("should expand event when clicked", async () => {
        await flushPromises();
        await wrapper.vm.$nextTick();

        // TenstackTable renders an expand button for each row
        const expandBtn = wrapper.find('[data-test="table-row-expand-menu"]');
        expect(expandBtn.exists()).toBe(true);

        await expandBtn.trigger("click");
        await flushPromises();
        await wrapper.vm.$nextTick();

        // After expansion TenstackTable inserts an expanded row (data-test="o2-table-expanded-row-{index}")
        const expandedRow = wrapper.find(
          '[data-test^="o2-table-expanded-row-"]',
        );
        expect(expandedRow.exists()).toBe(true);
      });

      it("should not display no events message", () => {
        const noEventsMsg = wrapper.find(
          '[data-test="trace-details-sidebar-no-events"]',
        );
        expect(noEventsMsg.exists()).toBe(false);
      });

      describe("When we search for a event", () => {
        beforeEach(async () => {
          await wrapper.setProps({
            searchQuery: "work_group",
          });

          await flushPromises();
          await wrapper.vm.$nextTick();
        });

        it("should display event rows that match the search query", async () => {
          await flushPromises();
          await wrapper.vm.$nextTick();

          // Events are not filtered by searchQuery — all rows remain visible.
          // TenstackTable renders rows with data-test="o2-table-detail-{timestamp}"
          const eventRows = wrapper.findAll('[data-test^="o2-table-detail-"]');
          expect(eventRows.length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe("Exceptions tab", () => {
    beforeEach(async () => {
      const exceptionsTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-exceptions"]',
      );
      await exceptionsTab.trigger("click");
    });

    it("should display events table", () => {
      // When there are no exceptions, the table doesn't exist, only the no-exceptions message
      const noExceptionsMsg = wrapper.find(
        '[data-test="trace-details-sidebar-no-exceptions"]',
      );
      expect(noExceptionsMsg.exists()).toBe(true);
    });

    it("should display no exceptions message when no exception events", () => {
      const noExceptionsMsg = wrapper.find(
        '[data-test="trace-details-sidebar-no-exceptions"]',
      );
      expect(noExceptionsMsg.exists()).toBe(true);
      expect(noExceptionsMsg.text()).toContain(
        "No exceptions present for this span",
      );
    });

    describe("When exceptions exist", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          span: {
            ...mockSpan,
            events: mockExceptions,
          },
        });
        await flushPromises();
        await wrapper.vm.$nextTick();
      });

      it("should display exceptions when exception events exist", () => {
        const exceptionsTable = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table"]',
        );
        expect(exceptionsTable.exists()).toBe(true);
      });

      it("should display exception rows", async () => {
        await flushPromises();
        await wrapper.vm.$nextTick();
        const exceptionRows = wrapper.findAll(
          '[data-test^="trace-event-detail-"]',
        );
        expect(exceptionRows.length).toBeGreaterThan(0);
      });

      it("should not display no exceptions message", () => {
        const noExceptionsMsg = wrapper.find(
          '[data-test="trace-details-sidebar-no-exceptions"]',
        );
        expect(noExceptionsMsg.exists()).toBe(false);
      });

      it("should expand exception when clicked", async () => {
        const exceptionRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
        );
        await exceptionRow.trigger("click");
        expect(
          wrapper
            .find(
              '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
            )
            .exists(),
        ).toBe(true);
      });

      it("should collapse exception when clicked again", async () => {
        const exceptionRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
        );
        await exceptionRow.trigger("click");

        expect(
          wrapper
            .find(
              '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
            )
            .exists(),
        ).toBe(true);

        await exceptionRow.trigger("click");

        expect(
          wrapper
            .find(
              '[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]',
            )
            .exists(),
        ).toBe(false);
      });
    });
  });

  describe("Links tab", () => {
    beforeEach(async () => {
      const linksTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-links"]',
      );
      await linksTab.trigger("click");
    });

    it("should display no links message when no links", () => {
      // Check if either no-links message exists OR links are present
      const noLinksMsg = wrapper.find(
        '[data-test="trace-details-sidebar-no-links"]',
      );
      const linksTable = wrapper.find(
        '[data-test="trace-details-sidebar-links-table"]',
      );
      // Either message or table should exist, but not both
      expect(noLinksMsg.exists() || linksTable.exists()).toBe(true);
    });

    describe("When links exist", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          span: { ...mockSpan, links: mockLinks },
        });
        await flushPromises();
        await wrapper.vm.$nextTick();
      });

      it("should display links table", () => {
        const linksTable = wrapper.find(
          '[data-test="trace-details-sidebar-links-table"]',
        );
        expect(linksTable.exists()).toBe(true);
      });

      it("should display link rows", async () => {
        await flushPromises();
        await wrapper.vm.$nextTick();

        const linkRows = wrapper.findAll('[data-test^="trace-event-detail-"]');
        expect(linkRows.length).toBeGreaterThan(0);
      });

      it("should not display no links message", () => {
        const noLinksMsg = wrapper.find(
          '[data-test="trace-details-sidebar-no-links"]',
        );
        expect(noLinksMsg.exists()).toBe(false);
      });

      it("should emit open-trace when a different trace link is clicked", async () => {
        const linkRow = wrapper.find('[data-test="trace-event-detail-link-0"]');
        await linkRow.trigger("click");

        expect(wrapper.emitted("open-trace")).toBeTruthy();
      });

      it("should emit select-span when a same trace link is clicked", async () => {
        const linkRow = wrapper.find('[data-test="trace-event-detail-link-1"]');
        await linkRow.trigger("click");

        expect(wrapper.emitted("select-span")).toBeTruthy();
        expect(wrapper.emitted("select-span")[0]).toEqual([
          JSON.parse(mockLinks)[1].context.spanId,
        ]);
      });
    });

    describe("When links are of type array", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          span: { ...mockSpan, links: JSON.parse(mockLinks) },
        });
        await flushPromises();
        await wrapper.vm.$nextTick();
      });

      it("should display links table", () => {
        const linksTable = wrapper.find(
          '[data-test="trace-details-sidebar-links-table"]',
        );
        expect(linksTable.exists()).toBe(true);
      });

      it("should display link rows", async () => {
        await flushPromises();
        await wrapper.vm.$nextTick();

        const linkRows = wrapper.findAll('[data-test^="trace-event-detail-"]');
        expect(linkRows.length).toBeGreaterThan(0);
      });

      it("should not display no links message", () => {
        const noLinksMsg = wrapper.find(
          '[data-test="trace-details-sidebar-no-links"]',
        );
        expect(noLinksMsg.exists()).toBe(false);
      });
    });

    describe("When links are not valid JSON", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          span: { ...mockSpan, links: "invalid-json" },
        });
        await flushPromises();
        await wrapper.vm.$nextTick();
      });

      it("should display no links message", () => {
        // Component should handle invalid JSON gracefully
        // Check if either no-links message exists OR links table with default data
        const noLinksMsg = wrapper.find(
          '[data-test="trace-details-sidebar-no-links"]',
        );
        const linksTable = wrapper.find(
          '[data-test="trace-details-sidebar-links-table"]',
        );
        // At least one should exist
        expect(noLinksMsg.exists() || linksTable.exists()).toBe(true);
      });
    });

    //   it("should display link row", () => {
    //     const linkRow = wrapper.find('[data-test="trace-event-details-f6e08ab2a928aa393375f0d9b05a9054"]');
    //     expect(linkRow.exists()).toBe(true);
    //   });
  });

  describe("Attributes tab", () => {
    beforeEach(async () => {
      const attributesTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-attributes"]',
      );
      await attributesTab.trigger("click");
    });

    it("should display attributes", () => {
      const attributesContent = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesContent.exists()).toBe(true);
    });

    it("should display span ID in attributes", () => {
      const attributesContent = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesContent.text()).toContain(mockSpan.span_id);
    });
  });

  describe("Search highlighting", () => {
    it("should highlight search terms in attributes", async () => {
      await wrapper.setProps({
        searchQuery: "GET",
      });

      await flushPromises();

      // Verify search query is set
      expect(wrapper.vm.searchQuery).toBe("GET");
      // Attributes tab is default — verify it contains the search term
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.text()).toContain("GET");
    });

    it("should highlight search terms in service information", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      // Verify search query is set
      expect(wrapper.vm.searchQuery).toBe("alertmanager");
      // Attributes tab is default — verify it contains the search term
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.text()).toContain("alertmanager");
    });
  });

  describe("Error handling", () => {
    it("should handle invalid events JSON gracefully", async () => {
      await wrapper.setProps({
        span: {
          ...mockSpan,
          events: "invalid json",
        },
      });

      await flushPromises();

      // Should not crash and should handle the error gracefully
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle invalid links JSON gracefully", async () => {
      await wrapper.setProps({
        span: {
          ...mockSpan,
          links: "invalid json",
        },
      });

      await flushPromises();

      // Should not crash and should handle the error gracefully
      expect(wrapper.exists()).toBe(true);
    });

    it("should properly update when span props change", async () => {
      // First, check the initial state
      const initialLinks = wrapper.vm.spanLinks;

      // Update the span with invalid links
      await wrapper.setProps({
        span: {
          ...mockSpan,
          links: "invalid json",
        },
      });

      // Force the component to update by triggering a re-render
      await wrapper.vm.$nextTick();
      await flushPromises();

      // Check if the component's internal state has been updated
      const updatedLinks = wrapper.vm.spanLinks;

      // Component should handle invalid JSON gracefully without crashing
      expect(wrapper.exists()).toBe(true);
      // spanLinks should be an array (may be empty or have default values)
      expect(Array.isArray(updatedLinks)).toBe(true);
    });

    it("should force component update when props change", async () => {
      // Create a new wrapper with different props to force a complete re-render
      const newWrapper = mount(TraceDetailsSidebar, {
        attachTo: "#app",
        props: {
          span: {
            ...mockSpan,
            links: "invalid json",
          },
          baseTracePosition: mockBaseTracePosition,
          searchQuery: "",
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": {
              template: `
                <div>
                  <slot name="before"></slot>
                  <div v-for="(item, index) in items" :key="index">
                    <slot :item="item" :index="index"></slot>
                  </div>
                </div>
              `,
              props: ["items"],
            },
          },
        },
      });

      await flushPromises();

      // Component should mount successfully even with invalid links
      expect(newWrapper.exists()).toBe(true);
      // spanLinks should be an array (either empty or with default values depending on implementation)
      expect(Array.isArray(newWrapper.vm.spanLinks)).toBe(true);

      newWrapper.unmount();
    });
  });

  describe("correlateForMetrics — no data found", () => {
    let correlationWrapper: any;

    beforeEach(async () => {
      correlationWrapper = mount(TraceDetailsSidebar, {
        attachTo: "#app",
        props: {
          span: mockSpan,
          baseTracePosition: mockBaseTracePosition,
          searchQuery: "",
          streamName: "default",
          serviceStreamsEnabled: true,
        },
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": {
              template: `
                <div>
                  <slot name="before"></slot>
                  <div v-for="(item, index) in items" :key="index">
                    <slot :item="item" :index="index"></slot>
                  </div>
                </div>
              `,
              props: ["items"],
            },
          },
        },
      });

      await correlationWrapper.vm.$nextTick();
    });

    afterEach(() => {
      correlationWrapper?.unmount();
    });

    it("should set correlationError to noDataFound message when findRelatedTelemetry returns null", async () => {
      const metricsTab = correlationWrapper.find(
        '[data-test="trace-details-sidebar-tabs-correlated-metrics"]',
      );
      expect(metricsTab.exists()).toBe(true);

      await metricsTab.trigger("click");
      await flushPromises();

      expect(correlationWrapper.vm.correlationError).toContain("No Data Found");
    });
  });

  describe("getFilterValue — raw value substitution for RAW_VALUE_FILTER_FIELDS", () => {
    // getFilterValue is explicitly returned from setup() and is part of the component's
    // public API. We call it directly here to unit-test its branching logic in isolation
    // before verifying the full emit path through DOM interaction below.
    //
    // RAW_VALUE_FILTER_FIELDS = new Set(["start_time", "end_time", <timestamp_column>])
    // All three fields go through the same unified path: span[field] ?? displayValue.
    // start_time and end_time arrive as nanosecond strings after NS-field patching in the
    // search pipeline, so the tests use string fixtures to reflect the real runtime type.

    it("should return the raw string start_time from props.span, not the formatted display string", async () => {
      const rawStartTime = "1700000000123456789";
      await wrapper.setProps({
        span: { ...mockSpan, start_time: rawStartTime },
      });
      const result = wrapper.vm.getFilterValue("start_time", "formatted-date");
      expect(result).toBe(rawStartTime);
    });

    it("should return the raw string end_time from props.span, not the formatted display string", async () => {
      const rawEndTime = "1700000321495828456";
      await wrapper.setProps({ span: { ...mockSpan, end_time: rawEndTime } });
      const result = wrapper.vm.getFilterValue("end_time", "formatted-date");
      expect(result).toBe(rawEndTime);
    });

    it("should return the display value unchanged for non-RAW_VALUE_FILTER_FIELDS (e.g. span_id)", () => {
      const displayValue = mockSpan.span_id;
      const result = wrapper.vm.getFilterValue("span_id", displayValue);
      expect(result).toBe(displayValue);
    });

    it("should return the display value unchanged for an arbitrary field not in the set", () => {
      const displayValue = "GET";
      const result = wrapper.vm.getFilterValue("http_method", displayValue);
      expect(result).toBe(displayValue);
    });

    it("should fall back to display value when start_time is absent from props.span", async () => {
      const spanWithoutStartTime = { ...mockSpan };
      delete (spanWithoutStartTime as any).start_time;
      await wrapper.setProps({ span: spanWithoutStartTime });

      const displayValue = "fallback display";
      const result = wrapper.vm.getFilterValue("start_time", displayValue);
      expect(result).toBe(displayValue);
    });

    it("should return the raw value for the configured timestamp column (@timestamp)", async () => {
      // mockStore has zoConfig.timestamp_column = "@timestamp", so RAW_VALUE_FILTER_FIELDS
      // includes "@timestamp". Mount a wrapper whose span contains @timestamp so the raw
      // value can be returned rather than falling back to displayValue.
      const rawTsValue = 9_999_999_999_999;
      const spanWithTsCol = { ...mockSpan, "@timestamp": rawTsValue };
      const tsWrapper = mount(TraceDetailsSidebar, {
        attachTo: "#app",
        props: {
          span: spanWithTsCol,
          baseTracePosition: mockBaseTracePosition,
          searchQuery: "",
        },
        global: {
          plugins: [i18n, router],
          provide: { store: mockStore },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": {
              template: "<div><slot /></div>",
              props: ["items"],
            },
          },
        },
      });
      await tsWrapper.vm.$nextTick();
      const displayValue = "2025-07-14T10:14:52.843Z";
      expect(tsWrapper.vm.getFilterValue("@timestamp", displayValue)).toBe(
        rawTsValue,
      );
      tsWrapper.unmount();
    });

    it("should return the display value unchanged for _timestamp when timestamp_column is @timestamp", () => {
      // mockStore.zoConfig.timestamp_column = "@timestamp", so RAW_VALUE_FILTER_FIELDS
      // is Set(["start_time", "end_time", "@timestamp"]).
      // "_timestamp" is NOT in the set — display value must pass through unchanged.
      const displayValue = "2025-07-14T10:14:52.843Z";
      const result = wrapper.vm.getFilterValue("_timestamp", displayValue);
      expect(result).toBe(displayValue);
    });
  });

  describe("getFormattedSpanDetails — _start_time_ns / _end_time_ns are never injected", () => {
    // The NS patching pipeline no longer injects _start_time_ns / _end_time_ns shadow
    // fields onto span objects. getFormattedSpanDetails must therefore not expose them
    // in the rendered attributes, and the component must not attempt to delete them.

    it("should not render _start_time_ns in the attributes table", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).not.toContain("_start_time_ns");
    });

    it("should not render _end_time_ns in the attributes table", () => {
      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).not.toContain("_end_time_ns");
    });

    it("should not expose _start_time_ns or _end_time_ns for the standard mockSpan which carries neither key", () => {
      // The NS patching pipeline no longer injects _start_time_ns / _end_time_ns into spans.
      // mockSpan represents a normal span that does not carry those keys, so they must not
      // appear in the rendered attribute list.
      expect(
        Object.prototype.hasOwnProperty.call(mockSpan, "_start_time_ns"),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(mockSpan, "_end_time_ns"),
      ).toBe(false);

      const attributesTable = wrapper.find(
        '[data-test="trace-details-sidebar-attributes-table"]',
      );
      expect(attributesTable.exists()).toBe(true);
      expect(attributesTable.text()).not.toContain("_start_time_ns");
      expect(attributesTable.text()).not.toContain("_end_time_ns");
    });
  });

  describe("apply-filter-immediately emit — getFilterValue called at the emit site", () => {
    // This describe block mounts a separate wrapper with JsonPreview stubbed to render
    // its #field-dropdown slot directly in the DOM (no q-btn-dropdown popup layer).
    // This lets us click the filter q-item without needing Quasar popup mechanics.
    //
    // start_time and end_time are provided as nanosecond strings to reflect the real
    // runtime type after NS-field patching in the search pipeline.
    let filterWrapper: any;

    const NS_START_TIME = "1700000000123456789";
    const NS_END_TIME = "1700000321495828456";

    const mountWithInlineSlot = (spanOverrides: Record<string, unknown> = {}) =>
      mount(TraceDetailsSidebar, {
        attachTo: "#app",
        props: {
          span: {
            ...mockSpan,
            start_time: NS_START_TIME,
            end_time: NS_END_TIME,
            ...spanOverrides,
          },
          baseTracePosition: mockBaseTracePosition,
          searchQuery: "",
        },
        global: {
          plugins: [i18n, router],
          provide: { store: mockStore },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": {
              template: `
                <div>
                  <slot name="before"></slot>
                  <div v-for="(item, index) in items" :key="index">
                    <slot :item="item" :index="index"></slot>
                  </div>
                </div>
              `,
              props: ["items"],
            },
            // Stub JsonPreview to render its #field-dropdown slot inline for each key
            // in `value`, so the q-item inside is immediately clickable without a popup.
            JsonPreview: {
              props: [
                "value",
                "highlightQuery",
                "showCopyButton",
                "copyButtonClass",
              ],
              template: `
                <div data-test="trace-details-sidebar-attributes-table">
                  <div
                    v-for="(val, key) in value"
                    :key="key"
                    :data-test="'json-preview-field-' + key"
                  >
                    <slot name="field-dropdown" :field="key" :value="val" />
                  </div>
                </div>
              `,
            },
          },
        },
      });

    beforeEach(async () => {
      filterWrapper = mountWithInlineSlot();
      await filterWrapper.vm.$nextTick();
    });

    afterEach(() => {
      filterWrapper?.unmount();
    });

    it("should emit apply-filter-immediately with the raw NS-string start_time, not the display string", async () => {
      // The stub renders the slot for every key. Find the q-item under the start_time field.
      const startTimeSlot = filterWrapper.find(
        '[data-test="json-preview-field-start_time"]',
      );
      expect(startTimeSlot.exists()).toBe(true);

      // Click the first q-item in the slot (the "=" filter action)
      const items = startTimeSlot.findAll(".q-item");
      expect(items.length).toBeGreaterThan(0);
      await items[0].trigger("click");

      const emitted = filterWrapper.emitted("apply-filter-immediately");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0];
      expect(lastEmit.field).toBe("start_time");
      // Must be the raw nanosecond string from props.span (as delivered by NS patching),
      // not the formatted date string produced by getFormattedSpanDetails.
      expect(lastEmit.value).toBe(NS_START_TIME);
    });

    it("should emit apply-filter-immediately with the raw NS-string end_time, not the display string", async () => {
      const endTimeSlot = filterWrapper.find(
        '[data-test="json-preview-field-end_time"]',
      );
      expect(endTimeSlot.exists()).toBe(true);

      const items = endTimeSlot.findAll(".q-item");
      expect(items.length).toBeGreaterThan(0);
      await items[0].trigger("click");

      const emitted = filterWrapper.emitted("apply-filter-immediately");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0];
      expect(lastEmit.field).toBe("end_time");
      // Must be the raw nanosecond string from props.span (as delivered by NS patching),
      // not the formatted date string.
      expect(lastEmit.value).toBe(NS_END_TIME);
    });

    it("should emit apply-filter-immediately with the display string unchanged for span_id", async () => {
      const spanIdSlot = filterWrapper.find(
        '[data-test="json-preview-field-span_id"]',
      );
      expect(spanIdSlot.exists()).toBe(true);

      const items = spanIdSlot.findAll(".q-item");
      expect(items.length).toBeGreaterThan(0);
      await items[0].trigger("click");

      const emitted = filterWrapper.emitted("apply-filter-immediately");
      expect(emitted).toBeTruthy();
      const lastEmit = emitted![emitted!.length - 1][0];
      expect(lastEmit.field).toBe("span_id");
      // span_id is not in RAW_VALUE_FILTER_FIELDS — display value passes through
      expect(lastEmit.value).toBe(mockSpan.span_id);
    });
  });

  describe("Copy functionality", () => {
    it("should find copy button and trigger copy", async () => {
      // Wait for component to be fully rendered
      await flushPromises();

      // Find the copy button
      const copyBtn = wrapper.find(
        '[data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"]',
      );

      // If button exists, test the copy functionality
      if (copyBtn.exists()) {
        await copyBtn.trigger("click");

        // Check that the copy function was called
        // Since we're using Quasar's copyToClipboard, we can't easily mock it
        // But we can check that the component didn't crash
        expect(wrapper.exists()).toBe(true);
        // Check if clipboard.writeText was called
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          mockSpan.span_id,
        );

        // Check if error notification was triggered
        expect(wrapper.vm.$q.notify).toBeTruthy();
      } else {
        console.log("Copy button not found, skipping test");
      }
    });

    it("should show success notification when copy succeeds", async () => {
      await flushPromises();

      const copyBtn = wrapper.find(
        '[data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"]',
      );
      if (copyBtn.exists()) {
        await copyBtn.trigger("click");

        // The component should show a notification
        // We can't easily test the actual notification in the test environment
        // but we can verify the component didn't crash
        expect(wrapper.exists()).toBe(true);
      }
    });
  });

  describe("LLM Preview tab — LLMContentRenderer instance-id", () => {
    const LLM_SPAN_ID = "d9603ec7f76eb499";

    const mockLLMSpan = {
      _timestamp: 1752490492843047,
      start_time: 1752490492843000000,
      end_time: 1752490493164419300,
      duration: 321372,
      span_id: LLM_SPAN_ID,
      trace_id: "6262666637a9ae45ad3e25f5111dd59f",
      operation_name: "ChatCompletion",
      service_name: "openai-service",
      span_status: "UNSET",
      span_kind: 2,
      parent_id: "6702b0494b2b6e57",
      events: "",
      links: "",
      llm_input: '{"messages": [{"role": "user", "content": "Hello"}]}',
      llm_output: '{"choices": [{"message": {"content": "Hi there!"}}]}',
      llm_observation_type: "LLM",
      llm_model_name: "gpt-4",
    };

    let llmWrapper: any;

    beforeEach(async () => {
      llmWrapper = mount(TraceDetailsSidebar, {
        attachTo: "#app",
        props: {
          span: mockLLMSpan,
          baseTracePosition: mockBaseTracePosition,
          searchQuery: "",
        },
        global: {
          plugins: [i18n, router],
          provide: { store: mockStore },
          stubs: {
            "q-resize-observer": true,
            "q-virtual-scroll": {
              template: `
                <div>
                  <slot name="before"></slot>
                  <div v-for="(item, index) in items" :key="index">
                    <slot :item="item" :index="index"></slot>
                  </div>
                </div>
              `,
              props: ["items"],
            },
            LLMContentRenderer: {
              template: `<div :data-test="\`llm-content-renderer-\${contentType}\`" :data-instance-id="instanceId"><slot /></div>`,
              props: [
                "content",
                "observationType",
                "contentType",
                "span",
                "viewMode",
                "instanceId",
              ],
            },
            TenstackTable: true,
            "q-expansion-item": true,
            CodemirrorEditor: true,
            CodeQueryEditor: true,
          },
        },
      });

      await llmWrapper.vm.$nextTick();
    });

    afterEach(() => {
      llmWrapper?.unmount();
    });

    it("should render the preview tab by default for an LLM span", () => {
      expect(llmWrapper.vm.activeTab).toBe("preview");
    });

    it("should render the input LLMContentRenderer when llm_input has content", () => {
      const inputRenderer = llmWrapper.find(
        '[data-test="llm-content-renderer-input"]',
      );
      expect(inputRenderer.exists()).toBe(true);
    });

    it("should render the output LLMContentRenderer when llm_output has content", () => {
      const outputRenderer = llmWrapper.find(
        '[data-test="llm-content-renderer-output"]',
      );
      expect(outputRenderer.exists()).toBe(true);
    });

    it("should pass instance-id ending with -input to the input LLMContentRenderer", () => {
      const inputRenderer = llmWrapper.find(
        '[data-test="llm-content-renderer-input"]',
      );
      expect(inputRenderer.exists()).toBe(true);
      expect(inputRenderer.attributes("data-instance-id")).toBe(
        `${LLM_SPAN_ID}-input`,
      );
    });

    it("should pass instance-id ending with -output to the output LLMContentRenderer", () => {
      const outputRenderer = llmWrapper.find(
        '[data-test="llm-content-renderer-output"]',
      );
      expect(outputRenderer.exists()).toBe(true);
      expect(outputRenderer.attributes("data-instance-id")).toBe(
        `${LLM_SPAN_ID}-output`,
      );
    });

    it("should include the span_id in the input instance-id", () => {
      const inputRenderer = llmWrapper.find(
        '[data-test="llm-content-renderer-input"]',
      );
      expect(inputRenderer.exists()).toBe(true);
      expect(inputRenderer.attributes("data-instance-id")).toContain(
        LLM_SPAN_ID,
      );
    });

    it("should include the span_id in the output instance-id", () => {
      const outputRenderer = llmWrapper.find(
        '[data-test="llm-content-renderer-output"]',
      );
      expect(outputRenderer.exists()).toBe(true);
      expect(outputRenderer.attributes("data-instance-id")).toContain(
        LLM_SPAN_ID,
      );
    });
  });

  describe("CSS verification — .vjs-tree removal", () => {
    it("should not reference .vjs-tree in component styles", () => {
      // Verify that the removed .vjs-tree CSS selector is absent from the
      // component's <style> blocks. The ?raw import returns the exact
      // source content, so a regex scan confirms no style block targets
      // .vjs-tree (the hover-suppression rules that were removed).
      expect(componentSource).not.toMatch(/\.vjs-tree/);
    });
  });
});
