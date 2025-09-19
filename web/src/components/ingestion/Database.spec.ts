import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Database from "@/components/ingestion/Database.vue";
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
      name: "databases",
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

describe("Database Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "databases";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Database, {
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
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
      expect(wrapper.vm.tabsFilter).toBe("");
    });

    it("should have correct computed values", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });
  });

  describe("Route Handling", () => {
    it("should redirect to sqlserver when on databases route", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "sqlserver",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when not on databases route", () => {
      mockRouter.currentRoute.value.name = "sqlserver";
      
      const testWrapper = mount(Database, {
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

  describe("Database Tabs Configuration", () => {
    it("should have correct database tabs structure", () => {
      const filteredList = wrapper.vm.filteredList;
      
      expect(Array.isArray(filteredList)).toBe(true);
      expect(filteredList.length).toBeGreaterThan(0);
      
      // Check if key database types are present
      const tabNames = filteredList.map((tab: any) => tab.name);
      expect(tabNames).toContain("sqlserver");
      expect(tabNames).toContain("postgres");
      expect(tabNames).toContain("mongodb");
      expect(tabNames).toContain("redis");
      expect(tabNames).toContain("mysql");
      expect(tabNames).toContain("snowflake");
      expect(tabNames).toContain("zookeeper");
      expect(tabNames).toContain("cassandra");
      expect(tabNames).toContain("aerospike");
      expect(tabNames).toContain("dynamodb");
      expect(tabNames).toContain("databricks");
    });

    it("should have correct tab structure for each database", () => {
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

    it("should generate correct icons for each database", () => {
      const filteredList = wrapper.vm.filteredList;
      
      const sqlServerTab = filteredList.find((tab: any) => tab.name === "sqlserver");
      expect(sqlServerTab.icon).toBe("img:mock-images/ingestion/sqlserver.png");
      
      const postgresTab = filteredList.find((tab: any) => tab.name === "postgres");
      expect(postgresTab.icon).toBe("img:mock-images/ingestion/postgres.png");
      
      const mongoTab = filteredList.find((tab: any) => tab.name === "mongodb");
      expect(mongoTab.icon).toBe("img:mock-images/ingestion/mongodb.svg");
    });
  });

  describe("Filter Functionality", () => {
    it("should filter database tabs based on search input", async () => {
      // Initially should show all tabs
      expect(wrapper.vm.filteredList.length).toBeGreaterThan(5);
      
      // Filter by "sql"
      wrapper.vm.tabsFilter = "sql";
      await wrapper.vm.$nextTick();
      
      const filteredList = wrapper.vm.filteredList;
      filteredList.forEach((tab: any) => {
        expect(tab.label.toLowerCase()).toContain("sql");
      });
    });

    it("should show all tabs when filter is empty", async () => {
      // Set filter then clear it
      wrapper.vm.tabsFilter = "postgres";
      await wrapper.vm.$nextTick();
      
      wrapper.vm.tabsFilter = "";
      await wrapper.vm.$nextTick();
      
      // Should show all tabs again
      expect(wrapper.vm.filteredList.length).toBe(12); // Total number of database tabs
    });

    it("should be case insensitive", async () => {
      wrapper.vm.tabsFilter = "POSTGRES";
      await wrapper.vm.$nextTick();
      
      const filteredList = wrapper.vm.filteredList;
      const hasPostgres = filteredList.some((tab: any) => tab.name === "postgres");
      expect(hasPostgres).toBe(true);
    });

    it("should handle no matches", async () => {
      wrapper.vm.tabsFilter = "nonexistentdb";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should filter by partial matches", async () => {
      wrapper.vm.tabsFilter = "mongo";
      await wrapper.vm.$nextTick();
      
      const filteredList = wrapper.vm.filteredList;
      const hasMongoDb = filteredList.some((tab: any) => tab.name === "mongodb");
      expect(hasMongoDb).toBe(true);
      expect(filteredList.length).toBe(1);
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
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
      expect(wrapper.vm.tabsFilter).toBe("");
      expect(wrapper.vm.filteredList).toBeDefined();
    });
  });

  describe("Database Types Coverage", () => {
    it("should include SQL databases", () => {
      const filteredList = wrapper.vm.filteredList;
      const sqlDatabases = ["sqlserver", "postgres", "mysql"];
      
      sqlDatabases.forEach(dbName => {
        const hasDb = filteredList.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });

    it("should include NoSQL databases", () => {
      const filteredList = wrapper.vm.filteredList;
      const nosqlDatabases = ["mongodb", "redis", "cassandra", "aerospike", "dynamodb"];
      
      nosqlDatabases.forEach(dbName => {
        const hasDb = filteredList.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });

    it("should include data warehouse solutions", () => {
      const filteredList = wrapper.vm.filteredList;
      const dataWarehouses = ["snowflake", "databricks"];
      
      dataWarehouses.forEach(dbName => {
        const hasDb = filteredList.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });

    it("should include coordination services", () => {
      const filteredList = wrapper.vm.filteredList;
      const coordinationServices = ["zookeeper"];
      
      coordinationServices.forEach(dbName => {
        const hasDb = filteredList.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });
  });

  describe("Localization", () => {
    it("should use translation keys for database labels", () => {
      const filteredList = wrapper.vm.filteredList;
      
      // The labels should be translated strings
      filteredList.forEach((tab: any) => {
        expect(typeof tab.label).toBe("string");
        expect(tab.label.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Lifecycle Hooks - onBeforeMount", () => {
    it("should redirect to sqlserver on databases route during onBeforeMount", () => {
      // Reset mock call count
      mockRouter.push.mockClear();
      mockRouter.currentRoute.value.name = "databases";
      
      // Create new component to trigger onBeforeMount
      const testWrapper = mount(Database, {
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

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "sqlserver",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      
      testWrapper.unmount();
    });

    it("should not redirect when not on databases route during onBeforeMount", () => {
      mockRouter.push.mockClear();
      mockRouter.currentRoute.value.name = "postgres";
      
      const testWrapper = mount(Database, {
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

      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });
  });

  describe("Lifecycle Hooks - onUpdated", () => {
    it("should redirect to sqlserver on databases route during onUpdated", async () => {
      mockRouter.push.mockClear();
      mockRouter.currentRoute.value.name = "databases";
      
      // Trigger component update
      await wrapper.setProps({ currOrgIdentifier: "updated-org" });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "sqlserver",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when not on databases route during onUpdated", async () => {
      mockRouter.push.mockClear();
      mockRouter.currentRoute.value.name = "postgres";
      
      await wrapper.setProps({ currOrgIdentifier: "updated-org" });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  describe("Database Tabs - Detailed Structure", () => {
    it("should have correct configuration for SQL Server tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const sqlServerTab = filteredList.find((tab: any) => tab.name === "sqlserver");
      
      expect(sqlServerTab).toBeDefined();
      expect(sqlServerTab.name).toBe("sqlserver");
      expect(sqlServerTab.icon).toBe("img:mock-images/ingestion/sqlserver.png");
      expect(sqlServerTab.contentClass).toBe("tab_content");
      expect(sqlServerTab.to.name).toBe("sqlserver");
      expect(sqlServerTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
    });

    it("should have correct configuration for PostgreSQL tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const postgresTab = filteredList.find((tab: any) => tab.name === "postgres");
      
      expect(postgresTab).toBeDefined();
      expect(postgresTab.name).toBe("postgres");
      expect(postgresTab.icon).toBe("img:mock-images/ingestion/postgres.png");
      expect(postgresTab.contentClass).toBe("tab_content");
      expect(postgresTab.to.name).toBe("postgres");
    });

    it("should have correct configuration for MongoDB tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const mongoTab = filteredList.find((tab: any) => tab.name === "mongodb");
      
      expect(mongoTab).toBeDefined();
      expect(mongoTab.name).toBe("mongodb");
      expect(mongoTab.icon).toBe("img:mock-images/ingestion/mongodb.svg");
      expect(mongoTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Redis tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const redisTab = filteredList.find((tab: any) => tab.name === "redis");
      
      expect(redisTab).toBeDefined();
      expect(redisTab.name).toBe("redis");
      expect(redisTab.icon).toBe("img:mock-images/ingestion/redis.svg");
      expect(redisTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for MySQL tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const mysqlTab = filteredList.find((tab: any) => tab.name === "mysql");
      
      expect(mysqlTab).toBeDefined();
      expect(mysqlTab.name).toBe("mysql");
      expect(mysqlTab.icon).toBe("img:mock-images/ingestion/mysql.svg");
      expect(mysqlTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Snowflake tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const snowflakeTab = filteredList.find((tab: any) => tab.name === "snowflake");
      
      expect(snowflakeTab).toBeDefined();
      expect(snowflakeTab.name).toBe("snowflake");
      expect(snowflakeTab.icon).toBe("img:mock-images/ingestion/snowflake.svg");
      expect(snowflakeTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Zookeeper tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const zookeeperTab = filteredList.find((tab: any) => tab.name === "zookeeper");
      
      expect(zookeeperTab).toBeDefined();
      expect(zookeeperTab.name).toBe("zookeeper");
      expect(zookeeperTab.icon).toBe("img:mock-images/ingestion/zookeeper.png");
      expect(zookeeperTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Cassandra tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const cassandraTab = filteredList.find((tab: any) => tab.name === "cassandra");
      
      expect(cassandraTab).toBeDefined();
      expect(cassandraTab.name).toBe("cassandra");
      expect(cassandraTab.icon).toBe("img:mock-images/ingestion/cassandra.png");
      expect(cassandraTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Aerospike tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const aerospikeTab = filteredList.find((tab: any) => tab.name === "aerospike");
      
      expect(aerospikeTab).toBeDefined();
      expect(aerospikeTab.name).toBe("aerospike");
      expect(aerospikeTab.icon).toBe("img:mock-images/ingestion/aerospike.svg");
      expect(aerospikeTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for DynamoDB tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const dynamodbTab = filteredList.find((tab: any) => tab.name === "dynamodb");
      
      expect(dynamodbTab).toBeDefined();
      expect(dynamodbTab.name).toBe("dynamodb");
      expect(dynamodbTab.icon).toBe("img:mock-images/ingestion/dynamodb.png");
      expect(dynamodbTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Databricks tab", () => {
      const filteredList = wrapper.vm.filteredList;
      const databricksTab = filteredList.find((tab: any) => tab.name === "databricks");
      
      expect(databricksTab).toBeDefined();
      expect(databricksTab.name).toBe("databricks");
      expect(databricksTab.icon).toBe("img:mock-images/ingestion/databricks.svg");
      expect(databricksTab.contentClass).toBe("tab_content");
    });
  });

  describe("Computed Properties - filteredList", () => {
    it("should be reactive to tabsFilter changes", async () => {
      const initialLength = wrapper.vm.filteredList.length;
      expect(initialLength).toBeGreaterThan(0);

      wrapper.vm.tabsFilter = "postgres";
      await wrapper.vm.$nextTick();
      
      const filteredLength = wrapper.vm.filteredList.length;
      expect(filteredLength).toBeLessThan(initialLength);
    });

    it("should maintain original array when filter matches all", async () => {
      wrapper.vm.tabsFilter = "";
      await wrapper.vm.$nextTick();
      
      const allTabs = wrapper.vm.filteredList;
      expect(allTabs.length).toBe(12);
    });

    it("should filter based on label content", async () => {
      wrapper.vm.tabsFilter = "databricks";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("databricks");
    });

    it("should handle special characters in filter", async () => {
      wrapper.vm.tabsFilter = "SQL";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      const hasSqlServer = filtered.some((tab: any) => tab.name === "sqlserver");
      const hasMysql = filtered.some((tab: any) => tab.name === "mysql");
      expect(hasSqlServer || hasMysql).toBe(true);
    });
  });

  describe("Component State Management", () => {
    it("should initialize ingestTabType correctly", () => {
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
    });

    it("should allow modification of ingestTabType", async () => {
      wrapper.vm.ingestTabType = "postgres";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ingestTabType).toBe("postgres");
    });

    it("should maintain tabsFilter state", async () => {
      const testFilter = "test-filter";
      wrapper.vm.tabsFilter = testFilter;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.tabsFilter).toBe(testFilter);
    });

    it("should have correct splitter model value", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
    });

    it("should allow modification of splitter model", async () => {
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.splitterModel).toBe(300);
    });
  });

  describe("Template Data Binding", () => {
    it("should pass correct props to router-view", () => {
      // Since router-view is stubbed as true, we'll test if the properties exist on the component
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
    });

    it("should bind splitterModel to q-splitter", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
    });

    it("should bind tabsFilter to search input", () => {
      expect(wrapper.vm.tabsFilter).toBe("");
    });

    it("should bind ingestTabType to q-tabs", () => {
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
    });
  });

  describe("Integration Tests", () => {
    it("should maintain consistency between router and tab state", () => {
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
      const sqlServerTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "sqlserver");
      expect(sqlServerTab).toBeDefined();
    });

    it("should properly integrate with store state", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });

    it("should maintain filter and display consistency", async () => {
      const originalCount = wrapper.vm.filteredList.length;
      
      wrapper.vm.tabsFilter = "sql";
      await wrapper.vm.$nextTick();
      
      const filteredCount = wrapper.vm.filteredList.length;
      expect(filteredCount).toBeLessThan(originalCount);
      
      // Check each filtered item contains the search term
      wrapper.vm.filteredList.forEach((tab: any) => {
        expect(tab.label.toLowerCase()).toContain("sql");
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty organization identifier", () => {
      const testWrapper = mount(Database, {
        props: { currOrgIdentifier: "" },
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
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      expect(testWrapper.vm.filteredList).toBeDefined();
      testWrapper.unmount();
    });

    it("should handle extreme filter lengths", async () => {
      const longFilter = "a".repeat(1000);
      wrapper.vm.tabsFilter = longFilter;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.filteredList).toBeDefined();
      expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
    });
  });

  describe("Component Methods and Functions", () => {
    it("should expose getImageURL function", () => {
      expect(typeof wrapper.vm.getImageURL).toBe("function");
    });

    it("should expose verifyOrganizationStatus function", () => {
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
    });

    it("should have access to translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should have access to router instance", () => {
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.router.push).toBeDefined();
    });

    it("should have access to store instance", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should have access to config object", () => {
      expect(wrapper.vm.config).toBeDefined();
    });

    it("should expose databaseTabs array", () => {
      expect(wrapper.vm.databaseTabs).toBeDefined();
      expect(Array.isArray(wrapper.vm.databaseTabs)).toBe(true);
      expect(wrapper.vm.databaseTabs.length).toBe(12);
    });

    it("should have databaseTabs with consistent structure", () => {
      wrapper.vm.databaseTabs.forEach((tab: any) => {
        expect(tab).toHaveProperty("name");
        expect(tab).toHaveProperty("to");
        expect(tab).toHaveProperty("icon");
        expect(tab).toHaveProperty("label");
        expect(tab).toHaveProperty("contentClass", "tab_content");
        expect(typeof tab.name).toBe("string");
        expect(typeof tab.label).toBe("string");
        expect(tab.icon).toMatch(/^img:mock-images\/ingestion\//);
      });
    });
  });

  describe("Database Tabs Raw Data", () => {
    it("should contain all expected database types in databaseTabs", () => {
      const expectedDbs = [
        "sqlserver", "postgres", "mongodb", "redis", "mysql",
        "snowflake", "zookeeper", "cassandra", "aerospike", "dynamodb", "databricks"
      ];
      
      const actualDbNames = wrapper.vm.databaseTabs.map((tab: any) => tab.name);
      
      expectedDbs.forEach(dbName => {
        expect(actualDbNames).toContain(dbName);
      });
    });

    it("should have correct icon extensions for different databases", () => {
      const svgDbs = ["mongodb", "redis", "mysql", "snowflake", "aerospike", "databricks"];
      const pngDbs = ["sqlserver", "postgres", "zookeeper", "cassandra", "dynamodb"];
      
      wrapper.vm.databaseTabs.forEach((tab: any) => {
        if (svgDbs.includes(tab.name)) {
          expect(tab.icon).toMatch(/\.svg$/);
        } else if (pngDbs.includes(tab.name)) {
          expect(tab.icon).toMatch(/\.png$/);
        }
      });
    });

    it("should maintain consistency between databaseTabs and filteredList", () => {
      wrapper.vm.tabsFilter = "";
      const filteredTabs = wrapper.vm.filteredList;
      const rawTabs = wrapper.vm.databaseTabs;
      
      expect(filteredTabs.length).toBe(rawTabs.length);
      
      rawTabs.forEach((rawTab: any, index: number) => {
        expect(filteredTabs[index].name).toBe(rawTab.name);
        expect(filteredTabs[index].label).toBe(rawTab.label);
      });
    });
  });
});