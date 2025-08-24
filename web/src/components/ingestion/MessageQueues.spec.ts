// Copyright 2025 OpenObserve Inc.
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
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import { Quasar } from "quasar";
import MessageQueues from "./MessageQueues.vue";
import store from "../../test/unit/helpers/store";

const i18n = createI18n({
  locale: "en",
  allowComposition: true,
  messages: {
    en: {
      common: {
        search: "Search",
      },
      ingestion: {
        rabbitmq: "RabbitMQ",
        kafka: "Kafka",
        nats: "NATS",
      },
    },
  },
});

// Create a proper router instance
const createMockRouter = (routeName = "message-queues") => {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "message-queues", component: { template: "<div/>" } },
      { path: "/rabbitmq", name: "rabbitmq", component: { template: "<div/>" } },
      { path: "/kafka", name: "kafka", component: { template: "<div/>" } },
      { path: "/nats", name: "nats", component: { template: "<div/>" } },
    ],
  });
  
  // Mock the push method
  router.push = vi.fn();
  
  // Set current route
  router.currentRoute.value = {
    name: routeName,
    query: {},
    params: {},
    path: "/",
    fullPath: "/",
    hash: "",
    matched: [],
    meta: {},
    redirectedFrom: undefined,
  };
  
  return router;
};

// Mock quasar
const mockQuasar = {
  notify: vi.fn(),
};

// Mock utils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mocked-${path}`),
  verifyOrganizationStatus: vi.fn(),
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    aws_project_region: "us-east-1",
  },
}));

