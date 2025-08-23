import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import DevOps from "@/components/ingestion/DevOps.vue";
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
    useQuasar: () => mockQuasar
  };
});

describe("DevOps Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "devops";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(DevOps, {
      props: {
        currOrgIdentifier: "test-org"
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          'q-splitter': {
            template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
          },
          'q-input': true,
          'q-icon': true,
          'q-tabs': true,
          'q-route-tab': true,
          'router-view': true
        }
      },
    });
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
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.ingestTabType).toBe("jenkins");
      expect(wrapper.vm.tabsFilter).toBe("");
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
      
      const testWrapper = mount(DevOps, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-icon': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      // Only the initial call from the previous test should exist
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      testWrapper.unmount();
    });
  });

  describe("DevOps Tools Configuration", () => {
    it("should have correct DevOps tabs structure", () => {
      const filteredList = wrapper.vm.filteredList;
      
      expect(Array.isArray(filteredList)).toBe(true);
      expect(filteredList.length).toBe(4);
      
      // Check if key DevOps tools are present
      const tabNames = filteredList.map((tab: any) => tab.name);
      expect(tabNames).toContain("jenkins");
      expect(tabNames).toContain("ansible");
      expect(tabNames).toContain("terraform");
      expect(tabNames).toContain("github-actions");
    });

    it("should have correct tab structure for each tool", () => {
      const filteredList = wrapper.vm.filteredList;
      const firstTab = filteredList[0];
      
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
      const filteredList = wrapper.vm.filteredList;
      
      const jenkinsTab = filteredList.find((tab: any) => tab.name === "jenkins");
      expect(jenkinsTab.icon).toBe("img:mock-images/ingestion/jenkins.svg");
      
      const ansibleTab = filteredList.find((tab: any) => tab.name === "ansible");
      expect(ansibleTab.icon).toBe("img:mock-images/ingestion/ansible.svg");
      
      const terraformTab = filteredList.find((tab: any) => tab.name === "terraform");
      expect(terraformTab.icon).toBe("img:mock-images/ingestion/terraform.svg");

      const githubTab = filteredList.find((tab: any) => tab.name === "github-actions");
      expect(githubTab.icon).toBe("img:mock-images/ingestion/github-actions.svg");
    });
  });

  describe("Filter Functionality", () => {
    it("should filter DevOps tabs based on search input", async () => {
      // Initially should show all tabs
      expect(wrapper.vm.filteredList.length).toBe(4);
      
      // Filter by "jenkins"
      wrapper.vm.tabsFilter = "jenkins";
      await wrapper.vm.$nextTick();
      
      const filteredList = wrapper.vm.filteredList;
      filteredList.forEach((tab: any) => {
        expect(tab.label.toLowerCase()).toContain("jenkins");
      });
    });

    it("should show all tabs when filter is empty", async () => {
      // Set filter then clear it
      wrapper.vm.tabsFilter = "terraform";
      await wrapper.vm.$nextTick();
      
      wrapper.vm.tabsFilter = "";
      await wrapper.vm.$nextTick();
      
      // Should show all tabs again
      expect(wrapper.vm.filteredList.length).toBe(4); // Total number of DevOps tabs
    });

    it("should be case insensitive", async () => {
      wrapper.vm.tabsFilter = "ANSIBLE";
      await wrapper.vm.$nextTick();
      
      const filteredList = wrapper.vm.filteredList;
      const hasAnsible = filteredList.some((tab: any) => tab.name === "ansible");
      expect(hasAnsible).toBe(true);
    });

    it("should handle no matches", async () => {
      wrapper.vm.tabsFilter = "nonexistenttool";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should filter by partial matches", async () => {
      wrapper.vm.tabsFilter = "git";
      await wrapper.vm.$nextTick();
      
      const filteredList = wrapper.vm.filteredList;
      const hasGithub = filteredList.some((tab: any) => tab.name === "github-actions");
      expect(hasGithub).toBe(true);
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
      expect(wrapper.vm.tabsFilter).toBe("");
      expect(wrapper.vm.filteredList).toBeDefined();
    });
  });

  describe("DevOps Tools Coverage", () => {
    it("should include CI/CD tools", () => {
      const filteredList = wrapper.vm.filteredList;
      const cicdTools = ["jenkins", "github-actions"];
      
      cicdTools.forEach(toolName => {
        const hasTool = filteredList.some((tab: any) => tab.name === toolName);
        expect(hasTool).toBe(true);
      });
    });

    it("should include Infrastructure as Code tools", () => {
      const filteredList = wrapper.vm.filteredList;
      const iacTools = ["terraform", "ansible"];
      
      iacTools.forEach(toolName => {
        const hasTool = filteredList.some((tab: any) => tab.name === toolName);
        expect(hasTool).toBe(true);
      });
    });

    it("should have default jenkins tab selection", () => {
      expect(wrapper.vm.ingestTabType).toBe("jenkins");
    });
  });

  describe("Localization", () => {
    it("should use translation keys for tool labels", () => {
      const filteredList = wrapper.vm.filteredList;
      
      // The labels should be translated strings
      filteredList.forEach((tab: any) => {
        expect(typeof tab.label).toBe("string");
        expect(tab.label.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Tab Configuration Details", () => {
    it("should have correct route configuration for each tool", () => {
      const filteredList = wrapper.vm.filteredList;
      
      filteredList.forEach((tab: any) => {
        expect(tab.to.name).toBe(tab.name);
        expect(tab.to.query).toHaveProperty("org_identifier");
        expect(tab.contentClass).toBe("tab_content");
      });
    });

    it("should maintain consistent icon path structure", () => {
      const filteredList = wrapper.vm.filteredList;
      
      filteredList.forEach((tab: any) => {
        expect(tab.icon).toMatch(/^img:mock-images\/ingestion\/.*\.svg$/);
      });
    });
  });
});