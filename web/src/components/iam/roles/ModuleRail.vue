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

<!-- Mirrors SectionRail's idiom; SectionRail itself is not reused because its items are RouterLinks by contract. -->
<template>
  <nav
    data-test="edit-role-module-rail"
    class="bg-surface-panel border-border-default flex h-full min-h-0 w-60 shrink-0 flex-col border-e"
    :aria-label="t('iam.editRole.modulesTitle')"
  >
    <div class="ps-page-edge flex shrink-0 items-center gap-1.5 pe-1.5 pt-3 pb-1">
      <span class="text-text-heading min-w-0 flex-1 truncate text-sm font-semibold">
        {{ t("iam.editRole.modulesTitle") }}
      </span>
    </div>

    <div class="flex shrink-0 flex-col gap-1.5 px-1.5 pt-1 pb-1">
      <OSearchInput
        v-model="query"
        clearable
        class="w-full"
        :placeholder="t('iam.editRole.filterModules')"
        data-test="edit-role-module-rail-search"
      />
      <OToggleGroup v-model="scope" class="w-full">
        <OToggleGroupItem
          value="all"
          size="sm"
          class="flex-1"
          data-test="edit-role-module-rail-scope-all"
        >
          {{ t("iam.editRole.moduleScopeAll") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="granted"
          size="sm"
          class="flex-1"
          data-test="edit-role-module-rail-scope-granted"
        >
          {{ t("iam.editRole.moduleScopeGranted") }}
          <OBadge v-if="grantedCount" variant="default-soft" size="sm" class="ms-1">
            {{ plain(grantedCount) }}
          </OBadge>
        </OToggleGroupItem>
      </OToggleGroup>
    </div>

    <div class="flex-1 overflow-y-auto px-1.5 pt-1 pb-3">
      <OTabs
        orientation="vertical"
        class="w-full"
        :model-value="modelValue"
        data-test="edit-role-module-rail-tabs"
        @update:model-value="(value) => emit('update:modelValue', value as string)"
      >
        <OTab :name="SUMMARY_KEY" class="w-full" data-test="edit-role-module-rail-item-summary">
          <OIcon name="assignment" size="sm" class="o-tab__icon shrink-0" />
          <span class="o-tab__label truncate">{{ t("iam.editRole.moduleOverviewTitle") }}</span>
        </OTab>

        <template v-for="group in visibleGroups" :key="group.id">
          <!-- Header behaviour mirrors GroupedFieldList (logs/traces IndexList): click to fold, chevron shows state. -->
          <div
            class="text-text-secondary bg-surface-subtle rounded-default hover:text-text-heading mt-3 flex cursor-pointer items-center justify-between py-1 ps-1.5 pe-0.5 text-xs font-semibold transition-colors select-none"
            :aria-expanded="isExpanded(group.id)"
            :data-test="`edit-role-module-rail-group-${group.id}`"
            @click="toggleGroup(group.id)"
          >
            <span class="min-w-0 flex-1 truncate">
              {{ group.label }} {{ countLabel(group.modules.length) }}
            </span>
            <OButton
              variant="ghost"
              size="icon-xs"
              class="shrink-0"
              :aria-label="
                isExpanded(group.id)
                  ? t('iam.editRole.collapseModuleGroup')
                  : t('iam.editRole.expandModuleGroup')
              "
              :data-test="`edit-role-module-rail-group-toggle-${group.id}`"
            >
              <OIcon :name="isExpanded(group.id) ? 'expand-more' : 'chevron-right'" size="sm" />
            </OButton>
          </div>
          <OTab
            v-for="module in isExpanded(group.id) ? group.modules : []"
            :key="module.key"
            :name="module.key"
            class="w-full"
            :title="rowTooltip(module)"
            :data-test="`edit-role-module-rail-item-${module.key}`"
          >
            <OIcon :name="module.icon" size="sm" class="o-tab__icon shrink-0" />
            <span class="o-tab__label min-w-0 flex-1 truncate text-left">
              {{ module.label }}
            </span>
            <!-- The label must stay readable, so the row only signals unsaved changes; the pane shows the counts. -->
            <span
              v-if="module.added || module.removed"
              class="bg-accent size-1.5 shrink-0 rounded-full"
              :data-test="`edit-role-module-rail-unsaved-${module.key}`"
            />
            <OBadge v-if="module.granted" variant="primary-soft" size="sm" class="shrink-0">
              {{ compact(module.granted) }}
            </OBadge>
          </OTab>
        </template>
      </OTabs>

      <div
        v-if="!visibleGroups.length"
        class="text-text-secondary px-1.5 py-4 text-center text-xs"
        data-test="edit-role-module-rail-no-match"
      >
        {{
          scope === "granted" ? t("iam.editRole.noGrantedModule") : t("iam.editRole.noModuleMatch")
        }}
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";

export type RailModule = {
  key: string;
  label: I18nText;
  icon: IconName;
  groupId: string;
  groupLabel: I18nText;
  granted: number;
  added: number;
  removed: number;
};

const props = defineProps<{ modules: RailModule[]; modelValue: string }>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const SUMMARY_KEY = "";

const { t, locale } = useI18nTyped();

const query = ref("");

const scope = ref("all");

const grantedCount = computed(() => props.modules.filter((module) => module.granted > 0).length);

const visibleGroups = computed(() => {
  const term = query.value.trim().toLowerCase();
  const groups: { id: string; label: I18nText; modules: RailModule[] }[] = [];

  props.modules.forEach((module) => {
    if (scope.value === "granted" && !module.granted) return;
    if (term && !String(module.label).toLowerCase().includes(term)) return;

    const last = groups[groups.length - 1];
    if (last && last.id === module.groupId) last.modules.push(module);
    else groups.push({ id: module.groupId, label: module.groupLabel, modules: [module] });
  });

  return groups;
});

// Groups start expanded, like GroupedFieldList; only an explicit fold is remembered.
const collapsedGroups = ref<Record<string, boolean>>({});

// A search should reveal every match, so it overrides any fold.
const isExpanded = (groupId: string) => !!query.value.trim() || !collapsedGroups.value[groupId];

const toggleGroup = (groupId: string) => {
  if (query.value.trim()) return;
  collapsedGroups.value[groupId] = !collapsedGroups.value[groupId];
};

// Opening a module (from Summary or a card) must not leave it hidden inside a folded group.
watch(
  () => props.modelValue,
  (moduleKey) => {
    const groupId = props.modules.find((module) => module.key === moduleKey)?.groupId;
    if (groupId) collapsedGroups.value[groupId] = false;
  },
);

// A count is a number, not prose, so it never enters the translation catalogue.
const plain = (count: number) => raw(String(count));

const countLabel = (count: number) => raw(`(${count})`);

const compactFormat = computed(
  () =>
    new Intl.NumberFormat(String(locale.value), { notation: "compact", maximumFractionDigits: 1 }),
);

const compact = (count: number) => raw(compactFormat.value.format(count));

const rowTooltip = (module: RailModule) =>
  t("iam.editRole.moduleRailTooltip", {
    module: module.label,
    granted: module.granted,
    added: module.added,
    removed: module.removed,
  });
</script>
