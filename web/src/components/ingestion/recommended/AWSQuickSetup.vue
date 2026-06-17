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
  <div>
    <div class="setup-card tw:max-w-225 tw:mx-auto">
      <!-- Header -->
      <div class="tw:mb-6 tw:p-4 tw:rounded-lg" :class="quickInstallBgClass">
        <div class="tw:flex tw:items-start tw:gap-3">
          <OIcon
            name="rocket-launch"
            size="xl"
            class="tw:text-[var(--q-primary)]"
          />
          <div>
            <h6 class="tw:text-xl! tw:font-bold tw:m-0 tw:mb-2!">
              Complete AWS Integration
            </h6>
            <p class="tw:text-sm tw:mt-0 tw:mb-0" :class="descriptionClass">
              Deploy all selected AWS services in one click using a single
              CloudFormation stack.
            </p>
          </div>
        </div>
      </div>

      <!-- Deployment Mode Toggle -->
      <div class="tw:mb-6">
        <div class="tw:mb-3 tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">Deployment mode</div>
        <OToggleGroup
          v-model="deploymentMode"
          data-test="aws-deployment-mode-toggle"
        >
          <OToggleGroupItem value="single">Single Region</OToggleGroupItem>
          <OToggleGroupItem value="stackset"
            >Multi-Region (StackSets)</OToggleGroupItem
          >
        </OToggleGroup>
        <div class="tw:mt-2 tw:text-xs tw:text-[#666] tw:dark:text-[#b0b0b0]">
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
          class="tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:py-2 tw:px-3 tw:rounded tw:bg-[#f0f4ff] tw:border tw:border-[#d0d9f0] tw:hover:bg-[#e8eeff] tw:dark:bg-[rgba(255,255,255,0.06)] tw:dark:border-[#404040] tw:dark:hover:bg-[rgba(255,255,255,0.09)]"
          @click="showServices = !showServices"
        >
          <div class="tw:flex tw:items-center tw:gap-2">
            <OIcon
              :name="showServices ? 'expand-less' : 'expand-more'" size="sm"
              color="primary"
            />
            <div class="tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">Select services to monitor</div>
            <OBadge variant="primary" size="sm">
              {{ enabledServices.length }} /
              {{ QUICK_SETUP_SERVICES.length }} selected
            </OBadge>
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

        <div
          class="tw:grid tw:transition-[grid-template-rows] tw:duration-300 tw:ease-in-out"
          :class="showServices ? 'tw:grid-rows-[1fr]' : 'tw:grid-rows-[0fr]'"
        >
          <div class="tw:overflow-hidden tw:min-h-0">
            <div class="tw:mt-3">
              <div class="tw:grid tw:grid-cols-4 tw:gap-x-4 tw:gap-y-2">
                <div
                  v-for="service in QUICK_SETUP_SERVICES"
                  :key="service.flag"
                >
                  <OCheckbox
                    v-model="enabledServices"
                    :value="service.flag"
                    :label="service.label"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Single Region: region picker -->
      <div v-if="deploymentMode === 'single'" class="tw:mb-6">
        <div class="tw:mb-3 tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">Deployment region</div>
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
          <div class="tw:mb-3 tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">
            Admin region
            <span class="tw:font-normal tw:text-xs tw:text-[#888]"
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
            class="tw:flex tw:items-center tw:justify-between tw:cursor-pointer tw:py-2 tw:px-3 tw:rounded tw:bg-[#f0f4ff] tw:border tw:border-[#d0d9f0] tw:hover:bg-[#e8eeff] tw:dark:bg-[rgba(255,255,255,0.06)] tw:dark:border-[#404040] tw:dark:hover:bg-[rgba(255,255,255,0.09)]"
            @click="showTargetRegions = !showTargetRegions"
          >
            <div class="tw:flex tw:items-center tw:gap-2">
              <OIcon
                :name="showTargetRegions ? 'expand-less' : 'expand-more'" size="sm"
                color="primary"
              />
              <div class="tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">
                Target regions
                <span class="tw:font-normal tw:text-xs tw:text-[#888]"
                  >(where stacks will be deployed)</span
                >
              </div>
              <OBadge
                v-if="targetRegions.length > 0"
                variant="primary"
                size="sm"
                >{{ targetRegions.length }} selected</OBadge
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

          <div
            class="tw:grid tw:transition-[grid-template-rows] tw:duration-300 tw:ease-in-out"
            :class="showTargetRegions ? 'tw:grid-rows-[1fr]' : 'tw:grid-rows-[0fr]'"
          >
            <div class="tw:overflow-hidden tw:min-h-0">
              <div class="tw:mt-3">
                <div class="tw:grid tw:grid-cols-3 tw:gap-x-4 tw:gap-y-2">
                  <div
                    v-for="region in AWS_REGIONS"
                    :key="region.value"
                  >
                    <OCheckbox
                      v-model="targetRegions"
                      :value="region.value"
                      :label="`${region.label} (${region.value})`"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="tw:mb-6">
          <div class="tw:mb-3 tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">Deployment model</div>
          <OToggleGroup
            v-model="stackSetModel"
            data-test="aws-stackset-model-toggle"
          >
            <OToggleGroupItem value="self">Self-managed</OToggleGroupItem>
            <OToggleGroupItem value="service"
              >Service-managed (AWS Organizations)</OToggleGroupItem
            >
          </OToggleGroup>
          <div class="tw:mt-2 tw:text-xs tw:text-[#666] tw:dark:text-[#b0b0b0]">
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
            ><OIcon name="cloud-upload" size="sm"
          /></template>
          {{
            deploymentMode === "single"
              ? "Launch CloudFormation Stack"
              : "Open StackSets Console"
          }}
        </OButton>
        <span
          v-if="enabledServices.length === 0"
          class="tw:text-sm tw:text-red-500"
        >
          Select at least one service
        </span>
        <span
          v-else-if="
            deploymentMode === 'stackset' && targetRegions.length === 0
          "
          class="tw:text-sm tw:text-red-500"
        >
          Select at least one target region
        </span>
        <span v-else class="tw:text-sm tw:text-[#666] tw:dark:text-[#b0b0b0]">
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
      <div
        class="tw:grid tw:transition-[grid-template-rows] tw:duration-300 tw:ease-in-out"
        :class="(showParamHelper && deploymentMode === 'stackset') ? 'tw:grid-rows-[1fr]' : 'tw:grid-rows-[0fr]'"
      >
        <div class="tw:overflow-hidden tw:min-h-0">
        <div>
          <OSeparator class="tw:mb-4" />
          <div class="tw:rounded-lg tw:p-4 tw:bg-[#f5f5f5] tw:dark:bg-[rgba(255,255,255,0.05)]">
            <div class="tw:flex tw:items-center tw:justify-between tw:mb-3">
              <div class="tw:font-semibold tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">
                Parameters to enter in the AWS wizard
              </div>
              <OButton
                variant="ghost"
                size="icon-circle-sm"
                @click="showParamHelper = false"
              >
                <OIcon name="close" size="sm" />
              </OButton>
            </div>
            <p class="tw:text-xs tw:mb-3 tw:text-[#666] tw:dark:text-[#b0b0b0]">
              The StackSets console doesn't support URL pre-fill. Enter these
              values as you go through the wizard.
            </p>
            <div class="tw:flex tw:flex-col tw:gap-[6px]">
              <div
                v-for="param in stackSetParams"
                :key="param.key"
                class="tw:flex tw:items-center tw:gap-3 tw:py-[6px] tw:px-[10px] tw:rounded tw:text-[0.8rem] tw:font-mono tw:bg-white tw:dark:bg-[rgba(255,255,255,0.03)] tw:border tw:border-(--o2-border) tw:dark:border-[#404040]"
              >
                <div class="tw:min-w-[240px] tw:font-semibold tw:shrink-0 tw:text-[#333] tw:dark:text-[#ccc]">{{ param.key }}</div>
                <div class="tw:flex tw:items-center tw:gap-1 tw:flex-1 tw:overflow-hidden">
                  <span class="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:flex-1 tw:text-[#555] tw:dark:text-[#aaa]">{{ param.value }}</span>
                  <OButton
                    variant="ghost"
                    size="icon-xs-circle"
                    @click="copyParam(param.value)"
                  >
                    <OIcon name="content-copy" size="sm" />
                    <OTooltip content="Copy" />
                  </OButton>
                </div>
              </div>
            </div>
            <div class="tw:mt-3">
              <div class="tw:font-semibold tw:text-xs tw:mb-1 tw:font-semibold tw:text-[0.9rem] tw:text-[#333] tw:dark:text-[#d0d0d0]">
                Target regions to enter in "Deployment targets":
              </div>
              <div class="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
                <OBadge
                  v-for="r in targetRegions"
                  :key="r"
                  variant="primary"
                  size="sm"
                  >{{ r }}</OBadge
                >
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useStore } from "vuex";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import {
  generateCloudFormationURL,
  AWS_REGIONS,
  QUICK_SETUP_SERVICES,
} from "@/utils/awsIntegrations";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import segment from "@/services/segment_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";

