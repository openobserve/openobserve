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
  <div class="aws-quick-setup">
    <div class="setup-card">
      <!-- Header -->
      <div class="tw:flex tw:items-start tw:gap-4 tw:mb-6">
        <q-icon
          name="rocket_launch"
          size="2.5rem"
          color="primary"
          class="tw:flex-shrink-0"
        />
        <div>
          <h5 class="tw:text-lg tw:font-bold tw:m-0 tw:mb-1 title">
            Complete AWS Integration
          </h5>
          <p class="tw:text-sm tw:m-0 description">
            Deploy all selected AWS services in one click using a single
            CloudFormation stack.
          </p>
        </div>
      </div>

      <!-- Deployment Mode Toggle -->
      <div class="tw:mb-6">
        <div class="step-label tw:mb-3">Deployment mode</div>
        <OToggleGroup
          v-model="deploymentMode"
          data-test="aws-deployment-mode-toggle"
        >
          <OToggleGroupItem value="single">Single Region</OToggleGroupItem>
          <OToggleGroupItem value="stackset"
            >Multi-Region (StackSets)</OToggleGroupItem
          >
        </OToggleGroup>
        <div class="tw:mt-2 tw:text-xs mode-hint">
          <span v-if="deploymentMode === 'single'">
            Deploys a CloudFormation stack in one AWS region. Parameters are
            pre-filled automatically.
          </span>
          <span v-else>
            Deploys across multiple regions using CloudFormation StackSets.
            Requires AWS Organizations or self-managed IAM roles. Parameters are
            shown for copy-paste into the AWS console wizard.
          </span>
        </div>
      </div>

      <!-- Step: Services -->
      <div class="tw:mb-6">
        <div
          class="tw:flex tw:items-center tw:justify-between tw:cursor-pointer region-collapsible-header tw:py-2 tw:px-3 tw:rounded"
          @click="showServices = !showServices"
        >
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-icon
              :name="showServices ? 'expand_less' : 'expand_more'"
              color="primary"
            />
            <div class="step-label">Select services to monitor</div>
            <q-chip dense color="primary" text-color="white" size="sm">
              {{ enabledServices.length }} /
              {{ QUICK_SETUP_SERVICES.length }} selected
            </q-chip>
          </div>
          <div class="tw:flex tw:gap-2" @click.stop>
            <OButton variant="ghost-primary" size="xs" @click="selectAll"
              >Select all</OButton
            >
            <OButton variant="ghost-primary" size="xs" @click="deselectAll"
              >Deselect all</OButton
            >
          </div>
        </div>

        <q-slide-transition>
          <div v-show="showServices" class="tw:mt-3">
            <div class="row q-col-gutter-sm">
              <div
                v-for="service in QUICK_SETUP_SERVICES"
                :key="service.flag"
                class="col-6 col-sm-4 col-md-3"
              >
                <OCheckbox
                  v-model="enabledServices"
                  :value="service.flag"
                  :label="service.label"
                />
              </div>
            </div>
          </div>
        </q-slide-transition>
      </div>

      <!-- Single Region: region picker -->
      <div v-if="deploymentMode === 'single'" class="tw:mb-6">
        <div class="step-label tw:mb-3">Deployment region</div>
        <OSelect
          v-model="selectedRegion"
          :options="AWS_REGIONS"
          valueKey="value"
          labelKey="label"
          style="max-width: 320px"
          data-test="aws-region-select"
        />
      </div>

      <!-- StackSets: admin + target regions -->
      <template v-else>
        <div class="tw:mb-6">
          <div class="step-label tw:mb-3">
            Admin region
            <span class="tw:font-normal tw:text-xs region-hint"
              >(where the StackSet is managed)</span
            >
          </div>
          <OSelect
            v-model="selectedRegion"
            :options="AWS_REGIONS"
            valueKey="value"
            labelKey="label"
            style="max-width: 320px"
            data-test="aws-admin-region-select"
          />
        </div>

        <div class="tw:mb-6">
          <div
            class="tw:flex tw:items-center tw:justify-between tw:cursor-pointer region-collapsible-header tw:py-2 tw:px-3 tw:rounded"
            @click="showTargetRegions = !showTargetRegions"
          >
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-icon
                :name="showTargetRegions ? 'expand_less' : 'expand_more'"
                color="primary"
              />
              <div class="step-label">
                Target regions
                <span class="tw:font-normal tw:text-xs region-hint"
                  >(where stacks will be deployed)</span
                >
              </div>
              <q-chip
                v-if="targetRegions.length > 0"
                dense
                color="primary"
                text-color="white"
                size="sm"
                >{{ targetRegions.length }} selected</q-chip
              >
            </div>
            <div class="tw:flex tw:gap-2" @click.stop>
              <OButton
                variant="ghost-primary"
                size="xs"
                @click="selectAllRegions"
                >Select all</OButton
              >
              <OButton
                variant="ghost-primary"
                size="xs"
                @click="targetRegions = []"
                >Clear</OButton
              >
            </div>
          </div>

          <q-slide-transition>
            <div v-show="showTargetRegions" class="tw:mt-3">
              <div class="row q-col-gutter-sm">
                <div
                  v-for="region in AWS_REGIONS"
                  :key="region.value"
                  class="col-12 col-sm-6 col-md-4"
                >
                  <OCheckbox
                    v-model="targetRegions"
                    :value="region.value"
                    :label="`${region.label} (${region.value})`"
                  />
                </div>
              </div>
            </div>
          </q-slide-transition>
        </div>

        <div class="tw:mb-6">
          <div class="step-label tw:mb-3">Deployment model</div>
          <OToggleGroup
            v-model="stackSetModel"
            data-test="aws-stackset-model-toggle"
          >
            <OToggleGroupItem value="self">Self-managed</OToggleGroupItem>
            <OToggleGroupItem value="service"
              >Service-managed (AWS Organizations)</OToggleGroupItem
            >
          </OToggleGroup>
          <div class="tw:mt-2 tw:text-xs mode-hint">
            <span v-if="stackSetModel === 'self'">
              Requires
              <code>AWSCloudFormationStackSetAdministrationRole</code> and
              <code>AWSCloudFormationStackSetExecutionRole</code> IAM roles in
              your account.
            </span>
            <span v-else>
              Uses AWS Organizations. Your account must be the management or
              delegated admin account.
            </span>
          </div>
        </div>
      </template>

      <!-- Launch -->
      <div class="tw:flex tw:items-center tw:gap-3 tw:mb-6">
        <OButton
          variant="primary"
          size="sm"
          :disabled="
            enabledServices.length === 0 ||
            (deploymentMode === 'stackset' && targetRegions.length === 0)
          "
          @click="handleLaunch"
          :data-test="
            deploymentMode === 'single'
              ? 'aws-quick-setup-deploy-btn'
              : 'aws-stackset-launch-btn'
          "
        >
          <template #icon-left
            ><q-icon name="cloud_upload" size="sm"
          /></template>
          {{
            deploymentMode === "single"
              ? "Launch CloudFormation Stack"
              : "Open StackSets Console"
          }}
        </OButton>
        <span
          v-if="enabledServices.length === 0"
          class="tw:text-sm text-negative"
        >
          Select at least one service
        </span>
        <span
          v-else-if="
            deploymentMode === 'stackset' && targetRegions.length === 0
          "
          class="tw:text-sm text-negative"
        >
          Select at least one target region
        </span>
        <span v-else class="tw:text-sm detail-value">
          {{ enabledServices.length }} service{{
            enabledServices.length > 1 ? "s" : ""
          }}
          selected
          <template v-if="deploymentMode === 'stackset'">
            · {{ targetRegions.length }} region{{
              targetRegions.length > 1 ? "s" : ""
            }}</template
          >
        </span>
      </div>

      <!-- StackSets Parameter Helper -->
      <q-slide-transition>
        <div v-if="showParamHelper && deploymentMode === 'stackset'">
          <q-separator class="tw:mb-4" />
          <div class="param-helper">
            <div class="tw:flex tw:items-center tw:justify-between tw:mb-3">
              <div class="tw:font-semibold step-label">
                Parameters to enter in the AWS wizard
              </div>
              <OButton
                variant="ghost"
                size="icon-circle-sm"
                @click="showParamHelper = false"
              >
                <q-icon name="close" />
              </OButton>
            </div>
            <p class="tw:text-xs tw:mb-3 mode-hint">
              The StackSets console doesn't support URL pre-fill. Enter these
              values as you go through the wizard.
            </p>
            <div class="param-table">
              <div
                v-for="param in stackSetParams"
                :key="param.key"
                class="param-row"
              >
                <div class="param-key">{{ param.key }}</div>
                <div class="param-value">
                  <span class="param-val-text">{{ param.value }}</span>
                  <OButton
                    variant="ghost"
                    size="icon-xs-circle"
                    @click="copyParam(param.value)"
                  >
                    <q-icon name="content_copy" />
                    <OTooltip content="Copy" />
                  </OButton>
                </div>
              </div>
            </div>
            <div class="tw:mt-3">
              <div class="tw:font-semibold tw:text-xs tw:mb-1 step-label">
                Target regions to enter in "Deployment targets":
              </div>
              <div class="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
                <q-chip
                  v-for="r in targetRegions"
                  :key="r"
                  dense
                  color="primary"
                  text-color="white"
                  size="sm"
                  >{{ r }}</q-chip
                >
              </div>
            </div>
          </div>
        </div>
      </q-slide-transition>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import {
  generateCloudFormationURL,
  AWS_REGIONS,
  QUICK_SETUP_SERVICES,
} from "@/utils/awsIntegrations";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import segment from "@/services/segment_analytics";

