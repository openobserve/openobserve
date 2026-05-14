// Copyright 2026 OpenObserve Inc.
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

import { describe, it, expect } from "vitest";
import { resolveTab, ROUTE_TAB_MAPS } from "@/utils/routeTabMaps";

// ---------------------------------------------------------------------------
// resolveTab()
// ---------------------------------------------------------------------------

describe("resolveTab", () => {
  // --- known section / known route -------------------------------------------
  describe("returns the mapped tab value when section and route are known", () => {
    it("databases – sqlserver", () => {
      expect(resolveTab("databases", "sqlserver", "sqlserver")).toBe(
        "sqlserver"
      );
    });

    it("databases – postgres", () => {
      expect(resolveTab("databases", "postgres", "sqlserver")).toBe("postgres");
    });

    it("databases – mongodb", () => {
      expect(resolveTab("databases", "mongodb", "sqlserver")).toBe("mongodb");
    });

    it("databases – redis", () => {
      expect(resolveTab("databases", "redis", "sqlserver")).toBe("redis");
    });

    it("databases – mysql", () => {
      expect(resolveTab("databases", "mysql", "sqlserver")).toBe("mysql");
    });

    it("databases – oracle", () => {
      expect(resolveTab("databases", "oracle", "sqlserver")).toBe("oracle");
    });

    it("databases – snowflake", () => {
      expect(resolveTab("databases", "snowflake", "sqlserver")).toBe(
        "snowflake"
      );
    });

    it("databases – zookeeper", () => {
      expect(resolveTab("databases", "zookeeper", "sqlserver")).toBe(
        "zookeeper"
      );
    });

    it("databases – cassandra", () => {
      expect(resolveTab("databases", "cassandra", "sqlserver")).toBe(
        "cassandra"
      );
    });

    it("databases – aerospike", () => {
      expect(resolveTab("databases", "aerospike", "sqlserver")).toBe(
        "aerospike"
      );
    });

    it("databases – dynamodb", () => {
      expect(resolveTab("databases", "dynamodb", "sqlserver")).toBe("dynamodb");
    });

    it("databases – databricks", () => {
      expect(resolveTab("databases", "databricks", "sqlserver")).toBe(
        "databricks"
      );
    });

    it("devops – jenkins", () => {
      expect(resolveTab("devops", "jenkins", "jenkins")).toBe("jenkins");
    });

    it("devops – ansible", () => {
      expect(resolveTab("devops", "ansible", "jenkins")).toBe("ansible");
    });

    it("devops – terraform", () => {
      expect(resolveTab("devops", "terraform", "jenkins")).toBe("terraform");
    });

    it("devops – github-actions", () => {
      expect(resolveTab("devops", "github-actions", "jenkins")).toBe(
        "github-actions"
      );
    });

    it("languages – python", () => {
      expect(resolveTab("languages", "python", "python")).toBe("python");
    });

    it("languages – dotnettracing", () => {
      expect(resolveTab("languages", "dotnettracing", "python")).toBe(
        "dotnettracing"
      );
    });

    it("languages – dotnetlogs", () => {
      expect(resolveTab("languages", "dotnetlogs", "python")).toBe(
        "dotnetlogs"
      );
    });

    it("languages – nodejs", () => {
      expect(resolveTab("languages", "nodejs", "python")).toBe("nodejs");
    });

    it("languages – go", () => {
      expect(resolveTab("languages", "go", "python")).toBe("go");
    });

    it("message-queues – rabbitmq", () => {
      expect(resolveTab("message-queues", "rabbitmq", "rabbitmq")).toBe(
        "rabbitmq"
      );
    });

    it("message-queues – kafka", () => {
      expect(resolveTab("message-queues", "kafka", "rabbitmq")).toBe("kafka");
    });

    it("message-queues – nats", () => {
      expect(resolveTab("message-queues", "nats", "rabbitmq")).toBe("nats");
    });

    it("networking – netflow", () => {
      expect(resolveTab("networking", "netflow", "netflow")).toBe("netflow");
    });

    it("others – airflow", () => {
      expect(resolveTab("others", "airflow", "airflow")).toBe("airflow");
    });

    it("others – cribl", () => {
      expect(resolveTab("others", "cribl", "airflow")).toBe("cribl");
    });

    it("others – vercel", () => {
      expect(resolveTab("others", "vercel", "airflow")).toBe("vercel");
    });

    it("others – heroku", () => {
      expect(resolveTab("others", "heroku", "airflow")).toBe("heroku");
    });

    it("recommended – ingestFromKubernetes", () => {
      expect(
        resolveTab(
          "recommended",
          "ingestFromKubernetes",
          "ingestFromKubernetes"
        )
      ).toBe("ingestFromKubernetes");
    });

    it("recommended – ingestFromWindows", () => {
      expect(
        resolveTab("recommended", "ingestFromWindows", "ingestFromKubernetes")
      ).toBe("ingestFromWindows");
    });

    it("recommended – ingestFromLinux", () => {
      expect(
        resolveTab("recommended", "ingestFromLinux", "ingestFromKubernetes")
      ).toBe("ingestFromLinux");
    });

    it("recommended – AWSConfig", () => {
      expect(
        resolveTab("recommended", "AWSConfig", "ingestFromKubernetes")
      ).toBe("AWSConfig");
    });

    it("recommended – GCPConfig", () => {
      expect(
        resolveTab("recommended", "GCPConfig", "ingestFromKubernetes")
      ).toBe("GCPConfig");
    });

    it("recommended – AzureConfig", () => {
      expect(
        resolveTab("recommended", "AzureConfig", "ingestFromKubernetes")
      ).toBe("AzureConfig");
    });

    it("recommended – ingestFromTraces", () => {
      expect(
        resolveTab("recommended", "ingestFromTraces", "ingestFromKubernetes")
      ).toBe("ingestFromTraces");
    });

    it("recommended – frontendMonitoring", () => {
      expect(
        resolveTab(
          "recommended",
          "frontendMonitoring",
          "ingestFromKubernetes"
        )
      ).toBe("frontendMonitoring");
    });

    it("security – falco", () => {
      expect(resolveTab("security", "falco", "falco")).toBe("falco");
    });

    it("security – osquery", () => {
      expect(resolveTab("security", "osquery", "falco")).toBe("osquery");
    });

    it("security – okta", () => {
      expect(resolveTab("security", "okta", "falco")).toBe("okta");
    });

    it("security – jumpcloud", () => {
      expect(resolveTab("security", "jumpcloud", "falco")).toBe("jumpcloud");
    });

    it("security – openvpn", () => {
      expect(resolveTab("security", "openvpn", "falco")).toBe("openvpn");
    });

    it("security – office365", () => {
      expect(resolveTab("security", "office365", "falco")).toBe("office365");
    });

    it("security – google-workspace", () => {
      expect(resolveTab("security", "google-workspace", "falco")).toBe(
        "google-workspace"
      );
    });

    it("servers – nginx", () => {
      expect(resolveTab("servers", "nginx", "nginx")).toBe("nginx");
    });

    it("servers – iis", () => {
      expect(resolveTab("servers", "iis", "nginx")).toBe("iis");
    });

    it("ingestMetrics – prometheus", () => {
      expect(resolveTab("ingestMetrics", "prometheus", "prometheus")).toBe(
        "prometheus"
      );
    });

    it("ingestMetrics – otelCollector", () => {
      expect(resolveTab("ingestMetrics", "otelCollector", "prometheus")).toBe(
        "otelCollector"
      );
    });

    it("ingestMetrics – telegraf", () => {
      expect(resolveTab("ingestMetrics", "telegraf", "prometheus")).toBe(
        "telegraf"
      );
    });

    it("ingestMetrics – cloudwatchMetrics", () => {
      expect(
        resolveTab("ingestMetrics", "cloudwatchMetrics", "prometheus")
      ).toBe("cloudwatchMetrics");
    });

    it("ingestLogs – curl", () => {
      expect(resolveTab("ingestLogs", "curl", "curl")).toBe("curl");
    });

    it("ingestLogs – filebeat", () => {
      expect(resolveTab("ingestLogs", "filebeat", "curl")).toBe("filebeat");
    });

    it("ingestLogs – fluentbit", () => {
      expect(resolveTab("ingestLogs", "fluentbit", "curl")).toBe("fluentbit");
    });

    it("ingestLogs – fluentd", () => {
      expect(resolveTab("ingestLogs", "fluentd", "curl")).toBe("fluentd");
    });

    it("ingestLogs – vector", () => {
      expect(resolveTab("ingestLogs", "vector", "curl")).toBe("vector");
    });

    it("ingestLogs – ingestLogsFromOtel", () => {
      expect(resolveTab("ingestLogs", "ingestLogsFromOtel", "curl")).toBe(
        "ingestLogsFromOtel"
      );
    });

    it("ingestLogs – logstash", () => {
      expect(resolveTab("ingestLogs", "logstash", "curl")).toBe("logstash");
    });

    it("ingestLogs – syslogNg", () => {
      expect(resolveTab("ingestLogs", "syslogNg", "curl")).toBe("syslogNg");
    });

    it("billings – usage", () => {
      expect(resolveTab("billings", "usage", "usage")).toBe("usage");
    });

    it("billings – plans", () => {
      expect(resolveTab("billings", "plans", "usage")).toBe("plans");
    });

    it("billings – invoice_history", () => {
      expect(resolveTab("billings", "invoice_history", "usage")).toBe(
        "invoice_history"
      );
    });

    it("iam – users", () => {
      expect(resolveTab("iam", "users", "users")).toBe("users");
    });

    it("iam – serviceAccounts", () => {
      expect(resolveTab("iam", "serviceAccounts", "users")).toBe(
        "serviceAccounts"
      );
    });

    it("iam – groups", () => {
      expect(resolveTab("iam", "groups", "users")).toBe("groups");
    });

    it("iam – roles", () => {
      expect(resolveTab("iam", "roles", "users")).toBe("roles");
    });

    it("iam – quota", () => {
      expect(resolveTab("iam", "quota", "users")).toBe("quota");
    });

    it("iam – organizations", () => {
      expect(resolveTab("iam", "organizations", "users")).toBe("organizations");
    });

    it("iam – invitations", () => {
      expect(resolveTab("iam", "invitations", "users")).toBe("invitations");
    });
  });

  // --- unknown route → fallback ----------------------------------------------
  describe("returns the fallback when the route is not in the map", () => {
    it("unknown child route under databases falls back to sqlserver", () => {
      expect(resolveTab("databases", "someNewRoute", "sqlserver")).toBe(
        "sqlserver"
      );
    });

    it("parent route name itself is not in the map → falls back", () => {
      // e.g. navigating to the parent "databases" route before a child is selected
      expect(resolveTab("databases", "databases", "sqlserver")).toBe(
        "sqlserver"
      );
    });

    it("unknown child under ingestLogs falls back to curl", () => {
      expect(resolveTab("ingestLogs", "unknownLogSource", "curl")).toBe("curl");
    });

    it("unknown child under security falls back to falco", () => {
      expect(resolveTab("security", "newTool", "falco")).toBe("falco");
    });

    it("unknown child under iam falls back to users", () => {
      expect(resolveTab("iam", "someNewIamRoute", "users")).toBe("users");
    });

    it("custom fallback is respected", () => {
      expect(resolveTab("servers", "unknownServer", "customFallback")).toBe(
        "customFallback"
      );
    });
  });

  // --- null / undefined routeName -------------------------------------------
  describe("returns the fallback for null or undefined routeName", () => {
    it("null routeName", () => {
      expect(resolveTab("databases", null, "sqlserver")).toBe("sqlserver");
    });

    it("undefined routeName", () => {
      expect(resolveTab("databases", undefined, "sqlserver")).toBe("sqlserver");
    });

    it("empty-string routeName", () => {
      expect(resolveTab("databases", "", "sqlserver")).toBe("sqlserver");
    });
  });

  // --- unknown section -------------------------------------------------------
  describe("returns the fallback when the section is not in ROUTE_TAB_MAPS", () => {
    it("completely unknown section", () => {
      expect(
        resolveTab("nonExistentSection" as any, "someRoute", "myFallback")
      ).toBe("myFallback");
    });
  });
});

