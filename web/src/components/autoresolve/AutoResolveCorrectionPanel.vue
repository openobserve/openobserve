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
    class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col gap-3 border p-4"
    :aria-label="t('autoresolve.correction.title')"
    data-test="autoresolve-correction-panel"
  >
    <h3 class="text-text-heading m-0 text-sm font-semibold">
      {{ t("autoresolve.correction.title") }}
    </h3>
    <div class="flex flex-col gap-1.5">
      <OToggleGroup
        :model-value="kind ?? ''"
        :aria-label="t('autoresolve.correction.kindsLabel')"
        :disabled="submitting"
        class="self-start"
        data-test="autoresolve-correction-kinds"
        @update:model-value="(value) => pickKind(value as AutoResolvePlanCorrectionKind)"
      >
        <OToggleGroupItem
          v-for="option in kinds"
          :key="option.value"
          :value="option.value"
          size="sm"
          :data-test="`autoresolve-correction-kind-${option.value}`"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
      <p class="text-text-secondary m-0 text-xs" data-test="autoresolve-correction-help">
        {{ correctionHelp(kind, t) }}
      </p>
    </div>
    <OTextarea
      v-model="note"
      autogrow
      :min-rows="WRITING_ROWS_REST"
      :max-rows="WRITING_ROWS_MAX"
      :maxlength="CORRECTION_NOTE_MAX"
      :label="t('autoresolve.correction.noteLabel')"
      :help-text="t('autoresolve.correction.noteHelp')"
      :placeholder="kind ? undefined : t('autoresolve.correction.notePickFirst')"
      :readonly="!kind"
      :tabindex="kind ? undefined : -1"
      :disabled="submitting"
      data-test="autoresolve-correction-note"
    />
    <AutoResolveRememberCheckbox
      v-if="run.autoresolve"
      v-model="remember"
      :name="run.autoresolve.name"
      :disabled="submitting"
    />
    <div class="flex flex-wrap items-center justify-end gap-2">
      <OInlineNotice
        v-if="notice"
        :variant="notice.variant"
        wrap
        :text="notice.text"
        class="min-w-0 flex-1"
        data-test="autoresolve-correction-notice"
      />
      <OButton
        variant="outline"
        size="sm-action"
        :disabled="submitting"
        data-test="autoresolve-correction-cancel"
        @click="emit('cancel')"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :disabled="!kind || !note.trim()"
        :loading="submitting"
        data-test="autoresolve-correction-send"
        @click="send"
      >
        {{ t("autoresolve.correction.send") }}
      </OButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import type { InlineNoticeVariant } from "@/lib/feedback/InlineNotice/OInlineNotice.types";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import AutoResolveRememberCheckbox from "@/components/autoresolve/AutoResolveRememberCheckbox.vue";
import {
  PLAN_CORRECTION_KINDS,
  type AutoResolvePlanCorrectionKind,
  type AutoResolveReplanInput,
  type AutoResolveRun,
} from "@/services/autoresolve";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import {
  CORRECTION_KIND_KEY,
  CORRECTION_NOTE_MAX,
  correctionDraft,
  correctionHelp,
  WRITING_ROWS_MAX,
  WRITING_ROWS_REST,
} from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{
  run: AutoResolveRun;
  /** The option the person was looking at; the draft names it and the server records it. */
  option: { id: string; title: string } | null;
  submitting: boolean;
  /** Why the last send failed. */
  notice?: { variant: InlineNoticeVariant; text: I18nText } | null;
}>();

const emit = defineEmits<{ send: [body: AutoResolveReplanInput]; cancel: [] }>();

const { t } = useI18nTyped();

const kinds = computed(() =>
  PLAN_CORRECTION_KINDS.map((value) => ({ value, label: t(CORRECTION_KIND_KEY[value]) })),
);

const kind = ref<AutoResolvePlanCorrectionKind | null>(null);
const note = ref("");
const remember = ref(true);
// A draft the person has not touched follows the picked kind; an edited note stays.
let lastDraft = "";

const pickKind = (value: AutoResolvePlanCorrectionKind) => {
  kind.value = value;
  if (note.value.trim() && note.value !== lastDraft) return;
  lastDraft = correctionDraft(value, props.option?.title, t);
  note.value = lastDraft;
};

const send = () => {
  if (!kind.value || !note.value.trim()) return;
  emit("send", {
    note: note.value.trim(),
    kind: kind.value,
    remember: props.run.autoresolve ? remember.value : false,
    ...(props.option ? { option_id: props.option.id } : {}),
  });
};
</script>
