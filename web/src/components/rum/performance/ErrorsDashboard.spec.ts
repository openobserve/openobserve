import { mount } from "@vue/test-utils";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import ErrorsDashboard from "./ErrorsDashboard.vue";
import { createI18n } from "vue-i18n";

// Mock services and utilities
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    name: "RenderDashboardCharts",
    template: '<div class="render-dashboard-charts-mock"><slot /></div>',
    props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
    methods: {
      layoutUpdate: vi.fn()
    }
  }
}));

vi.mock("@/utils/rum/errors.json", () => ({
  default: {
    title: "RUM Errors Dashboard",
    panels: [],
    variables: { list: [] }
  }
}));

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn()
  }
}));

vi.mock("../../../utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data)
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org"
    }
  }
};

vi.mock("vuex", () => ({
  useStore: () => mockStore
}));

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      rum: {
        viewURL: "View URL",
        errorCount: "Error Count"
      }
    }
  }
});

describe("ErrorsDashboard", () => {
  let wrapper: any;
  
  const defaultProps = {
    dateTime: {
      startTime: 1234567890,
      endTime: 1234568000,
      relativeTimePeriod: "15m",
      valueType: "relative"
    },
    selectedDate: {
      startDate: "2023-01-01",
      endDate: "2023-01-02"
    }
  };

  const createWrapper = (props = {}) => {
    return mount(ErrorsDashboard, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n],
        stubs: {
          "q-page": {
            name: "q-page",
            template: '<div class="q-page"><slot /></div>',
            props: ["class"]
          },
          "q-spinner-hourglass": {
            name: "q-spinner-hourglass", 
            template: '<div class="q-spinner-hourglass"></div>',
            props: ["color", "size", "style"]
          },
          "RenderDashboardCharts": {
            name: "RenderDashboardCharts",
            template: '<div class="render-dashboard-charts-mock"><slot /></div>',
            props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
            methods: {
              layoutUpdate: vi.fn()
            }
          }
        }
      }
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render component with default props", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should initialize reactive data correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.currentDashboardData).toBeTruthy();
      expect(wrapper.vm.viewOnly).toBe(true);
      expect(wrapper.vm.errorsByView).toEqual([]);
      expect(wrapper.vm.isLoading).toEqual([]);
    });
  });

  describe("Template Rendering", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should render main container", () => {
      const mainContainer = wrapper.find(".performance-error-dashboard");
      expect(mainContainer.exists()).toBe(true);
    });

    it("should render RenderDashboardCharts component", () => {
      const renderComponent = wrapper.findComponent({ name: "RenderDashboardCharts" });
      expect(renderComponent.exists()).toBe(true);
    });
  });

  describe("Dashboard Loading", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should load dashboard data", async () => {
      expect(wrapper.vm.loadDashboard).toBeInstanceOf(Function);
      wrapper.vm.variablesData = { isVariablesLoading: true, values: [] };
      await wrapper.vm.loadDashboard();
      expect(wrapper.vm.currentDashboardData.data).toBeTruthy();
    });
  });

  describe("Variables Management", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should update variables data when data changes", () => {
      const newData = { variable1: "value1" };
      wrapper.vm.variablesData = { old: "data" };
      
      wrapper.vm.variablesDataUpdated(newData);
      
      expect(wrapper.vm.variablesData).toEqual(newData);
    });
  });
});
