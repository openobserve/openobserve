<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="azure-quick-setup">
    <div class="setup-card">
      <div class="tw:pb-4">
        <div class="tw:flex tw:items-start tw:gap-4">
          <div class="tw:flex-shrink-0">
            <q-icon name="cloud" size="2.5rem" color="primary" />
          </div>
          <div class="tw:flex-1">
            <h5 class="tw:text-lg tw:font-bold tw:m-0 tw:mb-2 title">
              Azure Function Integration
            </h5>
            <p class="tw:text-sm tw:m-0 tw:mb-4 description">
              Deploy the OpenObserve Azure Function to collect logs from any Azure service through diagnostic settings and Event Hub.
            </p>

            <div class="tw:flex tw:gap-2 tw:mt-4">
              <q-btn
                color="primary"
                unelevated
                @click="handleDeployFunction"
                data-test="azure-quick-setup-deploy-btn"
              >
                <q-icon name="open_in_new" left size="sm" />
                View Setup Guide
              </q-btn>
              <q-btn
                color="primary"
                outline
                @click="handleAddDashboard"
                :loading="addingDashboard"
                data-test="azure-quick-setup-add-dashboard-btn"
              >
                <q-icon name="dashboard" left size="sm" />
                Add Dashboard
              </q-btn>
              <q-btn
                flat
                color="primary"
                @click="showDetails = !showDetails"
                data-test="azure-quick-setup-details-btn"
              >
                <q-icon :name="showDetails ? 'expand_less' : 'expand_more'" left size="sm" />
                {{ showDetails ? 'Hide' : 'View' }} Details
              </q-btn>
            </div>
          </div>
        </div>
      </div>

      <q-slide-transition>
        <div v-show="showDetails">
          <q-separator />
          <q-card-section class="tw:pt-4">
            <div class="tw:text-sm details-section">
              <h6 class="tw:text-base tw:font-semibold tw:m-0 tw:mb-3 details-title">
                Supported Azure Services ({{ includedServices.length }})
              </h6>

              <div class="tw:mb-4">
                <div class="row q-col-gutter-sm">
                  <div
                    v-for="service in includedServices"
                    :key="service.name"
                    class="col-12 col-sm-6"
                  >
                    <div class="service-item tw:p-2 tw:rounded tw:border">
                      <div class="tw:flex tw:items-start tw:gap-2">
                        <q-icon
                          :name="getCategoryIcon(service.category)"
                          size="sm"
                          class="tw:mt-0.5"
                          color="primary"
                        />
                        <div class="tw:flex-1">
                          <div class="tw:font-medium tw:text-sm service-name">
                            {{ service.name }}
                          </div>
                          <div class="tw:text-xs tw:mt-0.5 service-description">
                            {{ service.description }}
                          </div>
                          <div class="tw:text-xs tw:mt-1 service-category">
                            {{ formatCategory(service.category) }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <h6 class="tw:text-base tw:font-semibold tw:m-0 tw:mb-3 details-title">How It Works</h6>

              <div class="tw:mb-3">
                <div class="tw:font-semibold tw:mb-1 detail-label">Architecture:</div>
                <div class="detail-value">
                  Azure Service → Diagnostic Settings → Event Hub → Azure Function → OpenObserve
                </div>
              </div>

              <div class="tw:mb-3">
                <div class="tw:font-semibold tw:mb-1 detail-label">What You Need:</div>
                <ul class="tw:list-disc tw:ml-5 tw:space-y-1 detail-value">
                  <li>Azure subscription with appropriate permissions</li>
                  <li>Event Hub namespace and hub</li>
                  <li>Azure Function App</li>
                  <li>OpenObserve endpoint and credentials</li>
                </ul>
              </div>

              <div class="tw:mb-3">
                <div class="tw:font-semibold tw:mb-1 detail-label">Setup Steps:</div>
                <ol class="tw:list-decimal tw:ml-5 tw:space-y-1 detail-value">
                  <li>Create an Event Hub namespace and hub</li>
                  <li>Deploy the Azure Function from GitHub</li>
                  <li>Configure function with OpenObserve credentials</li>
                  <li>Enable diagnostic settings on Azure services to send logs to Event Hub</li>
                </ol>
              </div>

              <div>
                <div class="tw:font-semibold tw:mb-1 detail-label">Cost Considerations:</div>
                <div class="detail-value">
                  Charges apply for Event Hub throughput, Azure Function execution, and OpenObserve storage.
                  Refer to Azure and OpenObserve pricing for details.
                </div>
              </div>
            </div>
          </q-card-section>
        </div>
      </q-slide-transition>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { azureIntegrations } from "@/utils/azureIntegrations";
import dashboardsService from "@/services/dashboards";
import segment from "@/services/segment_analytics";

export default defineComponent({
  name: "AzureQuickSetup",
  setup() {
    const store = useStore();
    const q = useQuasar();
    const showDetails = ref(false);
    const addingDashboard = ref(false);

    // Get all Azure services
    const includedServices = computed(() => {
      return azureIntegrations
        .map(integration => ({
          name: integration.displayName,
          description: integration.description,
          category: integration.category,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    const getCategoryIcon = (category: string) => {
      const iconMap: Record<string, string> = {
        'logs': 'description',
        'metrics': 'speed',
        'security': 'security',
        'networking': 'network_check',
        'compute': 'computer',
        'storage': 'storage',
        'other': 'settings',
      };
      return iconMap[category] || 'cloud';
    };

    const formatCategory = (category: string) => {
      return category.charAt(0).toUpperCase() + category.slice(1);
    };

    const handleDeployFunction = () => {
      // Track analytics
      segment.track("Azure Function Setup Opened", {
        integration_type: "azure-function",
        services_count: includedServices.value.length,
      });

      // Open GitHub repository in new tab
      window.open('https://github.com/openobserve/azure-function-openobserve', '_blank', 'noopener,noreferrer');
    };

    const handleAddDashboard = async () => {
      try {
        addingDashboard.value = true;

        const dashboardUrl = 'https://raw.githubusercontent.com/openobserve/dashboards/main/Microsoft_O365/Microsoft.dashboard.json';
        const orgId = store.state.selectedOrganization.identifier;

        // Fetch the dashboard JSON
        const response = await fetch(dashboardUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch dashboard: ${response.statusText}`);
        }

        const dashboardData = await response.json();
        const dashboardTitle = dashboardData.title;

        // Get all folders using the API
        const foldersResponse = await dashboardsService.list_Folders(orgId);
        const folders = foldersResponse.data?.list || [];

        // Check if Microsoft folder exists
        let microsoftFolder = folders.find((f: any) => f.name === 'Microsoft');

        if (!microsoftFolder) {
          // Create Microsoft folder
          const folderResponse = await dashboardsService.new_Folder(orgId, {
            name: 'Microsoft',
            description: 'Microsoft Azure and O365 dashboards',
          });
          microsoftFolder = folderResponse.data;
        }

        const folderId = microsoftFolder.folderId;

        // Check if dashboard already exists
        const dashboardsResponse = await dashboardsService.list(
          0,
          1000,
          'name',
          false,
          '',
          orgId,
          folderId,
          dashboardTitle
        );

        const existingDashboards = dashboardsResponse.data?.dashboards || [];
        const existingDashboard = existingDashboards.find(
          (d: any) => d.title === dashboardTitle
        );

        let shouldReplace = false;
        if (existingDashboard) {
          // Ask user if they want to replace
          shouldReplace = await new Promise<boolean>((resolve) => {
            q.dialog({
              title: 'Dashboard Already Exists',
              message: `A dashboard named "${dashboardTitle}" already exists in the Microsoft folder. Do you want to replace it?`,
              cancel: true,
              persistent: true,
            }).onOk(() => resolve(true))
              .onCancel(() => resolve(false));
          });

          if (!shouldReplace) {
            addingDashboard.value = false;
            return;
          }

          // Delete existing dashboard
          await dashboardsService.delete(orgId, existingDashboard.dashboardId, folderId);
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log('Creating dashboard:', { orgId, folderId, title: dashboardTitle });

        // Add the dashboard to the Microsoft folder
        await dashboardsService.create(
          orgId,
          dashboardData,
          folderId
        );

        // Refresh folders in store
        await store.dispatch('organizationData/getFolders', { org_identifier: orgId });

        // Track analytics
        segment.track("Azure Dashboard Added", {
          dashboard_name: "Microsoft O365",
          integration_type: "azure",
          folder: "Microsoft",
          replaced: shouldReplace,
        });

        q.notify({
          type: 'positive',
          message: shouldReplace
            ? 'Microsoft O365 dashboard replaced successfully'
            : 'Microsoft O365 dashboard added successfully to Microsoft folder',
          timeout: 3000,
        });
      } catch (error) {
        console.error('Error adding dashboard:', error);
        q.notify({
          type: 'negative',
          message: `Failed to add dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timeout: 5000,
        });
      } finally {
        addingDashboard.value = false;
      }
    };

    return {
      showDetails,
      includedServices,
      addingDashboard,
      handleDeployFunction,
      handleAddDashboard,
      getCategoryIcon,
      formatCategory,
    };
  },
});
</script>

<style scoped lang="scss">
.azure-quick-setup {
  .setup-card {
    max-width: 900px;
    margin: 0 auto;
  }

  .service-item {
    transition: all 0.2s ease;
  }

  .body--light & {
    .title {
      color: #1a1a1a;
    }

    .description,
    .detail-value {
      color: #666;
    }

    .service-name {
      color: #1a1a1a;
    }

    .service-description {
      color: #666;
    }

    .service-category {
      color: #999;
      font-weight: 500;
    }

    .service-item {
      border: 1px solid #e0e0e0;
      background-color: #fafafa;

      &:hover {
        background-color: #f5f5f5;
      }
    }

    .detail-label,
    .details-title {
      color: #333;
    }
  }

  .body--dark & {
    .title {
      color: #e0e0e0;
    }

    .description,
    .detail-value {
      color: #b0b0b0;
    }

    .service-name {
      color: #e0e0e0;
    }

    .service-description {
      color: #b0b0b0;
    }

    .service-category {
      color: #808080;
      font-weight: 500;
    }

    .service-item {
      border: 1px solid #404040;
      background-color: rgba(255, 255, 255, 0.05);

      &:hover {
        background-color: rgba(255, 255, 255, 0.08);
      }
    }

    .detail-label,
    .details-title {
      color: #d0d0d0;
    }
  }
}
</style>
