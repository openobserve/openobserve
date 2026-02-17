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
  <q-card
    class="aws-integration-tile"
    flat
    bordered
  >
    <q-card-section class="tw:pb-2">
      <div class="tw:flex tw:items-start tw:justify-between tw:mb-2">
        <div class="tile-name tw:font-semibold tw:text-base">
          {{ integration.displayName }}
        </div>
        <q-btn
          v-if="integration.documentationUrl"
          flat
          dense
          round
          size="sm"
          icon="description"
          color="primary"
          @click="handleDocumentation()"
          class="docs-btn"
          :data-test="`aws-${integration.id}-docs-btn`"
        >
          <q-tooltip>View Documentation</q-tooltip>
        </q-btn>
      </div>
      <div class="tile-description tw:text-sm tw:text-gray-600 tw:mb-3">
        {{ integration.description }}
      </div>
    </q-card-section>

    <q-card-actions class="tw:px-4 tw:pb-4 tw:flex tw:flex-row tw:gap-2">
      <!-- Add Source Button -->
      <q-btn
        v-if="hasCloudFormation"
        color="primary"
        label="Add Source"
        @click="handleAddSource()"
        unelevated
        class="tw:flex-1"
        :data-test="`aws-${integration.id}-add-source-btn`"
      />
      <!-- Documentation Button (only shown if no CloudFormation) -->
      <q-btn
        v-else-if="integration.documentationUrl"
        color="primary"
        label="Documentation"
        @click="handleDocumentation()"
        unelevated
        class="tw:flex-1"
        :data-test="`aws-${integration.id}-documentation-btn`"
      />
      <!-- Add Dashboard Button -->
      <q-btn
        outline
        color="primary"
        label="Add Dashboard"
        @click="handleAddDashboard"
        :disable="!integration.hasDashboard || !integration.dashboardGithubUrl"
        class="tw:flex-1"
        :data-test="`aws-${integration.id}-add-dashboard-btn`"
      />
    </q-card-actions>

    <!-- Unified Integration Method Selection Dialog -->
    <q-dialog v-model="showTemplateDialog">
      <q-card style="min-width: 400px">
        <q-card-section>
          <div class="text-h6">Choose Integration Method</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="text-subtitle2 q-mb-md">
            Select how you want to integrate {{ integration.displayName }}:
          </div>
          <q-list>
            <!-- CloudFormation Templates -->
            <q-item
              v-for="(template, index) in integration.cloudFormationTemplates"
              :key="`cf-${index}`"
              clickable
              v-ripple
              @click="handleTemplateSelection(template)"
              class="q-mb-sm rounded-borders"
              style="border: 1px solid rgba(0,0,0,0.12)"
            >
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ template.name }}
                </q-item-label>
                <q-item-label caption class="q-mt-xs">
                  {{ template.description }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" color="primary" />
              </q-item-section>
            </q-item>

            <!-- Component Options -->
            <q-item
              v-for="(option, index) in integration.componentOptions"
              :key="`comp-${index}`"
              clickable
              v-ripple
              @click="handleComponentSelection(option)"
              class="q-mb-sm rounded-borders"
              style="border: 1px solid rgba(0,0,0,0.12)"
            >
              <q-item-section>
                <q-item-label class="text-weight-medium">
                  {{ option.name }}
                </q-item-label>
                <q-item-label caption class="q-mt-xs">
                  {{ option.description }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="chevron_right" color="primary" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Component Display Dialog -->
    <q-dialog v-model="showComponentContent" full-width>
      <q-card>
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ selectedComponentTitle }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <component
            :is="selectedComponent"
            :currOrgIdentifier="organizationId"
            :currUserEmail="userEmail"
          />
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType, ref, computed, shallowRef } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import type { AWSIntegration, CloudFormationTemplate, ComponentOption } from "@/utils/awsIntegrations";
import { generateCloudFormationURL, generateDashboardURL } from "@/utils/awsIntegrations";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import dashboardsService from "@/services/dashboards";
import WindowsConfig from "./WindowsConfig.vue";
import LinuxConfig from "./LinuxConfig.vue";

