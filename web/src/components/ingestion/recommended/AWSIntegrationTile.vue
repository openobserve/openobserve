<!-- Copyright 2026 OpenObserve Inc.

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
  <OCard
    class="border border-border h-full flex flex-col transition-all duration-200 ease-in-out rounded-lg hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_12px_rgba(255,255,255,0.1)]"
  >
    <OCardSection class="p-4 pb-2 flex-1">
      <div class="flex items-start justify-between mb-2">
        <div class="font-semibold text-base leading-[1.4]" :class="store.state.theme === 'dark' ? 'text-[#e0e0e0]' : 'text-[#1a1a1a]'">
          {{ integration.displayName }}
        </div>
        <OButton
          v-if="integration.documentationUrl"
          variant="ghost"
          size="icon-circle-sm"
          @click="handleDocumentation()"
          class="docs-btn opacity-70 hover:opacity-100 transition-opacity duration-200 ease-in-out"
          :data-test="`aws-${integration.id}-docs-btn`"
        >
          <OIcon name="description" size="sm" />
          <OTooltip content="View Documentation" />
        </OButton>
      </div>
      <div class="text-sm mb-3 leading-normal min-h-[3em]" :class="store.state.theme === 'dark' ? 'text-[#b0b0b0]' : 'text-[#666]'">
        {{ integration.description }}
      </div>
    </OCardSection>

    <OCardActions align="left" class="px-4 pb-4">
      <!-- Add Source Button -->
      <OButton
        v-if="hasCloudFormation"
        variant="primary"
        size="sm"
        @click="handleAddSource()"
        class="flex-1"
        :data-test="`aws-${integration.id}-add-source-btn`"
        >Add Source</OButton
      >
      <!-- Documentation Button (only shown if no CloudFormation) -->
      <OButton
        v-else-if="integration.documentationUrl"
        variant="primary"
        size="sm"
        @click="handleDocumentation()"
        class="flex-1"
        :data-test="`aws-${integration.id}-documentation-btn`"
        >Documentation</OButton
      >
      <!-- Add Dashboard Button -->
      <OButton
        variant="outline"
        size="sm"
        @click="handleAddDashboard"
        :disabled="!integration.hasDashboard || !integration.dashboardGithubUrl"
        class="flex-1"
        :data-test="`aws-${integration.id}-add-dashboard-btn`"
        >Add Dashboard</OButton
      >
    </OCardActions>

    <!-- Unified Integration Method Selection Dialog -->
    <ODialog data-test="aws-integration-tile-template-dialog" v-model:open="showTemplateDialog" size="sm" title="Choose Integration Method"
      secondary-button-label="Cancel"
      @click:secondary="showTemplateDialog = false"
    >
      <div class="text-sm font-medium mb-3">
        Select how you want to integrate {{ integration.displayName }}:
      </div>
      <ul class="aws-integration-options-list flex flex-col list-none p-0 m-0">
        <!-- CloudFormation Templates -->
        <li
          v-for="(template, index) in integration.cloudFormationTemplates"
          :key="`cf-${index}`"
          @click="handleTemplateSelection(template)"
          class="flex items-center gap-2 px-3 py-2 mb-2 cursor-pointer rounded border border-border hover:bg-muted/50"
          :data-test="`aws-${integration.id}-template-option-${index}`"
        >
          <div class="flex flex-col flex-1 min-w-0">
            <span class="text-sm font-medium">
              {{ template.name }}
            </span>
            <span class="block text-xs text-muted-foreground mt-1">
              {{ template.description }}
            </span>
          </div>
          <OIcon name="chevron-right" size="sm" class="shrink-0 ms-auto" />
        </li>

        <!-- Component Options -->
        <li
          v-for="(option, index) in integration.componentOptions"
          :key="`comp-${index}`"
          @click="handleComponentSelection(option)"
          class="flex items-center gap-2 px-3 py-2 mb-2 cursor-pointer rounded border border-border hover:bg-muted/50"
          :data-test="`aws-${integration.id}-component-option-${index}`"
        >
          <div class="flex flex-col flex-1 min-w-0">
            <span class="text-sm font-medium">
              {{ option.name }}
            </span>
            <span class="block text-xs text-muted-foreground mt-1">
              {{ option.description }}
            </span>
          </div>
          <OIcon name="chevron-right" size="sm" class="shrink-0 ms-auto" />
        </li>
      </ul>
    </ODialog>

    <!-- Component Display Dialog -->
    <ODialog data-test="aws-integration-tile-content-dialog" v-model:open="showComponentContent" size="xl" :title="selectedComponentTitle">
      <component
        :is="selectedComponent"
        :currOrgIdentifier="organizationId"
        :currUserEmail="userEmail"
      />
    </ODialog>
  </OCard>
