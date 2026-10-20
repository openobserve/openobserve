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
    <span class="text-text-secondary text-xs">{{ causeLabel ?? t("oncall.resolveCause") }}</span>
    <span v-if="causeHint !== null" class="text-text-secondary text-xs">
      {{ causeHint ?? t("oncall.resolveCauseHint") }}
    </span>
    <OSelect
      :model-value="cause"
      :options="causeOptions"
      clearable
      :disabled="disabled"
      :placeholder="t('oncall.resolveCausePlaceholder')"
      :data-test="`${dataTestPrefix}-cause`"
      @update:model-value="(v) => emit('update:cause', (v as ResolutionCause) || '')"
    />
  </div>

  <OTextarea
    :model-value="note"
    :label="noteLabel ?? t('oncall.resolveCauseNote')"
    :placeholder="t('oncall.resolveCauseNotePlaceholder')"
    :rows="2"
    :maxlength="noteMaxlength"
    :disabled="disabled"
    :data-test="`${dataTestPrefix}-cause-note`"
    @update:model-value="(v) => emit('update:note', String(v ?? ''))"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { RESOLUTION_CAUSES } from "@/ts/interfaces/oncall";
import type { ResolutionCause } from "@/ts/interfaces/oncall";

const props = withDefaults(
  defineProps<{
    cause: ResolutionCause | "";
    note: string;
    /** Prefixes every data-test in this form, e.g. "oncall-resolve" or "oncall-bulk-resolve". */
    dataTestPrefix: string;
    /** Replaces "What was it?" (the RCA correction form). */
    causeLabel?: I18nText;
    /** Replaces the on-call hint; null hides it. */
    causeHint?: I18nText | null;
    /** Replaces the note label. */
    noteLabel?: I18nText;
    /** Causes the select does not offer, e.g. `still_unknown` for a correction. */
    excludeCauses?: ResolutionCause[];
    /** The server's note limit, when the caller has one. */
    noteMaxlength?: number;
    disabled?: boolean;
  }>(),
  {
    causeLabel: undefined,
    causeHint: undefined,
    noteLabel: undefined,
    excludeCauses: () => [],
    noteMaxlength: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:cause": [value: ResolutionCause | ""];
  "update:note": [value: string];
}>();

const { t } = useI18nTyped();

const causeOptions = computed(() =>
  RESOLUTION_CAUSES.filter((cause) => !props.excludeCauses.includes(cause)).map((cause) => ({
    label: t(`oncall.cause_${cause}`),
    value: cause,
  })),
);
</script>
