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
  <div
    v-if="config"
    class="flex flex-col gap-1"
    data-test="workflow-http-example"
    data-o2-privacy="mask"
  >
    <OText as="label" class="text-xs font-medium">{{ t("workflow.http.exampleRequest") }}</OText>
    <OCodeBlock
      :code="code"
      lang="bash"
      sensitive
      padded
      wrap
      :copyable="false"
      class="my-0!"
      data-test="workflow-http-example-code"
    >
      <template #actions>
        <span
          v-if="active"
          class="text-text-secondary inline-flex min-w-0 items-center gap-1 pe-1 text-xs"
          data-test="workflow-http-example-credential"
        >
          <OIcon name="key" size="xs" class="shrink-0" />
          <OTruncatedText :tooltip="false">{{ credentialLabel }}</OTruncatedText>
        </span>
        <OButton
          v-if="canReveal && active"
          variant="ghost"
          size="icon-xs-sq"
          :loading="revealing === active.id"
          :aria-label="revealLabel"
          data-test="workflow-http-example-reveal"
          @click="toggleReveal"
        >
          <OIcon :name="shown !== undefined ? 'visibility-off' : 'visibility'" size="sm" />
          <OTooltip :content="revealLabel" side="top" />
        </OButton>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          :aria-label="t('common.copy')"
          data-test="workflow-http-example-copy"
          @click="onCopy"
        >
          <OIcon name="content-copy" size="sm" />
          <OTooltip :content="t('common.copy')" side="top" />
        </OButton>
      </template>
    </OCodeBlock>
    <OText variant="meta" as="p" data-test="workflow-http-example-hint">
      {{ isSigned ? t("workflow.http.exampleHintSigned") : t("workflow.http.exampleHintToken") }}
    </OText>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { DEFAULT_SAMPLE_BODY, buildSnippet, maskSecret } from "@/plugins/workflows/httpSnippets";
import { httpErrorText, useHttpEndpoint } from "@/plugins/workflows/httpEndpointUi";

const { t } = useI18nTyped();
const {
  config,
  permissions,
  activeCredential: active,
  revealedCredentials,
  revealing,
  revealCredential,
  hideCredential,
  copyExample,
} = useHttpEndpoint();

const isSigned = computed(() => config.value?.auth_mode === "signature");
const canReveal = computed(() => permissions.value.reveal);
const shown = computed(() =>
  active.value ? revealedCredentials.value[active.value.id] : undefined,
);

const secret = computed<string | null>(() => {
  if (!canReveal.value || !active.value) return null;
  return shown.value ?? maskSecret(active.value.display_prefix);
});

const code = computed(() =>
  config.value
    ? buildSnippet("curl", {
        url: config.value.url,
        mode: config.value.auth_mode,
        secret: secret.value,
        sampleBody: DEFAULT_SAMPLE_BODY,
      })
    : "",
);

const credentialLabel = computed(() => {
  const prefix = raw(active.value?.display_prefix ?? "");
  return isSigned.value
    ? t("workflow.http.exampleActiveSecret", { prefix })
    : t("workflow.http.exampleActiveToken", { prefix });
});

const revealLabel = computed(() => {
  if (shown.value !== undefined) return t("ingestion.setupCard.hideToken");
  return t("ingestion.setupCard.revealToken");
});

const toggleReveal = () => {
  const id = active.value?.id;
  if (!id) return;
  if (shown.value !== undefined) hideCredential(id);
  else void revealCredential(id);
};

const onCopy = async () => {
  const signed = isSigned.value;
  const copiesSecret = canReveal.value && !!active.value;
  try {
    const copied = await copyExample();
    if (!copied) {
      toast({ variant: "error", message: t("common.copyError") });
      return;
    }
    if (!copiesSecret) {
      toast({ variant: "success", message: t("common.copySuccess") });
      return;
    }
    toast({
      variant: "success",
      message: signed ? t("workflow.http.secretCopied") : t("workflow.http.tokenCopied"),
    });
  } catch (err) {
    const reason = httpErrorText(err, t);
    toast({
      variant: "error",
      message: signed
        ? t("workflow.http.revealFailedSigned", { reason })
        : t("workflow.http.revealFailed", { reason }),
    });
  }
};
</script>
