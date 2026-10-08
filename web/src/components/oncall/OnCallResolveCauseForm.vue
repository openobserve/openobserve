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

<!--
  The cause picker and note shared by the single-response and bulk-resolve
  confirm dialogs. Kept as one component so the two stay identical instead of
  drifting apart edit by edit.
-->
<template>
  <div class="flex flex-col gap-1">
    <span class="text-text-secondary text-xs">{{ t("oncall.resolveCause") }}</span>
    <span class="text-text-secondary text-xs">{{ t("oncall.resolveCauseHint") }}</span>
    <OSelect
      :model-value="cause"
      :options="causeOptions"
      clearable
      :placeholder="t('oncall.resolveCausePlaceholder')"
      :data-test="`${dataTestPrefix}-cause`"
      @update:model-value="(v) => emit('update:cause', (v as ResolutionCause) || '')"
    />
  </div>

  <OTextarea
    :model-value="note"
    :label="t('oncall.resolveCauseNote')"
    :placeholder="t('oncall.resolveCauseNotePlaceholder')"
    :rows="2"
    :data-test="`${dataTestPrefix}-cause-note`"
    @update:model-value="(v) => emit('update:note', String(v ?? ''))"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { useI18nTyped } from "@/types/i18n";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { ResolutionCause } from "@/ts/interfaces/oncall";

defineProps<{
  cause: ResolutionCause | "";
  note: string;
  /** Prefixes every data-test in this form, e.g. "oncall-resolve" or "oncall-bulk-resolve". */
  dataTestPrefix: string;
}>();

const emit = defineEmits<{
  "update:cause": [value: ResolutionCause | ""];
  "update:note": [value: string];
}>();

const { t } = useI18nTyped();

const causeOptions = computed(() =>
  RESOLUTION_CAUSES.map((cause) => ({ label: t(`oncall.cause_${cause}`), value: cause })),
);
</script>
