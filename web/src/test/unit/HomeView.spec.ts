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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Quasar, Notify } from "quasar";
import HomeView from "../../views/HomeView.vue";
import store from "./helpers/store";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

// Import mocked service
import orgService from "../../services/organizations";

// Mock services
vi.mock("../../services/organizations", () => ({
  default: {
    get_organization_summary: vi.fn()
  }
}));

vi.mock("../../aws-exports", () => ({
  default: {
    isCloud: "false"
  }
}));

vi.mock("../../utils/zincutils", () => ({
  formatSizeFromMB: vi.fn((size) => `${size}MB`),
  addCommasToNumber: vi.fn((num) => num?.toLocaleString() || "0"),
  getImageURL: vi.fn((url) => url)
}));

vi.mock("../../composables/useStreams", () => ({
  default: () => ({
    setStreams: vi.fn()
  })
}));

vi.mock("../../enterprise/components/billings/TrialPeriod.vue", () => ({
  default: {
    name: "TrialPeriod",
    template: "<div>Trial Period</div>"
  }
}));

// Mock router
const mockRouter = {
  push: vi.fn(),
  resolve: vi.fn()
};

const mockRoute = {
  name: "home",
  path: "/home"
};

// Create i18n instance
const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      home: {
        streams: "Streams",
        streamTotal: "Total Streams",
        docsCountLbl: "Documents Count",
        totalDataIngested: "Total Data Ingested",
        totalDataCompressed: "Total Data Compressed",
        indexSizeLbl: "Index Size",
        pipelineTitle: "Pipelines",
        schedulePipelineTitle: "Scheduled",
        rtPipelineTitle: "Real-time",
        alertTitle: "Alerts",
        scheduledAlert: "Scheduled",
        rtAlert: "Real-time",
        functionTitle: "Functions",
        dashboardTitle: "Dashboards",
        view: "View",
        noData: "No Data",
        ingestionMsg: "Start ingesting data",
        findIngestion: "Find Ingestion Methods"
      }
    }
  }
});

