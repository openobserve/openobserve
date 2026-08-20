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

import { raw, type I18nKey } from "@/types/i18n";

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
    name: raw("Activity Logs"),
    displayName: raw("Azure Activity Logs"),
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
    displayName: raw("Azure Kubernetes Service"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.aks.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "front-door",
    name: raw("Front Door"),
    displayName: raw("Azure Front Door"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.front-door.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
  {
    id: "app-service",
    name: raw("App Service"),
    displayName: raw("Azure App Service"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.app-service.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "sql-database",
    name: raw("SQL Database"),
    displayName: raw("Azure SQL Database"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.sql-database.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "storage",
  },
  {
    id: "storage-account",
    name: raw("Storage Account"),
    displayName: raw("Azure Storage Account"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.storage-account.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "storage",
  },
  {
    id: "virtual-machines",
    name: raw("Virtual Machines"),
    displayName: raw("Azure Virtual Machines"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.virtual-machines.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "application-gateway",
    name: raw("Application Gateway"),
    displayName: raw("Azure Application Gateway"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.application-gateway.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
  {
    id: "load-balancer",
    name: raw("Load Balancer"),
    displayName: raw("Azure Load Balancer"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.load-balancer.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "networking",
  },
  {
    id: "network-security-group",
    name: raw("Network Security Group"),
    displayName: raw("Network Security Group"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.network-security-group.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "security",
  },
  {
    id: "key-vault",
    name: raw("Key Vault"),
    displayName: raw("Azure Key Vault"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.key-vault.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "security",
  },
  {
    id: "active-directory",
    name: raw("Active Directory"),
    displayName: raw("Azure Active Directory"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.active-directory.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "security",
  },
  {
    id: "cosmos-db",
    name: raw("Cosmos DB"),
    displayName: raw("Azure Cosmos DB"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.cosmos-db.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "storage",
  },
  {
    id: "functions",
    name: raw("Functions"),
    displayName: raw("Azure Functions"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.functions.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "api-management",
    name: raw("API Management"),
    displayName: raw("Azure API Management"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.api-management.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "other",
  },
  {
    id: "container-instances",
    name: raw("Container Instances"),
    displayName: raw("Azure Container Instances"),
    icon: "",
    descriptionKey: "ingestion.integrations.azure.container-instances.description",
    hasDashboard: false,
    documentationUrl: "https://github.com/openobserve/azure-function-openobserve",
    category: "compute",
  },
  {
    id: "virtual-network",
    name: raw("Virtual Network"),
    displayName: raw("Azure Virtual Network"),
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
