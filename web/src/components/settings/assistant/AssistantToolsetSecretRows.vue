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
  <fieldset ref="root" class="flex flex-col gap-2" :data-test="`ai-toolset-${kind}-rows`">
    <legend class="text-text-heading mb-1 text-sm font-medium">{{ t(COPY[kind].legend) }}</legend>
    <div
      v-for="(row, i) in rows"
      :key="`${kind}-${i}`"
      class="flex items-start gap-2 max-md:flex-wrap"
      :data-test="`ai-toolset-${kind}-${i}-row`"
    >
      <div class="w-48 shrink-0 max-md:w-full">
        <OFormInput
          :name="`${field}[${i}].key`"
          :label="t(COPY[kind].key)"
          :readonly="isLocked(row)"
          :help-text="isLocked(row) ? t('assistant.toolsets.secret.keyLocked') : undefined"
          :data-test="`ai-toolset-${kind}-${i}-key`"
        />
      </div>
      <div class="min-w-0 flex-1 max-md:w-full">
        <OFormSecretInput
          v-if="kind !== 'file'"
          :name="`${field}[${i}].value`"
          :state="row.state"
          :label="t(COPY[kind].value)"
          :unchanged-label="t('assistant.toolsets.secret.unchanged')"
          :replace-label="t('assistant.toolsets.secret.replace')"
          :keep-label="t('assistant.toolsets.secret.keep')"
          :will-replace-label="t('assistant.toolsets.secret.willReplace')"
          :show-label="t('assistant.toolsets.secret.show')"
          :hide-label="t('assistant.toolsets.secret.hide')"
          :required="row.state !== 'unchanged' && !!row.key"
          :data-test="`ai-toolset-${kind}-${i}`"
          @update:state="(state) => setState(i, state)"
        />
        <div v-else-if="row.state === 'unchanged'" class="flex flex-col gap-1">
          <span :id="`${uid}-${i}-label`" class="text-input-label-text text-compact font-medium">{{
            t(COPY.file.value)
          }}</span>
          <div
            role="group"
            :aria-labelledby="`${uid}-${i}-label`"
            class="flex flex-wrap items-center gap-2"
          >
            <OTag
              :id="`${uid}-${i}-unchanged`"
              variant="default-soft"
              :label="t('assistant.toolsets.secret.unchanged')"
            />
            <OButton
              variant="outline"
              size="sm"
              class="max-md:min-h-11 pointer-coarse:min-h-11"
              :aria-describedby="`${uid}-${i}-unchanged`"
              :data-test="`ai-toolset-file-${i}-replace`"
              @click="replaceFile(i)"
              >{{ t("assistant.toolsets.secret.replace") }}</OButton
            >
          </div>
        </div>
        <div v-else class="flex flex-col gap-1">
          <OFormTextarea
            :id="`${uid}-${i}-file`"
            :name="`${field}[${i}].value`"
            :label="t(COPY.file.value)"
            :rows="6"
            :required="!!row.key"
            :input-attrs="{
              class: 'font-mono',
              spellcheck: 'false',
              autocapitalize: 'off',
              autocorrect: 'off',
              'aria-describedby': row.state === 'replacing' ? `${uid}-${i}-will` : undefined,
            }"
            :data-test="`ai-toolset-file-${i}-editor`"
          />
          <div v-if="row.state === 'replacing'" class="flex flex-wrap items-center gap-2">
            <OTag
              :id="`${uid}-${i}-will`"
              variant="default-soft"
              :label="t('assistant.toolsets.secret.willReplace')"
            />
            <OButton
              variant="ghost-primary"
              size="xs"
              class="max-md:min-h-11 pointer-coarse:min-h-11"
              :data-test="`ai-toolset-file-${i}-keep`"
              @click="keepFile(i)"
              >{{ t("assistant.toolsets.secret.keep") }}</OButton
            >
          </div>
        </div>
      </div>
      <OButton
        variant="ghost-destructive"
        size="sm"
        class="mt-5 max-md:mt-0 max-md:min-h-11"
        :aria-label="t(COPY[kind].remove, { key: row.key || String(i + 1) })"
        :data-test="`ai-toolset-${kind}-${i}-remove`"
        @click="form.removeFieldValue(field as never, i)"
        >{{ t("assistant.toolsets.secret.remove") }}</OButton
      >
    </div>
    <OButton
      variant="outline"
      size="sm"
      class="self-start max-md:min-h-11"
      :data-test="`ai-toolset-${kind}-add`"
      @click="form.pushFieldValue(field as never, { key: '', value: '', state: 'new' } as never)"
      >{{ t(COPY[kind].add) }}</OButton
    >
  </fieldset>
</template>

<script setup lang="ts">
import { nextTick, ref, useId } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { FormContextValue } from "@/lib/forms/Form/OForm.types";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSecretInput from "@/lib/forms/SecretInput/OFormSecretInput.vue";
import type { SecretInputState } from "@/lib/forms/SecretInput/OSecretInput.types";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

import type { SecretRow } from "./AssistantToolsetForm.schema";

type RowKind = "header" | "env" | "file";

const COPY: Record<
  RowKind,
  { legend: I18nKey; key: I18nKey; value: I18nKey; add: I18nKey; remove: I18nKey }
> = {
  header: {
    legend: "aiToolset.headers",
    key: "aiToolset.headerKey",
    value: "aiToolset.headerValue",
    add: "aiToolset.addHeader",
    remove: "assistant.toolsets.secret.removeHeader",
  },
  env: {
    legend: "aiToolset.envVars",
    key: "aiToolset.envKey",
    value: "aiToolset.envValue",
    add: "aiToolset.addEnvVar",
    remove: "assistant.toolsets.secret.removeEnv",
  },
  file: {
    legend: "aiToolset.credentialFiles",
    key: "aiToolset.credEnvVar",
    value: "aiToolset.credContentHint",
    add: "aiToolset.addCredFile",
    remove: "assistant.toolsets.secret.removeFile",
  },
};

const props = defineProps<{
  form: FormContextValue;
  field: string;
  kind: RowKind;
  rows: SecretRow[];
}>();

const { t } = useI18nTyped();
const uid = useId();
const root = ref<HTMLElement | null>(null);

// A kept secret is restored by key, so renaming one would silently drop it.
function isLocked(row: SecretRow): boolean {
  return row.state === "unchanged" && !!row.stored;
}

function setState(i: number, state: SecretInputState) {
  props.form.setFieldValue(`${props.field}[${i}].state` as never, state as never);
  const stored = props.rows[i]?.stored;
  if (state === "unchanged" && stored)
    props.form.setFieldValue(`${props.field}[${i}].key` as never, stored as never);
}

async function focusIn(selector: string) {
  await nextTick();
  root.value?.querySelector<HTMLElement>(selector)?.focus();
}

function replaceFile(i: number) {
  setState(i, "replacing");
  props.form.setFieldValue(`${props.field}[${i}].value` as never, "" as never);
  void focusIn(`[data-test="ai-toolset-file-${i}-editor-field"]`);
}

function keepFile(i: number) {
  setState(i, "unchanged");
  props.form.setFieldValue(`${props.field}[${i}].value` as never, null as never);
  void focusIn(`[data-test="ai-toolset-file-${i}-replace"]`);
}
</script>
