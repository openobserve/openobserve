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
import { computed, ref, shallowRef, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { FilterGroup } from "@/utils/query/filterBar";
import QueryFilterBar from "./QueryFilterBar.vue";
import { FILTER_PROFILES, type FilterIssue } from "./filterProfiles";
import { filterIssues, pruneIncomplete } from "./filterValidation";
import type {
  FilterBuilderEmits,
  FilterBuilderExpose,
  FilterBuilderProps,
} from "./FilterBuilder.types";

defineOptions({ name: "FilterBuilder" });

const props = withDefaults(defineProps<FilterBuilderProps>(), {
  loadValues: undefined,
  extraValueSuggestions: undefined,
  valueHint: undefined,
  layout: undefined,
  fieldsLoading: false,
  placeholder: undefined,
  disabled: false,
  size: "sm",
  appearance: "field",
  dataTest: "filter-builder",
});
const emit = defineEmits<FilterBuilderEmits>();

const { t } = useI18nTyped();
const barRef = ref<InstanceType<typeof QueryFilterBar> | null>(null);

const profile = computed(() => FILTER_PROFILES[props.profile]);
const context = computed(() => ({ fields: props.fields }));

const tree = shallowRef<FilterGroup>(profile.value.codec.parse(props.modelValue, context.value));
// Chip highlights wait for the first edit or validate(), so a fresh form does not open in red.
const showIssues = ref(false);
// Text of the value last parsed or emitted: hosts mutate emitted objects in place or rebuild equal ones every render.
let snapshot = JSON.stringify(props.modelValue ?? null);

const savedFor = (next: FilterGroup) => {
  const kept = profile.value.validation === "dropIncomplete" ? pruneIncomplete(next) : next;
  return profile.value.codec.serialize(kept, context.value);
};

// The value can change outside the builder (a reset, a loaded row); re-read it unless it is our own echo or unchanged.
watch(
  () => props.modelValue,
  (value) => {
    const text = JSON.stringify(value ?? null);
    if (text === snapshot) return;
    snapshot = text;
    tree.value = profile.value.codec.parse(value, context.value);
  },
);

watch(
  () => props.profile,
  () => {
    tree.value = profile.value.codec.parse(props.modelValue, context.value);
  },
);

const issues = computed<FilterIssue[]>(() =>
  filterIssues(tree.value, profile.value, { t, saved: savedFor(tree.value) }),
);
const valid = computed(() => issues.value.length === 0);
const shownIssues = computed(() => (showIssues.value ? issues.value : []));
// A chip only carries its message for screen readers, so a rule's message is also written out; "unfinished" needs no words.
const groupMessages = computed(() => {
  const unfinished = t("filterBar.validation.incomplete");
  const messages = shownIssues.value
    .filter((issue) => issue.nodeId === null || issue.message !== unfinished)
    .map((issue) => issue.message);
  return [...new Set(messages)];
});

watch(valid, (value) => emit("update:valid", value), { immediate: true });

function onTreeChange(next: FilterGroup) {
  tree.value = next;
  showIssues.value = true;
  const saved = savedFor(next);
  snapshot = JSON.stringify(saved ?? null);
  emit("update:modelValue", saved);
}

function focus() {
  barRef.value?.focus();
}

function validate(): FilterIssue[] {
  showIssues.value = true;
  return issues.value;
}

defineExpose<FilterBuilderExpose>({ focus, validate });
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-1" :data-test="`${dataTest}-root`">
    <QueryFilterBar
      ref="barRef"
      :model-value="tree"
      :fields="fields"
      :profile="profile.name"
      :layout="layout"
      :load-values="loadValues"
      :extra-value-suggestions="extraValueSuggestions"
      :value-hint="valueHint"
      :issues="shownIssues"
      :fields-loading="fieldsLoading"
      :placeholder="placeholder"
      :disabled="disabled"
      :size="size"
      :appearance="appearance"
      :data-test="dataTest"
      @update:model-value="onTreeChange"
      @submit="emit('submit')"
      @focus="emit('focus')"
    />
    <div
      v-if="groupMessages.length"
      class="text-input-error-text flex flex-col text-xs"
      role="alert"
      :data-test="`${dataTest}-issues`"
    >
      <span v-for="message in groupMessages" :key="message">{{ message }}</span>
    </div>
  </div>
</template>
