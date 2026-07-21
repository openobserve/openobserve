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
  Shared "Add next step" picker (Pipelines + Workflows) — a searchable dialog
  opened by the hover-`+` on a node. Purely presentational: each editor passes
  the addable `items` and handles the chosen one.

    items[] = {
      key          — unique id (also the data-test suffix)
      title        — bold label (searched)
      description  — sub-label (searched)
      icon         — OIcon name, or "img:<url>"
      iconTint     — Tailwind classes for the icon square
      ...extra     — anything the host needs back on pick (echoed in @pick)
    }

  Emits `pick(item)` when a card is clicked and `close` when dismissed.
-->
<template>
  <ODialog
    :open="true"
    size="md"
    :title="title"
    :data-test="testPrefix + '-dialog'"
    @update:open="(v) => !v && emit('close')"
  >
    <OSearchInput
      v-model="search"
      :placeholder="placeholderText"
      clearable
      class="mb-3"
      :data-test="testPrefix + '-search'"
    />

    <div v-if="filtered.length" class="flex flex-col gap-2">
      <button
        v-for="item in filtered"
        :key="item.key"
        type="button"
        class="flow-step-card flex items-start gap-3 p-3 border border-border-default rounded-default bg-card-bg text-left cursor-pointer transition-[border-color,background,box-shadow] duration-[120ms] hover:border-accent hover:bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))] hover:shadow-[0_0_0_0.1875rem_color-mix(in_srgb,var(--color-primary-600)_12%,transparent)]"
        :data-test="`${testPrefix}-${item.key}`"
        @click="emit('pick', item)"
      >
        <div
          class="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-default"
          :class="item.iconTint"
        >
          <OIcon :name="item.icon || 'help'" size="md" />
        </div>
        <div class="min-w-0">
          <div class="text-sm font-semibold text-text-body">
            {{ item.title }}
          </div>
          <div v-if="item.description" class="text-xs text-text-secondary leading-snug">
            {{ item.description }}
          </div>
        </div>
      </button>
    </div>

    <div v-else class="py-8 text-center text-sm text-text-secondary">
      {{ emptyText }}
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";

interface StepItem {
  key: string;
  title: string;
  description?: string;
  icon?: string;
  iconTint?: string;
  [k: string]: any;
}

const props = withDefaults(
  defineProps<{
    items: StepItem[];
    title: string;
    searchPlaceholder?: string;
    noMatchText?: string;
    testPrefix?: string;
  }>(),
  {
    // Empty, not English: t() cannot run at module scope (no setup context), so
    // the locale fallback lives in the computeds below. A caller may still pass
    // its own already-translated string.
    searchPlaceholder: "",
    noMatchText: "",
    testPrefix: "flow-step",
  },
);

const emit = defineEmits<{
  (e: "pick", item: StepItem): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const placeholderText = computed(
  () => props.searchPlaceholder || (t("common.search") as string),
);
const emptyText = computed(
  () => props.noMatchText || (t("common.noMatches") as string),
);

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter(
    (it) =>
      (it.title || "").toLowerCase().includes(q) ||
      (it.description || "").toLowerCase().includes(q),
  );
});
</script>
