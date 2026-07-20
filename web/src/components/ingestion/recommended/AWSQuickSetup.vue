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
    <div class="setup-card max-w-225 mx-auto">
      <!-- Header -->
      <div class="mb-6 p-4 rounded-lg" :class="quickInstallBgClass">
        <div class="flex items-start gap-3">
          <OIcon
            name="rocket-launch"
            size="xl"
            class="text-text-link"
          />
          <div>
            <h6 class="text-xl! font-bold m-0 mb-2!">
              Complete AWS Integration
            </h6>
            <p class="text-sm mt-0 mb-0" :class="descriptionClass">
              Deploy all selected AWS services in one click using a single
              CloudFormation stack.
            </p>
          </div>
        </div>
      </div>

      <!-- Deployment Mode Toggle -->
      <div class="mb-6">
        <div class="mb-3 font-semibold text-[0.9rem]" :class="stepLabelClass">Deployment mode</div>
        <OToggleGroup
          v-model="deploymentMode"
          data-test="aws-deployment-mode-toggle"
        >
          <OToggleGroupItem value="single">Single Region</OToggleGroupItem>
          <OToggleGroupItem value="stackset"
            >Multi-Region (StackSets)</OToggleGroupItem
          >
        </OToggleGroup>
        <div class="mt-2 text-xs" :class="hintTextClass">
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
      <div class="mb-6">
        <div
          class="flex items-center justify-between cursor-pointer py-2 px-3 rounded"
          :class="collapsibleHeaderClass"
          @click="showServices = !showServices"
        >
          <div class="flex items-center gap-2">
            <OIcon
              :name="showServices ? 'expand-less' : 'expand-more'" size="sm"
              color="primary"
            />
            <div class="font-semibold text-[0.9rem]" :class="stepLabelClass">Select services to monitor</div>
            <OTag type="countChip" value="accent">
              {{ enabledServices.length }} /
              {{ QUICK_SETUP_SERVICES.length }} selected
            </OTag>
          </div>
          <div class="flex gap-2" @click.stop>
            <OButton variant="ghost-primary" size="xs" @click="selectAll"
              >Select all</OButton
            >
            <OButton variant="ghost-primary" size="xs" @click="deselectAll"
              >Deselect all</OButton
            >
          </div>
        </div>

        <div
          class="grid transition-[grid-template-rows] duration-300 ease-in-out"
          :class="showServices ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        >
          <div class="overflow-hidden min-h-0">
            <div class="mt-3">
              <div class="grid grid-cols-4 gap-x-4 gap-y-2">
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
      <div v-if="deploymentMode === 'single'" class="mb-6">
        <div class="mb-3 font-semibold text-[0.9rem]" :class="stepLabelClass">Deployment region</div>
        <OSelect
          v-model="selectedRegion"
          :options="AWS_REGIONS"
          valueKey="value"
          labelKey="label"
          class="max-w-xs"
          data-test="aws-region-select"
        />
      </div>

      <!-- StackSets: admin + target regions -->
      <template v-else>
        <div class="mb-6">
          <div class="mb-3 font-semibold text-[0.9rem]" :class="stepLabelClass">
            Admin region
            <span class="font-normal text-xs text-text-muted"
              >(where the StackSet is managed)</span
            >
          </div>
          <OSelect
            v-model="selectedRegion"
            :options="AWS_REGIONS"
            valueKey="value"
            labelKey="label"
            class="max-w-xs"
            data-test="aws-admin-region-select"
          />
        </div>

        <div class="mb-6">
          <div
            class="flex items-center justify-between cursor-pointer py-2 px-3 rounded"
          :class="collapsibleHeaderClass"
            @click="showTargetRegions = !showTargetRegions"
          >
            <div class="flex items-center gap-2">
              <OIcon
                :name="showTargetRegions ? 'expand-less' : 'expand-more'" size="sm"
                color="primary"
              />
              <div class="font-semibold text-[0.9rem]" :class="stepLabelClass">
                Target regions
                <span class="font-normal text-xs text-text-muted"
                  >(where stacks will be deployed)</span
                >
              </div>
              <OTag
                v-if="targetRegions.length > 0"
                type="countChip"
                value="accent"
                >{{ targetRegions.length }} selected</OTag
              >
            </div>
            <div class="flex gap-2" @click.stop>
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
            class="grid transition-[grid-template-rows] duration-300 ease-in-out"
            :class="showTargetRegions ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
          >
            <div class="overflow-hidden min-h-0">
              <div class="mt-3">
                <div class="grid grid-cols-3 gap-x-4 gap-y-2">
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

        <div class="mb-6">
          <div class="mb-3 font-semibold text-[0.9rem]" :class="stepLabelClass">Deployment model</div>
          <OToggleGroup
            v-model="stackSetModel"
            data-test="aws-stackset-model-toggle"
          >
            <OToggleGroupItem value="self">Self-managed</OToggleGroupItem>
            <OToggleGroupItem value="service"
              >Service-managed (AWS Organizations)</OToggleGroupItem
            >
          </OToggleGroup>
          <div class="mt-2 text-xs" :class="hintTextClass">
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
      <div class="flex items-center gap-3 mb-6">
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
          class="text-sm text-status-error-text"
        >
          Select at least one service
        </span>
        <span
          v-else-if="
            deploymentMode === 'stackset' && targetRegions.length === 0
          "
          class="text-sm text-status-error-text"
        >
          Select at least one target region
        </span>
        <span v-else class="text-sm" :class="hintTextClass">
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
        class="grid transition-[grid-template-rows] duration-300 ease-in-out"
        :class="(showParamHelper && deploymentMode === 'stackset') ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
      >
        <div class="overflow-hidden min-h-0">
        <div>
          <OSeparator class="mb-4" />
          <div class="rounded-lg p-4" :class="paramHelperClass">
            <div class="flex items-center justify-between mb-3">
              <div class="font-semibold text-[0.9rem]" :class="stepLabelClass">
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
            <p class="text-xs mb-3" :class="hintTextClass">
              The StackSets console doesn't support URL pre-fill. Enter these
              values as you go through the wizard.
            </p>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="param in stackSetParams"
                :key="param.key"
                class="flex items-center gap-3 py-1.5 px-2.5 rounded text-xs font-mono"
                :class="paramRowClass"
              >
                <div class="min-w-60 font-semibold shrink-0" :class="paramKeyClass">{{ param.key }}</div>
                <div class="flex items-center gap-1 flex-1 overflow-hidden">
                  <span class="overflow-hidden text-ellipsis whitespace-nowrap flex-1" :class="paramValTextClass">{{ param.value }}</span>
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
            <div class="mt-3">
              <div class="font-semibold text-xs mb-1" :class="stepLabelClass">
                Target regions to enter in "Deployment targets":
              </div>
              <div class="flex flex-wrap gap-1 mt-1">
                <OTag
                  v-for="r in targetRegions"
                  :key="r"
                  type="fieldTag"
                  value="primarysm"
                  >{{ r }}</OTag
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
import OTag from "@/lib/core/Badge/OTag.vue";
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
    OTag,
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

    // Design tokens resolve per-theme on their own, so none of these branch on
    // store.state.theme any more — they were eight computeds returning hardcoded
    // hex/palette colors (plus a banned --o2-border) for exactly that reason.
    const quickInstallBgClass = "bg-status-info-bg border border-border-default";
    const descriptionClass = "text-text-secondary";
    const stepLabelClass = "text-text-heading";
    const hintTextClass = "text-text-secondary";
    const collapsibleHeaderClass =
      "bg-surface-subtle border border-border-default hover:bg-surface-subtle-hover";
    const paramHelperClass = "bg-surface-subtle";
    const paramRowClass = "bg-surface-base border border-border-default";
    const paramKeyClass = "text-text-heading";
    const paramValTextClass = "text-text-secondary";

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

    const launchStackSet = (_organizationId?: string) => {
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
      stepLabelClass,
      hintTextClass,
      collapsibleHeaderClass,
      paramHelperClass,
      paramRowClass,
      paramKeyClass,
      paramValTextClass,
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
