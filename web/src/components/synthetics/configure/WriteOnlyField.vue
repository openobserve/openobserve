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

<!-- A write-only credential (V39): shows who set it and when, never the value; Replace types a new one. -->
<template>
  <div
    v-if="kept"
    class="border-border-default rounded-default flex min-h-9 min-w-0 items-center gap-2 border px-3"
    :data-test="`${dataTest}-kept`"
  >
    <OIcon name="lock" size="sm" class="text-text-secondary shrink-0" />
    <span class="text-text-body min-w-0 flex-1 text-sm">{{ setText }}</span>
    <OButton
      variant="ghost-primary"
      size="sm"
      :data-test="`${dataTest}-replace`"
      @click="emit('update:kept', false)"
    >
      {{ t("secrets.values.replace") }}
    </OButton>
  </div>
  <div v-else class="flex min-w-0 items-start gap-2">
    <OInput
      class="min-w-0 flex-1"
      :model-value="modelValue"
      type="password"
      autocomplete="new-password"
      :placeholder="placeholder ?? t('secrets.values.typeNewValue')"
      :error="!!error"
      :error-message="error"
      :data-test="dataTest"
      @update:model-value="(v: string | number) => emit('update:modelValue', String(v))"
    />
    <slot name="append" />
    <OButton
      v-if="meta"
      variant="outline"
      size="sm"
      :data-test="`${dataTest}-cancel`"
      @click="cancel"
    >
      {{ t("common.cancel") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { relativeTimeText } from "@/lib/core/Table/cells/relativeTime";
import type { WriteOnlyMeta } from "@/types/synthetics";

const props = defineProps<{
  modelValue: string;
  /** The server-held value, when there is one. */
  meta?: WriteOnlyMeta;
  kept: boolean;
  placeholder?: I18nText;
  error?: I18nText;
  dataTest: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:kept": [value: boolean];
}>();
const { t } = useI18nTyped();

const setText = computed(() =>
  props.meta
    ? t("secrets.values.setBy", {
        when: raw(relativeTimeText(props.meta.updated_at / 1000, Date.now())),
        who: props.meta.updated_by,
      })
    : t("secrets.values.notSet"),
);

const cancel = () => {
  emit("update:modelValue", "");
  emit("update:kept", true);
};
</script>
