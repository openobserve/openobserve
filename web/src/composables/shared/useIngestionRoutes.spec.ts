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

import { describe, it, expect, vi, beforeEach } from "vitest";
import useIngestionRoutes from "./useIngestionRoutes";

vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false"
  }
}));

vi.mock("@/utils/zincutils", () => ({
  routeGuard: vi.fn((to, from, next) => next())
}));

vi.mock("@/components/ingestion/logs/SyslogNg.vue", () => ({ default: {} }));
vi.mock("@/views/Ingestion.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/FluentBit.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/Fluentd.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/Vector.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/Curl.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/AWSConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/GCPConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/AzureConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/FileBeat.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/traces/OpenTelemetry.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/metrics/PrometheusConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/metrics/OtelCollector.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/metrics/TelegrafConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/metrics/CloudWatchMetrics.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/Index.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/metrics/Index.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/traces/Index.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Recommended.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Custom.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/logs/LogstashDatasource.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/FrontendRumConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/KubernetesConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/LinuxConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/OtelConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/recommended/WindowsConfig.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Database.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/SqlServer.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Postgres.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/MongoDB.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Redis.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/CouchDB.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Elasticsearch.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/MySQL.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/SAPHana.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Snowflake.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Zookeeper.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Cassandra.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Aerospike.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/DynamoDB.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/databases/Databricks.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Security.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/Falco.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/OSQuery.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/Okta.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/Jumpcloud.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/OpenVPN.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/Office365.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/security/GoogleWorkspace.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/DevOps.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/devops/Jenkins.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/devops/Ansible.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/devops/Terraform.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/devops/GithubActions.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Networking.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/networking/Netflow.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Server.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/servers/Nginx.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/servers/Apache.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/servers/IIS.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/MessageQueues.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/messagequeues/Kafka.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/messagequeues/RabbitMQ.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/messagequeues/Nats.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Languages.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/Python.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/DotNetTracing.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/DotNetLogs.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/NodeJS.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/Rust.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/Java.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/Go.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/languages/FastAPI.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/Others.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/others/Airflow.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/others/Airbyte.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/others/Cribl.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/others/Vercel.vue", () => ({ default: {} }));
vi.mock("@/components/ingestion/others/Heroku.vue", () => ({ default: {} }));

