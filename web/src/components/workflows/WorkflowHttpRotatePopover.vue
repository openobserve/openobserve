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
  <OButton
    v-if="disabled"
    variant="outline"
    size="sm-action"
    icon-left="refresh"
    disabled
    focusable-unavailable
    data-test="workflow-http-rotate"
  >
    {{ t("workflow.http.rotate") }}
    <OTooltip
      :content="
        isSigned ? t('workflow.http.rotateBlockedSigned') : t('workflow.http.rotateBlocked')
      "
      side="top"
      data-test="workflow-http-rotate-blocked-tooltip"
    />
  </OButton>
  <OPopover v-else v-model:open="open" side="bottom" align="end" :aria-label="title">
    <template #trigger>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="refresh"
        data-test="workflow-http-rotate"
      >
        {{ t("workflow.http.rotate") }}
      </OButton>
    </template>
    <div
      data-test="workflow-http-rotate-popover"
      class="flex w-[min(23rem,calc(100vw-1.5rem))] flex-col gap-3 p-4"
    >
      <div class="flex flex-col gap-1">
        <OText variant="body-strong">{{ title }}</OText>
        <OText variant="meta" as="p">{{ lead }}</OText>
      </div>
      <ORadioGroup v-model="overlap" orientation="vertical" :label="title">
        <ORadio
          v-for="option in OVERLAP_OPTIONS"
          :key="option.value"
          :value="option.value"
          :label="t(option.labelKey)"
          :data-test="`workflow-http-rotate-overlap-${option.value}`"
        />
      </ORadioGroup>
      <OBanner
        variant="info"
        dense
        data-test="workflow-http-rotate-consequence"
        :content="consequence"
      />
      <OBanner
        v-if="error"
        variant="error-soft"
        dense
        data-test="workflow-http-rotate-error"
        :content="t('workflow.http.rotateFailed', { reason: raw(error) })"
      />
      <div class="flex justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          data-test="workflow-http-rotate-cancel"
          @click="cancel"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :loading="pending"
          data-test="workflow-http-rotate-confirm"
          @click="emit('confirm', overlap)"
        >
          {{ isSigned ? t("workflow.http.rotateConfirmSigned") : t("workflow.http.rotateConfirm") }}
        </OButton>
      </div>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { formatTimestampInTimezone } from "@/utils/date";
import type { HttpAuthMode, HttpCredential, OverlapSeconds } from "@/services/workflows";
import { OVERLAP_OPTIONS } from "@/plugins/workflows/httpEndpointUi";

const DEFAULT_OVERLAP: OverlapSeconds = 86400;
const TIME_FORMAT = "MMM D, HH:mm";

const props = defineProps<{
  mode: HttpAuthMode;
  current: HttpCredential | undefined;
  /** A credential is retiring, so the server refuses a second rotation. */
  disabled: boolean;
  pending: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (e: "confirm", overlap: OverlapSeconds): void;
  (e: "cancel"): void;
}>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const store = useStore();

const overlap = ref<OverlapSeconds>(DEFAULT_OVERLAP);

const isSigned = computed(() => props.mode === "signature");
const title = computed(() =>
  isSigned.value ? t("workflow.http.rotateTitleSigned") : t("workflow.http.rotateTitle"),
);
const formatTime = (us: number) =>
  raw(formatTimestampInTimezone(us, TIME_FORMAT, store.state.timezone));

const lead = computed(() => {
  const prefix = raw(props.current?.display_prefix ?? "");
  const used = props.current?.last_used_at;
  if (!used) {
    return isSigned.value
      ? t("workflow.http.rotateLeadUnusedSigned", { prefix })
      : t("workflow.http.rotateLeadUnused", { prefix });
  }
  const params = { prefix, time: formatTime(used) };
  return isSigned.value
    ? t("workflow.http.rotateLeadSigned", params)
    : t("workflow.http.rotateLead", params);
});

const consequence = computed(() => {
  if (overlap.value === 0) {
    return isSigned.value
      ? t("workflow.http.rotateConsequenceNowSigned")
      : t("workflow.http.rotateConsequenceNow");
  }
  const time = formatTime((Date.now() + overlap.value * 1000) * 1000);
  return isSigned.value
    ? t("workflow.http.rotateConsequenceSigned", { time })
    : t("workflow.http.rotateConsequence", { time });
});

const cancel = () => {
  open.value = false;
  emit("cancel");
};

watch(open, (isOpen) => {
  if (isOpen) overlap.value = DEFAULT_OVERLAP;
});
</script>
