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

/**
 * Comprehensive search index for all ingestion options
 * This allows global search across all tabs and their sub-items
 */

export interface SearchableItem {
  name: string; // Route name
  label: string; // Display name
  keywords: string[]; // Searchable keywords
  parentTab: string; // Parent tab route name
}

export const ingestionSearchIndex: SearchableItem[] = [
  // Recommended sub-tabs
  { name: 'ingestFromKubernetes', label: 'Kubernetes', keywords: ['kubernetes', 'k8s', 'kubectl', 'helm'], parentTab: 'recommended' },
  { name: 'ingestFromWindows', label: 'Windows', keywords: ['windows', 'win'], parentTab: 'recommended' },
  { name: 'ingestFromLinux', label: 'Linux', keywords: ['linux', 'unix'], parentTab: 'recommended' },
  { name: 'AWSConfig', label: 'AWS', keywords: ['aws', 'amazon'], parentTab: 'recommended' },
  { name: 'GCPConfig', label: 'GCP', keywords: ['gcp', 'google', 'cloud'], parentTab: 'recommended' },
  { name: 'AzureConfig', label: 'Azure', keywords: ['azure', 'microsoft'], parentTab: 'recommended' },
  { name: 'ingestFromTraces', label: 'Traces', keywords: ['traces', 'otlp', 'opentelemetry'], parentTab: 'recommended' },
  { name: 'frontendMonitoring', label: 'RUM', keywords: ['rum', 'frontend', 'monitoring', 'browser'], parentTab: 'recommended' },

  // Server sub-tabs
  { name: 'nginx', label: 'Nginx', keywords: ['nginx', 'web server'], parentTab: 'servers' },
  { name: 'iis', label: 'IIS', keywords: ['iis', 'microsoft', 'windows server'], parentTab: 'servers' },

  // Database sub-tabs
  { name: 'sqlserver', label: 'SQL Server', keywords: ['sqlserver', 'mssql', 'microsoft sql'], parentTab: 'databases' },
  { name: 'postgres', label: 'PostgreSQL', keywords: ['postgres', 'postgresql', 'pg'], parentTab: 'databases' },
  { name: 'mongodb', label: 'MongoDB', keywords: ['mongodb', 'mongo', 'nosql'], parentTab: 'databases' },
  { name: 'mysql', label: 'MySQL', keywords: ['mysql'], parentTab: 'databases' },
  { name: 'elasticsearch', label: 'Elasticsearch', keywords: ['elasticsearch', 'elastic', 'es'], parentTab: 'databases' },

  // Security sub-tabs
  { name: 'auth0', label: 'Auth0', keywords: ['auth0', 'authentication'], parentTab: 'security' },
  { name: 'cloudflare', label: 'Cloudflare', keywords: ['cloudflare', 'cdn'], parentTab: 'security' },
  { name: 'okta', label: 'Okta', keywords: ['okta', 'identity'], parentTab: 'security' },

  // DevOps sub-tabs
  { name: 'jenkins', label: 'Jenkins', keywords: ['jenkins', 'ci', 'cd'], parentTab: 'devops' },
  { name: 'gitlab', label: 'GitLab', keywords: ['gitlab', 'git'], parentTab: 'devops' },
  { name: 'github', label: 'GitHub', keywords: ['github', 'git'], parentTab: 'devops' },
  { name: 'circleci', label: 'CircleCI', keywords: ['circleci', 'ci'], parentTab: 'devops' },
  { name: 'ansible', label: 'Ansible', keywords: ['ansible', 'automation'], parentTab: 'devops' },
  { name: 'terraform', label: 'Terraform', keywords: ['terraform', 'infrastructure'], parentTab: 'devops' },

  // Networking sub-tabs
  { name: 'paloalto', label: 'Palo Alto', keywords: ['paloalto', 'firewall'], parentTab: 'networking' },
  { name: 'cisco', label: 'Cisco', keywords: ['cisco', 'router'], parentTab: 'networking' },
  { name: 'fortinet', label: 'Fortinet', keywords: ['fortinet', 'firewall'], parentTab: 'networking' },

  // Message Queues sub-tabs
  { name: 'kafka', label: 'Kafka', keywords: ['kafka', 'streaming'], parentTab: 'message-queues' },
  { name: 'rabbitmq', label: 'RabbitMQ', keywords: ['rabbitmq', 'rabbit', 'amqp'], parentTab: 'message-queues' },
  { name: 'redis', label: 'Redis', keywords: ['redis', 'cache'], parentTab: 'message-queues' },

  // Languages sub-tabs
  { name: 'python', label: 'Python', keywords: ['python', 'py'], parentTab: 'languages' },
  { name: 'nodejs', label: 'Node.js', keywords: ['nodejs', 'node', 'javascript', 'js'], parentTab: 'languages' },
  { name: 'java', label: 'Java', keywords: ['java'], parentTab: 'languages' },
  { name: 'dotnet', label: '.NET', keywords: ['dotnet', '.net', 'csharp', 'c#'], parentTab: 'languages' },
  { name: 'go', label: 'Go', keywords: ['go', 'golang'], parentTab: 'languages' },
  { name: 'rust', label: 'Rust', keywords: ['rust'], parentTab: 'languages' },
  { name: 'ruby', label: 'Ruby', keywords: ['ruby', 'rails'], parentTab: 'languages' },
  { name: 'php', label: 'PHP', keywords: ['php'], parentTab: 'languages' },
];

/**
 * Search for items across all ingestion options
 * @param query Search query string
 * @returns Array of matching items with their parent tabs
 */
export function searchIngestionItems(query: string): SearchableItem[] {
  if (!query || query.trim() === '') {
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
