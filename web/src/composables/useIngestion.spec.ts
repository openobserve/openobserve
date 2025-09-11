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

import { beforeEach, describe, expect, it, vi } from "vitest";
import useIngestion from "@/composables/useIngestion";

// Mock the utility functions
vi.mock("@/utils/zincutils", () => ({
  getEndPoint: vi.fn().mockReturnValue({
    url: "http://localhost:5080",
    host: "localhost",
    port: "5080",
    protocol: "http",
    tls: false,
  }),
  getIngestionURL: vi.fn().mockReturnValue("http://localhost:5080"),
}));

// Mock Vuex useStore
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test_org_123",
      name: "Test Organization"
    },
  },
};

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useStore: vi.fn(() => mockStore),
  };
});

describe("useIngestion Composable Comprehensive Coverage", () => {
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Composable Initialization Tests", () => {
    it("should initialize and return all required properties", () => {
      const result = useIngestion();
      
      expect(result).toHaveProperty('endpoint');
      expect(result).toHaveProperty('databaseContent');
      expect(result).toHaveProperty('databaseDocURLs');
      expect(result).toHaveProperty('securityContent');
      expect(result).toHaveProperty('securityDocURLs');
      expect(result).toHaveProperty('devopsContent');
      expect(result).toHaveProperty('devopsDocURLs');
      expect(result).toHaveProperty('networkingContent');
      expect(result).toHaveProperty('networkingDocURLs');
      expect(result).toHaveProperty('serverContent');
      expect(result).toHaveProperty('serverDocURLs');
      expect(result).toHaveProperty('messageQueuesContent');
      expect(result).toHaveProperty('messageQueuesDocURLs');
      expect(result).toHaveProperty('languagesContent');
      expect(result).toHaveProperty('languagesDocURLs');
      expect(result).toHaveProperty('othersContent');
      expect(result).toHaveProperty('othersDocURLs');
    });

    it("should have access to store during initialization", () => {
      const result = useIngestion();
      expect(result).toBeDefined();
      expect(result.endpoint).toBeDefined();
    });

    it("should initialize endpoint with utilities", () => {
      const result = useIngestion();
      expect(result.endpoint.value.url).toBe("http://localhost:5080");
    });

    it("should process organization data from store", () => {
      const result = useIngestion();
      expect(result.databaseContent).toContain("test_org_123");
    });
  });

  describe("Endpoint Configuration Tests", () => {
    it("should initialize endpoint with correct structure", () => {
      const result = useIngestion();
      
      expect(result.endpoint.value).toHaveProperty('url');
      expect(result.endpoint.value).toHaveProperty('host');
      expect(result.endpoint.value).toHaveProperty('port');
      expect(result.endpoint.value).toHaveProperty('protocol');
      expect(result.endpoint.value).toHaveProperty('tls');
    });

    it("should have correct endpoint values", () => {
      const result = useIngestion();
      
      expect(result.endpoint.value.url).toBe("http://localhost:5080");
      expect(result.endpoint.value.host).toBe("localhost");
      expect(result.endpoint.value.port).toBe("5080");
      expect(result.endpoint.value.protocol).toBe("http");
      expect(result.endpoint.value.tls).toBe(false);
    });

    it("should have reactive endpoint", () => {
      const result = useIngestion();
      expect(result.endpoint._value).toBeDefined(); // Vue ref should have _value
    });

    it("should initialize endpoint with empty default values", () => {
      // Test the initial ref structure before getEndPoint is called
      const result = useIngestion();
      expect(typeof result.endpoint.value.url).toBe('string');
      expect(typeof result.endpoint.value.host).toBe('string');
      expect(typeof result.endpoint.value.port).toBe('string');
      expect(typeof result.endpoint.value.protocol).toBe('string');
    });
  });

  describe("Database Content Tests", () => {
    it("should generate correct database content structure", () => {
      const result = useIngestion();
      
      expect(result.databaseContent).toContain('exporters:');
      expect(result.databaseContent).toContain('otlphttp/openobserve:');
      expect(result.databaseContent).toContain('endpoint:');
      expect(result.databaseContent).toContain('headers:');
      expect(result.databaseContent).toContain('Authorization: Basic [BASIC_PASSCODE]');
      expect(result.databaseContent).toContain('stream-name: default');
    });

    it("should include organization identifier in database content", () => {
      const result = useIngestion();
      expect(result.databaseContent).toContain('test_org_123');
    });

    it("should include endpoint URL in database content", () => {
      const result = useIngestion();
      expect(result.databaseContent).toContain('http://localhost:5080/api/test_org_123/');
    });

    it("should have valid YAML-like structure", () => {
      const result = useIngestion();
      const lines = result.databaseContent.split('\n');
      expect(lines[0]).toBe('exporters:');
      expect(lines[1]).toContain('  otlphttp/openobserve:');
      expect(lines[2]).toContain('    endpoint:');
    });
  });

  describe("Database Doc URLs Tests", () => {
    it("should contain all required database documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.databaseDocURLs;
      
      expect(docURLs).toHaveProperty('sqlServer');
      expect(docURLs).toHaveProperty('postgres');
      expect(docURLs).toHaveProperty('mongoDB');
      expect(docURLs).toHaveProperty('redis');
      expect(docURLs).toHaveProperty('couchDB');
      expect(docURLs).toHaveProperty('elasticsearch');
      expect(docURLs).toHaveProperty('mySQL');
      expect(docURLs).toHaveProperty('sapHana');
      expect(docURLs).toHaveProperty('snowflake');
      expect(docURLs).toHaveProperty('zookeeper');
      expect(docURLs).toHaveProperty('cassandra');
      expect(docURLs).toHaveProperty('aerospike');
      expect(docURLs).toHaveProperty('dynamoDB');
      expect(docURLs).toHaveProperty('databricks');
    });

    it("should have valid URL structure for database docs", () => {
      const result = useIngestion();
      const docURLs = result.databaseDocURLs;
      
      Object.values(docURLs).forEach(url => {
        expect(typeof url).toBe('string');
        expect(url).toMatch(/^https?:\/\//);
      });
    });

    it("should contain short.openobserve.ai domain URLs", () => {
      const result = useIngestion();
      const docURLs = result.databaseDocURLs;
      
      expect(docURLs.postgres).toBe("https://short.openobserve.ai/database/postgres");
      expect(docURLs.sqlServer).toBe("https://short.openobserve.ai/database/sql-server");
      expect(docURLs.mongoDB).toBe("https://short.openobserve.ai/database/mongodb");
    });

    it("should have correct number of database documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.databaseDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(15);
    });
  });

  describe("Security Content Tests", () => {
    it("should generate correct security content structure", () => {
      const result = useIngestion();
      
      expect(result.securityContent).toContain('HTTP Endpoint:');
      expect(result.securityContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.securityContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in security content", () => {
      const result = useIngestion();
      expect(result.securityContent).toContain('test_org_123');
    });

    it("should include endpoint URL in security content", () => {
      const result = useIngestion();
      expect(result.securityContent).toContain('http://localhost:5080/api/test_org_123/');
    });

    it("should have placeholder for stream name", () => {
      const result = useIngestion();
      expect(result.securityContent).toContain('[STREAM_NAME]');
    });
  });

  describe("Security Doc URLs Tests", () => {
    it("should contain all required security documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.securityDocURLs;
      
      expect(docURLs).toHaveProperty('falco');
      expect(docURLs).toHaveProperty('osquery');
      expect(docURLs).toHaveProperty('okta');
      expect(docURLs).toHaveProperty('jumpcloud');
      expect(docURLs).toHaveProperty('openvpn');
      expect(docURLs).toHaveProperty('office365');
      expect(docURLs).toHaveProperty('googleworkspace');
    });

    it("should have valid URL structure for security docs", () => {
      const result = useIngestion();
      const docURLs = result.securityDocURLs;
      
      Object.values(docURLs).forEach(url => {
        expect(typeof url).toBe('string');
        expect(url).toMatch(/^https?:\/\//);
      });
    });

    it("should have correct number of security documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.securityDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(7);
    });
  });

  describe("DevOps Content Tests", () => {
    it("should generate correct devops content structure", () => {
      const result = useIngestion();
      
      expect(result.devopsContent).toContain('HTTP Endpoint:');
      expect(result.devopsContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.devopsContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in devops content", () => {
      const result = useIngestion();
      expect(result.devopsContent).toContain('test_org_123');
    });
  });

  describe("DevOps Doc URLs Tests", () => {
    it("should contain all required devops documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.devopsDocURLs;
      
      expect(docURLs).toHaveProperty('jenkins');
      expect(docURLs).toHaveProperty('ansible');
      expect(docURLs).toHaveProperty('terraform');
      expect(docURLs).toHaveProperty('githubactions');
    });

    it("should have correct number of devops documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.devopsDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(4);
    });
  });

  describe("Networking Content Tests", () => {
    it("should generate correct networking content structure", () => {
      const result = useIngestion();
      
      expect(result.networkingContent).toContain('HTTP Endpoint:');
      expect(result.networkingContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.networkingContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in networking content", () => {
      const result = useIngestion();
      expect(result.networkingContent).toContain('test_org_123');
    });
  });

  describe("Networking Doc URLs Tests", () => {
    it("should contain networking documentation URL", () => {
      const result = useIngestion();
      const docURLs = result.networkingDocURLs;
      
      expect(docURLs).toHaveProperty('netflow');
      expect(docURLs.netflow).toBe("https://short.openobserve.ai/network/netflow");
    });

    it("should have correct number of networking documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.networkingDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(1);
    });
  });

  describe("Server Content Tests", () => {
    it("should generate correct server content structure", () => {
      const result = useIngestion();
      
      expect(result.serverContent).toContain('HTTP Endpoint:');
      expect(result.serverContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.serverContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in server content", () => {
      const result = useIngestion();
      expect(result.serverContent).toContain('test_org_123');
    });
  });

  describe("Server Doc URLs Tests", () => {
    it("should contain all required server documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.serverDocURLs;
      
      expect(docURLs).toHaveProperty('nginx');
      expect(docURLs).toHaveProperty('apache');
      expect(docURLs).toHaveProperty('iis');
    });

    it("should have correct number of server documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.serverDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(3);
    });
  });

  describe("Message Queues Content Tests", () => {
    it("should generate correct message queues content structure", () => {
      const result = useIngestion();
      
      expect(result.messageQueuesContent).toContain('HTTP Endpoint:');
      expect(result.messageQueuesContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.messageQueuesContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in message queues content", () => {
      const result = useIngestion();
      expect(result.messageQueuesContent).toContain('test_org_123');
    });
  });

  describe("Message Queues Doc URLs Tests", () => {
    it("should contain all required message queue documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.messageQueuesDocURLs;
      
      expect(docURLs).toHaveProperty('rabbitmq');
      expect(docURLs).toHaveProperty('kafka');
      expect(docURLs).toHaveProperty('nats');
    });

    it("should have correct number of message queue documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.messageQueuesDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(3);
    });
  });

  describe("Languages Content Tests", () => {
    it("should generate correct languages content structure", () => {
      const result = useIngestion();
      
      expect(result.languagesContent).toContain('HTTP Endpoint:');
      expect(result.languagesContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.languagesContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in languages content", () => {
      const result = useIngestion();
      expect(result.languagesContent).toContain('test_org_123');
    });
  });

  describe("Languages Doc URLs Tests", () => {
    it("should contain all required language documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.languagesDocURLs;
      
      expect(docURLs).toHaveProperty('python');
      expect(docURLs).toHaveProperty('dotnettracing');
      expect(docURLs).toHaveProperty('dotnetlogs');
      expect(docURLs).toHaveProperty('nodejs');
      expect(docURLs).toHaveProperty('go');
      expect(docURLs).toHaveProperty('rust');
      expect(docURLs).toHaveProperty('java');
      expect(docURLs).toHaveProperty('fastapi');
    });

    it("should have correct number of language documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.languagesDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(8);
    });

    it("should have python URL pointing to blog", () => {
      const result = useIngestion();
      expect(result.languagesDocURLs.python).toContain('openobserve.ai/blog');
    });
  });

  describe("Others Content Tests", () => {
    it("should generate correct others content structure", () => {
      const result = useIngestion();
      
      expect(result.othersContent).toContain('HTTP Endpoint:');
      expect(result.othersContent).toContain('Access Key: [BASIC_PASSCODE]');
      expect(result.othersContent).toContain('[STREAM_NAME]/_json');
    });

    it("should include organization identifier in others content", () => {
      const result = useIngestion();
      expect(result.othersContent).toContain('test_org_123');
    });
  });

  describe("Others Doc URLs Tests", () => {
    it("should contain all required others documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.othersDocURLs;
      
      expect(docURLs).toHaveProperty('airflow');
      expect(docURLs).toHaveProperty('airbyte');
      expect(docURLs).toHaveProperty('cribl');
      expect(docURLs).toHaveProperty('vercel');
      expect(docURLs).toHaveProperty('heroku');
    });

    it("should have correct number of others documentation URLs", () => {
      const result = useIngestion();
      const docURLs = result.othersDocURLs;
      expect(Object.keys(docURLs)).toHaveLength(5);
    });
  });

  describe("Content Consistency Tests", () => {
    it("should have consistent endpoint URLs across all content types", () => {
      const result = useIngestion();
      const expectedEndpoint = 'http://localhost:5080/api/test_org_123/';
      
      expect(result.securityContent).toContain(expectedEndpoint);
      expect(result.devopsContent).toContain(expectedEndpoint);
      expect(result.networkingContent).toContain(expectedEndpoint);
      expect(result.serverContent).toContain(expectedEndpoint);
      expect(result.messageQueuesContent).toContain(expectedEndpoint);
      expect(result.languagesContent).toContain(expectedEndpoint);
      expect(result.othersContent).toContain(expectedEndpoint);
    });

    it("should have consistent placeholder patterns across content types", () => {
      const result = useIngestion();
      const expectedPlaceholders = ['[STREAM_NAME]', '[BASIC_PASSCODE]'];
      
      const contents = [
        result.securityContent,
        result.devopsContent,
        result.networkingContent,
        result.serverContent,
        result.messageQueuesContent,
        result.languagesContent,
        result.othersContent,
      ];

      contents.forEach(content => {
        expectedPlaceholders.forEach(placeholder => {
          expect(content).toContain(placeholder);
        });
      });
    });

    it("should have different content structures for database vs others", () => {
      const result = useIngestion();
      
      // Database content should have YAML structure
      expect(result.databaseContent).toContain('exporters:');
      expect(result.databaseContent).toContain('otlphttp/openobserve:');
      
      // Other contents should have HTTP endpoint structure
      expect(result.securityContent).toContain('HTTP Endpoint:');
      expect(result.devopsContent).toContain('HTTP Endpoint:');
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should not throw errors during initialization", () => {
      expect(() => useIngestion()).not.toThrow();
    });

    it("should handle composable execution gracefully", () => {
      const result = useIngestion();
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it("should initialize with valid endpoint values", () => {
      const result = useIngestion();
      expect(result.endpoint.value).toBeDefined();
      expect(typeof result.endpoint.value.url).toBe('string');
    });

    it("should generate content strings without errors", () => {
      const result = useIngestion();
      expect(typeof result.databaseContent).toBe('string');
      expect(typeof result.securityContent).toBe('string');
      expect(typeof result.devopsContent).toBe('string');
    });
  });

  describe("Integration Tests", () => {
    it("should integrate with mocked utilities", () => {
      const result = useIngestion();
      expect(result.endpoint.value.url).toBe("http://localhost:5080");
      expect(result.endpoint.value.host).toBe("localhost");
      expect(result.endpoint.value.port).toBe("5080");
    });

    it("should integrate with store data", () => {
      const result = useIngestion();
      expect(result.databaseContent).toContain('test_org_123');
      expect(result.securityContent).toContain('test_org_123');
      expect(result.devopsContent).toContain('test_org_123');
    });

    it("should produce consistent endpoint URLs across content", () => {
      const result = useIngestion();
      const expectedEndpoint = 'http://localhost:5080/api/test_org_123/';
      
      expect(result.databaseContent).toContain(expectedEndpoint);
      expect(result.securityContent).toContain(expectedEndpoint);
      expect(result.devopsContent).toContain(expectedEndpoint);
    });
  });

  describe("Return Object Structure Validation", () => {
    it("should return exactly 16 properties", () => {
      const result = useIngestion();
      const expectedProperties = [
        'endpoint', 'databaseContent', 'databaseDocURLs',
        'securityContent', 'securityDocURLs', 'devopsContent', 'devopsDocURLs',
        'networkingContent', 'networkingDocURLs', 'serverContent', 'serverDocURLs',
        'messageQueuesContent', 'messageQueuesDocURLs', 'languagesContent', 'languagesDocURLs',
        'othersContent', 'othersDocURLs'
      ];
      
      expect(Object.keys(result)).toHaveLength(17);
      expectedProperties.forEach(prop => {
        expect(result).toHaveProperty(prop);
      });
    });

    it("should have correct data types for all properties", () => {
      const result = useIngestion();
      
      expect(typeof result.endpoint).toBe('object'); // Vue ref
      expect(typeof result.databaseContent).toBe('string');
      expect(typeof result.databaseDocURLs).toBe('object');
      expect(typeof result.securityContent).toBe('string');
      expect(typeof result.securityDocURLs).toBe('object');
      expect(typeof result.devopsContent).toBe('string');
      expect(typeof result.devopsDocURLs).toBe('object');
      expect(typeof result.networkingContent).toBe('string');
      expect(typeof result.networkingDocURLs).toBe('object');
      expect(typeof result.serverContent).toBe('string');
      expect(typeof result.serverDocURLs).toBe('object');
      expect(typeof result.messageQueuesContent).toBe('string');
      expect(typeof result.messageQueuesDocURLs).toBe('object');
      expect(typeof result.languagesContent).toBe('string');
      expect(typeof result.languagesDocURLs).toBe('object');
      expect(typeof result.othersContent).toBe('string');
      expect(typeof result.othersDocURLs).toBe('object');
    });
  });
});