const COMPLETE_TEMPLATE_URL =
  "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/aws_complete.yaml";

export default defineComponent({
  name: "AWSQuickSetup",
  components: { OToggleGroup, OToggleGroupItem, OButton, OSelect, OTooltip, OCheckbox },
  setup() {
    const store = useStore();
    const q = useQuasar();

    const deploymentMode = ref<"single" | "stackset">("single");
    const stackSetModel = ref<"self" | "service">("self");
    const selectedRegion = ref("us-east-1");
    const targetRegions = ref<string[]>(["us-east-1"]);
    const enabledServices = ref<string[]>(
      QUICK_SETUP_SERVICES.map((s) => s.flag),
    );
    const showParamHelper = ref(false);
    const showTargetRegions = ref(false);
    const showServices = ref(false);

    let endpoint: any = null;
    try {
      endpoint = getEndPoint(getIngestionURL());
    } catch (e) {
      console.error("Error getting endpoint:", e);
    }

    const getCredentials = () => {
      const organizationId = store.state?.selectedOrganization?.identifier;
      const email = store.state?.userInfo?.email;
      const passcode = store.state?.organizationData?.organizationPasscode;
      return { organizationId, email, passcode };
    };

    const selectAll = () => {
      enabledServices.value = QUICK_SETUP_SERVICES.map((s) => s.flag);
    };
    const deselectAll = () => {
      enabledServices.value = [];
    };
    const selectAllRegions = () => {
      targetRegions.value = AWS_REGIONS.map((r) => r.value);
    };

    const buildServiceFlags = () => {
      const flags: Record<string, string> = {};
      QUICK_SETUP_SERVICES.forEach(({ flag }) => {
        flags[flag] = enabledServices.value.includes(flag) ? "true" : "false";
      });
      return flags;
    };

    // Parameters the user will need to copy-paste in the StackSets wizard
    const stackSetParams = computed(() => {
      const { organizationId, email, passcode } = getCredentials();
      if (!organizationId || !email || !passcode || !endpoint?.url) return [];

      const accessKey = btoa(`${email}:${passcode}`);
      const endpointUrl = `${endpoint.url}/aws/${organizationId}/default/_kinesis_firehose`;
      const serviceFlags = buildServiceFlags();

      const params = [
        { key: "Amazon S3 URL (template)", value: COMPLETE_TEMPLATE_URL },
        { key: "TemplateS3Bucket", value: "openobserve-datasources-bucket" },
        { key: "TemplateS3Prefix", value: "datasource/cloud/aws" },
        { key: "OpenObserveEndpoint", value: endpointUrl },
        { key: "OpenObserveAccessKey", value: accessKey },
        ...QUICK_SETUP_SERVICES.map(({ flag }) => ({
          key: flag,
          value: serviceFlags[flag],
        })),
      ];
      return params;
    });

    const copyParam = (value: string) => {
      navigator.clipboard.writeText(value);
      q.notify({
        type: "positive",
        message: "Copied to clipboard",
        timeout: 1500,
      });
    };

    const handleLaunch = () => {
      if (!endpoint?.url) {
        q.notify({
          type: "negative",
          message: "Invalid ingestion endpoint. Please check configuration.",
          timeout: 3000,
        });
        return;
      }

      const { organizationId, email, passcode } = getCredentials();
      if (!organizationId || !email || !passcode) {
        q.notify({
          type: "negative",
          message: "Missing organization credentials. Please refresh the page.",
          timeout: 3000,
        });
        return;
      }

      if (deploymentMode.value === "single") {
        launchSingleRegion(organizationId, email, passcode);
      } else {
        if (targetRegions.value.length === 0) {
          q.notify({
            type: "warning",
            message: "Select at least one target region.",
            timeout: 3000,
          });
          return;
        }
        launchStackSet(organizationId);
      }
    };

    const launchSingleRegion = (
      organizationId: string,
      email: string,
      passcode: string,
    ) => {
      const accessKey = btoa(`${email}:${passcode}`);

      const url = generateCloudFormationURL(
        {
          id: "aws-complete",
          name: "AWS-Complete",
          displayName: "AWS Complete Integration",
          cloudFormationTemplate: COMPLETE_TEMPLATE_URL,
          comingSoon: false,
        } as any,
        organizationId,
        `${endpoint.url}/aws/${organizationId}/default/_kinesis_firehose`,
        accessKey,
        selectedRegion.value,
        {
          TemplateS3Bucket: "openobserve-datasources-bucket",
          TemplateS3Prefix: "datasource/cloud/aws",
          ...buildServiceFlags(),
        },
      );

      if (!url) {
        q.notify({
          type: "warning",
          message: "CloudFormation template not available yet",
          timeout: 3000,
        });
        return;
      }

      window.open(url, "_blank", "noopener,noreferrer");
      segment.track("AWS Complete Integration Started", {
        mode: "single",
        region: selectedRegion.value,
        services: enabledServices.value,
      });
      q.notify({
        type: "info",
        message: "Opening AWS Console to deploy complete integration stack",
        timeout: 3000,
      });
    };

    const launchStackSet = (organizationId: string) => {
      // StackSets console doesn't support URL pre-fill — open the console and show param helper
      const consoleUrl = `https://console.aws.amazon.com/cloudformation/home?region=${selectedRegion.value}#/stacksets/create`;
      window.open(consoleUrl, "_blank", "noopener,noreferrer");
      showParamHelper.value = true;

      segment.track("AWS StackSet Integration Started", {
        mode: "stackset",
        model: stackSetModel.value,
        admin_region: selectedRegion.value,
        target_regions: targetRegions.value,
        services: enabledServices.value,
      });

      q.notify({
        type: "info",
        message:
          "AWS StackSets console opened. Use the parameter values below to complete setup.",
        timeout: 5000,
      });
    };

    return {
      deploymentMode,
      stackSetModel,
      selectedRegion,
      targetRegions,
      enabledServices,
      showParamHelper,
      showTargetRegions,
      showServices,
      stackSetParams,
      AWS_REGIONS,
      QUICK_SETUP_SERVICES,
      selectAll,
      deselectAll,
      selectAllRegions,
      copyParam,
      handleLaunch,
    };
  },
});
</script>

