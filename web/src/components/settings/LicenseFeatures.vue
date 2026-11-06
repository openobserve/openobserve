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
  <div v-else class="flex flex-col gap-2">
    <div class="flex items-start justify-between gap-3">
      <i18n-t
        keypath="about.features_summary"
        tag="p"
        class="min-w-0 flex-1"
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
      <OButton
        v-if="!hideRequestAccess && (split.missing.length || split.addedLocked.length)"
        variant="ghost-primary"
        size="xs"
        icon-right="arrow-forward"
        class="shrink-0"
        data-test="settings-license-features-request-access"
        @click="emit('request-access')"
      >
        {{ t("about.features_request_access") }}
      </OButton>
    </div>

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

    <!-- fixed height so switching tabs or searching never moves what sits below -->
    <div
      class="border-border-default bg-surface-subtle rounded-default h-44 [scrollbar-gutter:stable] overflow-auto border px-3 pb-2"
      data-test="settings-license-features-list"
    >
      <div
        v-for="group in visibleGroups"
        :key="group.id"
        :data-test="`settings-license-features-${group.id}`"
      >
        <div
          v-if="filter === 'all'"
          class="bg-surface-subtle text-text-secondary sticky top-0 z-10 pt-2 pb-1 text-xs font-semibold"
        >
          {{
            group.id === "free" || group.id === "free-not-included"
              ? group.heading
              : t("about.features_group_heading", {
                  heading: group.heading,
                  count: group.items.length,
                })
          }}
        </div>
        <ul
          class="grid grid-cols-2 gap-x-4 max-md:grid-cols-1"
          :class="{ 'pt-2': filter !== 'all' }"
        >
          <li
            v-for="key in group.items"
            :key="key"
            class="flex min-w-0 items-center gap-1.5 py-0.5"
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
              class="lock-chip shrink-0"
            />
            <span v-else class="bg-border-strong size-1.5 shrink-0 rounded-full" />
            <OTruncatedText class="min-w-0">{{ raw(name(key)) }}</OTruncatedText>
          </li>
        </ul>
      </div>
      <OEmptyState
        v-if="!visibleGroups.length"
        size="inline"
        icon="search"
        :title="search.trim() ? t('about.features_no_match') : t('about.features_none')"
        :backdrop="false"
        data-test="settings-license-features-empty"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { splitLicenseFeatures, type LicenseFeatureSource } from "@/utils/featureGate";

type GroupId = "unlocked" | "missing" | "free" | "free-not-included" | "new";
type FilterId = "all" | GroupId;

const props = defineProps<{
  license: LicenseFeatureSource | null | undefined;
  evaluatedAt?: number;
  hideRequestAccess?: boolean;
}>();

const emit = defineEmits<{ (e: "request-access"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const search = ref("");
const filter = ref<FilterId>("all");

// A key this build has no name for may still be named in the definition the license was issued with.
const name = (key: string): string =>
  store.state.zoConfig?.feature_names?.[key] ??
  props.license?.feature_definition?.features?.[key]?.display_name ??
  key;

const split = computed(() =>
  splitLicenseFeatures(props.license, store.state.zoConfig?.features ?? {}, props.evaluatedAt),
);

const total = computed(() =>
  split.value
    ? split.value.unlocked.length +
      split.value.missing.length +
      split.value.free.length +
      split.value.freeNotIncluded.length +
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
    {
      id: "free-not-included" as const,
      heading: t("about.features_free_not_included"),
      items: s.freeNotIncluded,
    },
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
      label: t("about.features_missing"),
      count: s?.missing.length ?? 0,
    },
    { id: "new" as const, label: t("about.features_filter_new"), count: s?.added.length ?? 0 },
    { id: "free" as const, label: t("about.features_filter_free"), count: s?.free.length ?? 0 },
    {
      id: "free-not-included" as const,
      label: t("about.features_free_not_included"),
      count: s?.freeNotIncluded.length ?? 0,
    },
  ].filter((option) => (option.id !== "new" && option.id !== "free-not-included") || option.count);
});

const visibleGroups = computed(() => {
  const query = search.value.trim().toLowerCase();
  return groups.value
    .filter((group) => filter.value === "all" || filter.value === group.id)
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (key) => key.toLowerCase().includes(query) || name(key).toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.items.length);
});
</script>
