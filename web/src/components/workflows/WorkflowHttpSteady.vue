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
  <div v-if="config" class="flex flex-col gap-4" data-test="workflow-http-steady">
    <template v-if="!tokensOnly">
      <WorkflowHttpUrl :url="config.url" :region-host="config.region_host" />

      <div class="flex flex-wrap items-center gap-3">
        <OText as="span" class="text-text-secondary text-sm">{{
          t("workflow.http.authLabel")
        }}</OText>
        <OPopover v-model:open="switchOpen" side="bottom" align="start" :aria-label="switchTitle">
          <template #trigger>
            <span class="inline-flex">
              <span class="inline-flex" @click.stop>
                <OToggleGroup
                  :model-value="config.auth_mode"
                  :disabled="!permissions.edit || !permissions.reveal || saving"
                  data-test="workflow-http-auth-mode"
                  @update:model-value="onModeChange"
                >
                  <OToggleGroupItem value="token" size="sm" data-test="workflow-http-auth-token">
                    {{ t("workflow.http.authToken") }}
                  </OToggleGroupItem>
                  <OToggleGroupItem
                    value="signature"
                    size="sm"
                    data-test="workflow-http-auth-signed"
                  >
                    {{ t("workflow.http.authSigned") }}
                  </OToggleGroupItem>
                </OToggleGroup>
              </span>
            </span>
          </template>
          <div
            data-test="workflow-http-auth-switch-popover"
            class="flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
          >
            <OText variant="body-strong">{{ switchTitle }}</OText>
            <OText variant="meta" as="p">{{ switchBody }}</OText>
            <div class="flex justify-end gap-2">
              <OButton
                variant="outline"
                size="sm-action"
                data-test="workflow-http-auth-switch-cancel"
                @click="switchOpen = false"
              >
                {{ t("common.cancel") }}
              </OButton>
              <OButton
                variant="primary"
                size="sm-action"
                :loading="saving"
                data-test="workflow-http-auth-switch-confirm"
                @click="confirmSwitch"
              >
                {{ t("common.confirm") }}
              </OButton>
            </div>
          </div>
        </OPopover>
        <OPopover side="bottom" align="start" :aria-label="t('workflow.http.authAbout')">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              :aria-label="t('workflow.http.authAbout')"
              data-test="workflow-http-auth-info"
            >
              <OIcon name="info" size="sm" />
            </OButton>
          </template>
          <OText variant="meta" as="p" class="w-80 max-w-[calc(100vw-1.5rem)] p-3">
            {{ t("workflow.http.authInfo", { headers: signedHeaders }) }}
          </OText>
        </OPopover>
      </div>

      <WorkflowHttpExample />
    </template>

    <OBanner
      v-if="actionError"
      variant="error-soft"
      dense
      data-test="workflow-http-steady-error"
      :content="actionError"
    />

    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <OText as="span" class="text-text-secondary min-w-0 flex-1 text-sm">
          {{ isSigned ? t("workflow.http.secretsTitle") : t("workflow.http.tokensTitle") }}
        </OText>
        <template v-if="canRunTest">
          <!-- Wrapper mode: a child tooltip after icon-left anchors to the icon alone -->
          <OTooltip
            v-if="context === 'editor'"
            :content="t(runTestHint)"
            side="top"
            data-test="workflow-http-run-test-tooltip"
          >
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="science"
              data-test="workflow-http-run-test"
              @click="emit('run-test')"
            >
              {{ t("workflow.http.runTest") }}
            </OButton>
          </OTooltip>
          <OText v-else variant="meta" data-test="workflow-http-run-test-list-hint">
            {{ t(runTestHint) }}
          </OText>
        </template>
        <WorkflowHttpRotatePopover
          v-if="permissions.edit && permissions.reveal"
          v-model:open="rotateOpen"
          :mode="config.auth_mode"
          :current="activeCredential"
          :disabled="rotateBlocked"
          :pending="rotating"
          :error="rotateError"
          @confirm="onRotate"
          @cancel="rotateError = null"
        />
      </div>
      <WorkflowHttpCredentialsTable
        :credentials="credentials"
        :mode="config.auth_mode"
        :can-edit="permissions.edit"
        :can-reveal="permissions.reveal"
        :revoking="revoking"
        :revealed="revealedCredentials"
        :revealing="revealing"
        :reveal-error="revealError"
        @reveal="revealCredential"
        @hide="hideCredential"
        @copy="onCopy"
        @revoke="onRevoke"
      />
      <OBanner
        v-if="storageWarning"
        variant="warning"
        dense
        data-test="workflow-http-secret-storage-warning"
        :content="t('workflow.http.secretStorageWarning')"
      />
    </div>

    <template v-if="!tokensOnly">
      <WorkflowHttpAdvanced v-if="permissions.edit" ref="advanced" v-model:open="advancedOpen" />
      <WorkflowHttpRejections
        :rejections="config.rejections"
        :trigger-limit="config.rate_limit_per_minute"
        :org-budget="config.org_rate_limit_per_minute"
        :max-body-bytes="config.max_body_bytes"
        :loading="refreshing"
        :error="rejectionsError"
        :can-raise="permissions.edit"
        :can-rotate="canRotate"
        @rotate="openRotate"
        @raise-limit="raiseLimit"
        @refresh="onRefresh"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { HttpAuthMode, OverlapSeconds } from "@/services/workflows";