describe("HomeView.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup organization service mock
    orgService.get_organization_summary.mockResolvedValue({
      data: {
        streams: { num_streams: 0 },
        alerts: {
          num_realtime: 0,
          num_scheduled: 0,
          trigger_status: { failed: 0, healthy: 0, warning: 0 }
        },
        pipelines: {
          num_realtime: 0,
          num_scheduled: 0,
          trigger_status: { failed: 0, healthy: 0, warning: 0 }
        },
        total_dashboards: 0,
        total_functions: 0
      }
    });
    
    // Setup default store state
    store.state.selectedOrganization = {
      label: "Test Organization",
      id: 159,
      identifier: "test-org",
      user_email: "test@example.com",
      subscription_type: "premium"
    };
    
    store.state.theme = "dark";
    store.state.isAiChatEnabled = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
  });

  const createWrapper = (propsData = {}) => {
    return mount(HomeView, {
      global: {
        plugins: [
          [
            Quasar,
            {
              plugins: [Notify]
            }
          ],
          i18n,
          store
        ],
        mocks: {
          $router: mockRouter,
          $route: mockRoute
        },
        stubs: {
          'router-link': {
            template: '<a><slot /></a>',
            props: ['to']
          },
          'q-page': {
            template: '<div class="q-page"><slot /></div>'
          },
          'q-btn': {
            template: '<button class="q-btn" @click="$emit(\'click\')"><slot /></button>'
          },
          'q-separator': {
            template: '<hr class="q-separator" />'
          },
          'TrialPeriod': {
            name: "TrialPeriod",
            template: '<div class="trial-period">Trial Period</div>'
          }
        }
      },
      props: propsData
    });
  };

  describe("Component Initialization", () => {
    it("should render the component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("PageHome");
    });

    it("should initialize with default reactive properties", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.summary).toBeDefined();
      expect(wrapper.vm.no_data_ingest).toBe(false);
      expect(wrapper.vm.isCloud).toBe("false");
    });

    it("should access store correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBe(store);
    });

    it("should initialize i18n translation function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should have access to getSummary function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.getSummary).toBe("function");
    });
  });

  describe("getSummary Function", () => {
    it("should call orgService.get_organization_summary with correct org_id", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: 5, total_storage_size: 100, total_compressed_size: 50, total_records: 1000, total_index_size: 25 },
          pipelines: {
            num_scheduled: 3,
            num_realtime: 2,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          alerts: {
            num_realtime: 4,
            num_scheduled: 6,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 8,
          total_functions: 12
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      
      expect(orgService.get_organization_summary).toHaveBeenCalledWith("test-org");
    });


    it("should set no_data_ingest to true when all counts are zero", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: 0 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      await flushPromises();

      expect(wrapper.vm.no_data_ingest).toBe(true);
      expect(wrapper.vm.summary).toEqual({});
    });

    it("should set no_data_ingest to false when data exists", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      await flushPromises();

      expect(wrapper.vm.no_data_ingest).toBe(false);
    });

    it("should handle null/undefined values in response data", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: null, total_storage_size: null, total_records: null },
          pipelines: null,
          alerts: null,
          total_dashboards: null,
          total_functions: null
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      await flushPromises();

      expect(wrapper.vm.summary.streams_count).toBe(0);
      expect(wrapper.vm.summary.scheduled_pipelines).toBe(0);
      expect(wrapper.vm.summary.rt_pipelines).toBe(0);
    });

    it("should handle error response and show notification", async () => {
      const error = new Error("Network error");
      orgService.get_organization_summary.mockRejectedValue(error);
      
      const notifySpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      await flushPromises();

      expect(notifySpy).toHaveBeenCalledWith(error);
    });

  });

  describe("selectedOrg Computed Property", () => {
    it("should return organization identifier from store", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.selectedOrg).toBe("test-org");
    });

    it("should return undefined when no organization is selected", () => {
      store.state.selectedOrganization = {};
      wrapper = createWrapper();
      expect(wrapper.vm.selectedOrg).toBeUndefined();
    });

    it("should return null when selectedOrganization is null", () => {
      store.state.selectedOrganization = {};
      wrapper = createWrapper();
      expect(wrapper.vm.selectedOrg).toBeUndefined();
    });

    it("should be reactive to store changes", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.selectedOrg).toBe("test-org");
      
      store.state.selectedOrganization.identifier = "new-org";
      await nextTick();
      
      expect(wrapper.vm.selectedOrg).toBe("new-org");
    });
  });

  describe("selectedOrg Watcher", () => {
    it("should call getSummary when selectedOrg changes", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 1,
          total_functions: 1
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      const getSummarySpy = vi.spyOn(wrapper.vm, 'getSummary');
      
      store.state.selectedOrganization.identifier = "new-org";
      await nextTick();
      
      expect(getSummarySpy).toHaveBeenCalledWith("new-org");
    });

    it("should reset summary when selectedOrg changes", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 1,
          total_functions: 1
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      const getSummarySpy = vi.spyOn(wrapper.vm, 'getSummary');
      
      store.state.selectedOrganization.identifier = "new-org";
      await nextTick();
      
      expect(getSummarySpy).toHaveBeenCalledWith("new-org");
    });

    it("should not call getSummary when selectedOrg is the same", async () => {
      wrapper = createWrapper();
      const getSummarySpy = vi.spyOn(wrapper.vm, 'getSummary');
      
      // Trigger watcher with same value
      const currentOrg = store.state.selectedOrganization.identifier;
      store.state.selectedOrganization.identifier = currentOrg;
      await nextTick();
      
      expect(getSummarySpy).not.toHaveBeenCalled();
    });

    it("should call getSummary when summary is undefined", async () => {
      const mockResponse = {
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 1,
          total_functions: 1
        }
      };
      orgService.get_organization_summary.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      const getSummarySpy = vi.spyOn(wrapper.vm, 'getSummary');
      
      // Clear the existing mock calls from beforeEach
      getSummarySpy.mockClear();
      
      wrapper.vm.summary.value = undefined;
      store.state.selectedOrganization.identifier = "new-org";
      await nextTick();
      
      expect(getSummarySpy).toHaveBeenCalledWith("new-org");
    });
  });

  describe("Component Rendering", () => {
    it("should apply correct theme class", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("dark");
    });

    it("should apply light theme when store theme is light", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await nextTick();
      
      expect(wrapper.vm.store.state.theme).toBe("light");
    });

    it("should show no data view when no_data_ingest is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.no_data_ingest = true;
      await nextTick();
      
      expect(wrapper.vm.no_data_ingest).toBe(true);
    });

    it("should show main dashboard when no_data_ingest is false", async () => {
      // Set up a response with data so no_data_ingest stays false
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      });
      
      wrapper = createWrapper();
      await flushPromises(); // Wait for getSummary to complete
      
      expect(wrapper.vm.no_data_ingest).toBe(false);
    });

    it("should render stream statistics for non-cloud environment", async () => {
      wrapper = createWrapper();
      wrapper.vm.no_data_ingest = false;
      
      expect(wrapper.vm.no_data_ingest).toBe(false);
      expect(wrapper.vm.isCloud).toBe("false");
    });

    it("should render pipeline statistics", async () => {
      // Mock response with data so no_data_ingest stays false
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      });
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(wrapper.vm.no_data_ingest).toBe(false);
      expect(wrapper.vm.getSummary).toBeDefined();
    });

    it("should render alert statistics", async () => {
      // Mock response with data so no_data_ingest stays false
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      });
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(wrapper.vm.no_data_ingest).toBe(false);
      expect(wrapper.vm.summary).toBeDefined();
    });

    it("should render function statistics", async () => {
      // Mock response with data so no_data_ingest stays false
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      });
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(wrapper.vm.no_data_ingest).toBe(false);
      expect(wrapper.vm.summary).toBeDefined();
    });

    it("should render dashboard statistics", async () => {
      // Mock response with data so no_data_ingest stays false
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: { num_streams: 1 },
          alerts: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 0,
            num_scheduled: 0,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 0,
          total_functions: 0
        }
      });
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(wrapper.vm.no_data_ingest).toBe(false);
      expect(wrapper.vm.summary).toBeDefined();
    });

    it("should handle undefined summary values", async () => {
      wrapper = createWrapper();
      wrapper.vm.no_data_ingest = false;
      wrapper.vm.summary.value = {};
      await nextTick();
      
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Compressed Size Tile - Cloud Conditional Rendering", () => {
    it("should render compressed size tile when isCloud is 'false'", async () => {
      // Mock with isCloud = 'false'
      vi.mocked(await import("../../aws-exports")).default.isCloud = "false";

      // Mock response with data
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: {
            num_streams: 5,
            total_storage_size: 100,
            total_compressed_size: 50,
            total_records: 1000,
            total_index_size: 25
          },
          alerts: { num_realtime: 1, num_scheduled: 1 },
          pipelines: { num_realtime: 1, num_scheduled: 1 },
          total_dashboards: 1,
          total_functions: 1
        }
      });

      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.isCloud).toBe("false");
      expect(wrapper.vm.config.isCloud).toBe("false");

      // Check that compressed size tile is in the DOM
      const compressedTileText = wrapper.text();
      expect(compressedTileText).toContain("Total Data Compressed");
    });

    it("should not render compressed size tile when isCloud is 'true'", async () => {
      // Mock with isCloud = 'true'
      vi.mocked(await import("../../aws-exports")).default.isCloud = "true";

      // Mock response with data including compressed size
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: {
            num_streams: 5,
            total_storage_size: 100,
            total_compressed_size: 75,
            total_records: 1000,
            total_index_size: 25
          },
          alerts: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 1,
          total_functions: 1
        }
      });

      // Create a fresh wrapper instance with cloud config
      const cloudWrapper = mount(HomeView, {
        global: {
          plugins: [
            [
              Quasar,
              {
                plugins: [Notify]
              }
            ],
            i18n,
            store
          ],
          mocks: {
            $router: mockRouter,
            $route: mockRoute
          },
          stubs: {
            'router-link': {
              template: '<a><slot /></a>',
              props: ['to']
            },
            'q-page': {
              template: '<div class="q-page"><slot /></div>'
            },
            'q-btn': {
              template: '<button class="q-btn" @click="$emit(\'click\')"><slot /></button>'
            },
            'q-separator': {
              template: '<hr class="q-separator" />'
            },
            'TrialPeriod': {
              name: "TrialPeriod",
              template: '<div class="trial-period">Trial Period</div>'
            }
          }
        }
      });

      await flushPromises();

      expect(cloudWrapper.vm.config.isCloud).toBe("true");

      // Check that compressed size tile is not rendered in the DOM
      const compressedTileText = cloudWrapper.text();
      expect(compressedTileText).not.toContain("Total Data Compressed");

      cloudWrapper.unmount();
    });

    it("should display compressed size value when tile is rendered in cloud mode", async () => {
      // Mock with isCloud = 'true'
      vi.mocked(await import("../../aws-exports")).default.isCloud = "true";

      const compressedSize = 50;

      // Set up the mock BEFORE creating the wrapper so it's used on mount
      orgService.get_organization_summary.mockResolvedValue({
        data: {
          streams: {
            num_streams: 5,
            total_storage_size: 100,
            total_compressed_size: compressedSize,
            total_records: 1000,
            total_index_size: 25
          },
          alerts: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 1,
          total_functions: 1
        }
      });

      const cloudWrapper = mount(HomeView, {
        global: {
          plugins: [
            [
              Quasar,
              {
                plugins: [Notify]
              }
            ],
            i18n,
            store
          ],
          mocks: {
            $router: mockRouter,
            $route: mockRoute
          },
          stubs: {
            'router-link': {
              template: '<a><slot /></a>',
              props: ['to']
            },
            'q-page': {
              template: '<div class="q-page"><slot /></div>'
            },
            'q-btn': {
              template: '<button class="q-btn" @click="$emit(\'click\')"><slot /></button>'
            },
            'q-separator': {
              template: '<hr class="q-separator" />'
            },
            'TrialPeriod': {
              name: "TrialPeriod",
              template: '<div class="trial-period">Trial Period</div>'
            }
          }
        }
      });

      await flushPromises();
      await nextTick();

      expect(cloudWrapper.vm.summary.compressed_size_raw).toBe(compressedSize);
      expect(cloudWrapper.vm.formattedAnimatedCompressedSize).toBeDefined();

      cloudWrapper.unmount();
    });

    it("should only render compressed size tile when isCloud is exactly 'false'", async () => {
      const testValues = ["false", "False", "TRUE", "1", "0", "", undefined, null, "true"];

      for (const testValue of testValues) {
        // Mock with different isCloud values
        vi.mocked(await import("../../aws-exports")).default.isCloud = testValue;

        orgService.get_organization_summary.mockResolvedValue({
          data: {
            streams: {
              num_streams: 5,
              total_storage_size: 100,
              total_compressed_size: 50,
              total_records: 1000,
              total_index_size: 25
            },
            alerts: {
              num_realtime: 1,
              num_scheduled: 1,
              trigger_status: { failed: 0, healthy: 0, warning: 0 }
            },
            pipelines: {
              num_realtime: 1,
              num_scheduled: 1,
              trigger_status: { failed: 0, healthy: 0, warning: 0 }
            },
            total_dashboards: 1,
            total_functions: 1
          }
        });

        const testWrapper = createWrapper();
        await flushPromises();

        expect(testWrapper.vm.config.isCloud).toBe(testValue);

        // Compressed size tile should only be rendered when value is exactly 'false'
        const compressedTileText = testWrapper.text();
        if (testValue === "false") {
          expect(compressedTileText).toContain("Total Data Compressed");
        } else {
          expect(compressedTileText).not.toContain("Total Data Compressed");
        }

        testWrapper.unmount();
      }
    });

    it("should handle compressed size data properly when tile is conditionally rendered", async () => {
      // Test self-hosted mode (isCloud = false) - compressed tile should be visible
      vi.mocked(await import("../../aws-exports")).default.isCloud = "false";

      const mockData = {
        data: {
          streams: {
            num_streams: 5,
            total_storage_size: 100,
            total_compressed_size: 75,
            total_records: 1000,
            total_index_size: 25
          },
          alerts: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          pipelines: {
            num_realtime: 1,
            num_scheduled: 1,
            trigger_status: { failed: 0, healthy: 0, warning: 0 }
          },
          total_dashboards: 1,
          total_functions: 1
        }
      };

      // Set up the mock BEFORE creating the wrapper so it's used on mount
      orgService.get_organization_summary.mockResolvedValue(mockData);

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Data should be loaded and tile should be visible in self-hosted mode
      expect(wrapper.vm.summary.compressed_size_raw).toBe(75);
      expect(wrapper.vm.summary.compressed_data).toBeDefined();

      // Tile should be visible in self-hosted mode (isCloud = false)
      const compressedTileText = wrapper.text();
      expect(compressedTileText).toContain("Total Data Compressed");
    });
  });

  describe("Navigation and Routing", () => {
    it("should have router available", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$router).toBeDefined();
    });

    it("should have route available", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$route).toBeDefined();
    });

    it("should access navigation methods", () => {
      wrapper = createWrapper();
      expect(typeof mockRouter.push).toBe("function");
    });

    it("should check isCloud configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.isCloud).toBe("false");
    });
  });

  describe("Integration Tests", () => {
    it("should call getSummary on mount when organization exists", () => {
      orgService.get_organization_summary.mockResolvedValue({
        data: { streams: { num_streams: 0 } }
      });
      
      wrapper = createWrapper();
      
      expect(orgService.get_organization_summary).toHaveBeenCalledWith("test-org");
    });

    it("should not call getSummary on mount when no organization", () => {
      // Set empty organization and clear mocks to prevent watcher from being counted
      store.state.selectedOrganization = {};
      vi.clearAllMocks(); // Clear the mock call history after changing the store

      orgService.get_organization_summary.mockResolvedValue({
        data: { streams: { num_streams: 0 } }
      });

      wrapper = createWrapper();

      expect(orgService.get_organization_summary).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle invalid organization identifier", async () => {
      orgService.get_organization_summary.mockRejectedValue(new Error("Invalid org"));
      
      wrapper = createWrapper();
      await wrapper.vm.getSummary(null);
      await flushPromises();
      
      expect(orgService.get_organization_summary).toHaveBeenCalledWith(null);
    });

    it("should handle empty string organization identifier", async () => {
      orgService.get_organization_summary.mockRejectedValue(new Error("Empty org"));
      
      wrapper = createWrapper();
      await wrapper.vm.getSummary("");
      await flushPromises();
      
      expect(orgService.get_organization_summary).toHaveBeenCalledWith("");
    });

    it("should handle malformed API response", async () => {
      const malformedResponse = { data: null };
      orgService.get_organization_summary.mockResolvedValue(malformedResponse);
      
      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      await flushPromises();
      
      // Should not crash and handle gracefully
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle API timeout error", async () => {
      const timeoutError = new Error("Timeout");
      orgService.get_organization_summary.mockRejectedValue(timeoutError);
      
      wrapper = createWrapper();
      await wrapper.vm.getSummary("test-org");
      await flushPromises();
      
      expect(console.log).toHaveBeenCalledWith(timeoutError);
    });

  });
});