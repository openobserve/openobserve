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
  <div class="m-3 mt-1 max-w-4xl">
    <!-- Header -->
    <div class="flex items-start gap-4 mb-6">
      <OIcon name="cloud" size="xl" class="flex-shrink-0" />
      <div>
        <div
          data-test="azure-config-page-title"
          class="text-sm font-medium m-0 mb-1 text-text-heading"
        >
          {{ t("ingestion.azureSetup.activityLogsTitle") }}
        </div>
        <div class="text-sm m-0 text-text-secondary">
          {{ t("ingestion.azureSetup.activityLogsDescription") }}
        </div>
      </div>
    </div>

    <!-- Step 1 -->
    <div
      class="mb-4 p-4 rounded-default border-l-4 border-l-solid bg-surface-subtle border-l-border-strong"
    >
      <div class="flex gap-3 items-start">
        <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 bg-status-info-bg text-status-info-text">{{ t("ingestion.azureSetup.step1Number") }}</div>
        <div>
          <div class="font-semibold mb-1 text-text-heading">
            {{ t("ingestion.azureSetup.step1Title") }}
          </div>
          <div class="text-sm m-0 mb-3 text-text-secondary">
            {{ t("ingestion.azureSetup.step1Description") }}
          </div>
          <OButton
            variant="primary"
            size="sm"
            @click="handleDeploy"
            data-test="azure-activity-logs-deploy-btn"
          >
            <template #icon-left
              ><OIcon name="rocket-launch" size="sm"
            /></template>
            {{ t("ingestion.azureSetup.deployToAzure") }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div
      class="mb-4 p-4 rounded-default border-l-4 border-l-solid bg-surface-subtle border-l-border-strong"
    >
      <div class="flex gap-3 items-start">
        <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 bg-status-info-bg text-status-info-text">{{ t("ingestion.azureSetup.step2Number") }}</div>
        <div>
          <div class="font-semibold mb-1 text-text-heading">
            {{ t("ingestion.azureSetup.step2Title") }}
          </div>
          <div class="text-sm mb-3 text-text-secondary">
            {{ t("ingestion.azureSetup.step2Description") }}
          </div>

          <!-- Portal / CLI toggle -->
          <OToggleGroup v-model="step2Mode" class="mb-4">
            <OToggleGroupItem value="portal">{{ t("ingestion.azureSetup.azurePortalTab") }}</OToggleGroupItem>
            <OToggleGroupItem value="cli">{{ t("ingestion.azureSetup.azureCliTab") }}</OToggleGroupItem>
          </OToggleGroup>

          <!-- Portal instructions -->
          <div v-if="step2Mode === 'portal'">
            <ol class="text-sm pl-4 space-y-1 text-text-secondary">
              <li>
                {{ t("ingestion.azureSetup.goTo") }}
                <strong
                  >{{ t("ingestion.azureSetup.portalSubscriptionPath") }}</strong
                >
              </li>
              <li>{{ t("ingestion.azureSetup.clickPrefix") }} <strong>{{ t("ingestion.azureSetup.activityLogMenuItem") }}</strong> {{ t("ingestion.azureSetup.inLeftMenu") }}</li>
              <li>
                {{ t("ingestion.azureSetup.clickPrefix") }} <strong>{{ t("ingestion.azureSetup.exportActivityLogs") }}</strong> {{ t("ingestion.azureSetup.orOpenParen") }}
                <strong>{{ t("ingestion.azureSetup.diagnosticSettingsPath") }}</strong>)
              </li>
              <li>{{ t("ingestion.azureSetup.enterNameCheckCategories") }}</li>
              <li>
                {{ t("ingestion.azureSetup.underPrefix") }} <strong>{{ t("ingestion.azureSetup.destinationDetails") }}</strong>{{ t("ingestion.azureSetup.chooseSuffix") }}
                <strong>{{ t("ingestion.azureSetup.streamToEventHub") }}</strong>
              </li>
              <li>
                {{ t("ingestion.azureSetup.selectEventHubPrefix") }}
                <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- literal Azure resource-name prefix, must stay identical across locales -->
                <code>o2-activity</code>)
              </li>
              <li>{{ t("ingestion.azureSetup.clickPrefix") }} <strong>{{ t("common.save") }}</strong></li>
            </ol>
          </div>

          <!-- CLI: inputs + generated curl command -->
          <div v-else>
            <!-- Categories -->
            <div class="mb-4">
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs font-semibold text-text-heading">
                  {{ t("ingestion.azureSetup.logCategoriesToEnable") }}
                </div>
                <div class="flex gap-2">
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    @click="
                      enabledCategories = LOG_CATEGORIES.map((c) => c.value)
                    "
                    >{{ t("ingestion.azureSetup.selectAllCategories") }}</OButton
                  >
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    @click="enabledCategories = []"
                    >{{ t("ingestion.azureSetup.clearCategories") }}</OButton
                  >
                </div>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-1 w-full">
                <OCheckbox
                  v-for="cat in LOG_CATEGORIES"
                  :key="cat.value"
                  v-model="enabledCategories"
                  :val="cat.value"
                  :label="cat.label"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <div class="text-xs mb-1 text-text-heading">
                  {{ t("ingestion.azureSetup.resourceGroupLabel") }}
                </div>
                <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- example Azure resource-group name format, not translatable content -->
                <OInput placeholder="rg-openobserve-activity-logs"
                  v-model="resourceGroup"
                  autocomplete="off"
                  data-test="azure-resource-group-input"
                />
              </div>
              <div>
                <div class="text-xs mb-1 text-text-heading">
                  {{ t("ingestion.azureSetup.deploymentNameLabel") }}
                </div>
                <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- example Azure deployment-name format, not translatable content -->
                <OInput placeholder="o2-activity-20260420"
                  v-model="deploymentName"
                  autocomplete="off"
                  data-test="azure-deployment-name-input"
                />
              </div>
            </div>

            <div
              v-if="enabledCategories.length === 0"
              class="text-sm text-status-error-text mb-3"
            >
              {{ t("ingestion.azureSetup.selectAtLeastOneCategory") }}
            </div>
            <div v-else>
              <div class="text-xs mb-2 text-text-secondary">
                {{ t("ingestion.azureSetup.runCommandAfterDeployment") }}
              </div>
              <CopyContent
                :content="curlCommand"
                data-test="azure-curl-command"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Manual Configuration -->
    <div class="mt-6">
      <div class="font-semibold text-sm mb-2 text-text-heading">
        {{ t("ingestion.azureSetup.manualTitle") }}
      </div>
      <CopyContent :content="manualContent" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useStore } from "vuex";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import {
  generateARMTemplateURL,
  azureIntegrations,
} from "@/utils/azureIntegrations";
import CopyContent from "@/components/CopyContent.vue";
import segment from "@/services/segment_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";

