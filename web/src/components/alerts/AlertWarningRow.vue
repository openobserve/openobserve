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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";

defineProps<{
  /** Form field holding the warning level. */
  name: string;
  /** The alert's own comparison, which the warning shares. */
  operator: I18nText;
  /** A field error as the form reports it. */
  error?: string;
  inputDataTest: string;
  errorDataTest: string;
}>();

const emit = defineEmits<{ (e: "remove"): void }>();

const { t } = useI18nTyped();
</script>

<!-- A warning level shares the alert's comparison, so the row echoes it rather than offering a picker. -->
<template>
  <OSettingRow
    :label="t('alerts.form.warning.label')"
    :error="error ? raw(error) : undefined"
    :error-data-test="errorDataTest"
    data-test="alert-warning-row"
  >
    <span class="text-text-body text-sm" data-test="alert-warning-operator">{{ operator }}</span>
    <OFormInput
      :aria-label="t('alerts.warningIf')"
      :name="name"
      type="number"
      fit-content
      class="max-w-32! min-w-16"
      :data-test="inputDataTest"
      :placeholder="t('alerts.form.warning.placeholder')"
    >
      <template #error />
    </OFormInput>
    <template #actions>
      <OButton
        variant="ghost-primary"
        size="sm"
        :aria-label="t('alerts.removeWarning')"
        data-test="alert-remove-warning-button"
        @click="emit('remove')"
      >
        {{ t("common.remove") }}
      </OButton>
    </template>
  </OSettingRow>
</template>
