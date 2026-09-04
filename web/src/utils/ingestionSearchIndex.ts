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

/**
 * Comprehensive search index for all ingestion options
 * This allows global search across all tabs and their sub-items
 */

import { raw, type I18nText } from "@/types/i18n";

import { aiCategories } from "@/components/ingestion/ai/data";

export interface SearchableItem {
  name: string; // Route name
  label: I18nText; // Display name
  keywords: string[]; // Searchable keywords
  parentTab: string; // Parent tab route name
}

const aiSearchEntries: SearchableItem[] = aiCategories.flatMap((cat) =>
  cat.integrations.map((integration) => ({
    name: integration.routeName,
    label: raw(integration.name),
    keywords: integration.keywords,
    parentTab: "ai-integrations",
  })),
);

export const ingestionSearchIndex: SearchableItem[] = [
  // Recommended sub-tabs
  {
    name: "ingestFromKubernetes",
    label: raw("Kubernetes"),
    keywords: ["kubernetes", "k8s", "kubectl", "helm"],
    parentTab: "recommended",
  },
  {
    name: "ingestFromWindows",
    label: raw("Windows"),
    keywords: ["windows", "win"],
    parentTab: "recommended",
  },
  {
    name: "ingestFromLinux",
    label: raw("Linux"),
    keywords: ["linux", "unix"],
    parentTab: "recommended",
  },
  {
    name: "ingestFromMacOS",
    label: raw("macOS"),
    keywords: ["macos", "mac", "osx", "darwin", "apple", "unified log"],
    parentTab: "recommended",
  },
  {
    name: "AWSConfig",
    label: raw("AWS"),
    keywords: ["aws", "amazon"],
    parentTab: "recommended",
  },
  {
    name: "GCPConfig",
    label: raw("GCP"),
    keywords: ["gcp", "google", "cloud"],
    parentTab: "recommended",
  },
  {
    name: "AzureConfig",
    label: raw("Azure"),
    keywords: ["azure", "microsoft"],
    parentTab: "recommended",
  },
  {
    name: "ingestFromTraces",
    label: raw("Traces"),
    keywords: ["traces", "otlp", "opentelemetry"],
    parentTab: "recommended",
  },
  {
    name: "frontendMonitoring",
    label: raw("RUM"),
    keywords: [
      "rum",
      "frontend",
      "monitoring",
      "browser",
      "react native",
      "mobile",
      "ios",
      "android",
      "session replay",
    ],
    parentTab: "recommended",
  },

  // Server sub-tabs
  {
    name: "nginx",
    label: raw("Nginx"),
    keywords: ["nginx", "web server"],
    parentTab: "servers",
  },
  {
    name: "iis",
    label: raw("IIS"),
    keywords: ["iis", "microsoft", "windows server"],
    parentTab: "servers",
  },

  // Database sub-tabs
  {
    name: "sqlserver",
    label: raw("SQL Server"),
    keywords: ["sqlserver", "mssql", "microsoft sql"],
    parentTab: "databases",
  },
  {
    name: "postgres",
    label: raw("PostgreSQL"),
    keywords: ["postgres", "postgresql", "pg"],
    parentTab: "databases",
  },
  {
    name: "mongodb",
    label: raw("MongoDB"),
    keywords: ["mongodb", "mongo", "nosql"],
    parentTab: "databases",
  },
  {
    name: "mysql",
    label: raw("MySQL"),
    keywords: ["mysql"],
    parentTab: "databases",
  },
  {
    name: "elasticsearch",
    label: raw("Elasticsearch"),
    keywords: ["elasticsearch", "elastic", "es"],
    parentTab: "databases",
  },

  // Security sub-tabs
  {
    name: "auth0",
    label: raw("Auth0"),
    keywords: ["auth0", "authentication"],
    parentTab: "security",
  },
  {
    name: "cloudflare",
    label: raw("Cloudflare"),
    keywords: ["cloudflare", "cdn"],
    parentTab: "security",
  },
  {
    name: "okta",
    label: raw("Okta"),
    keywords: ["okta", "identity"],
    parentTab: "security",
  },

  // DevOps sub-tabs
  {
    name: "jenkins",
    label: raw("Jenkins"),
    keywords: ["jenkins", "ci", "cd"],
    parentTab: "devops",
  },
  {
    name: "gitlab",
    label: raw("GitLab"),
    keywords: ["gitlab", "git"],
    parentTab: "devops",
  },
  {
    name: "github",
    label: raw("GitHub"),
    keywords: ["github", "git"],
    parentTab: "devops",
  },
  {
    name: "circleci",
    label: raw("CircleCI"),
    keywords: ["circleci", "ci"],
    parentTab: "devops",
  },
  {
    name: "ansible",
    label: raw("Ansible"),
    keywords: ["ansible", "automation"],
    parentTab: "devops",
  },
  {
    name: "terraform",
    label: raw("Terraform"),
    keywords: ["terraform", "infrastructure"],
    parentTab: "devops",
  },

  // Networking sub-tabs
  {
    name: "paloalto",
    label: raw("Palo Alto"),
    keywords: ["paloalto", "firewall"],
    parentTab: "networking",
  },
  {
    name: "cisco",
    label: raw("Cisco"),
    keywords: ["cisco", "router"],
    parentTab: "networking",
  },
  {
    name: "fortinet",
    label: raw("Fortinet"),
    keywords: ["fortinet", "firewall"],
    parentTab: "networking",
  },

  // Message Queues sub-tabs
  {
    name: "kafka",
    label: raw("Kafka"),
    keywords: ["kafka", "streaming"],
    parentTab: "message-queues",
  },
  {
    name: "rabbitmq",
    label: raw("RabbitMQ"),
    keywords: ["rabbitmq", "rabbit", "amqp"],
    parentTab: "message-queues",
  },
  {
    name: "redis",
    label: raw("Redis"),
    keywords: ["redis", "cache"],
    parentTab: "message-queues",
  },

  // Languages sub-tabs
  {
    name: "python",
    label: raw("Python"),
    keywords: ["python", "py"],
    parentTab: "languages",
  },
  {
    name: "nodejs",
    label: raw("Node.js"),
    keywords: ["nodejs", "node", "javascript", "js"],
    parentTab: "languages",
  },
  { name: "java", label: raw("Java"), keywords: ["java"], parentTab: "languages" },
  {
    name: "dotnet",
    label: raw(".NET"),
    keywords: ["dotnet", ".net", "csharp", "c#"],
    parentTab: "languages",
  },
  {
    name: "go",
    label: raw("Go"),
    keywords: ["go", "golang"],
    parentTab: "languages",
  },
  { name: "rust", label: raw("Rust"), keywords: ["rust"], parentTab: "languages" },
  {
    name: "ruby",
    label: raw("Ruby"),
    keywords: ["ruby", "rails"],
    parentTab: "languages",
  },
  { name: "php", label: raw("PHP"), keywords: ["php"], parentTab: "languages" },

  ...aiSearchEntries,
];

/**
 * Search for items across all ingestion options
 * @param query Search query string
 * @returns Array of matching items with their parent tabs
 */
export function searchIngestionItems(query: string): SearchableItem[] {
  if (!query || query.trim() === "") {
    return [];
  }

  const searchTerm = query.toLowerCase().trim();

  return ingestionSearchIndex.filter((item) => {
    // Check if query matches the label
    if (item.label.toLowerCase().includes(searchTerm)) {
      return true;
    }

    // Check if query matches any of the keywords
    return item.keywords.some((keyword) => keyword.toLowerCase().includes(searchTerm));
  });
}
