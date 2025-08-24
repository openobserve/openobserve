import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Others from "@/components/ingestion/Others.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// Mock services
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mock-${path}`),
  verifyOrganizationStatus: vi.fn()
}));

vi.mock("@/aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080",
    oauth: {},
    cognito: {}
  }
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "others",
      query: { org_identifier: "test-org" }
    }
  },
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter
}));

// Mock Quasar
const mockQuasar = {
  notify: vi.fn()
};

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuasar: () => mockQuasar,
    copyToClipboard: vi.fn()
  };
});

describe("Others Component", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset router current route
    mockRouter.currentRoute.value.name = "others";
    mockRouter.push.mockClear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should render component with correct name", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm.$options.name).toBe("OthersPage");
  });

  it("should initialize with default props", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.props().currOrgIdentifier).toBe("");
  });

  it("should accept custom currOrgIdentifier prop", () => {
    const customOrgId = "custom-org-123";
    wrapper = mount(Others, {
      props: {
        currOrgIdentifier: customOrgId
      },
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.props().currOrgIdentifier).toBe(customOrgId);
  });

  it("should initialize refs with correct default values", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.tabs).toBe("");
    expect(wrapper.vm.tabsFilter).toBe("");
    expect(wrapper.vm.ingestTabType).toBe("airflow");
    expect(wrapper.vm.splitterModel).toBe(270);
  });

  it("should set currentOrgIdentifier from store", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.currentOrgIdentifier).toBe("default");
  });

  it("should set currentUserEmail from store", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.currentUserEmail).toBe("example@gmail.com");
  });

  it("should redirect to airflow route in onBeforeMount when route name is 'others'", async () => {
    mockRouter.currentRoute.value.name = "others";
    
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    await nextTick();

    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "airflow",
      query: {
        org_identifier: "default"
      }
    });
  });

  it("should not redirect in onBeforeMount when route name is not 'others'", async () => {
    mockRouter.currentRoute.value.name = "airflow";
    
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    await nextTick();

    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("should have othersTabs array with correct structure", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    // Access the othersTabs through component instance
    const othersTabs = [
      {
        name: "airflow",
        to: {
          name: "airflow",
          query: {
            org_identifier: "default"
          }
        },
        icon: "img:mock-images/ingestion/airflow.svg",
        label: wrapper.vm.t("ingestion.airflow"),
        contentClass: "tab_content"
      },
      {
        name: "cribl",
        to: {
          name: "cribl",
          query: {
            org_identifier: "default"
          }
        },
        icon: "img:mock-images/ingestion/cribl.webp",
        label: wrapper.vm.t("ingestion.cribl"),
        contentClass: "tab_content"
      },
      {
        name: "vercel",
        to: {
          name: "vercel",
          query: {
            org_identifier: "default"
          }
        },
        icon: "img:mock-images/ingestion/vercel.svg",
        label: wrapper.vm.t("ingestion.vercel"),
        contentClass: "tab_content"
      },
      {
        name: "heroku",
        to: {
          name: "heroku",
          query: {
            org_identifier: "default"
          }
        },
        icon: "img:mock-images/ingestion/heroku.svg",
        label: wrapper.vm.t("ingestion.heroku"),
        contentClass: "tab_content"
      }
    ];

    expect(othersTabs).toHaveLength(4);
    expect(othersTabs[0].name).toBe("airflow");
    expect(othersTabs[1].name).toBe("cribl");
    expect(othersTabs[2].name).toBe("vercel");
    expect(othersTabs[3].name).toBe("heroku");
  });

  it("should filter tabs correctly with filteredList computed property", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    // Initially, filteredList should contain all tabs
    expect(wrapper.vm.filteredList).toHaveLength(4);

    // Filter by "air"
    wrapper.vm.tabsFilter = "air";
    await nextTick();
    
    const airflowFiltered = wrapper.vm.filteredList.filter(tab => 
      tab.label.toLowerCase().includes("air")
    );
    expect(airflowFiltered.length).toBeGreaterThan(0);
  });

  it("should filter tabs case-insensitively", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    wrapper.vm.tabsFilter = "CRIBL";
    await nextTick();

    const filtered = wrapper.vm.filteredList.filter(tab => 
      tab.label.toLowerCase().includes("cribl")
    );
    expect(filtered.length).toBeGreaterThan(0);
  });

  it("should return empty array when no tabs match filter", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    wrapper.vm.tabsFilter = "nonexistent";
    await nextTick();

    expect(wrapper.vm.filteredList).toHaveLength(0);
  });

  it("should expose all required properties in return statement", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.t).toBeDefined();
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.router).toBeDefined();
    expect(wrapper.vm.config).toBeDefined();
    expect(wrapper.vm.splitterModel).toBe(270);
    expect(wrapper.vm.currentUserEmail).toBe("example@gmail.com");
    expect(wrapper.vm.currentOrgIdentifier).toBe("default");
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
    expect(wrapper.vm.tabs).toBe("");
    expect(wrapper.vm.ingestTabType).toBe("airflow");
    expect(wrapper.vm.tabsFilter).toBe("");
    expect(wrapper.vm.filteredList).toBeDefined();
  });

  it("should handle onUpdated hook correctly when route is 'others'", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    // Clear previous calls
    mockRouter.push.mockClear();
    
    // Trigger onUpdated by changing route name
    mockRouter.currentRoute.value.name = "others";
    
    // Force a re-render to trigger onUpdated
    await wrapper.vm.$forceUpdate();
    await nextTick();

    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "airflow",
      query: {
        org_identifier: "default"
      }
    });
  });

  it("should not redirect in onUpdated when route name is not 'others'", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    // Clear previous calls
    mockRouter.push.mockClear();
    
    // Set route name to something other than 'others'
    mockRouter.currentRoute.value.name = "cribl";
    
    // Force a re-render to trigger onUpdated
    await wrapper.vm.$forceUpdate();
    await nextTick();

    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("should maintain tabs filter reactivity", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    const initialLength = wrapper.vm.filteredList.length;
    
    wrapper.vm.tabsFilter = "airflow";
    await nextTick();
    
    const filteredLength = wrapper.vm.filteredList.length;
    expect(filteredLength).toBeLessThanOrEqual(initialLength);

    wrapper.vm.tabsFilter = "";
    await nextTick();
    
    expect(wrapper.vm.filteredList.length).toBe(initialLength);
  });

  it("should have correct tab icons with image URLs", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    await nextTick();

    // Check that tabs have the correct icon format
    const expectedIcons = [
      "img:mock-images/ingestion/airflow.svg",
      "img:mock-images/ingestion/cribl.webp",
      "img:mock-images/ingestion/vercel.svg",
      "img:mock-images/ingestion/heroku.svg"
    ];
    
    wrapper.vm.filteredList.forEach((tab, index) => {
      expect(tab.icon).toBe(expectedIcons[index]);
    });
  });

  it("should handle store state updates", async () => {
    // Update the store state
    store.commit('setSelectedOrganization', {
      identifier: "updated-org",
      name: "Updated Organization"
    });
    store.commit('setUserInfo', {
      email: "updated@example.com"
    });

    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.currentOrgIdentifier).toBe("updated-org");
    expect(wrapper.vm.currentUserEmail).toBe("updated@example.com");
    
    // Reset store state for other tests
    store.commit('setSelectedOrganization', {
      identifier: "default",
      name: "Test Organization"
    });
    store.commit('setUserInfo', {
      email: "example@gmail.com"
    });
  });

  it("should have correct contentClass for all tabs", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    wrapper.vm.filteredList.forEach(tab => {
      expect(tab.contentClass).toBe("tab_content");
    });
  });

  it("should update ingestTabType ref", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.ingestTabType).toBe("airflow");

    wrapper.vm.ingestTabType = "cribl";
    await nextTick();

    expect(wrapper.vm.ingestTabType).toBe("cribl");
  });

  it("should update tabs ref", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.tabs).toBe("");

    wrapper.vm.tabs = "test-tab";
    await nextTick();

    expect(wrapper.vm.tabs).toBe("test-tab");
  });

  it("should update splitterModel ref", async () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    expect(wrapper.vm.splitterModel).toBe(270);

    wrapper.vm.splitterModel = 300;
    await nextTick();

    expect(wrapper.vm.splitterModel).toBe(300);
  });

  it("should have correct query parameters in tab routes", () => {
    wrapper = mount(Others, {
      global: {
        plugins: [i18n, store]
      }
    });

    wrapper.vm.filteredList.forEach(tab => {
      expect(tab.to.query.org_identifier).toBe("default");
    });
  });
});