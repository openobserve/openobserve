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
  <div class="flex flex-col gap-2">
    <p
      v-if="below"
      :id="ALLOWANCE_FLOOR_WARNING_ID"
      class="text-status-warning-text text-xs"
      data-test="ai-credits-limit-floor-warning"
    >
      {{ t("assistant.billing.allowance.floorWarning", { used: formatCount(used) }) }}
    </p>
    <div class="flex flex-wrap items-center gap-2 text-xs" data-test="ai-credits-limit-mode">
      <span class="text-text-secondary">{{ t("assistant.billing.allowance.mode") }}</span>
      <OTag v-if="usage.data.value" type="aiMode" :value="usage.data.value.mode" />
      <span v-else-if="usage.isError.value" class="text-text-body">{{
        t("assistant.billing.allowance.modeUnavailable")
      }}</span>
    </div>
  </div>
</template>

<script lang="ts">
/** The input points its `aria-describedby` here while the warning shows. */
export const ALLOWANCE_FLOOR_WARNING_ID = "ai-credits-limit-floor-warning";
</script>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, inject, watch } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { orgAiUsageQuery } from "@/services/assistant_billing.queries";
import { useI18nTyped } from "@/types/i18n";
import { formatCount } from "@/utils/formatters";

const props = defineProps<{ org: string; used: number; field: string }>();
const emit = defineEmits<{ (e: "update:below", value: boolean): void }>();

const { t } = useI18nTyped();
const form = inject(FORM_CONTEXT_KEY, null);
const usage = useQuery(computed(() => orgAiUsageQuery(props.org)));

const typed = form
  ? form.useStore((s: { values: Record<string, unknown> }) => s.values[props.field])
  : computed(() => undefined);
const below = computed(() => {
  const raw = typed.value;
  if (raw === "" || raw === null || raw === undefined) return false;
  const limit = Number(raw);
  return Number.isFinite(limit) && limit < props.used;
});

watch(below, (value) => emit("update:below", value), { immediate: true });
</script>
