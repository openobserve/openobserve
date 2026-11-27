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
  <div class="flex min-w-0 flex-col gap-3" data-test="autoresolve-verdict-check">
    <div
      v-if="fixed"
      class="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      data-test="autoresolve-verdict-fixed"
    >
      <OTag type="autoresolvePersonVerdict" value="fixed" />
      <span class="text-text-secondary text-xs wrap-anywhere">
        {{
          t("autoresolve.verdict.byAt", { name: raw(fixed.by), time: autoresolveTime(fixed.at_us) })
        }}
      </span>
    </div>

    <template v-else-if="!asking">
      <div
        class="text-text-secondary flex min-h-8 min-w-0 flex-wrap items-center gap-2 text-sm"
        data-test="autoresolve-verdict-question"
      >
        <span>{{ t("autoresolve.verdict.question") }}</span>
        <OButton
          variant="outline"
          size="xs"
          :loading="submitting === 'fixed'"
          :disabled="!!submitting"
          data-test="autoresolve-verdict-yes"
          @click="emit('fixed')"
        >
          {{ t("autoresolve.verdict.yes") }}
        </OButton>
        <OButton
          variant="outline"
          size="xs"
          :disabled="!!submitting"
          data-test="autoresolve-verdict-no"
          @click="openNote"
        >
          {{ t("autoresolve.verdict.no") }}
        </OButton>
      </div>
      <OInlineNotice
        v-if="notice"
        :variant="notice.variant"
        wrap
        :text="notice.text"
        class="self-start"
        data-test="autoresolve-verdict-notice"
      />
    </template>

    <div
      v-else
      class="rounded-surface border-border-default bg-surface-base flex min-w-0 flex-col gap-3 border p-4"
      data-test="autoresolve-verdict-form"
    >
      <OInput
        v-model="note"
        :label="t('autoresolve.verdict.noteLabel')"
        :maxlength="CORRECTION_NOTE_MAX"
        :help-text="source ?? undefined"
        :disabled="!!submitting"
        autofocus
        data-test="autoresolve-verdict-note"
      />
      <AutoResolveRememberCheckbox
        v-if="run.autoresolve"
        v-model="remember"
        :name="run.autoresolve.name"
        :disabled="!!submitting"
      />
      <div class="flex flex-wrap items-center justify-end gap-2">
        <OInlineNotice
          v-if="notice"
          :variant="notice.variant"
          wrap
          :text="notice.text"
          class="min-w-0 flex-1"
          data-test="autoresolve-verdict-notice"
        />
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!!submitting"
          data-test="autoresolve-verdict-cancel"
          @click="asking = false"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!note.trim()"
          :loading="submitting === 'not_fixed'"
          data-test="autoresolve-verdict-plan-again"
          @click="send"
        >
          {{ t("autoresolve.verdict.planAgain") }}
        </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import type { InlineNoticeVariant } from "@/lib/feedback/InlineNotice/OInlineNotice.types";
import OInput from "@/lib/forms/Input/OInput.vue";
import AutoResolveRememberCheckbox from "@/components/autoresolve/AutoResolveRememberCheckbox.vue";
import type { AutoResolveReplanInput, AutoResolveRun } from "@/services/autoresolve";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  autoresolveTime,
  CORRECTION_NOTE_MAX,
  stillFiringNote,
} from "@/utils/autoresolve/autoresolveText";

const props = defineProps<{
  run: AutoResolveRun;
  /** Which answer is being sent, if any. */
  submitting: "fixed" | "not_fixed" | null;
  /** Why the last answer was not saved. */
  notice?: { variant: InlineNoticeVariant; text: I18nText } | null;
}>();

const emit = defineEmits<{ fixed: []; replan: [body: AutoResolveReplanInput] }>();

const { t } = useI18nTyped();

const fixed = computed(() => {
  const verdict = props.run.person_verdict;
  return verdict?.verdict === "fixed" && verdict.revision === props.run.revision ? verdict : null;
});

const asking = ref(false);
const note = ref("");
const remember = ref(true);
const source = ref<I18nText | null>(null);

const openNote = () => {
  const prefill = stillFiringNote(props.run, t);
  if (!note.value.trim()) note.value = prefill.note;
  source.value = prefill.source;
  asking.value = true;
};

const send = () => {
  if (!note.value.trim()) return;
  emit("replan", {
    note: note.value.trim(),
    kind: "not_fixed",
    remember: props.run.autoresolve ? remember.value : false,
  });
};
</script>
