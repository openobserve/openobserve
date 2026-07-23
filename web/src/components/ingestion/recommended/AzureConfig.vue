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
    <div class="mb-6 flex items-start gap-4">
      <OIcon name="cloud" size="xl" class="flex-shrink-0" />
      <div>
        <div
          data-test="azure-config-page-title"
          class="text-text-heading m-0 mb-1 text-sm font-medium"
        >
          {{ t("ingestion.azureSetup.activityLogsTitle") }}
        </div>
        <div class="text-text-secondary m-0 text-sm">
          {{ t("ingestion.azureSetup.activityLogsDescription") }}
        </div>
      </div>
    </div>

    <!-- Step 1 -->
    <div
      class="rounded-default border-l-solid bg-surface-subtle border-l-border-strong mb-4 border-l-4 p-4"
    >
      <div class="flex items-start gap-3">
        <div
          class="bg-status-info-bg text-status-info-text flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        >
          1
        </div>
        <div>
          <div class="text-text-heading mb-1 font-semibold">Deploy ARM Template</div>
          <div class="text-text-secondary m-0 mb-3 text-sm">
            Creates an Event Hub namespace, Event Hub, and all required resources in your Azure
            subscription.
          </div>
          <OButton
            variant="primary"
            size="sm"
            @click="handleDeploy"
            data-test="azure-activity-logs-deploy-btn"
          >
            <template #icon-left><OIcon name="rocket-launch" size="sm" /></template>
            Deploy to Azure
          </OButton>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div
      class="rounded-default border-l-solid bg-surface-subtle border-l-border-strong mb-4 border-l-4 p-4"
    >
      <div class="flex items-start gap-3">
        <div
          class="bg-status-info-bg text-status-info-text flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        >
          2
        </div>
        <div>
          <div class="text-text-heading mb-1 font-semibold">Configure Diagnostic Settings</div>
          <div class="text-text-secondary mb-3 text-sm">
            After the ARM deployment completes, route Activity Logs to the Event Hub that was
            created.
          </div>

          <!-- Portal / CLI toggle -->
          <OToggleGroup v-model="step2Mode" class="mb-4">
            <OToggleGroupItem value="portal">Azure Portal</OToggleGroupItem>
            <OToggleGroupItem value="cli">Azure CLI</OToggleGroupItem>
          </OToggleGroup>

          <!-- Portal instructions -->
          <div v-if="step2Mode === 'portal'">
            <ol class="text-text-secondary space-y-1 pl-4 text-sm">
              <li>
                Go to
                <strong>Azure Portal → Subscriptions → your subscription</strong>
              </li>
              <li>Click <strong>Activity log</strong> in the left menu</li>
              <li>
                Click <strong>Export Activity Logs</strong> (or
                <strong>Diagnostic settings → + Add diagnostic setting</strong>)
              </li>
              <li>Enter a name, check the log categories you want to enable</li>
              <li>
                Under <strong>Destination details</strong>, choose
                <strong>Stream to an event hub</strong>
              </li>
              <li>
                Select the Event Hub namespace and Event Hub created in Step 1 (prefix:
                <code>o2-activity</code>)
              </li>
              <li>Click <strong>Save</strong></li>
            </ol>
          </div>

          <!-- CLI: inputs + generated curl command -->
          <div v-else>
            <!-- Categories -->
            <div class="mb-4">
              <div class="mb-2 flex items-center justify-between">
                <div class="text-text-heading text-xs font-semibold">Log categories to enable</div>
                <div class="flex gap-2">
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    @click="enabledCategories = LOG_CATEGORIES.map((c) => c.value)"
                    >Select all</OButton
                  >
                  <OButton variant="ghost-primary" size="xs" @click="enabledCategories = []"
                    >Clear</OButton
                  >
                </div>
              </div>
              <div class="grid w-full grid-cols-2 gap-1 sm:grid-cols-4">
                <OCheckbox
                  v-for="cat in LOG_CATEGORIES"
                  :key="cat.value"
                  v-model="enabledCategories"
                  :val="cat.value"
                  :label="cat.label"
                />
              </div>
            </div>

            <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div class="text-text-heading mb-1 text-xs">Resource Group</div>
                <OInput
                  v-model="resourceGroup"
                  placeholder="rg-openobserve-activity-logs"
                  autocomplete="off"
                  data-test="azure-resource-group-input"
                />
              </div>
              <div>
                <div class="text-text-heading mb-1 text-xs">Deployment Name</div>
                <OInput
                  v-model="deploymentName"
                  placeholder="o2-activity-20260420"
                  autocomplete="off"
                  data-test="azure-deployment-name-input"
                />
              </div>
            </div>

            <div v-if="enabledCategories.length === 0" class="text-status-error-text mb-3 text-sm">
              Select at least one log category above.
            </div>
            <div v-else>
              <div class="text-text-secondary mb-2 text-xs">
                Run this command after your ARM deployment completes:
              </div>
              <CopyContent :content="curlCommand" data-test="azure-curl-command" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Manual Configuration -->
    <div class="mt-6">
      <div class="text-text-heading mb-2 text-sm font-semibold">
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
import { generateARMTemplateURL, azureIntegrations } from "@/utils/azureIntegrations";
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

const activityLogsIntegration = azureIntegrations.find((i) => i.id === "activity-logs")!;

export default defineComponent({
  name: "AzureConfig",
  components: {
    CopyContent,
    OToggleGroup,
    OToggleGroupItem,
    OButton,
    OCheckbox,
    OInput,
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

      const url = generateARMTemplateURL(activityLogsIntegration, endpointUrl, accessKey);
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
