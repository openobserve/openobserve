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

import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { vi } from 'vitest';

// TypeScript interfaces for test data
export interface TestProps {
  currOrgIdentifier?: string;
  currUserEmail?: string;
}

export interface MockStoreState {
  selectedOrganization?: {
    identifier: string;
  };
  userInfo?: {
    email: string;
  };
  zoConfig?: {
    timestamp_column: string;
  };
  API_ENDPOINT?: string;
  organizationPasscode?: number;
}

export interface MockEndpoint {
  url: string;
  host: string;
  port: string;
  protocol: string;
  tls: string;
}

// Default test props
export const defaultTestProps: TestProps = {
  currOrgIdentifier: 'test_org',
  currUserEmail: 'test@example.com'
};

// Default mock store state
export const defaultMockStoreState: MockStoreState = {
  selectedOrganization: {
    identifier: 'test_org'
  },
  userInfo: {
    email: 'test@example.com'
  },
  zoConfig: {
    timestamp_column: '@timestamp'
  },
  API_ENDPOINT: 'http://localhost:8080',
  organizationPasscode: 12345
};

// Mock endpoint data
export const mockEndpoint: MockEndpoint = {
  url: 'http://localhost:8080',
  host: 'localhost',
  port: '8080',
  protocol: 'http',
  tls: 'off'
};

// Create mock store factory
export const createMockStore = (customState: Partial<MockStoreState> = {}) => {
  return createStore({
    state: {
      ...defaultMockStoreState,
      ...customState
    }
  });
};

// Create test wrapper factory
export const createTestWrapper = (
  component: any,
  props: TestProps = {},
  storeState: Partial<MockStoreState> = {},
  options: any = {}
) => {
  const store = createMockStore(storeState);
  
  return mount(component, {
    props: {
      ...defaultTestProps,
      ...props
    },
    global: {
      provide: {
        store
      },
      ...options.global
    },
    ...options
  });
};

// Mock utility functions
export const mockZincUtils = () => {
  vi.mock('@/utils/zincutils', () => ({
    getIngestionURL: vi.fn(() => 'http://localhost:8080'),
    getEndPoint: vi.fn(() => mockEndpoint),
    getImageURL: vi.fn(() => '/mock-image.png'),
    maskText: vi.fn((text: string) => text)
  }));
};

// Mock useIngestion composable
export const mockUseIngestion = () => {
  vi.mock('@/composables/useIngestion', () => ({
    default: vi.fn(() => ({
      endpoint: { value: mockEndpoint },
      databaseContent: `exporters:
  otlphttp/openobserve:
    endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]
    headers:
      Authorization: Basic [BASIC_PASSCODE]
      stream-name: default`,
      databaseDocURLs: {
        mySQL: 'https://short.openobserve.ai/database/mysql',
        postgres: 'https://short.openobserve.ai/database/postgres',
        mongoDB: 'https://short.openobserve.ai/database/mongodb',
        redis: 'https://short.openobserve.ai/database/redis',
        couchDB: 'https://short.openobserve.ai/database/couchdb',
        elasticsearch: 'https://short.openobserve.ai/database/elasticsearch',
        sqlServer: 'https://short.openobserve.ai/database/sql-server',
        sapHana: 'https://short.openobserve.ai/database/sap-hana',
        snowflake: 'https://short.openobserve.ai/database/snowflake',
        zookeeper: 'https://short.openobserve.ai/database/zookeeper',
        cassandra: 'https://short.openobserve.ai/database/cassandra',
        aerospike: 'https://short.openobserve.ai/database/aerospike',
        dynamoDB: 'https://short.openobserve.ai/database/dynamodb',
        databricks: 'https://short.openobserve.ai/databricks'
      },
      securityContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      securityDocURLs: {
        falco: 'https://short.openobserve.ai/security/falco',
        osquery: 'https://short.openobserve.ai/security/osquery',
        okta: 'https://short.openobserve.ai/security/okta',
        jumpcloud: 'https://short.openobserve.ai/security/jumpcloud',
        openvpn: 'https://short.openobserve.ai/security/openvpn',
        office365: 'https://short.openobserve.ai/security/office365',
        googleworkspace: 'https://short.openobserve.ai/security/google-workspace'
      },
      devopsContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      devopsDocURLs: {
        jenkins: 'https://short.openobserve.ai/devops/jenkins',
        ansible: 'https://short.openobserve.ai/devops/ansible',
        terraform: 'https://short.openobserve.ai/devops/terraform',
        githubactions: 'https://short.openobserve.ai/devops/github-actions'
      },
      networkingContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      networkingDocURLs: {
        netflow: 'https://short.openobserve.ai/network/netflow'
      },
      serverContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      serverDocURLs: {
        nginx: 'https://short.openobserve.ai/server/nginx',
        apache: 'https://short.openobserve.ai/server/apache',
        iis: 'https://short.openobserve.ai/server/iis'
      },
      messageQueuesContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      messageQueuesDocURLs: {
        rabbitmq: 'https://short.openobserve.ai/rabbitmq',
        kafka: 'https://short.openobserve.ai/kafka',
        nats: 'https://short.openobserve.ai/nats'
      },
      languagesContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      languagesDocURLs: {
        python: 'https://openobserve.ai/blog/handling-errors-with-opentelemetry-python',
        dotnettracing: 'https://short.openobserve.ai/dotnet-tracing',
        dotnetlogs: 'https://short.openobserve.ai/dotnet-logging',
        nodejs: 'https://short.openobserve.ai/languages/nodejs',
        go: 'https://short.openobserve.ai/golang',
        rust: 'https://short.openobserve.ai/rust',
        java: 'https://short.openobserve.ai/java',
        fastapi: 'https://short.openobserve.ai/framework/fastapi'
      },
      othersContent: `HTTP Endpoint: ${mockEndpoint.url}/api/test_org/[STREAM_NAME]/_json
Access Key: [BASIC_PASSCODE]`,
      othersDocURLs: {
        airflow: 'https://short.openobserve.ai/others/airflow',
        airbyte: 'https://short.openobserve.ai/others/airbyte',
        cribl: 'https://short.openobserve.ai/cribl',
        vercel: 'https://short.openobserve.ai/vercel',
        heroku: 'https://short.openobserve.ai/heroku'
      }
    }))
  }));
};