const SCRIPT_URL =
  "https://raw.githubusercontent.com/openobserve/o2-datasource/main/azure/azure_activity_logs/configure-diagnostic-settings.sh";

const LOG_CATEGORIES = [
  { value: "Administrative", label: "Administrative" },
  { value: "Security", label: "Security" },
  { value: "ServiceHealth", label: "Service Health" },
  { value: "Alert", label: "Alert" },
  { value: "Recommendation", label: "Recommendation" },
  { value: "Policy", label: "Policy" },
  { value: "Autoscale", label: "Autoscale" },
  { value: "ResourceHealth", label: "Resource Health" },
];

const activityLogsIntegration = azureIntegrations.find(
  (i) => i.id === "activity-logs",
)!;

export default defineComponent({
  name: "AzureConfig",
  components: {
    CopyContent, OToggleGroup, OToggleGroupItem, OButton, OCheckbox, OInput,
    OIcon,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();

    let endpoint: any = null;
    try {
      endpoint = getEndPoint(getIngestionURL());
    } catch (e) {
      console.error("Error getting endpoint:", e);
    }

    const step2Mode = ref<"portal" | "cli">("portal");
    const enabledCategories = ref<string[]>(LOG_CATEGORIES.map((c) => c.value));
    const resourceGroup = ref("");
    const deploymentName = ref("");

    const curlCommand = computed(() => {
      const rg = resourceGroup.value || "YOUR-RESOURCE-GROUP";
      const dn = deploymentName.value || "YOUR-DEPLOYMENT-NAME";
      const cats = enabledCategories.value.join(",");
      return `curl -s ${SCRIPT_URL} | bash -s -- \\
  --resource-group "${rg}" \\
  --deployment-name "${dn}" \\
  --categories "${cats}"`;
    });

    const manualContent = computed(() => {
      const orgId = store.state?.selectedOrganization?.identifier || "";
      const url = endpoint?.url || "";
      return `Event Hub → OpenObserve Endpoint: ${url}/azure/${orgId}/default/_event_hub\nAccess Key: [BASIC_PASSCODE]`;
    });

    const handleDeploy = () => {
      if (!endpoint?.url) {
        toast({
          variant: "error",
          message: "Invalid ingestion endpoint. Please check configuration.",
        });
        return;
      }

      const organizationId = store.state?.selectedOrganization?.identifier;
      const email = store.state?.userInfo?.email;
      const passcode = store.state?.organizationData?.organizationPasscode;

      if (!organizationId || !email || !passcode) {
        toast({
          variant: "error",
          message: "Missing organization credentials. Please refresh the page.",
        });
        return;
      }

      const accessKey = btoa(`${email}:${passcode}`);
      const endpointUrl = `${endpoint.url}/azure/${organizationId}/default/_event_hub`;

      const url = generateARMTemplateURL(
        activityLogsIntegration,
        endpointUrl,
        accessKey,
      );
      window.open(url, "_blank", "noopener,noreferrer");

      segment.track("Azure Activity Logs Deploy Started", {
        integration_id: "activity-logs",
      });

      toast({
        variant: "info",
        message: "Opening Azure portal to deploy Activity Logs infrastructure",
      });
    };

    return {
      t,
      store,
      LOG_CATEGORIES,
      step2Mode,
      enabledCategories,
      resourceGroup,
      deploymentName,
      curlCommand,
      manualContent,
      handleDeploy,
    };
  },
});
</script>