export default defineComponent({
  name: "AWSIntegrationTile",
  props: {
    integration: {
      type: Object as PropType<AWSIntegration>,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const q = useQuasar();
    const router = useRouter();
    const showTemplateDialog = ref(false);
    const showComponentContent = ref(false);
    const selectedComponent = shallowRef<any>(null);
    const selectedComponentTitle = ref("");

    // Map component names to actual components
    const componentMap: Record<string, any> = {
      WindowsConfig,
      LinuxConfig,
    };

    // Get organization and user details
    const organizationId = computed(() => store.state?.selectedOrganization?.identifier || '');
    const userEmail = computed(() => store.state?.userInfo?.email || '');

    // Check if integration has CloudFormation template(s) or component options
    const hasCloudFormation = computed(() => {
      return !!(props.integration.cloudFormationTemplate ||
                (props.integration.cloudFormationTemplates &&
                 props.integration.cloudFormationTemplates.length > 0) ||
                (props.integration.componentOptions &&
                 props.integration.componentOptions.length > 0));
    });

    // Get endpoint information during setup (not inside click handler)
    let endpoint: any = null;
    try {
      const ingestionURL = getIngestionURL();
      endpoint = getEndPoint(ingestionURL);
    } catch (e) {
      console.error("Error getting endpoint during setup:", e);
    }

    const handleAddSource = () => {
      const hasTemplates = props.integration.cloudFormationTemplates && props.integration.cloudFormationTemplates.length > 0;
      const hasComponents = props.integration.componentOptions && props.integration.componentOptions.length > 0;
      const templateCount = hasTemplates ? props.integration.cloudFormationTemplates!.length : 0;
      const componentCount = hasComponents ? props.integration.componentOptions!.length : 0;
      const totalOptions = templateCount + componentCount;

      // If both templates and components exist, or multiple of one type, show dialog
      if (totalOptions > 1) {
        showTemplateDialog.value = true;
        return;
      }

      // Single component option
      if (hasComponents && componentCount === 1) {
        handleComponentSelection(props.integration.componentOptions![0]);
        return;
      }

      // Single template option
      if (hasTemplates && templateCount === 1) {
        openCloudFormationURL(props.integration.cloudFormationTemplates![0].url);
        return;
      }

      // Otherwise use the single cloudFormationTemplate string
      if (props.integration.cloudFormationTemplate) {
        openCloudFormationURL(props.integration.cloudFormationTemplate);
      }
    };

    const handleComponentSelection = (option: ComponentOption) => {
      showTemplateDialog.value = false;
      selectedComponent.value = componentMap[option.component];
      selectedComponentTitle.value = `${props.integration.displayName} - ${option.name}`;
      showComponentContent.value = true;

      // Track analytics
      segment.track("AWS Component Config Opened", {
        service: props.integration.name,
        platform: option.name,
        integration_id: props.integration.id,
      });
    };

    const handleTemplateSelection = (template: CloudFormationTemplate) => {
      showTemplateDialog.value = false;
      openCloudFormationURL(template.url);
    };

    const openCloudFormationURL = (templateUrl: string) => {
      try {
        // Validate endpoint
        if (!endpoint?.url) {
          console.error("Invalid endpoint:", endpoint);
          q.notify({
            type: "negative",
            message: "Invalid ingestion endpoint. Please check configuration.",
            timeout: 3000,
          });
          return;
        }

        // Get organization details
        const organizationId = store.state?.selectedOrganization?.identifier;
        const email = store.state?.userInfo?.email;
        const passcode = store.state?.organizationData?.organizationPasscode;

        // Validate required data
        if (!organizationId || !email || !passcode) {
          console.error("Missing required data:", { organizationId, email, hasPasscode: !!passcode });
          q.notify({
            type: "negative",
            message: "Missing organization credentials. Please refresh the page.",
            timeout: 3000,
          });
          return;
        }

        // Generate base64 encoded access key
        const accessKey = btoa(`${email}:${passcode}`);

        // Create a temporary integration object with the selected template
        const tempIntegration = { ...props.integration, cloudFormationTemplate: templateUrl };

        // Generate CloudFormation URL
        const cloudFormationURL = generateCloudFormationURL(
          tempIntegration,
          organizationId,
          `${endpoint.url}/aws/${organizationId}/default/_kinesis_firehose`,
          accessKey
        );

        if (!cloudFormationURL) {
          q.notify({
            type: "warning",
            message: "CloudFormation template not available yet",
            timeout: 3000,
          });
          return;
        }

        // Open AWS Console in new tab
        window.open(cloudFormationURL, '_blank', 'noopener,noreferrer');

        // Track analytics
        segment.track("AWS Integration Started", {
          service: props.integration.name,
          category: props.integration.category,
          integration_id: props.integration.id,
        });

        q.notify({
          type: "info",
          message: `Opening AWS Console to set up ${props.integration.displayName}`,
          timeout: 3000,
        });
      } catch (error) {
        console.error("Error generating CloudFormation URL:", error);
        q.notify({
          type: "negative",
          message: `Error opening AWS Console: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timeout: 5000,
        });
      }
    };

    const ensureIntegrationsFolderExists = async (orgId: string) => {
      try {
        // Get all folders
        const foldersResponse = await dashboardsService.list_Folders(orgId);
        const folders = foldersResponse.data?.list || [];

        // Check if "AWS" folder exists
        let awsFolder = folders.find((f: any) => f.name === 'AWS');

        if (!awsFolder) {
          // Create "AWS" folder
          const createResponse = await dashboardsService.new_Folder(orgId, {
            name: 'AWS',
            description: 'AWS service dashboards',
          });
          awsFolder = createResponse.data;
        }

        return awsFolder.folderId;
      } catch (error) {
        console.error("Error ensuring folders exist:", error);
        throw error;
      }
    };

    const importDashboard = async (dashboardJson: any, folderId: string, orgId: string, existingDashboardId?: string) => {
      // If replacing existing dashboard, delete it first
      if (existingDashboardId) {
        try {
          console.log('Attempting to delete dashboard:', {
            orgId,
            dashboardId: existingDashboardId,
            folderId
          });
          const deleteResponse = await dashboardsService.delete(orgId, existingDashboardId, folderId);
          console.log('Delete response:', deleteResponse);
          // Wait a moment to ensure deletion completes
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (deleteError) {
          console.error("Error deleting existing dashboard:", deleteError);
          throw new Error(`Failed to delete existing dashboard: ${deleteError instanceof Error ? deleteError.message : 'Unknown error'}`);
        }
      }

      // Import dashboard
      console.log('Creating dashboard:', { orgId, folderId, title: dashboardJson.title });
      await dashboardsService.create(orgId, dashboardJson, folderId);
    };

    const handleAddDashboard = async () => {
      if (!props.integration.hasDashboard || !props.integration.dashboardGithubUrl) {
        return;
      }

      try {
        const orgId = store.state.selectedOrganization.identifier;

        // Step 1: Ensure folders exist
        const folderId = await ensureIntegrationsFolderExists(orgId);

        // Step 2: Download dashboard JSON to get the actual title
        const response = await fetch(props.integration.dashboardGithubUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch dashboard: ${response.statusText}`);
        }
        const dashboardJson = await response.json();
        const dashboardTitle = dashboardJson.title || props.integration.displayName;

        // Step 3: Check if dashboard already exists by listing all dashboards in the folder
        const dashboardsResponse = await dashboardsService.list(
          0,
          1000,
          'name',
          false,
          '',
          orgId,
          folderId,
          ''
        );

        const existingDashboard = dashboardsResponse.data?.dashboards?.find(
          (d: any) => d.title === dashboardTitle
        );

        // Get dashboard ID - could be dashboardId, dashboard_id, or id
        const existingDashboardId = existingDashboard?.dashboardId || existingDashboard?.dashboard_id || existingDashboard?.id;

        console.log('Dashboard check:', {
          dashboardTitle,
          allDashboards: dashboardsResponse.data?.dashboards,
          existingDashboard,
          existingDashboardId
        });

        if (existingDashboard) {
          // Ask user if they want to replace the existing dashboard
          q.dialog({
            title: 'Dashboard Already Exists',
            message: `A dashboard for ${props.integration.displayName} already exists. Do you wish to replace it?`,
            cancel: {
              label: 'Cancel',
              flat: true,
              color: 'primary'
            },
            ok: {
              label: 'Replace',
              flat: true,
              color: 'negative'
            },
            persistent: true
          }).onOk(async () => {
            // User chose to replace
            const loadingNotif = q.notify({
              type: 'ongoing',
              message: 'Replacing dashboard...',
              timeout: 0,
              spinner: true,
            });

            try {
              await importDashboard(dashboardJson, folderId, orgId, existingDashboardId);

              loadingNotif();
              q.notify({
                type: 'positive',
                message: `Dashboard for ${props.integration.displayName} replaced successfully!`,
                timeout: 5000,
                actions: [
                  {
                    label: 'View Dashboard',
                    color: 'white',
                    handler: () => router.push(`/dashboards?org_identifier=${orgId}`)
                  }
                ]
              });

              // Track analytics
              segment.track("AWS Dashboard Replaced", {
                service: props.integration.name,
                integration_id: props.integration.id,
              });
            } catch (error) {
              loadingNotif();
              console.error("Error replacing dashboard:", error);
              q.notify({
                type: 'negative',
                message: `Failed to replace dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timeout: 5000,
              });
            }
          });
          return;
        }

        // No existing dashboard, proceed with import
        const loadingNotif = q.notify({
          type: 'ongoing',
          message: 'Importing dashboard...',
          timeout: 0,
          spinner: true,
        });

        await importDashboard(dashboardJson, folderId, orgId);

        loadingNotif();
        q.notify({
          type: 'positive',
          message: `Dashboard for ${props.integration.displayName} imported successfully!`,
          timeout: 5000,
          actions: [
            {
              label: 'View Dashboard',
              color: 'white',
              handler: () => router.push(`/dashboards?org_identifier=${orgId}`)
            }
          ]
        });

        // Track analytics
        segment.track("AWS Dashboard Imported", {
          service: props.integration.name,
          integration_id: props.integration.id,
        });

      } catch (error) {
        console.error("Error importing dashboard:", error);
        q.notify({
          type: 'negative',
          message: `Failed to import dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timeout: 5000,
        });
      }
    };

    const handleDocumentation = () => {
      if (!props.integration.documentationUrl) {
        return;
      }

      // Track analytics
      segment.track("AWS Documentation Opened", {
        service: props.integration.name,
        integration_id: props.integration.id,
        documentation_url: props.integration.documentationUrl,
      });

      // Open documentation in new tab
      window.open(props.integration.documentationUrl, '_blank', 'noopener,noreferrer');
    };

    return {
      handleAddSource,
      handleAddDashboard,
      handleDocumentation,
      handleTemplateSelection,
      handleComponentSelection,
      showTemplateDialog,
      showComponentContent,
      selectedComponent,
      selectedComponentTitle,
      organizationId,
      userEmail,
      hasCloudFormation,
    };
  },
});
</script>

<style scoped lang="scss">
.aws-integration-tile {
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all 0.2s ease;
  border-radius: 8px;

  &:hover {
    transform: translateY(-2px);
  }

  .body--light & {
    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .tile-name {
      color: #1a1a1a;
    }

    .tile-description {
      color: #666;
    }
  }

  .body--dark & {
    &:hover {
      box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
    }

    .tile-name {
      color: #e0e0e0;
    }

    .tile-description {
      color: #b0b0b0;
    }
  }

  .tile-name {
    line-height: 1.4;
  }

  .tile-description {
    line-height: 1.5;
    min-height: 3em;
  }

  .q-card__section,
  .q-card__actions {
    flex-grow: 0;
  }

  .q-card__actions {
    margin-top: auto;
  }

  .docs-btn {
    opacity: 0.7;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
