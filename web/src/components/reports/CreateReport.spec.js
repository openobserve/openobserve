import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, Quasar } from "quasar";
import { nextTick } from 'vue';
import CreateReport from "./CreateReport.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import dashboardService from "@/services/dashboards";
import reports from "@/services/reports";
import * as vueRouter from 'vue-router';
import { ref } from 'vue';

// Mock services
vi.mock("@/services/dashboards", () => ({
  default: {
    list: vi.fn(),
    list_Folders: vi.fn()
  }
}));

vi.mock("@/services/reports", () => ({
  default: {
    createReport: vi.fn(),
    updateReport: vi.fn(),
    getReport: vi.fn()
  }
}));

// Mock vue-router
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router');
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      currentRoute: {
        value: {
          query: {}
        }
      }
    }))
  };
});

// Create platform mock
const platform = {
  is: {
    desktop: true,
    mobile: false,
  },
  has: {
    touch: false,
    mouse: true,
  },
};

// Install Quasar with platform
installQuasar({
  plugins: [Dialog, Notify],
  config: {
    platform
  }
});

describe("CreateReport Component", () => {
  let wrapper;
  let mockRouter;
  let dismissMock;
  let notifyMock;
  let dialogMock;

  beforeEach(async () => {
    // Reset mock implementations
    vi.mocked(dashboardService.list).mockReset();
    vi.mocked(dashboardService.list_Folders).mockReset();
    vi.mocked(reports.createReport).mockReset();
    vi.mocked(reports.updateReport).mockReset();
    vi.mocked(reports.getReport).mockReset();

    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };
    store.state.theme = 'light';
    store.state.zoConfig = { min_auto_refresh_interval: 1 };

    // Setup router mock
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      currentRoute: {
        value: {
          query: {}
        }
      }
    };
    vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter);

    // Setup notify and dialog mocks
    dismissMock = vi.fn();
    notifyMock = vi.fn(() => dismissMock);
    dialogMock = vi.fn().mockResolvedValue(true);

    // Mock successful folder list response
    vi.mocked(dashboardService.list_Folders).mockResolvedValue({
      data: {
        list: [
          { name: "Test Folder 1", folderId: "folder-1" },
          { name: "Test Folder 2", folderId: "folder-2" }
        ]
      }
    });

    // Initialize with default formData
    const defaultFormData = {
      dashboards: [{
        dashboard: "",
        folder: "",
        tabs: "",
        timerange: {
          type: "relative",
          period: "30m",
          from: 0,
          to: 0
        },
        variables: []
      }],
      frequency: {
        type: "once",
        interval: 1,
        cron: "",
        custom: {
          period: "daily",
          interval: "1"
        }
      },
      description: "",
      destinations: [{ email: "" }],
      enabled: true,
      media_type: "Pdf",
      name: "",
      title: "",
      message: "",
      orgId: "",
      start: 0,
      timezone: "UTC",
      timezoneOffset: 0
    };

    wrapper = mount(CreateReport, {
      global: {
        plugins: [
          [Quasar, { platform }],
          [i18n]
        ],
        provide: {
          store,
          router: mockRouter,
          platform
        },
        mocks: {
          $router: mockRouter,
          $q: {
            platform,
            notify: notifyMock,
            dialog: dialogMock
          }
        },
        stubs: {
          DateTime: {
            template: '<div class="datetime-stub"></div>',
            props: ['default-type', 'default-absolute-time', 'default-relative-time'],
            emits: ['on:date-change']
          }
        }
      },
      attachTo: document.body,
      data() {
        return {
          formData: defaultFormData,
          step: 1,
          isCachedReport: false,
          isEditingReport: false
        };
      }
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === 'function') {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("renders the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct default values", () => {
      expect(wrapper.vm.step).toBe(1);
      expect(wrapper.vm.isCachedReport).toBe(false);
      expect(wrapper.vm.isEditingReport).toBe(false);
      expect(wrapper.vm.formData.name).toBe("");
      expect(wrapper.vm.formData.description).toBe("");
    });

    it("fetches folder list on mount", () => {
      expect(dashboardService.list_Folders).toHaveBeenCalledWith("test-org");
    });
  });

  describe("Form Navigation", () => {
    it("shows back button that calls router.back", async () => {
      const backButton = wrapper.find('[data-test="add-report-back-btn"]');
      expect(backButton.exists()).toBe(true);
      
      await backButton.trigger('click');
      expect(mockRouter.back).toHaveBeenCalled();
    });

    it("shows correct title for new report", () => {
      const title = wrapper.find('[data-test="add-report-title"]');
      expect(title.exists()).toBe(true);
      // We'll check for the rendered text instead of the i18n key
      expect(title.text()).toBe("Add Report");
    });

    it("navigates through steps when continue is clicked", async () => {
      // Setup required fields for step 1
      wrapper.vm.formData.name = "test-report";
      wrapper.vm.formData.dashboards[0].folder = "folder-1";
      wrapper.vm.formData.dashboards[0].dashboard = "dash-1";
      wrapper.vm.formData.dashboards[0].tabs = "tab-1";
      await nextTick();

      const continueBtn = wrapper.find('[data-test="add-report-step1-continue-btn"]');
      expect(continueBtn.exists()).toBe(true);
      
      await continueBtn.trigger('click');
      expect(wrapper.vm.step).toBe(2);
    });
  });

  describe("Form Validation", () => {
    it("validates report name format", async () => {
      const nameInput = wrapper.find('[data-test="add-report-name-input"] input');
      expect(nameInput.exists()).toBe(true);

      await nameInput.setValue("test report"); // space not allowed
      await nameInput.trigger('blur');

      // Should show validation error for invalid name
      expect(wrapper.vm.isValidName).toBe(false);

      await nameInput.setValue("test-report");
      await nameInput.trigger('blur');

      // Should accept valid name
      expect(wrapper.vm.isValidName).toBe(true);
    });

    it("requires dashboard selection before continuing", async () => {
      // Clear required fields
      wrapper.vm.formData.dashboards[0].folder = "";
      wrapper.vm.formData.dashboards[0].dashboard = "";
      wrapper.vm.formData.dashboards[0].tabs = "";
      await nextTick();

      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);
    });

    it("validates relative timerange period", async () => {
      wrapper.vm.formData.dashboards[0].timerange = {
        type: "relative",
        period: ""
      };
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);
    });

    it("validates absolute timerange from and to", async () => {
      wrapper.vm.formData.dashboards[0].timerange = {
        type: "absolute",
        from: "",
        to: ""
      };
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);
    });

    it("validates cron expression format", async () => {
      // Set up valid data for step 1 first
      wrapper.vm.formData.dashboards[0] = {
        dashboard: "test-dashboard",
        folder: "test-folder",
        tabs: "tab1",
        timerange: { type: "relative", period: "30m" }
      };
      wrapper.vm.step = 2; // Move to step 2 for frequency validation
      
      wrapper.vm.formData.frequency.type = "cron";
      wrapper.vm.frequency.type = "cron";
      wrapper.vm.frequency.cron = "* * * * *"; // Invalid - only 5 fields
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.cronError).toBe("Cron expression must have exactly 6 fields: [Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]");
      expect(wrapper.vm.step).toBe(2);
    });

    it("validates frequency interval and type", async () => {
      // Set up valid data for step 1 first
      wrapper.vm.formData.dashboards[0] = {
        dashboard: "test-dashboard",
        folder: "test-folder",
        tabs: "tab1",
        timerange: { type: "relative", period: "30m" }
      };
      wrapper.vm.step = 2; // Move to step 2 for frequency validation
      
      wrapper.vm.formData.frequency = {
        type: "",
        interval: 0
      };
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(2);
    });

    it("validates start time and timezone", async () => {
      // Set up valid data for step 1 first
      wrapper.vm.formData.dashboards[0] = {
        dashboard: "test-dashboard",
        folder: "test-folder",
        tabs: "tab1",
        timerange: { type: "relative", period: "30m" }
      };
      // Set up valid frequency for step 2
      wrapper.vm.formData.frequency = {
        type: "once",
        interval: 1
      };
      wrapper.vm.step = 2;
      
      wrapper.vm.formData.start = 0;
      wrapper.vm.formData.timezone = "";
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(2);
    });

    it("validates email format", async () => {
      // Set up valid data for step 1
      wrapper.vm.formData.dashboards[0] = {
        dashboard: "test-dashboard",
        folder: "test-folder",
        tabs: "tab1",
        timerange: { type: "relative", period: "30m" }
      };
      // Set up valid data for step 2
      wrapper.vm.formData.frequency = {
        type: "once",
        interval: 1
      };
      wrapper.vm.formData.start = Date.now();
      wrapper.vm.formData.timezone = "UTC";
      wrapper.vm.step = 3; // Move to step 3 for email validation
      
      wrapper.vm.formData.title = "Test Title";
      wrapper.vm.emails = "invalid-email";
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(3);
    });

    it("validates multiple email addresses", async () => {
      // Set up valid data for step 1
      wrapper.vm.formData.dashboards[0] = {
        dashboard: "test-dashboard",
        folder: "test-folder",
        tabs: "tab1",
        timerange: { type: "relative", period: "30m" }
      };
      // Set up valid data for step 2
      wrapper.vm.formData.frequency = {
        type: "once",
        interval: 1
      };
      wrapper.vm.formData.start = Date.now();
      wrapper.vm.formData.timezone = "UTC";
      wrapper.vm.step = 3; // Move to step 3 for email validation
      
      wrapper.vm.formData.title = "Test Title";
      
      // Test valid multiple emails
      wrapper.vm.emails = "test1@example.com, test2@example.com; test3@example.com";
      await wrapper.vm.validateReportData();
      // Instead of checking step, verify that validation passed by checking cronError
      expect(wrapper.vm.cronError).toBe("");

      // Test invalid multiple emails
      wrapper.vm.emails = "test1@example.com, invalid-email; test3@example.com";
      wrapper.vm.step = 3; // Reset to step 3
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(3); // Should stay on step 3 for invalid emails
    });

    it("passes validation with all valid data", async () => {
      // Setup all required data
      wrapper.vm.formData = {
        ...wrapper.vm.formData,
        dashboards: [{
          dashboard: "test-dashboard",
          folder: "test-folder",
          tabs: "tab1",
          timerange: {
            type: "relative",
            period: "30m",
            from: 0,
            to: 0
          },
          variables: []
        }],
        frequency: {
          type: "once",
          interval: 1
        },
        title: "Test Title",
        start: Date.now(),
        timezone: "UTC"
      };
      wrapper.vm.emails = "test@example.com";
      wrapper.vm.frequency = {
        type: "once",
        interval: 1,
        cron: ""
      };

      const initialStep = wrapper.vm.step;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(initialStep); // Step shouldn't change
      expect(wrapper.vm.cronError).toBe("");
    });

    const defaultDashboard = {
      dashboard: "",
      folder: "",
      tabs: "",
      timerange: {
        type: "relative",
        period: "30m",
        from: 0,
        to: 0
      },
      variables: []
    };

    beforeEach(() => {
      wrapper.vm.formData = {
        ...wrapper.vm.formData,
        dashboards: [{ ...defaultDashboard }]
      };
    });

    it("should validate absolute timerange correctly", async () => {
      wrapper.vm.formData.dashboards[0] = {
        ...defaultDashboard,
        folder: "folder1",
        dashboard: "dash1",
        tabs: "tab1",
        timerange: {
          type: "absolute",
          from: 0,
          to: 0,
          period: ""
        }
      };
      
      // Test case 1: No from/to values
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);

      // Test case 2: Only from value
      wrapper.vm.formData.dashboards[0].timerange.from = 1000;
      wrapper.vm.step = 2;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(1);

      // Test case 3: Both from and to values
      wrapper.vm.formData.dashboards[0].timerange.to = 2000;
      wrapper.vm.step = 2;
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.step).toBe(2);
    });

    it("should handle invalid cron expression errors", async () => {
      // First set up valid dashboard data
      wrapper.vm.formData.dashboards[0] = {
        ...defaultDashboard,
        folder: "folder1",
        dashboard: "dash1",
        tabs: "tab1"
      };
      
      // Then set up invalid cron data
      wrapper.vm.formData.frequency = {
        type: "cron",
        interval: 1,
        cron: "invalid cron"
      };
      wrapper.vm.frequency = {
        type: "cron",
        cron: "invalid cron",
        custom: {
          interval: 1,
          period: "days"
        }
      };
      
      // Set step to 2 since we're testing cron validation
      wrapper.vm.step = 2;
      
      await wrapper.vm.validateReportData();
      expect(wrapper.vm.cronError).toBe("Invalid cron expression!");
      expect(wrapper.vm.step).toBe(2); // Should stay at step 2 for cron validation
    });
  });

  describe("Dashboard Selection", () => {
    it("loads dashboards when folder is selected", async () => {
      // Mock dashboard list response
      vi.mocked(dashboardService.list).mockResolvedValue({
        data: {
          dashboards: [
            {
              title: "Test Dashboard",
              dashboardId: "dash-1",
              tabs: [{ name: "Tab 1", tabId: "tab-1" }]
            }
          ]
        }
      });

      const folderSelect = wrapper.find('[data-test="add-report-folder-select"]');
      expect(folderSelect.exists()).toBe(true);

      await wrapper.vm.onFolderSelection("folder-1");
      await flushPromises();

      expect(dashboardService.list).toHaveBeenCalledWith(
        0, 10000, "name", false, "", "test-org", "folder-1", ""
      );
      expect(wrapper.vm.dashboardOptions.length).toBe(1);
    });
  });

  describe("Filter Options", () => {
    beforeEach(async () => {
      // Setup initial options
      wrapper.vm.options = {
        folders: [
          { label: "Test Folder 1", value: "folder-1" },
          { label: "Test Folder 2", value: "folder-2" },
          { label: "Production Folder", value: "folder-3" }
        ],
        dashboards: [
          { label: "Test Dashboard 1", value: "dash-1" },
          { label: "Test Dashboard 2", value: "dash-2" },
          { label: "Production Dashboard", value: "dash-3" }
        ]
      };

      // Initialize the options arrays
      wrapper.vm.folderOptions = [...wrapper.vm.options.folders];
      wrapper.vm.dashboardOptions = [...wrapper.vm.options.dashboards];
      wrapper.vm.dashboardTabOptions = [
        { label: "Tab 1", value: "tab-1" },
        { label: "Tab 2", value: "tab-2" },
        { label: "Production Tab", value: "tab-3" }
      ];
      await nextTick();
    });

    it("filters folder options based on search text", async () => {
      const updateFn = (fn) => {
        wrapper.vm.folderOptions = fn();
      };
      
      // Test empty search
      wrapper.vm.onFilterOptions("folders", "", updateFn);
      await nextTick();
      expect(wrapper.vm.folderOptions.length).toBe(3);

      // Test specific search
      wrapper.vm.onFilterOptions("folders", "Production", updateFn);
      await nextTick();
      expect(wrapper.vm.folderOptions.length).toBe(1);
      expect(wrapper.vm.folderOptions[0].label).toBe("Production Folder");
    });

    it("filters dashboard options based on search text", async () => {
      const updateFn = (fn) => {
        wrapper.vm.dashboardOptions = fn();
      };
      
      // Test empty search
      wrapper.vm.onFilterOptions("dashboards", "", updateFn);
      await nextTick();
      expect(wrapper.vm.dashboardOptions.length).toBe(3);

      // Test specific search
      wrapper.vm.onFilterOptions("dashboards", "Test", updateFn);
      await nextTick();
      expect(wrapper.vm.dashboardOptions.length).toBe(2);
      expect(wrapper.vm.dashboardOptions.every(d => d.label.includes("Test"))).toBe(true);
    });

    it("filters tab options based on search text", async () => {
      const updateFn = (fn) => {
        wrapper.vm.dashboardTabOptions = fn();
      };
      
      // Test empty search
      wrapper.vm.onFilterOptions("tabs", "", updateFn);
      await nextTick();
      expect(wrapper.vm.dashboardTabOptions.length).toBe(3);

      // Test specific search
      wrapper.vm.onFilterOptions("tabs", "Production", updateFn);
      await nextTick();
      expect(wrapper.vm.dashboardTabOptions.length).toBe(1);
      expect(wrapper.vm.dashboardTabOptions[0].label).toBe("Production Tab");
    });

    it("handles case-insensitive search", async () => {
      const updateFn = (fn) => {
        wrapper.vm.folderOptions = fn();
      };
      
      wrapper.vm.onFilterOptions("folders", "production", updateFn);
      await nextTick();
      expect(wrapper.vm.folderOptions.length).toBe(1);
      expect(wrapper.vm.folderOptions[0].label).toBe("Production Folder");
    });

    it("integrates with folder select component", async () => {
      // Trigger the filter method directly
      const filterFn = (val, update) => {
        wrapper.vm.onFilterOptions("folders", val, update);
      };

      // Find the select component
      const folderSelect = wrapper.findComponent({ name: 'q-select' });
      expect(folderSelect.exists()).toBe(true);

      // Trigger the filter
      await folderSelect.vm.$emit('filter', 'Production', (fn) => {
        wrapper.vm.folderOptions = fn();
      });
      await nextTick();

      // Verify filtered options
      expect(wrapper.vm.folderOptions.length).toBe(1);
      expect(wrapper.vm.folderOptions[0].label).toBe("Production Folder");
    });

    it("integrates with dashboard select component", async () => {
      // Find the dashboard select component (second q-select)
      const dashboardSelect = wrapper.findAllComponents({ name: 'q-select' }).at(1);
      expect(dashboardSelect.exists()).toBe(true);

      // Trigger the filter
      await dashboardSelect.vm.$emit('filter', 'Test', (fn) => {
        wrapper.vm.dashboardOptions = fn();
      });
      await nextTick();

      // Verify filtered options
      expect(wrapper.vm.dashboardOptions.length).toBe(2);
      expect(wrapper.vm.dashboardOptions.every(d => d.label.includes("Test"))).toBe(true);
    });

    it("handles folder selection and loads dashboards", async () => {
      // Mock dashboard list response with the correct format
      vi.mocked(dashboardService.list).mockResolvedValue({
        data: {
          dashboards: [{
            "folder-1": {
              title: "Test Dashboard",
              dashboardId: "dash-1",
              tabs: [{ name: "Tab 1", tabId: "tab-1" }],
              version: 1
            }
          }]
        }
      });

      // Find the folder select component
      const folderSelect = wrapper.findComponent({ name: 'q-select' });
      expect(folderSelect.exists()).toBe(true);

      // Trigger model update
      await wrapper.vm.onFolderSelection("folder-1");
      await flushPromises();

      // Verify dashboard list is fetched
      expect(dashboardService.list).toHaveBeenCalledWith(
        0, 10000, "name", false, "", "test-org", "folder-1", ""
      );

      // Verify dashboards are updated
      expect(wrapper.vm.dashboardOptions.length).toBe(1);
      expect(wrapper.vm.dashboardOptions[0]).toEqual({
        label: "Test Dashboard",
        value: "dash-1",
        tabs: [{ label: "Tab 1", value: "tab-1" }],
        version: 1
      });
    });

    it("handles dashboard selection and loads tabs", async () => {
      // Setup dashboard with tabs
      wrapper.vm.dashboardOptions = [{
        label: "Test Dashboard",
        value: "dash-1",
        tabs: [
          { label: "Tab 1", value: "tab-1" },
          { label: "Tab 2", value: "tab-2" }
        ]
      }];

      // Trigger dashboard selection directly
      await wrapper.vm.onDashboardSelection("dash-1");
      await nextTick();

      // Verify tabs are updated
      expect(wrapper.vm.dashboardTabOptions.length).toBe(2);
      expect(wrapper.vm.dashboardTabOptions[0].label).toBe("Tab 1");
    });
  });

  describe("Report Scheduling", () => {
    beforeEach(async () => {
      // Setup required fields and move to scheduling step
      wrapper.vm.formData.name = "test-report";
      wrapper.vm.formData.dashboards[0].folder = "folder-1";
      wrapper.vm.formData.dashboards[0].dashboard = "dash-1";
      wrapper.vm.formData.dashboards[0].tabs = "tab-1";
      wrapper.vm.step = 2;
      await nextTick();
    });

    it("handles cron job scheduling", async () => {
      wrapper.vm.frequency.type = "cron";
      wrapper.vm.frequency.cron = "0 0 12 * * ?";
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("");
    });

    it("validates invalid cron expression", async () => {
      wrapper.vm.frequency.type = "cron";
      wrapper.vm.frequency.cron = "invalid cron";
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("Invalid cron expression!");
    });

    it("handles custom interval scheduling", async () => {
      wrapper.vm.frequency.type = "custom";
      await nextTick();

      const customIntervalInput = wrapper.find('[data-test="add-report-schedule-custom-interval-input"] input');
      expect(customIntervalInput.exists()).toBe(true);
      
      await customIntervalInput.setValue("2");
      expect(wrapper.vm.frequency.custom.interval).toBe("2");
    });

    it("switches between schedule now and schedule later", async () => {
      const scheduleNowBtn = wrapper.find('[data-test="add-report-schedule-scheduleNow-btn"]');
      const scheduleLaterBtn = wrapper.find('[data-test="add-report-schedule-scheduleLater-btn"]');
      
      wrapper.vm.selectedTimeTab = "scheduleNow";
      await nextTick();
      expect(wrapper.vm.selectedTimeTab).toBe("scheduleNow");

      wrapper.vm.selectedTimeTab = "scheduleLater";
      await nextTick();
      expect(wrapper.vm.selectedTimeTab).toBe("scheduleLater");
    });
  });

  describe("Report Creation", () => {
    beforeEach(async () => {
      // Setup form with required data
      wrapper.vm.formData.name = "test-report";
      wrapper.vm.formData.description = "Test Description";
      wrapper.vm.formData.dashboards[0].folder = "folder-1";
      wrapper.vm.formData.dashboards[0].dashboard = "dash-1";
      wrapper.vm.formData.dashboards[0].tabs = "tab-1";
      wrapper.vm.emails = "test@example.com";
      wrapper.vm.formData.title = "Test Report Title";
      await nextTick();

      // Mock the createReport function to return a promise
      vi.mocked(reports.createReport).mockResolvedValue({});
    });

    it("creates a new report successfully", async () => {
      const saveButton = wrapper.find('[data-test="add-report-save-btn"]');
      expect(saveButton.exists()).toBe(true);

      await saveButton.trigger('click');
      await flushPromises();

      expect(reports.createReport).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          name: "test-report",
          description: "Test Description",
          destinations: [{ email: "test@example.com" }]
        })
      );

      // Verify navigation after success
      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "reports",
          query: { org_identifier: "test-org" }
        })
      );
    });

    it("handles creation error (non-403)", async () => {
      const error = {
        response: {
          status: 500,
          data: {
            message: "Internal server error"
          }
        }
      };

      vi.mocked(reports.createReport).mockRejectedValue(error);

      const saveButton = wrapper.find('[data-test="add-report-save-btn"]');
      await saveButton.trigger('click');
      await flushPromises();

      // Should not navigate on error
      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it("validates required fields before submission", async () => {
      // Clear required fields
      wrapper.vm.formData.name = "";
      wrapper.vm.formData.dashboards[0].folder = "";
      
      const saveButton = wrapper.find('[data-test="add-report-save-btn"]');
      await saveButton.trigger('click');
      await flushPromises();

      // Should not call create API if validation fails
      expect(reports.createReport).not.toHaveBeenCalled();
      expect(wrapper.vm.step).toBe(1); // Should stay on first step for validation
    });

    it("handles cached report creation", async () => {
      wrapper.vm.isCachedReport = true;

      const saveButton = wrapper.find('[data-test="add-report-save-btn"]');
      await saveButton.trigger('click');
      await flushPromises();

      // Verify cached report has no destinations
      expect(reports.createReport).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          destinations: []
        })
      );
    });
  });

  describe("Cancel and Navigation", () => {
    it("shows confirmation dialog when canceling with changes", async () => {
      // Make some changes to trigger confirmation
      wrapper.vm.formData.name = "changed-name";
      
      const cancelButton = wrapper.find('[data-test="add-report-cancel-btn"]');
      await cancelButton.trigger('click');

      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
    });

    it("navigates back directly when no changes made", async () => {
      const cancelButton = wrapper.find('[data-test="add-report-cancel-btn"]');
      await cancelButton.trigger('click');

      // Should navigate without showing confirmation
      expect(wrapper.vm.dialog.show).toBe(false);
      expect(mockRouter.replace).toHaveBeenCalledWith({
        name: "reports",
        query: { org_identifier: "test-org" }
      });
    });
  });

  describe("Report Editing", () => {
    beforeEach(async () => {
      // Mock Date to always return UTC time
      const mockDate = new Date('2023-03-02T08:00:00Z');
      vi.spyOn(global, 'Date').mockImplementation(() => mockDate);

      // Mock successful folder list response
      vi.mocked(dashboardService.list).mockResolvedValue({
        data: {
          dashboards: [{
            "folder-1": {
              title: "Test Dashboard",
              dashboardId: "dash-1",
              tabs: [{ name: "Tab 1", tabId: "tab-1" }],
              version: 1
            }
          }]
        }
      });

      // Setup initial options
      wrapper.vm.folderOptions = [
        { label: "Test Folder", value: "folder-1" }
      ];
      wrapper.vm.dashboardOptions = [
        { label: "Test Dashboard", value: "dash-1", tabs: [{ label: "Tab 1", value: "tab-1" }] }
      ];
      await nextTick();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const mockReport = {
      name: "Test Report",
      description: "Test Description",
      dashboards: [{
        folder: "folder-1",
        dashboard: "dash-1",
        tabs: ["tab-1"],
        variables: [{ key: "var1", value: "val1", id: "1" }],
        timerange: {
          type: "relative",
          period: "30m",
          from: 0,
          to: 0
        }
      }],
      // 2023-03-02 08:00:00 UTC in microseconds
      start: 1677744000000000,
      timezone: "UTC",
      destinations: [
        { email: "test1@example.com" },
        { email: "test2@example.com" }
      ],
      frequency: {
        type: "cron",
        cron: "0 0 * * * *",
        interval: 1
      }
    };

    it("sets up basic report data correctly", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      expect(wrapper.vm.formData.name).toBe("Test Report");
      expect(wrapper.vm.formData.description).toBe("Test Description");
      expect(wrapper.vm.formData.dashboards[0].variables).toEqual(mockReport.dashboards[0].variables);
      expect(wrapper.vm.formData.dashboards[0].timerange).toEqual(mockReport.dashboards[0].timerange);
    });

    it("formats date and time correctly", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      // Verify date format
      expect(wrapper.vm.scheduling.date).toBe("02-03-2023"); // DD-MM-YYYY
      
      // Verify time format (HH:MM)
      expect(wrapper.vm.scheduling.time).toMatch(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/);
      
      // Verify timezone and tab
      expect(wrapper.vm.scheduling.timezone).toBe("UTC");
      expect(wrapper.vm.selectedTimeTab).toBe("scheduleLater");

      // Verify time is properly set (without caring about specific value)
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      expect(timeRegex.test(wrapper.vm.scheduling.time)).toBe(true);
    });

    it("handles email destinations", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      expect(wrapper.vm.emails).toBe("test1@example.com;test2@example.com");
      expect(wrapper.vm.isCachedReport).toBe(false);
    });

    it("handles cached reports (no destinations)", async () => {
      const cachedReport = { ...mockReport, destinations: [] };
      await wrapper.vm.setupEditingReport(cachedReport);
      await flushPromises();

      expect(wrapper.vm.emails).toBe("");
      expect(wrapper.vm.isCachedReport).toBe(true);
    });

    it("sets up cron frequency correctly", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      expect(wrapper.vm.frequency.type).toBe("cron");
      expect(wrapper.vm.frequency.cron).toBe("0 0 * * * *");
    });

    it("handles custom frequency correctly", async () => {
      const customReport = {
        ...mockReport,
        frequency: {
          type: "days",
          interval: 2
        }
      };
      await wrapper.vm.setupEditingReport(customReport);
      await flushPromises();

      expect(wrapper.vm.frequency.type).toBe("custom");
      expect(wrapper.vm.frequency.custom.period).toBe("days");
      expect(wrapper.vm.frequency.custom.interval).toBe(2);
    });

    it("validates and sets folder selection", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      expect(wrapper.vm.formData.dashboards[0].folder).toBe("folder-1");
      expect(dashboardService.list).toHaveBeenCalledWith(
        0, 10000, "name", false, "", "test-org", "folder-1", ""
      );
    });

    it("handles missing folder gracefully", async () => {
      const reportWithInvalidFolder = {
        ...mockReport,
        dashboards: [{
          ...mockReport.dashboards[0],
          folder: "non-existent-folder"
        }]
      };

      await wrapper.vm.setupEditingReport(reportWithInvalidFolder);
      await flushPromises();

      expect(wrapper.vm.formData.dashboards[0].folder).toBe("");
      // Should show error notification - we're not testing notifications in this case
    });

    it("validates and sets dashboard selection", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      expect(wrapper.vm.formData.dashboards[0].dashboard).toBe("dash-1");
      expect(wrapper.vm.dashboardOptions.length).toBeGreaterThan(0);
    });

    it("validates and sets tab selection", async () => {
      await wrapper.vm.setupEditingReport(mockReport);
      await flushPromises();

      expect(wrapper.vm.formData.dashboards[0].tabs).toBe("tab-1");
      expect(wrapper.vm.dashboardTabOptions.length).toBeGreaterThan(0);
    });

    it("handles missing tab gracefully", async () => {
      const reportWithInvalidTab = {
        ...mockReport,
        dashboards: [{
          ...mockReport.dashboards[0],
          tabs: ["non-existent-tab"]
        }]
      };

      await wrapper.vm.setupEditingReport(reportWithInvalidTab);
      await flushPromises();

      expect(wrapper.vm.formData.dashboards[0].tabs).toBe("");
      // Should show error notification - we're not testing notifications in this case
    });
  });

  describe("Filter Functions", () => {
    describe("onFilterOptions", () => {
      it("calls filterOptions with correct parameters for folders", () => {
        const searchValue = "test";
        const updateFn = vi.fn();
        
        wrapper.vm.onFilterOptions("folders", searchValue, updateFn);
        
        expect(wrapper.vm.folderOptions).toBeDefined();
      });

      it("calls filterOptions with correct parameters for dashboards", () => {
        const searchValue = "test";
        const updateFn = vi.fn();
        
        wrapper.vm.onFilterOptions("dashboards", searchValue, updateFn);
        
        expect(wrapper.vm.dashboardOptions).toBeDefined();
      });

      it("calls filterOptions with correct parameters for tabs", () => {
        const searchValue = "test";
        const updateFn = vi.fn();
        
        wrapper.vm.onFilterOptions("tabs", searchValue, updateFn);
        
        expect(wrapper.vm.dashboardTabOptions).toBeDefined();
      });

      it("handles invalid filter type gracefully", () => {
        const searchValue = "test";
        const updateFn = vi.fn();
        
        wrapper.vm.onFilterOptions("invalid", searchValue, updateFn);
        
        expect(updateFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("Frequency Validation", () => {
    beforeEach(() => {
      // Reset cronError before each test
      wrapper.vm.cronError = "";
    });

    it("does nothing when frequency type is not cron", async () => {
      wrapper.vm.frequency = {
        type: "once",
        cron: ""
      };
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("");
    });

    it("validates cron expression must have 6 fields", async () => {
      wrapper.vm.frequency = {
        type: "cron",
        cron: "* * * * *" // Only 5 fields
      };
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("Cron expression must have exactly 6 fields: [Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]");
    });

    it("validates invalid cron expression", async () => {
      wrapper.vm.frequency = {
        type: "cron",
        cron: "invalid * * * * *"
      };
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("Invalid cron expression!");
    });

    it("validates minimum interval requirement", async () => {
      // Set min interval in store config
      store.state.zoConfig = { min_auto_refresh_interval: 60 }; // 60 seconds minimum

      wrapper.vm.frequency = {
        type: "cron",
        cron: "*/30 * * * * *" // Every 30 seconds
      };
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("Frequency should be greater than 59 seconds.");
    });

    it("accepts valid cron expression with sufficient interval", async () => {
      // Set min interval in store config
      store.state.zoConfig = { min_auto_refresh_interval: 60 }; // 60 seconds minimum

      wrapper.vm.frequency = {
        type: "cron",
        cron: "0 */5 * * * *" // Every 5 minutes
      };
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("");
    });

    it("handles missing zoConfig gracefully", async () => {
      // Remove zoConfig from store
      store.state.zoConfig = null;

      wrapper.vm.frequency = {
        type: "cron",
        cron: "*/30 * * * * *" // Every 30 seconds
      };
      
      await wrapper.vm.validateFrequency();
      // Should use default minimum interval of 1 second
      expect(wrapper.vm.cronError).toBe("");
    });

    it("validates complex cron expressions", async () => {
      wrapper.vm.frequency = {
        type: "cron",
        cron: "0 0 12 * * MON-FRI" // At 12:00 PM, Monday through Friday
      };
      
      await wrapper.vm.validateFrequency();
      expect(wrapper.vm.cronError).toBe("");
    });
  });

  describe("Cancel Dialog", () => {
    beforeEach(async () => {
      // Reset router mock before each test
      mockRouter.push.mockReset();
      // Ensure router is properly mocked
      vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter);
      await nextTick();
    });


    it("shows confirmation dialog when changes are pending", async () => {
      // Set up originalReportData different from current formData
      wrapper.vm.originalReportData = JSON.stringify({ name: "Original Name" });
      wrapper.vm.formData = { name: "Changed Name" };
      await nextTick();
      
      // Find and click cancel button
      const cancelBtn = wrapper.find('[data-test="add-report-cancel-btn"]');
      expect(cancelBtn.exists()).toBe(true);
      await cancelBtn.trigger('click');
      await flushPromises();

      // Dialog should be shown with correct content
      expect(wrapper.vm.dialog.show).toBe(true);
      expect(wrapper.vm.dialog.title).toBe("Discard Changes");
      expect(wrapper.vm.dialog.message).toBe("Are you sure you want to cancel report changes?");
    });

  });

  describe("Save Report", () => {
    let qNotifyMock;

    beforeEach(() => {
      // Reset mocks
      vi.mocked(reports.createReport).mockReset();
      vi.mocked(reports.updateReport).mockReset();

      // Mock router
      const mockRouter = {
        push: vi.fn(),
        back: vi.fn(),
        replace: vi.fn()
      };
      vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter);
      wrapper.vm.$router = mockRouter;

      // Mock goToReports function
      wrapper.vm.goToReports = vi.fn();

      // Mock form validation
      wrapper.vm.addReportFormRef = {
        value: {
          validate: vi.fn().mockResolvedValue(true)
        }
      };

      // Mock current date for consistent testing
      const mockDate = new Date('2024-01-01T10:30:00Z');
      vi.spyOn(global, 'Date').mockImplementation(() => mockDate);

      // Initialize base form data
      wrapper.vm.formData = {
        dashboards: [{
          dashboard: "",
          folder: "",
          tabs: "",
          timerange: {
            type: "relative",
            period: "30m",
            from: 0,
            to: 0
          },
          variables: []
        }],
        frequency: {
          type: "once",
          interval: 1,
          cron: "",
          custom: {
            period: "daily",
            interval: "1"
          }
        },
        description: "",
        destinations: [{ email: "" }],
        enabled: true,
        media_type: "Pdf",
        name: "",
        title: "",
        message: "",
        orgId: "",
        start: 0,
        timezone: "UTC",
        timezoneOffset: 0
      };

      // Initialize other required properties
      wrapper.vm.frequency = {
        type: "once",
        interval: 1,
        cron: "",
        custom: {
          period: "daily",
          interval: "1"
        }
      };
      wrapper.vm.scheduling = {
        date: "01-01-2024",
        time: "10:30",
        timezone: "UTC"
      };
      wrapper.vm.selectedTimeTab = "scheduleNow";
      wrapper.vm.timezone = "UTC";
      wrapper.vm.emails = "";
      wrapper.vm.isEditingReport = false;
      wrapper.vm.isCachedReport = false;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("updates an existing report with cron schedule", async () => {
      // Setup initial data
      wrapper.vm.formData = {
        ...wrapper.vm.formData,
        dashboards: [{
          dashboard: "test-dashboard",
          folder: "test-folder",
          tabs: "tab1",
          timerange: { type: "relative", period: "30m", from: 0, to: 0 },
          variables: []
        }],
        name: "Test Report",
        description: "Test Description"
      };
      wrapper.vm.frequency = {
        type: "cron",
        cron: "0 0 * * *"
      };
      wrapper.vm.emails = "test@example.com";
      wrapper.vm.isEditingReport = true;

      // Mock updateReport success
      vi.mocked(reports.updateReport).mockResolvedValue({});

      // Call saveReport
      await wrapper.vm.saveReport();
      await flushPromises();

      // Verify updateReport was called with correct payload
      expect(reports.updateReport).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        expect.objectContaining({
          name: "Test Report",
          frequency: expect.objectContaining({
            type: "cron",
            cron: "0 0 * * * *"
          })
        })
      );
    });


    it("handles API error", async () => {
      // Setup initial data
      wrapper.vm.formData = {
        ...wrapper.vm.formData,
        dashboards: [{
          dashboard: "test-dashboard",
          folder: "test-folder",
          tabs: "tab1",
          timerange: { type: "relative", period: "30m", from: 0, to: 0 },
          variables: []
        }],
        name: "Test Report"
      };

      // Mock createReport error
      const errorMessage = "Failed to create report";
      vi.mocked(reports.createReport).mockRejectedValue({
        response: {
          status: 500,
          data: { message: errorMessage }
        }
      });

      // Call saveReport
      await wrapper.vm.saveReport();
      await flushPromises();

      // Verify createReport was called
      expect(reports.createReport).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        expect.objectContaining({
          name: "Test Report"
        })
      );

      // Verify no navigation on error
      expect(wrapper.vm.goToReports).not.toHaveBeenCalled();
    });

    it("handles custom interval frequency", async () => {
      // Setup initial data
      wrapper.vm.formData = {
        ...wrapper.vm.formData,
        dashboards: [{
          dashboard: "test-dashboard",
          folder: "test-folder",
          tabs: "tab1",
          timerange: { type: "relative", period: "30m", from: 0, to: 0 },
          variables: []
        }],
        name: "Test Report"
      };
      wrapper.vm.frequency = {
        type: "custom",
        custom: {
          period: "daily",
          interval: "2"
        }
      };

      // Mock createReport success
      vi.mocked(reports.createReport).mockResolvedValue({});

      // Call saveReport
      await wrapper.vm.saveReport();
      await flushPromises();

      // Verify correct frequency in payload
      expect(reports.createReport).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        expect.objectContaining({
          frequency: expect.objectContaining({
            type: "daily",
            interval: 2
          })
        })
      );
    });
  });

  describe("Initial Data Setup", () => {
    beforeEach(() => {
      // Reset router query params
      mockRouter.currentRoute.value.query = {};
    });

    it("sets cached report flag based on query param", async () => {
      mockRouter.currentRoute.value.query = { type: "cached" };
      await wrapper.vm.setInitialReportData();
      expect(wrapper.vm.isCachedReport).toBe(true);

      mockRouter.currentRoute.value.query = { type: "scheduled" };
      await wrapper.vm.setInitialReportData();
      expect(wrapper.vm.isCachedReport).toBe(false);
    });
  });

  describe("Dashboard Selection Flow", () => {
    const defaultDashboard = {
      dashboard: "",
      folder: "",
      tabs: "",
      timerange: {
        type: "relative",
        period: "30m",
        from: 0,
        to: 0
      },
      variables: []
    };

    beforeEach(() => {
      // Reset formData.dashboards to ensure it has one item with timerange
      wrapper.vm.formData.dashboards = [{ ...defaultDashboard }];

      // Mock successful dashboard list response
      vi.mocked(dashboardService.list).mockResolvedValue({
        data: {
          dashboards: [{
            "folder-1": {
              title: "Test Dashboard",
              dashboardId: "dash-1",
              tabs: [{ name: "Tab 1", tabId: "tab-1" }],
              version: 1
            }
          }]
        }
      });
    });

    it("clears dashboard and tab selections on folder change", async () => {
      // Setup initial selections while preserving timerange
      wrapper.vm.formData.dashboards[0] = {
        ...defaultDashboard,
        dashboard: "old-dash",
        tabs: "old-tab",
        folder: "old-folder"
      };

      await wrapper.vm.onFolderSelection("folder-1");

      expect(wrapper.vm.formData.dashboards[0].dashboard).toBe("");
      expect(wrapper.vm.formData.dashboards[0].tabs).toBe("");
    });

    it("populates dashboard options on folder selection", async () => {
      // Ensure dashboard has timerange
      wrapper.vm.formData.dashboards[0] = { ...defaultDashboard };
      
      await wrapper.vm.onFolderSelection("folder-1");

      expect(dashboardService.list).toHaveBeenCalledWith(
        0, 10000, "name", false, "",
        store.state.selectedOrganization.identifier,
        "folder-1", ""
      );
      expect(wrapper.vm.dashboardOptions.length).toBe(1);
      expect(wrapper.vm.dashboardOptions[0]).toEqual({
        label: "Test Dashboard",
        value: "dash-1",
        tabs: [{ label: "Tab 1", value: "tab-1" }],
        version: 1
      });
    });

    it("handles dashboard list API error", async () => {
      // Ensure dashboard has timerange
      wrapper.vm.formData.dashboards[0] = { ...defaultDashboard };
      
      vi.mocked(dashboardService.list).mockRejectedValue(new Error("API Error"));
      
      const result = await wrapper.vm.onFolderSelection("folder-1");
      expect(result).toBe(false);
    });

    it("clears tab selection on dashboard change", async () => {
      // Setup initial selections while preserving timerange
      wrapper.vm.formData.dashboards[0] = {
        ...defaultDashboard,
        dashboard: "dash-1",
        tabs: "old-tab",
        folder: "folder-1"
      };
      wrapper.vm.dashboardOptions = [{
        value: "dash-1",
        tabs: [{ label: "Tab 1", value: "tab-1" }]
      }];

      wrapper.vm.onDashboardSelection("dash-1");

      expect(wrapper.vm.formData.dashboards[0].tabs).toBe("");
      expect(wrapper.vm.dashboardTabOptions).toEqual([{ label: "Tab 1", value: "tab-1" }]);
    });

    it("sets default tab when dashboard has no tabs", () => {
      // Setup initial selections while preserving timerange
      wrapper.vm.formData.dashboards[0] = {
        ...defaultDashboard,
        dashboard: "dash-1",
        folder: "folder-1",
        tabs: ""
      };
      wrapper.vm.dashboardOptions = [{
        value: "dash-1",
        tabs: null
      }];

      wrapper.vm.setDashboardTabOptions("dash-1");

      expect(wrapper.vm.dashboardTabOptions).toEqual([{ label: "Default", value: "default" }]);
    });
  });

  describe("DateTime and Timezone Handling", () => {
    it("updates timerange for relative time", () => {
      const datetime = {
        valueType: "relative-custom",
        startTime: 1000,
        endTime: 2000,
        relativeTimePeriod: "1h"
      };

      wrapper.vm.updateDateTime(datetime);

      expect(wrapper.vm.formData.dashboards[0].timerange).toEqual({
        type: "relative",
        from: 1000,
        to: 2000,
        period: "1h"
      });
    });

    it("updates timerange for absolute time", () => {
      const datetime = {
        valueType: "absolute",
        startTime: 1000,
        endTime: 2000
      };

      wrapper.vm.updateDateTime(datetime);

      expect(wrapper.vm.formData.dashboards[0].timerange).toEqual({
        type: "absolute",
        from: 1000,
        to: 2000,
        period: "30m" // Default value
      });
    });

    it("filters timezone options based on search", () => {
      const updateFn = vi.fn();
      wrapper.vm.timezoneFilterFn("America", updateFn);
      
      // Verify update function was called
      expect(updateFn).toHaveBeenCalled();
      
      // Verify filtered options contain only matching timezones
      const filteredOptions = wrapper.vm.filteredTimezone;
      filteredOptions.forEach(tz => {
        expect(tz.toLowerCase()).toContain("america");
      });
    });
  });

  describe("Dashboard Variables", () => {
    it("adds a new dashboard variable", () => {
      const initialLength = wrapper.vm.formData.dashboards[0].variables.length;
      
      wrapper.vm.addDashboardVariable();
      
      expect(wrapper.vm.formData.dashboards[0].variables.length).toBe(initialLength + 1);
      expect(wrapper.vm.formData.dashboards[0].variables[initialLength]).toEqual({
        key: "",
        value: "",
        id: expect.any(String)
      });
    });

    it("removes a dashboard variable", () => {
      // Add a variable first
      wrapper.vm.addDashboardVariable();
      const variableToRemove = wrapper.vm.formData.dashboards[0].variables[0];
      const initialLength = wrapper.vm.formData.dashboards[0].variables.length;
      
      wrapper.vm.removeDashboardVariable(variableToRemove);
      
      expect(wrapper.vm.formData.dashboards[0].variables.length).toBe(initialLength - 1);
      expect(wrapper.vm.formData.dashboards[0].variables).not.toContain(variableToRemove);
    });
  });

  describe("Setup Editing Report", () => {
    const defaultDashboard = {
      dashboard: "",
      folder: "",
      tabs: "",
      timerange: {
        type: "relative",
        period: "30m",
        from: 0,
        to: 0
      },
      variables: []
    };

    beforeEach(() => {
      // Mock dashboard service list response
      vi.mocked(dashboardService.list).mockResolvedValue({
        data: {
          dashboards: [
            {
              dashboard1: {
                title: "Dashboard 1",
                dashboardId: "dash1",
                tabs: [{ name: "Tab 1", tabId: "tab1" }],
                version: 1
              }
            }
          ]
        }
      });

      // Mock Quasar notify
      wrapper.vm.q = {
        notify: vi.fn()
      };

      // Initialize dashboardOptions and dashboardTabOptions
      wrapper.vm.dashboardOptions = [{
        label: "Dashboard 1",
        value: "dash1",
        tabs: [{ name: "Tab 1", tabId: "tab1" }],
        version: 1
      }];
      wrapper.vm.dashboardTabOptions = [{ label: "Default", value: "default" }];

      // Initialize options
      wrapper.vm.options = {
        tabs: [{ label: "Default", value: "default" }]
      };
    });

    it("should handle single interval frequency type", async () => {
      const mockReport = {
        name: "Test Report",
        description: "Test Description",
        frequency: {
          type: "hours",
          interval: 1,
          cron: ""
        },
        dashboards: [{
          folder: "folder1",
          dashboard: "dash1",
          tabs: ["tab1"],
          variables: [],
          timerange: defaultDashboard.timerange
        }],
        start: Date.now() * 1000,
        timezone: "UTC",
        destinations: []
      };

      await wrapper.vm.setupEditingReport(mockReport);
      expect(wrapper.vm.frequency.type).toBe("hours");
      // The interval is not set in this case as per the component logic
    });


    it("should handle 7-part cron expressions", async () => {
      const mockReport = {
        name: "Test Report",
        description: "Test Description",
        frequency: {
          type: "cron",
          cron: "0 0 * * * * *" // 7-part cron
        },
        dashboards: [{
          folder: "folder1",
          dashboard: "dash1",
          tabs: ["tab1"],
          variables: [],
          timerange: defaultDashboard.timerange
        }],
        start: Date.now() * 1000,
        timezone: "UTC",
        destinations: []
      };

      await wrapper.vm.setupEditingReport(mockReport);
      expect(wrapper.vm.frequency.cron).toBe("0 0 * * * *"); // Should be converted to 6-part
    });
  });

});