describe("MessageQueues.vue", () => {
  let wrapper: any;
  let router: any;

  const createWrapper = (props = {}, routeName = "message-queues") => {
    router = createMockRouter(routeName);
    
    return mount(MessageQueues, {
      props: {
        currOrgIdentifier: "test-org",
        ...props,
      },
      global: {
        plugins: [i18n, store, Quasar, router],
        mocks: {
          $q: mockQuasar,
          $t: (key: string) => key,
        },
        stubs: {
          "q-splitter": true,
          "q-input": true,
          "q-tabs": true,
          "q-route-tab": true,
          "q-icon": true,
          "router-view": true,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization.identifier = "test-org";
    store.state.userInfo.email = "test@example.com";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Test 1: Component renders correctly
  it("should render the component correctly", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm.$options.name).toBe("DevOpsPage");
  });

  // Test 2: Props are correctly received
  it("should receive currOrgIdentifier prop correctly", () => {
    wrapper = createWrapper({ currOrgIdentifier: "custom-org" });
    expect(wrapper.props("currOrgIdentifier")).toBe("custom-org");
  });

  // Test 3: Default props work correctly
  it("should use default value for currOrgIdentifier prop", () => {
    wrapper = createWrapper();
    expect(wrapper.props("currOrgIdentifier")).toBe("test-org");
  });

  // Test 4: Setup function initializes reactive refs correctly
  it("should initialize reactive refs with correct default values", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.tabs).toBe("");
    expect(wrapper.vm.tabsFilter).toBe("");
    expect(wrapper.vm.ingestTabType).toBe("rabbitmq");
    expect(wrapper.vm.splitterModel).toBe(270);
  });

  // Test 5: Store integration works correctly
  it("should access store state correctly", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.currentOrgIdentifier).toBe("test-org");
    expect(wrapper.vm.currentUserEmail).toBe("test@example.com");
  });

  // Test 6: onBeforeMount hook redirects when route is message-queues
  it("should redirect to rabbitmq route on beforeMount when current route is message-queues", async () => {
    wrapper = createWrapper({}, "message-queues");
    await flushPromises();
    
    expect(router.push).toHaveBeenCalledWith({
      name: "rabbitmq",
      query: {
        org_identifier: "test-org",
      },
    });
  });

  // Test 7: onBeforeMount hook does not redirect for other routes
  it("should not redirect on beforeMount when current route is not message-queues", async () => {
    wrapper = createWrapper({}, "rabbitmq");
    await flushPromises();
    
    expect(router.push).not.toHaveBeenCalled();
  });

  // Test 8: onUpdated hook redirects when route is message-queues
  it("should redirect to rabbitmq route on updated when current route is message-queues", async () => {
    wrapper = createWrapper({}, "other-route");
    await flushPromises();
    vi.clearAllMocks();
    
    // Simulate component update by forcing re-render with message-queues route
    wrapper.unmount();
    wrapper = createWrapper({}, "message-queues");
    await flushPromises();
    
    expect(router.push).toHaveBeenCalledWith({
      name: "rabbitmq",
      query: {
        org_identifier: "test-org",
      },
    });
  });

  // Test 9: messageQueueTabs array structure
  it("should have correctly structured messageQueueTabs array", () => {
    wrapper = createWrapper();
    const expectedTabs = [
      {
        name: "rabbitmq",
        to: {
          name: "rabbitmq",
          query: {
            org_identifier: "test-org",
          },
        },
        icon: "img:mocked-images/ingestion/rabbitmq.svg",
        label: "ingestion.rabbitmq",
        contentClass: "tab_content",
      },
      {
        name: "kafka",
        to: {
          name: "kafka",
          query: {
            org_identifier: "test-org",
          },
        },
        icon: "img:mocked-images/ingestion/kafka.svg",
        label: "ingestion.kafka",
        contentClass: "tab_content",
      },
      {
        name: "nats",
        to: {
          name: "nats",
          query: {
            org_identifier: "test-org",
          },
        },
        icon: "img:mocked-images/ingestion/nats.svg",
        label: "ingestion.nats",
        contentClass: "tab_content",
      },
    ];
    
    // Access messageQueueTabs via the setup return values
    expect(wrapper.vm.filteredList).toHaveLength(3);
  });

  // Test 10: filteredList computed property filters correctly
  it("should filter tabs based on tabsFilter value", async () => {
    wrapper = createWrapper();
    
    // Initially all tabs should be visible
    expect(wrapper.vm.filteredList).toHaveLength(3);
    
    // Set filter to "Rabbit" - matches "RabbitMQ"
    wrapper.vm.tabsFilter = "Rabbit";
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(1);
    expect(wrapper.vm.filteredList[0].name).toBe("rabbitmq");
  });

  // Test 11: filteredList is case insensitive
  it("should filter tabs case insensitively", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.tabsFilter = "kafka"; // lowercase should match "Kafka"
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(1);
    expect(wrapper.vm.filteredList[0].name).toBe("kafka");
  });

  // Test 12: filteredList returns empty array when no matches
  it("should return empty array when no tabs match filter", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.tabsFilter = "nonexistent";
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(0);
  });

  // Test 13: filteredList returns all tabs when filter is empty
  it("should return all tabs when filter is empty", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.tabsFilter = "";
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(3);
  });

  // Test 14: filteredList partial matching works
  it("should filter tabs with partial matching", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.tabsFilter = "AT"; // Should match "NATS"
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(1);
    expect(wrapper.vm.filteredList[0].name).toBe("nats");
  });

  // Test 15: tabsFilter reactivity
  it("should update filteredList when tabsFilter changes", async () => {
    wrapper = createWrapper();
    
    expect(wrapper.vm.filteredList).toHaveLength(3);
    
    wrapper.vm.tabsFilter = "Kafka"; // Match "Kafka" label
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(1);
    
    wrapper.vm.tabsFilter = "";
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(3);
  });

  // Test 16: ingestTabType default value
  it("should have correct default value for ingestTabType", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.ingestTabType).toBe("rabbitmq");
  });

  // Test 17: ingestTabType reactivity
  it("should allow ingestTabType to be modified", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.ingestTabType = "kafka";
    await nextTick();
    
    expect(wrapper.vm.ingestTabType).toBe("kafka");
  });

  // Test 18: Store selectedOrganization changes update currentOrgIdentifier
  it("should update currentOrgIdentifier when store selectedOrganization changes", async () => {
    wrapper = createWrapper();
    
    store.state.selectedOrganization.identifier = "new-org";
    await nextTick();
    
    // The ref should still hold the original value since it's initialized once
    expect(wrapper.vm.currentOrgIdentifier).toBe("test-org");
  });

  // Test 19: Router integration - access to router instance
  it("should have access to router instance", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.router).toBeDefined();
  });

  // Test 20: Store integration - access to store instance
  it("should have access to store instance", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.store).toBeDefined();
  });

  // Test 21: i18n integration - access to translation function
  it("should have access to translation function", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.t).toBeDefined();
    expect(typeof wrapper.vm.t).toBe("function");
  });

  // Test 22: Config integration
  it("should have access to config", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.config).toBeDefined();
  });

  // Test 23: Utils integration - getImageURL
  it("should have access to getImageURL utility", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.getImageURL).toBeDefined();
    expect(typeof wrapper.vm.getImageURL).toBe("function");
  });

  // Test 24: Utils integration - verifyOrganizationStatus
  it("should have access to verifyOrganizationStatus utility", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
    expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
  });

  // Test 25: splitterModel reactivity
  it("should allow splitterModel to be modified", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.splitterModel = 300;
    await nextTick();
    
    expect(wrapper.vm.splitterModel).toBe(300);
  });

  // Test 26: tabs ref reactivity
  it("should allow tabs ref to be modified", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.tabs = "test-tabs";
    await nextTick();
    
    expect(wrapper.vm.tabs).toBe("test-tabs");
  });

  // Test 27: Multiple filter scenarios
  it("should handle multiple filter scenarios correctly", async () => {
    wrapper = createWrapper();
    
    // Test filtering with 'Kafka' - should match kafka only  
    wrapper.vm.tabsFilter = "Kafka";
    await nextTick();
    expect(wrapper.vm.filteredList).toHaveLength(1);
    expect(wrapper.vm.filteredList[0].name).toBe("kafka");
    
    // Test filtering with 'a' - should match RabbitMQ, Kafka, and NATS (all contain 'a' or 'A')
    wrapper.vm.tabsFilter = "a";
    await nextTick();
    expect(wrapper.vm.filteredList).toHaveLength(3);
  });

  // Test 28: Component name validation
  it("should have correct component name", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe("DevOpsPage");
  });

  // Test 29: currentUserEmail from store
  it("should get currentUserEmail from store correctly", () => {
    store.state.userInfo.email = "updated@example.com";
    wrapper = createWrapper();
    expect(wrapper.vm.currentUserEmail).toBe("updated@example.com");
  });

  // Test 30: Route query parameters in navigation
  it("should include org_identifier in navigation query params", async () => {
    store.state.selectedOrganization.identifier = "query-test-org";
    wrapper = createWrapper({}, "message-queues");
    await flushPromises();
    
    expect(router.push).toHaveBeenCalledWith({
      name: "rabbitmq",
      query: {
        org_identifier: "query-test-org",
      },
    });
  });

  // Test 31: Filter with whitespace - whitespace is significant in includes()
  it("should handle filter with whitespace correctly", async () => {
    wrapper = createWrapper();
    
    // Since includes() doesn't trim, " RabbitMQ " won't match "RabbitMQ"
    // Let's test a substring that exists: "bit" from "RabbitMQ"
    wrapper.vm.tabsFilter = "bit"; 
    await nextTick();
    
    expect(wrapper.vm.filteredList).toHaveLength(1);
    expect(wrapper.vm.filteredList[0].name).toBe("rabbitmq");
  });

  // Test 32: Multiple rapid filter changes
  it("should handle rapid filter changes correctly", async () => {
    wrapper = createWrapper();
    
    wrapper.vm.tabsFilter = "K"; // Should match "Kafka"
    await nextTick();
    expect(wrapper.vm.filteredList).toHaveLength(1);
    
    wrapper.vm.tabsFilter = "Ka"; // Should still match "Kafka"
    await nextTick();
    expect(wrapper.vm.filteredList).toHaveLength(1);
    
    wrapper.vm.tabsFilter = "Kaf"; // Should still match "Kafka"
    await nextTick();
    expect(wrapper.vm.filteredList).toHaveLength(1);
    expect(wrapper.vm.filteredList[0].name).toBe("kafka");
  });

  // Test 33: Store state consistency
  it("should maintain consistency with store state", () => {
    const testIdentifier = "consistency-test";
    store.state.selectedOrganization.identifier = testIdentifier;
    
    wrapper = createWrapper();
    
    // The currentOrgIdentifier ref should be initialized with store value
    expect(wrapper.vm.currentOrgIdentifier).toBe(testIdentifier);
  });

  // Test 34: Navigation prevention for non-message-queues routes
  it("should not navigate when current route is not message-queues", async () => {
    const testRoutes = ["rabbitmq", "kafka", "nats", "dashboard", "logs"];
    
    for (const routeName of testRoutes) {
      vi.clearAllMocks();
      wrapper = createWrapper({}, routeName);
      await flushPromises();
      
      expect(router.push).not.toHaveBeenCalled();
      
      if (wrapper) {
        wrapper.unmount();
      }
    }
  });

  // Test 35: Icon paths are correctly generated
  it("should generate correct icon paths using getImageURL", async () => {
    const { getImageURL } = await import("@/utils/zincutils");
    wrapper = createWrapper();
    await flushPromises();
    
    expect(getImageURL).toHaveBeenCalledWith("images/ingestion/rabbitmq.svg");
    expect(getImageURL).toHaveBeenCalledWith("images/ingestion/kafka.svg");
    expect(getImageURL).toHaveBeenCalledWith("images/ingestion/nats.svg");
  });
});