<style scoped lang="scss">
.aws-quick-setup {
  .setup-card {
    max-width: 900px;
    margin: 0 auto;
  }

  .step-label {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .param-helper {
    border-radius: 8px;
    padding: 16px;
  }

  .param-table {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-family: monospace;
  }

  .param-key {
    min-width: 240px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .param-value {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    overflow: hidden;
  }

  .param-val-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .body--light & {
    .title {
      color: #1a1a1a;
    }
    .description,
    .detail-value,
    .mode-hint {
      color: #666;
    }
    .step-label {
      color: #333;
    }
    .region-hint {
      color: #888;
    }
    .param-helper {
      background: #f5f5f5;
    }
    .param-row {
      background: #fff;
      border: 1px solid #e0e0e0;
    }
    .param-key {
      color: #333;
    }
    .param-val-text {
      color: #555;
    }
    .region-collapsible-header {
      background: #f0f4ff;
      border: 1px solid #d0d9f0;
      &:hover {
        background: #e8eeff;
      }
    }
  }

  .body--dark & {
    .title {
      color: #e0e0e0;
    }
    .description,
    .detail-value,
    .mode-hint {
      color: #b0b0b0;
    }
    .step-label {
      color: #d0d0d0;
    }
    .region-hint {
      color: #888;
    }
    .param-helper {
      background: rgba(255, 255, 255, 0.05);
    }
    .param-row {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid #404040;
    }
    .param-key {
      color: #ccc;
    }
    .param-val-text {
      color: #aaa;
    }
    .region-collapsible-header {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid #404040;
      &:hover {
        background: rgba(255, 255, 255, 0.09);
      }
    }
  }
}
</style>
