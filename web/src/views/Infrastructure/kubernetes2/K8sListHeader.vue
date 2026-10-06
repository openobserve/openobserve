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
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = withDefaults(
  defineProps<{
    title: I18nText;
    // Rows shown after search and namespace narrowing, out of `total`.
    count: number;
    total: number;
    countLabel?: I18nText;
    capped?: boolean;
    chip?: I18nText;
    namespaced?: boolean;
    namespaceOptions?: string[];
    namespaces?: string[];
    search?: string;
    searchPlaceholder?: I18nText;
    searchable?: boolean;
  }>(),
  {
    countLabel: undefined,
    capped: false,
    chip: undefined,
    namespaced: false,
    namespaceOptions: () => [],
    namespaces: () => [],
    search: "",
    searchPlaceholder: undefined,
    searchable: true,
  },
);

const emit = defineEmits<{
  "update:namespaces": [value: string[]];
  "update:search": [value: string];
  clear: [];
}>();

const { t } = useI18nTyped();

const rowRef = ref<HTMLElement | null>(null);
const filterOpen = ref(false);

const filtered = computed(() => !!props.search || props.namespaces.length > 0);

const options = computed(() => props.namespaceOptions.map((ns) => ({ label: raw(ns), value: ns })));

const onNamespaces = (value: unknown) =>
  emit("update:namespaces", (Array.isArray(value) ? value : []).map(String));
</script>

<template>
  <div ref="rowRef" class="flex w-full min-w-0 items-center gap-2" data-test="k8s2-list-header">
    <OText
      tag="h2"
      class="min-w-0 shrink truncate text-lg font-semibold"
      data-test="k8s2-list-title"
    >
      {{ title }}
    </OText>
    <span class="text-text-secondary min-w-0 shrink truncate text-xs" data-test="k8s2-list-count">
      <template v-if="filtered">
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="k8s2-list-filtered-clear"
          @click="emit('clear')"
          >{{ t("infra.k8s2.filtered") }}</OButton
        >{{ raw(` ${count} / ${total}`) }}
      </template>
      <span v-else-if="capped" data-test="k8s2-list-capped">
        {{ t("infra.k8s2.itemsCapped", { count }) }}
        <OTooltip :content="t('infra.k8s2.itemsCappedTip')" />
      </span>
      <template v-else>{{ countLabel ?? t("infra.k8s2.items", { count }, count) }}</template>
    </span>
    <OTag
      v-if="chip"
      size="xs"
      variant="default-soft"
      class="shrink-0"
      data-test="k8s2-list-chip"
      >{{ chip }}</OTag
    >
    <div class="ms-auto flex min-w-0 items-center gap-2">
      <OSelect
        v-if="namespaced"
        class="w-56 max-md:hidden"
        size="sm"
        multiple
        searchable
        clearable
        :max-visible-chips="1"
        :model-value="namespaces"
        :options="options"
        :placeholder="t('infra.k8s2.allNamespaces')"
        data-test="k8s2-namespace-select"
        @update:model-value="onNamespaces"
      />
      <OButton
        v-if="namespaced"
        class="md:hidden"
        variant="outline"
        size="icon-sm"
        :aria-label="t('infra.k8s2.namespaceFilter')"
        data-test="k8s2-namespace-filter-btn"
        @click="filterOpen = true"
      >
        <OIcon name="filter-list" size="sm" />
        <span v-if="namespaces.length" class="text-2xs">{{ namespaces.length }}</span>
      </OButton>
      <OSearchInput
        v-if="searchable"
        class="min-w-0 flex-1 max-md:min-w-40 md:w-56 md:flex-none"
        size="sm"
        :model-value="search"
        :debounce="300"
        :placeholder="searchPlaceholder"
        data-test="k8s2-list-search"
        @update:model-value="(v: string) => emit('update:search', v)"
      />
      <slot name="trailing" />
    </div>
    <ODrawer
      v-if="namespaced"
      v-model:open="filterOpen"
      side="right"
      size="sm"
      :anchor="rowRef"
      anchor-edge="bottom"
      :title="t('infra.k8s2.namespaceFilter')"
      data-test="k8s2-namespace-drawer"
    >
      <OSelect
        multiple
        searchable
        clearable
        :model-value="namespaces"
        :options="options"
        :placeholder="t('infra.k8s2.allNamespaces')"
        data-test="k8s2-namespace-select-mobile"
        @update:model-value="onNamespaces"
      />
    </ODrawer>
  </div>
</template>