// ---------------------------------------------------------------------------
// ROUTE_TAB_MAPS – structural integrity
// ---------------------------------------------------------------------------

describe("ROUTE_TAB_MAPS", () => {
  it("is exported and is an object", () => {
    expect(ROUTE_TAB_MAPS).toBeDefined();
    expect(typeof ROUTE_TAB_MAPS).toBe("object");
  });

  const expectedSections = [
    "databases",
    "devops",
    "languages",
    "message-queues",
    "networking",
    "others",
    "recommended",
    "security",
    "servers",
    "ingestMetrics",
    "ingestLogs",
    "billings",
    "iam",
  ];

  it.each(expectedSections)(
    "contains the '%s' section",
    (section) => {
      expect(ROUTE_TAB_MAPS[section]).toBeDefined();
      expect(typeof ROUTE_TAB_MAPS[section]).toBe("object");
    }
  );

  it("every section has at least one entry", () => {
    for (const section of Object.keys(ROUTE_TAB_MAPS)) {
      expect(
        Object.keys(ROUTE_TAB_MAPS[section]).length,
        `Section '${section}' should have at least one entry`
      ).toBeGreaterThan(0);
    }
  });

  it("all map values are non-empty strings", () => {
    for (const [section, map] of Object.entries(ROUTE_TAB_MAPS)) {
      for (const [route, tab] of Object.entries(map)) {
        expect(
          typeof tab,
          `${section}.${route} should be a string`
        ).toBe("string");
        expect(
          tab.length,
          `${section}.${route} tab value should not be empty`
        ).toBeGreaterThan(0);
      }
    }
  });

  describe("section-level spot checks", () => {
    it("databases has all 12 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.databases)).toHaveLength(12);
    });

    it("devops has all 4 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.devops)).toHaveLength(4);
    });

    it("languages has all 5 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.languages)).toHaveLength(5);
    });

    it("message-queues has all 3 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS["message-queues"])).toHaveLength(3);
    });

    it("networking has 1 entry", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.networking)).toHaveLength(1);
    });

    it("others has 4 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.others)).toHaveLength(4);
    });

    it("recommended has 8 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.recommended)).toHaveLength(8);
    });

    it("security has 7 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.security)).toHaveLength(7);
    });

    it("servers has 2 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.servers)).toHaveLength(2);
    });

    it("ingestMetrics has 4 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.ingestMetrics)).toHaveLength(4);
    });

    it("ingestLogs has 8 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.ingestLogs)).toHaveLength(8);
    });

    it("billings has 3 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.billings)).toHaveLength(3);
    });

    it("iam has 7 entries", () => {
      expect(Object.keys(ROUTE_TAB_MAPS.iam)).toHaveLength(7);
    });
  });
});
