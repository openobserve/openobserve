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

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped } from "@/types/i18n";
import { FORM_CONTEXT_KEY } from "../Form/OForm.types";
import { scrollToFirstError } from "../Form/scrollToFirstError";
import { discardFormChanges, useFormCounts } from "./formCounts";
import type { SaveBarEmits, SaveBarProps, SaveBarSlots } from "./OSaveBar.types";

const props = withDefaults(defineProps<SaveBarProps>(), {
  mode: "edit",
  saveLabel: undefined,
  saveDisabled: false,
  submit: true,
  cancelDataTest: undefined,
  form: undefined,
  changeCount: undefined,
  errorCount: undefined,
  loaded: true,
  saving: undefined,
  contentSize: "lg",
  dataTest: "save-bar",
  saveDataTest: undefined,
  discardDataTest: undefined,
  formId: undefined,
});

const emit = defineEmits<SaveBarEmits>();
defineSlots<SaveBarSlots>();

const { t } = useI18nTyped();

// The same widths as ConstrainedPage, so the buttons end where the form column ends.
const SIZE_CLASS = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
  full: "max-w-none",
} as const;

const form = props.form ?? inject(FORM_CONTEXT_KEY, null);
const root = ref<HTMLElement | null>(null);

const formSubmitting = form?.useStore((s: { isSubmitting: boolean }) => s.isSubmitting);
const counts = useFormCounts(form);

const changes = computed(() => props.changeCount ?? counts.changes.value);
const errors = computed(() => props.errorCount ?? counts.errors.value);

const isSaving = computed(() => props.saving ?? !!formSubmitting?.value);
const isCreate = computed(() => props.mode === "create");
const changed = computed(() => props.loaded && changes.value > 0);
// A new record has no saved values to be equal to, so its primary never waits for a change.
const canSave = computed(() => props.loaded && (isCreate.value || changed.value));
const state = computed(() => {
  if (!props.loaded) return "loading";
  if (isSaving.value) return "saving";
  if (!canSave.value) return "clean";
  return errors.value > 0 ? "invalid" : "changed";
});

function focusFirstError() {
  const formEl = props.formId ? document.getElementById(props.formId) : root.value?.closest("form");
  return scrollToFirstError(formEl ?? undefined);
}

// Save is the form's submit button so Enter in a field reaches it; the bar runs the submit itself.
async function save(event?: Event) {
  event?.preventDefault();
  if (isSaving.value || !canSave.value || props.saveDisabled) return;
  if (!form || !props.submit) {
    emit("save");
    return;
  }
  try {
    await form.handleSubmit();
  } catch {
    // The page's submit handler reports its own failure; the bar stays in Changed.
    return;
  }
  if (form.state.isValid) emit("save");
  else await focusFirstError();
}

function discard() {
  if (form) discardFormChanges(form);
  emit("discard");
}
</script>

<template>
  <div
    ref="root"
    role="region"
    :aria-label="isCreate ? t('common.actions') : t('common.unsavedChanges')"
    class="border-border-default bg-surface-base shadow-sticky-footer sticky bottom-0 z-10 flex min-h-14 items-center border-t"
    :data-test="dataTest"
    :data-state="state"
  >
    <div :class="['flex w-full min-w-0 items-center gap-3', SIZE_CLASS[contentSize]]">
      <slot name="start" />
      <div class="text-text-secondary flex min-w-0 flex-1 items-center gap-2 text-sm">
        <div
          aria-live="polite"
          class="flex min-w-0 items-center gap-2"
          :data-test="`${dataTest}-status`"
        >
          <OSkeleton v-if="!loaded" type="text" animation="none" class="w-40" />
          <template v-else-if="isCreate" />
          <template v-else-if="!changed">
            <OIcon name="check-circle" size="sm" class="shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t("common.saveBar.noChanges") }}</span>
          </template>
          <template v-else>
            <span
              class="bg-accent hidden size-2 shrink-0 rounded-full md:block"
              aria-hidden="true"
            />
            <span class="text-text-body truncate font-medium md:hidden">
              {{ t("common.saveBar.changesShort", changes) }}
            </span>
            <span class="text-text-body hidden truncate font-medium md:inline">
              {{ t("common.saveBar.unsavedChanges", changes) }}
            </span>
          </template>
        </div>
        <template v-if="canSave && errors > 0">
          <span v-if="!isCreate" aria-hidden="true">·</span>
          <button
            type="button"
            class="text-status-error-text focus-visible:outline-focus-ring-accent rounded-default inline-flex shrink-0 cursor-pointer items-center gap-1 font-medium whitespace-nowrap underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
            :data-test="`${dataTest}-fix`"
            @click="focusFirstError"
          >
            <OIcon name="error-outline" size="xs" class="shrink-0" aria-hidden="true" />
            {{ t("common.saveBar.fixFields", errors) }}
          </button>
        </template>
      </div>
      <slot name="actions" />
      <OButton
        v-if="isCreate"
        variant="outline"
        size="sm-action"
        type="button"
        :disabled="isSaving"
        :data-test="cancelDataTest ?? `${dataTest}-cancel`"
        @click="emit('cancel')"
      >
        {{ t("common.cancel") }}
      </OButton>
      <OButton
        v-else-if="changed"
        variant="outline"
        size="sm-action"
        type="button"
        :disabled="isSaving"
        :data-test="discardDataTest ?? `${dataTest}-discard`"
        @click="discard"
      >
        {{ t("common.saveBar.discard") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        :type="submit ? 'submit' : 'button'"
        :form="formId"
        :loading="isSaving"
        :disabled="!canSave || saveDisabled"
        :data-test="saveDataTest ?? `${dataTest}-save`"
        @click="save"
      >
        {{ saveLabel ?? t("common.save") }}
      </OButton>
    </div>
  </div>
</template>