const COMPLETE_TEMPLATE_URL =
  "https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/aws_complete.yaml";

export default defineComponent({
  name: "AWSQuickSetup",
  components: { OSeparator, OToggleGroup, OToggleGroupItem, OButton, OSelect, OTooltip, OCheckbox,
    OIcon,
    OBadge,
},
  setup() {
    const store = useStore();

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

    const quickInstallBgClass = computed(() => {
      return store.state.theme === 'dark'
        ? 'tw:bg-gray-800 tw:border tw:border-gray-700'
        : 'tw:bg-blue-50 tw:border tw:border-blue-200';
    });

    const descriptionClass = computed(() => {
      return store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700';
    });

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
      copyToClipboard(value, {
        successMessage: "Copied to clipboard",
        timeout: 1500,
      });
    };

    const handleLaunch = () => {
      if (!endpoint?.url) {
        toast({
          variant: "error",
          message: "Invalid ingestion endpoint. Please check configuration.",
        });
        return;
      }

      const { organizationId, email, passcode } = getCredentials();
      if (!organizationId || !email || !passcode) {
        toast({
          variant: "error",
          message: "Missing organization credentials. Please refresh the page.",
        });
        return;
      }

      if (deploymentMode.value === "single") {
        launchSingleRegion(organizationId, email, passcode);
      } else {
        if (targetRegions.value.length === 0) {
          toast({
            variant: "warning",
            message: "Select at least one target region.",
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
        toast({
          variant: "warning",
          message: "CloudFormation template not available yet",
        });
        return;
      }

      window.open(url, "_blank", "noopener,noreferrer");
      segment.track("AWS Complete Integration Started", {
        mode: "single",
        region: selectedRegion.value,
        services: enabledServices.value,
      });
      toast({
        variant: "info",
        message: "Opening AWS Console to deploy complete integration stack",
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

      toast({
        variant: "info",
        message:
          "AWS StackSets console opened. Use the parameter values below to complete setup.",
        timeout: 5000,
      });
    };

    return {
      quickInstallBgClass,
      descriptionClass,
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
