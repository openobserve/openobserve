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
  <fieldset class="flex flex-col gap-2" data-test="ai-toolset-header-rows">
    <legend class="text-text-heading mb-1 text-sm font-medium">{{ t("aiToolset.headers") }}</legend>
    <div
      v-for="(row, i) in rows"
      :key="i"
      class="flex items-start gap-2 max-md:flex-wrap"
      :data-test="`ai-toolset-header-${i}-row`"
    >
      <div class="w-48 shrink-0 max-md:w-full">
        <OFormInput
          :name="`mcp.headers[${i}].key`"
          :label="t('aiToolset.headerKey')"
          :readonly="isLocked(row)"
          :help-text="isLocked(row) ? t('assistant.toolsets.secret.keyLocked') : undefined"
          :data-test="`ai-toolset-header-${i}-key`"
        />
      </div>
      <div class="min-w-0 flex-1 max-md:w-full">
        <OFormSecretInput
          :name="`mcp.headers[${i}].value`"
          :state="row.state"
          :label="t('aiToolset.headerValue')"
          :unchanged-label="t('assistant.toolsets.secret.unchanged')"
          :replace-label="t('assistant.toolsets.secret.replace')"
          :keep-label="t('assistant.toolsets.secret.keep')"
          :will-replace-label="t('assistant.toolsets.secret.willReplace')"
          :show-label="t('assistant.toolsets.secret.show')"
          :hide-label="t('assistant.toolsets.secret.hide')"
          :required="row.state !== 'unchanged' && !!row.key"
          :data-test="`ai-toolset-header-${i}`"
          @update:state="(state) => setState(i, state)"
        />
      </div>
      <OButton
        variant="ghost-destructive"
        size="sm"
        class="mt-5 max-md:mt-0 max-md:min-h-11"
        :aria-label="t('assistant.toolsets.secret.removeHeader', { key: row.key || String(i + 1) })"
        :data-test="`ai-toolset-header-${i}-remove`"
        @click="form.removeFieldValue('mcp.headers', i)"
        >{{ t("assistant.toolsets.secret.remove") }}</OButton
      >
    </div>
    <OButton
      variant="outline"
      size="sm"
      class="self-start max-md:min-h-11"
      data-test="ai-toolset-header-add"
      @click="form.pushFieldValue('mcp.headers', { key: '', value: '', state: 'new' })"
      >{{ t("aiToolset.addHeader") }}</OButton
    >
  </fieldset>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import type { FormContextValue } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSecretInput from "@/lib/forms/SecretInput/OFormSecretInput.vue";
import type { SecretInputState } from "@/lib/forms/SecretInput/OSecretInput.types";
import { useI18nTyped } from "@/types/i18n";

import type { SecretRow } from "./AssistantToolsetForm.schema";

const props = defineProps<{
  form: FormContextValue;
  rows: SecretRow[];
}>();

const { t } = useI18nTyped();

// A kept secret is restored by key, so renaming one would silently drop it.
function isLocked(row: SecretRow): boolean {
  return row.state === "unchanged" && !!row.stored;
}

function setState(i: number, state: SecretInputState) {
  props.form.setFieldValue(`mcp.headers[${i}].state`, state);
  const stored = props.rows[i]?.stored;
  if (state === "unchanged" && stored) props.form.setFieldValue(`mcp.headers[${i}].key`, stored);
}
</script>
