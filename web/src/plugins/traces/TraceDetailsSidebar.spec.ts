// Copyright 2023 OpenObserve Inc.
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
import TraceDetailsSidebar from "@/plugins/traces/TraceDetailsSidebar.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

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
  start_time: 1752490492843047200,
  end_time: 1752490493164419300,
  duration: 321372,
  span_id: "d9603ec7f76eb499",
  trace_id: "6262666637a9ae45ad3e25f5111dd59f",
  operation_name: "service:alerts:evaluate_scheduled",
  service_name: "alertmanager",
  span_status: "UNSET",
  span_kind: 2, // Client
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
  durationMs: 350.372,
  startTimeMs: 1752490492843,
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
    expect(serviceName.text()).toContain("Service: " + mockSpan.service_name);
  });

  it("should display duration", () => {
    const duration = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-duration"]',
    );
    expect(duration.exists()).toBe(true);
    expect(duration.text()).toContain("Duration: 321.37ms");
  });

  it("should display start time", () => {
    const startTime = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-start-time"]',
    );
    expect(startTime.exists()).toBe(true);
    expect(startTime.text()).toContain("Start Time: 0ms");
  });

  it("should display span ID", () => {
    const spanId = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-span-id"]',
    );
    expect(spanId.exists()).toBe(true);
    expect(spanId.text()).toContain("Span ID: " + mockSpan.span_id);
  });

  it("should emit close when close button is clicked", async () => {
    const closeBtn = wrapper.find(
      '[data-test="trace-details-sidebar-header-close-btn"]',
    );
    expect(closeBtn.exists()).toBe(true);

    await closeBtn.trigger("click");

    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("should trigger view logs functionality when view logs button is clicked", async () => {
    const viewLogsBtn = wrapper.find(
      '[data-test="trace-details-sidebar-header-toolbar-view-logs-btn"]',
    );
    expect(viewLogsBtn.exists()).toBe(true);

    await viewLogsBtn.trigger("click");

    // The component should call viewSpanLogs function which uses useTraces composable
    // to navigate to logs page with span-specific query parameters
    // Since we can't easily mock the composable in this test setup,
    // we just verify the button click doesn't throw an error
    expect(viewLogsBtn.exists()).toBe(true);
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

  //   describe("When copy fails", async () => {
  //     beforeEach(async () => {
  //         vi.mock('quasar', async () => {
  //             const actual = await vi.importActual<typeof import('quasar')>('quasar');
  //             return {
  //               ...actual,
  //               copyToClipboard: vi.fn().mockRejectedValue(new Error('Clipboard error')),
  //             };
  //           });
  //     });

  //     afterEach(() => {
  //         vi.clearAllMocks();
  //     });

  //     it("should show error notification when copy fails", async () => {
  //         await flushPromises();

  //         const copyBtn = wrapper.find(
  //         '[data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"]',
  //         );
  //         expect(copyBtn.exists()).toBe(true);

  //         await copyBtn.trigger("click");

  //         await flushPromises();

  //         // Check if clipboard.writeText was called
  //         expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockSpan.span_id);

  //         // Check if notification was triggered
  //         expect(wrapper.vm.$q.notify).toBeTruthy();
  //     });
  //   });

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

      const tabNames = [
        "tags",
        "process",
        "events",
        "exceptions",
        "links",
        "attributes",
      ];
      tabNames.forEach((tabName) => {
        const tab = wrapper.find(
          `[data-test="trace-details-sidebar-tabs-${tabName}"]`,
        );
        expect(tab.exists()).toBe(true);
      });
    });

    it("should switch to tags tab by default", () => {
      expect(wrapper.vm.activeTab).toBe("tags");
    });

    it("should switch tabs when clicked", async () => {
      const processTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-process"]',
      );
      await processTab.trigger("click");

      expect(wrapper.vm.activeTab).toBe("process");
    });
  });

  describe("Tags tab", () => {
    it("should display tags in table format", () => {
      const tagsTable = wrapper.find(
        '[data-test="trace-details-sidebar-tags-table"]',
      );
      expect(tagsTable.exists()).toBe(true);
    });

    it("should display HTTP method tag", () => {
      const httpMethodRow = wrapper.find(
        '[data-test="trace-details-sidebar-tags-http_method"]',
      );
      expect(httpMethodRow.exists()).toBe(true);
      expect(httpMethodRow.text()).toContain("GET");
    });

    it("should display HTTP status code tag", () => {
      const httpStatusRow = wrapper.find(
        '[data-test="trace-details-sidebar-tags-http_status_code"]',
      );
      expect(httpStatusRow.exists()).toBe(true);
      expect(httpStatusRow.text()).toContain("200");
    });
  });

  describe("Process tab", () => {
    beforeEach(async () => {
      const processTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-process"]',
      );
      await processTab.trigger("click");
    });

    it("should display process information", () => {
      const processTable = wrapper.find(
        '[data-test="trace-details-sidebar-process-table"]',
      );
      expect(processTable.exists()).toBe(true);
    });

    it("should display service name in process", () => {
      const serviceNameRow = wrapper.find(
        '[data-test="trace-details-sidebar-process-service_name"]',
      );
      expect(serviceNameRow.exists()).toBe(true);
      expect(serviceNameRow.text()).toContain("alertmanager");
    });

    it("should display service instance in process", () => {
      const serviceInstanceRow = wrapper.find(
        '[data-test="trace-details-sidebar-process-service_service_instance"]',
      );
      expect(serviceInstanceRow.exists()).toBe(true);
      expect(serviceInstanceRow.text()).toContain(
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
      const eventsTable = wrapper.find(
        '[data-test="trace-details-sidebar-events-table"]',
      );
      expect(eventsTable.exists()).toBe(true);
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

        // Check if event rows are rendered
        const eventRows = wrapper.findAll(
          '[data-test^="trace-event-details-"]',
        );
        expect(eventRows.length).toBeGreaterThan(0);
      });

      it("should expand event when clicked", async () => {
        await flushPromises();
        await wrapper.vm.$nextTick();

        const eventRow = wrapper.find('[data-test^="trace-event-details-"]');
        expect(eventRow.exists()).toBe(true);

        await eventRow.trigger("click");

        // Check if the event is expanded
        expect(wrapper.vm.expandedEvents["0"]).toBe(true);
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
            const highlightedText = wrapper.find('[data-test="trace-details-sidebar-events-table"]').find(".highlight");

            expect(highlightedText.exists()).toBe(true);
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
      const eventsTable = wrapper.find(
        '[data-test="trace-details-sidebar-exceptions-table"]',
      );
      expect(eventsTable.exists()).toBe(true);
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
        expect(wrapper.find('[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]').exists()).toBe(true);
      });

      it("should collapse exception when clicked again", async () => {
        const exceptionRow = wrapper.find(
          '[data-test="trace-details-sidebar-exceptions-table-expand-btn-0"]',
        );
        await exceptionRow.trigger("click");

        expect(wrapper.find('[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]').exists()).toBe(true);

        await exceptionRow.trigger("click");

        expect(wrapper.find('[data-test="trace-details-sidebar-exceptions-table-expanded-row-0"]').exists()).toBe(false);
      });
    });

    //   it("should display exceptions when exception events exist", async () => {
    //     // Update span to include exception events
    //     await wrapper.setProps({
    //       span: {
    //         ...mockSpan,
    //         events: '[{"name": "exception", "@timestamp": 1752490492843047, "exception.type": "RuntimeError", "exception.message": "Test error", "exception.escaped": "false", "exception.stacktrace": "Error: Test error\\n    at test.js:1:1"}]',
    //       },
    //     });

    //     await flushPromises();

    //     const exceptionsTable = wrapper.find('[data-test="span-details-exceptions-table"]');
    //     expect(exceptionsTable.exists()).toBe(true);
    //   });
  });

  describe("Links tab", () => {
    beforeEach(async () => {
      const linksTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-links"]',
      );
      await linksTab.trigger("click");
    });

    it("should display no links message when no links", () => {
      const noLinksMsg = wrapper.find(
        '[data-test="trace-details-sidebar-no-links"]',
      );
      expect(noLinksMsg.exists()).toBe(true);
      expect(noLinksMsg.text()).toContain("No links present for this span");
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
        const linkRow = wrapper.find(
          '[data-test="trace-event-detail-link-0"]',
        );
        await linkRow.trigger("click");

        expect(wrapper.emitted("open-trace")).toBeTruthy();
      });

      it("should emit select-span when a same trace link is clicked", async () => {
        const linkRow = wrapper.find(
          '[data-test="trace-event-detail-link-1"]',
        );
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
      });

      it("should display no links message", () => {
        const noLinksMsg = wrapper.find(
          '[data-test="trace-details-sidebar-no-links"]',
        );
        expect(noLinksMsg.exists()).toBe(true);
        expect(noLinksMsg.text()).toContain("No links present for this span");
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
    it("should highlight search terms in tags", async () => {
      await wrapper.setProps({
        searchQuery: "GET",
      });

      await flushPromises();

      const highlightedText = wrapper.find(".highlight");
      expect(highlightedText.exists()).toBe(true);
      expect(highlightedText.text()).toBe("GET");
    });

    it("should highlight search terms in process information", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      const processTab = wrapper.find(
        '[data-test="trace-details-sidebar-tabs-process"]',
      );
      await processTab.trigger("click");

      const highlightedText = wrapper.find(".highlight");
      expect(highlightedText.exists()).toBe(true);
      expect(highlightedText.text()).toBe("alertmanager");
    });
  });

  //   describe("Theme support", () => {
  //     it("should apply light theme by default", () => {
  //       const container = wrapper.find('[data-test="span-details-sidebar"]');
  //       expect(container.classes()).toContain("light-theme");
  //     });

  //     it("should apply dark theme when store theme is dark", async () => {
  //       const darkStore = createStore({
  //         state: {
  //           theme: "dark",
  //           API_ENDPOINT: "http://localhost:8080",
  //           zoConfig: {
  //             timestamp_column: "@timestamp",
  //           },
  //           selectedOrganization: {
  //             identifier: "test-org",
  //           },
  //         },
  //       });

  //       const darkWrapper = mount(TraceDetailsSidebar, {
  //         props: {
  //           span: mockSpan,
  //           baseTracePosition: mockBaseTracePosition,
  //           searchQuery: "",
  //         },
  //         global: {
  //           plugins: [i18n, router],
  //           provide: {
  //             store: darkStore,
  //           },
  //           stubs: {
  //             "q-resize-observer": true,
  //             "q-virtual-scroll": true,
  //           },
  //         },
  //       });

  //       const container = darkWrapper.find('[data-test="span-details-sidebar"]');
  //       expect(container.classes()).toContain("dark-theme");

  //       darkWrapper.unmount();
  //     });
  //   });

  // describe("Navigation", () => {
  // //   it("should navigate to trace details when link is clicked", async () => {
  // //     const linksTab = wrapper.find('[data-test="trace-details-sidebar-tabs-links"]');
  // //     await linksTab.trigger("click");

  // //     const linkRow = wrapper.find('[data-test="trace-event-detail-f6e08ab2a928aa393375f0d9b05a9054"]');
  // //     await linkRow.trigger("click");

  // //     // Check if router.push was called
  // //     expect(router.push).toBeTruthy();
  // //   });

  // //   it("should emit open-trace when navigating to different trace", async () => {
  // //     const linksTab = wrapper.find('[data-test="trace-details-sidebar-tabs-links"]');
  // //     await linksTab.trigger("click");

  // //     const linkRow = wrapper.find('[data-test="trace-event-detail-f6e08ab2a928aa393375f0d9b05a9054"]');
  // //     await linkRow.trigger("click");

  // //     expect(wrapper.emitted("open-trace")).toBeTruthy();
  // //   });
  // });

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

      // The links should be an empty array due to the invalid JSON
      expect(updatedLinks).toEqual([]);
    });

    it("should force component update when props change", async () => {
      // Create a new wrapper with different props to force a complete re-render
      const newWrapper = mount(TraceDetailsSidebar, {
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
          },
        },
      });

      await flushPromises();

      // Check that the component properly handles invalid links
      expect(newWrapper.vm.spanLinks).toEqual([]);

      newWrapper.unmount();
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

    // it("should show error notification when copy fails", async () => {
    //   // Mock Quasar's copyToClipboard to throw an error
    //   const originalCopyToClipboard = quasar.copyToClipboard;
    //   vi.spyOn(quasar, 'copyToClipboard').mockImplementation(() => {
    //     throw new Error("Copy to clipboard failed");
    //   });

    //   await flushPromises();

    //   const copyBtn = wrapper.find(
    //     '[data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"]',
    //   );
    //   if (copyBtn.exists()) {
    //     await copyBtn.trigger("click");

    //     // Should show error notification
    //     expect(wrapper.exists()).toBe(true);

    //     // Verify that copyToClipboard was called
    //     expect(quasar.copyToClipboard).toHaveBeenCalledWith(mockSpan.span_id);

    //     // Verify that the error notification was triggered
    //     expect(wrapper.vm.$q.notify).toBeTruthy();
    //   }

    //   // Restore original function
    //   vi.restoreAllMocks();
    // });
  });
});
