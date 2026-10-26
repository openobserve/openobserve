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
  <section
    data-test="workflow-http-section"
    class="border-border-default bg-surface-base rounded-surface flex flex-col border"
  >
    <div class="flex items-start gap-3 p-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <OText variant="body-strong">{{ t("workflow.http.acceptRequests") }}</OText>
        <OSkeleton v-if="phase === 'loading'" class="h-3 w-48" data-test="workflow-http-loading" />
        <OText
          v-else-if="lastCall !== undefined"
          variant="meta"
          as="p"
          data-test="workflow-http-meta"
        >
          <i18n-t
            v-if="lastCall"
            keypath="workflow.http.lastCall"
            tag="span"
            scope="global"
            data-test="workflow-http-last-call"
          >
            <template #status>
              <span :class="lastCallClass" data-test="workflow-http-last-call-status">
                {{ t(LAST_CALL_STATUS_KEYS[lastCall.status]) }}
              </span>
            </template>
            <template #time>
              <OTimeCell
                :value="lastCall.received_at"
                unit="us"
                mode="absolute"
                :format="RUN_TIME_SHORT"
                :timezone="store.state.timezone"
              />
            </template>
            <template #link>
              <RouterLink
                :to="runsLink(lastCall.run_id)"
                class="text-accent hover:underline"
                data-test="workflow-http-last-call-link"
              >
                {{ t("workflow.http.viewRun") }}
              </RouterLink>
            </template>
          </i18n-t>
          <span v-else data-test="workflow-http-last-call">{{
            t(isDraftOnly ? "workflow.http.lastCallNoneDraft" : "workflow.http.lastCallNone")
          }}</span>
        </OText>
        <OText v-else variant="meta" as="p" :data-test="metaTestId">{{ metaText }}</OText>
      </div>
      <OButton
        v-if="phase === 'error'"
        variant="outline"
        size="xs"
        data-test="workflow-http-retry"
        @click="refresh"
      >
        {{ t("common.retry") }}
      </OButton>
      <OSkeleton v-else-if="phase === 'loading'" class="h-5 w-9 rounded-full" />
      <OPopover
        v-else-if="switchOn"
        v-model:open="disableOpen"
        side="bottom"
        align="end"
        :aria-label="t('workflow.http.disableTitle')"
      >
        <template #trigger>
          <span class="inline-flex">
            <span class="inline-flex" @click.stop>
              <OSwitch
                :model-value="true"
                :disabled="!permissions.edit || saving"
                data-test="workflow-http-toggle"
                @update:model-value="onToggle"
              />
            </span>
          </span>
        </template>
        <div
          data-test="workflow-http-disable-popover"
          class="flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
        >
          <OText variant="body-strong">{{ t("workflow.http.disableTitle") }}</OText>
          <OText variant="meta" as="p">{{ t("workflow.http.disableBody") }}</OText>
          <div class="flex justify-end gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              data-test="workflow-http-disable-cancel"
              @click="disableOpen = false"
            >
              {{ t("common.cancel") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              :loading="saving"
              data-test="workflow-http-disable-confirm"
              @click="confirmTurnOff"
            >
              {{ t("workflow.http.disableConfirm") }}
            </OButton>
          </div>
        </div>
      </OPopover>
      <OSwitch
        v-else-if="phase !== 'unsaved'"
        :model-value="false"
        :disabled="!canTurnOn || saving"
        data-test="workflow-http-toggle"
        @update:model-value="onToggle"
      />
    </div>

    <div v-if="hasBody" class="border-border-default flex flex-col gap-4 border-t p-4">
      <OBanner
        v-if="actionError"
        variant="error-soft"
        dense
        data-test="workflow-http-error"
        :content="actionError"
      />
      <OText v-if="endpointExists" variant="meta" as="p" data-test="workflow-http-exists-hint">
        {{ existsHint }}
      </OText>
      <OButton
        v-if="phase === 'unsaved' && canTurnOn"
        variant="primary"
        size="sm-action"
        class="self-start"
        :loading="creating"
        data-test="workflow-http-save-and-create"
        @click="onSaveAndCreate"
      >
        {{ t("workflow.http.saveAndCreate") }}
      </OButton>
      <OBanner
        v-if="showDraftNotice"
        variant="warning"
        dense
        data-test="workflow-http-draft-banner"
        :content="t('workflow.http.draftBanner')"
      />
      <OBanner
        v-else-if="status === 'paused'"
        variant="warning"
        dense
        data-test="workflow-http-disabled-banner"
        :content="t('workflow.http.disabledBanner')"
      />
      <WorkflowHttpReveal
        v-if="phase === 'revealing'"
        :context="context"
        :refusal="refusal"
        @run-test="onRunTest"
      >
        <WorkflowHttpSteady
          v-if="revealKind === 'rotated'"
          :context="context"
          tokens-only
          @run-test="onRunTest"
        />
      </WorkflowHttpReveal>
      <WorkflowHttpSteady v-else-if="phase === 'steady'" :context="context" @run-test="onRunTest" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, provide, ref, toRef } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OText from "@/lib/core/Typography/OText.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { RUN_TIME_SHORT } from "@/plugins/workflows/runStatus";
import {
  useWorkflowHttpEndpoint,
  type EndpointContext,
} from "@/plugins/workflows/useWorkflowHttpEndpoint";
import {
  HTTP_ENDPOINT_KEY,
  HttpEndpointError,
  LAST_CALL_STATUS_KEYS,
  httpErrorText,
} from "@/plugins/workflows/httpEndpointUi";
import WorkflowHttpReveal from "./WorkflowHttpReveal.vue";
import WorkflowHttpSteady from "./WorkflowHttpSteady.vue";

const props = defineProps<{
  workflowId: string | null;
  workflowName: string;
  isDraftOnly: boolean;
  workflowEnabled: boolean;
  context: EndpointContext;
  beforeCreate?: () => Promise<boolean>;
  /** Run test reads the latest HTTP run's input from this step. */
  triggerNodeId?: string;
}>();

const emit = defineEmits<{ (e: "run-test", seed: unknown[], runAt?: number): void }>();

const { t } = useI18nTyped();
const store = useStore();

const endpoint = useWorkflowHttpEndpoint({
  workflowId: toRef(props, "workflowId"),
  isDraftOnly: toRef(props, "isDraftOnly"),
  workflowEnabled: toRef(props, "workflowEnabled"),
  context: props.context,
  beforeCreate: props.beforeCreate,
});
provide(HTTP_ENDPOINT_KEY, endpoint);
const {
  phase,
  status,
  config,
  permissions,
  canTurnOn,
  saving,
  endpointExists,
  revealKind,
  refresh,
} = endpoint;

const actionError = ref<I18nText | null>(null);
const disableOpen = ref(false);
const creating = ref(false);

const switchOn = computed(() => phase.value === "revealing" || !!config.value?.enabled);
const refusal = computed<"draft" | "paused" | null>(() => {
  if (props.isDraftOnly) return "draft";
  return status.value === "paused" ? "paused" : null;
});
// A draft refuses calls whether or not the endpoint is on, so the notice does not wait for it.
const showDraftNotice = computed(() => props.isDraftOnly && phase.value !== "loading");
const hasBody = computed(
  () =>
    phase.value === "unsaved" ||
    phase.value === "revealing" ||
    phase.value === "steady" ||
    showDraftNotice.value ||
    !!actionError.value ||
    endpointExists.value,
);

// The status line replaces the meta only for an editor looking at a live endpoint.
const lastCall = computed(() => {
  if (phase.value !== "steady" || !permissions.value.edit) return undefined;
  return config.value?.last_call ?? null;
});
const lastCallClass = computed(() => {
  const s = lastCall.value?.status;
  if (s === "succeeded") return "text-status-positive";
  if (s === "failed") return "text-status-negative";
  return "";
});

const metaText = computed<I18nText>(() => {
  switch (phase.value) {
    case "unsaved":
      return canTurnOn.value ? t("workflow.http.unsavedBody") : t("workflow.http.needsAdmin");
    case "error":
      return t("workflow.http.loadError");
    case "revealing":
    case "steady":
      return permissions.value.edit ? t("workflow.http.onMeta") : t("workflow.http.readOnlyOnMeta");
    default:
      if (!permissions.value.edit) return t("workflow.http.needsEdit");
      return canTurnOn.value ? t("workflow.http.offBody") : t("workflow.http.needsAdmin");
  }
});
const metaTestId = computed(() =>
  phase.value === "unsaved" && !canTurnOn.value
    ? "workflow-http-needs-admin"
    : "workflow-http-meta",
);
const existsHint = computed(() =>
  config.value?.auth_mode === "signature"
    ? t("workflow.http.endpointExistsHintSigned")
    : t("workflow.http.endpointExistsHint"),
);

const runsLink = (runId: string) => ({
  name: "workflowRuns",
  query: {
    id: props.workflowId,
    name: props.workflowName,
    org_identifier: store.state.selectedOrganization.identifier,
    run_id: runId,
  },
});

const turnOn = async () => {
  actionError.value = null;
  try {
    await endpoint.turnOn();
  } catch (err) {
    actionError.value =
      err instanceof HttpEndpointError && err.key === "workflow.http.createForbidden"
        ? t(err.key)
        : t("workflow.http.turnOnFailed", { reason: httpErrorText(err, t) });
  }
};

const onToggle = async (value: unknown) => {
  if (value !== true) {
    disableOpen.value = true;
    return;
  }
  await turnOn();
};

const onSaveAndCreate = async () => {
  creating.value = true;
  try {
    await turnOn();
  } finally {
    creating.value = false;
  }
};

const confirmTurnOff = async () => {
  actionError.value = null;
  try {
    await endpoint.turnOff();
    endpoint.endReveal();
  } catch (err) {
    actionError.value = t("workflow.http.changeFailed", { reason: httpErrorText(err, t) });
  } finally {
    disableOpen.value = false;
  }
};

const onRunTest = async () => {
  const action = await endpoint.runTest(props.triggerNodeId);
  if (action.kind === "open_test") emit("run-test", action.seed, action.runAt);
};
</script>