import type { EndpointContext } from "@/plugins/workflows/useWorkflowHttpEndpoint";
import { httpErrorText, useHttpEndpoint } from "@/plugins/workflows/httpEndpointUi";
import WorkflowHttpAdvanced from "./WorkflowHttpAdvanced.vue";
import WorkflowHttpCredentialsTable from "./WorkflowHttpCredentialsTable.vue";
import WorkflowHttpExample from "./WorkflowHttpExample.vue";
import WorkflowHttpRejections from "./WorkflowHttpRejections.vue";
import WorkflowHttpRotatePopover from "./WorkflowHttpRotatePopover.vue";
import WorkflowHttpUrl from "./WorkflowHttpUrl.vue";

defineProps<{
  context: EndpointContext;
  /** The rotate reveal shows only the tokens block under the new value. */
  tokensOnly?: boolean;
}>();

const emit = defineEmits<{ (e: "run-test"): void }>();

const { t } = useI18nTyped();
const {
  config,
  permissions,
  credentials,
  activeCredential,
  storageWarning,
  canRunTest,
  canRotate,
  runTestHint,
  rotateBlocked,
  revealedCredentials,
  revealing,
  revealError,
  revoking,
  saving,
  rotating,
  revealCredential,
  hideCredential,
  copyCredential,
  switchMode,
  rotate,
  revoke,
  refresh,
} = useHttpEndpoint();

const signedHeaders = raw("webhook-id, webhook-timestamp, webhook-signature");

const switchOpen = ref(false);
const pendingMode = ref<HttpAuthMode>("token");
const rotateOpen = ref(false);
const rotateError = ref<string | null>(null);
const advancedOpen = ref(false);
const advanced = ref<InstanceType<typeof WorkflowHttpAdvanced> | null>(null);
const actionError = ref<I18nText | null>(null);
const refreshing = ref(false);
const rejectionsError = ref(false);

const isSigned = computed(() => config.value?.auth_mode === "signature");
const switchTitle = computed(() =>
  pendingMode.value === "signature"
    ? t("workflow.http.switchToSignedTitle")
    : t("workflow.http.switchToTokenTitle"),
);
const switchBody = computed(() =>
  pendingMode.value === "signature"
    ? t("workflow.http.switchToSignedBody")
    : t("workflow.http.switchToTokenBody"),
);

const onModeChange = (value: unknown) => {
  if ((value !== "token" && value !== "signature") || value === config.value?.auth_mode) return;
  pendingMode.value = value;
  switchOpen.value = true;
};

const confirmSwitch = async () => {
  actionError.value = null;
  try {
    await switchMode(pendingMode.value);
  } catch (err) {
    actionError.value = t("workflow.http.changeFailed", { reason: httpErrorText(err, t) });
  } finally {
    switchOpen.value = false;
  }
};

const onRotate = async (overlap: OverlapSeconds) => {
  rotateError.value = null;
  try {
    await rotate(overlap);
    rotateOpen.value = false;
  } catch (err) {
    rotateError.value = httpErrorText(err, t);
  }
};

const openRotate = () => {
  if (rotateBlocked.value) return;
  rotateError.value = null;
  rotateOpen.value = true;
};

const raiseLimit = () => {
  void advanced.value?.focusRateLimit();
};

const onCopy = async (id: string) => {
  try {
    const copied = await copyCredential(id);
    if (!copied) {
      toast({ variant: "error", message: t("common.copyError") });
      return;
    }
    toast({
      variant: "success",
      message: isSigned.value ? t("workflow.http.secretCopied") : t("workflow.http.tokenCopied"),
    });
  } catch (err) {
    const reason = httpErrorText(err, t);
    toast({
      variant: "error",
      message: isSigned.value
        ? t("workflow.http.revealFailedSigned", { reason })
        : t("workflow.http.revealFailed", { reason }),
    });
  }
};

const onRevoke = async (id: string) => {
  actionError.value = null;
  try {
    await revoke(id);
  } catch (err) {
    actionError.value = t("workflow.http.revokeFailed", { reason: httpErrorText(err, t) });
  }
};

const onRefresh = async () => {
  refreshing.value = true;
  try {
    rejectionsError.value = !(await refresh());
  } finally {
    refreshing.value = false;
  }
};
</script>
