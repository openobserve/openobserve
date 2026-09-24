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
import { computed, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { makeMissingValueSchema, type MissingValueForm } from "./MissingValueDialog.schema";

const FORM_ID = "synthetics-journey-missing-value-form";

const props = defineProps<{
  open: boolean;
  name: string;
  environmentName: I18nText;
  isGlobal: boolean;
  steps: number[];
  sharedByChecks: number;
  canReplayAnyway: boolean;
  existingKind: "plain" | "secret" | null;
  onSubmit: (_values: { value: string; secret: boolean }) => Promise<void>;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "replay-anyway": [];
}>();

const { t } = useI18nTyped();

function defaults(): MissingValueForm {
  return { value: "", secret: props.existingKind === "secret" };
}

const form = useOForm<MissingValueForm>({
  defaultValues: defaults(),
  schema: makeMissingValueSchema(t),
  onSubmit: (values) => props.onSubmit({ value: values.value, secret: values.secret }),
});
const isSubmitting = form.useStore((s) => s.isSubmitting);

watch(
  () => [props.open, props.name, props.existingKind],
  () => {
    if (props.open) form.reset(defaults());
  },
);

// Built in script: a `{{` literal in the template is read as an interpolation.
const placeholder = computed(() => "{{" + props.name + "}}");

const body = computed(() => {
  const params = { placeholder: placeholder.value, environment: props.environmentName };
  if (props.steps.includes(0)) return t("synthetics.journey.missingValue.bodyStartingUrl", params);
  return t(
    "synthetics.journey.missingValue.body",
    { ...params, steps: props.steps.join(", ") },
    props.steps.length,
  );
});

const kindLabel = computed(() =>
  props.existingKind === "secret"
    ? t("synthetics.variables.kindSecret")
    : t("synthetics.variables.kindPlain"),
);

function onUpdateOpen(value: boolean) {
  if (!isSubmitting.value) emit("update:open", value);
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('synthetics.journey.missingValue.title', { name, environment: environmentName })"
    :persistent="isSubmitting"
    :show-close="!isSubmitting"
    :primary-button-label="t('synthetics.journey.missingValue.saveAndReplay')"
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    :neutral-button-label="
      canReplayAnyway ? t('synthetics.journey.missingValue.replayAnyway') : undefined
    "
    :form-id="FORM_ID"
    data-test="synthetics-journey-missing-value-dialog"
    @update:open="onUpdateOpen"
    @click:secondary="onUpdateOpen(false)"
    @click:neutral="emit('replay-anyway')"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <p class="text-text-body m-0 text-sm">{{ body }}</p>
      <OFormInput
        name="value"
        :label="
          t('synthetics.journey.missingValue.valueLabel', { name, environment: environmentName })
        "
        required
        data-test="synthetics-journey-missing-value-input"
      />
      <div v-if="!isGlobal" class="flex flex-col gap-1">
        <OFormCheckbox
          name="secret"
          :label="t('synthetics.journey.missingValue.storeAsSecret')"
          :disabled="existingKind !== null"
          data-test="synthetics-journey-missing-value-secret"
        />
        <span v-if="existingKind !== null" class="text-text-secondary text-xs">
          {{ t("synthetics.journey.missingValue.kindLocked", { kind: kindLabel }) }}
        </span>
      </div>
      <div
        class="rounded-default bg-badge-warning-soft-bg border-badge-warning-ol-border/50 flex items-start gap-2 border p-3"
        role="note"
        data-test="synthetics-journey-missing-value-warning"
      >
        <OIcon
          name="warning"
          size="sm"
          class="text-badge-warning-ol-text mt-0.5"
          aria-hidden="true"
        />
        <span class="text-text-body text-xs">
          {{
            isGlobal
              ? t("synthetics.journey.missingValue.globalWarning")
              : t(
                  "synthetics.journey.missingValue.sharedWarning",
                  { environment: environmentName, count: sharedByChecks },
                  sharedByChecks,
                )
          }}
        </span>
      </div>
    </OForm>
  </ODialog>
</template>
