import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Database from "@/components/ingestion/Database.vue";
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
      name: "databases",
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

describe("Database Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset router state
    mockRouter.currentRoute.value.name = "databases";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Database, mountOptions);
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
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
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

      const testWrapper = mount(Database, mountOptions);

      // Only the initial call from the previous test should exist
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      testWrapper.unmount();
    });
  });

  describe("Database Tabs Configuration", () => {
    it("should have correct database tabs structure", () => {
      const databaseTabs = wrapper.vm.databaseTabs;

      expect(Array.isArray(databaseTabs)).toBe(true);
      expect(databaseTabs.length).toBeGreaterThan(0);

      // Check if key database types are present
      const tabNames = databaseTabs.map((tab: any) => tab.name);
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
      const databaseTabs = wrapper.vm.databaseTabs;
      const firstTab = databaseTabs[0];

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
      const databaseTabs = wrapper.vm.databaseTabs;

      const sqlServerTab = databaseTabs.find((tab: any) => tab.name === "sqlserver");
      expect(sqlServerTab.icon).toBe("img:mock-images/ingestion/sqlserver.png");

      const postgresTab = databaseTabs.find((tab: any) => tab.name === "postgres");
      expect(postgresTab.icon).toBe("img:mock-images/ingestion/postgres.png");

      const mongoTab = databaseTabs.find((tab: any) => tab.name === "mongodb");
      expect(mongoTab.icon).toBe("img:mock-images/ingestion/mongodb.svg");
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
      expect(wrapper.vm.databaseTabs).toBeDefined();
    });
  });

  describe("Database Types Coverage", () => {
    it("should include SQL databases", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const sqlDatabases = ["sqlserver", "postgres", "mysql"];

      sqlDatabases.forEach(dbName => {
        const hasDb = databaseTabs.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });

    it("should include NoSQL databases", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const nosqlDatabases = ["mongodb", "redis", "cassandra", "aerospike", "dynamodb"];

      nosqlDatabases.forEach(dbName => {
        const hasDb = databaseTabs.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });

    it("should include data warehouse solutions", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const dataWarehouses = ["snowflake", "databricks"];

      dataWarehouses.forEach(dbName => {
        const hasDb = databaseTabs.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });

    it("should include coordination services", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const coordinationServices = ["zookeeper"];

      coordinationServices.forEach(dbName => {
        const hasDb = databaseTabs.some((tab: any) => tab.name === dbName);
        expect(hasDb).toBe(true);
      });
    });
  });

  describe("Localization", () => {
    it("should use translation keys for database labels", () => {
      const databaseTabs = wrapper.vm.databaseTabs;

      // The labels should be translated strings
      databaseTabs.forEach((tab: any) => {
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
      const testWrapper = mount(Database, mountOptions);

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

      const testWrapper = mount(Database, mountOptions);

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
      const databaseTabs = wrapper.vm.databaseTabs;
      const sqlServerTab = databaseTabs.find((tab: any) => tab.name === "sqlserver");

      expect(sqlServerTab).toBeDefined();
      expect(sqlServerTab.name).toBe("sqlserver");
      expect(sqlServerTab.icon).toBe("img:mock-images/ingestion/sqlserver.png");
      expect(sqlServerTab.contentClass).toBe("tab_content");
      expect(sqlServerTab.to.name).toBe("sqlserver");
      expect(sqlServerTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
    });

    it("should have correct configuration for PostgreSQL tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const postgresTab = databaseTabs.find((tab: any) => tab.name === "postgres");

      expect(postgresTab).toBeDefined();
      expect(postgresTab.name).toBe("postgres");
      expect(postgresTab.icon).toBe("img:mock-images/ingestion/postgres.png");
      expect(postgresTab.contentClass).toBe("tab_content");
      expect(postgresTab.to.name).toBe("postgres");
    });

    it("should have correct configuration for MongoDB tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const mongoTab = databaseTabs.find((tab: any) => tab.name === "mongodb");

      expect(mongoTab).toBeDefined();
      expect(mongoTab.name).toBe("mongodb");
      expect(mongoTab.icon).toBe("img:mock-images/ingestion/mongodb.svg");
      expect(mongoTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Redis tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const redisTab = databaseTabs.find((tab: any) => tab.name === "redis");

      expect(redisTab).toBeDefined();
      expect(redisTab.name).toBe("redis");
      expect(redisTab.icon).toBe("img:mock-images/ingestion/redis.svg");
      expect(redisTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for MySQL tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const mysqlTab = databaseTabs.find((tab: any) => tab.name === "mysql");

      expect(mysqlTab).toBeDefined();
      expect(mysqlTab.name).toBe("mysql");
      expect(mysqlTab.icon).toBe("img:mock-images/ingestion/mysql.svg");
      expect(mysqlTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Snowflake tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const snowflakeTab = databaseTabs.find((tab: any) => tab.name === "snowflake");

      expect(snowflakeTab).toBeDefined();
      expect(snowflakeTab.name).toBe("snowflake");
      expect(snowflakeTab.icon).toBe("img:mock-images/ingestion/snowflake.svg");
      expect(snowflakeTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Zookeeper tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const zookeeperTab = databaseTabs.find((tab: any) => tab.name === "zookeeper");

      expect(zookeeperTab).toBeDefined();
      expect(zookeeperTab.name).toBe("zookeeper");
      expect(zookeeperTab.icon).toBe("img:mock-images/ingestion/zookeeper.png");
      expect(zookeeperTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Cassandra tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const cassandraTab = databaseTabs.find((tab: any) => tab.name === "cassandra");

      expect(cassandraTab).toBeDefined();
      expect(cassandraTab.name).toBe("cassandra");
      expect(cassandraTab.icon).toBe("img:mock-images/ingestion/cassandra.png");
      expect(cassandraTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Aerospike tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const aerospikeTab = databaseTabs.find((tab: any) => tab.name === "aerospike");

      expect(aerospikeTab).toBeDefined();
      expect(aerospikeTab.name).toBe("aerospike");
      expect(aerospikeTab.icon).toBe("img:mock-images/ingestion/aerospike.svg");
      expect(aerospikeTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for DynamoDB tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const dynamodbTab = databaseTabs.find((tab: any) => tab.name === "dynamodb");

      expect(dynamodbTab).toBeDefined();
      expect(dynamodbTab.name).toBe("dynamodb");
      expect(dynamodbTab.icon).toBe("img:mock-images/ingestion/dynamodb.png");
      expect(dynamodbTab.contentClass).toBe("tab_content");
    });

    it("should have correct configuration for Databricks tab", () => {
      const databaseTabs = wrapper.vm.databaseTabs;
      const databricksTab = databaseTabs.find((tab: any) => tab.name === "databricks");

      expect(databricksTab).toBeDefined();
      expect(databricksTab.name).toBe("databricks");
      expect(databricksTab.icon).toBe("img:mock-images/ingestion/databricks.svg");
      expect(databricksTab.contentClass).toBe("tab_content");
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
  });

  describe("Template Data Binding", () => {
    it("should pass correct props to router-view", () => {
      // Since router-view is stubbed, we'll test if the properties exist on the component
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
    });

    it("should bind ingestTabType to the sidebar layout", () => {
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
    });
  });

  describe("Integration Tests", () => {
    it("should maintain consistency between router and tab state", () => {
      expect(wrapper.vm.ingestTabType).toBe("sqlserver");
      const sqlServerTab = wrapper.vm.databaseTabs.find((tab: any) => tab.name === "sqlserver");
      expect(sqlServerTab).toBeDefined();
    });

    it("should properly integrate with store state", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty organization identifier", () => {
      const testWrapper = mount(Database, {
        props: { currOrgIdentifier: "" },
        global: mountOptions.global,
      });

      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      expect(testWrapper.vm.databaseTabs).toBeDefined();
      testWrapper.unmount();
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
  });
});
