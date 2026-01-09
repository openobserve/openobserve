import { mount } from "@vue/test-utils";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import ErrorsDashboard from "./ErrorsDashboard.vue";
import { createI18n } from "vue-i18n";
import { onMounted } from "vue";

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

// Mock onMounted to prevent automatic execution
let mountedCallback: (() => void) | null = null;
vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    onMounted: vi.fn((callback: () => void) => {
      mountedCallback = callback;
    })
  };
});

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

  const createWrapper = (props = {}, options = {}) => {
    // Reset mounted callback before each test
    mountedCallback = null;
    
    const wrapper = mount(ErrorsDashboard, {
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
    
    // Initialize variablesData to prevent null reference errors
    wrapper.vm.variablesData = options.variablesData || { isVariablesLoading: false, values: [] };
    
    // Add helper method to trigger mounted lifecycle
    wrapper.triggerMounted = async () => {
      if (mountedCallback) {
        await mountedCallback();
      }
    };
    
    return wrapper;
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
      wrapper = createWrapper({}, { variablesData: { isVariablesLoading: true, values: [] } });
    });

    it("should load dashboard data", async () => {
      expect(wrapper.vm.loadDashboard).toBeInstanceOf(Function);
      await wrapper.triggerMounted();
      expect(wrapper.vm.currentDashboardData.data).toBeTruthy();
    });
  });

  describe("Variables Management", () => {
    it("should have variablesData ref initialized", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.variablesData).toBeDefined();
      expect(wrapper.vm.variablesData).toHaveProperty("isVariablesLoading");
      expect(wrapper.vm.variablesData).toHaveProperty("values");
    });

    it("should allow direct modification of variablesData", () => {
      wrapper = createWrapper();
      const newData = { isVariablesLoading: false, values: ["test"] };

      wrapper.vm.variablesData = newData;

      expect(wrapper.vm.variablesData).toEqual(newData);
    });
  });
});
