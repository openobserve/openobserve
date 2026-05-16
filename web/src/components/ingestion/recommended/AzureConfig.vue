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
  <div class="q-ma-md azure-config-page">
    <!-- Header -->
    <div class="tw:flex tw:items-start tw:gap-4 tw:mb-6">
      <OIcon
        name="cloud"
        size="2.5rem"
        class="tw:flex-shrink-0"
      />
      <div>
        <h5 class="tw:text-lg tw:font-bold tw:m-0 tw:mb-1 title">
          Azure Activity Logs
        </h5>
        <p class="tw:text-sm tw:m-0 page-description">
          Stream Azure subscription activity logs to OpenObserve via Event Hub.
          The ARM template sets up the Event Hub infrastructure — you then
          configure Azure to export logs to it.
        </p>
      </div>
    </div>

    <!-- Step 1 -->
    <div class="step-card tw:mb-4 tw:p-4 tw:rounded">
      <div
        style="
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 12px;
          align-items: start;
        "
      >
        <div class="step-number">1</div>
        <div>
          <div class="tw:font-semibold tw:mb-1 step-title">
            Deploy ARM Template
          </div>
          <p class="tw:text-sm tw:m-0 tw:mb-3 step-desc">
            Creates an Event Hub namespace, Event Hub, and all required
            resources in your Azure subscription.
          </p>
          <OButton
            variant="primary"
            size="sm"
            @click="handleDeploy"
            data-test="azure-activity-logs-deploy-btn"
          >
            <template #icon-left
              ><OIcon name="rocket-launch" size="sm"
            /></template>
            Deploy to Azure
          </OButton>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div class="step-card tw:mb-4 tw:p-4 tw:rounded">
      <div
        style="
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 12px;
          align-items: start;
        "
      >
        <div class="step-number">2</div>
        <div>
          <div class="tw:font-semibold tw:mb-1 step-title">
            Configure Diagnostic Settings
          </div>
          <p class="tw:text-sm tw:mb-3 step-desc">
            After the ARM deployment completes, route Activity Logs to the Event
            Hub that was created.
          </p>

          <!-- Portal / CLI toggle -->
          <OToggleGroup v-model="step2Mode" class="tw:mb-4">
            <OToggleGroupItem value="portal">Azure Portal</OToggleGroupItem>
            <OToggleGroupItem value="cli">Azure CLI</OToggleGroupItem>
          </OToggleGroup>

          <!-- Portal instructions -->
          <div v-if="step2Mode === 'portal'">
            <ol class="tw:text-sm tw:pl-4 tw:space-y-1 step-desc">
              <li>
                Go to
                <strong
                  >Azure Portal → Subscriptions → your subscription</strong
                >
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
                Select the Event Hub namespace and Event Hub created in Step 1
                (prefix: <code>o2-activity</code>)
              </li>
              <li>Click <strong>Save</strong></li>
            </ol>
          </div>

          <!-- CLI: inputs + generated curl command -->
          <div v-else>
            <!-- Categories -->
            <div class="tw:mb-4">
              <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
                <div class="tw:text-xs tw:font-semibold section-label">
                  Log categories to enable
                </div>
                <div class="tw:flex tw:gap-2">
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    @click="
                      enabledCategories = LOG_CATEGORIES.map((c) => c.value)
                    "
                    >Select all</OButton
                  >
                  <OButton
                    variant="ghost-primary"
                    size="xs"
                    @click="enabledCategories = []"
                    >Clear</OButton
                  >
                </div>
              </div>
              <div
                style="
                  display: grid;
                  grid-template-columns: repeat(4, 1fr);
                  gap: 4px;
                  width: 100%;
                "
              >
                <q-checkbox
                  v-for="cat in LOG_CATEGORIES"
                  :key="cat.value"
                  v-model="enabledCategories"
                  :val="cat.value"
                  :label="cat.label"
                  dense
                  color="primary"
                />
              </div>
            </div>

            <div
              style="
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-bottom: 16px;
              "
            >
              <div>
                <div class="tw:text-xs tw:mb-1 section-label">
                  Resource Group
                </div>
                <q-input
                  v-model="resourceGroup"
                  outlined
                  dense
                  hide-bottom-space
                  placeholder="rg-openobserve-activity-logs"
                  autocomplete="off"
                  data-test="azure-resource-group-input"
                />
              </div>
              <div>
                <div class="tw:text-xs tw:mb-1 section-label">
                  Deployment Name
                </div>
                <q-input
                  v-model="deploymentName"
                  outlined
                  dense
                  hide-bottom-space
                  placeholder="o2-activity-20260420"
                  autocomplete="off"
                  data-test="azure-deployment-name-input"
                />
              </div>
            </div>

            <div
              v-if="enabledCategories.length === 0"
              class="tw:text-sm text-negative tw:mb-3"
            >
              Select at least one log category above.
            </div>
            <div v-else>
              <p class="tw:text-xs tw:mb-2 step-desc">
                Run this command after your ARM deployment completes:
              </p>
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
    <div class="tw:mt-6">
      <div class="tw:font-semibold tw:text-sm tw:mb-2 section-label">
        Manual Configuration (for reference)
      </div>
      <CopyContent :content="manualContent" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import {
  generateARMTemplateURL,
  azureIntegrations,
} from "@/utils/azureIntegrations";
import CopyContent from "@/components/CopyContent.vue";
import segment from "@/services/segment_analytics";

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
  components: { CopyContent, OToggleGroup, OToggleGroupItem, OButton,
    OIcon,
},
  setup() {
    const store = useStore();
    const q = useQuasar();

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
        q.notify({
          type: "negative",
          message: "Invalid ingestion endpoint. Please check configuration.",
          timeout: 3000,
        });
        return;
      }

      const organizationId = store.state?.selectedOrganization?.identifier;
      const email = store.state?.userInfo?.email;
      const passcode = store.state?.organizationData?.organizationPasscode;

      if (!organizationId || !email || !passcode) {
        q.notify({
          type: "negative",
          message: "Missing organization credentials. Please refresh the page.",
          timeout: 3000,
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

      q.notify({
        type: "info",
        message: "Opening Azure portal to deploy Activity Logs infrastructure",
        timeout: 3000,
      });
    };

    return {
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

<style scoped lang="scss">
.azure-config-page {
  max-width: 860px;

  .step-card {
    border-left: 3px solid;
  }

  .step-number {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  // Suppress Quasar's focus container highlight for inputs in this component
  :deep(.q-field--outlined.q-field--highlighted .q-field__control:after) {
    border-color: transparent !important;
  }
  :deep(.q-field--outlined.q-field--highlighted .q-field__control:before) {
    border-color: rgba(0, 0, 0, 0.24) !important;
  }

  .body--light & {
    .title {
      color: #1a1a1a;
    }
    .page-description,
    .step-desc {
      color: #666;
    }
    .section-label {
      color: #333;
    }
    .step-card {
      background: #fafafa;
      border-color: #e0e0e0;
    }
    .step-title {
      color: #1a1a1a;
    }
    .step-number {
      background: #1976d2;
      color: #fff;
    }
  }

  .body--dark & {
    .title {
      color: #e0e0e0;
    }
    .page-description,
    .step-desc {
      color: #b0b0b0;
    }
    .section-label {
      color: #d0d0d0;
    }
    .step-card {
      background: rgba(255, 255, 255, 0.04);
      border-color: #404040;
    }
    .step-title {
      color: #e0e0e0;
    }
    .step-number {
      background: #1976d2;
      color: #fff;
    }
  }
}
</style>
