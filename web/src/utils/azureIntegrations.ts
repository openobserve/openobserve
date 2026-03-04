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

export interface AzureIntegration {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  description: string;
  hasDashboard: boolean;
  dashboardFolderId?: string;
  dashboardGithubUrl?: string;
  documentationUrl?: string;
  category: 'logs' | 'metrics' | 'security' | 'networking' | 'compute' | 'storage' | 'other';
}

export const azureIntegrations: AzureIntegration[] = [
  {
    id: 'aks',
    name: 'AKS',
    displayName: 'Azure Kubernetes Service',
    icon: '',
    description: 'Collect logs and metrics from Azure Kubernetes Service clusters',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'compute',
  },
  {
    id: 'front-door',
    name: 'Front Door',
    displayName: 'Azure Front Door',
    icon: '',
    description: 'Monitor Azure Front Door access logs and metrics',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'networking',
  },
  {
    id: 'app-service',
    name: 'App Service',
    displayName: 'Azure App Service',
    icon: '',
    description: 'Collect logs from Azure App Service applications',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'compute',
  },
  {
    id: 'sql-database',
    name: 'SQL Database',
    displayName: 'Azure SQL Database',
    icon: '',
    description: 'Monitor Azure SQL Database logs and performance metrics',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'storage',
  },
  {
    id: 'storage-account',
    name: 'Storage Account',
    displayName: 'Azure Storage Account',
    icon: '',
    description: 'Track Azure Storage operations and access logs',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'storage',
  },
  {
    id: 'virtual-machines',
    name: 'Virtual Machines',
    displayName: 'Azure Virtual Machines',
    icon: '',
    description: 'Collect logs and metrics from Azure VMs',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'compute',
  },
  {
    id: 'application-gateway',
    name: 'Application Gateway',
    displayName: 'Azure Application Gateway',
    icon: '',
    description: 'Monitor Application Gateway access logs and performance',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'networking',
  },
  {
    id: 'load-balancer',
    name: 'Load Balancer',
    displayName: 'Azure Load Balancer',
    icon: '',
    description: 'Collect metrics and logs from Azure Load Balancer',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'networking',
  },
  {
    id: 'network-security-group',
    name: 'Network Security Group',
    displayName: 'Network Security Group',
    icon: '',
    description: 'Monitor NSG flow logs and security events',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'security',
  },
  {
    id: 'key-vault',
    name: 'Key Vault',
    displayName: 'Azure Key Vault',
    icon: '',
    description: 'Track Key Vault access and audit logs',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'security',
  },
  {
    id: 'active-directory',
    name: 'Active Directory',
    displayName: 'Azure Active Directory',
    icon: '',
    description: 'Monitor AAD sign-in and audit logs',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'security',
  },
  {
    id: 'cosmos-db',
    name: 'Cosmos DB',
    displayName: 'Azure Cosmos DB',
    icon: '',
    description: 'Collect Cosmos DB operation logs and metrics',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'storage',
  },
  {
    id: 'functions',
    name: 'Functions',
    displayName: 'Azure Functions',
    icon: '',
    description: 'Monitor Azure Functions execution logs',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'compute',
  },
  {
    id: 'api-management',
    name: 'API Management',
    displayName: 'Azure API Management',
    icon: '',
    description: 'Track API Management gateway logs',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'other',
  },
  {
    id: 'container-instances',
    name: 'Container Instances',
    displayName: 'Azure Container Instances',
    icon: '',
    description: 'Collect logs from Azure Container Instances',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'compute',
  },
  {
    id: 'virtual-network',
    name: 'Virtual Network',
    displayName: 'Azure Virtual Network',
    icon: '',
    description: 'Monitor Virtual Network flow logs and diagnostics',
    hasDashboard: false,
    documentationUrl: 'https://github.com/openobserve/azure-function-openobserve',
    category: 'networking',
  },
];

/**
 * Generate dashboard URL for the current environment
 */
export const generateAzureDashboardURL = (
  integration: AzureIntegration,
  organizationId: string,
  baseURL: string,
): string => {
  if (!integration.hasDashboard) {
    return '';
  }

  // For now, just go to dashboards page
  // In the future, can link to specific dashboard when dashboardFolderId is used
  return `${baseURL}/web/dashboards?org_identifier=${organizationId}`;
};
