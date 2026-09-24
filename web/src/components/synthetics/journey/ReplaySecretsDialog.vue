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
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { makeReplaySecretsSchema } from "./ReplaySecretsDialog.schema";

const FORM_ID = "synthetics-journey-replay-secrets-form";

const props = defineProps<{
  open: boolean;
  mode: "ask" | "change";
  environmentName: I18nText;
  secrets: { name: string; steps: number[]; value?: string }[];
  failedAtStep?: number;
  onSubmit: (_values: Record<string, string>) => Promise<void> | void;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  forget: [names: string[]];
}>();

const { t } = useI18nTyped();

const names = computed(() => props.secrets.map((s) => s.name));

function defaults(): Record<string, string> {
  return Object.fromEntries(props.secrets.map((s) => [s.name, s.value ?? ""]));
}

const form = useOForm<Record<string, string>>({
  defaultValues: defaults(),
  schema: makeReplaySecretsSchema(t, names.value),
  onSubmit: (values) => props.onSubmit({ ...values }),
});
const isSubmitting = form.useStore((s) => s.isSubmitting);

function fieldLabel(secret: { name: string; steps: number[] }) {
  return t(
    "synthetics.journey.replaySecrets.fieldLabel",
    { name: secret.name, environment: props.environmentName, steps: secret.steps.join(", ") },
    secret.steps.length,
  );
}

function onUpdateOpen(value: boolean) {
  if (!isSubmitting.value) emit("update:open", value);
}

function onForget() {
  emit("forget", names.value);
  emit("update:open", false);
}
</script>

<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('synthetics.journey.replaySecrets.title', { environment: environmentName })"
    :persistent="isSubmitting"
    :show-close="!isSubmitting"
    :primary-button-label="
      mode === 'ask'
        ? t('synthetics.journey.replaySecrets.replayIn', { environment: environmentName })
        : t('synthetics.journey.replaySecrets.saveAndRerun')
    "
    :secondary-button-label="t('common.cancel')"
    secondary-button-variant="outline"
    :neutral-button-label="
      mode === 'change' ? t('synthetics.journey.replaySecrets.forget') : undefined
    "
    :form-id="FORM_ID"
    data-test="synthetics-journey-replay-secrets-dialog"
    @update:open="onUpdateOpen"
    @click:secondary="onUpdateOpen(false)"
    @click:neutral="onForget"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormInput
        v-for="secret in secrets"
        :key="secret.name"
        :name="secret.name"
        type="password"
        revealable
        required
        :label="fieldLabel(secret)"
        :data-test="`synthetics-journey-replay-secrets-input-${secret.name}`"
      />
      <p
        v-if="mode === 'change' && failedAtStep !== undefined"
        class="text-status-error-text m-0 text-sm"
      >
        {{ t("synthetics.journey.replaySecrets.lastFailed", { step: failedAtStep }) }}
      </p>
      <div class="text-text-secondary flex flex-col gap-1 text-xs">
        <span>{{ t("synthetics.journey.replaySecrets.why") }}</span>
        <span>{{ t("synthetics.journey.replaySecrets.memoryOnly") }}</span>
      </div>
    </OForm>
  </ODialog>
</template>
