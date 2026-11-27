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
  <fieldset class="flex flex-col gap-2" :data-test="`${testId}-rows`">
    <legend class="text-text-heading mb-1 text-sm font-medium">
      {{ legend ?? t("aiToolset.headers") }}
    </legend>
    <div
      v-for="(row, i) in rows"
      :key="i"
      class="flex items-start gap-2 max-md:flex-wrap"
      :data-test="`${testId}-${i}-row`"
    >
      <div class="w-48 shrink-0 max-md:w-full">
        <OFormInput
          :name="`mcp.${field}[${i}].key`"
          :label="t('aiToolset.headerKey')"
          :readonly="isLocked(row)"
          :help-text="isLocked(row) ? t('assistant.toolsets.secret.keyLocked') : undefined"
          :data-test="`${testId}-${i}-key`"
        />
      </div>
      <div class="min-w-0 flex-1 max-md:w-full">
        <OFormSecretInput
          :name="`mcp.${field}[${i}].value`"
          :state="row.state"
          :label="t('aiToolset.headerValue')"
          :unchanged-label="t('assistant.toolsets.secret.unchanged')"
          :replace-label="t('assistant.toolsets.secret.replace')"
          :keep-label="t('assistant.toolsets.secret.keep')"
          :will-replace-label="t('assistant.toolsets.secret.willReplace')"
          :show-label="t('assistant.toolsets.secret.show')"
          :hide-label="t('assistant.toolsets.secret.hide')"
          :required="row.state !== 'unchanged' && !!row.key"
          :data-test="`${testId}-${i}`"
          @update:state="(state) => setState(i, state)"
        />
      </div>
      <OButton
        variant="ghost-destructive"
        size="sm"
        class="mt-5 max-md:mt-0 max-md:min-h-11"
        :aria-label="t('assistant.toolsets.secret.removeHeader', { key: row.key || String(i + 1) })"
        :data-test="`${testId}-${i}-remove`"
        @click="form.removeFieldValue(`mcp.${field}`, i)"
        >{{ t("assistant.toolsets.secret.remove") }}</OButton
      >
    </div>
    <OButton
      variant="outline"
      size="sm"
      class="self-start max-md:min-h-11"
      :data-test="`${testId}-add`"
      @click="form.pushFieldValue(`mcp.${field}`, { key: '', value: '', state: 'new' })"
      >{{ addLabel ?? t("aiToolset.addHeader") }}</OButton
    >
  </fieldset>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import type { FormContextValue } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSecretInput from "@/lib/forms/SecretInput/OFormSecretInput.vue";
import type { SecretInputState } from "@/lib/forms/SecretInput/OSecretInput.types";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import type { SecretRow } from "./AssistantToolsetForm.schema";

const props = withDefaults(
  defineProps<{
    form: FormContextValue;
    rows: SecretRow[];
    /** Which secret list of `mcp` the rows edit: the headers, or AutoResolve's write headers. */
    field?: "headers" | "writeHeaders";
    legend?: I18nText;
    addLabel?: I18nText;
    testId?: string;
  }>(),
  { field: "headers", legend: undefined, addLabel: undefined, testId: "ai-toolset-header" },
);

const { t } = useI18nTyped();

// A kept secret is restored by key, so renaming one would silently drop it.
function isLocked(row: SecretRow): boolean {
  return row.state === "unchanged" && !!row.stored;
}

function setState(i: number, state: SecretInputState) {
  props.form.setFieldValue(`mcp.${props.field}[${i}].state`, state);
  const stored = props.rows[i]?.stored;
  if (state === "unchanged" && stored)
    props.form.setFieldValue(`mcp.${props.field}[${i}].key`, stored);
}
</script>
