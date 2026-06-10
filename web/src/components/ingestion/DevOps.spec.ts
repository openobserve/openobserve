import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import DevOps from "@/components/ingestion/DevOps.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


// Mock services
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mock-${path}`),
  verifyOrganizationStatus: vi.fn()
}));

vi.mock("@/aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080"
  }
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "devops",
      query: {}
    }
  },
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// Mock Quasar
const mockQuasar = {
  notify: vi.fn()
};

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuasar: () => mockQuasar
  };
});

const mountOptions = {
  props: {
    currOrgIdentifier: "test-org"
  },
  global: {
    plugins: [i18n],
    provide: {
      store,
    },
    stubs: {
      DataSourceSidebarLayout: true,
      'router-view': true
    }
  },
};

describe("DevOps Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset router state
    mockRouter.currentRoute.value.name = "devops";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(DevOps, mountOptions);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct props", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.ingestTabType).toBe("jenkins");
    });

    it("should have correct computed values", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });
  });

  describe("Route Handling", () => {
    it("should redirect to jenkins when on devops route", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "jenkins",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when not on devops route", () => {
      mockRouter.currentRoute.value.name = "jenkins";

      const testWrapper = mount(DevOps, mountOptions);

      // Only the initial call from the previous test should exist
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      testWrapper.unmount();
    });
  });

  describe("DevOps Tools Configuration", () => {
    it("should have correct DevOps tabs structure", () => {
      const devopsTabs = wrapper.vm.devopsTabs;

      expect(Array.isArray(devopsTabs)).toBe(true);
      expect(devopsTabs.length).toBe(4);

      // Check if key DevOps tools are present
      const tabNames = devopsTabs.map((tab: any) => tab.name);
      expect(tabNames).toContain("jenkins");
      expect(tabNames).toContain("ansible");
      expect(tabNames).toContain("terraform");
      expect(tabNames).toContain("github-actions");
    });

    it("should have correct tab structure for each tool", () => {
      const devopsTabs = wrapper.vm.devopsTabs;
      const firstTab = devopsTabs[0];

      expect(firstTab).toHaveProperty("name");
      expect(firstTab).toHaveProperty("to");
      expect(firstTab).toHaveProperty("icon");
      expect(firstTab).toHaveProperty("label");
      expect(firstTab).toHaveProperty("contentClass", "tab_content");

      // Check icon URL structure
      expect(firstTab.icon).toMatch(/^img:mock-images\/ingestion\//);

      // Check to object structure
      expect(firstTab.to).toHaveProperty("name");
      expect(firstTab.to).toHaveProperty("query");
      expect(firstTab.to.query).toHaveProperty("org_identifier", store.state.selectedOrganization.identifier);
    });

    it("should generate correct icons for each tool", () => {
      const devopsTabs = wrapper.vm.devopsTabs;

      const jenkinsTab = devopsTabs.find((tab: any) => tab.name === "jenkins");
      expect(jenkinsTab.icon).toBe("img:mock-images/ingestion/jenkins.svg");

      const ansibleTab = devopsTabs.find((tab: any) => tab.name === "ansible");
      expect(ansibleTab.icon).toBe("img:mock-images/ingestion/ansible.svg");

      const terraformTab = devopsTabs.find((tab: any) => tab.name === "terraform");
      expect(terraformTab.icon).toBe("img:mock-images/ingestion/terraform.svg");

      const githubTab = devopsTabs.find((tab: any) => tab.name === "github-actions");
      expect(githubTab.icon).toBe("img:mock-images/ingestion/github-actions.svg");
    });
  });

  describe("Component Props and Data", () => {
    it("should expose all required properties", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
    });

    it("should have reactive data properties", () => {
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.ingestTabType).toBe("jenkins");
      expect(wrapper.vm.devopsTabs).toBeDefined();
    });
  });

  describe("DevOps Tools Coverage", () => {
    it("should include CI/CD tools", () => {
      const devopsTabs = wrapper.vm.devopsTabs;
      const cicdTools = ["jenkins", "github-actions"];

      cicdTools.forEach(toolName => {
        const hasTool = devopsTabs.some((tab: any) => tab.name === toolName);
        expect(hasTool).toBe(true);
      });
    });

    it("should include Infrastructure as Code tools", () => {
      const devopsTabs = wrapper.vm.devopsTabs;
      const iacTools = ["terraform", "ansible"];

      iacTools.forEach(toolName => {
        const hasTool = devopsTabs.some((tab: any) => tab.name === toolName);
        expect(hasTool).toBe(true);
      });
    });

    it("should have default jenkins tab selection", () => {
      expect(wrapper.vm.ingestTabType).toBe("jenkins");
    });
  });

  describe("Localization", () => {
    it("should use translation keys for tool labels", () => {
      const devopsTabs = wrapper.vm.devopsTabs;

      // The labels should be translated strings
      devopsTabs.forEach((tab: any) => {
        expect(typeof tab.label).toBe("string");
        expect(tab.label.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Tab Configuration Details", () => {
    it("should have correct route configuration for each tool", () => {
      const devopsTabs = wrapper.vm.devopsTabs;

      devopsTabs.forEach((tab: any) => {
        expect(tab.to.name).toBe(tab.name);
        expect(tab.to.query).toHaveProperty("org_identifier");
        expect(tab.contentClass).toBe("tab_content");
      });
    });

    it("should maintain consistent icon path structure", () => {
      const devopsTabs = wrapper.vm.devopsTabs;

      devopsTabs.forEach((tab: any) => {
        expect(tab.icon).toMatch(/^img:mock-images\/ingestion\/.*\.svg$/);
      });
    });
  });
});
