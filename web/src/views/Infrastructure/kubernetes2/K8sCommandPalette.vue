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
import { computed, ref, watch } from "vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { searchPalette, type PaletteGroup, type PaletteItem } from "./k8sPalette";

// `group` narrows the palette to one group, as the cluster switcher does.
const props = withDefaults(
  defineProps<{
    open: boolean;
    items: PaletteItem[];
    group?: PaletteGroup | null;
    loading?: boolean;
    indexFailed?: boolean;
    truncated?: boolean;
  }>(),
  { group: null, loading: false, indexFailed: false, truncated: false },
);
const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "select", _item: PaletteItem): void;
}>();

const { t } = useI18nTyped();

const GROUP_LABEL: Record<PaletteGroup, I18nKey> = {
  goTo: "infra.k8s2.paletteGroupGoTo",
  attention: "infra.k8s2.paletteGroupAttention",
  workloads: "infra.k8s2.paletteGroupWorkloads",
  pods: "infra.k8s2.paletteGroupPods",
  nodes: "infra.k8s2.paletteGroupNodes",
  clusters: "infra.k8s2.paletteGroupClusters",
};

const query = ref("");
const active = ref(0);

const SWITCHER_LIMIT = 50;

const LISTBOX_ID = "k8s2-palette-listbox";
const optionId = (index: number) => `k8s2-palette-option-${index}`;

const ranked = computed(() => {
  const pool = props.group ? props.items.filter((i) => i.group === props.group) : props.items;
  return props.group && !query.value.trim()
    ? { items: pool.slice(0, SWITCHER_LIMIT), total: pool.length }
    : searchPalette(pool, query.value);
});

const results = computed(() =>
  ranked.value.items.map((item, index, all) => ({
    item,
    index,
    header: index === 0 || all[index - 1].group !== item.group,
  })),
);

const statusKey = computed<I18nKey | null>(() => {
  if (props.group === "clusters") return null;
  if (props.indexFailed) return "infra.k8s2.paletteIndexFailed";
  if (props.loading) return "infra.k8s2.paletteLoading";
  return props.truncated ? "infra.k8s2.paletteTruncated" : null;
});

const activeOptionId = computed(() => (results.value.length ? optionId(active.value) : undefined));

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    query.value = "";
    active.value = 0;
  },
);

watch(query, () => {
  active.value = 0;
});

const choose = (item: PaletteItem) => {
  emit("update:open", false);
  emit("select", item);
};

const onKeydown = (event: KeyboardEvent) => {
  const count = results.value.length;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!count) return;
    active.value = (active.value + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
  } else if (event.key === "Enter") {
    const hit = results.value[active.value];
    if (!hit) return;
    event.preventDefault();
    choose(hit.item);
  }
};
</script>

<template>
  <ODialog
    :open="open"
    size="md"
    :show-close="false"
    data-test="k8s2-palette"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-2" @keydown="onKeydown">
      <OSearchInput
        v-model="query"
        size="md"
        :placeholder="t('infra.k8s2.palettePlaceholder')"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded="true"
        :aria-controls="LISTBOX_ID"
        :aria-activedescendant="activeOptionId"
        data-test="k8s2-palette-input"
      />
      <div
        class="flex max-h-96 flex-col overflow-y-auto"
        :id="LISTBOX_ID"
        role="listbox"
        :aria-label="t('infra.k8s2.paletteResults')"
        data-test="k8s2-palette-results"
      >
        <template v-for="entry in results" :key="entry.item.id">
          <OText
            v-if="entry.header"
            role="presentation"
            class="text-text-secondary px-2 pt-2 pb-1 text-xs font-semibold"
            :data-test="`k8s2-palette-group-${entry.item.group}`"
          >
            {{ t(GROUP_LABEL[entry.item.group]) }}
          </OText>
          <button
            :id="optionId(entry.index)"
            type="button"
            role="option"
            :aria-selected="entry.index === active"
            class="rounded-default flex items-center gap-2 px-2 py-1.5 text-left text-sm"
            :class="entry.index === active ? 'bg-dropdown-item-hover-bg' : ''"
            :data-test="`k8s2-palette-item-${entry.index}`"
            @mouseenter="active = entry.index"
            @click="choose(entry.item)"
          >
            <OIcon
              :name="entry.item.icon"
              size="sm"
              :class="entry.item.hot ? 'text-status-error-text' : 'text-text-secondary'"
            />
            <OTruncatedText class="text-text-heading min-w-0 flex-1">{{
              entry.item.label
            }}</OTruncatedText>
            <span class="text-text-secondary shrink-0 text-xs">{{ entry.item.sub }}</span>
          </button>
        </template>
        <OText
          v-if="!results.length"
          class="text-text-secondary p-6 text-center text-sm"
          data-test="k8s2-palette-empty"
        >
          {{ t("infra.k8s2.paletteEmpty") }}
        </OText>
      </div>
      <OText
        v-if="ranked.total > results.length"
        class="text-text-secondary px-2 text-xs"
        data-test="k8s2-palette-more"
      >
        {{ t("infra.k8s2.paletteMore", { shown: results.length, total: ranked.total }) }}
      </OText>
      <OText
        v-if="statusKey"
        class="text-text-secondary px-2 text-xs"
        data-test="k8s2-palette-status"
      >
        {{ t(statusKey) }}
      </OText>
    </div>
  </ODialog>
</template>