</template>

<script lang="ts">
import { defineComponent, type PropType, ref, computed, shallowRef } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCardActions from "@/lib/core/Card/OCardActions.vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import type {
  AWSIntegration,
  CloudFormationTemplate,
  ComponentOption,
} from "@/utils/awsIntegrations";
import {
  generateCloudFormationURL,
  generateDashboardURL,
} from "@/utils/awsIntegrations";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";
import dashboardsService from "@/services/dashboards";
import WindowsConfig from "./WindowsConfig.vue";
import LinuxConfig from "./LinuxConfig.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

export default defineComponent({
  name: "AWSIntegrationTile",
  components: { OButton, ODialog, OIcon, OTooltip, OCard, OCardSection, OCardActions },
  props: {
    integration: {
      type: Object as PropType<AWSIntegration>,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const { confirm } = useConfirmDialog();
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
    const organizationId = computed(
      () => store.state?.selectedOrganization?.identifier || "",
    );
    const userEmail = computed(() => store.state?.userInfo?.email || "");

    // Check if integration has CloudFormation template(s) or component options
    const hasCloudFormation = computed(() => {
      return !!(
        props.integration.cloudFormationTemplate ||
        (props.integration.cloudFormationTemplates &&
          props.integration.cloudFormationTemplates.length > 0) ||
        (props.integration.componentOptions &&
          props.integration.componentOptions.length > 0)
      );
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
      const hasTemplates =
        props.integration.cloudFormationTemplates &&
        props.integration.cloudFormationTemplates.length > 0;
      const hasComponents =
        props.integration.componentOptions &&
        props.integration.componentOptions.length > 0;
      const templateCount = hasTemplates
        ? props.integration.cloudFormationTemplates!.length
        : 0;
      const componentCount = hasComponents
        ? props.integration.componentOptions!.length
        : 0;
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
        openCloudFormationURL(
          props.integration.cloudFormationTemplates![0].url,
        );
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
          toast({
            variant: "error",
            message: "Invalid ingestion endpoint. Please check configuration.",
          });
          return;
        }

        // Get organization details
        const organizationId = store.state?.selectedOrganization?.identifier;
        const email = store.state?.userInfo?.email;
        const passcode = store.state?.organizationData?.organizationPasscode;

        // Validate required data
        if (!organizationId || !email || !passcode) {
          console.error("Missing required data:", {
            organizationId,
            email,
            hasPasscode: !!passcode,
          });
          toast({
            variant: "error",
            message:
              "Missing organization credentials. Please refresh the page.",
          });
          return;
        }

        // Generate base64 encoded access key
        const accessKey = btoa(`${email}:${passcode}`);

        // Create a temporary integration object with the selected template
        const tempIntegration = {
          ...props.integration,
          cloudFormationTemplate: templateUrl,
        };

        // Generate CloudFormation URL
        const cloudFormationURL = generateCloudFormationURL(
          tempIntegration,
          organizationId,
          `${endpoint.url}/aws/${organizationId}/default/_kinesis_firehose`,
          accessKey,
        );

        if (!cloudFormationURL) {
          toast({
            variant: "warning",
            message: "CloudFormation template not available yet",
          });
          return;
        }

        // Open AWS Console in new tab
        window.open(cloudFormationURL, "_blank", "noopener,noreferrer");

        // Track analytics
        segment.track("AWS Integration Started", {
          service: props.integration.name,
          category: props.integration.category,
          integration_id: props.integration.id,
        });

        toast({
          variant: "info",
          message: `Opening AWS Console to set up ${props.integration.displayName}`,
        });
      } catch (error) {
        console.error("Error generating CloudFormation URL:", error);
        toast({
          variant: "error",
          message: `Error opening AWS Console: ${error instanceof Error ? error.message : "Unknown error"}`,
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
        let awsFolder = folders.find((f: any) => f.name === "AWS");

        if (!awsFolder) {
          // Create "AWS" folder
          const createResponse = await dashboardsService.new_Folder(orgId, {
            name: "AWS",
            description: "AWS service dashboards",
          });
          awsFolder = createResponse.data;
        }

        return awsFolder.folderId;
      } catch (error) {
        console.error("Error ensuring folders exist:", error);
        throw error;
      }
    };

    const importDashboard = async (
      dashboardJson: any,
      folderId: string,
      orgId: string,
      existingDashboardId?: string,
    ) => {
      // If replacing existing dashboard, delete it first
      if (existingDashboardId) {
        try {
          const deleteResponse = await dashboardsService.delete(
            orgId,
            existingDashboardId,
            folderId,
          );
          // Wait a moment to ensure deletion completes
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (deleteError) {
          console.error("Error deleting existing dashboard:", deleteError);
          throw new Error(
            `Failed to delete existing dashboard: ${deleteError instanceof Error ? deleteError.message : "Unknown error"}`,
          );
        }
      }

      // Import dashboard
      await dashboardsService.create(orgId, dashboardJson, folderId);
    };

    const handleAddDashboard = async () => {
      if (
        !props.integration.hasDashboard ||
        !props.integration.dashboardGithubUrl
      ) {
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
        const dashboardTitle =
          dashboardJson.title || props.integration.displayName;

        // Step 3: Check if dashboard already exists by listing all dashboards in the folder
        const dashboardsResponse = await dashboardsService.list(
          0,
          1000,
          "name",
          false,
          "",
          orgId,
          folderId,
          "",
        );

        const existingDashboard = dashboardsResponse.data?.dashboards?.find(
          (d: any) => d.title === dashboardTitle,
        );

        // Get dashboard ID - could be dashboardId, dashboard_id, or id
        const existingDashboardId =
          existingDashboard?.dashboardId ||
          existingDashboard?.dashboard_id ||
          existingDashboard?.id;


        if (existingDashboard) {
          // Ask user if they want to replace the existing dashboard
          const ok = await confirm({
            title: "Dashboard Already Exists",
            message: `A dashboard for ${props.integration.displayName} already exists. Do you wish to replace it?`,
            confirmLabel: "Replace",
            cancelLabel: "Cancel",
          });
          if (!ok) return;

          // User chose to replace
          const loadingNotif = toast({
            type: "ongoing",
            message: "Replacing dashboard...",
            timeout: 0,
            variant: "loading",
          });

          try {
            await importDashboard(
              dashboardJson,
              folderId,
              orgId,
              existingDashboardId,
            );

            loadingNotif();
            toast({
              variant: "success",
              message: `Dashboard for ${props.integration.displayName} replaced successfully!`,
              timeout: 5000,
              action: {
                label: "View Dashboard",
                handler: () =>
                  router.push(`/dashboards?org_identifier=${orgId}`),
              },
            });

            // Track analytics
            segment.track("AWS Dashboard Replaced", {
              service: props.integration.name,
              integration_id: props.integration.id,
            });
          } catch (error) {
            loadingNotif();
            console.error("Error replacing dashboard:", error);
            toast({
              variant: "error",
              message: `Failed to replace dashboard: ${error instanceof Error ? error.message : "Unknown error"}`,
              timeout: 5000,
            });
          }
          return;
        }

        // No existing dashboard, proceed with import
        const loadingNotif = toast({
          type: "ongoing",
          message: "Importing dashboard...",
          timeout: 0,
          variant: "loading",
        });

        await importDashboard(dashboardJson, folderId, orgId);

        loadingNotif();
        toast({
          variant: "success",
          message: `Dashboard for ${props.integration.displayName} imported successfully!`,
          timeout: 5000,
          action: {
            label: "View Dashboard",
            handler: () => router.push(`/dashboards?org_identifier=${orgId}`),
          },
        });

        // Track analytics
        segment.track("AWS Dashboard Imported", {
          service: props.integration.name,
          integration_id: props.integration.id,
        });
      } catch (error) {
        console.error("Error importing dashboard:", error);
        toast({
          variant: "error",
          message: `Failed to import dashboard: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      window.open(
        props.integration.documentationUrl,
        "_blank",
        "noopener,noreferrer",
      );
    };

    return {
      store,
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
