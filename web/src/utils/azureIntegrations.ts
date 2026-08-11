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

import { type I18nKey } from "@/types/i18n";

export interface AzureIntegration {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  descriptionKey: I18nKey;
  armTemplate?: string; // HTTPS URL to ARM template JSON on S3
  hasDashboard: boolean;
  dashboardFolderId?: string;
  dashboardGithubUrl?: string;
  documentationUrl?: string;
  category: "logs" | "metrics" | "security" | "networking" | "compute" | "storage" | "other";
}

export const azureIntegrations: AzureIntegration[] = [
  {
    id: "activity-logs",
    name: "Activity Logs",
    displayName: "Azure Activity Logs",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.activity-logs.description",
    armTemplate:
      "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/azure/activity-logs-to-openobserve.json",
    hasDashboard: false,
    documentationUrl:
      "https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/activity-log",
    category: "logs",
  },
  {
    id: "aks",
    name: "AKS",
    displayName: "Azure Kubernetes Service",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.aks.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "front-door",
    name: "Front Door",
    displayName: "Azure Front Door",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.front-door.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
  {
    id: "app-service",
    name: "App Service",
    displayName: "Azure App Service",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.app-service.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "sql-database",
    name: "SQL Database",
    displayName: "Azure SQL Database",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.sql-database.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "storage",
  },
  {
    id: "storage-account",
    name: "Storage Account",
    displayName: "Azure Storage Account",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.storage-account.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "storage",
  },
  {
    id: "virtual-machines",
    name: "Virtual Machines",
    displayName: "Azure Virtual Machines",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.virtual-machines.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "application-gateway",
    name: "Application Gateway",
    displayName: "Azure Application Gateway",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.application-gateway.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
  {
    id: "load-balancer",
    name: "Load Balancer",
    displayName: "Azure Load Balancer",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.load-balancer.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
  {
    id: "network-security-group",
    name: "Network Security Group",
    displayName: "Network Security Group",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.network-security-group.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "security",
  },
  {
    id: "key-vault",
    name: "Key Vault",
    displayName: "Azure Key Vault",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.key-vault.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "security",
  },
  {
    id: "active-directory",
    name: "Active Directory",
    displayName: "Azure Active Directory",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.active-directory.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "security",
  },
  {
    id: "cosmos-db",
    name: "Cosmos DB",
    displayName: "Azure Cosmos DB",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.cosmos-db.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "storage",
  },
  {
    id: "functions",
    name: "Functions",
    displayName: "Azure Functions",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.functions.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "api-management",
    name: "API Management",
    displayName: "Azure API Management",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.api-management.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "other",
  },
  {
    id: "container-instances",
    name: "Container Instances",
    displayName: "Azure Container Instances",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.container-instances.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "virtual-network",
    name: "Virtual Network",
    displayName: "Azure Virtual Network",
    icon: "",
    descriptionKey: "ingestion.integrations.azure.virtual-network.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
];

/**
 * Generate Azure portal custom deployment URL with pre-filled parameters.
 * Uses the ARM template quick-deploy format:
 * https://portal.azure.com/#create/Microsoft.Template/uri/{encoded-template-url}/parameters/{encoded-params}
 */
export const generateARMTemplateURL = (
  integration: AzureIntegration,
  endpoint: string,
  accessKey: string,
): string => {
  if (!integration.armTemplate) return "";

  const templateUri = encodeURIComponent(integration.armTemplate);
  const parameters = encodeURIComponent(
    JSON.stringify({
      openObserveEndpoint: { value: endpoint },
      openObserveAccessKey: { value: accessKey },
    }),
  );

  return `https://portal.azure.com/#create/Microsoft.Template/uri/${templateUri}/parameters/${parameters}`;
};

/**
 * Generate dashboard URL for the current environment
 */
export const generateAzureDashboardURL = (
  integration: AzureIntegration,
  organizationId: string,
  baseURL: string,
): string => {
  if (!integration.hasDashboard) {
    return "";
  }

  // For now, just go to dashboards page
  // In the future, can link to specific dashboard when dashboardFolderId is used
  return `${baseURL}/web/dashboards?org_identifier=${organizationId}`;
};