// Mock CopyContent component
export const mockCopyContent = () => {
  vi.mock('@/components/CopyContent.vue', () => ({
    default: {
      name: 'CopyContent',
      props: ['content'],
      template: '<div data-test="copy-content">{{ content }}</div>'
    }
  }));
};

// Mock external dependencies
export const mockExternalDependencies = () => {
  vi.mock('@/aws-exports', () => ({
    default: {
      aws_project_region: 'us-east-1'
    }
  }));

  vi.mock('@/services/segment_analytics', () => ({
    default: {
      track: vi.fn()
    }
  }));
};

// Component categories for testing
export const componentCategories = {
  databases: [
    'MySQL', 'Postgres', 'MongoDB', 'Redis', 'CouchDB', 'Elasticsearch', 
    'SqlServer', 'SAPHana', 'Snowflake', 'Zookeeper', 'Cassandra', 
    'Aerospike', 'DynamoDB', 'Databricks'
  ],
  security: [
    'Falco', 'OSQuery', 'Okta', 'Jumpcloud', 'OpenVPN', 'Office365', 'GoogleWorkspace'
  ],
  devops: [
    'Jenkins', 'Ansible', 'Terraform', 'GithubActions'
  ],
  servers: [
    'Nginx', 'Apache', 'IIS'
  ],
  messagequeues: [
    'Kafka', 'RabbitMQ', 'Nats'
  ],
  languages: [
    'Python', 'DotNetLogs', 'DotNetTracing', 'NodeJS', 'Go', 'Rust', 'Java', 'FastAPI'
  ],
  others: [
    'Airflow', 'Airbyte', 'Cribl', 'Vercel', 'Heroku'
  ],
  networking: [
    'Netflow'
  ],
  logs: [
    'Curl', 'FluentBit', 'Fluentd', 'FileBeat', 'Vector', 'SysLog', 'SyslogNg', 
    'LogstashDatasource', 'OtelConfig'
  ],
  metrics: [
    'CloudWatchMetrics', 'OtelCollector', 'PrometheusConfig', 'TelegrafConfig'
  ],
  traces: [
    'OpenTelemetry'
  ],
  recommended: [
    'AWSConfig', 'AzureConfig', 'FrontendRumConfig', 'GCPConfig', 
    'KubernetesConfig', 'LinuxConfig', 'OtelConfig', 'WindowsConfig'
  ]
};

// Test cleanup utility
export const cleanupTest = (wrapper: any) => {
  if (wrapper) {
    wrapper.unmount();
  }
  vi.clearAllMocks();
  
  // Clear any pending timers that Quasar might have set
  vi.clearAllTimers();
  
  // Ensure any pending DOM operations are completed
  if (typeof global !== 'undefined' && global.document) {
    // Clear any pending timeouts/intervals that might be left by Quasar
    const timeoutId = setTimeout(() => {}, 0);
    clearTimeout(timeoutId);
    
    // Force cleanup of any pending microtasks
    return Promise.resolve().then(() => {
      // Additional cleanup if needed
    });
  }
};

// Common test assertions - these are just helper functions, expect should be imported in test files
export const commonAssertions = {
  shouldMountSuccessfully: (wrapper: any) => {
    // This function is not used anymore - expect should be used directly in tests
    return wrapper.exists();
  },
  
  shouldRenderCopyContent: (wrapper: any) => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    return copyContent.exists();
  },
  
  shouldDisplayCorrectContent: (wrapper: any, expectedContent: string) => {
    const copyContent = wrapper.findComponent({ name: 'CopyContent' });
    return copyContent.props('content').includes(expectedContent);
  },
  
  shouldRenderDocumentationLink: (wrapper: any) => {
    const link = wrapper.find('a[target="_blank"]');
    return link.exists() && /^https?:\/\//.test(link.attributes('href') || '');
  },
  
  shouldHandlePropsCorrectly: (wrapper: any, props: TestProps) => {
    let result = true;
    if (props.currOrgIdentifier && wrapper.vm.currOrgIdentifier !== undefined) {
      result = result && wrapper.vm.currOrgIdentifier === props.currOrgIdentifier;
    }
    if (props.currUserEmail && wrapper.vm.currUserEmail !== undefined) {
      result = result && wrapper.vm.currUserEmail === props.currUserEmail;
    }
    return result;
  }
};