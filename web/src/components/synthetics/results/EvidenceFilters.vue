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
/**
 * The evidence toolbar: step scope, view (All / Network / Console),
 * first-party-only and wrap. Shared by the run-level panel and the per-step
 * Page-activity card so the two surfaces cannot drift onto different controls.
 *
 * The step select renders only when `stepOptions` is supplied. The card never
 * supplies them — its step is already the scope, so a control to pick one
 * would be a no-op there.
 */
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { EvidenceView, EvidenceViewOption } from "@/composables/synthetics/useEvidenceFilters";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOptionInput } from "@/lib/forms/Select/OSelect.types";

const props = defineProps<{
  views: EvidenceViewOption[];
  view: EvidenceView;
  firstPartyOnly: boolean;
  wrap: boolean;
  /** Panel only. Omitted on the step card, which has no step to choose. */
  stepOptions?: SelectOptionInput[];
  stepFilter?: string | null;
}>();

const emit = defineEmits<{
  "update:view": [value: EvidenceView];
  "update:firstPartyOnly": [value: boolean];
  "update:wrap": [value: boolean];
  "update:stepFilter": [value: string | null];
}>();

const { t } = useI18nTyped();

const view = computed({
  get: () => props.view,
  set: (v: EvidenceView) => emit("update:view", v),
});

const firstPartyOnly = computed({
  get: () => props.firstPartyOnly,
  set: (v: boolean) => emit("update:firstPartyOnly", v),
});

const wrap = computed({
  get: () => props.wrap,
  set: (v: boolean) => emit("update:wrap", v),
});

const stepFilter = computed({
  get: () => props.stepFilter ?? null,
  set: (v: string | null) => emit("update:stepFilter", v),
});
</script>

<template>
  <!-- Every option keeps its count and stays visible at zero: a hidden
       zero is indistinguishable from an option that does not exist, and
       "nothing on the console" is information. First-party sits beside
       the group rather than in it — it narrows whichever option is
       selected, so it is not a fourth one. -->
  <div class="flex flex-wrap items-center gap-2">
    <!-- Leftmost because it is the broadest cut: which part of the run, before
         which kind of event. Fixed width so a long step name truncates in the
         trigger instead of stretching the control and shifting the row. -->
    <OSelect
      v-if="stepOptions?.length"
      v-model="stepFilter"
      :options="stepOptions"
      size="sm"
      class="w-56 shrink-0"
      :searchable="false"
      data-test="synthetics-evidence-step-filter"
    />
    <OToggleGroup v-model="view" type="single">
      <OToggleGroupItem
        v-for="v in views"
        :key="v.key"
        :value="v.key"
        size="sm"
        :data-test="`synthetics-evidence-filter-${v.key}`"
      >
        {{ v.label }} <span class="text-text-secondary">({{ v.count }})</span>
      </OToggleGroupItem>
    </OToggleGroup>
    <OCheckbox
      v-model="firstPartyOnly"
      size="sm"
      :label="t('synthetics.evidence.firstPartyOnly')"
      class="ml-2"
      data-test="synthetics-evidence-first-party"
    />
    <OButton
      variant="outline"
      size="icon-chip"
      class="ml-auto"
      :active="wrap"
      data-test="synthetics-evidence-wrap-btn"
      @click="wrap = !wrap"
    >
      <OIcon name="wrap-text" size="sm" />
      <OTooltip :content="t('search.messageWrapContent')" />
    </OButton>
  </div>
</template>
