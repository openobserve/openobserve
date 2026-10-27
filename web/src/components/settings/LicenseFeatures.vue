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
  <!-- absent list is a pre-entitlement license, which unlocks every feature -->
  <p v-if="!split" data-test="settings-license-features-summary">
    {{ t("about.features_all_unlocked") }}
  </p>
  <div v-else class="flex flex-col gap-3">
    <i18n-t
      keypath="about.features_summary"
      tag="p"
      :plural="split.free.length"
      data-test="settings-license-features-summary"
    >
      <template #ratio>
        <span class="text-text-heading font-semibold">{{
          t(
            "about.features_paid_ratio",
            { unlocked: split.unlocked.length, paid: split.paid },
            split.paid,
          )
        }}</span>
      </template>
      <template #free>{{ split.free.length }}</template>
    </i18n-t>

    <template v-if="!expanded">
      <div v-if="split.unlocked.length" class="flex flex-col gap-1.5">
        <span class="text-text-secondary text-xs font-semibold">
          {{ t("about.features_unlocked") }}
        </span>
        <div class="flex flex-wrap gap-1.5" data-test="settings-license-features-unlocked">
          <OBadge v-for="key in split.unlocked" :key="key" variant="success-soft" icon="check">
            {{ raw(key) }}
          </OBadge>
        </div>
      </div>
      <div v-if="split.missing.length" class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs font-semibold">
          {{ t("about.features_missing") }}
        </span>
        <div
          class="flex flex-wrap items-center gap-1.5"
          data-test="settings-license-features-missing"
        >
          <OBadge v-for="key in split.missing" :key="key" variant="default-outline" icon="lock">
            {{ raw(key) }}
          </OBadge>
          <OButton
            variant="ghost-primary"
            size="xs"
            icon-right="arrow-forward"
            data-test="settings-license-features-request-access"
            @click="emit('request-access')"
          >
            {{ t("about.features_request_access") }}
          </OButton>
        </div>
      </div>
      <div v-if="split.added.length" class="flex flex-col gap-2">
        <div class="flex flex-col">
          <span class="text-text-secondary text-xs font-semibold">
            {{ t("about.features_new") }}
          </span>
          <span class="text-text-secondary text-xs">{{ t("about.features_new_caption") }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1.5" data-test="settings-license-features-new">
          <OBadge
            v-for="key in split.added"
            :key="key"
            :variant="split.addedLocked.includes(key) ? 'default-outline' : 'default-soft'"
            :icon="split.addedLocked.includes(key) ? 'lock' : undefined"
            :dot="!split.addedLocked.includes(key)"
          >
            {{ raw(key) }}
          </OBadge>
          <OButton
            v-if="split.addedLocked.length"
            variant="ghost-primary"
            size="xs"
            icon-right="arrow-forward"
            data-test="settings-license-features-request-access"
            @click="emit('request-access')"
          >
            {{ t("about.features_request_access") }}
          </OButton>
        </div>
      </div>
      <template v-if="split.free.length">
        <OSeparator />
        <OButton
          variant="ghost"
          size="xs"
          icon-left="chevron-right"
          class="h-auto! min-h-7 max-w-full self-start py-1 text-start whitespace-normal!"
          data-test="settings-license-features-expand"
          @click="expanded = true"
        >
          {{ t("about.features_show_free", { count: split.free.length }, split.free.length) }}
        </OButton>
      </template>
    </template>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <OSearchInput
          v-model="search"
          class="min-w-0 flex-1 max-md:min-w-40 md:min-w-60"
          :placeholder="t('about.features_search', { count: total }, total)"
          data-test="settings-license-features-search"
        />
        <OToggleGroup
          :model-value="filter"
          type="single"
          mobile-dropdown
          data-test="settings-license-features-filter"
          @update:model-value="(value) => (filter = value as FilterId)"
        >
          <OToggleGroupItem
            v-for="option in filterOptions"
            :key="option.id"
            :value="option.id"
            size="sm"
            :data-test="`settings-license-features-filter-${option.id}`"
          >
            {{ option.label }}
            <span class="text-text-secondary ms-1">{{ option.count }}</span>
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <div
        v-for="group in visibleGroups"
        :key="group.id"
        class="border-border-subtle flex flex-col gap-1.5 border-b border-solid pb-3 last:border-b-0"
        :data-test="`settings-license-features-${group.id}`"
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-text-secondary text-xs font-semibold">{{ group.heading }}</span>
          <span class="text-text-secondary text-xs">{{ group.items.length }}</span>
          <OButton
            v-if="group.id === 'missing' || (group.id === 'new' && split.addedLocked.length)"
            variant="ghost-primary"
            size="xs"
            icon-right="arrow-forward"
            class="ms-auto"
            data-test="settings-license-features-request-access"
            @click="emit('request-access')"
          >
            {{ t("about.features_request_access") }}
          </OButton>
        </div>
        <ul class="columns-1 gap-x-4 md:columns-2 xl:columns-3">
          <li
            v-for="key in group.items"
            :key="key"
            class="flex min-w-0 break-inside-avoid items-center gap-1.5 py-0.5"
          >
            <OIcon
              v-if="group.id === 'unlocked'"
              name="check"
              size="xs"
              class="text-status-positive shrink-0"
            />
            <OIcon
              v-else-if="group.id === 'missing' || split.addedLocked.includes(key)"
              name="lock"
              size="xs"
              class="text-text-secondary shrink-0"
            />
            <span v-else class="bg-border-strong size-1.5 shrink-0 rounded-full" />
            <span class="min-w-0 truncate" :title="raw(key)">{{ raw(key) }}</span>
          </li>
        </ul>
      </div>
      <OEmptyState
        v-if="!visibleGroups.length"
        size="compact"
        filtered
        :backdrop="false"
        data-test="settings-license-features-empty"
        @action="clearSearch"
      />

      <OButton
        variant="ghost"
        size="xs"
        icon-left="expand-less"
        class="self-start"
        data-test="settings-license-features-collapse"
        @click="collapse"
      >
        {{ t("about.features_hide_free") }}
      </OButton>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { featureState, type FeatureStates } from "@/utils/featureGate";

type GroupId = "unlocked" | "missing" | "free" | "new";
type FilterId = "all" | GroupId;

interface FeatureDefinition {
  gate?: boolean;
  plumbing?: boolean;
}

interface LicenseFeatureSource {
  features?: string[] | null;
  feature_definition?: { features?: Record<string, FeatureDefinition> } | null;
}

const props = defineProps<{ license: LicenseFeatureSource | null | undefined }>();

const emit = defineEmits<{ (e: "request-access"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const expanded = ref(false);
const search = ref("");
const filter = ref<FilterId>("all");

const split = computed(() => {
  const license = props.license;
  if (!license?.features) return null;
  const states: FeatureStates = store.state.zoConfig?.features ?? {};
  const unlocked = [...license.features].sort();
  const definition = license.feature_definition?.features;
  const gated = definition
    ? Object.keys(definition).filter((key) => definition[key].gate && !definition[key].plumbing)
    : Object.keys(states).filter((key) => states[key] === "locked");
  // A listed key counts as paid even when ungated, so "unlocked of paid" never exceeds the total.
  const paid = new Set([...gated, ...unlocked]);
  const missing = [...paid].filter((key) => !unlocked.includes(key)).sort();
  const freeCandidates = definition
    ? Object.keys(definition).filter((key) => !definition[key].gate || definition[key].plumbing)
    : Object.keys(states).filter((key) => states[key] === "enabled");
  const free = freeCandidates
    .filter((key) => !unlocked.includes(key) && featureState(states, key) !== "hidden")
    .sort();
  // Unlocked is excluded too so a listed key missing from its own definition never shows twice.
  const added = definition
    ? Object.keys(states)
        .filter((key) => !(key in definition) && !unlocked.includes(key))
        .filter((key) => featureState(states, key) !== "hidden")
        .sort()
    : [];
  const addedLocked = added.filter((key) => featureState(states, key) === "locked");
  return { unlocked, missing, free, added, addedLocked, paid: paid.size };
});

const total = computed(() =>
  split.value
    ? split.value.unlocked.length +
      split.value.missing.length +
      split.value.free.length +
      split.value.added.length
    : 0,
);

const groups = computed(() => {
  const s = split.value;
  if (!s) return [];
  return [
    { id: "unlocked" as const, heading: t("about.features_unlocked"), items: s.unlocked },
    { id: "missing" as const, heading: t("about.features_missing"), items: s.missing },
    { id: "new" as const, heading: t("about.features_new"), items: s.added },
    { id: "free" as const, heading: t("about.features_free_heading"), items: s.free },
  ];
});

const filterOptions = computed(() => {
  const s = split.value;
  return [
    { id: "all" as const, label: t("about.features_filter_all"), count: total.value },
    {
      id: "unlocked" as const,
      label: t("about.features_unlocked"),
      count: s?.unlocked.length ?? 0,
    },
    {
      id: "missing" as const,
      label: t("about.features_filter_missing"),
      count: s?.missing.length ?? 0,
    },
    { id: "new" as const, label: t("about.features_filter_new"), count: s?.added.length ?? 0 },
    { id: "free" as const, label: t("about.features_filter_free"), count: s?.free.length ?? 0 },
  ].filter((option) => option.id !== "new" || option.count);
});

const visibleGroups = computed(() => {
  const query = search.value.trim().toLowerCase();
  return groups.value
    .filter((group) => filter.value === "all" || filter.value === group.id)
    .map((group) => ({
      ...group,
      items: group.items.filter((key) => key.toLowerCase().includes(query)),
    }))
    .filter((group) => group.items.length);
});

const clearSearch = () => {
  search.value = "";
  filter.value = "all";
};

const collapse = () => {
  clearSearch();
  expanded.value = false;
};
</script>