describe("useIngestionRoutes", () => {
  describe("function execution", () => {
    it("should return an array of route configurations", () => {
      const routes = useIngestionRoutes();
      expect(Array.isArray(routes)).toBe(true);
      expect(routes).toHaveLength(1);
    });

    it("should return routes with main ingestion route", () => {
      const routes = useIngestionRoutes();
      const mainRoute = routes[0];
      
      expect(mainRoute).toBeDefined();
      expect(mainRoute.path).toBe("ingestion");
      expect(mainRoute.name).toBe("ingestion");
      expect(mainRoute.component).toBeDefined();
      expect(typeof mainRoute.beforeEnter).toBe("function");
      expect(Array.isArray(mainRoute.children)).toBe(true);
    });

    it("should have all expected main child routes", () => {
      const routes = useIngestionRoutes();
      const mainRoute = routes[0];
      const childNames = mainRoute.children.map((child: any) => child.name);
      
      expect(childNames).toContain("custom");
      expect(childNames).toContain("recommended");
      expect(childNames).toContain("databases");
      expect(childNames).toContain("security");
      expect(childNames).toContain("devops");
      expect(childNames).toContain("networking");
      expect(childNames).toContain("servers");
      expect(childNames).toContain("message-queues");
      expect(childNames).toContain("languages");
      expect(childNames).toContain("others");
    });
  });

  describe("custom routes configuration", () => {
    it("should have proper custom route configuration", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      
      expect(customRoute).toBeDefined();
      expect(customRoute.path).toBe("custom");
      expect(customRoute.component).toBeDefined();
      expect(typeof customRoute.beforeEnter).toBe("function");
      expect(Array.isArray(customRoute.children)).toBe(true);
    });

    it("should have logs routes under custom", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const logsRoute = customRoute.children.find((child: any) => child.name === "ingestLogs");
      
      expect(logsRoute).toBeDefined();
      expect(logsRoute.path).toBe("logs");
      expect(logsRoute.name).toBe("ingestLogs");
      expect(typeof logsRoute.beforeEnter).toBe("function");
    });

    it("should have all log ingestion routes", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const logsRoute = customRoute.children.find((child: any) => child.name === "ingestLogs");
      const logRouteNames = logsRoute.children.map((child: any) => child.name);
      
      expect(logRouteNames).toContain("curl");
      expect(logRouteNames).toContain("fluentbit");
      expect(logRouteNames).toContain("fluentd");
      expect(logRouteNames).toContain("vector");
      expect(logRouteNames).toContain("filebeat");
      expect(logRouteNames).toContain("ingestLogsFromOtel");
      expect(logRouteNames).toContain("logstash");
      expect(logRouteNames).toContain("syslogNg");
    });

    it("should have metrics routes under custom", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const metricsRoute = customRoute.children.find((child: any) => child.name === "ingestMetrics");
      
      expect(metricsRoute).toBeDefined();
      expect(metricsRoute.path).toBe("metrics");
      expect(metricsRoute.name).toBe("ingestMetrics");
      expect(typeof metricsRoute.beforeEnter).toBe("function");
    });

    it("should have all metrics ingestion routes", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const metricsRoute = customRoute.children.find((child: any) => child.name === "ingestMetrics");
      const metricRouteNames = metricsRoute.children.map((child: any) => child.name);
      
      expect(metricRouteNames).toContain("prometheus");
      expect(metricRouteNames).toContain("otelCollector");
      expect(metricRouteNames).toContain("telegraf");
      expect(metricRouteNames).toContain("cloudwatchMetrics");
    });

    it("should have traces routes under custom", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const tracesRoute = customRoute.children.find((child: any) => child.name === "ingestTraces");
      
      expect(tracesRoute).toBeDefined();
      expect(tracesRoute.path).toBe("traces");
      expect(tracesRoute.name).toBe("ingestTraces");
      expect(typeof tracesRoute.beforeEnter).toBe("function");
    });

    it("should have all trace ingestion routes", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const tracesRoute = customRoute.children.find((child: any) => child.name === "ingestTraces");
      const traceRouteNames = tracesRoute.children.map((child: any) => child.name);
      
      expect(traceRouteNames).toContain("tracesOTLP");
      expect(traceRouteNames).toContain("ingestTracesFromOtel");
    });
  });

  describe("recommended routes configuration", () => {
    it("should have proper recommended route configuration", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      
      expect(recommendedRoute).toBeDefined();
      expect(recommendedRoute.path).toBe("recommended");
      expect(recommendedRoute.component).toBeDefined();
      expect(typeof recommendedRoute.beforeEnter).toBe("function");
      expect(Array.isArray(recommendedRoute.children)).toBe(true);
    });

    it("should have all recommended ingestion routes", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      const recommendedRouteNames = recommendedRoute.children.map((child: any) => child.name);
      
      expect(recommendedRouteNames).toContain("ingestFromKubernetes");
      expect(recommendedRouteNames).toContain("ingestFromWindows");
      expect(recommendedRouteNames).toContain("ingestFromLinux");
      expect(recommendedRouteNames).toContain("AWSConfig");
      expect(recommendedRouteNames).toContain("GCPConfig");
      expect(recommendedRouteNames).toContain("AzureConfig");
      expect(recommendedRouteNames).toContain("ingestFromTraces");
      expect(recommendedRouteNames).toContain("frontendMonitoring");
    });

    it("should have proper kubernetes route configuration", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      const kubernetesRoute = recommendedRoute.children.find((child: any) => child.name === "ingestFromKubernetes");
      
      expect(kubernetesRoute).toBeDefined();
      expect(kubernetesRoute.path).toBe("kubernetes");
      expect(kubernetesRoute.component).toBeDefined();
      expect(typeof kubernetesRoute.beforeEnter).toBe("function");
    });

    it("should have proper cloud provider routes", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      
      const awsRoute = recommendedRoute.children.find((child: any) => child.name === "AWSConfig");
      const gcpRoute = recommendedRoute.children.find((child: any) => child.name === "GCPConfig");
      const azureRoute = recommendedRoute.children.find((child: any) => child.name === "AzureConfig");
      
      expect(awsRoute.path).toBe("aws");
      expect(gcpRoute.path).toBe("gcp");
      expect(azureRoute.path).toBe("azure");
    });
  });

  describe("database routes configuration", () => {
    it("should have proper databases route configuration", () => {
      const routes = useIngestionRoutes();
      const databasesRoute = routes[0].children.find((child: any) => child.name === "databases");
      
      expect(databasesRoute).toBeDefined();
      expect(databasesRoute.path).toBe("databases");
      expect(databasesRoute.component).toBeDefined();
      expect(typeof databasesRoute.beforeEnter).toBe("function");
      expect(Array.isArray(databasesRoute.children)).toBe(true);
    });

    it("should have all database ingestion routes", () => {
      const routes = useIngestionRoutes();
      const databasesRoute = routes[0].children.find((child: any) => child.name === "databases");
      const databaseRouteNames = databasesRoute.children.map((child: any) => child.name);
      
      expect(databaseRouteNames).toContain("sqlserver");
      expect(databaseRouteNames).toContain("postgres");
      expect(databaseRouteNames).toContain("mongodb");
      expect(databaseRouteNames).toContain("redis");
      expect(databaseRouteNames).toContain("couchdb");
      expect(databaseRouteNames).toContain("elasticsearch");
      expect(databaseRouteNames).toContain("mysql");
      expect(databaseRouteNames).toContain("saphana");
      expect(databaseRouteNames).toContain("snowflake");
      expect(databaseRouteNames).toContain("zookeeper");
      expect(databaseRouteNames).toContain("cassandra");
      expect(databaseRouteNames).toContain("aerospike");
      expect(databaseRouteNames).toContain("dynamodb");
      expect(databaseRouteNames).toContain("databricks");
    });

    it("should have proper SQL Server route configuration", () => {
      const routes = useIngestionRoutes();
      const databasesRoute = routes[0].children.find((child: any) => child.name === "databases");
      const sqlServerRoute = databasesRoute.children.find((child: any) => child.name === "sqlserver");
      
      expect(sqlServerRoute).toBeDefined();
      expect(sqlServerRoute.path).toBe("sqlserver");
      expect(sqlServerRoute.component).toBeDefined();
      expect(typeof sqlServerRoute.beforeEnter).toBe("function");
    });
  });

  describe("security routes configuration", () => {
    it("should have proper security route configuration", () => {
      const routes = useIngestionRoutes();
      const securityRoute = routes[0].children.find((child: any) => child.name === "security");
      
      expect(securityRoute).toBeDefined();
      expect(securityRoute.path).toBe("security");
      expect(securityRoute.component).toBeDefined();
      expect(typeof securityRoute.beforeEnter).toBe("function");
      expect(Array.isArray(securityRoute.children)).toBe(true);
    });

    it("should have all security ingestion routes", () => {
      const routes = useIngestionRoutes();
      const securityRoute = routes[0].children.find((child: any) => child.name === "security");
      const securityRouteNames = securityRoute.children.map((child: any) => child.name);
      
      expect(securityRouteNames).toContain("falco");
      expect(securityRouteNames).toContain("osquery");
      expect(securityRouteNames).toContain("okta");
      expect(securityRouteNames).toContain("jumpcloud");
      expect(securityRouteNames).toContain("openvpn");
      expect(securityRouteNames).toContain("office365");
      expect(securityRouteNames).toContain("google-workspace");
    });

    it("should have proper security tool routes", () => {
      const routes = useIngestionRoutes();
      const securityRoute = routes[0].children.find((child: any) => child.name === "security");
      
      const falcoRoute = securityRoute.children.find((child: any) => child.name === "falco");
      const oktaRoute = securityRoute.children.find((child: any) => child.name === "okta");
      
      expect(falcoRoute.path).toBe("falco");
      expect(oktaRoute.path).toBe("okta");
    });
  });

  describe("devops routes configuration", () => {
    it("should have proper devops route configuration", () => {
      const routes = useIngestionRoutes();
      const devopsRoute = routes[0].children.find((child: any) => child.name === "devops");
      
      expect(devopsRoute).toBeDefined();
      expect(devopsRoute.path).toBe("devops");
      expect(devopsRoute.component).toBeDefined();
      expect(typeof devopsRoute.beforeEnter).toBe("function");
      expect(Array.isArray(devopsRoute.children)).toBe(true);
    });

    it("should have all devops ingestion routes", () => {
      const routes = useIngestionRoutes();
      const devopsRoute = routes[0].children.find((child: any) => child.name === "devops");
      const devopsRouteNames = devopsRoute.children.map((child: any) => child.name);
      
      expect(devopsRouteNames).toContain("jenkins");
      expect(devopsRouteNames).toContain("ansible");
      expect(devopsRouteNames).toContain("terraform");
      expect(devopsRouteNames).toContain("github-actions");
    });

    it("should have proper devops tool routes", () => {
      const routes = useIngestionRoutes();
      const devopsRoute = routes[0].children.find((child: any) => child.name === "devops");
      
      const jenkinsRoute = devopsRoute.children.find((child: any) => child.name === "jenkins");
      const terraformRoute = devopsRoute.children.find((child: any) => child.name === "terraform");
      
      expect(jenkinsRoute.path).toBe("jenkins");
      expect(terraformRoute.path).toBe("terraform");
    });
  });

  describe("networking routes configuration", () => {
    it("should have proper networking route configuration", () => {
      const routes = useIngestionRoutes();
      const networkingRoute = routes[0].children.find((child: any) => child.name === "networking");
      
      expect(networkingRoute).toBeDefined();
      expect(networkingRoute.path).toBe("networking");
      expect(networkingRoute.component).toBeDefined();
      expect(typeof networkingRoute.beforeEnter).toBe("function");
      expect(Array.isArray(networkingRoute.children)).toBe(true);
    });

    it("should have netflow route", () => {
      const routes = useIngestionRoutes();
      const networkingRoute = routes[0].children.find((child: any) => child.name === "networking");
      const netflowRoute = networkingRoute.children.find((child: any) => child.name === "netflow");
      
      expect(netflowRoute).toBeDefined();
      expect(netflowRoute.path).toBe("netflow");
      expect(netflowRoute.component).toBeDefined();
      expect(typeof netflowRoute.beforeEnter).toBe("function");
    });
  });

  describe("server routes configuration", () => {
    it("should have proper servers route configuration", () => {
      const routes = useIngestionRoutes();
      const serversRoute = routes[0].children.find((child: any) => child.name === "servers");
      
      expect(serversRoute).toBeDefined();
      expect(serversRoute.path).toBe("servers");
      expect(serversRoute.component).toBeDefined();
      expect(typeof serversRoute.beforeEnter).toBe("function");
      expect(Array.isArray(serversRoute.children)).toBe(true);
    });

    it("should have all server ingestion routes", () => {
      const routes = useIngestionRoutes();
      const serversRoute = routes[0].children.find((child: any) => child.name === "servers");
      const serverRouteNames = serversRoute.children.map((child: any) => child.name);
      
      expect(serverRouteNames).toContain("nginx");
      expect(serverRouteNames).toContain("apache");
      expect(serverRouteNames).toContain("iis");
    });

    it("should have proper web server routes", () => {
      const routes = useIngestionRoutes();
      const serversRoute = routes[0].children.find((child: any) => child.name === "servers");
      
      const nginxRoute = serversRoute.children.find((child: any) => child.name === "nginx");
      const apacheRoute = serversRoute.children.find((child: any) => child.name === "apache");
      
      expect(nginxRoute.path).toBe("nginx");
      expect(apacheRoute.path).toBe("apache");
    });
  });

  describe("message queue routes configuration", () => {
    it("should have proper message-queues route configuration", () => {
      const routes = useIngestionRoutes();
      const messageQueuesRoute = routes[0].children.find((child: any) => child.name === "message-queues");
      
      expect(messageQueuesRoute).toBeDefined();
      expect(messageQueuesRoute.path).toBe("message-queues");
      expect(messageQueuesRoute.component).toBeDefined();
      expect(typeof messageQueuesRoute.beforeEnter).toBe("function");
      expect(Array.isArray(messageQueuesRoute.children)).toBe(true);
    });

    it("should have all message queue ingestion routes", () => {
      const routes = useIngestionRoutes();
      const messageQueuesRoute = routes[0].children.find((child: any) => child.name === "message-queues");
      const mqRouteNames = messageQueuesRoute.children.map((child: any) => child.name);
      
      expect(mqRouteNames).toContain("rabbitmq");
      expect(mqRouteNames).toContain("kafka");
      expect(mqRouteNames).toContain("nats");
    });

    it("should have proper message queue system routes", () => {
      const routes = useIngestionRoutes();
      const messageQueuesRoute = routes[0].children.find((child: any) => child.name === "message-queues");
      
      const kafkaRoute = messageQueuesRoute.children.find((child: any) => child.name === "kafka");
      const rabbitmqRoute = messageQueuesRoute.children.find((child: any) => child.name === "rabbitmq");
      
      expect(kafkaRoute.path).toBe("kafka");
      expect(rabbitmqRoute.path).toBe("rabbitmq");
    });
  });

  describe("language routes configuration", () => {
    it("should have proper languages route configuration", () => {
      const routes = useIngestionRoutes();
      const languagesRoute = routes[0].children.find((child: any) => child.name === "languages");
      
      expect(languagesRoute).toBeDefined();
      expect(languagesRoute.path).toBe("languages");
      expect(languagesRoute.component).toBeDefined();
      expect(typeof languagesRoute.beforeEnter).toBe("function");
      expect(Array.isArray(languagesRoute.children)).toBe(true);
    });

    it("should have all programming language routes", () => {
      const routes = useIngestionRoutes();
      const languagesRoute = routes[0].children.find((child: any) => child.name === "languages");
      const languageRouteNames = languagesRoute.children.map((child: any) => child.name);
      
      expect(languageRouteNames).toContain("python");
      expect(languageRouteNames).toContain("dotnettracing");
      expect(languageRouteNames).toContain("dotnetlogs");
      expect(languageRouteNames).toContain("nodejs");
      expect(languageRouteNames).toContain("java");
      expect(languageRouteNames).toContain("go");
      expect(languageRouteNames).toContain("rust");
      expect(languageRouteNames).toContain("fastapi");
    });

    it("should have proper programming language routes configuration", () => {
      const routes = useIngestionRoutes();
      const languagesRoute = routes[0].children.find((child: any) => child.name === "languages");
      
      const pythonRoute = languagesRoute.children.find((child: any) => child.name === "python");
      const javaRoute = languagesRoute.children.find((child: any) => child.name === "java");
      const goRoute = languagesRoute.children.find((child: any) => child.name === "go");
      
      expect(pythonRoute.path).toBe("python");
      expect(javaRoute.path).toBe("java");
      expect(goRoute.path).toBe("go");
    });
  });

  describe("others routes configuration", () => {
    it("should have proper others route configuration", () => {
      const routes = useIngestionRoutes();
      const othersRoute = routes[0].children.find((child: any) => child.name === "others");
      
      expect(othersRoute).toBeDefined();
      expect(othersRoute.path).toBe("others");
      expect(othersRoute.component).toBeDefined();
      expect(typeof othersRoute.beforeEnter).toBe("function");
      expect(Array.isArray(othersRoute.children)).toBe(true);
    });

    it("should have all other tool routes", () => {
      const routes = useIngestionRoutes();
      const othersRoute = routes[0].children.find((child: any) => child.name === "others");
      const otherRouteNames = othersRoute.children.map((child: any) => child.name);
      
      expect(otherRouteNames).toContain("airflow");
      expect(otherRouteNames).toContain("airbyte");
      expect(otherRouteNames).toContain("cribl");
      expect(otherRouteNames).toContain("vercel");
      expect(otherRouteNames).toContain("heroku");
    });

    it("should have proper other tool routes configuration", () => {
      const routes = useIngestionRoutes();
      const othersRoute = routes[0].children.find((child: any) => child.name === "others");
      
      const airflowRoute = othersRoute.children.find((child: any) => child.name === "airflow");
      const vercelRoute = othersRoute.children.find((child: any) => child.name === "vercel");
      
      expect(airflowRoute.path).toBe("airflow");
      expect(vercelRoute.path).toBe("vercel");
    });
  });

  describe("route guards validation", () => {
    it("should have beforeEnter guard on main ingestion route", () => {
      const routes = useIngestionRoutes();
      const mainRoute = routes[0];
      
      expect(typeof mainRoute.beforeEnter).toBe("function");
    });

    it("should have beforeEnter guards on all child routes", () => {
      const routes = useIngestionRoutes();
      const mainRoute = routes[0];
      
      mainRoute.children.forEach((child: any) => {
        expect(typeof child.beforeEnter).toBe("function");
      });
    });

    it("should have beforeEnter guards on nested routes", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      
      customRoute.children.forEach((child: any) => {
        expect(typeof child.beforeEnter).toBe("function");
        
        if (child.children) {
          child.children.forEach((nestedChild: any) => {
            expect(typeof nestedChild.beforeEnter).toBe("function");
          });
        }
      });
    });
  });

  describe("route structure validation", () => {
    it("should have proper route structure with required properties", () => {
      const routes = useIngestionRoutes();
      
      function validateRoute(route: any) {
        expect(route).toHaveProperty("path");
        expect(route).toHaveProperty("name");
        expect(route).toHaveProperty("component");
        expect(route).toHaveProperty("beforeEnter");
        expect(typeof route.path).toBe("string");
        expect(typeof route.name).toBe("string");
        expect(typeof route.beforeEnter).toBe("function");
      }

      routes.forEach((route: any) => {
        validateRoute(route);
        
        if (route.children) {
          route.children.forEach((child: any) => {
            validateRoute(child);
            
            if (child.children) {
              child.children.forEach((nestedChild: any) => {
                validateRoute(nestedChild);
                
                if (nestedChild.children) {
                  nestedChild.children.forEach((deepChild: any) => {
                    validateRoute(deepChild);
                  });
                }
              });
            }
          });
        }
      });
    });

    it("should have unique route names", () => {
      const routes = useIngestionRoutes();
      const routeNames = new Set();
      
      function collectRouteNames(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          expect(routeNames.has(route.name)).toBe(false);
          routeNames.add(route.name);
          
          if (route.children) {
            collectRouteNames(route.children);
          }
        });
      }
      
      collectRouteNames(routes);
    });

    it("should have valid path formats", () => {
      const routes = useIngestionRoutes();
      
      function validatePaths(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          expect(route.path).toBeTruthy();
          expect(typeof route.path).toBe("string");
          
          if (route.children) {
            validatePaths(route.children);
          }
        });
      }
      
      validatePaths(routes);
    });
  });

  describe("component references validation", () => {
    it("should have component references for all routes", () => {
      const routes = useIngestionRoutes();
      
      function validateComponents(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          expect(route.component).toBeDefined();
          
          if (route.children) {
            validateComponents(route.children);
          }
        });
      }
      
      validateComponents(routes);
    });

    it("should have proper component types", () => {
      const routes = useIngestionRoutes();
      
      function validateComponentTypes(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          expect(typeof route.component).toBe("object");
          
          if (route.children) {
            validateComponentTypes(route.children);
          }
        });
      }
      
      validateComponentTypes(routes);
    });
  });

  describe("edge cases and error scenarios", () => {
    it("should handle empty children arrays gracefully", () => {
      const routes = useIngestionRoutes();
      
      function checkEmptyChildren(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          if (route.children) {
            expect(Array.isArray(route.children)).toBe(true);
            
            if (route.children.length > 0) {
              checkEmptyChildren(route.children);
            }
          }
        });
      }
      
      expect(() => checkEmptyChildren(routes)).not.toThrow();
    });

    it("should maintain route hierarchy consistency", () => {
      const routes = useIngestionRoutes();
      const mainRoute = routes[0];
      
      expect(mainRoute.children).toBeDefined();
      expect(mainRoute.children.length).toBeGreaterThan(0);
      
      mainRoute.children.forEach((child: any) => {
        if (child.children) {
          expect(Array.isArray(child.children)).toBe(true);
          
          child.children.forEach((nestedChild: any) => {
            if (nestedChild.children) {
              expect(Array.isArray(nestedChild.children)).toBe(true);
            }
          });
        }
      });
    });

    it("should handle route configuration modifications", () => {
      const routes1 = useIngestionRoutes();
      const routes2 = useIngestionRoutes();
      
      expect(JSON.stringify(routes1)).toEqual(JSON.stringify(routes2));
      
      routes1[0].testProperty = "test";
      expect(routes1[0].testProperty).toBe("test");
      expect(routes2[0].testProperty).toBeUndefined();
    });
  });

  describe("performance and memory considerations", () => {
    it("should not create excessive route nesting", () => {
      const routes = useIngestionRoutes();
      
      function checkNestingDepth(routeArray: any[], depth = 0): number {
        let maxDepth = depth;
        
        routeArray.forEach((route: any) => {
          if (route.children) {
            const childDepth = checkNestingDepth(route.children, depth + 1);
            maxDepth = Math.max(maxDepth, childDepth);
          }
        });
        
        return maxDepth;
      }
      
      const maxDepth = checkNestingDepth(routes);
      expect(maxDepth).toBeLessThan(5);
    });

    it("should have reasonable number of routes per level", () => {
      const routes = useIngestionRoutes();
      const mainRoute = routes[0];
      
      expect(mainRoute.children.length).toBeLessThan(15);
      
      mainRoute.children.forEach((child: any) => {
        if (child.children) {
          expect(child.children.length).toBeLessThan(20);
        }
      });
    });
  });

  describe("route accessibility and navigation", () => {
    it("should have consistent naming conventions", () => {
      const routes = useIngestionRoutes();
      
      function checkNamingConventions(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          expect(route.name).toMatch(/^[a-zA-Z][a-zA-Z0-9-_]*$/);
          expect(route.path).toMatch(/^[a-zA-Z][a-zA-Z0-9-_]*$/);
          
          if (route.children) {
            checkNamingConventions(route.children);
          }
        });
      }
      
      checkNamingConventions(routes);
    });

    it("should have proper path-name alignment", () => {
      const routes = useIngestionRoutes();
      
      function checkPathNameAlignment(routeArray: any[]) {
        routeArray.forEach((route: any) => {
          if (route.path !== "ingestion") {
            expect(route.path.toLowerCase()).toBeTruthy();
            expect(route.name.toLowerCase()).toBeTruthy();
          }
          
          if (route.children) {
            checkPathNameAlignment(route.children);
          }
        });
      }
      
      checkPathNameAlignment(routes);
    });
  });

  describe("specific route validation tests", () => {
    it("should have curl route with correct configuration", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const logsRoute = customRoute.children.find((child: any) => child.name === "ingestLogs");
      const curlRoute = logsRoute.children.find((child: any) => child.name === "curl");
      
      expect(curlRoute).toBeDefined();
      expect(curlRoute.path).toBe("curl");
      expect(curlRoute.component).toBeDefined();
      expect(typeof curlRoute.beforeEnter).toBe("function");
    });

    it("should have fluentbit route with correct configuration", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const logsRoute = customRoute.children.find((child: any) => child.name === "ingestLogs");
      const fluentbitRoute = logsRoute.children.find((child: any) => child.name === "fluentbit");
      
      expect(fluentbitRoute).toBeDefined();
      expect(fluentbitRoute.path).toBe("fluentbit");
      expect(fluentbitRoute.component).toBeDefined();
      expect(typeof fluentbitRoute.beforeEnter).toBe("function");
    });

    it("should have prometheus route with correct configuration", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const metricsRoute = customRoute.children.find((child: any) => child.name === "ingestMetrics");
      const prometheusRoute = metricsRoute.children.find((child: any) => child.name === "prometheus");
      
      expect(prometheusRoute).toBeDefined();
      expect(prometheusRoute.path).toBe("prometheus");
      expect(prometheusRoute.component).toBeDefined();
      expect(typeof prometheusRoute.beforeEnter).toBe("function");
    });

    it("should have OpenTelemetry trace route with correct configuration", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const tracesRoute = customRoute.children.find((child: any) => child.name === "ingestTraces");
      const otlpRoute = tracesRoute.children.find((child: any) => child.name === "tracesOTLP");
      
      expect(otlpRoute).toBeDefined();
      expect(otlpRoute.path).toBe("opentelemetry");
      expect(otlpRoute.component).toBeDefined();
      expect(typeof otlpRoute.beforeEnter).toBe("function");
    });

    it("should have AWS config route with correct configuration", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      const awsRoute = recommendedRoute.children.find((child: any) => child.name === "AWSConfig");
      
      expect(awsRoute).toBeDefined();
      expect(awsRoute.path).toBe("aws");
      expect(awsRoute.component).toBeDefined();
      expect(typeof awsRoute.beforeEnter).toBe("function");
    });

    it("should have frontend monitoring route with correct configuration", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      const rumRoute = recommendedRoute.children.find((child: any) => child.name === "frontendMonitoring");
      
      expect(rumRoute).toBeDefined();
      expect(rumRoute.path).toBe("frontend-monitoring");
      expect(rumRoute.component).toBeDefined();
      expect(typeof rumRoute.beforeEnter).toBe("function");
    });
  });

  describe("route configuration completeness", () => {
    it("should have complete database routes coverage", () => {
      const routes = useIngestionRoutes();
      const databasesRoute = routes[0].children.find((child: any) => child.name === "databases");
      const expectedDatabases = [
        "sqlserver", "postgres", "mongodb", "redis", "couchdb", 
        "elasticsearch", "mysql", "saphana", "snowflake", "zookeeper", 
        "cassandra", "aerospike", "dynamodb", "databricks"
      ];
      
      const actualDatabases = databasesRoute.children.map((child: any) => child.name);
      expectedDatabases.forEach(db => {
        expect(actualDatabases).toContain(db);
      });
    });

    it("should have complete security routes coverage", () => {
      const routes = useIngestionRoutes();
      const securityRoute = routes[0].children.find((child: any) => child.name === "security");
      const expectedSecurity = [
        "falco", "osquery", "okta", "jumpcloud", "openvpn", "office365", "google-workspace"
      ];
      
      const actualSecurity = securityRoute.children.map((child: any) => child.name);
      expectedSecurity.forEach(security => {
        expect(actualSecurity).toContain(security);
      });
    });

    it("should have complete language routes coverage", () => {
      const routes = useIngestionRoutes();
      const languagesRoute = routes[0].children.find((child: any) => child.name === "languages");
      const expectedLanguages = [
        "python", "dotnettracing", "dotnetlogs", "nodejs", "java", "go", "rust", "fastapi"
      ];
      
      const actualLanguages = languagesRoute.children.map((child: any) => child.name);
      expectedLanguages.forEach(lang => {
        expect(actualLanguages).toContain(lang);
      });
    });
  });

  describe("route hierarchy depth validation", () => {
    it("should have proper nesting for log routes", () => {
      const routes = useIngestionRoutes();
      const customRoute = routes[0].children.find((child: any) => child.name === "custom");
      const logsRoute = customRoute.children.find((child: any) => child.name === "ingestLogs");
      
      expect(routes.length).toBe(1);
      expect(routes[0].children.length).toBeGreaterThan(0);
      expect(customRoute.children.length).toBeGreaterThan(0);
      expect(logsRoute.children.length).toBeGreaterThan(0);
    });

    it("should have proper nesting for recommended routes", () => {
      const routes = useIngestionRoutes();
      const recommendedRoute = routes[0].children.find((child: any) => child.name === "recommended");
      
      expect(recommendedRoute.children.length).toBeGreaterThan(0);
      expect(recommendedRoute.children.every((child: any) => !child.children)).toBe(true);
    });

    it("should have proper nesting for database routes", () => {
      const routes = useIngestionRoutes();
      const databasesRoute = routes[0].children.find((child: any) => child.name === "databases");
      
      expect(databasesRoute.children.length).toBeGreaterThan(0);
      expect(databasesRoute.children.every((child: any) => !child.children)).toBe(true);
    });
  });
});