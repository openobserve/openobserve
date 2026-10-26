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
  <div data-test="workflow-http-reveal" data-o2-privacy="mask" class="flex flex-col gap-4">
    <OBanner variant="success" icon="check-circle" data-test="workflow-http-reveal-banner">
      <div class="flex flex-col gap-1">
        <OText variant="body-strong">{{ bannerTitle }}</OText>
        <OText variant="meta" as="p" class="leading-snug">{{ bannerBody }}</OText>
      </div>
    </OBanner>

    <WorkflowHttpUrl
      v-if="config && !rotated"
      :url="config.url"
      :region-host="config.region_host"
    />

    <div class="flex flex-col gap-1">
      <OText as="label" class="text-xs font-medium">{{ secretLabel }}</OText>
      <OCodeBlock
        :code="secret"
        :code-masked="maskedSecret"
        lang="text"
        padded
        :reveal-tooltip="t('ingestion.setupCard.revealToken')"
        :hide-tooltip="t('ingestion.setupCard.hideToken')"
        :copy-message="isSigned ? t('workflow.http.secretCopied') : t('workflow.http.tokenCopied')"
        data-test="workflow-http-token"
        data-o2-privacy="mask"
      />
      <OText variant="meta" as="p" data-test="workflow-http-secret-hint">
        <i18n-t
          :keypath="isSigned ? 'workflow.http.secretHint' : 'workflow.http.tokenHint'"
          tag="span"
          scope="global"
        >
          <template #header>
            <OText variant="mono">{{ BEARER_HEADER }}</OText>
          </template>
          <template #headers>
            <OText variant="mono">{{ SIGNATURE_HEADERS }}</OText>
          </template>
        </i18n-t>
      </OText>
    </div>

    <WorkflowHttpSnippets
      v-if="config && !rotated"
      :url="config.url"
      :mode="mode"
      :secret="secret"
      :display-prefix="displayPrefix"
      :sample-body="DEFAULT_SAMPLE_BODY"
    />

    <!-- A draft's URL can only answer 403, so the dry run has nothing to show -->
    <div v-if="!rotated && refusal !== 'draft'" class="flex flex-wrap items-center gap-3">
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="send"
        :loading="sending"
        data-test="workflow-http-send-test"
        @click="send"
      >
        {{ t("workflow.http.sendTest") }}
      </OButton>
      <OText variant="meta" class="min-w-0 flex-1" data-test="workflow-http-send-test-hint">
        {{
          refusal === "paused"
            ? t("workflow.http.sendTestHintPaused")
            : t("workflow.http.sendTestHint")
        }}
      </OText>
    </div>

    <div
      v-if="!rotated && (result || sendError)"
      data-test="workflow-http-test-result"
      class="border-border-default rounded-default flex flex-col gap-2 border p-3"
    >
      <OText v-if="sendError" variant="meta" as="p" class="text-status-negative">
        {{ sendError }}
      </OText>
      <template v-else-if="result">
        <div class="flex flex-wrap items-center gap-2">
          <OTag
            type="httpStatus"
            :value="httpStatusBucket(result.status)"
            :label="raw(result.status)"
          />
          <OText variant="body-strong">{{ resultTitle }}</OText>
          <OText v-if="accepted" variant="meta">{{ resultMeta }}</OText>
          <OButton
            v-if="refusedByState && canRunTestHere"
            variant="ghost-primary"
            size="xs"
            data-test="workflow-http-run-test-instead"
            @click="emit('run-test')"
          >
            {{ t("workflow.http.runTestInstead") }}
          </OButton>
        </div>
        <OCollapsible
          v-if="result.input"
          :label="t('workflow.http.dryRunInput')"
          default-open
          data-test="workflow-http-test-input"
        >
          <OCodeBlock :code="inputText" lang="json" padded wrap />
        </OCollapsible>
      </template>
    </div>

    <slot />

    <div class="flex justify-end">
      <OButton
        variant="primary"
        size="sm-action"
        data-test="workflow-http-reveal-done"
        @click="endReveal"
      >
        {{ t("workflow.http.done") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { httpStatusBucket } from "@/lib/core/Badge/badgeGroups";
import type { DryRunResult } from "@/services/workflows";
import { DEFAULT_SAMPLE_BODY, maskSecret } from "@/plugins/workflows/httpSnippets";
import {
  HOOK_REASON_KEYS,
  formatBodySize,
  httpErrorText,
  useHttpEndpoint,
} from "@/plugins/workflows/httpEndpointUi";
import type { EndpointContext } from "@/plugins/workflows/useWorkflowHttpEndpoint";
import WorkflowHttpSnippets from "./WorkflowHttpSnippets.vue";
import WorkflowHttpUrl from "./WorkflowHttpUrl.vue";

const BEARER_HEADER = "Authorization: Bearer <token>";
const SIGNATURE_HEADERS = "webhook-id, webhook-timestamp, webhook-signature";

const props = defineProps<{
  context: EndpointContext;
  /** Draft or paused: the server refuses the call before any input is built. */
  refusal: "draft" | "paused" | null;
}>();

const emit = defineEmits<{ (e: "run-test"): void }>();

const { t } = useI18nTyped();
const { config, revealedSecret, revealKind, activeCredential, canRunTest, sendTest, endReveal } =
  useHttpEndpoint();

const sending = ref(false);
const result = ref<DryRunResult | null>(null);
const sendError = ref<I18nText | null>(null);

const secret = computed(() => revealedSecret.value ?? "");
// A rotation keeps the URL and the caller's setup, so only the new value and the tokens show.
const rotated = computed(() => revealKind.value === "rotated");
const mode = computed(() => config.value?.auth_mode ?? "token");
const isSigned = computed(() => mode.value === "signature");
// Until the refetch lands the active row is still the old credential, so its prefix must match the value.
const displayPrefix = computed(() => {
  const fromValue = `${secret.value.slice(0, 9)}…${secret.value.slice(-4)}`;
  const stored = activeCredential.value?.display_prefix;
  return stored?.startsWith(secret.value.slice(0, 9)) ? stored : fromValue;
});
const maskedSecret = computed(() => maskSecret(displayPrefix.value));

const bannerTitle = computed(() => {
  if (revealKind.value === "rotated")
    return isSigned.value
      ? t("workflow.http.rotateBannerTitleSigned")
      : t("workflow.http.rotateBannerTitle");
  if (revealKind.value === "switched")
    return isSigned.value
      ? t("workflow.http.switchedBannerTitleSigned")
      : t("workflow.http.switchedBannerTitle");
  return t("workflow.http.revealBannerTitle");
});
const bannerBody = computed(() => {
  if (revealKind.value === "rotated")
    return isSigned.value
      ? t("workflow.http.rotateBannerBodySigned")
      : t("workflow.http.rotateBannerBody");
  return isSigned.value
    ? t("workflow.http.revealBannerBodySigned")
    : t("workflow.http.revealBannerBody");
});
const secretLabel = computed(() => {
  if (isSigned.value)
    return rotated.value ? t("workflow.http.newSecretLabel") : t("workflow.http.secretLabel");
  return rotated.value ? t("workflow.http.newTokenLabel") : t("workflow.http.tokenLabel");
});

const accepted = computed(() => !!result.value && result.value.status < 300);
const refusedByState = computed(
  () =>
    result.value?.reason === "workflow_not_published" ||
    result.value?.reason === "workflow_disabled",
);
const canRunTestHere = computed(() => props.context === "editor" && canRunTest.value);
const resultTitle = computed<I18nText>(() => {
  const r = result.value;
  if (!r) return raw("");
  if (accepted.value) return t("workflow.http.dryRunAccepted");
  if (r.reason === "workflow_disabled") return t("workflow.http.dryRunRefusedPaused");
  if (refusedByState.value) return t("workflow.http.dryRunRefused");
  if (r.reason === "rate_limited") return t("workflow.http.dryRunRateLimited");
  if (r.reason && r.reason !== "unauthorized") return t(HOOK_REASON_KEYS[r.reason].title);
  return t("workflow.http.dryRunStatus", { status: r.status });
});
const resultMeta = computed(() =>
  t("workflow.http.dryRunMeta", { size: formatBodySize(result.value?.bodyBytes ?? 0, t) }),
);
const inputText = computed(() => JSON.stringify(result.value?.input ?? {}, null, 2));

const send = async () => {
  sending.value = true;
  sendError.value = null;
  try {
    result.value = await sendTest();
  } catch (err) {
    result.value = null;
    sendError.value = t("workflow.http.dryRunFailed", { reason: httpErrorText(err, t) });
  } finally {
    sending.value = false;
  }
};
</script>
